"""Identität und Hub-Tickets für Monopoly.

1. Client-Secret: Jeder Browser schickt als erste WebSocket-Nachricht `AUTH` mit einem
   zufälligen Secret. Der Server merkt sich pro Raum einen Hash davon und bindet die
   Spieler-ID daran. Wer nur die (im Spielstand sichtbare) ID kennt, kann sich damit
   nicht als dieser Spieler verbinden.

2. Hub-Ticket: Der Party-Server (`party-server/server.js`) signiert mit dem gemeinsamen
   Schlüssel `TREFFEN_TICKET_SECRET` ein kurzlebiges Ticket {room, pid, name, host, exp}.
   Monopoly glaubt das Host-Recht nur noch, wenn das Ticket gültig ist. Ohne konfigurierten
   Schlüssel (z. B. Monopoly einzeln gestartet) gilt das alte Verhalten (`is_host`-Flag).

Format des Tickets (identisch in server.js): base64url(JSON) + "." + base64url(HMAC-SHA256)
"""
import base64
import hashlib
import hmac
import json
import os
import re
import time
from typing import Optional

TICKET_SECRET = os.environ.get("TREFFEN_TICKET_SECRET", "").strip().encode()
CLIENT_SECRET_RE = re.compile(r"^[A-Za-z0-9_-]{16,128}$")
AUTH_TIMEOUT_SEC = 10.0


def tickets_enabled() -> bool:
    return bool(TICKET_SECRET)


def valid_client_secret(secret) -> bool:
    return isinstance(secret, str) and bool(CLIENT_SECRET_RE.match(secret))


def hash_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def _b64decode(part: str) -> bytes:
    return base64.urlsafe_b64decode(part + "=" * (-len(part) % 4))


def sign_ticket(payload: dict, secret: Optional[bytes] = None) -> str:
    """Nur für Tests – im Betrieb signiert der Party-Server."""
    key = secret if secret is not None else TICKET_SECRET
    body = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode().rstrip("=")
    sig = hmac.new(key, body.encode(), hashlib.sha256).digest()
    return body + "." + base64.urlsafe_b64encode(sig).decode().rstrip("=")


def verify_ticket(ticket, room_id: str) -> Optional[dict]:
    """Gibt den Ticket-Inhalt zurück, wenn Signatur, Raum und Ablaufzeit stimmen, sonst None."""
    if not TICKET_SECRET or not isinstance(ticket, str) or len(ticket) > 2048 or ticket.count(".") != 1:
        return None
    body, sig = ticket.split(".")
    expected = hmac.new(TICKET_SECRET, body.encode(), hashlib.sha256).digest()
    try:
        if not hmac.compare_digest(expected, _b64decode(sig)):
            return None
        payload = json.loads(_b64decode(body))
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    if str(payload.get("room", "")).upper() != room_id.upper():
        return None
    exp = payload.get("exp")
    if not isinstance(exp, (int, float)) or exp < time.time():
        return None
    return payload
