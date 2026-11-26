"""Spieltisch-Server M1: Anmeldung, Sitzplätze, Host, Ereignisnummern, Präsenz, Reconnect.

Startet einen eigenen Server (uvicorn) mit Test-Spiel und TREFFEN_TICKET_SECRET.
    python -I packages/tabletop-server/tests/test_tabletop_ws.py
"""
import asyncio, json, os, sys, threading, time
from pathlib import Path

os.environ["TREFFEN_TICKET_SECRET"] = "test-ticket-secret"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import uvicorn, websockets  # noqa: E402
from tabletop_server import GameDef, create_app, auth  # noqa: E402

PORT = 8097
B = f"ws://127.0.0.1:{PORT}/ws/"
FAILS = []


def ok(c, m):
    print(("  OK  " if c else "  FAIL") + " " + m)
    if not c:
        FAILS.append(m)


class C:
    """Test-Client: verbindet, AUTH, sammelt Nachrichten, hält lokalen Zustand per SNAPSHOT/EVENT."""

    def __init__(s, room, mid, secret=None):
        s.room, s.mid, s.secret = room, mid, secret or f"secret-{mid}-0123456789"
        s.msgs, s.state, s.seq, s.gap = [], None, None, False

    async def open(s, join=True, name=None, ticket=None):
        s.ws = await websockets.connect(B + f"{s.room}/{s.mid}")
        await s.ws.send(json.dumps({"action": "AUTH", "secret": s.secret}))
        s.task = asyncio.create_task(s.reader())
        if join:
            await s.send(action="JOIN", name=name or s.mid.title(), ticket=ticket)
        return s

    async def reader(s):
        try:
            async for raw in s.ws:
                m = json.loads(raw)
                s.msgs.append(m)
                if m["type"] == "SNAPSHOT":
                    s.state, s.seq = m["state"], m["seq"]
                elif m["type"] == "EVENT" and s.state is not None:
                    if m["seq"] != s.seq + 1:
                        s.gap = True
                    s.seq = m["seq"]
                    apply(s.state, m["event"])
        except Exception:
            pass

    async def send(s, **m):
        await s.ws.send(json.dumps(m))

    def member(s, mid):
        return next((m for m in (s.state or {}).get("members", []) if m["id"] == mid), None)

    async def close(s):
        await s.ws.close()


def apply(state, ev):
    """Gleiche Logik wie der Client (packages/tabletop/src/net/state.ts)."""
    t = ev["type"]
    if t == "MEMBER_JOINED":
        state["members"].append(ev["member"])
    elif t == "MEMBER_UPDATED":
        state["members"] = [ev["member"] if m["id"] == ev["member"]["id"] else m for m in state["members"]]
    elif t == "MEMBER_LEFT":
        state["members"] = [m for m in state["members"] if m["id"] != ev["id"]]
    elif t == "HOST_CHANGED":
        state["host_id"] = ev["host_id"]


async def settle(t=0.3):
    await asyncio.sleep(t)


def ticket(room, host):
    return auth.sign_ticket({"v": 1, "room": room, "pid": "hub", "name": "X", "host": host,
                             "exp": int(time.time()) + 600})


async def main():
    print("== Sitzplätze & Host ==")
    a = await C("T1", "alice").open()
    b = await C("T1", "bob").open()
    await settle()
    ok(a.state and a.member("alice")["seat"] == 0 and a.member("bob")["seat"] == 1, "Sitzplätze 0 und 1 vergeben")
    ok(a.state["host_id"] == "alice", "Erster ist Host (ohne Ticket)")
    ok(b.state["members"] == a.state["members"], "Beide Clients haben denselben Zustand (Snapshot + Events)")
    ok(a.member("bob")["color"] == "#27ae60", "Farbe kommt vom Sitzplatz")

    await b.send(action="SIT", seat=0)
    await settle()
    ok(a.member("bob")["seat"] == 1, "Besetzter Platz kann nicht genommen werden")
    await b.send(action="SIT", seat=3)
    await settle()
    ok(a.member("bob")["seat"] == 3, "Freien Platz wählen")
    await b.send(action="STAND")
    await settle()
    ok(a.member("bob")["seat"] is None and a.member("bob")["color"] == "#9ca3af", "Aufstehen → Zuschauer")
    await b.send(action="SIT", seat=1)

    print("== Host per Hub-Ticket ==")
    h = await C("T1", "hubhost").open(ticket=ticket("T1", True))
    await settle()
    ok(a.state["host_id"] == "hubhost", "Gültiges Host-Ticket übernimmt Host (auch wenn jemand zuerst da war)")
    g = await C("T1", "gast").open(ticket=ticket("T1", True))
    await settle()
    ok(a.state["host_id"] == "hubhost", "Host-Ticket wirkt nur einmal pro Raum")
    x = await C("T1", "faker").open(ticket=ticket("ANDERS", True))
    await settle()
    ok(a.state["host_id"] == "hubhost", "Ticket für anderen Raum wirkt nicht")
    ok(a.member("faker")["seat"] is None, "Fünfter Gast wird Zuschauer (4 Plätze)")

    print("== Präsenz ==")
    a.msgs.clear()
    await b.send(action="PRESENCE", p={"x": 1.5, "z": -2.25, "down": True, "hold": "piece-3"})
    await settle()
    pres = [m for m in a.msgs if m["type"] == "PRESENCE" and m["from"] == "bob"]
    ok(pres and pres[-1]["p"] == {"x": 1.5, "z": -2.25, "down": True, "hold": "piece-3"}, "Zeiger wird weitergeleitet")
    ok(not any(m["type"] == "PRESENCE" and m["from"] == "bob" for m in b.msgs), "…aber nicht an den Absender zurück")
    a.msgs.clear()
    for bad in ({"x": "a", "z": 1}, {"x": 1e9, "z": 0}, {"x": float("nan"), "z": 0}, "kaputt", {"x": 1, "z": 1, "hold": "<img>"}):
        await b.send(action="PRESENCE", p=bad)
    await settle()
    got = [m["p"] for m in a.msgs if m["type"] == "PRESENCE"]
    ok(got == [{"x": 1.0, "z": 1.0, "down": False}], f"Ungültige Zeigerdaten verworfen/bereinigt: {got}")
    a.msgs.clear()
    for i in range(200):
        await b.send(action="PRESENCE", p={"x": 0, "z": i / 100})
    await settle(0.5)
    n = sum(1 for m in a.msgs if m["type"] == "PRESENCE")
    ok(n <= 40, f"Präsenz gedrosselt (200 gesendet, {n} weitergeleitet)")
    ok(not a.gap and not b.gap, "Ereignisnummern lückenlos")

    print("== Identität & Reconnect ==")
    evil = await C("T1", "alice", secret="fremdes-secret-0123456789").open(join=False)
    await settle(0.5)
    ok(any(m.get("code") == "ID_IN_USE" for m in evil.msgs), "Fremdes Secret für Alices ID abgelehnt")
    try:
        bot = await C("T1", "bot_1").open(join=False)
        await settle()
        ok(bot.ws.close_code == 1008, "bot_-ID abgelehnt")
    except websockets.InvalidStatus:
        ok(True, "bot_-ID abgelehnt")
    await b.close()
    await settle(0.4)
    ok(a.member("bob")["connected"] is False and a.member("bob")["seat"] == 1, "Getrennt: Platz bleibt reserviert")
    b2 = await C("T1", "bob").open()
    await settle()
    ok(a.member("bob")["connected"] is True and b2.member("bob")["seat"] == 1, "Rückkehr auf denselben Platz")
    await b2.send(action="SYNC")
    await settle()
    ok(b2.msgs[-1]["type"] == "SNAPSHOT", "SYNC liefert neuen Snapshot")
    for c in (a, b2, h, g, x):
        await c.close()

    print()
    print("❌ %d Fehler" % len(FAILS) if FAILS else "✅ Alle Spieltisch-Tests bestanden")
    return 1 if FAILS else 0


def run():
    app = create_app(GameDef("test", "Test", ["#f1c40f", "#27ae60", "#e74c3c", "#2c3e50"]))
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=PORT, log_level="warning"))
    t = threading.Thread(target=server.run, daemon=True)
    t.start()
    while not server.started:
        time.sleep(0.05)
    rc = asyncio.run(main())
    server.should_exit = True
    t.join(5)
    sys.exit(rc)


if __name__ == "__main__":
    run()
