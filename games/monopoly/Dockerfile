# Build-Kontext ist das Repo-Wurzelverzeichnis (wegen packages/boardgame-kit), siehe docker-compose.yml.

# 1) Client bauen (Vite + TypeScript) → games/monopoly/static/dist
FROM node:22-alpine AS client
WORKDIR /repo
COPY packages/boardgame-kit packages/boardgame-kit
COPY games/monopoly/client/package.json games/monopoly/client/package-lock.json games/monopoly/client/
RUN cd games/monopoly/client && npm ci --no-audit --no-fund
COPY games/monopoly/client games/monopoly/client
RUN cd games/monopoly/client && npm run build

# 2) Server
FROM python:3.11-slim
WORKDIR /app
COPY games/monopoly/requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt
COPY games/monopoly/server /app/server
COPY games/monopoly/static /app/static
COPY --from=client /repo/games/monopoly/static/dist /app/static/dist

EXPOSE 8090
ENV PORT=8090
ENV HOST=0.0.0.0

CMD ["python", "server/main.py"]
