FROM node:22-alpine

WORKDIR /app

# Exakte Versionen aus package-lock.json
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

RUN npm run build

EXPOSE 8088

CMD ["npm", "run", "preview", "--", "--host"]
