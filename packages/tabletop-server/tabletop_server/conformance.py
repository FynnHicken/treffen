"""Pflicht-Prüfung für jedes Tisch-Spiel („passt das Spiel zur Engine?“).

Jedes Spiel ruft das in seinen Tests auf; die CI führt es für alle Spiele aus. Bricht ein Engine-Update ein
Spiel, wird die CI rot, bevor es live geht.

    from tabletop_server.conformance import check_game
    check_game(GAME, games=20, settings={"bot_level": 1})

Geprüft wird ohne Netzwerk direkt am Raum:
  - Computer spielen ganze Partien bis zum Ende (kein Hängenbleiben, keine Ausnahme)
  - Ereignisse sind lückenlos nummeriert, haben einen Typ und sind als JSON versendbar
  - Figuren stehen immer auf Feldern, die es im Layout gibt; erlaubte Züge zeigen auf echte Felder
  - die Ansicht jedes Platzes und der Zuschauer lässt sich berechnen und ist JSON
  - Spielstand übersteht Speichern + Laden mitten in der Partie (gleicher Stand danach)
"""
import json
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


def check_game(game: GameDef, games: int = 10, max_steps: int = 4000, settings: Optional[dict] = None,
               save_every: int = 37, log=print) -> dict:
    _check(game.rules is not None, "Spiel hat keine Regeln")
    fields = game.layout.get("fields", {})
    stats = {"games": 0, "steps": 0, "events": 0}
    for n in range(games):
        room = Room(f"CONF{n}", game)
        room.ROLL_LOCK_SEC = 0                       # Würfel müssen hier nicht ausrollen
        room.join("host", "Host", False)
        for seat in range(game.seats):
            if room.member_at(seat) is None:
                room.add_bot("host", seat)
        if settings:
            room.set_settings("host", settings)
        seq = room.seq
        events = room.start("host")
        _check(room.status == "playing", f"Partie {n}: START hat nicht gestartet")

        def consume(msgs, where):
            nonlocal seq
            for m in msgs:
                _check(m.get("type") == "EVENT" and m.get("seq") == seq + 1, f"{where}: Ereignisnummer {m.get('seq')} ≠ {seq + 1}")
                seq = m["seq"]
                _check(isinstance(m["event"].get("type"), str), f"{where}: Ereignis ohne Typ")
                json.dumps(m)
                for mid in room.members:
                    json.dumps(room.personalize(m, mid))
            stats["events"] += len(msgs)

        consume(events, f"Partie {n} Start")
        steps = 0
        while room.status == "playing":
            steps += 1
            _check(steps <= max_steps, f"Partie {n}: nach {max_steps} Schritten nicht zu Ende")
            for pid, p in room.pieces.items():
                _check(p["field"] in fields, f"Partie {n}: Figur {pid} auf unbekanntem Feld {p['field']}")
            for seat in range(game.seats):
                for a in room.rules.actions(room, seat):
                    _check(isinstance(a.get("type"), str), "Aktion ohne Typ")
                    if a["type"] == "move":
                        _check(a.get("piece") in room.pieces and a.get("to") in fields,
                               f"Partie {n}: Zug auf unbekanntes Feld/Figur {a}")
            for seat in list(range(game.seats)) + [None]:
                json.dumps(room.play_state(seat))
            movers = room.rules.to_move(room)
            _check(movers, f"Partie {n}: niemand am Zug, aber Partie läuft")
            seat = movers[0]
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
        json.dumps(room.state())
    if log:
        log(f"  OK   {game.id}: {stats['games']} Computer-Partien, {stats['steps']} Züge, {stats['events']} Ereignisse")
    return stats
