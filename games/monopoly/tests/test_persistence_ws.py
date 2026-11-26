"""Spielstände überstehen einen Server-Neustart (SQLite, server/persistence.py).

Startet den Server selbst zweimal (mit MONOPOLY_DB in /tmp) – siehe run_tests.sh.
"""
import asyncio, json, os, signal, subprocess, sys, threading, time, websockets

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DB = "/tmp/persist-test.sqlite3"
B = "ws://127.0.0.1:8090/ws/"
FAILS = []


def ok(c, m):
    print(("  OK  " if c else "  FAIL") + " " + m)
    if not c:
        FAILS.append(m)


def start_server():
    env = dict(os.environ, MONOPOLY_DB=DB, MONOPOLY_AWAY_GRACE_SEC="30")
    proc = subprocess.Popen([sys.executable, "-u", "server/main.py"], cwd=ROOT, env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    lines = []
    ready = threading.Event()

    def pump():  # Ausgabe immer abholen, sonst blockiert der Server bei vollem Pipe-Puffer
        for line in proc.stdout:
            lines.append(line)
            if "Uvicorn running" in line:
                ready.set()
    threading.Thread(target=pump, daemon=True).start()
    if not ready.wait(15):
        raise RuntimeError("Server startet nicht:\n" + "".join(lines))
    return proc, lines


async def conn(path, secret):
    w = await websockets.connect(B + path)
    await w.send(json.dumps({"action": "AUTH", "secret": secret}))
    return w


async def last_state(w, t=0.6):
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


async def main():
    for f in (DB, DB + "-wal", DB + "-shm"):
        if os.path.exists(f):
            os.remove(f)
    print("== Partie starten und Zustand erzeugen ==")
    srv, _ = start_server()
    a = await conn("P1/alice", "alice-secret-0123456789")
    await a.send(json.dumps({"action": "JOIN", "name": "Alice", "token": "dog", "color": "#e74c3c"}))
    await a.send(json.dumps({"action": "ADD_BOT"}))
    await a.send(json.dumps({"action": "START_GAME"}))
    st = await last_state(a)
    ok(st and st["status"] == "PLAYING", "Spiel läuft")
    # Alice ist dran → würfeln/kaufen bis sie etwas besitzt (Bots spielen dazwischen)
    for _ in range(60):
        st = await last_state(a, 0.4) or st
        if st["status"] != "PLAYING":
            break
        if any(v["owner"] == "alice" for v in st["board_state"].values()):
            break
        if st["current_player"]["id"] != "alice":
            continue
        pa = st.get("pending_action") or {}
        if pa.get("type") == "BUY_OR_AUCTION":
            await a.send(json.dumps({"action": "BUY_PROPERTY", "sq_idx": pa["square"]["index"]}))
        elif pa.get("type") == "CARD_DRAWN":
            await a.send(json.dumps({"action": "CONFIRM_CARD"}))
        elif pa.get("type") == "TAX_CHOICE":
            await a.send(json.dumps({"action": "PAY_INCOME_TAX", "mode": "flat"}))
        elif not st["rolled"]:
            await a.send(json.dumps({"action": "ROLL_DICE"}))
        else:
            await a.send(json.dumps({"action": "END_TURN"}))
    st = await last_state(a, 0.8) or st
    if not any(v["owner"] == "alice" for v in st["board_state"].values()):
        # Würfelpech (nur Besetztes/Ereignisfelder getroffen): Besitz per Debug-Befehl, damit der Test nicht zufällig rot wird
        await a.send(json.dumps({"action": "DEBUG_ACTION", "password": "admin123", "cmd": "GIVE_COLOR_GROUP", "value": "brown"}))
        st = await last_state(a, 0.8) or st
    owned = sorted(k for k, v in st["board_state"].items() if v["owner"] == "alice")
    ok(bool(owned), f"Alice besitzt etwas: {owned}")
    before = {p["id"]: (p["money"], p["position"]) for p in st["players"]}
    await a.close()
    await asyncio.sleep(3.0)  # Flush-Intervall (2 s) abwarten
    # Gegen Absturz testen: SIGKILL statt sauberem Herunterfahren
    srv.send_signal(signal.SIGKILL)
    srv.wait()

    print("== Neustart: Spiel muss noch da sein ==")
    srv, lines = start_server()
    ok(any("wiederhergestellt" in l and "P1" in l for l in lines), "Server meldet wiederhergestellte Partie")
    a = await conn("P1/alice", "alice-secret-0123456789")
    await a.send(json.dumps({"action": "JOIN", "name": "Alice", "token": "dog", "color": "#e74c3c"}))
    st2 = await last_state(a, 1.0)
    ok(st2 and st2["status"] == "PLAYING", "Spiel läuft nach Neustart weiter")
    if st2:
        owned2 = sorted(k for k, v in st2["board_state"].items() if v["owner"] == "alice")
        ok(owned2 == owned, f"Besitz erhalten: {owned2}")
        after = {p["id"]: (p["money"], p["position"]) for p in st2["players"]}
        ok(after.get("alice") == before.get("alice"), f"Geld/Position von Alice erhalten: {after.get('alice')}")
        ok(st2["host_id"] == "alice", "Host erhalten")
        ok(any("neu gestartet" in l for l in st2["logs"]), "Hinweis im Protokoll")
    evil = await conn("P1/alice", "fremdes-secret-0123456789")
    ok(await closed_with(evil) == 4003, "Secret-Bindung übersteht den Neustart (fremdes Secret abgelehnt)")
    await a.close()
    srv.terminate()
    srv.wait()

    print("== Kaputter Eintrag verhindert den Start nicht ==")
    import sqlite3
    c = sqlite3.connect(DB)
    c.execute("INSERT OR REPLACE INTO rooms VALUES ('KAPUTT', 1, ?, ?)", (time.time(), b"kein pickle"))
    c.commit(); c.close()
    srv, lines = start_server()
    ok(any("KAPUTT" in l and "übersprungen" in l for l in lines), "Unlesbarer Spielstand wird übersprungen")
    srv.terminate()
    srv.wait()

    print()
    print("❌ %d Fehler" % len(FAILS) if FAILS else "✅ Alle Persistenz-Tests bestanden")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    asyncio.run(main())
