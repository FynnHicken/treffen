"""Mensch-Server (M5): Hausregeln per Host, Spielstände überstehen einen Neustart.

    python -I games/mensch/tests/test_server.py
"""
import asyncio, json, os, sqlite3, sys, tempfile, threading, time
from pathlib import Path

os.environ.pop("TREFFEN_TICKET_SECRET", None)       # ohne Hub: Erster ist Host
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "packages" / "tabletop-server"))
sys.path.insert(0, str(ROOT / "games" / "mensch" / "server"))
import uvicorn, websockets  # noqa: E402
from tabletop_server import GameDef, create_app  # noqa: E402
from layout import LAYOUT, COLORS, PALETTE  # noqa: E402
from rules import MenschRules  # noqa: E402

PORT = 8098
FAILS = []
DB = os.path.join(tempfile.mkdtemp(prefix="mensch-test-"), "mensch.sqlite3")


def ok(c, m):
    print(("  OK  " if c else "  FAIL") + " " + m)
    if not c:
        FAILS.append(m)


class Server:
    def __init__(self):
        gd = GameDef("mensch", "Mensch", [PALETTE[c] for c in COLORS], layout=LAYOUT, rules=MenschRules())
        self.app = create_app(gd, db_path=DB)
        self.srv = uvicorn.Server(uvicorn.Config(self.app, host="127.0.0.1", port=PORT, log_level="warning"))
        self.t = threading.Thread(target=self.srv.run, daemon=True)
        self.t.start()
        while not self.srv.started:
            time.sleep(0.05)

    def stop(self):
        self.srv.should_exit = True
        self.t.join(10)


class C:
    def __init__(s, room, mid, secret=None):
        s.room, s.mid, s.secret = room, mid, secret or f"secret-{mid}-0123456789"
        s.snap, s.events, s.closed = None, [], None

    async def open(s, name=None):
        s.ws = await websockets.connect(f"ws://127.0.0.1:{PORT}/ws/{s.room}/{s.mid}")
        await s.ws.send(json.dumps({"action": "AUTH", "secret": s.secret}))
        await s.ws.send(json.dumps({"action": "JOIN", "name": name or s.mid.title()}))
        s.task = asyncio.create_task(s.reader())
        return s

    async def reader(s):
        try:
            async for raw in s.ws:
                m = json.loads(raw)
                if m["type"] == "SNAPSHOT":
                    s.snap = m
                elif m["type"] == "EVENT":
                    s.events.append(m["event"])
        except websockets.ConnectionClosed as e:
            s.closed = e.rcvd.code if e.rcvd else None

    async def send(s, **m):
        await s.ws.send(json.dumps(m))

    def settings(s):
        cur = dict(s.snap["state"]["settings"])
        for e in s.events:
            if e["type"] == "SETTINGS_UPDATED":
                cur = e["settings"]
        return cur


async def phase1():
    print("== Hausregeln ==")
    a = await C("M5", "anna").open()
    b = await C("M5", "ben").open()
    await asyncio.sleep(0.3)
    st = a.snap["state"]
    ok(st["settings_schema"].get("clear_start", {}).get("label"), f"Schema mit Text im Zustand: {st['settings_schema']}")
    ok(st["settings"] == {"free": False, "undo": False, "clear_start": True, "must_capture": False}, "Standard: Startfeld räumen an, Schlagzwang aus, freies Spiel aus")
    await b.send(action="SET_SETTINGS", settings={"clear_start": False})
    await asyncio.sleep(0.3)
    ok(a.settings()["clear_start"] is True, "Gast darf Hausregeln nicht ändern")
    await a.send(action="SET_SETTINGS", settings={"clear_start": "nein", "unbekannt": 1})
    await asyncio.sleep(0.3)
    ok(a.settings() == {"free": False, "undo": False, "clear_start": True, "must_capture": False}, "Ungültiger Wert/unbekannter Schlüssel ignoriert")
    await a.send(action="SET_SETTINGS", settings={"clear_start": False})
    await asyncio.sleep(0.3)
    ok(a.settings()["clear_start"] is False and b.settings()["clear_start"] is False, "Host schaltet „Startfeld räumen“ aus – alle sehen es")

    print("== Spiel starten, Zustand erzeugen ==")
    await a.send(action="ADD_BOT", seat=2)
    await a.send(action="START")
    await asyncio.sleep(0.4)
    game = [e for e in a.events if e["type"] == "GAME_UPDATED"][-1]
    ok(game["status"] == "playing" and game["play"]["settings"]["clear_start"] is False, "Spiel läuft mit der gewählten Hausregel")
    await a.send(action="SET_SETTINGS", settings={"clear_start": True})
    await asyncio.sleep(0.3)
    ok(a.settings()["clear_start"] is False, "Während des Spiels keine Regeländerung")
    await a.send(action="ROLL", power=0.5)
    await asyncio.sleep(0.4)
    rolled = [e for e in a.events if e["type"] == "DICE_ROLLED"]
    ok(len(rolled) == 1, "Anna hat gewürfelt")
    await asyncio.sleep(2.6)                # Speicher-Intervall abwarten
    rows = sqlite3.connect(DB).execute("SELECT room_id FROM rooms").fetchall()
    ok(rows == [("M5",)], f"Spielstand liegt nach ≤2 s in der Datenbank: {rows}")
    for c in (a, b):
        await c.ws.close()
    await asyncio.sleep(0.3)
    return rolled[0]


async def phase2(roll):
    print("== Nach dem Neustart ==")
    a = await C("M5", "anna").open()
    await asyncio.sleep(0.4)
    st = a.snap["state"]
    names = {m["id"]: (m["seat"], m["is_bot"]) for m in st["members"]}
    ok(st["status"] == "playing", "Partie läuft weiter")
    ok(names.get("anna") == (0, False) and names.get("ben") == (1, False) and names.get("bot_2") == (2, True),
       f"Alle an ihren Plätzen: {names}")
    ok(st["last_roll"] and st["last_roll"]["values"] == roll["values"], "Letzter Wurf ist wieder da")
    ok(st["play"]["settings"]["clear_start"] is False and st["settings"]["clear_start"] is False, "Hausregel bleibt")
    ok(st["host_id"] == "anna", "Host bleibt")
    ben = next(m for m in st["members"] if m["id"] == "ben")
    ok(ben["connected"] is False, "Ben gilt als getrennt, bis er zurückkommt")
    thief = C("M5", "ben", secret="fremder-browser-0123456789")
    await thief.open()
    await asyncio.sleep(0.4)
    ok(thief.closed == 4003, "Fremder Browser kann Bens Platz nach dem Neustart nicht übernehmen")
    b = await C("M5", "ben").open()
    await asyncio.sleep(0.4)
    ok(b.snap and b.snap["you"] == "ben" and b.snap["state"]["status"] == "playing", "Ben kommt mit seinem Browser zurück")
    for c in (a, b):
        await c.ws.close()


def main():
    s = Server()
    roll = asyncio.run(phase1())
    s.stop()
    s = Server()
    asyncio.run(phase2(roll))
    s.stop()

    print("== Kaputter Spielstand verhindert den Start nicht ==")
    con = sqlite3.connect(DB)
    con.execute("INSERT OR REPLACE INTO rooms (room_id, updated_at, state) VALUES ('KAPUTT', ?, '{nicht json')", (time.time(),))
    con.commit()
    s = Server()
    ok("KAPUTT" not in s.app.state.rooms and "M5" in s.app.state.rooms, "Unlesbarer Eintrag übersprungen, Rest geladen")
    s.stop()

    print()
    print("❌ %d Fehler" % len(FAILS) if FAILS else "✅ Alle Mensch-Server-Tests bestanden")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
