FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copia requirements e instala dependências
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copia todos os arquivos Python e configuração do projeto
COPY . /app

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
