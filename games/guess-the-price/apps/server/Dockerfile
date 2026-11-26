FROM node:22-alpine

# For prisma
RUN apk add --no-cache openssl

WORKDIR /app

# Exakte Versionen aus package-lock.json
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# Prisma-Client und TypeScript einmal beim Bauen, nicht bei jedem Start
RUN npx prisma generate && npm run build && chmod +x ./docker-entrypoint.sh

EXPOSE 3005

ENTRYPOINT ["./docker-entrypoint.sh"]
