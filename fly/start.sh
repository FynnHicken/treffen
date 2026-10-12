#!/bin/sh
set -e

echo "🚀 Starting Treffen All-in-One on Fly.io..."

# 1. Start PartyHub Live WebSocket Server (port 3001)
cd /srv/party-server
PORT=3001 node server.js &

# 2. Start Monopoly 3D Server (port 8090)
cd /srv/monopoly
PORT=8090 HOST=127.0.0.1 /opt/venv-monopoly/bin/python server/main.py &

# 3. Start UNO / SunoS Server (port 8085)
cd /srv/uno
PORT=8085 node build/build.js &

# 4. Start Codenames Server (port 5000)
cd /srv/codenames
/opt/venv-codenames/bin/python -m codenames &

# 5. Start Skribbl Server (port 8081 so Nginx can listen on 8080)
cd /srv/skribbl
PORT=8081 ROOT_PATH=/skribbl CLIENTS_PER_IP_LIMIT=24 /srv/skribbl/scribblers &

echo "✅ All game backends started. Launching Nginx on port 8080..."
exec nginx -g "daemon off;"
