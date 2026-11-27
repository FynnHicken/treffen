"""Pflicht-Prüfung für jedes Tisch-Spiel („passt das Spiel zur Engine?“).

Jedes Spiel ruft das in seinen Tests auf; die CI führt es für alle Spiele aus. Bricht ein Engine-Update ein
Spiel, wird die CI rot, bevor es live geht.

    from tabletop_server.conformance import check_game
    check_game(GAME, games=20, settings={"bot_level": 1})

Der Runner setzt TABLETOP_CONFORMANCE=1 – ein Spiel darf dann einen schnellen Computer nehmen (z. B. kein Stockfish).

Jede Variante (rooms.Variant) wird einzeln geprüft, mit ihren `conformance_settings` (an den Regeln).
Längere Spiele (z. B. Mensch zu acht) setzen an den Regeln `conformance_max_steps`.

Geprüft wird ohne Netzwerk direkt am Raum:
  - Computer spielen ganze Partien bis zum Ende (kein Hängenbleiben, keine Ausnahme)
  - Ereignisse sind lückenlos nummeriert, haben einen Typ und sind als JSON versendbar
  - Figuren stehen immer auf Feldern, die es im Layout gibt; erlaubte Züge zeigen auf echte Felder
  - die Ansicht jedes Platzes und der Zuschauer lässt sich berechnen und ist JSON
  - Spielstand übersteht Speichern + Laden mitten in der Partie (gleicher Stand danach)
  - Standard-Anzeige (Engine 2.3) ist wohlgeformt: say/alerts/scores/marks/NOTE zeigen auf echte Plätze und Felder
"""
import json
import random
import re
from typing import Optional

from .rooms import GameDef, Room


class ConformanceError(AssertionError):
    pass


def _check(cond, msg):
    if not cond:
        raise ConformanceError(msg)


def _comparable(room: Room) -> dict:
    """Was nach Speichern/Laden gleich sein muss (Verbindungsstatus darf sich ändern)."""
    s = room.state()
    return {"pieces": {k: {"field": v["field"], "kind": v.get("kind")} for k, v in s["pieces"].items()},
            "status": s["status"], "play": s["play"], "seq": room.seq, "settings": s["settings"]}


_TOKEN = re.compile(r"\{(who|[ps](\d+))\}")


def _check_text(text, seats: int, where: str) -> None:
    _check(isinstance(text, str), f"{where}: Text erwartet, nicht {text!r}")
    for m in _TOKEN.finditer(text):
        _check(m.group(2) is None or int(m.group(2)) < seats, f"{where}: Platzhalter {m.group(0)} – so viele Plätze gibt es nicht")


def check_display(st, seats: int, fields: dict, where: str) -> None:
    """Standard-Anzeige im Spielstand prüfen (say, alerts, scores, marks, finished, result)."""
    if not isinstance(st, dict):
        return
    say = st.get("say")
    if say is not None:
        _check(isinstance(say, dict), f"{where}: say muss {{me, all}} sein")
        for k, t in say.items():
            _check(k in ("me", "all"), f"{where}: say.{k} unbekannt")
            _check_text(t, seats, f"{where}: say.{k}")
    for k, t in (st.get("alerts") or {}).items():
        _check(str(k).isdigit() and int(k) < seats, f"{where}: alerts für unbekannten Platz {k}")
        _check_text(t, seats, f"{where}: alerts.{k}")
    if st.get("scores") is not None:
        _check(isinstance(st["scores"], list) and len(st["scores"]) == seats, f"{where}: scores braucht einen Wert je Platz")
    for mk in st.get("marks") or []:
        _check(isinstance(mk, dict) and mk.get("field") in fields, f"{where}: Markierung auf unbekanntem Feld {mk}")
    for s in st.get("finished") or []:
        _check(isinstance(s, int) and 0 <= s < seats, f"{where}: finished enthält unbekannten Platz {s}")
    res = st.get("result")
    if res:
        _check(all(isinstance(w, int) and 0 <= w < seats for w in res.get("winners", [])), f"{where}: result.winners ungültig")


def check_game(game: GameDef, games: int = 10, max_steps: int = 4000, settings: Optional[dict] = None,
               save_every: int = 37, log=print, variants=None) -> dict:
    """Alle Varianten (oder nur `variants`) prüfen. settings gilt zusätzlich zu den conformance_settings der Regeln."""
    total = {"games": 0, "steps": 0, "events": 0}
    for vid in (variants or list(game.variants)):
        v = game.variants[vid]
        s = {**(getattr(v.rules, "conformance_settings", None) or {}), **(settings or {})}
        steps = max(max_steps, int(getattr(v.rules, "conformance_max_steps", 0) or 0))
        st = _check_variant(game, vid, games, steps, s, save_every)
        for k in total:
            total[k] += st[k]
        if log:
            name = game.id if len(game.variants) == 1 else f"{game.id}/{vid}"
            log(f"  OK   {name}: {st['games']} Computer-Partien, {st['steps']} Züge, {st['events']} Ereignisse")
    return total


def _check_variant(game: GameDef, vid: str, games: int, max_steps: int, settings: dict, save_every: int) -> dict:
    v = game.variants[vid]
    _check(v.rules is not None, f"Variante {vid} hat keine Regeln")
    fields = v.layout.get("fields", {})
    stats = {"games": 0, "steps": 0, "events": 0}
    rng = random.Random(7)
    for n in range(games):
        room = Room(f"CONF{n}", game)
        room.ROLL_LOCK_SEC = 0                       # Würfel müssen hier nicht ausrollen
        room.join("host", "Host", False)
        if len(game.variants) > 1:
            room.set_settings("host", {"variant": vid})
        _check(room.variant_id == vid, f"Variante {vid} lässt sich nicht wählen")
        room.stand_up("host")
        for seat in range(room.seats):
            if room.member_at(seat) is None:
                room.add_bot("host", seat)
        _check(room.variant_id == vid, f"Variante {vid}: Computer hinzufügen wechselt das Brett")
        if settings:
            room.set_settings("host", settings)
        seq = room.seq
        events = room.start("host")
        _check(room.status == "playing", f"{vid} Partie {n}: START hat nicht gestartet")

        def consume(msgs, where):
            nonlocal seq
            for m in msgs:
                _check(m.get("type") == "EVENT" and m.get("seq") == seq + 1, f"{where}: Ereignisnummer {m.get('seq')} ≠ {seq + 1}")
                seq = m["seq"]
                _check(isinstance(m["event"].get("type"), str), f"{where}: Ereignis ohne Typ")
                if m["event"]["type"] == "NOTE":
                    _check_text(m["event"].get("text"), room.seats, f"{where}: NOTE")
                    for k, t in (m["event"].get("you") or {}).items():
                        _check(str(k).isdigit() and int(k) < room.seats, f"{where}: NOTE.you für unbekannten Platz {k}")
                        _check_text(t, room.seats, f"{where}: NOTE.you")
                json.dumps(m)
                for mid in room.members:
                    json.dumps(room.personalize(m, mid))
            stats["events"] += len(msgs)

        consume(events, f"Partie {n} Start")
        steps = 0
        while room.status == "playing":
            steps += 1
            _check(steps <= max_steps, f"{vid} Partie {n}: nach {max_steps} Schritten nicht zu Ende")
            for pid, p in room.pieces.items():
                _check(p["field"] in fields, f"Partie {n}: Figur {pid} auf unbekanntem Feld {p['field']}")
            for seat in range(room.seats):
                for a in room.rules.actions(room, seat):
                    _check(isinstance(a.get("type"), str), "Aktion ohne Typ")
                    if a["type"] == "move":
                        _check(a.get("piece") in room.pieces and a.get("to") in fields,
                               f"Partie {n}: Zug auf unbekanntes Feld/Figur {a}")
            for seat in list(range(room.seats)) + [None]:
                st = room.play_state(seat)
                json.dumps(st)
                check_display(st, room.seats, fields, f"{vid} Partie {n}")
            movers = room.rules.to_move(room)
            _check(movers, f"Partie {n}: niemand am Zug, aber Partie läuft")
            seat = movers[0] if len(movers) == 1 else rng.choice(movers)   # mehrere gleichzeitig (Tandem)
            action = room.bot_plan(seat)
            _check(action is not None, f"Partie {n}: Computer findet keine Aktion für Platz {seat}")
            msgs = room.bot_apply(seat, action)
            _check(msgs, f"Partie {n}: Aktion {action} wurde abgelehnt")
            consume(msgs, f"Partie {n} Schritt {steps}")
            if steps % save_every == 0:
                before = _comparable(room)
                restored = Room.from_saved(json.loads(json.dumps(room.to_saved())), game)
                _check(_comparable(restored) == before, f"Partie {n}: Stand nach Speichern/Laden anders")
                restored.ROLL_LOCK_SEC = 0
                for m in restored.members.values():
                    m.connected = True
                room = restored
        stats["games"] += 1
        stats["steps"] += steps
        _check(room.status == "finished", f"Partie {n}: endet nicht sauber")
        _check(room.variant_id == vid, f"Partie {n}: Variante nach Speichern/Laden verloren")
        json.dumps(room.state())
        check_display(room.play_state(), room.seats, fields, f"{vid} Partie {n} Ende")
    return stats
