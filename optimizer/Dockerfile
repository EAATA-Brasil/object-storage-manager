FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Adicionado 'requests' para o manager_cfg.py
RUN pip install --no-cache-dir \
    minio==7.2.7 \
    pillow==10.4.0 \
    python-multipart==0.0.9 \
    fastapi==0.112.0 \
    uvicorn==0.30.5 \
    prometheus_client==0.20.0 \
    requests==2.32.3

# Copia todos os arquivos Python e configuração do projeto
COPY . /app

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
