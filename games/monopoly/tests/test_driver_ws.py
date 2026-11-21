"""Bot-Treiber, Reaktionsfähigkeit, Abwesenheit/Reconnect, Zuschauer, Parallel-Spam.

Braucht MONOPOLY_AWAY_GRACE_SEC=3 (setzt run_tests.sh). Ausführen über tests/run_tests.sh.
"""
import os, sys, asyncio, json, time, websockets, urllib.request
B="ws://127.0.0.1:8090/ws/"
FAST={"stepDuration":40,"stepPause":0,"landingHold":0,"diceDuration":200,"dicePostPause":0,"cinematicFollow":False}
FAILS=[]
def ok(c,m):
    print(("  OK  " if c else "  FAIL")+" "+m)
    if not c: FAILS.append(m)
    return c

class C:
    def __init__(s,room,pid): s.room,s.pid=room,pid; s.st=None; s.msgs=[]
    async def open(s):
        s.ws=await websockets.connect(B+f"{s.room}/{s.pid}"); s.task=asyncio.create_task(s.reader()); return s
    async def reader(s):
        try:
            async for raw in s.ws:
                m=json.loads(raw); m["_t"]=time.time(); s.msgs.append(m)
                if m.get("state"): s.st=m["state"]
        except Exception: pass
    async def send(s,**m): await s.ws.send(json.dumps(m))
    def types(s): return [m["type"] for m in s.msgs]

async def play_human(c, until):
    """Spielt einen Menschen minimal: würfeln, kaufen/versteigern ablehnen, Karte, Steuer, Zug beenden."""
    while time.time()<until:
        await asyncio.sleep(0.3)
        st=c.st
        if not st or st["status"]!="PLAYING" or st["current_player"]["id"]!=c.pid: continue
        me=next(p for p in st["players"] if p["id"]==c.pid); pa=st.get("pending_action") or {}
        if st.get("auction_state"):
            if c.pid in st["auction_state"]["active_bidders"]: await c.send(action="AUCTION_PASS")
        elif me["money"]<0: await c.send(action="BANKRUPTCY")
        elif pa.get("type")=="BUY_OR_AUCTION": await c.send(action="START_AUCTION")
        elif pa.get("type")=="CARD_DRAWN": await c.send(action="CONFIRM_CARD")
        elif pa.get("type")=="TAX_CHOICE": await c.send(action="PAY_INCOME_TAX",mode="flat")
        elif not st["rolled"]: await c.send(action="ROLL_DICE")
        else: await c.send(action="END_TURN")
        await asyncio.sleep(0.4)

async def main():
    print("== 1. Mensch bankrott, nur noch Bots spielen weiter (40 s) + Socket bleibt reaktionsfähig ==")
    h=await C("BOTS","hans").open()
    await h.send(action="JOIN",name="Hans",token="dog",color="#e74c3c",is_host=True)
    for _ in range(3): await h.send(action="ADD_BOT")
    await h.send(action="UPDATE_ANIM_CONFIG",password="admin123",config=FAST)
    await asyncio.sleep(0.5); await h.send(action="START_GAME"); await asyncio.sleep(0.5)
    await h.send(action="BANKRUPTCY"); await asyncio.sleep(0.5)
    lat=[]
    t_end=time.time()+40
    while time.time()<t_end:
        n=len(h.msgs); t0=time.time(); await h.send(action="CHAT",message="ping")
        while time.time()-t0<5 and not any(m["type"]=="CHAT" for m in h.msgs[n:]): await asyncio.sleep(0.02)
        lat.append(time.time()-t0); await asyncio.sleep(2)
    rolls=h.types().count("DICE_ROLLED"); turns=h.types().count("TURN_ENDED")
    ok(turns>=5, f"Bots allein: {rolls} Würfe, {turns} Zugwechsel in 40 s, Status {h.st['status']}")
    ok(max(lat)<0.5, f"Chat-Antwort während Bot-Zügen: max {max(lat)*1000:.0f} ms (vorher blockiert bis Bots fertig)")

    print("== 2. Spieler verliert Verbindung → Computer übernimmt → Rückkehr ==")
    a=await C("AWAY","anna").open(); b=await C("AWAY","ben").open()
    await a.send(action="JOIN",name="Anna",token="dog",color="#e74c3c",is_host=True)
    await b.send(action="JOIN",name="Ben",token="hat",color="#3498db")
    await a.send(action="UPDATE_ANIM_CONFIG",password="admin123",config=FAST)
    await asyncio.sleep(0.5); await a.send(action="START_GAME"); await asyncio.sleep(0.8)
    await b.ws.close(); await asyncio.sleep(4.5)   # Gnadenfrist im Test: 3 s
    ben=next(p for p in a.st["players"] if p["id"]=="ben")
    ok(ben["away"], "Ben nach Gnadenfrist als abwesend markiert")
    t_end=time.time()+25; ben_turns_before=0
    anna_task=asyncio.create_task(play_human(a,t_end))
    await asyncio.sleep(25); anna_task.cancel()
    ben_rolls=sum(1 for m in a.msgs if m["type"]=="DICE_ROLLED" and (m.get("result") or {}).get("player",{}).get("id")=="ben")
    ok(ben_rolls>=2, f"Computer hat für Ben {ben_rolls}x gewürfelt – Spiel hängt nicht")
    b2=await C("AWAY","ben").open(); await b2.send(action="JOIN",name="Ben",token="hat",color="#3498db"); await asyncio.sleep(1)
    ben=next(p for p in b2.st["players"] if p["id"]=="ben")
    ok(not ben["away"], "Nach Reconnect spielt Ben wieder selbst")

    print("== 3. Reconnect-Reihenfolge: alter Socket schließt NACH dem neuen ==")
    b3=await C("AWAY","ben").open(); await b3.send(action="JOIN",name="Ben",token="hat",color="#3498db"); await asyncio.sleep(0.5)
    await b2.ws.close(); await asyncio.sleep(4.5)
    ben=next(p for p in a.st["players"] if p["id"]=="ben")
    ok(not ben["away"], "Ben bleibt verbunden (vorher wurde die neue Verbindung entfernt)")
    n=len(b3.msgs); await a.send(action="CHAT",message="hallo ben"); await asyncio.sleep(0.5)
    ok(any(m["type"]=="CHAT" for m in b3.msgs[n:]), "Neue Verbindung empfängt weiterhin Nachrichten")

    print("== 4. Beitritt während des Spiels = Zuschauer ==")
    z=await C("AWAY","zoe").open(); await z.send(action="JOIN",name="Zoe",token="car",color="#2ecc71"); await asyncio.sleep(0.6)
    ok("SPECTATOR" in z.types() and not any(p["id"]=="zoe" for p in a.st["players"]), f"Zoe schaut zu, Spieler: {[p['name'] for p in a.st['players']]}")
    await a.send(action="RESET_LOBBY"); await asyncio.sleep(0.4)
    await z.send(action="JOIN",name="Zoe",token="car",color="#2ecc71"); await asyncio.sleep(0.6)
    ok(any(p["id"]=="zoe" for p in a.st["players"]), "Nach Reset in die Lobby steigt Zoe ein")

    print("== 5. Parallel-Spam unter Lock: keine Exceptions ==")
    await a.send(action="START_GAME"); await asyncio.sleep(0.5)
    acts=["ROLL_DICE","END_TURN","BUY_PROPERTY","START_AUCTION","AUCTION_PASS","CONFIRM_CARD","TOGGLE_MORTGAGE","BUILD_HOUSE"]
    await asyncio.gather(*[c.send(action=acts[i%len(acts)],sq_idx=1) for i in range(80) for c in (a,b3,z)])
    await asyncio.sleep(2)
    ok(a.st["status"]=="PLAYING", "Spiel läuft nach 240 parallelen Nachrichten weiter")

asyncio.run(main())
print(f"\n{len(FAILS)} Fehler" if FAILS else "\nAlle Prüfungen bestanden.")
sys.exit(1 if FAILS else 0)
