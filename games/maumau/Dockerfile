# Mau-Mau (Treffen-Spieltisch, 3D-Karten).
# Build-Kontext ist das Repo-Wurzelverzeichnis (wegen packages/), siehe docker-compose.yml.

# 1) Client bauen (Vite + TypeScript + Three.js) → games/maumau/static
FROM node:22-alpine AS client
WORKDIR /repo
COPY packages/boardgame-kit packages/boardgame-kit
COPY packages/tabletop packages/tabletop
COPY games/maumau/client/package.json games/maumau/client/package-lock.json games/maumau/client/
RUN cd games/maumau/client && npm ci --no-audit --no-fund
COPY games/maumau/client games/maumau/client
RUN cd games/maumau/client && npm run build

# 2) Server (gemeinsamer Spieltisch-Server + Mau-Mau-Regeln)
FROM python:3.11-slim
WORKDIR /app
COPY packages/tabletop-server/requirements.txt /app/packages/tabletop-server/
RUN pip install --no-cache-dir -r /app/packages/tabletop-server/requirements.txt
COPY packages/tabletop-server /app/packages/tabletop-server
COPY games/maumau/server /app/games/maumau/server
COPY --from=client /repo/games/maumau/static /app/games/maumau/static

EXPOSE 8098
ENV PORT=8098 \
    HOST=0.0.0.0 \
    TABLETOP_DB=/app/data/maumau.sqlite3

CMD ["python", "games/maumau/server/main.py"]
