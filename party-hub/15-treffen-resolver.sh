#!/bin/sh
# Schreibt den DNS-Resolver für Nginx aus /etc/resolv.conf des Containers.
# Vorher standen feste Adressen (127.0.0.11, 10.89.0.1, 10.89.1.1) in nginx.conf: Nicht existierende
# Resolver ließen Anfragen nach jedem Cache-Ablauf (10 s) bis zu 5 s hängen.
set -e
OUT=/etc/nginx/treffen-resolver.conf
servers=$(awk '/^nameserver/ { ip=$2; if (ip ~ /:/) ip="[" ip "]"; printf "%s ", ip }' /etc/resolv.conf 2>/dev/null)
[ -n "$servers" ] || servers="127.0.0.11"
echo "resolver ${servers}valid=10s ipv6=off;" > "$OUT"
echo "treffen: $(cat "$OUT")"
