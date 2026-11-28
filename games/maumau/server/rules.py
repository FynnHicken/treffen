"""Mau-Mau auf dem Treffen-Spieltisch – Kartenspiel aus den Engine-Bausteinen (Engine 2.4: Karten, Stapel, Hände).

- 32 Karten, jeder bekommt 5. Gelegt wird auf die Ablage: gleiche Farbe oder gleicher Wert.
- 7: Der Nächste zieht 2 (legt er selbst eine 7, zieht der Übernächste 4 …).  8: Der Nächste setzt aus.
- Bube: passt auf alles (außer Bube) – wer ihn legt, wünscht sich eine Farbe (vier Knöpfe, kein Dialog).
- Wer nicht legen kann oder will, zieht eine Karte (Stapel antippen); passt sie, darf er sie legen, sonst „Weiter“.
- Wer zuerst keine Karten mehr hat, gewinnt. Ist der Stapel leer, wird die Ablage (bis auf die oberste) gemischt.

Am Tisch: Karte aus der Hand auf die Ablage ziehen (oder antippen), Stapel antippen = ziehen.
"""
import random
from typing import List, Optional

from tabletop_server.cards import SUITS, card_name, deal_new, pieces_on, shuffle, top
from tabletop_server.rules import GameRules

HAND = 5


def suit(f: str) -> str:
    return f[0]


def rank(f: str) -> str:
    return f[1:]


class MauMauRules(GameRules):
    shared_view = False          # jeder sieht nur seine eigenen Züge (die Karten selbst schützt die Engine)
    action_buttons = True        # „Weiter“, Farbe wünschen
    min_players = 2
    settings_schema = {
        "hand": {"default": HAND, "label": "Karten zu Beginn", "min": 3, "max": 8},
        "seven_stack": {"default": True, "label": "7 auf 7 legen (Strafe wächst)"},
    }
    conformance_max_steps = 2500

    # ---------- Hilfen ----------
    def players(self, room) -> List[int]:
        return room.game["seats"]

    def hand(self, room, seat: int) -> List[str]:
        return pieces_on(room, f"hand-{seat}")

    def face(self, room, pid: str) -> str:
        return room.pieces[pid]["face"]

    def top_face(self, room) -> Optional[str]:
        t = top(room, "pile")
        return self.face(room, t) if t else None

    def fits(self, room, f: str) -> bool:
        g = room.game
        t = self.top_face(room)
        if g["draw"]:                                   # offene 7er-Strafe: nur 7 drauf (wenn erlaubt)
            return rank(f) == "7" and room.settings().get("seven_stack", True)
        if rank(f) == "B":
            return rank(t) != "B"
        want = g["wish"] or suit(t)
        return suit(f) == want or (not g["wish"] and rank(f) == rank(t))

    def next_seat(self, room, seat: int, step: int = 1) -> int:
        ps = self.players(room)
        return ps[(ps.index(seat) + step) % len(ps)]

    # ---------- API 2 ----------
    def setup(self, room) -> List[dict]:
        seats = sorted(m.seat for m in room.members.values() if m.seat is not None)
        events = deal_new(room, "deck", list(room.layout["cards"]))
        n = int(room.settings().get("hand", HAND))
        for _ in range(n):
            for s in seats:
                events += room.move_piece(top(room, "deck"), f"hand-{s}")
        first = top(room, "deck")
        events += room.move_piece(first, "pile", up=True)
        room.game = {"seats": seats, "turn": seats[0], "phase": "play", "draw": 0, "wish": None, "drawn": None,
                     "result": None, "finished": []}
        return events

    def actions(self, room, seat: int) -> List[dict]:
        g = room.game or {}
        if g.get("turn") != seat or g.get("phase") not in ("play", "wish"):
            return []
        if g["phase"] == "wish":
            return [{"type": "choose", "suit": s, "label": f"{s} {SUITS[s][0]}"} for s in SUITS]
        hand = self.hand(room, seat)
        if g["drawn"]:                                  # gerade gezogen: nur diese Karte legen – oder weiter
            playable = [g["drawn"]] if g["drawn"] in hand and self.fits(room, self.face(room, g["drawn"])) else []
            return [{"type": "move", "piece": p, "to": "pile"} for p in playable] + \
                   [{"type": "pass", "label": "Weiter"}]
        acts = [{"type": "move", "piece": p, "to": "pile"} for p in hand if self.fits(room, self.face(room, p))]
        t = top(room, "deck")
        if t:
            acts.append({"type": "move", "piece": t, "to": f"hand-{seat}", "draw": True})
        elif not acts:
            acts.append({"type": "pass", "label": "Weiter"})
        return acts

    def apply(self, room, seat: int, action: dict) -> Optional[List[dict]]:
        legal = self.actions(room, seat)
        t = action.get("type")
        if t == "move":
            m = next((a for a in legal if a["type"] == "move" and a["piece"] == action.get("piece")
                      and a["to"] == action.get("to")), None)
        else:
            m = next((a for a in legal if a["type"] == t and a.get("suit") == action.get("suit")), None)
        if m is None:
            return None
        g = room.game
        if m["type"] == "choose":
            g["wish"] = m["suit"]
            g["phase"] = "play"
            wish = f"{m['suit']} {SUITS[m['suit']][0]}"
            return [{"type": "NOTE", "text": f"{{p{seat}}} wünscht sich {wish}", "you": {str(seat): f"Du wünschst dir {wish}"}}] \
                + self._advance(room, seat)
        if m["type"] == "pass":
            return self._advance(room, seat)
        if m.get("draw"):
            return self._draw(room, seat)
        # Karte legen
        f = self.face(room, m["piece"])
        events = room.move_piece(m["piece"], "pile", up=True)
        g["wish"] = None
        g["drawn"] = None
        if not self.hand(room, seat):
            others = sorted((s for s in self.players(room) if s != seat), key=lambda s: len(self.hand(room, s)))
            g.update(phase="over", turn=None, finished=[seat] + others,
                     result={"winners": [seat], "reason": "empty", "text": f"Letzte Karte: {card_name(f, room.layout['cards'])}"})
            room.status = "finished"
            return events
        if len(self.hand(room, seat)) == 1:
            events.append({"type": "NOTE", "text": "{p%d}: Mau!" % seat, "you": {str(seat): "Mau! Noch eine Karte."}})
        if rank(f) == "B":
            g["phase"] = "wish"
            return events
        if rank(f) == "7":
            g["draw"] += 2
        return events + self._advance(room, seat, skip=rank(f) == "8")

    def _draw(self, room, seat: int) -> List[dict]:
        g = room.game
        n = max(1, g["draw"])
        events = []
        last = None
        for _ in range(n):
            if not top(room, "deck"):
                events += self._refill(room)
            t = top(room, "deck")
            if not t:
                break
            events += room.move_piece(t, f"hand-{seat}")
            last = t
        if g["draw"]:                                  # Strafe gezogen → der Nächste ist dran
            g["draw"] = 0
            return events + self._advance(room, seat)
        g["drawn"] = last
        if last is None:
            return events + self._advance(room, seat)
        return events

    def _refill(self, room) -> List[dict]:
        keep = top(room, "pile")
        events = []
        for pid in pieces_on(room, "pile"):
            if pid != keep:
                events += room.move_piece(pid, "deck", up=False)
        return events + shuffle(room, "deck")

    def _advance(self, room, seat: int, skip: bool = False) -> List[dict]:
        g = room.game
        g["drawn"] = None
        g["turn"] = self.next_seat(room, seat, 2 if skip else 1)
        if not top(room, "deck") and len(pieces_on(room, "pile")) > 1 and g["phase"] == "play":
            return self._refill(room)
        return []

    def view(self, room, seat) -> dict:
        g = dict(room.game or {})
        if seat is not None and g.get("phase") in ("play", "wish"):
            g["moves"] = [{"piece": a["piece"], "to": a["to"]} for a in self.actions(room, seat) if a["type"] == "move"]
        if g.get("phase") == "play":
            extra = f" · Gewünscht: {g['wish']} {SUITS[g['wish']][0]}" if g.get("wish") else ""
            if g.get("draw"):
                g["say"] = {"me": f"Leg eine 7 – oder zieh {g['draw']} Karten (Stapel antippen).",
                            "all": f"{{who}} muss {g['draw']} ziehen …"}
            elif g.get("drawn"):
                g["say"] = {"me": "Gezogen – passt sie, leg sie. Sonst „Weiter“.", "all": "{who} hat gezogen …"}
            else:
                g["say"] = {"me": f"Du bist dran – leg eine passende Karte oder zieh eine.{extra}",
                            "all": f"{{who}} ist dran …{extra}"}
        elif g.get("phase") == "wish":
            g["say"] = {"me": "Bube! Welche Farbe wünschst du dir?", "all": "{who} wünscht sich eine Farbe …"}
        if room.game:
            g["scores"] = [len(self.hand(room, s)) for s in range(room.seats)]
            g["scores_label"] = "Karten"
        return g

    # ---------- Computer ----------
    def bot_action(self, room, seat: int) -> Optional[dict]:
        acts = self.actions(room, seat)
        if not acts:
            return None
        g = room.game
        if g["phase"] == "wish":
            counts = {s: 0 for s in SUITS}
            for p in self.hand(room, seat):
                counts[suit(self.face(room, p))] += 1
            best = max(counts, key=lambda s: (counts[s], random.random()))
            return next(a for a in acts if a["suit"] == best)
        plays = [a for a in acts if a["type"] == "move" and not a.get("draw")]
        if plays:
            def score(a):
                f = self.face(room, a["piece"])
                return (rank(f) != "B", rank(f) in ("7", "8"), random.random())
            return max(plays, key=score)
        return next((a for a in acts if a.get("draw")), acts[0])
