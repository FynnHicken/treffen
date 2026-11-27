#!/bin/sh
set -e

echo "🚀 Starting Treffen All-In-One services on Fly.io..."

# Gemeinsamer Ticket-Schlüssel für Hub, Monopoly und Mensch. Am besten per `fly secrets set` setzen;
# sonst pro Start zufällig (alle Dienste laufen in diesem einen Prozessbaum, Tickets leben nur 30 min).
if [ -z "$TREFFEN_TICKET_SECRET" ]; then
    TREFFEN_TICKET_SECRET=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
fi
export TREFFEN_TICKET_SECRET

# 1. Party Server (Node.js WebSocket on port 3001)
echo "Starting party-server..."
cd /app/party-server && PORT=3001 node server.js &

# 2. Skribbl (Go on port 8081)
if [ -f /app/skribbl/scribblers ]; then
    echo "Starting skribbl..."
    cd /app/skribbl && PORT=8081 ROOT_PATH=/skribbl ./scribblers &
fi

# 3. UNO (Node.js on port 8085)
if [ -f /app/uno/build/build.js ]; then
    echo "Starting uno..."
    cd /app/uno && PORT=8085 node build/build.js &
fi

# 4. Monopoly (Python on port 8090)
if [ -f /app/monopoly/server/main.py ]; then
    echo "Starting monopoly..."
    cd /app/monopoly && PORT=8090 HOST=0.0.0.0 python3 server/main.py &
fi

# 4b. Mensch ärgere dich nicht (Python on port 8095)
if [ -f /app/mensch/games/mensch/server/main.py ]; then
    echo "Starting mensch..."
    cd /app/mensch && PORT=8095 HOST=0.0.0.0 python3 games/mensch/server/main.py &
fi

# 4c. Schach (Python on port 8096)
if [ -f /app/schach/games/schach/server/main.py ]; then
    echo "Starting schach..."
    cd /app/schach && PORT=8096 HOST=0.0.0.0 python3 games/schach/server/main.py &
fi

# 5. Codenames (Python on port 5000)
if [ -d /app/codenames/codenames ]; then
    echo "Starting codenames..."
    cd /app/codenames && python3 -m codenames &
fi

# 6. Guess The Price (Node.js on port 3005)
if [ -d /app/gtp-server ]; then
    echo "Starting guess-the-price backend..."
    cd /app/gtp-server && PORT=3005 DATABASE_URL="file:/app/gtp-server/prisma/dev.db" node dist/app.js &
fi

# 7. Start Nginx in foreground on port 8080 (Fly.io target)
echo "Starting nginx reverse proxy on port 8080..."
exec nginx -g "daemon off;"
