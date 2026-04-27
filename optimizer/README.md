# EAATA MinIO Optimizer (single-file)

Este serviço é um **microserviço FastAPI em um único arquivo (`main.py`)** que otimiza **imagens e vídeos** armazenados no **MinIO**, com:
- **Anti-loop** via metadata (`optimized=1`)
- **Work prefix** (cópia temporária em `ocorrencias/otimizando/`)
- **Batch** por varredura de prefixo
- **Webhook do MinIO** (S3 events)
- **Métricas Prometheus** em `/metrics`

---

## O que ele faz (resumo)

1. Recebe evento do MinIO em `POST /minio-webhook` **ou** você roda `POST /batch`
2. Valida prefixo, extensão, tamanho e anti-loop (metadata)
3. Opcionalmente copia para a pasta de trabalho (`PREFIX_WORK`) para “travar”/registrar processamento
4. Baixa o objeto
5. Otimiza:
   - **Imagem:** Pillow (resize + compress)
   - **Vídeo:** `ffmpeg` (transcode p/ MP4 + scale + CRF)
6. Sobe o arquivo otimizado no **mesmo key original**, marcando metadata `optimized=1`
7. Remove o “work file”
8. Publica métricas no Prometheus

---

## Arquivo único

- `main.py` contém tudo:
  - FastAPI app
  - Cliente MinIO
  - Otimização (imagem/vídeo)
  - Endpoints (`/minio-webhook`, `/batch`, `/metrics`)
  - Métricas Prometheus

---

## Variáveis de ambiente

### Prefixos
- `PREFIX_ROOT` (default: `ocorrencias/`)  
  Apenas objetos **dentro desse prefixo** serão processados.
- `PREFIX_WORK` (default: `ocorrencias/otimizando/`)  
  Pasta de trabalho usada para cópia temporária (anti-concorrência/registro).

### Imagem
- `IMG_MAX_WIDTH` (default: `1600`)
- `IMG_QUALITY_JPEG` (default: `78`)
- `IMG_QUALITY_WEBP` (default: `72`)

### Vídeo
- `VIDEO_MAX_WIDTH` (default: `1280`)
- `VIDEO_CRF` (default: `28`)
- `VIDEO_PRESET` (default: `veryfast`)
- `AUDIO_BITRATE` (default: `96k`)

### Batch / performance / filtros
- `MAX_CONCURRENCY` (default: `1`) *(1 = mais seguro)*
- `BATCH_SLEEP_MS` (default: `0`) *(ex: 200 para aliviar carga)*
- `MIN_SIZE_KB` (default: `0`) *(ex: 50 ignora < 50KB)*
- `VIDEO_MAX_MB` (default: `0`) *(ex: 50 ignora > 50MB; 0=sem limite)*

### Anti-loop via metadata
- Chave e valor usados:
  - `optimized=1` (interno no código: `META_OPT_KEY="optimized"`, `META_OPT_VAL="1"`)

---

## Extensões suportadas

### Imagem
- `.jpg`, `.jpeg`, `.png`, `.webp`

### Vídeo
- `.mp4`, `.mov`, `.m4v`, `.avi`, `.mkv`, `.webm`

---

## Endpoints

### `GET /metrics`
Retorna métricas Prometheus.

Métricas principais:
- `optimizer_events_total{type,result,area}`
- `optimizer_fail_total{type,reason,area}`
- `optimizer_nogain_total{type}`
- `optimizer_bytes_before_total{type}`
- `optimizer_bytes_after_total{type}`
- `optimizer_inflight{type}`
- `optimizer_process_seconds_bucket{type}` (histogram)

### `POST /minio-webhook`
Recebe eventos S3/MinIO.

O serviço espera payload com `Records[]` e busca o key em:
- `Records[i].s3.object.key` **ou**
- `Records[i].s3.object.name`

Ele faz `unquote_plus` do key e remove `/` inicial.

Resposta:
```json
{ "ok": true, "processed": 10, "skipped": 3, "failed": 1 }
```

### `POST /batch`
Varre objetos no MinIO e processa em paralelo controlado.

Query params:
- `prefix` (default: `PREFIX_ROOT`)
- `limit` (default: `0` = sem limite)
- `dry_run` (default: `false`) — se `true`, só lista o que faria

Resposta:
```json
{
  "ok": true,
  "prefix": "ocorrencias/",
  "dry_run": false,
  "candidates": 1200,
  "processed": 800,
  "skipped": 390,
  "failed": 10,
  "max_concurrency": 1
}
```

---

## Regras de skip (muito importante)

Um objeto **não será processado** se:
- Está fora de `PREFIX_ROOT`
- Está dentro de `PREFIX_WORK` (work key)
- Extensão não suportada
- Já tem metadata `optimized=1`
- Tamanho < `MIN_SIZE_KB` (se configurado)
- Vídeo maior que `VIDEO_MAX_MB` (se configurado)

Os motivos aparecem no log e também são contados nas métricas.

---

## Lógica de “no gain” (economia insuficiente)

Depois de otimizar:
- Se o arquivo otimizado ficar **>= 98%** do tamanho original:
  - **Mantém o original**
  - Marca apenas metadata `optimized=1` (server-side copy com `REPLACE`)
  - Incrementa `optimizer_nogain_total`

Isso evita reprocessar arquivos que “não valem a pena”.

---

## Otimização de imagem (Pillow)

- Resize se `width > IMG_MAX_WIDTH`
- JPEG:
  - converte para RGB se necessário
  - `quality=IMG_QUALITY_JPEG`, `optimize=True`, `progressive=True`
- PNG:
  - `optimize=True`
- WEBP:
  - `quality=IMG_QUALITY_WEBP`, `method=6`

---

## Otimização de vídeo (ffmpeg)

A saída é sempre **MP4** (mesmo que a entrada seja MOV/MKV/etc).

O comando é “blindado” para evitar erros de muxer (“Not yet implemented…”), com:
- `-map 0:v:0` e `-map 0:a:0?`
- remove data/subtitle
- remove metadata e chapters
- `-avoid_negative_ts make_zero`
- `-fflags +genpts`
- `-movflags +faststart`
- `scale=min(iw, VIDEO_MAX_WIDTH)`

---

## Como rodar

### Local (exemplo)
```bash
export MINIO_ENDPOINT="minio:9005"
export MINIO_ACCESS_KEY="admin"
export MINIO_SECRET_KEY="admin123456"
export MINIO_SECURE="false"
export MINIO_BUCKET="eaata-prod"

uvicorn main:app --host 0.0.0.0 --port 8000
```

## 🔁 BATCH MODE — Documentação Completa

O endpoint `/batch` permite varrer o bucket inteiro (ou parte dele) e processar arquivos manualmente.

Ele é ideal para:

- Primeira otimização em massa
- Reprocessamento controlado
- Correções após ajustes de qualidade
- Manutenção periódica

---

## Endpoint

POST /batch

### Query Params

| Parâmetro | Padrão | O que faz |
|------------|--------|------------|
| `prefix` | PREFIX_ROOT | Define qual pasta será varrida |
| `limit` | 0 | Limita quantidade de arquivos (0 = ilimitado) |
| `dry_run` | false | Simula execução sem modificar nada |

---

# 🧪 O que é `dry_run`?

Quando `dry_run=true`:

- O sistema **lista os arquivos que seriam processados**
- NÃO baixa arquivos
- NÃO executa otimização
- NÃO altera metadata
- NÃO altera nada no MinIO

Ele serve para:

- Verificar impacto antes de rodar em produção
- Validar filtros (prefix, tamanho, extensões)
- Estimar volume de processamento
- Auditoria preventiva

Exemplo:

curl -X POST "http://localhost:8000/batch?prefix=ocorrencias/&dry_run=true"

Saída típica:

{
  "ok": true,
  "dry_run": true,
  "candidates": 1200,
  "processed": 0,
  "skipped": 0,
  "failed": 0
}

---

## 🚀 Modos de Batch Possíveis

## 1️⃣ Batch Completo (produção)

Processa tudo dentro do prefixo:

curl -X POST "http://localhost:8000/batch?prefix=ocorrencias/"

Uso típico:
- Primeira vez rodando optimizer
- Otimização total do bucket

---

## 2️⃣ Batch Limitado (teste controlado)

Processa apenas N arquivos:

curl -X POST "http://localhost:8000/batch?prefix=ocorrencias/&limit=100"

Uso típico:
- Testar comportamento
- Validar performance
- Evitar sobrecarga

---

## 3️⃣ Batch Simulado (dry-run)

Simula execução:

curl -X POST "http://localhost:8000/batch?prefix=ocorrencias/&dry_run=true"

Uso típico:
- Auditoria
- Planejamento de carga
- Conferência antes de executar

---

## 4️⃣ Batch Parcial por Subpasta

Processa apenas uma área específica:

curl -X POST "http://localhost:8000/batch?prefix=ocorrencias/chat/"

ou

curl -X POST "http://localhost:8000/batch?prefix=ocorrencias/painel/"

Uso típico:
- Otimizar apenas uploads do chat
- Otimizar apenas arquivos do painel

---

## 5️⃣ Batch Controlado com Limite + Delay

Com variáveis de ambiente:

MAX_CONCURRENCY=1  
BATCH_SLEEP_MS=200  

Isso permite:

- Processar devagar
- Reduzir pressão no MinIO
- Evitar pico de CPU

---

## 📊 Resposta do Batch

Exemplo real:

{
  "ok": true,
  "prefix": "ocorrencias/",
  "dry_run": false,
  "candidates": 1200,
  "processed": 800,
  "skipped": 390,
  "failed": 10,
  "max_concurrency": 1
}

### Campos:

- `candidates` → arquivos elegíveis encontrados
- `processed` → realmente otimizados
- `skipped` → ignorados (já otimizados, tamanho, extensão, etc.)
- `failed` → erro real de processamento
- `max_concurrency` → paralelismo ativo

---

# ⚠️ Recomendações Operacionais

Produção segura:

MAX_CONCURRENCY=1

Se bucket grande:

1. Rode primeiro dry_run
2. Depois rode com limit=100
3. Depois rode completo

Isso evita surpresas.

---

### Webhook (MinIO → serviço)
Configure o MinIO para enviar eventos (PUT/POST) para:
- `http://<optimizer-host>:8000/minio-webhook`

---

## Observabilidade (Prometheus)

Aponte o Prometheus para o endpoint `/metrics` do serviço, por exemplo:
```yaml
- job_name: optimizer
  static_configs:
    - targets: ['ocorrencias-optimizer:8000']
```

---

## Notas operacionais

- `MAX_CONCURRENCY=1` é o modo mais seguro (menos pressão em CPU/IO/MinIO).
- `BATCH_SLEEP_MS` ajuda quando você quer rodar batch sem “socar” o storage.
- O work prefix (`PREFIX_WORK`) ajuda a rastrear o que está em processamento e evita loop com o próprio prefixo.

