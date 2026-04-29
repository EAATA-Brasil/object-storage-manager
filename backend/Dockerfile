FROM node:22-alpine

WORKDIR /app

# Instala dependências necessárias para o MC
RUN apk add --no-cache curl

# Instala o MinIO Client (mc) com detecção automática de arquitetura
RUN ARCH=$(uname -m); \
    if [ "$ARCH" = "x86_64" ]; then MC_ARCH="amd64"; \
    elif [ "$ARCH" = "aarch64" ]; then MC_ARCH="arm64"; \
    else MC_ARCH="amd64"; fi; \
    curl -L "https://dl.min.io/client/mc/release/linux-$MC_ARCH/mc" -o /usr/local/bin/mc && \
    chmod +x /usr/local/bin/mc

COPY package*.json ./

RUN npm install

COPY . .

# Expõe a porta que o backend usa
EXPOSE 3005

# Comando para rodar em modo desenvolvimento
CMD ["npm", "run", "dev"]
