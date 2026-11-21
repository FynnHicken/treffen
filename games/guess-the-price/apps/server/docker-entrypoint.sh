#!/bin/sh
set -e

echo "=== Guess The Price Backend Initialization ==="

# SQLite: Schema anlegen/aktualisieren (kein Migrations-Verlauf nötig,
# der Seed löscht und befüllt den Produktkatalog bei jedem Start neu)
echo "Applying database schema..."
npx prisma db push --skip-generate

echo "Seeding product catalog..."
npm run seed

echo "Starting Guess The Price backend on port ${PORT:-3005}..."
exec npm run start
