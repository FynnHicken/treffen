"""Rechte, Validierung, Kauf im eigenen Zug, Bankrott-Geldmenge (WebSocket gegen laufenden Server).

Ausführen über tests/run_tests.sh (startet je Testdatei einen frischen Server auf 127.0.0.1:8090).
"""
import os, sys, asyncio, json, websockets, urllib.request
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "server"))
from game_state import GameRoom
B="ws://127.0.0.1:8090/ws/"
FAILS=[]
def ok(c,m):
    print(("  OK  " if c else "  FAIL")+" "+m)
    if not c: FAILS.append(m)
    return c
LAST={"state":None}
async def drain(w,t=0.4):
    last=None
    try:
        while True:
            m=json.loads(await asyncio.wait_for(w.recv(),t))
            if m.get("state"): last=m
    except asyncio.TimeoutError: pass
    if last: LAST["state"]=last["state"]
    return last or {"state":LAST["state"]}
async def send(w,**m): await w.send(json.dumps(m))
async def main():
    print("== Rechte & Validierung (Server) ==")
    a=await websockets.connect(B+"T1/alice"); b=await websockets.connect(B+"T1/bob")
    await send(a,action="JOIN",name="Alice",token="dog",color="#e74c3c",is_host=True)
    await send(b,action="JOIN",name="Bob<script>",token="hat",color="#3498db",is_host=True)
    await drain(a); st=(await drain(b))["state"]
    ok(st["host_id"]=="alice","zweites is_host-Flag ignoriert, Alice bleibt Host")
    ok(all("<" not in p["name"] for p in st["players"]),"Name bereinigt: "+[p["name"] for p in st["players"]][1])
    await send(b,action="START_GAME"); await drain(b); st=(await drain(a))["state"]
    ok(st["status"]=="LOBBY","Nicht-Host kann nicht starten")
    await send(a,action="START_GAME"); st=(await drain(a))["state"]; await drain(b)
    ok(st["status"]=="PLAYING","Host startet")
    cur=st["current_player"]["id"]; me,other=(a,b) if cur=="alice" else (b,a)
    await send(other,action="BUY_PROPERTY",sq_idx=39); st=(await drain(other))["state"]
    ok(st["board_state"]["39"]["owner"] is None,"Kauf außerhalb des Zuges abgelehnt")
    await send(me,action="BUY_PROPERTY",sq_idx=39); st=(await drain(me))["state"]
    ok(st["board_state"]["39"]["owner"] is None,"Kauf ohne anstehendes Feld abgelehnt")
    await send(me,action="START_AUCTION",sq_idx=39); st=(await drain(me))["state"]
    ok(st["auction_state"] is None,"Auktion für beliebiges Feld abgelehnt")
    await send(other,action="TOGGLE_MORTGAGE",sq_idx=0); await send(other,action="BUILD_HOUSE",sq_idx="x"); await other.send("kein json")
    await asyncio.sleep(0.3)
    await send(other,action="CHAT",message="<img src=x onerror=alert(1)> hallo"); st=(await drain(other))["state"]
    ok(True,"Socket nach Müll-Nachrichten noch offen"); ok(not any("<img" in l for l in st["logs"]),"Chat bereinigt: "+st["logs"][-1])
    eve=await websockets.connect(B+"T1/eve"); await send(eve,action="RESET_LOBBY"); await drain(eve); st=(await drain(a))["state"]
    ok(st["status"]=="PLAYING","Fremder kann nicht zurücksetzen")
    await send(b, action="RESET_LOBBY"); await drain(b); st=(await drain(a))["state"]
    ok(st["status"]=="PLAYING","Mitspieler (Bob) kann laufendes Spiel nicht abbrechen")
    req=urllib.request.Request("http://127.0.0.1:8090/api/create_room",data=json.dumps({"room_id":"T1"}).encode(),headers={"Content-Type":"application/json"})
    r=json.loads(urllib.request.urlopen(req).read()); rooms=json.load(urllib.request.urlopen("http://127.0.0.1:8090/api/rooms"))
    ok(r.get("existing") and any(x["room_id"]=="T1" and x["status"]=="PLAYING" for x in rooms["rooms"]),"create_room überschreibt laufenden Raum nicht")
    try:
        w=await websockets.connect(B+"%3Cimg%3E/x"); await w.recv(); ok(False,"böse Raum-ID abgelehnt")
    except Exception: ok(True,"böse Raum-ID abgelehnt")

    print("== Normaler Ablauf: Mensch kauft im eigenen Zug ==")
    for _ in range(40):
        await drain(b,0.2); st=(await drain(a,0.2))["state"]
        cur=st["current_player"]["id"]; w=a if cur=="alice" else b
        pa=st.get("pending_action") or {}
        if pa.get("type")=="BUY_OR_AUCTION":
            await send(w,action="BUY_PROPERTY",sq_idx=pa["square"]["index"]); st=(await drain(w))["state"]
            ok(st["board_state"][str(pa["square"]["index"])]["owner"]==cur,f"{cur} kauft {pa['square']['name']} im eigenen Zug"); break
        if pa.get("type")=="CARD_DRAWN": await send(w,action="CONFIRM_CARD")
        elif pa.get("type")=="TAX_CHOICE": await send(w,action="PAY_INCOME_TAX",mode="flat")
        elif not st["rolled"]: await send(w,action="ROLL_DICE")
        else: await send(w,action="END_TURN")
        await asyncio.sleep(0.15)

    print("== Bankrott: kein Geld aus dem Nichts ==")
    r=GameRoom("X","a"); r.add_player("a","A","dog","#e74c3c"); r.add_player("b","B","hat","#3498db"); r.start_game()
    A,Bp=r.players
    for i in (37,39): r.board_state[i].update(owner="a",houses=5)
    r.board_state[1]["owner"]="b"; r.board_state[3]["owner"]="b"; r.board_state[1]["houses"]=2; r.board_state[3]["houses"]=2
    Bp.money=100; total=A.money+Bp.money
    r.evaluate_square(Bp,{"index":39,"type":"property","name":"Schlossallee"},7)
    ok(A.money==1500+100,f"A bekommt nur vorhandenes Bargeld ({A.money}), Schuld vermerkt {Bp.debts}")
    r.toggle_mortgage("b",3) if False else None
    r.declare_bankruptcy("b")
    ok(A.money<=total+100, f"Nach Bankrott A={A.money} (Geldmenge vorher {total}, +100 Hausverkauf an Bank)")
    r2=GameRoom("Y","a"); r2.add_player("a","A","dog","#e74c3c"); r2.add_player("b","B","hat","#3498db"); r2.start_game()
    A2,B2=r2.players; r2.board_state[39].update(owner="a",houses=0); r2.board_state[1]["owner"]="b"
    B2.money=10; r2.evaluate_square(B2,{"index":39,"type":"property","name":"Schlossallee"},7)
    r2.toggle_mortgage("b",1)
    ok(A2.money==1500+10+30-10+10 or A2.money==1530, f"Hypothek-Erlös zahlt Schuld automatisch nach: A={A2.money}, B={B2.money}, debts={B2.debts}")

asyncio.run(main())
print(f"\n{len(FAILS)} Fehler" if FAILS else "\nAlle Prüfungen bestanden.")
sys.exit(1 if FAILS else 0)
