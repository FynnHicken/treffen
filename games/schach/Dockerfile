# Schach (Treffen-Spieltisch, 3D).
# Build-Kontext ist das Repo-Wurzelverzeichnis (wegen packages/), siehe docker-compose.yml.

# 1) Client bauen (Vite + TypeScript + Three.js) → games/schach/static
FROM node:22-alpine AS client
WORKDIR /repo
COPY packages/boardgame-kit packages/boardgame-kit
COPY packages/tabletop packages/tabletop
COPY games/schach/client/package.json games/schach/client/package-lock.json games/schach/client/
RUN cd games/schach/client && npm ci --no-audit --no-fund
COPY games/schach/client games/schach/client
RUN cd games/schach/client && npm run build

# 2) Server (gemeinsamer Spieltisch-Server + Schach-Regeln)
FROM python:3.11-slim
WORKDIR /app
COPY packages/tabletop-server/requirements.txt /app/packages/tabletop-server/
RUN pip install --no-cache-dir -r /app/packages/tabletop-server/requirements.txt
COPY packages/tabletop-server /app/packages/tabletop-server
COPY games/schach/server /app/games/schach/server
COPY --from=client /repo/games/schach/static /app/games/schach/static

EXPOSE 8096
ENV PORT=8096 \
    HOST=0.0.0.0 \
    TABLETOP_DB=/app/data/schach.sqlite3

CMD ["python", "games/schach/server/main.py"]
