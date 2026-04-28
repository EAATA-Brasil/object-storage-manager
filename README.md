# ☁️ Object Storage Manager

O **Object Storage Manager** é uma interface administrativa completa e moderna para gerenciamento de provedores S3 (MinIO, AWS, etc.), focada em automação, otimização de custos e portabilidade multi-ambiente.

## 🚀 Principais Funcionalidades

### 🎨 Interface Clássica & Responsiva
- **Layout Profissional:** Barra lateral fixa para navegação rápida em desktop.
- **Mobile First:** Navbar superior em formato de "pílulas" e tabelas que se transformam em cards para eliminar o scroll lateral em smartphones.
- **Experiência Fluida:** Feedback visual instantâneo para todas as operações.

### ⚙️ Optimizer (Otimização de Custos e Espaço)
- **Otimização Automática:** Redução de tamanho de imagens e vídeos via webhooks do MinIO.
- **Varrer Agora (Batch):** Varredura manual de pastas existentes para otimização em massa.
- **Sincronização Inteligente Multi-Ambiente:**
    - As configurações são salvas diretamente no S3 (`.manager-config/optimizer.json`).
    - **Auto-Discovery:** Adicione sua conta em qualquer novo Manager e ele importará as regras automaticamente.
    - **Identidade de Instância:** Cada instalação possui um ID Único, permitindo alternar qual servidor (VPS ou Local) processa os eventos do bucket com um clique em "Sincronizar com este ambiente".
- **Estatísticas Reais:** Acompanhamento de quantos arquivos foram processados e quanto espaço foi economizado.

### 🔄 Replicação e Espelhamento
- **Site-Level:** Replicação completa entre storages diferentes.
- **Bucket-Level:** Gerenciamento granular de regras de replicação para buckets específicos, com controle de prioridade e destino.

### 🔒 Políticas de Acesso Granulares
- **Gerenciamento de Pastas:** Defina políticas (Privado, Público ou Customizado) para pastas específicas sem sair do painel.
- **Editor de Permissões:** Interface visual para definir permissões de Download, Upload, Deleção e Listagem para usuários anônimos.

### 🕒 Lifecycle (Ciclo de Vida)
- **Limpeza Automática:** Configure regras de expiração para arquivos temporários ou backups antigos.
- **Integração com Optimizer:** O sistema pode gerenciar automaticamente a limpeza de 24h para pastas de trabalho do Optimizer.

## 🛠️ Tecnologias
- **Frontend:** React + TypeScript + Vite.
- **Backend:** Node.js + Express + MySQL.
- **Serviço de Otimização:** Python + FastAPI + FFmpeg + Pillow.
- **Infraestrutura:** Docker & Docker Compose.

## 📦 Como Iniciar

1.  **Clone o repositório:**
    ```bash
    git clone https://github.com/seu-usuario/object-storage-manager.git
    ```

2.  **Configure as variáveis de ambiente:**
    - Edite o arquivo `.env` na pasta `backend/` e `optimizer/` conforme os exemplos.

3.  **Inicie com Docker Compose:**
    ```bash
    docker-compose up -d --build
    ```

4.  **Acesse o painel:**
    - O frontend estará disponível em `http://localhost:5173` ou na porta configurada.

## 🔒 Segurança
O sistema utiliza criptografia para chaves de acesso e segue as melhores práticas de comunicação direta com a API do S3, garantindo que suas credenciais nunca sejam expostas.

---
Desenvolvido para simplificar a gestão de dados em nuvem com inteligência e performance.
