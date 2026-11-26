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
    elif t == "PIECE_GRABBED":
        state["pieces"][ev["piece"]]["held_by"] = ev["by"]
    elif t == "PIECE_RELEASED":
        state["pieces"][ev["piece"]]["held_by"] = None
    elif t == "PIECE_MOVED":
        state["pieces"][ev["piece"]].update(field=ev["to"], held_by=None)
    elif t == "DICE_ROLLED":
        state["last_roll"] = {"by": ev["by"], "values": ev["values"], "throw": ev["throw"]}


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
    print("== Figuren greifen & absetzen (M2, ohne Regeln) ==")
    piece = lambda c, pid: c.state["pieces"][pid]
    await a.send(action="GRAB", piece="p1")            # gehört Platz 1 (Bob)
    await settle()
    ok(piece(a, "p1")["held_by"] is None, "Fremde Figur kann nicht gegriffen werden")
    await x.send(action="GRAB", piece="p0")            # Zuschauer
    await settle()
    ok(piece(a, "p0")["held_by"] is None, "Zuschauer kann nichts greifen")
    await a.send(action="GRAB", piece="p0")
    await settle()
    ok(piece(b2, "p0")["held_by"] == "alice", "Eigene Figur greifen – alle sehen, wer sie hält")
    await a.send(action="DROP", piece="p0", field="f1")   # f1 ist besetzt (p1)
    await settle()
    ok(piece(b2, "p0")["field"] == "h0" and piece(b2, "p0")["held_by"] is None, "Besetztes Feld → losgelassen, bleibt stehen")
    ok(any(m.get("code") == "DROP_REJECTED" for m in a.msgs), "Absender bekommt DROP_REJECTED (Figur gleitet zurück)")
    await a.send(action="GRAB", piece="p0")
    await a.send(action="DROP", piece="p0", field="gibtsnicht")
    await settle()
    ok(piece(b2, "p0")["field"] == "h0", "Unbekanntes Feld abgelehnt")
    await a.send(action="GRAB", piece="p0")
    await a.send(action="DROP", piece="p0", field="f2")
    await settle()
    ok(piece(b2, "p0")["field"] == "f2", "Absetzen auf freies Feld")
    moved = [m for m in b2.msgs if m["type"] == "EVENT" and m["event"]["type"] == "PIECE_MOVED"]
    ok(moved and moved[-1]["event"]["from"] == "h0" and moved[-1]["event"]["by"] == "alice", "PIECE_MOVED mit from/to/by")
    await b2.send(action="DROP", piece="p0", field="f3")
    await settle()
    ok(piece(a, "p0")["field"] == "f2", "Nur wer hält, kann absetzen")
    print("== Würfeln (M3, ohne Regeln) ==")
    await x.send(action="ROLL", power=0.5)                 # Zuschauer
    await settle()
    ok(a.state.get("last_roll") is None, "Zuschauer kann nicht würfeln")
    await b2.send(action="ROLL", power=0.8)
    await settle()
    lr = a.state.get("last_roll") or {}
    ok(lr.get("by") == "bob" and len(lr.get("values", [])) == 1 and 1 <= lr["values"][0] <= 6, f"Bob würfelt: {lr.get('values')}")
    ok(lr.get("throw", {}).get("seat") == 1 and lr["throw"]["power"] == 0.8 and isinstance(lr["throw"]["seed"], int), "Wurfparameter für die Animation")
    seq_before = a.seq
    await a.send(action="ROLL", power=0.5)
    await settle()
    ok(a.seq == seq_before, "Während die Würfel rollen, kein zweiter Wurf (Sperre)")
    await asyncio.sleep(1.4)
    await a.send(action="ROLL", power="quatsch")
    await settle()
    ok(a.state["last_roll"]["by"] == "alice" and a.state["last_roll"]["throw"]["power"] == 0.6, "Nach der Sperre wieder möglich; ungültige Stärke → Standard")
    from tabletop_server.rooms import Room, GameDef as GD
    r = Room("X", GD("t", "t", ["#000", "#111"], layout={"dice": {"count": 2, "sides": 6}}))
    r.join("u", "U", False)
    rolls = [r.roll("u", 0.5, now=i * 10.0)[0]["event"]["values"] for i in range(400)]
    flat = [v for vs in rolls for v in vs]
    ok(all(len(vs) == 2 for vs in rolls) and set(flat) == {1, 2, 3, 4, 5, 6}, "Zwei Würfel, alle Augenzahlen kommen vor")
    ok(max(flat.count(k) for k in range(1, 7)) < 220, f"Grob gleichverteilt: {[flat.count(k) for k in range(1, 7)]}")

    await a.send(action="GRAB", piece="p0")
    await settle()
    await a.close()
    await settle(0.4)
    ok(piece(b2, "p0")["held_by"] is None, "Trennen lässt gehaltene Figur los")
    ok(not b2.gap, "Ereignisnummern lückenlos")
    for c in (b2, h, g, x):
        await c.close()

    print()
    print("❌ %d Fehler" % len(FAILS) if FAILS else "✅ Alle Spieltisch-Tests bestanden")
    return 1 if FAILS else 0


def run():
    layout = {
        "dice": {"count": 1, "sides": 6},
        "fields": {f: {"x": i * 0.8, "z": 0, "kind": "track"} for i, f in enumerate(["h0", "f1", "f2", "f3"])},
        "pieces": {"p0": {"kind": "pawn", "seat": 0, "field": "h0"}, "p1": {"kind": "pawn", "seat": 1, "field": "f1"}},
    }
    app = create_app(GameDef("test", "Test", ["#f1c40f", "#27ae60", "#e74c3c", "#2c3e50"], layout=layout))
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
