#!/bin/sh
# Aktiviert den HTTPS-Server nur, wenn passende Let's-Encrypt-Zertifikate
# gemountet sind. Läuft automatisch über /docker-entrypoint.d/ von nginx:alpine.
set -e

SSL_DOMAIN="${SSL_DOMAIN:-treffen.ddns.net}"
CERT_DIR="/etc/letsencrypt/live/${SSL_DOMAIN}"
TARGET="/etc/nginx/ssl-enabled/treffen-ssl.conf"

mkdir -p /etc/nginx/ssl-enabled
rm -f "$TARGET"

if [ -f "${CERT_DIR}/fullchain.pem" ] && [ -f "${CERT_DIR}/privkey.pem" ]; then
    sed "s/__SSL_DOMAIN__/${SSL_DOMAIN}/g" /etc/nginx/treffen-ssl.conf.template > "$TARGET"
    echo "40-enable-ssl: HTTPS aktiviert für ${SSL_DOMAIN}"
else
    echo "40-enable-ssl: keine Zertifikate unter ${CERT_DIR} – nur HTTP (Port 80)"
fi
