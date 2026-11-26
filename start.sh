#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

echo "=== Starte PartyHub & alle Spiele ==="

# Tool-Erkennung (Docker oder Podman)
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    COMPOSE="docker compose"
elif command -v podman-compose >/dev/null 2>&1; then
    COMPOSE="podman-compose"
elif command -v podman >/dev/null 2>&1 && podman compose version >/dev/null 2>&1; then
    COMPOSE="podman compose"
else
    echo "FEHLER: Weder 'docker compose' noch 'podman compose' gefunden!"
    echo "Bitte installiere Docker Desktop, OrbStack oder Podman auf deinem System."
    exit 1
fi

echo "Verwende: $COMPOSE"

# Gemeinsamer Schlüssel für Spiel-Tickets (Hub → Monopoly, Mensch). Einmal erzeugen, dann in .env behalten.
if ! grep -qs '^TREFFEN_TICKET_SECRET=.' .env; then
    echo "Erzeuge TREFFEN_TICKET_SECRET in .env ..."
    echo "TREFFEN_TICKET_SECRET=$(openssl rand -hex 32)" >> .env
    chmod 600 .env
fi

if [ -n "$MY_DOMAIN" ] && [ "$MY_DOMAIN" != "localhost" ]; then
    echo "No-IP Domain erkannt: $MY_DOMAIN (Starte mit Caddy HTTPS Reverse-Proxy)"
    $COMPOSE -f docker-compose.yml -f docker-compose.caddy.yml up -d --build
else
    echo "Starte im lokalen Modus (Portal auf Port 8000)..."
    $COMPOSE up -d --build
fi

echo ""
echo "=========================================================="
echo "🎉 Treffen läuft erfolgreich!"
echo "=========================================================="
echo "• Treffen Portal:    http://localhost:8000"
echo "  (alle Spiele laufen darüber: /skribbl/ /uno/ /codenames/ /price-guess/ /monopoly/ /mensch/)"
echo "• Direkt – skribbl:   http://localhost:8080/skribbl/"
echo "• Direkt – UNO:       http://localhost:8086"
echo "• Direkt – Codenames: http://localhost:5005"
echo "• Direkt – GTP:       http://localhost:8088/price-guess/"
echo "• Direkt – Monopoly:  http://localhost:8090"
echo "• Direkt – Mensch:    http://localhost:8095"
if [ -n "$MY_DOMAIN" ] && [ "$MY_DOMAIN" != "localhost" ]; then
    echo "• Öffentliche URL:   https://$MY_DOMAIN"
fi
echo "=========================================================="
