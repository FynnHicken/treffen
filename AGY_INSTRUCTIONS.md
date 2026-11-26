# 🤖 Antigravity (AGY) Mac Mini M4 Setup & Deployment Guide

> **Zweck dieses Dokuments:**  
> Dieses Dokument dient als direkte Arbeitsanweisung für eine Antigravity-Instanz (oder den Administrator) auf einem Apple Silicon Mac mini (M4), um das gesamte **Treffen**-Ökosystem in Betrieb zu nehmen, an eine No-IP Dynamic DNS Domain anzubinden und dauerhaft bereitzustellen.

---

## 1. Systemübersicht & Architektur

PartyHub ist eine integrierte Spieleabend-Plattform, die mehrere Open-Source Multiplayer-Spiele synchron über ein gemeinsames Web-Portal steuert.

| Service | Sprache / Stack | Port (Host) | Beschreibung |
| :--- | :--- | :--- | :--- |
| **party-server** | Node.js / WebSocket | `3001` | Live-Synchronisation der Lobby (Räume, Host, Abstimmung) |
| **partyhub** | HTML5 / JS / Nginx | `8000` (HTTP), `3443` (HTTPS, nur mit Zertifikat) | Hauptportal, Spieler-Lobby, Couch-Präsenz, synchroner Start |
| **skribbl** | Go (Scribble.rs) | `8080` | Zeichnen & Raten (komplett auf Deutsch übersetzt) |
| **uno** | Node.js (SunoS) | `8086` | 8-Spieler UNO mit Raum-Synchronisation |
| **codenames** | Python 3.13 / Flask | `5005` | Geheimdienst-Worträtsel mit Team-Auswahl |
| **gtp-client** | React / Vite / Tailwind | `8088` | Guess The Price - Frontend (EUR-Preise) |
| **gtp-server** | Express / Prisma (SQLite) / WS | `3005` | Guess The Price - Backend & WebSocket Engine, Produktkatalog wird bei jedem Start neu geseedet |
| **monopoly** | Python / FastAPI / Three.js | `8090` | Monopoly 3D |
| **mensch** | Python / FastAPI / Three.js | `8095` | Mensch ärgere dich nicht (3D-Spieltisch) |
| *(caddy)* | Caddy 2 | `80`, `443` | *Optional:* SSL Reverse-Proxy für No-IP Domain |

---

## 2. Voraussetzungen auf macOS (Mac mini M4)

1. **Homebrew & Container-Engine:**
   Auf dem Mac mini wird eine Container-Laufzeitumgebung benötigt. Empfohlen ist **Docker Desktop**, **OrbStack** (extrem schnell auf Apple Silicon) oder **Podman**:
   ```bash
   # Option A: OrbStack (Empfohlen für Apple Silicon, extrem ressourcenschonend)
   brew install --cask orbstack

   # Option B: Docker Desktop
   brew install --cask docker

   # Option C: Podman
   brew install podman podman-compose
   podman machine init
   podman machine start
   ```

2. **Git Clone (Empfohlen) oder ZIP entpacken:**
   ```bash
   # Option A: Per Git (Empfohlen für automatische Updates mit git pull)
   git clone <REPO_URL> treffen
   cd treffen

   # Option B: Per ZIP
   unzip partyhub-mac.zip
   cd partyhub-bundle
   ```

---

## 3. Direkter Start (Lokaler Modus / WLAN)

Für den lokalen Spieleabend im Heimnetzwerk genügt ein einziger Befehl:

```bash
# Mit mitgeliefertem Skript:
./start.sh

# Oder direkt via Docker/Podman:
docker compose up -d --build
# bzw.
podman compose up -d --build
```

### Automatische Initialisierung:
- Alle Images werden nativ für Apple Silicon (`linux/arm64`) gebaut bzw. gestartet.
- `gtp-server` führt bei jedem Start `npx prisma db push` und `npm run seed` aus, wodurch der Produktkatalog (Elektronik, Lebensmittel, Lifestyle, Autos) in einer SQLite-Datei im Container angelegt wird.
- `partyhub` aktiviert HTTPS auf Port 443 nur, wenn unter `./letsencrypt/live/<SSL_DOMAIN>/` Zertifikate liegen (Standard: `treffen.ddns.net`). Ohne Zertifikate läuft nur HTTP – im Caddy-Modus ist das so gewollt.

---

## 4. Bereitstellung über das Internet (No-IP & HTTPS)

Wenn Freunde von außerhalb über deine No-IP DDNS Domain mitspielen möchten:

### Schritt A: Router-Portweiterleitung (z. B. FRITZ!Box)
Leite im Router lediglich **zwei Ports** an die lokale IP-Adresse deines Mac mini weiter:
- **Port 80 (HTTP)** → Mac mini Port 80
- **Port 443 (HTTPS)** → Mac mini Port 443

*(Hinweis: Durch den Caddy Reverse Proxy müssen die internen Spiele-Ports 8000, 8080, 8086 etc. **nicht** im Router freigegeben werden!)*

### Schritt B: Start mit Caddy Reverse Proxy & automatischem SSL
Setze deine No-IP Domain und starte das Caddy-Overlay:

```bash
export MY_DOMAIN="deine-domain.ddns.net"
./start.sh

# Oder via compose:
MY_DOMAIN="deine-domain.ddns.net" docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d
```

Caddy generiert automatisch ein gültiges, kostenloses Let's Encrypt SSL-Zertifikat für deine No-IP-Domain.

---

## 5. Befehle für Antigravity zur Diagnose & Steuerung

Wenn Antigravity auf dem Mac mini Anweisungen ausführt, können folgende Befehle genutzt werden:

```bash
# Status aller Container prüfen
docker compose ps
# bzw.
podman compose ps

# Logs eines bestimmten Spiels ansehen
docker compose logs -f skribbl
docker compose logs -f gtp-server
docker compose logs -f codenames

# PartyHub komplett stoppen
./stop.sh
# bzw.
docker compose down
```

---

## 6. Wichtige Datei-Referenzen im Bundle

- `docker-compose.yml`: Zentrale Definition aller Container, Netzwerke und Volumes.
- `party-hub/app.js`: Client-Logik des Hubs mit Raumcodes (`?room=...`), synchronem Countdown und Einbettung.
- `games/guess-the-price/apps/server/src/seed/seed.data.ts`: Produktkatalog für das Preisschätz-Spiel (kann jederzeit um weitere Artikel erweitert werden).
- `Caddyfile`: Konfiguration des SSL-Proxies für No-IP.
