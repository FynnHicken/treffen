import os
import json
import random
import time
from pathlib import Path
from typing import Dict, List, Optional, Any

ASSETS_DIR = Path(__file__).resolve().parent.parent / "static" / "assets"


# 40 standard German Monopoly squares
SQUARES = [
    {"index": 0, "name": "LOS", "type": "go", "price": 0, "group": None},
    {"index": 1, "name": "Badstraße", "type": "property", "price": 60, "group": "brown", "house_cost": 50, "mortgage": 30, "rents": [2, 10, 30, 90, 160, 250]},
    {"index": 2, "name": "Gemeinschaftsfeld", "type": "chest", "price": 0, "group": None},
    {"index": 3, "name": "Turmstraße", "type": "property", "price": 60, "group": "brown", "house_cost": 50, "mortgage": 30, "rents": [4, 20, 60, 180, 320, 450]},
    {"index": 4, "name": "Einkommensteuer", "type": "tax", "price": 200, "group": None},
    {"index": 5, "name": "Südbahnhof", "type": "station", "price": 200, "group": "station", "mortgage": 100, "rents": [25, 50, 100, 200]},
    {"index": 6, "name": "Chausseestraße", "type": "property", "price": 100, "group": "lightblue", "house_cost": 50, "mortgage": 50, "rents": [6, 30, 90, 270, 400, 550]},
    {"index": 7, "name": "Ereignisfeld", "type": "chance", "price": 0, "group": None},
    {"index": 8, "name": "Elisenstraße", "type": "property", "price": 100, "group": "lightblue", "house_cost": 50, "mortgage": 50, "rents": [6, 30, 90, 270, 400, 550]},
    {"index": 9, "name": "Poststraße", "type": "property", "price": 120, "group": "lightblue", "house_cost": 50, "mortgage": 60, "rents": [8, 40, 100, 300, 450, 600]},
    {"index": 10, "name": "Gefängnis", "type": "jail", "price": 0, "group": None},
    {"index": 11, "name": "Seestraße", "type": "property", "price": 140, "group": "pink", "house_cost": 100, "mortgage": 70, "rents": [10, 50, 150, 450, 625, 750]},
    {"index": 12, "name": "Elektrizitätswerk", "type": "utility", "price": 150, "group": "utility", "mortgage": 75},
    {"index": 13, "name": "Hafenstraße", "type": "property", "price": 140, "group": "pink", "house_cost": 100, "mortgage": 70, "rents": [10, 50, 150, 450, 625, 750]},
    {"index": 14, "name": "Neue Straße", "type": "property", "price": 160, "group": "pink", "house_cost": 100, "mortgage": 80, "rents": [12, 60, 180, 500, 700, 900]},
    {"index": 15, "name": "Westbahnhof", "type": "station", "price": 200, "group": "station", "mortgage": 100, "rents": [25, 50, 100, 200]},
    {"index": 16, "name": "Münchner Straße", "type": "property", "price": 180, "group": "orange", "house_cost": 100, "mortgage": 90, "rents": [14, 70, 200, 550, 750, 950]},
    {"index": 17, "name": "Gemeinschaftsfeld", "type": "chest", "price": 0, "group": None},
    {"index": 18, "name": "Wiener Straße", "type": "property", "price": 180, "group": "orange", "house_cost": 100, "mortgage": 90, "rents": [14, 70, 200, 550, 750, 950]},
    {"index": 19, "name": "Berliner Straße", "type": "property", "price": 200, "group": "orange", "house_cost": 100, "mortgage": 100, "rents": [16, 80, 220, 600, 800, 1000]},
    {"index": 20, "name": "Frei Parken", "type": "parking", "price": 0, "group": None},
    {"index": 21, "name": "Theaterstraße", "type": "property", "price": 220, "group": "red", "house_cost": 150, "mortgage": 110, "rents": [18, 90, 250, 700, 875, 1050]},
    {"index": 22, "name": "Ereignisfeld", "type": "chance", "price": 0, "group": None},
    {"index": 23, "name": "Museumstraße", "type": "property", "price": 220, "group": "red", "house_cost": 150, "mortgage": 110, "rents": [18, 90, 250, 700, 875, 1050]},
    {"index": 24, "name": "Opernplatz", "type": "property", "price": 240, "group": "red", "house_cost": 150, "mortgage": 120, "rents": [20, 100, 300, 750, 925, 1100]},
    {"index": 25, "name": "Nordbahnhof", "type": "station", "price": 200, "group": "station", "mortgage": 100, "rents": [25, 50, 100, 200]},
    {"index": 26, "name": "Lessingstraße", "type": "property", "price": 260, "group": "yellow", "house_cost": 150, "mortgage": 130, "rents": [22, 110, 330, 800, 975, 1150]},
    {"index": 27, "name": "Schillerstraße", "type": "property", "price": 260, "group": "yellow", "house_cost": 150, "mortgage": 130, "rents": [22, 110, 330, 800, 975, 1150]},
    {"index": 28, "name": "Wasserwerk", "type": "utility", "price": 150, "group": "utility", "mortgage": 75},
    {"index": 29, "name": "Goethestraße", "type": "property", "price": 280, "group": "yellow", "house_cost": 150, "mortgage": 140, "rents": [24, 120, 360, 850, 1025, 1200]},
    {"index": 30, "name": "Gehe ins Gefängnis", "type": "gotojail", "price": 0, "group": None},
    {"index": 31, "name": "Rathausplatz", "type": "property", "price": 300, "group": "green", "house_cost": 200, "mortgage": 150, "rents": [26, 130, 390, 900, 1100, 1275]},
    {"index": 32, "name": "Hauptstraße", "type": "property", "price": 300, "group": "green", "house_cost": 200, "mortgage": 150, "rents": [26, 130, 390, 900, 1100, 1275]},
    {"index": 33, "name": "Gemeinschaftsfeld", "type": "chest", "price": 0, "group": None},
    {"index": 34, "name": "Bahnhofstraße", "type": "property", "price": 320, "group": "green", "house_cost": 200, "mortgage": 160, "rents": [28, 150, 450, 1000, 1200, 1400]},
    {"index": 35, "name": "Hauptbahnhof", "type": "station", "price": 200, "group": "station", "mortgage": 100, "rents": [25, 50, 100, 200]},
    {"index": 36, "name": "Ereignisfeld", "type": "chance", "price": 0, "group": None},
    {"index": 37, "name": "Parkstraße", "type": "property", "price": 350, "group": "darkblue", "house_cost": 200, "mortgage": 175, "rents": [35, 175, 500, 1100, 1300, 1500]},
    {"index": 38, "name": "Zusatzsteuer", "type": "tax", "price": 100, "group": None},
    {"index": 39, "name": "Schlossallee", "type": "property", "price": 400, "group": "darkblue", "house_cost": 200, "mortgage": 200, "rents": [50, 200, 600, 1400, 1700, 2000]}
]

COLOR_GROUPS = {
    "brown": [1, 3],
    "lightblue": [6, 8, 9],
    "pink": [11, 13, 14],
    "orange": [16, 18, 19],
    "red": [21, 23, 24],
    "yellow": [26, 27, 29],
    "green": [31, 32, 34],
    "darkblue": [37, 39],
    "station": [5, 15, 25, 35],
    "utility": [12, 28]
}

def _load_cards(filename: str, deck_name: str, fallback_cards: list) -> list:
    filepath = ASSETS_DIR / "chance_chest" / filename
    if filepath.exists():
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
            cards = []
            for item in data:
                cards.append({
                    "id": item.get("id"),
                    "deck": deck_name,
                    "text": item.get("text_de", ""),
                    "image": item.get("card_image_filename", ""),
                    "action": item.get("action", ""),
                    "value": item.get("value", 0),
                    "extra_value": item.get("extra_value", 0),
                    "target_tile": item.get("target_tile"),
                    "illustration": item.get("illustration", "")
                })
            if cards:
                return cards
        except Exception as e:
            print(f"Warning: Failed to load {filename}: {e}")
    return fallback_cards

FALLBACK_COMMUNITY_CHEST_CARDS = [
    {"id": 1, "deck": "Gemeinschaft", "text": "Du erhältst eine Beratungsgebühr von £25.", "image": "gemeinschaft_01.png", "action": "RECEIVE_MONEY", "value": 25},
    {"id": 2, "deck": "Gemeinschaft", "text": "Aus Lagerverkäufen erhältst du: £50", "image": "gemeinschaft_02.png", "action": "RECEIVE_MONEY", "value": 50},
    {"id": 3, "deck": "Gemeinschaft", "text": "Bankfehler zu deinen Gunsten. Ziehe £200 ein.", "image": "gemeinschaft_03.png", "action": "RECEIVE_MONEY", "value": 200},
    {"id": 4, "deck": "Gemeinschaft", "text": "Deine Lebensversicherung wird fällig. Du erhältst £100.", "image": "gemeinschaft_04.png", "action": "RECEIVE_MONEY", "value": 100},
    {"id": 5, "deck": "Gemeinschaft", "text": "Zweiter Preis im Schönheitswettbewerb. Du erhältst £10.", "image": "gemeinschaft_05.png", "action": "RECEIVE_MONEY", "value": 10},
    {"id": 6, "deck": "Gemeinschaft", "text": "Du erbst £100.", "image": "gemeinschaft_06.png", "action": "RECEIVE_MONEY", "value": 100},
    {"id": 7, "deck": "Gemeinschaft", "text": "Einkommensteuer-Rückzahlung. Du erhältst £20.", "image": "gemeinschaft_07.png", "action": "RECEIVE_MONEY", "value": 20},
    {"id": 8, "deck": "Gemeinschaft", "text": "Urlaubsgeld! Du erhältst £100.", "image": "gemeinschaft_08.png", "action": "RECEIVE_MONEY", "value": 100},
    {"id": 9, "deck": "Gemeinschaft", "text": "Du hast Geburtstag! Jeder Spieler schenkt dir £10.", "image": "gemeinschaft_09.png", "action": "RECEIVE_FROM_PLAYERS", "value": 10},
    {"id": 10, "deck": "Gemeinschaft", "text": "Zahle Schulgeld: £50.", "image": "gemeinschaft_10.png", "action": "PAY_MONEY", "value": 50},
    {"id": 11, "deck": "Gemeinschaft", "text": "Arztkosten. Zahle £50.", "image": "gemeinschaft_11.png", "action": "PAY_MONEY", "value": 50},
    {"id": 12, "deck": "Gemeinschaft", "text": "Krankenhausgebühr: Du zahlst £100.", "image": "gemeinschaft_12.png", "action": "PAY_MONEY", "value": 100},
    {"id": 13, "deck": "Gemeinschaft", "text": "Kosten für Straßenausbesserungen. Zahle: £40 pro Haus, £115 pro Hotel.", "image": "gemeinschaft_13.png", "action": "PAY_FOR_BUILDINGS", "value": 40, "extra_value": 115},
    {"id": 14, "deck": "Gemeinschaft", "text": "Rücke vor bis auf LOS. (Ziehe £200 ein.)", "image": "gemeinschaft_14.png", "action": "MOVE_TO_TILE", "target_tile": 0},
    {"id": 15, "deck": "Gemeinschaft", "text": "Gehe in das Gefängnis! Begib dich direkt dorthin.", "image": "gemeinschaft_15.png", "action": "GO_TO_JAIL"},
    {"id": 16, "deck": "Gemeinschaft", "text": "Du kommst aus dem Gefängnis frei. Behalte diese Karte, bis du sie benötigst oder verkaufst.", "image": "gemeinschaft_16.png", "action": "GET_OUT_OF_JAIL_FREE"}
]

FALLBACK_CHANCE_CARDS = [
    {"id": 1, "deck": "Ereignis", "text": "Die Bank zahlt dir eine Dividende von £50.", "image": "ereignis_01.png", "action": "RECEIVE_MONEY", "value": 50},
    {"id": 2, "deck": "Ereignis", "text": "Dein Bausparvertrag wird fällig. Du erhältst £150.", "image": "ereignis_02.png", "action": "RECEIVE_MONEY", "value": 150},
    {"id": 3, "deck": "Ereignis", "text": "Strafzettel! Zahle £15.", "image": "ereignis_03.png", "action": "PAY_MONEY", "value": 15},
    {"id": 4, "deck": "Ereignis", "text": "Du lässt deine Häuser renovieren: Zahle £25 pro Haus und £100 pro Hotel.", "image": "ereignis_04.png", "action": "PAY_FOR_BUILDINGS", "value": 25, "extra_value": 100},
    {"id": 5, "deck": "Ereignis", "text": "Du bist zum Vorstand gewählt worden. Zahle jedem Spieler £50.", "image": "ereignis_05.png", "action": "PAY_EACH_PLAYER", "value": 50},
    {"id": 6, "deck": "Ereignis", "text": "Rücke vor bis auf LOS. (Ziehe £200 ein.)", "image": "ereignis_06.png", "action": "MOVE_TO_TILE", "target_tile": 0},
    {"id": 7, "deck": "Ereignis", "text": "Mache einen Ausflug zum Südbahnhof. Wenn du über LOS kommst, ziehe £200 ein.", "image": "ereignis_07.png", "action": "MOVE_TO_TILE", "target_tile": 5},
    {"id": 8, "deck": "Ereignis", "text": "Rücke vor bis zur Seestraße. Wenn du über LOS kommst, ziehe £200 ein.", "image": "ereignis_08.png", "action": "MOVE_TO_TILE", "target_tile": 11},
    {"id": 9, "deck": "Ereignis", "text": "Rücke vor bis zum Opernplatz. Wenn du über LOS kommst, ziehe £200 ein.", "image": "ereignis_09.png", "action": "MOVE_TO_TILE", "target_tile": 24},
    {"id": 10, "deck": "Ereignis", "text": "Rücke vor bis zur Schlossallee.", "image": "ereignis_10.png", "action": "MOVE_TO_TILE", "target_tile": 39},
    {"id": 11, "deck": "Ereignis", "text": "Rücke vor bis zum nächsten Bahnhof. Der Eigentümer erhält das Doppelte der normalen Miete.", "image": "ereignis_11.png", "action": "MOVE_TO_NEAREST_RAILROAD"},
    {"id": 12, "deck": "Ereignis", "text": "Rücke vor bis zum nächsten Bahnhof. Der Eigentümer erhält das Doppelte der normalen Miete.", "image": "ereignis_12.png", "action": "MOVE_TO_NEAREST_RAILROAD"},
    {"id": 13, "deck": "Ereignis", "text": "Rücke vor bis zum nächsten Werk. Würfel und zahle dem Eigentümer das 10-fache.", "image": "ereignis_13.png", "action": "MOVE_TO_NEAREST_UTILITY"},
    {"id": 14, "deck": "Ereignis", "text": "Gehe 3 Felder zurück.", "image": "ereignis_14.png", "action": "MOVE_BACK_N_TILES", "value": 3},
    {"id": 15, "deck": "Ereignis", "text": "Gehe in das Gefängnis! Begib dich direkt dorthin.", "image": "ereignis_15.png", "action": "GO_TO_JAIL"},
    {"id": 16, "deck": "Ereignis", "text": "Du kommst aus dem Gefängnis frei. Behalte diese Karte, bis du sie benötigst oder verkaufst.", "image": "ereignis_16.png", "action": "GET_OUT_OF_JAIL_FREE"}
]

COMMUNITY_CHEST_CARDS = _load_cards("gemeinschaftskarten.json", "Gemeinschaft", FALLBACK_COMMUNITY_CHEST_CARDS)
CHANCE_CARDS = _load_cards("ereigniskarten.json", "Ereignis", FALLBACK_CHANCE_CARDS)

TOKEN_OPTIONS = [
    {"id": "dog", "name": "Terrier (Hund)", "model": "token_dog.obj", "icon": "hund_icon.png"},
    {"id": "hat", "name": "Zylinder", "model": "token_hat.obj", "icon": "zylinder_icon.png"},
    {"id": "boot", "name": "Stiefel", "model": "token_boot.obj", "icon": "schuh_icon.png"},
    {"id": "iron", "name": "Bügeleisen", "model": "token_iron.obj", "icon": "buegeleisen_icon.png"},
    {"id": "ship", "name": "Schlachtschiff", "model": "token_ship.obj", "icon": "schlachtschiff_icon.png"},
    {"id": "car", "name": "Rennwagen", "model": "token_car.obj", "icon": "rennwagen_icon.png"},
    {"id": "thimble", "name": "Fingerhut", "model": "token_thimble.obj", "icon": "fingerhut_icon.png"},
    {"id": "wheelbarrow", "name": "Schubkarre", "model": "token_wheelbarrow.obj", "icon": "schubkarre_icon.png"}
]

PLAYER_COLORS = [
    {"name": "Rot", "hex": "#e74c3c"},
    {"name": "Blau", "hex": "#3498db"},
    {"name": "Grün", "hex": "#2ecc71"},
    {"name": "Gelb", "hex": "#f1c40f"},
    {"name": "Orange", "hex": "#e67e22"},
    {"name": "Lila", "hex": "#9b59b6"},
    {"name": "Türkis", "hex": "#1abc9c"},
    {"name": "Pink", "hex": "#fd79a8"}
]

MAX_BANK_HOUSES = 32
MAX_BANK_HOTELS = 12


class Player:
    def __init__(self, player_id: str, name: str, token: str, color: str, is_bot: bool = False):
        self.id = player_id
        self.name = name
        self.token = token
        self.color = color
        self.money = 1500
        self.position = 0
        self.in_jail = False
        self.jail_turns = 0
        self.jail_cards = 0
        self.is_bankrupt = False
        self.is_bot = is_bot
        self.doubles_count = 0
        self.creditor_id: Optional[str] = None

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "token": self.token,
            "color": self.color,
            "money": self.money,
            "position": self.position,
            "in_jail": self.in_jail,
            "jail_turns": self.jail_turns,
            "jail_cards": self.jail_cards,
            "is_bankrupt": self.is_bankrupt,
            "is_bot": self.is_bot,
            "creditor_id": self.creditor_id
        }


class GameRoom:
    def __init__(self, room_id: str, host_id: str, party_id: Optional[str] = None):
        self.room_id = room_id
        self.host_id = host_id
        self.party_id = party_id
        self.status = "LOBBY"  # LOBBY, PLAYING, GAME_OVER
        self.players: List[Player] = []
        self.current_player_idx = 0
        self.dice = [1, 1]
        self.rolled = False
        self.last_card: Optional[dict] = None
        self.board_state = {
            i: {
                "owner": None,
                "houses": 0,  # 0..4 = houses, 5 = hotel
                "mortgaged": False
            } for i in range(40) if SQUARES[i]["type"] in ["property", "station", "utility"]
        }
        self.logs: List[str] = []
        self.chance_deck = list(range(len(CHANCE_CARDS)))
        random.shuffle(self.chance_deck)
        self.chest_deck = list(range(len(COMMUNITY_CHEST_CARDS)))
        random.shuffle(self.chest_deck)
        self.pending_action: Optional[dict] = None
        self.pending_trade: Optional[dict] = None
        self.auction_state: Optional[dict] = None
        self.winner: Optional[dict] = None
        self.created_at = time.time()
        self.log(f"Raum {room_id} erstellt.")

    def log(self, message: str):
        self.logs.append(message)
        if len(self.logs) > 60:
            self.logs.pop(0)

    def available_bank_houses(self) -> int:
        used = sum(st["houses"] for st in self.board_state.values() if 0 < st["houses"] < 5)
        return max(0, MAX_BANK_HOUSES - used)

    def available_bank_hotels(self) -> int:
        used = sum(1 for st in self.board_state.values() if st["houses"] == 5)
        return max(0, MAX_BANK_HOTELS - used)

    def calculate_player_wealth(self, player: Player) -> int:
        """Berechnet das Gesamtvermögen (Bargeld + Kaufpreise aller Grundstücke + Kaufpreise aller Häuser/Hotels)."""
        total = max(0, player.money)
        for sq_idx, st in self.board_state.items():
            if st["owner"] == player.id:
                sq = SQUARES[sq_idx]
                total += sq.get("price", 0)
                houses = st.get("houses", 0)
                if houses > 0:
                    total += houses * sq.get("house_cost", 0)
        return total

    def _record_payment(self, payer: Player, amount: int, creditor_id: str = "BANK"):
        payer.money -= amount
        if payer.money < 0:
            payer.creditor_id = creditor_id
            self.log(f"⚠️ {payer.name} ist im Minus ({payer.money} DM)! Häuser verkaufen, Hypothek aufnehmen oder Bankrott erklären.")
        else:
            payer.creditor_id = None

    def _credit_money(self, player: Player, amount: int):
        player.money += amount
        if player.money >= 0:
            player.creditor_id = None

    def add_player(self, player_id: str, name: str, token: str, color: str, is_bot: bool = False) -> Player:
        for p in self.players:
            if p.id == player_id:
                p.name = name
                p.token = token
                p.color = color
                for other in self.players:
                    if other.id != player_id and other.is_bot:
                        if other.token == token:
                            used_t = {x.token for x in self.players if x.id != other.id}
                            for opt in TOKEN_OPTIONS:
                                if opt["id"] not in used_t:
                                    other.token = opt["id"]
                                    break
                        if other.color == color:
                            used_c = {x.color for x in self.players if x.id != other.id}
                            for c in PLAYER_COLORS:
                                if c["hex"] not in used_c:
                                    other.color = c["hex"]
                                    break
                return p

        if is_bot:
            used_tokens = {p.token for p in self.players}
            if token in used_tokens:
                for opt in TOKEN_OPTIONS:
                    if opt["id"] not in used_tokens:
                        token = opt["id"]
                        break
            used_colors = {p.color for p in self.players}
            if color in used_colors:
                for c in PLAYER_COLORS:
                    if c["hex"] not in used_colors:
                        color = c["hex"]
                        break
        else:
            human_tokens = {p.token for p in self.players if not p.is_bot}
            if token in human_tokens:
                all_used = {p.token for p in self.players}
                for opt in TOKEN_OPTIONS:
                    if opt["id"] not in all_used:
                        token = opt["id"]
                        break
            human_colors = {p.color for p in self.players if not p.is_bot}
            if color in human_colors:
                all_used_c = {p.color for p in self.players}
                for c in PLAYER_COLORS:
                    if c["hex"] not in all_used_c:
                        color = c["hex"]
                        break

        p = Player(player_id, name, token, color, is_bot)
        self.players.append(p)
        if not is_bot:
            for other in self.players:
                if other.id != player_id and other.is_bot:
                    if other.token == token:
                        used_t = {x.token for x in self.players if x.id != other.id}
                        for opt in TOKEN_OPTIONS:
                            if opt["id"] not in used_t:
                                other.token = opt["id"]
                                break
                    if other.color == color:
                        used_c = {x.color for x in self.players if x.id != other.id}
                        for c in PLAYER_COLORS:
                            if c["hex"] not in used_c:
                                other.color = c["hex"]
                                break
        self.log(f"{name} ist dem Spiel beigetreten ({p.token}).")
        return p

    def remove_player(self, player_id: str):
        self.players = [p for p in self.players if p.id != player_id]
        if self.players and self.host_id == player_id:
            self.host_id = self.players[0].id
        if self.current_player_idx >= len(self.players) and self.players:
            self.current_player_idx = 0

    def _reset_round_state(self):
        for p in self.players:
            p.money = 1500
            p.position = 0
            p.in_jail = False
            p.jail_turns = 0
            p.jail_cards = 0
            p.is_bankrupt = False
            p.doubles_count = 0
            p.creditor_id = None
        self.board_state = {
            i: {
                "owner": None,
                "houses": 0,
                "mortgaged": False
            } for i in range(40) if SQUARES[i]["type"] in ["property", "station", "utility"]
        }
        self.chance_deck = list(range(len(CHANCE_CARDS)))
        random.shuffle(self.chance_deck)
        self.chest_deck = list(range(len(COMMUNITY_CHEST_CARDS)))
        random.shuffle(self.chest_deck)
        self.rolled = False
        self.pending_action = None
        self.pending_trade = None
        self.auction_state = None
        self.last_card = None
        self.winner = None

    def reset_to_lobby(self):
        self._reset_round_state()
        self.status = "LOBBY"
        self.log("🔄 Raum wurde für eine neue Runde in die Lobby zurückgesetzt.")

    def start_game(self):
        if len(self.players) < 2:
            raise ValueError("Mindestens 2 Spieler erforderlich.")
        self._reset_round_state()
        self.status = "PLAYING"
        # Startspieler mit einem Würfel auswürfeln (Parker-Regel Seite 1)
        rolls = {}
        best_roll = -1
        winner_idx = 0
        for idx, p in enumerate(self.players):
            r = random.randint(1, 6)
            rolls[p.name] = r
            if r > best_roll:
                best_roll = r
                winner_idx = idx
        roll_summary = ", ".join(f"{name}: {val}" for name, val in rolls.items())
        self.current_player_idx = winner_idx
        starter = self.players[self.current_player_idx]
        self.log(f"🎲 Startspieler-Auswürfeln ({roll_summary}) → {starter.name} beginnt!")
        self.log("Das Monopoly-Spiel hat begonnen! Möge der beste Immobilienmogul gewinnen!")

    def current_player(self) -> Optional[Player]:
        if not self.players:
            return None
        return self.players[self.current_player_idx % len(self.players)]

    def roll_dice(self) -> dict:
        player = self.current_player()
        if not player or self.status != "PLAYING":
            return {"error": "Nicht im Spiel."}
        if self.auction_state:
            return {"error": "Bitte zuerst die laufende Versteigerung abschließen."}
        if self.rolled:
            return {"error": "Bereits gewürfelt."}

        d1 = random.randint(1, 6)
        d2 = random.randint(1, 6)
        self.dice = [d1, d2]
        self.rolled = True
        self.last_card = None
        is_double = (d1 == d2)

        steps = d1 + d2
        self.log(f"{player.name} würfelt eine {d1} und {d2} (Gesamt: {steps})!")

        # Handle Jail
        if player.in_jail:
            if is_double:
                player.in_jail = False
                player.jail_turns = 0
                player.doubles_count = 0
                self.log(f"Pasch! {player.name} kommt frei aus dem Gefängnis (kein Zusatzwurf nach Gefängnis-Pasch)!")
                return self.move_player(player, steps, False)
            else:
                player.jail_turns += 1
                if player.jail_turns >= 3:
                    self._record_payment(player, 50, "BANK")
                    player.in_jail = False
                    player.jail_turns = 0
                    self.log(f"{player.name} muss nach dem 3. Versuch 50 DM Bußgeld zahlen und zieht {steps} Felder weiter!")
                    return self.move_player(player, steps, False)
                else:
                    self.log(f"{player.name} bleibt im Gefängnis (Versuch {player.jail_turns}/3).")
                    self.pending_action = {"type": "END_TURN"}
                    return {
                        "dice": self.dice,
                        "double": is_double,
                        "player": player.to_dict(),
                        "action": self.pending_action
                    }

        # Doubles counter
        if is_double:
            player.doubles_count += 1
            if player.doubles_count >= 3:
                self.send_to_jail(player)
                self.log(f"3 Paschs in Folge! {player.name} geht direkt ins Gefängnis!")
                self.pending_action = {"type": "END_TURN"}
                return {
                    "dice": self.dice,
                    "double": True,
                    "player": player.to_dict(),
                    "action": self.pending_action
                }
        else:
            player.doubles_count = 0

        return self.move_player(player, steps, is_double)

    def _check_doubles_reroll(self, player: Optional[Player] = None) -> bool:
        curr = player or self.current_player()
        if not curr or curr != self.current_player():
            return False
        d1, d2 = self.dice
        if d1 != d2 or curr.in_jail or curr.is_bankrupt or curr.doubles_count <= 0:
            return False
        if curr.money < 0 or self.auction_state:
            return False
        if self.pending_action and self.pending_action.get("type") in ["BUY_OR_AUCTION", "TAX_CHOICE", "CARD_DRAWN"]:
            return False
        if self.rolled:
            self.rolled = False
            self.log(f"🎲 Pasch! {curr.name} darf direkt noch einmal würfeln!")
            return True
        return False

    def move_player(self, player: Player, steps: int, is_double: bool) -> dict:
        old_pos = player.position
        new_pos = (old_pos + steps) % 40

        # Check if reached or passed GO in forward direction
        passed_go = (new_pos < old_pos and steps > 0)
        if passed_go:
            self._credit_money(player, 200)
            self.log(f"{player.name} erreicht/passiert LOS und zieht 200 DM Gehalt ein!")

        player.position = new_pos
        square = SQUARES[new_pos]
        if new_pos == 10 and not player.in_jail:
            self.log(f"{player.name} landet auf Gefängnis (Nur zu Besuch).")
        else:
            self.log(f"{player.name} landet auf {square['name']}.")

        # Handle square logic
        action = self.evaluate_square(player, square, steps)
        self.pending_action = action
        self._check_doubles_reroll(player)

        return {
            "dice": self.dice,
            "double": is_double,
            "old_pos": old_pos,
            "new_pos": new_pos,
            "final_pos": player.position,
            "passed_go": passed_go,
            "player": player.to_dict(),
            "action": action
        }

    def evaluate_square(
        self,
        player: Player,
        square: dict,
        roll_sum: int,
        rent_multiplier: int = 1,
        force_utility_ten_x: bool = False
    ) -> dict:
        sq_type = square["type"]
        idx = square["index"]

        if sq_type in ["property", "station", "utility"]:
            prop_state = self.board_state[idx]
            owner_id = prop_state["owner"]

            if owner_id is None:
                return {
                    "type": "BUY_OR_AUCTION",
                    "square": square,
                    "price": square["price"]
                }
            elif owner_id != player.id:
                if prop_state["mortgaged"]:
                    self.log(f"{square['name']} ist mit Hypothek belastet. Keine Miete fällig.")
                    return {"type": "END_TURN"}

                owner = next((p for p in self.players if p.id == owner_id), None)
                if not owner or owner.is_bankrupt:
                    return {"type": "END_TURN"}

                if sq_type == "utility" and force_utility_ten_x:
                    rent = max(2, roll_sum) * 10
                else:
                    rent = self.calculate_rent(idx, roll_sum) * rent_multiplier

                self._record_payment(player, rent, owner.id)
                self._credit_money(owner, rent)
                if rent_multiplier > 1:
                    self.log(f"🚂 {player.name} zahlt doppelte Miete ({rent} DM) an {owner.name}!")
                elif force_utility_ten_x:
                    self.log(f"💡 {player.name} zahlt 10-fache Würfelsumme ({rent} DM) an {owner.name}!")
                else:
                    self.log(f"{player.name} zahlt {rent} DM Miete an {owner.name}!")
                return {
                    "type": "RENT_PAID",
                    "rent": rent,
                    "payer_id": player.id,
                    "payer": player.name,
                    "owner_id": owner.id,
                    "owner": owner.name,
                    "square_name": square["name"],
                    "square_idx": idx,
                    "group": square.get("group"),
                    "rent_multiplier": rent_multiplier,
                    "force_utility_ten_x": force_utility_ten_x
                }
            else:
                self.log(f"{player.name} besucht das eigene Grundstück.")
                return {"type": "END_TURN"}

        elif sq_type == "tax":
            tax = square["price"]
            if idx == 4:  # Einkommensteuer: 200 DM oder 10% des Gesamtvermögens (Parker-Regel Seite 2)
                wealth = self.calculate_player_wealth(player)
                ten_pct = max(1, round(wealth * 0.10))
                if player.is_bot:
                    chosen = min(tax, ten_pct)
                    self._record_payment(player, chosen, "BANK")
                    self.log(f"{player.name} zahlt {chosen} DM Einkommensteuer ({'10% Vermögen' if chosen == ten_pct and ten_pct < tax else 'Pauschalbetrag'})!")
                    return {"type": "TAX_PAID", "tax": chosen}
                return {
                    "type": "TAX_CHOICE",
                    "square": square,
                    "flat_tax": tax,
                    "percent_tax": ten_pct,
                    "wealth": wealth
                }
            else:
                self._record_payment(player, tax, "BANK")
                self.log(f"{player.name} zahlt {tax} DM {square['name']}!")
                return {"type": "TAX_PAID", "tax": tax}

        elif sq_type == "gotojail":
            self.send_to_jail(player)
            return {"type": "WENT_TO_JAIL"}

        elif sq_type == "chance":
            card = self.draw_chance_card(player, roll_sum)
            self.last_card = {
                "deck": "Ereignis",
                "card": card,
                "text": card.get("text", ""),
                "image": card.get("image") or card.get("card_image_filename", ""),
                "player": player.name
            }
            card_text = card.get("text") or card.get("text_de", "")
            self.log(f"🃏 {player.name} zieht eine Ereigniskarte: {card_text}")
            return {
                "type": "CARD_DRAWN",
                "deck": "Ereignis",
                "card": card,
                "player": player.name,
                "roll_sum": roll_sum
            }

        elif sq_type == "chest":
            card = self.draw_chest_card(player)
            self.last_card = {
                "deck": "Gemeinschaft",
                "card": card,
                "text": card.get("text", ""),
                "image": card.get("image") or card.get("card_image_filename", ""),
                "player": player.name
            }
            card_text = card.get("text") or card.get("text_de", "")
            self.log(f"🃏 {player.name} zieht eine Gemeinschaftskarte: {card_text}")
            return {
                "type": "CARD_DRAWN",
                "deck": "Gemeinschaft",
                "card": card,
                "player": player.name,
                "roll_sum": roll_sum
            }

        elif sq_type in ["go", "parking", "jail"]:
            return {"type": "END_TURN"}

        return {"type": "END_TURN"}

    def confirm_card(self, player_id: str) -> dict:
        player = self.current_player()
        if not player or player.id != player_id:
            return {"error": "Du bist nicht am Zug."}
        if not self.pending_action or self.pending_action.get("type") != "CARD_DRAWN":
            return {"error": "Keine offene Karte zu bestätigen."}

        card = self.pending_action.get("card", {})
        deck = self.pending_action.get("deck", "Ereignis")
        roll_sum = self.pending_action.get("roll_sum", sum(self.dice))
        old_pos = player.position
        old_money = player.money

        self.pending_action = None
        self.apply_card(player, card, roll_sum)

        new_pos = player.position
        moved = (new_pos != old_pos)
        passed_go = (moved and not player.in_jail and (player.money - old_money) >= 200)

        if self.pending_action is None:
            if player.in_jail and moved:
                self.pending_action = {"type": "WENT_TO_JAIL"}
            else:
                self.pending_action = {"type": "END_TURN"}

        self._check_doubles_reroll(player)

        return {
            "success": True,
            "deck": deck,
            "card": card,
            "old_pos": old_pos,
            "new_pos": new_pos,
            "moved": moved,
            "passed_go": passed_go,
            "player": player.to_dict(),
            "action": self.pending_action
        }

    def pay_income_tax(self, player_id: str, mode: str = "flat") -> dict:
        player = self.current_player()
        if not player or player.id != player_id:
            return {"error": "Du bist nicht am Zug."}
        if not self.pending_action or self.pending_action.get("type") != "TAX_CHOICE":
            return {"error": "Keine offene Einkommensteuer-Entscheidung."}

        flat_tax = self.pending_action.get("flat_tax", 200)
        percent_tax = self.pending_action.get("percent_tax", 200)
        amount = percent_tax if mode == "percent" else flat_tax
        label = f"10% des Vermögens ({amount} DM)" if mode == "percent" else f"Pauschalbetrag ({amount} DM)"
        self._record_payment(player, amount, "BANK")
        self.log(f"💸 {player.name} wählt bei der Einkommensteuer: {label}.")
        self.pending_action = {"type": "TAX_PAID", "tax": amount}
        self._check_doubles_reroll(player)
        return {"success": True, "tax": amount, "player": player.to_dict()}

    def calculate_rent(self, sq_idx: int, roll_sum: int) -> int:
        square = SQUARES[sq_idx]
        state = self.board_state[sq_idx]
        owner_id = state["owner"]
        if not owner_id:
            return 0

        sq_type = square["type"]
        group = square["group"]

        if sq_type == "property":
            houses = state["houses"]
            if houses == 0:
                base = square["rents"][0]
                # Laut Parker-Regel (Seite 2, "3. Miete") verdoppelt sich die Miete auf unbebauten
                # Grundstücken einer vollständigen Farbgruppe auch dann, wenn andere Straßen der Gruppe belastet sind.
                group_squares = COLOR_GROUPS[group]
                all_owned = all(self.board_state[s]["owner"] == owner_id for s in group_squares)
                return base * 2 if all_owned else base
            else:
                return square["rents"][houses]

        elif sq_type == "station":
            stations = COLOR_GROUPS["station"]
            owned_count = sum(1 for s in stations if self.board_state[s]["owner"] == owner_id)
            return square["rents"][max(0, owned_count - 1)]

        elif sq_type == "utility":
            utilities = COLOR_GROUPS["utility"]
            owned_count = sum(1 for s in utilities if self.board_state[s]["owner"] == owner_id)
            multiplier = 10 if owned_count >= 2 else 4
            return roll_sum * multiplier

        return 0

    def send_to_jail(self, player: Player):
        player.position = 10
        player.in_jail = True
        player.jail_turns = 0
        player.doubles_count = 0
        self.log(f"🚔 {player.name} wurde ins Gefängnis gesteckt!")

    def draw_chance_card(self, player: Player, roll_sum: int) -> dict:
        if not self.chance_deck:
            self.chance_deck = list(range(len(CHANCE_CARDS)))
            random.shuffle(self.chance_deck)
        c_idx = self.chance_deck.pop(0)
        card = CHANCE_CARDS[c_idx]
        # Karte wieder unten unter den Stapel schieben (außer Gefängnisfrei-Karte)
        if card.get("action") not in ["GET_OUT_OF_JAIL_FREE", "jail_free"]:
            self.chance_deck.append(c_idx)
        return card

    def draw_chest_card(self, player: Player) -> dict:
        if not self.chest_deck:
            self.chest_deck = list(range(len(COMMUNITY_CHEST_CARDS)))
            random.shuffle(self.chest_deck)
        c_idx = self.chest_deck.pop(0)
        card = COMMUNITY_CHEST_CARDS[c_idx]
        if card.get("action") not in ["GET_OUT_OF_JAIL_FREE", "jail_free"]:
            self.chest_deck.append(c_idx)
        return card

    def apply_card(self, player: Player, card: dict, roll_sum: int):
        act = card.get("action", "")

        if act in ["RECEIVE_MONEY", "money"]:
            amt = card.get("value") if "value" in card else card.get("amount", 0)
            if amt >= 0:
                self._credit_money(player, amt)
                self.log(f"💰 {player.name} erhält {amt} DM.")
            else:
                self._record_payment(player, -amt, "BANK")
                self.log(f"💸 {player.name} zahlt {-amt} DM.")

        elif act in ["PAY_MONEY"]:
            amt = card.get("value", 0)
            self._record_payment(player, amt, "BANK")
            self.log(f"💸 {player.name} zahlt {amt} DM.")

        elif act in ["MOVE_TO_TILE", "goto"]:
            target = card.get("target_tile") if ("target_tile" in card and card["target_tile"] is not None) else card.get("pos", 0)
            passed_go = (target < player.position) or (target == 0 and player.position != 0)
            if passed_go:
                self._credit_money(player, 200)
                self.log(f"🏃 {player.name} erreicht/passiert LOS und erhält 200 DM!")
            player.position = target
            sq = SQUARES[target]
            if sq["type"] != "go":
                self.pending_action = self.evaluate_square(player, sq, roll_sum)

        elif act in ["MOVE_BACK_N_TILES", "back3"]:
            steps = card.get("value") or 3
            player.position = (player.position - steps) % 40
            sq = SQUARES[player.position]
            self.pending_action = self.evaluate_square(player, sq, roll_sum)

        elif act in ["MOVE_TO_NEAREST_RAILROAD", "nearest_station"]:
            stations = [5, 15, 25, 35]
            pos = player.position
            target = min([s for s in stations if s > pos] or [stations[0]])
            if target < pos:
                self._credit_money(player, 200)
                self.log(f"🏃 {player.name} zieht über LOS und erhält 200 DM!")
            player.position = target
            sq = SQUARES[target]
            self.pending_action = self.evaluate_square(player, sq, roll_sum, rent_multiplier=2)

        elif act in ["MOVE_TO_NEAREST_UTILITY", "nearest_utility"]:
            utils = [12, 28]
            pos = player.position
            target = min([u for u in utils if u > pos] or [utils[0]])
            if target < pos:
                self._credit_money(player, 200)
                self.log(f"🏃 {player.name} zieht über LOS und erhält 200 DM!")
            player.position = target
            sq = SQUARES[target]
            u_d1, u_d2 = random.randint(1, 6), random.randint(1, 6)
            u_sum = u_d1 + u_d2
            prop_state = self.board_state.get(target, {})
            if prop_state.get("owner") and prop_state.get("owner") != player.id and not prop_state.get("mortgaged"):
                self.log(f"🎲 {player.name} würfelt für das Werk {u_d1} + {u_d2} = {u_sum} (10-fache Miete)!")
            self.pending_action = self.evaluate_square(player, sq, u_sum, force_utility_ten_x=True)

        elif act in ["PAY_FOR_BUILDINGS", "repairs"]:
            h_cost = card.get("value") if ("value" in card and card["value"]) else card.get("house", 25)
            hot_cost = card.get("extra_value") if ("extra_value" in card and card["extra_value"]) else card.get("hotel", 100)
            total = 0
            for sq_idx, st in self.board_state.items():
                if st["owner"] == player.id:
                    if st["houses"] == 5:
                        total += hot_cost
                    else:
                        total += st["houses"] * h_cost
            self._record_payment(player, total, "BANK")
            self.log(f"🏚️ {player.name} zahlt {total} DM für Gebäude-Renovierungen ({h_cost} DM/Haus, {hot_cost} DM/Hotel).")

        elif act in ["PAY_EACH_PLAYER", "pay_each"]:
            amt = card.get("value") if "value" in card else card.get("amount", 50)
            others = [p for p in self.players if p.id != player.id and not p.is_bankrupt]
            total = amt * len(others)
            for p in others:
                self._credit_money(p, amt)
            self._record_payment(player, total, "BANK")
            self.log(f"👥 {player.name} zahlt jedem Mitspieler {amt} DM (Gesamt: {total} DM).")

        elif act in ["RECEIVE_FROM_PLAYERS", "birthday"]:
            amt = card.get("value") if "value" in card else card.get("amount", 10)
            for p in self.players:
                if p.id != player.id and not p.is_bankrupt:
                    self._record_payment(p, amt, player.id)
                    self._credit_money(player, amt)
            self.log(f"🎁 Jeder Mitspieler schenkt {player.name} {amt} DM!")

        elif act in ["GO_TO_JAIL", "gotojail"]:
            self.send_to_jail(player)

        elif act in ["GET_OUT_OF_JAIL_FREE", "jail_free"]:
            player.jail_cards += 1
            self.log(f"🎟️ {player.name} erhält eine 'Gefängnis frei'-Karte.")

    def buy_property(self, player_id: str, sq_idx: int) -> dict:
        player = next((p for p in self.players if p.id == player_id), None)
        if not player:
            return {"error": "Spieler nicht gefunden."}
        square = SQUARES[sq_idx]
        price = square["price"]
        state = self.board_state[sq_idx]

        if state["owner"] is not None:
            return {"error": "Bereits besessen."}
        if player.money < price:
            return {"error": "Nicht genug Geld. Du kannst die Straße stattdessen versteigern lassen!"}

        player.money -= price
        state["owner"] = player.id
        self.log(f"{player.name} kauft {square['name']} für {price} DM!")
        self.pending_action = None
        self._check_doubles_reroll(player)
        return {"success": True, "square": square, "player": player.to_dict()}

    # =========================================================================
    # Versteigerung (Auktion) laut Parker-Regel Seite 2 ("2. Versteigerung")
    # =========================================================================
    def start_auction(self, player_id: str, sq_idx: Optional[int] = None) -> dict:
        curr = self.current_player()
        if not curr or curr.id != player_id:
            return {"error": "Nur der aktive Spieler kann den Kauf ablehnen und die Versteigerung starten."}
        if sq_idx is None:
            if self.pending_action and self.pending_action.get("type") == "BUY_OR_AUCTION":
                sq_idx = self.pending_action["square"]["index"]
            else:
                return {"error": "Kein Grundstück zur Versteigerung verfügbar."}

        square = SQUARES[sq_idx]
        state = self.board_state.get(sq_idx)
        if not state or state["owner"] is not None:
            return {"error": "Grundstück kann nicht versteigert werden."}

        # Alle nicht-bankrotten Spieler dürfen mitbieten (auch derjenige, der den Direktkauf abgelehnt hat!)
        active_bidders = [p.id for p in self.players if not p.is_bankrupt and p.money > 0]
        if not active_bidders:
            self.log(f"🔨 Niemand hat Bargeld für die Versteigerung von {square['name']}. Straße bleibt bei der Bank.")
            self.pending_action = {"type": "END_TURN"}
            self.auction_state = None
            self._check_doubles_reroll(curr)
            return {"success": True, "auction_ended": True}

        self.auction_state = {
            "sq_idx": sq_idx,
            "square": square,
            "high_bid": 0,
            "high_bidder_id": None,
            "high_bidder_name": None,
            "active_bidders": active_bidders,
            "passed_bidders": [],
            "bid_seq": 1,
            "timeout_sec": 5
        }
        self.pending_action = {"type": "AUCTION", "square": square}
        self.log(f"🔨 {curr.name} lehnt den Direktkauf ab! {square['name']} (Wert: {square['price']} DM) wird versteigert!")
        return {"success": True, "auction_ended": False, "auction": self.auction_state}

    def place_auction_bid(self, player_id: str, bid_amount: int) -> dict:
        if not self.auction_state:
            return {"error": "Keine aktive Versteigerung."}
        if player_id not in self.auction_state["active_bidders"]:
            return {"error": "Du bist bereits aus der Versteigerung ausgestiegen."}

        player = next((p for p in self.players if p.id == player_id), None)
        if not player or player.is_bankrupt:
            return {"error": "Ungültiger Bieter."}

        min_bid = self.auction_state["high_bid"] + 1
        if bid_amount < min_bid:
            return {"error": f"Gebot muss mindestens {min_bid} DM betragen."}
        if bid_amount > player.money:
            return {"error": f"Du hast nur {player.money} DM Bargeld."}

        self.auction_state["high_bid"] = bid_amount
        self.auction_state["high_bidder_id"] = player.id
        self.auction_state["high_bidder_name"] = player.name
        self.auction_state["bid_seq"] = self.auction_state.get("bid_seq", 1) + 1
        self.log(f"{'🤖' if player.is_bot else '🔨'} {player.name} bietet {bid_amount} DM für {self.auction_state['square']['name']}!")

        # Wenn andere Bieter kein höheres Budget mehr haben, automatisch aussteigen lassen
        for b_id in list(self.auction_state["active_bidders"]):
            if b_id != player.id:
                bp = next((p for p in self.players if p.id == b_id), None)
                if not bp or bp.money <= bid_amount:
                    self.auction_state["active_bidders"].remove(b_id)
                    if b_id not in self.auction_state["passed_bidders"]:
                        self.auction_state["passed_bidders"].append(b_id)

        return {"success": True, "auction_ended": False, "auction": self.auction_state}

    def pass_auction(self, player_id: str) -> dict:
        if not self.auction_state:
            return {"error": "Keine aktive Versteigerung."}
        if player_id in self.auction_state["active_bidders"]:
            self.auction_state["active_bidders"].remove(player_id)
            if player_id not in self.auction_state["passed_bidders"]:
                self.auction_state["passed_bidders"].append(player_id)
            player = next((p for p in self.players if p.id == player_id), None)
            if player:
                self.log(f"🏳️ {player.name} steigt aus der Versteigerung aus.")

        # Wenn noch kein Gebot vorliegt und niemand mehr aktiv ist, sofort beenden
        if not self.auction_state["high_bidder_id"] and len(self.auction_state["active_bidders"]) == 0:
            return self.finalize_auction_timeout()

        return {"success": True, "auction_ended": False, "auction": self.auction_state}

    def step_bot_auction_bid(self) -> Optional[dict]:
        """Führt maximal einen einzelnen Bot-Gebotsschritt aus, damit der 5s-Hammer-Timer echt abläuft."""
        if not self.auction_state:
            return None
        sq = self.auction_state["square"]
        base_price = sq["price"]

        for b_id in list(self.auction_state["active_bidders"]):
            bot = next((p for p in self.players if p.id == b_id and p.is_bot), None)
            if not bot:
                continue
            if self.auction_state["high_bidder_id"] == bot.id:
                continue

            max_willing = min(bot.money - 100, int(base_price * 0.85))
            next_bid = self.auction_state["high_bid"] + 10
            if next_bid <= max_willing and next_bid <= bot.money:
                return self.place_auction_bid(bot.id, next_bid)
            else:
                self.auction_state["active_bidders"].remove(bot.id)
                if bot.id not in self.auction_state["passed_bidders"]:
                    self.auction_state["passed_bidders"].append(bot.id)
                self.log(f"🤖 {bot.name} passt bei der Versteigerung.")

        return None

    def finalize_auction_timeout(self) -> dict:
        """Beendet die Auktion nach 5 Sekunden ohne neue Gebote ('Zum Ersten, zum Zweiten, Verkauft!')."""
        if not self.auction_state:
            return {"success": True, "auction_ended": True}

        high_id = self.auction_state["high_bidder_id"]
        high_bid = self.auction_state["high_bid"]
        sq_idx = self.auction_state["sq_idx"]
        square = self.auction_state["square"]
        winner_info = None

        if high_id and high_bid > 0:
            winner = next((p for p in self.players if p.id == high_id), None)
            if winner and winner.money >= high_bid:
                winner.money -= high_bid
                self.board_state[sq_idx]["owner"] = winner.id
                self.log(f"🔨 Zum Ersten, zum Zweiten, zum Dritten – VERKAUFT! 🎉 {winner.name} ersteigert {square['name']} für {high_bid} DM!")
                winner_info = {"id": winner.id, "name": winner.name, "color": winner.color}
        else:
            self.log(f"🔨 Zum Ersten, zum Zweiten, zum Dritten – Keine Gebote für {square['name']}. Das Grundstück bleibt bei der Bank.")

        self.auction_state = None
        self.pending_action = {"type": "END_TURN"}
        self._check_doubles_reroll()
        return {
            "success": True,
            "auction_ended": True,
            "sold": bool(winner_info),
            "winner": winner_info,
            "amount": high_bid,
            "square": square
        }

    def _check_auction_completion(self) -> dict:
        if not self.auction_state:
            return {"success": True, "auction_ended": True}
        return {"success": True, "auction_ended": False, "auction": self.auction_state}

    # =========================================================================
    # Häuser & Hotels mit Gebäudelimit (32 Häuser / 12 Hotels, Seite 3)
    # =========================================================================
    def build_house(self, player_id: str, sq_idx: int) -> dict:
        player = next((p for p in self.players if p.id == player_id), None)
        if not player:
            return {"error": "Spieler nicht gefunden."}
        square = SQUARES[sq_idx]
        if square["type"] != "property":
            return {"error": "Nur Straßen können bebaut werden."}

        state = self.board_state[sq_idx]
        if state["owner"] != player.id:
            return {"error": "Nicht dein Grundstück."}
        if state["mortgaged"]:
            return {"error": "Grundstück ist mit Hypothek belastet."}

        group = square["group"]
        group_squares = COLOR_GROUPS[group]
        if not all(self.board_state[s]["owner"] == player.id for s in group_squares):
            return {"error": "Du musst die gesamte Farbgruppe besitzen!"}
        if any(self.board_state[s]["mortgaged"] for s in group_squares):
            return {"error": "In der Farbgruppe existiert eine Hypothek!"}

        # Even building rule
        current_houses = state["houses"]
        if current_houses >= 5:
            return {"error": "Maximaler Ausbau (Hotel) bereits erreicht!"}
        min_houses = min(self.board_state[s]["houses"] for s in group_squares)
        if current_houses > min_houses:
            return {"error": "Gleichmäßiges Bauen erforderlich (andere Straßen der Gruppe haben weniger Häuser)."}

        # Check bank building limits (32 houses, 12 hotels)
        if current_houses < 4:
            if self.available_bank_houses() <= 0:
                return {"error": f"Mangel an Gebäuden: Die Bank hat keine Häuser mehr übrig (alle {MAX_BANK_HOUSES} verbaut)!"}
        else:
            if self.available_bank_hotels() <= 0:
                return {"error": f"Mangel an Gebäuden: Die Bank hat keine Hotels mehr übrig (alle {MAX_BANK_HOTELS} verbaut)!"}

        cost = square["house_cost"]
        if player.money < cost:
            return {"error": "Nicht genug Geld."}

        player.money -= cost
        state["houses"] += 1
        name = "ein Haus" if state["houses"] < 5 else "ein HOTEL"
        self.log(f"{player.name} baut {name} auf {square['name']} ({cost} DM)!")
        return {"success": True, "houses": state["houses"], "money": player.money}

    def sell_house(self, player_id: str, sq_idx: int) -> dict:
        player = next((p for p in self.players if p.id == player_id), None)
        if not player:
            return {"error": "Spieler nicht gefunden."}
        square = SQUARES[sq_idx]
        if square["type"] != "property":
            return {"error": "Nur Straßen haben Häuser."}
        state = self.board_state[sq_idx]
        if state["owner"] != player.id:
            return {"error": "Nicht dein Grundstück."}
        if state["houses"] <= 0:
            return {"error": "Keine Häuser vorhanden zum Verkaufen."}

        group = square["group"]
        group_squares = COLOR_GROUPS[group]
        max_houses = max(self.board_state[s]["houses"] for s in group_squares)
        if state["houses"] < max_houses:
            return {"error": "Gleichmäßiges Verkaufen erforderlich (zuerst von stärker bebauten Straßen verkaufen)."}

        # Wenn ein Hotel (5) in 4 Häuser umgewandelt wird, prüfen ob 4 Häuser in der Bank sind
        if state["houses"] == 5 and self.available_bank_houses() < 4:
            return {"error": f"In der Bank sind nur noch {self.available_bank_houses()} Häuser verfügbar (4 benötigt für Hotel-Abbau)."}

        refund = square["house_cost"] // 2
        was_hotel = (state["houses"] == 5)
        state["houses"] -= 1
        self._credit_money(player, refund)
        name = "ein HOTEL (zurück zu 4 Häusern)" if was_hotel else "ein Haus"
        self.log(f"{player.name} verkauft {name} auf {square['name']} (+{refund} DM)!")
        self._check_doubles_reroll(player)
        return {"success": True, "houses": state["houses"], "money": player.money}

    # =========================================================================
    # Handel zwischen Spielern (inkl. Gefängnisfrei-Karten & 10% Hypothekenzins)
    # =========================================================================
    def propose_trade(
        self,
        sender_id: str,
        target_id: str,
        offer_money: int,
        offer_props: List[int],
        req_money: int,
        req_props: List[int],
        offer_jail_cards: int = 0,
        req_jail_cards: int = 0
    ) -> dict:
        sender = next((p for p in self.players if p.id == sender_id), None)
        target = next((p for p in self.players if p.id == target_id), None)
        if not sender or not target:
            return {"error": "Spieler ungültig."}
        if sender.is_bankrupt or target.is_bankrupt:
            return {"error": "Spieler ist bankrott."}
        if sender.money < offer_money or offer_money < 0:
            return {"error": "Ungültiges Geldangebot."}
        if req_money < 0:
            return {"error": "Ungültige Geldforderung."}
        if offer_jail_cards < 0 or offer_jail_cards > sender.jail_cards:
            return {"error": "Du besitzt nicht so viele Gefängnisfrei-Karten."}
        if req_jail_cards < 0 or req_jail_cards > target.jail_cards:
            return {"error": "Handelspartner besitzt nicht so viele Gefängnisfrei-Karten."}

        for p_idx in offer_props:
            st = self.board_state.get(p_idx)
            if not st or st["owner"] != sender_id:
                return {"error": "Grundstück gehört dir nicht."}
            grp = SQUARES[p_idx].get("group")
            if grp and any(self.board_state[s]["houses"] > 0 for s in COLOR_GROUPS.get(grp, [])):
                return {"error": "Kann kein Grundstück handeln, solange Häuser auf der Farbgruppe stehen."}

        for p_idx in req_props:
            st = self.board_state.get(p_idx)
            if not st or st["owner"] != target_id:
                return {"error": "Gefordertes Grundstück gehört dem Partner nicht."}
            grp = SQUARES[p_idx].get("group")
            if grp and any(self.board_state[s]["houses"] > 0 for s in COLOR_GROUPS.get(grp, [])):
                return {"error": "Partner hat noch Häuser in dieser Farbgruppe."}

        trade = {
            "id": f"trade_{int(time.time()*1000)}",
            "sender_id": sender_id,
            "sender_name": sender.name,
            "target_id": target_id,
            "target_name": target.name,
            "offer_money": offer_money,
            "offer_props": offer_props,
            "req_money": req_money,
            "req_props": req_props,
            "offer_jail_cards": offer_jail_cards,
            "req_jail_cards": req_jail_cards
        }
        self.pending_trade = trade
        self.log(f"🤝 {sender.name} bietet {target.name} einen Handel an.")
        return {"success": True, "trade": trade}

    def accept_trade(self, player_id: str) -> dict:
        trade = self.pending_trade
        if not trade or trade["target_id"] != player_id:
            return {"error": "Kein aktives Angebot für dich."}
        sender = next((p for p in self.players if p.id == trade["sender_id"]), None)
        target = next((p for p in self.players if p.id == trade["target_id"]), None)
        if not sender or not target:
            return {"error": "Spieler ungültig."}
        if sender.money < trade["offer_money"] or target.money < trade["req_money"]:
            return {"error": "Nicht genug Geld für diesen Handel."}

        offer_jc = trade.get("offer_jail_cards", 0)
        req_jc = trade.get("req_jail_cards", 0)
        if sender.jail_cards < offer_jc or target.jail_cards < req_jc:
            return {"error": "Gefängnisfrei-Karten nicht mehr verfügbar."}

        for p_idx in trade["offer_props"]:
            if self.board_state[p_idx]["owner"] != sender.id:
                return {"error": "Angebotenes Grundstück nicht mehr verfügbar."}
        for p_idx in trade["req_props"]:
            if self.board_state[p_idx]["owner"] != target.id:
                return {"error": "Gefordertes Grundstück nicht mehr verfügbar."}

        sender.money -= trade["offer_money"]
        self._credit_money(target, trade["offer_money"])
        target.money -= trade["req_money"]
        self._credit_money(sender, trade["req_money"])

        sender.jail_cards = sender.jail_cards - offer_jc + req_jc
        target.jail_cards = target.jail_cards - req_jc + offer_jc

        # Laut Parker-Regel (Seite 3, "Hypotheken"): Bei Übertragung eines hypothekarisch
        # belasteten Grundstücks sind 10% Zinsen vom neuen Besitzer an die Bank zu zahlen.
        for p_idx in trade["offer_props"]:
            self.board_state[p_idx]["owner"] = target.id
            if self.board_state[p_idx]["mortgaged"]:
                m_val = SQUARES[p_idx].get("mortgage", SQUARES[p_idx]["price"] // 2)
                fee = max(1, int(round(m_val * 0.10)))
                self._record_payment(target, fee, "BANK")
                self.log(f"📜 {target.name} zahlt {fee} DM (10% Übertragungszins) für belastetes Grundstück {SQUARES[p_idx]['name']}.")

        for p_idx in trade["req_props"]:
            self.board_state[p_idx]["owner"] = sender.id
            if self.board_state[p_idx]["mortgaged"]:
                m_val = SQUARES[p_idx].get("mortgage", SQUARES[p_idx]["price"] // 2)
                fee = max(1, int(round(m_val * 0.10)))
                self._record_payment(sender, fee, "BANK")
                self.log(f"📜 {sender.name} zahlt {fee} DM (10% Übertragungszins) für belastetes Grundstück {SQUARES[p_idx]['name']}.")

        self.pending_trade = None
        self.log(f"✅ Handel zwischen {sender.name} und {target.name} erfolgreich abgeschlossen!")
        self._check_doubles_reroll()
        return {"success": True}

    def reject_trade(self, player_id: str) -> dict:
        trade = self.pending_trade
        if not trade:
            return {"error": "Kein aktiver Handel."}
        if trade["target_id"] == player_id or trade["sender_id"] == player_id:
            self.pending_trade = None
            self.log("❌ Handel wurde abgelehnt oder zurückgezogen.")
            return {"success": True}
        return {"error": "Nicht berechtigt."}

    def toggle_mortgage(self, player_id: str, sq_idx: int) -> dict:
        player = next((p for p in self.players if p.id == player_id), None)
        if not player:
            return {"error": "Spieler nicht gefunden."}
        square = SQUARES[sq_idx]
        state = self.board_state[sq_idx]
        if state["owner"] != player.id:
            return {"error": "Nicht dein Grundstück."}

        group = square.get("group")
        if not state["mortgaged"]:
            # Laut Parker-Regel (Seite 3): Alle Gebäude auf einer Farbgruppe müssen verkauft sein,
            # ehe ein Grundstück dieser Farbgruppe hypothekarisch belastet werden darf.
            if state.get("houses", 0) > 0:
                return {"error": "Vor der Hypothek müssen erst alle Häuser verkauft werden!"}
            if group in COLOR_GROUPS and any(self.board_state[s].get("houses", 0) > 0 for s in COLOR_GROUPS[group]):
                return {"error": "Alle Häuser dieser Farbgruppe müssen zuerst an die Bank verkauft werden!"}

        mortgage_val = square.get("mortgage", square["price"] // 2)

        if not state["mortgaged"]:
            state["mortgaged"] = True
            self._credit_money(player, mortgage_val)
            self.log(f"{player.name} nimmt eine Hypothek auf {square['name']} auf (+{mortgage_val} DM).")
            self._check_doubles_reroll(player)
            return {"success": True, "mortgaged": True, "money": player.money}
        else:
            cost = int(round(mortgage_val * 1.1))
            if player.money < cost:
                return {"error": f"Nicht genug Geld ({cost} DM inkl. 10% Zinsen benötigt)."}
            player.money -= cost
            state["mortgaged"] = False
            self.log(f"{player.name} löst die Hypothek auf {square['name']} ab (-{cost} DM).")
            return {"success": True, "mortgaged": False, "money": player.money}

    def pay_bail(self, player_id: str) -> dict:
        player = next((p for p in self.players if p.id == player_id), None)
        if not player or not player.in_jail:
            return {"error": "Nicht im Gefängnis."}
        if self.rolled:
            return {"error": "Freikaufen ist laut Regel nur VOR dem Würfeln möglich."}
        if player.money < 50:
            return {"error": "Nicht genug Geld für Kaution (50 DM)."}
        player.money -= 50
        player.in_jail = False
        player.jail_turns = 0
        self.log(f"{player.name} zahlt 50 DM Bußgeld vor dem Wurf und ist frei!")
        return {"success": True, "player": player.to_dict()}

    def use_jail_card(self, player_id: str) -> dict:
        player = next((p for p in self.players if p.id == player_id), None)
        if not player or not player.in_jail or player.jail_cards <= 0:
            return {"error": "Keine Gefängnisfrei-Karte vorhanden."}
        if self.rolled:
            return {"error": "Gefängnisfrei-Karte muss VOR dem Würfeln eingesetzt werden."}
        player.jail_cards -= 1
        player.in_jail = False
        player.jail_turns = 0
        # Karte zurück unter den Stapel legen
        if len(self.chance_deck) < len(CHANCE_CARDS):
            self.chance_deck.append(15)
        elif len(self.chest_deck) < len(COMMUNITY_CHEST_CARDS):
            self.chest_deck.append(15)
        self.log(f"{player.name} nutzt eine 'Du kommst aus dem Gefängnis frei'-Karte!")
        return {"success": True, "player": player.to_dict()}

    def auto_resolve_bot_debt(self, bot: Player):
        """Verkauft automatisch Häuser und nimmt Hypotheken auf, falls ein Bot im Minus ist."""
        while bot.money < 0:
            # 1. Versuche das teuerste abbaubare Haus/Hotel zu verkaufen
            built_squares = [
                sq_idx for sq_idx, st in self.board_state.items()
                if st["owner"] == bot.id and st.get("houses", 0) > 0
            ]
            sold_any = False
            for sq_idx in built_squares:
                res = self.sell_house(bot.id, sq_idx)
                if res.get("success"):
                    sold_any = True
                    break
            if sold_any:
                continue

            # 2. Versuche ein unbelastetes Grundstück mit Hypothek zu beleihen
            unmortgaged = [
                sq_idx for sq_idx, st in self.board_state.items()
                if st["owner"] == bot.id and not st.get("mortgaged", False) and st.get("houses", 0) == 0
            ]
            mortgaged_any = False
            for sq_idx in unmortgaged:
                res = self.toggle_mortgage(bot.id, sq_idx)
                if res.get("success"):
                    mortgaged_any = True
                    break
            if not mortgaged_any:
                break

    def end_turn(self, player_id: str) -> dict:
        player = self.current_player()
        if not player or player.id != player_id:
            return {"error": "Du bist nicht am Zug."}
        if not self.rolled and not player.is_bankrupt:
            return {"error": "Du musst zuerst würfeln."}
        if self.auction_state:
            return {"error": "Bitte zuerst die laufende Versteigerung beenden."}
        if self.pending_action and self.pending_action.get("type") == "CARD_DRAWN" and not player.is_bankrupt:
            return {"error": "Bitte bestätige zuerst die gezogene Karte."}
        if self.pending_action and self.pending_action.get("type") == "BUY_OR_AUCTION" and not player.is_bankrupt:
            return {"error": "Bitte kaufe das Grundstück oder starte die Versteigerung."}
        if self.pending_action and self.pending_action.get("type") == "TAX_CHOICE" and not player.is_bankrupt:
            return {"error": "Bitte wähle zuerst deine Einkommensteuer-Option (200 DM oder 10%)."}
        if player.money < 0 and not player.is_bankrupt:
            return {"error": f"Du hast {player.money} DM Schulden! Verkaufe Häuser, nimm eine Hypothek auf oder erkläre Bankrott."}

        # Check if doubles allow another roll
        d1, d2 = self.dice
        if d1 == d2 and not player.in_jail and not player.is_bankrupt and player.doubles_count > 0:
            self.rolled = False
            self.pending_action = None
            self.log(f"Pasch! {player.name} darf noch einmal würfeln!")
            return {"success": True, "reroll": True, "current_player": player.to_dict()}

        # Advance to next non-bankrupt player
        player.doubles_count = 0
        game_over_res = self._check_game_over(player)
        if game_over_res:
            return game_over_res

        self.rolled = False
        self.pending_action = None

        self.current_player_idx = (self.current_player_idx + 1) % len(self.players)
        while self.players[self.current_player_idx].is_bankrupt:
            self.current_player_idx = (self.current_player_idx + 1) % len(self.players)

        next_p = self.current_player()
        self.log(f"{next_p.name} ist jetzt am Zug.")
        return {"success": True, "next_player": next_p.to_dict()}

    def _check_game_over(self, fallback_player: Optional[Player] = None) -> Optional[dict]:
        active_players = [p for p in self.players if not p.is_bankrupt]
        if len(active_players) <= 1 and len(self.players) >= 2:
            self.status = "GAME_OVER"
            self.rolled = False
            self.pending_action = None
            self.auction_state = None
            winner_obj = active_players[0] if active_players else (fallback_player or self.players[0])
            props_count = sum(1 for st in self.board_state.values() if st["owner"] == winner_obj.id)
            wealth = self.calculate_player_wealth(winner_obj)
            self.winner = {
                **winner_obj.to_dict(),
                "wealth": wealth,
                "properties_count": props_count
            }
            self.log(f"🏆 {winner_obj.name} hat das Spiel gewonnen!")
            return {"success": True, "game_over": True, "winner": self.winner}
        return None

    def declare_bankruptcy(self, player_id: str) -> dict:
        player = next((p for p in self.players if p.id == player_id), None)
        if not player:
            return {"error": "Spieler nicht gefunden."}

        creditor = None
        if player.creditor_id and player.creditor_id != "BANK":
            creditor = next((p for p in self.players if p.id == player.creditor_id and not p.is_bankrupt), None)

        # Laut Parker-Regel (Seite 3, "Bankrott"): Häuser und Hotels müssen auch im Bankrottfall
        # zum halben Wert an die Bank verkauft werden.
        house_liquidation = 0
        for sq_idx, st in self.board_state.items():
            if st["owner"] == player.id and st.get("houses", 0) > 0:
                sq = SQUARES[sq_idx]
                house_liquidation += st["houses"] * (sq.get("house_cost", 0) // 2)
                st["houses"] = 0
        if house_liquidation > 0:
            player.money += house_liquidation
            self.log(f"🏚️ Alle Gebäude von {player.name} wurden für {house_liquidation} DM an die Bank zwangsverkauft.")

        if creditor:
            # Übergabe an den Gläubiger-Mitspieler (Parker-Regel Seite 3)
            if player.money > 0:
                self._credit_money(creditor, player.money)
            if player.jail_cards > 0:
                creditor.jail_cards += player.jail_cards
            for sq_idx, st in self.board_state.items():
                if st["owner"] == player.id:
                    st["owner"] = creditor.id
                    if st["mortgaged"]:
                        m_val = SQUARES[sq_idx].get("mortgage", SQUARES[sq_idx]["price"] // 2)
                        fee = max(1, int(round(m_val * 0.10)))
                        self._record_payment(creditor, fee, "BANK")
            self.log(f"💀 {player.name} ist gegenüber {creditor.name} zahlungsunfähig! Alle Besitztümer gehen an {creditor.name} über!")
        else:
            # Übergabe an die Bank
            for sq_idx, st in self.board_state.items():
                if st["owner"] == player.id:
                    st["owner"] = None
                    st["houses"] = 0
                    st["mortgaged"] = False
            self.log(f"💀 {player.name} erklärt gegenüber der Bank den Bankrott! Alle Grundstücke gehen zurück an die Bank.")

        player.money = 0
        player.jail_cards = 0
        player.is_bankrupt = True
        player.creditor_id = None

        game_over_res = self._check_game_over(player)
        if game_over_res:
            return game_over_res

        if self.current_player() and self.current_player().id == player_id:
            self.pending_action = None
            self.rolled = True
            return self.end_turn(player_id)
        return {"success": True, "bankrupt_player": player.to_dict()}

    def to_dict(self) -> dict:
        return {
            "room_id": self.room_id,
            "host_id": self.host_id,
            "party_id": self.party_id,
            "status": self.status,
            "winner": self.winner,
            "players": [p.to_dict() for p in self.players],
            "current_player_idx": self.current_player_idx,
            "current_player": self.current_player().to_dict() if self.players else None,
            "dice": self.dice,
            "rolled": self.rolled,
            "board_state": self.board_state,
            "bank_houses": self.available_bank_houses(),
            "bank_hotels": self.available_bank_hotels(),
            "pending_action": self.pending_action,
            "pending_trade": self.pending_trade,
            "auction_state": self.auction_state,
            "last_card": self.last_card,
            "logs": self.logs[-25:],
            "squares": SQUARES
        }

