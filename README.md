# ☁️ Object Storage Manager

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![Node.js](https://img.shields.io/badge/node.js-v22+-6DA55F?logo=node.js&logoColor=white)
![React](https://img.shields.io/badge/react-v19+-61DAFB?logo=react&logoColor=black)
![Docker](https://img.shields.io/badge/docker-%230db7ed.svg?logo=docker&logoColor=white)
![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?logo=typescript&logoColor=white)

Uma plataforma centralizada e moderna para gerenciamento de múltiplos provedores de **Object Storage** compatíveis com a API S3 (MinIO, AWS S3, Cloudflare R2, DigitalOcean Spaces). 

Projetado para oferecer visibilidade granular sobre o consumo de dados e automação de políticas de limpeza (Lifecycle) em uma interface intuitiva e performática.

---

## ✨ Funcionalidades Principais

- **📦 Multi-Account Management:** Cadastre e gerencie múltiplas contas de storage simultaneamente.
- **🌳 Hierarchical Analytics:** Explore seus buckets através de uma árvore de pastas recursiva com cálculo em tempo real de tamanho e quantidade de objetos por nível.
- **🕒 Smart Lifecycle:** Configure regras de expiração de objetos diretamente pela interface, com atalhos baseados na análise de pastas.
- **🐳 Docker Native:** Ambiente totalmente conteinerizado com suporte a Hot Reload tanto no Frontend quanto no Backend.
- **🎨 Modern UI:** Interface responsiva inspirada em padrões SaaS (Stripe/Vercel) com foco em produtividade.

---

## 🏗️ Arquitetura Técnica

A aplicação utiliza uma estrutura desacoplada e escalável:

- **Frontend:** React 19 (Vite) + TypeScript + CSS Variables (Design System customizado).
- **Backend:** Node.js + Express + TypeScript.
- **Integração:** AWS SDK for JavaScript v3 (Modular).
- **Banco de Dados:** MySQL 8.0 para persistência de credenciais e configurações.
- **Infraestrutura:** Docker & Docker Compose para orquestração de serviços.

---

## 🚀 Como Iniciar

### Pré-requisitos
- Docker e Docker Compose instalados.

### Execução em Desenvolvimento
1. Clone este repositório:
   ```bash
   git clone https://github.com/seu-usuario/object-storage-manager.git
   cd object-storage-manager
   ```

2. Suba o ambiente completo:
   ```bash
   docker-compose up --build
   ```

3. Acesse a aplicação:
   - **Frontend:** [http://localhost:5173](http://localhost:5173)
   - **Backend API:** [http://localhost:3005](http://localhost:3005)

---

## 🛠️ Desenvolvimento e Manutenção

O ambiente Docker está configurado para refletir alterações em tempo real:
- **Hot Reload (Frontend):** Configurado com Polling para garantir compatibilidade entre SOs.
- **Auto-restart (Backend):** Utiliza `ts-node-dev` monitorando mudanças na pasta `src`.

### Estrutura de Pastas
```text
.
├── backend/           # API REST em TypeScript
│   ├── src/
│   │   ├── services/  # Lógica de integração S3 (AWS SDK)
│   │   ├── routes/    # Definição dos endpoints
│   │   └── db.ts      # Conexão e inicialização do banco
├── frontend/          # SPA em React
│   ├── src/
│   │   ├── App.tsx    # Lógica principal e navegação
│   │   └── App.css    # Design System e estilização
└── docker-compose.yml # Orquestração da stack (MySQL + API + Web)
```

---

## 📋 Roadmap de Funcionalidades

- [ ] Listagem e visualização de objetos individuais.
- [ ] Upload e Download de arquivos via interface.
- [ ] Gerenciamento de políticas de segurança (Bucket Policies).
- [ ] Integração com Microserviço de Otimização de Arquivos.
- [ ] Gráficos comparativos de uso histórico.

---

## 📄 Licença

Distribuído sob a licença MIT. Veja `LICENSE` para mais informações.

---
<p align="center">Desenvolvido com ❤️ para simplificar a gestão de dados em nuvem.</p>
"# object-storage-manager" 
"# object-storage-manager" 
