"""Identität & Hub-Tickets: Spieler-ID an Secret gebunden, keine Bot-Übernahme, Host nur per Ticket.

Läuft gegen einen Server mit TREFFEN_TICKET_SECRET=test-ticket-secret (siehe run_tests.sh).
"""
import os, sys, asyncio, json, time, websockets
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server"))
import auth

B = "ws://127.0.0.1:8090/ws/"
KEY = b"test-ticket-secret"
FAILS = []


def ok(c, m):
    print(("  OK  " if c else "  FAIL") + " " + m)
    if not c:
        FAILS.append(m)
    return c


async def send(w, **m):
    await w.send(json.dumps(m))


async def conn(path, secret):
    w = await websockets.connect(B + path)
    await send(w, action="AUTH", secret=secret)
    return w


async def last_state(w, t=0.5):
    st = None
    try:
        while True:
            m = json.loads(await asyncio.wait_for(w.recv(), t))
            if m.get("state"):
                st = m["state"]
    except (asyncio.TimeoutError, websockets.ConnectionClosed):
        pass
    return st


async def closed_with(w, t=2.0):
    try:
        while True:
            await asyncio.wait_for(w.recv(), t)
    except websockets.ConnectionClosed as e:
        return e.rcvd.code if e.rcvd else None
    except asyncio.TimeoutError:
        return None


def ticket(room, host, exp_in=600, key=KEY):
    return auth.sign_ticket({"v": 1, "room": room, "pid": "hub1", "name": "X", "host": host,
                             "exp": int(time.time()) + exp_in}, key)


async def main():
    print("== Identität: Spieler-ID gehört dem Browser ==")
    a = await conn("A1/alice", "alice-secret-0123456789")
    await send(a, action="JOIN", name="Alice", token="dog", color="#e74c3c")
    st = await last_state(a)
    ok(st and any(p["id"] == "alice" for p in st["players"]), "Alice tritt bei")

    evil = await conn("A1/alice", "fremdes-secret-0123456789")
    ok(await closed_with(evil) == 4003, "Fremdes Secret für Alices ID → Verbindung abgelehnt (4003)")

    again = await conn("A1/alice", "alice-secret-0123456789")
    await send(again, action="CHAT", message="bin wieder da")
    st = await last_state(again)
    ok(st is not None, "Alice kommt mit eigenem Secret wieder rein (Reconnect)")

    w = await websockets.connect(B + "A1/mallory")
    await send(w, action="JOIN", name="Mallory")
    ok(await closed_with(w) == 1008, "Ohne AUTH als erste Nachricht → abgelehnt")

    w = await conn("A1/mallory", "kurz")
    ok(await closed_with(w) == 1008, "Zu kurzes Secret → abgelehnt")

    await send(again, action="ADD_BOT")
    st = await last_state(again)
    bot = next((p for p in st["players"] if p["is_bot"]), None)
    ok(bot is not None, "Bot hinzugefügt")
    try:
        w = await conn(f"A1/{bot['id']}", "bot-dieb-secret-0123456789")
        rejected = await closed_with(w) == 1008
    except websockets.InvalidStatus:
        rejected = True  # schon beim Handshake abgelehnt (HTTP 403)
    ok(rejected, "Verbindung mit Bot-ID abgelehnt (keine Übernahme von Computerzügen)")

    print("== Host nur per gültigem Hub-Ticket ==")
    # Fremder ist zuerst im Raum und behauptet, Host zu sein
    m = await conn("H1/mallory", "mallory-secret-0123456789")
    await send(m, action="JOIN", name="Mallory", is_host=True)
    await send(m, action="JOIN", name="Mallory", ticket=ticket("H1", True, key=b"falscher-schluessel"))
    st = await last_state(m)
    ok(st["host_id"] == "mallory", "Ohne gültiges Ticket bleibt Host, wer den Raum zuerst geöffnet hat")
    h = await conn("H1/host", "host-secret-0123456789ab")
    await send(h, action="JOIN", name="Host", ticket=ticket("H1", True, exp_in=-5))
    st = await last_state(h)
    ok(st["host_id"] != "host", "Abgelaufenes Ticket gibt kein Host-Recht")
    await send(h, action="JOIN", name="Host", ticket=ticket("ANDERER", True))
    st = await last_state(h)
    ok(st["host_id"] != "host", "Ticket für anderen Raum gibt kein Host-Recht")
    await send(h, action="JOIN", name="Host", ticket=ticket("H1", False))
    st = await last_state(h)
    ok(st["host_id"] != "host", "Ticket ohne host=true gibt kein Host-Recht")
    await send(h, action="JOIN", name="Host", ticket=ticket("H1", True))
    st = await last_state(h)
    ok(st["host_id"] == "host", "Gültiges Host-Ticket macht den Hub-Host zum Host (obwohl Mallory zuerst da war)")

    g = await conn("H1/gast", "gast-secret-0123456789ab")
    await send(g, action="JOIN", name="Gast", is_host=True, ticket=ticket("H1", True))
    st = await last_state(g)
    ok(st["host_id"] == "host", "Host-Recht wird nur einmal pro Raum vergeben")

    for w in (a, again, m, h, g):
        await w.close()
    print()
    print("❌ %d Fehler" % len(FAILS) if FAILS else "✅ Alle Auth-Tests bestanden")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    asyncio.run(main())
