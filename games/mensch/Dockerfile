# Mensch ärgere dich nicht (Treffen-Spieltisch, 3D).
# Build-Kontext ist das Repo-Wurzelverzeichnis (wegen packages/), siehe docker-compose.yml.

# 1) Client bauen (Vite + TypeScript + Three.js) → games/mensch/static
FROM node:22-alpine AS client
WORKDIR /repo
COPY packages/boardgame-kit packages/boardgame-kit
COPY packages/tabletop packages/tabletop
COPY games/mensch/client/package.json games/mensch/client/package-lock.json games/mensch/client/
RUN cd games/mensch/client && npm ci --no-audit --no-fund
COPY games/mensch/client games/mensch/client
RUN cd games/mensch/client && npm run build

# 2) Server (gemeinsamer Spieltisch-Server + Mensch-Regeln)
FROM python:3.11-slim
WORKDIR /app
COPY packages/tabletop-server/requirements.txt /app/packages/tabletop-server/
RUN pip install --no-cache-dir -r /app/packages/tabletop-server/requirements.txt
COPY packages/tabletop-server /app/packages/tabletop-server
COPY games/mensch/server /app/games/mensch/server
COPY --from=client /repo/games/mensch/static /app/games/mensch/static

EXPOSE 8095
ENV PORT=8095 \
    HOST=0.0.0.0 \
    TABLETOP_DB=/app/data/mensch.sqlite3

CMD ["python", "games/mensch/server/main.py"]
