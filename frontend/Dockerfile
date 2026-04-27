FROM node:22-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

# Expõe a porta padrão do Vite
EXPOSE 5173

# O parâmetro --host é necessário para que o Vite aceite conexões de fora do container
CMD ["npm", "run", "dev", "--", "--host"]
