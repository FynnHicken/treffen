"""Entscheidungen der Computer-Gegner.

Reine Funktionen über GameRoom/Player – kein I/O, kein asyncio. main.py ruft sie im
Bot-Treiber auf und führt die gewählte Aktion über die normalen GameRoom-Methoden aus,
damit für Bots dieselben Regeln gelten wie für Menschen.
"""
from typing import Optional, List

from game_state import SQUARES, COLOR_GROUPS, MAX_BANK_HOUSES, MAX_BANK_HOTELS  # noqa: F401

# Reihenfolge, in der sich Bebauung lohnt (Treffer-Häufigkeit × Mietsprung pro investierter DM).
# Orange/Rot werden am häufigsten betreten, Dunkelblau ist teuer, Braun bringt wenig.
GROUP_PRIORITY = {
    "orange": 8, "red": 7, "yellow": 6, "lightblue": 6, "pink": 5,
    "green": 4, "darkblue": 4, "brown": 2,
}
STREET_GROUPS = [g for g in COLOR_GROUPS if g not in ("station", "utility")]


# ---------------------------------------------------------------------------
# Hilfen
# ---------------------------------------------------------------------------
def _owner(room, idx) -> Optional[str]:
    return room.board_state[idx]["owner"]


def owns_group(room, player_id: str, group: str) -> bool:
    return all(_owner(room, s) == player_id for s in COLOR_GROUPS[group])


def owned_in_group(room, player_id: str, group: str) -> int:
    return sum(1 for s in COLOR_GROUPS[group] if _owner(room, s) == player_id)


def would_complete_group(room, player_id: str, idx: int, extra: Optional[List[int]] = None) -> bool:
    """Hätte player_id nach dem Erwerb von idx (+ extra) die ganze Gruppe?"""
    group = SQUARES[idx].get("group")
    if group not in STREET_GROUPS:
        return False
    gained = set([idx] + list(extra or []))
    return all(_owner(room, s) == player_id or s in gained for s in COLOR_GROUPS[group])


def opponents(room, player) -> list:
    return [p for p in room.players if p.id != player.id and not p.is_bankrupt]


def max_opponent_rent(room, player) -> int:
    """Höchste Miete, die player gerade auf einem gegnerischen Feld zahlen müsste."""
    worst = 0
    for idx, st in room.board_state.items():
        owner = st["owner"]
        if not owner or owner == player.id or st["mortgaged"]:
            continue
        sq = SQUARES[idx]
        if sq["type"] == "property":
            worst = max(worst, room.calculate_rent(idx, 7))
        elif sq["type"] == "station":
            worst = max(worst, room.calculate_rent(idx, 7))
        elif sq["type"] == "utility":
            worst = max(worst, room.calculate_rent(idx, 12))
    return worst


def cash_reserve(room, player) -> int:
    """Wie viel Bargeld der Bot mindestens behalten will.
    Früh im Spiel wenig, sobald Gegner gebaut haben, entsprechend mehr."""
    danger = max_opponent_rent(room, player)
    return max(100, min(700, int(danger * 0.6) + 50))


def unowned_count(room) -> int:
    return sum(1 for st in room.board_state.values() if st["owner"] is None)


# ---------------------------------------------------------------------------
# Kaufen & Versteigern
# ---------------------------------------------------------------------------
def strategic_bonus(room, player, idx: int) -> float:
    """Zusatzwert eines Grundstücks: Gruppe vervollständigen oder Gegner blockieren."""
    sq = SQUARES[idx]
    group = sq.get("group")
    if group in STREET_GROUPS:
        if would_complete_group(room, player.id, idx):
            return 1.0
        for opp in opponents(room, player):
            if would_complete_group(room, opp.id, idx):
                return 0.6  # Blocken: sonst baut der Gegner hier Hotels
        if owned_in_group(room, player.id, group) > 0:
            return 0.25
    elif group == "station":
        return 0.15 * owned_in_group(room, player.id, "station")
    return 0.0


def should_buy(room, player, idx: int) -> bool:
    price = SQUARES[idx]["price"]
    if player.money < price:
        return False
    bonus = strategic_bonus(room, player, idx)
    if bonus >= 0.6:
        return player.money - price >= 50        # wichtige Straße: fast alles einsetzen
    reserve = cash_reserve(room, player)
    if unowned_count(room) > 18:
        reserve = min(reserve, 150)              # Eröffnung: möglichst viel kaufen
    return player.money - price >= reserve


def auction_limit(room, player, idx: int) -> int:
    """Höchstgebot des Bots für eine Versteigerung."""
    price = SQUARES[idx]["price"]
    bonus = strategic_bonus(room, player, idx)
    factor = 0.85 + bonus * 0.5                  # bis 1,35 × Preis für die letzte Straße einer Gruppe
    keep = 50 if bonus >= 0.6 else cash_reserve(room, player)
    return max(0, min(player.money - keep, int(price * factor)))


# ---------------------------------------------------------------------------
# Bauen & Hypotheken ablösen (nur echte Bots – nie für abwesende Menschen)
# ---------------------------------------------------------------------------
def choose_unmortgage(room, player) -> Optional[int]:
    """Hypothek ablösen, wenn genug Geld da ist – zuerst in kompletten Farbgruppen (ermöglicht Bauen)."""
    reserve = cash_reserve(room, player)
    candidates = []
    for idx, st in room.board_state.items():
        if st["owner"] != player.id or not st["mortgaged"]:
            continue
        sq = SQUARES[idx]
        cost = int(round(sq.get("mortgage", sq["price"] // 2) * 1.1))
        if player.money - cost < reserve + 50:
            continue
        group = sq.get("group")
        in_monopoly = group in STREET_GROUPS and owns_group(room, player.id, group)
        candidates.append((0 if in_monopoly else 1, -sq["price"], idx))
    if not candidates:
        return None
    candidates.sort()
    return candidates[0][2]


def choose_build(room, player) -> Optional[int]:
    """Nächstes Feld für ein Haus/Hotel – gleichmäßig, mit Bargeldreserve, bester Gruppe zuerst.
    Bis 3 Häuser ist der Mietsprung am größten, danach erst Hotels."""
    reserve = cash_reserve(room, player)
    best = None
    for group in STREET_GROUPS:
        squares = COLOR_GROUPS[group]
        if not owns_group(room, player.id, group):
            continue
        if any(room.board_state[s]["mortgaged"] for s in squares):
            continue
        min_h = min(room.board_state[s]["houses"] for s in squares)
        if min_h >= 5:
            continue
        idx = next(s for s in squares if room.board_state[s]["houses"] == min_h)
        cost = SQUARES[idx]["house_cost"]
        if player.money - cost < reserve:
            continue
        if min_h < 4 and room.available_bank_houses() <= 0:
            continue
        if min_h == 4 and room.available_bank_hotels() <= 0:
            continue
        # Bewertung: erst alle Gruppen auf 3 Häuser, dann Hotels; innerhalb davon nach Priorität
        score = (0 if min_h < 3 else 1, -GROUP_PRIORITY.get(group, 3), min_h)
        if best is None or score < best[0]:
            best = (score, idx)
    return best[1] if best else None


# ---------------------------------------------------------------------------
# Schulden begleichen
# ---------------------------------------------------------------------------
def resolve_debt(room, player) -> List[dict]:
    """Bringt den Kontostand wieder auf >= 0, mit möglichst wenig Schaden:
    1) Hypothek auf Einzelstraßen/Bahnhöfe/Werke, 2) Häuser der schwächsten Gruppe verkaufen,
    3) restliche Hypotheken. Gibt die ausgeführten Aktionen zurück."""
    actions = []
    guard = 0
    while player.money < 0 and guard < 200:
        guard += 1
        done = False

        # 1) Unbebaute Grundstücke außerhalb kompletter Gruppen beleihen (billigster Verlust zuerst)
        loose = []
        for idx, st in room.board_state.items():
            if st["owner"] != player.id or st["mortgaged"] or st["houses"] > 0:
                continue
            group = SQUARES[idx].get("group")
            in_monopoly = group in STREET_GROUPS and owns_group(room, player.id, group)
            if not in_monopoly:
                loose.append((SQUARES[idx]["price"], idx))
        for _, idx in sorted(loose):
            res = room.toggle_mortgage(player.id, idx)
            if res.get("success"):
                actions.append({"type": "MORTGAGE", "sq_idx": idx})
                done = True
                break
        if done:
            continue

        # 2) Häuser verkaufen – schwächste Gruppe zuerst
        built = [idx for idx, st in room.board_state.items() if st["owner"] == player.id and st["houses"] > 0]
        built.sort(key=lambda i: (GROUP_PRIORITY.get(SQUARES[i].get("group"), 3), -room.board_state[i]["houses"]))
        for idx in built:
            res = room.sell_house(player.id, idx)
            if res.get("success"):
                actions.append({"type": "SELL_HOUSE", "sq_idx": idx})
                done = True
                break
        if done:
            continue

        # 3) Alles andere beleihen
        for idx, st in room.board_state.items():
            if st["owner"] == player.id and not st["mortgaged"] and st["houses"] == 0:
                res = room.toggle_mortgage(player.id, idx)
                if res.get("success"):
                    actions.append({"type": "MORTGAGE", "sq_idx": idx})
                    done = True
                    break
        if not done:
            break
    return actions


# ---------------------------------------------------------------------------
# Gefängnis
# ---------------------------------------------------------------------------
def jail_decision(room, player) -> str:
    """'card', 'bail' oder 'roll'. Früh raus, solange es noch viel zu kaufen gibt;
    spät im Gefängnis sitzen bleiben, wenn draußen teure Mieten drohen."""
    late_game = unowned_count(room) <= 6 and max_opponent_rent(room, player) >= 300
    if late_game and player.jail_turns < 2:
        return "roll"
    if player.jail_cards > 0:
        return "card"
    if player.money >= cash_reserve(room, player) + 50 and (not late_game or player.jail_turns >= 2):
        return "bail"
    return "roll"


# ---------------------------------------------------------------------------
# Handel
# ---------------------------------------------------------------------------
def _side_value(room, receiver, props: List[int], money: int, jail_cards: int) -> float:
    """Wert eines Pakets für receiver – doppelt, wenn es ihm eine Farbgruppe komplettiert."""
    value = money + jail_cards * 50
    for idx in props:
        sq = SQUARES[idx]
        st = room.board_state[idx]
        base = sq["price"]
        if st["mortgaged"]:
            base -= int(round(sq.get("mortgage", sq["price"] // 2) * 1.1))
        if would_complete_group(room, receiver.id, idx, extra=props):
            base *= 2.0
        value += base
    return value


def evaluate_trade(room, bot, trade: dict) -> bool:
    """Nimmt der Bot das Angebot an?
    - Eigene komplette Farbgruppen gibt er nie ab.
    - Komplettiert das Abgegebene eine Gruppe des Partners, zählt es doppelt (umgekehrt genauso).
    - Sonst muss der Gegenwert für den Bot mindestens 10 % über dem Abgegebenen liegen."""
    partner = next((p for p in room.players if p.id == trade["sender_id"]), None)
    if not partner:
        return False
    gets_props, gives_props = trade["offer_props"], trade["req_props"]

    # Eigene komplette Gruppe zerschlagen? Nie.
    for idx in gives_props:
        group = SQUARES[idx].get("group")
        if group in STREET_GROUPS and owns_group(room, bot.id, group):
            return False

    gain = _side_value(room, bot, gets_props, trade["offer_money"], trade["offer_jail_cards"])
    # Was der Bot abgibt, wird aus Sicht des Partners bewertet: komplettiert es dessen Gruppe, zählt es doppelt
    loss = _side_value(room, partner, gives_props, trade["req_money"], trade["req_jail_cards"])

    if bot.money - trade["req_money"] < cash_reserve(room, bot) // 2:
        return False
    return gain >= loss * 1.1


# ---------------------------------------------------------------------------
# Handel zwischen Bots (gegen das Patt "alles verkauft, niemand hat eine Gruppe")
# ---------------------------------------------------------------------------
def _missing_from_single_owner(room, player_id: str, group: str):
    """Fehlende Straßen einer Gruppe, wenn sie alle EINEM anderen Spieler gehören und unbebaut sind."""
    squares = COLOR_GROUPS[group]
    missing = [s for s in squares if _owner(room, s) != player_id]
    if not missing or len(missing) == len(squares):
        return None, []
    owners = {_owner(room, s) for s in missing}
    if len(owners) != 1 or None in owners:
        return None, []
    if any(room.board_state[s]["houses"] > 0 for s in squares):
        return None, []
    return owners.pop(), missing


def find_bot_trade(room, bot) -> Optional[dict]:
    """Sucht einen Handel mit einem anderen BOT, der dem Bot eine Farbgruppe komplettiert:
    bevorzugt ein Tausch, bei dem der Partner ebenfalls eine Gruppe bekommt, sonst Kauf gegen Geld.
    Gibt die Parameter für GameRoom.propose_trade zurück – oder None."""
    reserve = cash_reserve(room, bot)
    for group in sorted(STREET_GROUPS, key=lambda g: -GROUP_PRIORITY.get(g, 3)):
        partner_id, wanted = _missing_from_single_owner(room, bot.id, group)
        if not partner_id:
            continue
        partner = next((p for p in room.players if p.id == partner_id), None)
        if not partner or not partner.is_bot or partner.is_bankrupt:
            continue
        if any(room.board_state[s]["mortgaged"] for s in wanted):
            continue

        # a) Tausch: Partner fehlen Straßen, die alle dem Bot gehören
        for other in STREET_GROUPS:
            if other == group:
                continue
            owner_id, give = _missing_from_single_owner(room, partner.id, other)
            if owner_id != bot.id or any(room.board_state[s]["mortgaged"] for s in give):
                continue
            # Beide Seiten komplettieren eine Gruppe und zählen für den Partner doppelt.
            # Aufpreis so wählen, dass evaluate_trade des Partners (Gewinn >= 1,1 × Verlust) erfüllt ist.
            w_val = sum(SQUARES[s]["price"] for s in wanted)
            g_val = sum(SQUARES[s]["price"] for s in give)
            offer_money = max(0, int(2.2 * w_val - 2.0 * g_val) + 1)
            if bot.money - offer_money < reserve:
                continue
            trade = dict(target_id=partner.id, offer_money=offer_money, offer_props=give,
                         req_money=0, req_props=wanted)
            if evaluate_trade(room, partner, _as_trade(bot, trade)):
                return trade

        # b) Kauf: die fehlende(n) Straße(n) gegen Geld – Partner verlangt das Doppelte (Monopol-Wert)
        price = sum(SQUARES[s]["price"] for s in wanted)
        for factor in (2.3, 2.8):
            offer_money = int(price * factor)
            if bot.money - offer_money < reserve + 150:
                break
            trade = dict(target_id=partner.id, offer_money=offer_money, offer_props=[],
                         req_money=0, req_props=wanted)
            if evaluate_trade(room, partner, _as_trade(bot, trade)):
                return trade
    return None


def _as_trade(sender, t: dict) -> dict:
    return {"sender_id": sender.id, "target_id": t["target_id"],
            "offer_money": t["offer_money"], "offer_props": t["offer_props"],
            "req_money": t["req_money"], "req_props": t["req_props"],
            "offer_jail_cards": 0, "req_jail_cards": 0}
