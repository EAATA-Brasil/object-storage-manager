import os
import time
import threading
from typing import Any, Dict, Optional

import requests


MANAGER_BASE_URL = os.getenv("MANAGER_BASE_URL", "").rstrip("/")
MANAGER_TOKEN = os.getenv("MANAGER_TOKEN", "")
MANAGER_POLL_SECONDS = int(os.getenv("MANAGER_POLL_SECONDS", "60"))

DEFAULT_STORAGE_ID = os.getenv("DEFAULT_STORAGE_ID", "minio-prod")


def _headers() -> Dict[str, str]:
    if not MANAGER_TOKEN:
        return {}
    return {"Authorization": f"Bearer {MANAGER_TOKEN}"}


class ManagerCache:
    """
    Guarda o 'desired state' vindo do Manager:
    - storages: storage_id -> {endpoint, access_key, secret_key, ...}
    - buckets: (storage_id, bucket) -> {enabled, include_prefixes, exclude_prefixes, image, video, prefix_root, prefix_work ...}
    """

    def __init__(self):
        self._lock = threading.RLock()
        self.storages: Dict[str, Dict[str, Any]] = {}
        self.buckets: Dict[tuple[str, str], Dict[str, Any]] = {}
        self.last_ok_ts: Optional[float] = None
        self.last_err: Optional[str] = None

    def set_payload(self, payload: Dict[str, Any]) -> None:
        storages: Dict[str, Dict[str, Any]] = {}
        for s in payload.get("storages", []) or []:
            if "id" in s:
                storages[str(s["id"])] = dict(s)

        buckets: Dict[tuple[str, str], Dict[str, Any]] = {}
        for b in payload.get("buckets", []) or []:
            sid = str(b.get("storage_id") or "")
            bname = str(b.get("bucket") or "")
            if sid and bname:
                buckets[(sid, bname)] = dict(b)

        with self._lock:
            self.storages = storages
            self.buckets = buckets
            self.last_ok_ts = time.time()
            self.last_err = None

    def set_error(self, err: str) -> None:
        with self._lock:
            self.last_err = err

    def get_storage(self, storage_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            return self.storages.get(storage_id)

    def get_bucket_cfg(self, storage_id: str, bucket: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            return self.buckets.get((storage_id, bucket))

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "storages_count": len(self.storages),
                "buckets_count": len(self.buckets),
                "last_ok_ts": self.last_ok_ts,
                "last_err": self.last_err,
            }


CACHE = ManagerCache()


def fetch_manager_config() -> Dict[str, Any]:
    if not MANAGER_BASE_URL:
        raise RuntimeError("MANAGER_BASE_URL não configurado")

    url = f"{MANAGER_BASE_URL}/api/storage/optimizer/config"
    r = requests.get(url, headers=_headers(), timeout=15)
    r.raise_for_status()
    return r.json()


def start_poll(log_fn) -> None:
    """
    Roda em thread daemon e atualiza cache continuamente.
    """

    def loop():
        while True:
            try:
                payload = fetch_manager_config()
                CACHE.set_payload(payload)
                log_fn(
                    f"[MANAGER] config OK storages={len(payload.get('storages',[]) or [])} "
                    f"buckets={len(payload.get('buckets',[]) or [])}"
                )
            except Exception as e:
                CACHE.set_error(str(e))
                log_fn(f"[MANAGER] config FAIL err={e}")
            time.sleep(max(10, MANAGER_POLL_SECONDS))

    t = threading.Thread(target=loop, daemon=True)
    t.start()