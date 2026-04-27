FROM node:22-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

# Expõe a porta que o backend usa
EXPOSE 3005

# Comando para rodar em modo desenvolvimento
CMD ["npm", "run", "dev"]
