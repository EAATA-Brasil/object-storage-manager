#!/bin/sh

echo "Aguardando MinIO em $MINIO_ENDPOINT..."
# Tenta conectar no MinIO até ter sucesso
until /usr/bin/mc alias set myminio "$MINIO_ENDPOINT" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" > /dev/null 2>&1; do
  echo "MinIO ainda não está pronto... tentando novamente em 2s"
  sleep 2
done

echo "MinIO conectado! Configurando bucket 'teste' como público..."
/usr/bin/mc anonymous set public myminio/teste || echo "Aviso: Não foi possível definir bucket 'teste' como público (pode não existir ainda)."

echo "Configurando Webhook do Optimizer..."
# Configura o Webhook notify_webhook:1
# Usamos o nome do serviço 'optimizer' da rede Docker
/usr/bin/mc admin config set myminio notify_webhook:1 endpoint="$WEBHOOK_URL" queue_limit="0"

echo "Reiniciando MinIO para aplicar configurações..."
/usr/bin/mc admin service restart myminio

echo "Configuração concluída com sucesso!"
