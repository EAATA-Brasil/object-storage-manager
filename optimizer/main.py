import os
import io
import posixpath
import tempfile
import subprocess
import asyncio
import time
import threading
import requests
import httpx
from urllib.parse import unquote_plus

from fastapi import FastAPI, Request, Query
from fastapi.responses import Response
from minio import Minio
from minio.commonconfig import CopySource
from PIL import Image

from prometheus_client import (
    Counter,
    Histogram,
    Gauge,
    generate_latest,
    CONTENT_TYPE_LATEST,
)

# ===== Manager config (novo) =====
from manager_cfg import (
    MANAGER_BASE_URL,
    DEFAULT_STORAGE_ID,
    CACHE as MANAGER_CACHE,
    start_poll as start_manager_poll,
)

app = FastAPI()


# ===== ENV (fallback modo antigo) =====
MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "minio:9000").replace("http://", "").replace("https://", "")       
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "admin")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "admin123456")
MINIO_SECURE = os.getenv("MINIO_SECURE", "false").lower() == "true"
MINIO_BUCKET = os.getenv("MINIO_BUCKET", "eaata-prod")

PREFIX_ROOT = os.getenv("PREFIX_ROOT", "ocorrencias/")               # fallback
PREFIX_WORK = os.getenv("PREFIX_WORK", "ocorrencias/otimizando/")    # fallback

# Imagem (fallback)
IMG_MAX_WIDTH = int(os.getenv("IMG_MAX_WIDTH", "1600"))
IMG_QUALITY_JPEG = int(os.getenv("IMG_QUALITY_JPEG", "78"))
IMG_QUALITY_WEBP = int(os.getenv("IMG_QUALITY_WEBP", "72"))

# Vídeo (fallback)
VIDEO_MAX_WIDTH = int(os.getenv("VIDEO_MAX_WIDTH", "1280"))
VIDEO_CRF = os.getenv("VIDEO_CRF", "28")
VIDEO_PRESET = os.getenv("VIDEO_PRESET", "veryfast")
AUDIO_BITRATE = os.getenv("AUDIO_BITRATE", "96k")

# Anti-loop (metadata)
META_OPT_KEY = "optimized"
META_OPT_VAL = "1"

# Performance
MAX_CONCURRENCY = int(os.getenv("MAX_CONCURRENCY", "1"))
BATCH_SLEEP_MS = int(os.getenv("BATCH_SLEEP_MS", "0"))
MIN_SIZE_KB = int(os.getenv("MIN_SIZE_KB", "0"))
VIDEO_MAX_MB = int(os.getenv("VIDEO_MAX_MB", "0"))

IMG_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
VID_EXTS = {".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm"}


# =========================
# Prometheus metrics
# =========================

OPT_EVENTS = Counter(
    "optimizer_events_total",
    "Total de eventos por tipo, resultado e area",
    ["type", "result", "area"],  # type=image|video, result=processed|skipped|failed, area=chat|painel|download_arquivo|other
)

OPT_FAIL = Counter(
    "optimizer_fail_total",
    "Falhas por tipo, motivo e area",
    ["type", "reason", "area"],
)

OPT_NOGAIN = Counter(
    "optimizer_nogain_total",
    "Sem ganho: manteve original (mas marcou optimized=1)",
    ["type"],
)

BYTES_BEFORE = Counter(
    "optimizer_bytes_before_total",
    "Bytes antes da otimização",
    ["type"],
)

BYTES_AFTER = Counter(
    "optimizer_bytes_after_total",
    "Bytes depois da otimização",
    ["type"],
)

INFLIGHT = Gauge(
    "optimizer_inflight",
    "Processamentos em andamento",
    ["type"],
)

PROC_TIME = Histogram(
    "optimizer_process_seconds",
    "Tempo por arquivo",
    ["type"],
    buckets=(0.2, 0.5, 1, 2, 5, 10, 20, 40, 80, 160, 320),
)


@app.get("/metrics")
def metrics():
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


# =========================
# Helpers
# =========================

def log(msg: str):
    print(msg, flush=True)

def log_optimization(storage_id: str, bucket: str, file_key: str, file_type: str, before: int, after: int):     
    """Envia o log de processamento para o banco de dados via backend."""
    try:
        payload = {
            "file_key": file_key,
            "file_type": file_type,
            "bytes_before": before,
            "bytes_after": after
        }
        url = f"{MANAGER_BASE_URL}/api/accounts/{storage_id}/buckets/{bucket}/log-processed"
        r = requests.post(url, json=payload, timeout=5)
        if r.status_code >= 400:
            log(f"[LOG] Falha ao enviar estatisticas para {file_key} (HTTP {r.status_code}): {r.text}")
        else:
            log(f"[LOG] Estatisticas enviadas para {file_key} ({before} -> {after})")
    except Exception as e:
        log(f"[LOG] Falha ao enviar estatisticas para {file_key}: {e}")


@app.on_event("startup")
def _startup():
    if MANAGER_BASE_URL:
        start_manager_poll(log)
        log("[MANAGER] poll thread started")
    else:
        log("[MANAGER] MANAGER_BASE_URL vazio; rodando modo antigo (ENV hardcoded)")
    
    # Inicia o worker da fila
    asyncio.create_task(batch_worker())


def mcli_fallback() -> Minio:
    return Minio(
        MINIO_ENDPOINT,
        access_key=MINIO_ACCESS_KEY,
        secret_key=MINIO_SECRET_KEY,
        secure=MINIO_SECURE,
    )


_CLIENTS = {}
_CLIENTS_LOCK = threading.RLock()


def client_for_storage(storage_id: str) -> Minio:
    """
    Cria Minio client dinamicamente a partir do Manager (multi-storage).
    Se Manager não estiver configurado ou storage não existir, cai no ENV antigo.
    """
    st = MANAGER_CACHE.get_storage(storage_id) if MANAGER_BASE_URL else None
    if st:
        endpoint_full = str(st.get("endpoint") or "")
        endpoint = endpoint_full.replace("http://", "").replace("https://", "")
        secure = endpoint_full.startswith("https://")
        access_key = str(st.get("access_key") or "")
        secret_key = str(st.get("secret_key") or "")

        cache_key = f"{endpoint_full}|{access_key}|{secret_key}"
        with _CLIENTS_LOCK:
            if cache_key in _CLIENTS:
                return _CLIENTS[cache_key]

            cli = Minio(
                endpoint,
                access_key=access_key,
                secret_key=secret_key,
                secure=secure,
            )
            _CLIENTS[cache_key] = cli
            return cli

    return mcli_fallback()


def ext_of(key: str) -> str:
    return os.path.splitext(key.lower())[1]


def detect_area(key: str) -> str:
    if "/chat/" in key:
        return "chat"
    if "/painel/" in key:
        return "painel"
    if "/download_arquivo/" in key:
        return "download_arquivo"
    return "other"


def detect_content_type(ext: str) -> str:
    if ext in (".jpg", ".jpeg"):
        return "image/jpeg"
    if ext == ".png":
        return "image/png"
    if ext == ".webp":
        return "image/webp"

    if ext in (".mp4", ".m4v"):
        return "video/mp4"
    if ext == ".mov":
        return "video/quicktime"
    if ext == ".webm":
        return "video/webm"
    if ext in (".mkv", ".avi"):
        return "video/x-matroska"
    return "application/octet-stream"


def head_is_optimized(client: Minio, bucket: str, key: str) -> bool:
    try:
        st = client.stat_object(bucket, key)
        md = {k.lower(): v for k, v in (st.metadata or {}).items()}
        for k, v in md.items():
            if k.endswith(META_OPT_KEY.lower()):
                if str(v) == str(META_OPT_VAL):
                    return True
                else:
                    log(f"[DEBUG] Metadata match found but value mismatch: {k}={v} (expected {META_OPT_VAL})")  
    except Exception as e:
        # Se falhar o stat, assumimos que não está otimizado ou não existe
        pass
    return False


def stat_size(client: Minio, bucket: str, key: str) -> int:
    st = client.stat_object(bucket, key)
    return int(getattr(st, "size", 0) or 0)


def delete_quiet(client: Minio, bucket: str, key: str):
    try:
        client.remove_object(bucket, key)
    except Exception:
        pass


def put_with_meta_bytes(client: Minio, bucket: str, key: str, data: bytes, content_type: str):
    client.put_object(
        bucket,
        key,
        io.BytesIO(data),
        length=len(data),
        content_type=content_type,
        metadata={META_OPT_KEY: META_OPT_VAL},
    )


def put_with_meta_file(client: Minio, bucket: str, key: str, file_path: str, content_type: str):
    client.fput_object(
        bucket,
        key,
        file_path,
        content_type=content_type,
        metadata={META_OPT_KEY: META_OPT_VAL},
    )


def mark_optimized_server_side(client: Minio, bucket: str, key: str):
    client.copy_object(
        bucket,
        key,
        CopySource(bucket, key),
        metadata={META_OPT_KEY: META_OPT_VAL},
        metadata_directive="REPLACE",
    )


def should_skip_by_size_bytes(size: int, min_size_kb: int) -> bool:
    return (min_size_kb > 0 and size < (min_size_kb * 1024))


def should_skip_video_by_max_mb(size: int, video_max_mb: int) -> bool:
    if video_max_mb and video_max_mb > 0:
        return size > (video_max_mb * 1024 * 1024)
    return False


def optimize_image_bytes(src_bytes: bytes, ext: str, params: dict) -> bytes:
    img_max_width = int(params.get("max_px", IMG_MAX_WIDTH))
    q_jpeg = int(params.get("quality_jpeg", IMG_QUALITY_JPEG))
    q_webp = int(params.get("quality_webp", IMG_QUALITY_WEBP))

    im = Image.open(io.BytesIO(src_bytes))
    im.load()

    w, h = im.size
    if w > img_max_width:
        new_w = img_max_width
        new_h = int(h * (new_w / w))
        im = im.resize((new_w, new_h))

    out = io.BytesIO()

    if ext in (".jpg", ".jpeg"):
        if im.mode not in ("RGB", "L"):
            im = im.convert("RGB")
        im.save(out, format="JPEG", quality=q_jpeg, optimize=True, progressive=True)
        return out.getvalue()

    if ext == ".png":
        im.save(out, format="PNG", optimize=True)
        return out.getvalue()

    if ext == ".webp":
        im.save(out, format="WEBP", quality=q_webp, method=6)
        return out.getvalue()

    return src_bytes


def download_to_tempfile(client: Minio, bucket: str, key: str, suffix: str) -> str:
    fd, path = tempfile.mkstemp(suffix=suffix)
    os.close(fd)

    resp = client.get_object(bucket, key)
    try:
        with open(path, "wb") as f:
            for chunk in resp.stream(1024 * 1024):
                f.write(chunk)
    finally:
        resp.close()
        resp.release_conn()

    return path


def ffmpeg_transcode(in_path: str, out_path: str, params: dict) -> None:
    v_max_w = int(params.get("max_width", VIDEO_MAX_WIDTH))
    v_crf = str(params.get("crf", VIDEO_CRF))
    v_preset = str(params.get("preset", VIDEO_PRESET))
    a_bitrate = str(params.get("audio_bitrate", AUDIO_BITRATE))

    scale_filter = f"scale='min(iw,{v_max_w})':-2"

    cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel", "error",

        "-fflags", "+igndts",
        "-i", in_path,

        "-map", "0:v:0",
        "-map", "0:a?",
        "-ignore_unknown",
        "-dn",
        "-sn",

        "-map_metadata", "-1",
        "-map_chapters", "-1",

        "-vf", scale_filter,
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", v_preset,
        "-crf", v_crf,

        "-c:a", "aac",
        "-b:a", a_bitrate,
        "-ac", "2",

        "-max_muxing_queue_size", "4096",
        "-r", "30",
        out_path
    ]

    r = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=3600)
    if r.returncode != 0:
        raise RuntimeError(f"ffmpeg_failed: {r.stderr.strip()[:1200]}")


def resolve_bucket_cfg(storage_id: str, bucket: str) -> dict | None:
    if not MANAGER_BASE_URL:
        return None
    return MANAGER_CACHE.get_bucket_cfg(storage_id, bucket)


def cfg_prefix_root(cfg: dict | None) -> str:
    return (cfg or {}).get("prefix_root") or PREFIX_ROOT


def cfg_prefix_work(cfg: dict | None) -> str:
    return (cfg or {}).get("prefix_work") or PREFIX_WORK


def cfg_min_size_kb(cfg: dict | None) -> int:
    return int((cfg or {}).get("min_size_kb") or MIN_SIZE_KB)


def cfg_video_max_mb(cfg: dict | None) -> int:
    return int((cfg or {}).get("video_max_mb") or VIDEO_MAX_MB)


def is_work_key(key: str, prefix_work: str) -> bool:
    return key.startswith(prefix_work)


def is_under_prefix(key: str, prefix: str) -> bool:
    return key.startswith(prefix)


def copy_to_work(client: Minio, bucket: str, key: str, prefix_root: str, prefix_work: str) -> str:
    rel = key[len(prefix_root):] if key.startswith(prefix_root) else key
    work_key = posixpath.join(prefix_work, rel)
    client.copy_object(bucket, work_key, CopySource(bucket, key))
    return work_key


def passes_prefix_rules(key: str, cfg: dict | None) -> bool:
    if not cfg:
        return True

    inc = cfg.get("include_prefixes") or []
    exc = cfg.get("exclude_prefixes") or []

    if inc and not any(key.startswith(p) for p in inc):
        return False
    if exc and any(key.startswith(p) for p in exc):
        return False
    return True


# =========================
# Core processing
# =========================

def process_one_key(client: Minio, bucket: str, key: str, cfg: dict | None, storage_id: str = DEFAULT_STORAGE_ID) -> tuple[bool, str, str]:
    if not key:
        return (False, "no_key", "other")

    prefix_root = cfg_prefix_root(cfg)
    prefix_work = cfg_prefix_work(cfg)

    if not is_under_prefix(key, prefix_root):
        return (False, "outside_prefix", "other")

    if is_work_key(key, prefix_work):
        return (False, "work_key", "other")

    ext = ext_of(key)
    if ext not in IMG_EXTS and ext not in VID_EXTS:
        return (False, "unsupported_ext", "other")

    # anti-loop
    if head_is_optimized(client, bucket, key):
        return (False, "already_optimized", "other")

    # tamanho
    try:
        sz = stat_size(client, bucket, key)
    except Exception as e:
        log(f"[SKIP] stat_failed {bucket}/{key} err={e}")
        return (False, "stat_failed", "other")

    min_size_kb = cfg_min_size_kb(cfg)
    if should_skip_by_size_bytes(sz, min_size_kb):
        return (False, f"too_small<{min_size_kb}KB", "other")

    # ========= IMAGENS =========
    if ext in IMG_EXTS:
        media = "image"
        t0 = time.time()
        INFLIGHT.labels(media).inc()
        try:
            log(f"[IMG] start {bucket}/{key}")

            try:
                resp = client.get_object(bucket, key)
                try:
                    src_bytes = resp.read()
                finally:
                    resp.close()
                    resp.release_conn()
            except Exception as e:
                log(f"[FAIL] download_failed {bucket}/{key} err={e}")
                return (False, "download_failed", media)

            # Validação: verifica se é realmente uma imagem válida antes de prosseguir
            try:
                with Image.open(io.BytesIO(src_bytes)) as tmp_img:
                    tmp_img.verify()
            except Exception as e:
                log(f"[SKIP] invalid_image_data {bucket}/{key} err={e}")
                # Marcamos como otimizado para não tentar de novo um arquivo "quebrado"
                try:
                    mark_optimized_server_side(client, bucket, key)
                except: pass
                return (False, "invalid_image_data", media)

            work_key = None
            try:
                work_key = copy_to_work(client, bucket, key, prefix_root, prefix_work)
                log(f"[IMG] copied_to_work {bucket}/{work_key}")
            except Exception as e:
                log(f"[WARN] copy_to_work_failed {bucket}/{key} err={e}")

            before_size = len(src_bytes)
            BYTES_BEFORE.labels(media).inc(before_size)

            img_params = (cfg or {}).get("image") or {}
            try:
                out_bytes = optimize_image_bytes(src_bytes, ext, img_params)
            except Exception as e:
                log(f"[FAIL] optimize_failed {bucket}/{key} err={e}")
                return (False, "optimize_failed", media)

            after_size = len(out_bytes)
            if after_size >= int(before_size * 0.98):
                log(f"[IMG] no_gain_keep_original {bucket}/{key} size={before_size}")
                OPT_NOGAIN.labels(media).inc()
                BYTES_AFTER.labels(media).inc(before_size)
                after_size = before_size # Consideramos igual
                try:
                    mark_optimized_server_side(client, bucket, key)
                except Exception as e:
                    log(f"[FAIL] mark_meta_failed {bucket}/{key} err={e}")
                    return (False, "mark_meta_failed", media)
            else:
                try:
                    put_with_meta_bytes(client, bucket, key, out_bytes, detect_content_type(ext))
                except Exception as e:
                    log(f"[FAIL] upload_failed {bucket}/{key} err={e}")
                    return (False, "upload_failed", media)

                BYTES_AFTER.labels(media).inc(after_size)
                log(f"[IMG] done {bucket}/{key} before={before_size} after={after_size}")

            # Log para o Banco de Dados
            log_optimization(storage_id, bucket, key, media, before_size, after_size)

            if work_key:
                delete_quiet(client, bucket, work_key)
                log(f"[IMG] cleaned_work {bucket}/{work_key}")

            return (True, "ok", media)

        finally:
            PROC_TIME.labels(media).observe(time.time() - t0)
            INFLIGHT.labels(media).dec()

    # ========= VÍDEOS =========
    if ext in VID_EXTS:
        media = "video"

        video_max_mb = cfg_video_max_mb(cfg)
        if should_skip_video_by_max_mb(sz, video_max_mb):
            return (False, f"video_too_big>{video_max_mb}MB", media)

        t0 = time.time()
        INFLIGHT.labels(media).inc()
        try:
            log(f"[VID] start {bucket}/{key}")

            work_key = None
            try:
                work_key = copy_to_work(client, bucket, key, prefix_root, prefix_work)
                log(f"[VID] copied_to_work {bucket}/{work_key}")
            except Exception as e:
                log(f"[WARN] copy_to_work_failed {bucket}/{key} err={e}")

            in_path = out_path = None
            try:
                in_path = download_to_tempfile(client, bucket, key, suffix=ext)
                out_path = tempfile.mktemp(suffix=".mp4")

                before_size = os.path.getsize(in_path)
                BYTES_BEFORE.labels(media).inc(before_size)

                video_params = (cfg or {}).get("video") or {}
                ffmpeg_transcode(in_path, out_path, video_params)

                after_size = os.path.getsize(out_path)

                if after_size >= int(before_size * 0.98):
                    log(f"[VID] no_gain_keep_original {bucket}/{key} size={before_size}")
                    OPT_NOGAIN.labels(media).inc()
                    BYTES_AFTER.labels(media).inc(before_size)
                    after_size = before_size
                    mark_optimized_server_side(client, bucket, key)
                else:
                    put_with_meta_file(client, bucket, key, out_path, "video/mp4")
                    BYTES_AFTER.labels(media).inc(after_size)
                    log(f"[VID] done {bucket}/{key} before={before_size} after={after_size}")

                # Log para o Banco de Dados
                log_optimization(storage_id, bucket, key, media, before_size, after_size)

                return (True, "ok", media)

            except Exception as e:
                log(f"[FAIL] video_failed {bucket}/{key} err={e}")
                
                # NOVO: Se o vídeo falhar no transcode (provavelmente arquivo corrompido ou formato incompatível),
                # marcamos como otimizado no servidor para não entrar em loop infinito de processamento.
                try:
                    log(f"[SKIP] marking_failed_video_as_optimized {bucket}/{key}")
                    mark_optimized_server_side(client, bucket, key)
                except Exception as meta_err:
                    log(f"[FAIL] mark_meta_failed_on_video_error {bucket}/{key} err={meta_err}")

                return (False, "video_failed", media)

            finally:
                if in_path and os.path.exists(in_path):
                    try:
                        os.remove(in_path)
                    except Exception:
                        pass
                if out_path and os.path.exists(out_path):
                    try:
                        os.remove(out_path)
                    except Exception:
                        pass

                if work_key:
                    delete_quiet(client, bucket, work_key)
                    log(f"[VID] cleaned_work {bucket}/{work_key}")

        finally:
            PROC_TIME.labels(media).observe(time.time() - t0)
            INFLIGHT.labels(media).dec()

    return (False, "unknown", "other")


# =========================
# FastAPI endpoints
# =========================

@app.get("/manager-status")
def manager_status():
    if not MANAGER_BASE_URL:
        return {"enabled": False, "note": "MANAGER_BASE_URL vazio (modo antigo)"}
    snap = MANAGER_CACHE.snapshot()
    return {"enabled": True, **snap}


@app.post("/minio-webhook")
async def minio_webhook(req: Request, storage_id: str = Query(default=DEFAULT_STORAGE_ID)):
    payload = await req.json()
    recs = payload.get("Records") or []
    if not recs:
        log(f"[SKIP] no_records payload_keys={list(payload.keys())}")
        OPT_EVENTS.labels("image", "skipped", "other").inc()
        OPT_EVENTS.labels("video", "skipped", "other").inc()
        return {"ok": True, "skipped": "no_records"}

    processed = 0
    skipped = 0
    failed = 0

    for r in recs:
        s3 = r.get("s3") or {}
        obj = s3.get("object") or {}

        raw_key = obj.get("key") or obj.get("name") or ""
        raw_key = str(raw_key)

        if not raw_key:
            log(f"[SKIP] no_key object_keys={list(obj.keys())}")
            skipped += 1
            OPT_EVENTS.labels("image", "skipped", "other").inc()
            OPT_EVENTS.labels("video", "skipped", "other").inc()
            continue

        # bucket do evento (corrigido)
        bkt = (s3.get("bucket") or {}).get("name") or (s3.get("bucket") or {}).get("bucketName") or ""
        bkt = str(bkt) or MINIO_BUCKET

        key = unquote_plus(raw_key).lstrip("/")
        area = detect_area(key)
        log(f"[EVT] storage={storage_id} bucket={bkt} key={key}")

        cfg = resolve_bucket_cfg(storage_id, bkt)
        if cfg is not None:
            if not bool(cfg.get("enabled", False)):
                log(f"[SKIP] optimizer_disabled storage={storage_id} bucket={bkt} key={key}")
                skipped += 1
                OPT_EVENTS.labels("image", "skipped", area).inc()
                OPT_EVENTS.labels("video", "skipped", area).inc()
                continue

            if not passes_prefix_rules(key, cfg):
                log(f"[SKIP] prefix_rules bucket={bkt} key={key}")
                skipped += 1
                OPT_EVENTS.labels("image", "skipped", area).inc()
                OPT_EVENTS.labels("video", "skipped", area).inc()
                continue

        client = client_for_storage(storage_id)

        try:
            ok, reason, media = await asyncio.to_thread(process_one_key, client, bkt, key, cfg, storage_id)     

            if ok:
                processed += 1
                if media in ("image", "video"):
                    OPT_EVENTS.labels(media, "processed", area).inc()
                else:
                    OPT_EVENTS.labels("image", "processed", area).inc()
                    OPT_EVENTS.labels("video", "processed", area).inc()
            else:
                skipped += 1
                log(f"[SKIP] {reason} {bkt}/{key}")
                if media in ("image", "video"):
                    OPT_EVENTS.labels(media, "skipped", area).inc()
                else:
                    OPT_EVENTS.labels("image", "skipped", area).inc()
                    OPT_EVENTS.labels("video", "skipped", area).inc()

                if media in ("image", "video") and reason.endswith("_failed"):
                    OPT_FAIL.labels(media, reason, area).inc()

        except Exception as e:
            failed += 1
            log(f"[FAIL] unexpected {bkt}/{key} err={e}")
            OPT_EVENTS.labels("image", "failed", area).inc()
            OPT_EVENTS.labels("video", "failed", area).inc()
            OPT_FAIL.labels("image", "unexpected", area).inc()
            OPT_FAIL.labels("video", "unexpected", area).inc()

    return {"ok": True, "processed": processed, "skipped": skipped, "failed": failed}


# Global batch state
_BATCH_RUNNING = False
_BATCH_STOP_REQUESTED = False
_BATCH_QUEUE = asyncio.Queue()

async def batch_worker():
    """Worker que processa a fila de batches sequencialmente."""
    global _BATCH_RUNNING, _BATCH_STOP_REQUESTED
    log("[BATCH-WORKER] Started")
    while True:
        # Pega a próxima tarefa da fila
        task = await _BATCH_QUEUE.get()
        
        storage_id = task.get("storage_id")
        bucket = task.get("bucket")
        prefix = task.get("prefix")
        limit = task.get("limit", 0)
        dry_run = task.get("dry_run", False)
        callback_url = task.get("callback_url")

        results = {
            "scanned": 0,
            "candidates": 0,
            "processed": 0,
            "skipped": 0,
            "failed": 0,
            "timestamp": str(time.time()),
            "stopped": False,
            "error": None
        }

        try:
            _BATCH_RUNNING = True
            _BATCH_STOP_REQUESTED = False

            client = client_for_storage(storage_id)
            target_bucket = bucket or MINIO_BUCKET
            cfg = resolve_bucket_cfg(storage_id, target_bucket)
            target_prefix = prefix if prefix is not None else cfg_prefix_root(cfg)
            prefix_work = cfg_prefix_work(cfg)

            log(f"[BATCH-TASK] Starting background scan for {storage_id}/{target_bucket}/{target_prefix}")
            
            sem = asyncio.Semaphore(MAX_CONCURRENCY)
            lock = asyncio.Lock()

            async def handle_key(k: str):
                async with sem:
                    if BATCH_SLEEP_MS > 0: await asyncio.sleep(BATCH_SLEEP_MS / 1000.0)
                    if dry_run: return
                    try:
                        ok, reason, media = await asyncio.to_thread(process_one_key, client, target_bucket, k, cfg, storage_id)
                        async with lock:
                            if ok: results["processed"] += 1
                            else: results["skipped"] += 1
                    except Exception as e:
                        log(f"[BATCH-TASK] Error processing {k}: {e}")
                        async with lock: results["failed"] += 1

            tasks = []
            objects = client.list_objects(target_bucket, prefix=target_prefix, recursive=True)
            for obj in objects:
                if _BATCH_STOP_REQUESTED:
                    log("[BATCH-TASK] Stop requested by user.")
                    results["stopped"] = True
                    break
                
                k = getattr(obj, "object_name", None)
                if not k: continue
                
                results["scanned"] += 1
                if results["scanned"] % 1000 == 0:
                    log(f"[BATCH-TASK] Progress: scanned={results['scanned']} candidates={results['candidates']} processed={results['processed']}")

                if k.startswith(prefix_work):
                    continue

                if cfg and not bool(cfg.get("enabled", False)):
                    log("[BATCH-TASK] Optimizer disabled for this bucket during scan.")
                    break
                    
                if cfg and not passes_prefix_rules(k, cfg): continue
                
                e = ext_of(k)
                if e not in IMG_EXTS and e not in VID_EXTS: continue
                
                results["candidates"] += 1
                tasks.append(asyncio.create_task(handle_key(k)))
                
                if limit > 0 and results["candidates"] >= limit: break
                
                if len(tasks) >= 200:
                    await asyncio.gather(*tasks)
                    tasks = []
            
            if tasks: await asyncio.gather(*tasks)
            
            log(f"[BATCH-TASK] Finished. S:{results['scanned']} C:{results['candidates']} P:{results['processed']} Sk:{results['skipped']} F:{results['failed']}")

        except Exception as e:
            log(f"[BATCH-TASK] CRITICAL ERROR: {e}")
            results["error"] = str(e)
        finally:
            if callback_url:
                try:
                    results["timestamp"] = str(time.time())
                    async with httpx.AsyncClient() as c:
                        await c.post(callback_url, json=results, timeout=15)
                    log(f"[BATCH-TASK] Callback with results sent to {callback_url}")
                except Exception as cb_err:
                    log(f"[BATCH-TASK] Callback FAILED: {cb_err}")

            _BATCH_RUNNING = False
            _BATCH_QUEUE.task_done()


@app.post("/batch/stop")
async def stop_batch():
    global _BATCH_STOP_REQUESTED
    if not _BATCH_RUNNING:
        return {"ok": False, "message": "No batch running"}
    _BATCH_STOP_REQUESTED = True
    return {"ok": True, "message": "Stop requested for current task"}

@app.post("/batch")
async def batch_optimize(
    storage_id: str = Query(default=DEFAULT_STORAGE_ID, description="ID do storage no Manager"),
    bucket: str = Query(default=None, description="Bucket (se omitido usa MINIO_BUCKET)"),
    prefix: str = Query(default=None, description="Prefixo (se omitido usa o root da config ou PREFIX_ROOT)"),
    limit: int = Query(default=0, description="0 = sem limite"),
    dry_run: bool = Query(default=False, description="Se true, só lista o que faria"),
    callback_url: str = Query(default=None, description="URL para notificar quando terminar"),
):
    """
    Adiciona uma tarefa de varredura à fila.
    """
    task = {
        "storage_id": storage_id,
        "bucket": bucket,
        "prefix": prefix,
        "limit": limit,
        "dry_run": dry_run,
        "callback_url": callback_url
    }
    await _BATCH_QUEUE.put(task)
    
    pos = _BATCH_QUEUE.qsize()
    return {"ok": True, "message": f"Task added to queue. Position: {pos}"}
