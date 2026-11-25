"""Statische Monopoly-Daten: Spielfeld, Karten, Figuren, Farben und Raum-Einstellungen."""

import json
from pathlib import Path

ASSETS_DIR = Path(__file__).resolve().parent.parent / "static" / "assets"

MAX_BANK_HOUSES = 32
MAX_BANK_HOTELS = 12
MAX_PLAYERS = 8
TRADE_TIMEOUT_SEC = 60

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

# Lesbare deutsche Kartentexte mit DM (die JSON-Assets enthalten GROSSBUCHSTABEN und "£").
# Wortlaut bleibt gleich, damit die Bildzuordnung im Client (Stichwortsuche) weiter passt.
CARD_TEXTS_DE = {
    ("Ereignis", 1): "Die Bank zahlt dir eine Dividende von 50 DM.",
    ("Ereignis", 2): "Dein Bausparvertrag wird fällig. Du erhältst 150 DM.",
    ("Ereignis", 3): "Strafzettel! Zahle 15 DM.",
    ("Ereignis", 4): "Du lässt deine Häuser renovieren: Zahle 25 DM pro Haus und 100 DM pro Hotel.",
    ("Ereignis", 5): "Du bist zum Vorstand gewählt worden. Zahle jedem Spieler 50 DM.",
    ("Ereignis", 6): "Rücke vor bis auf Los. (Ziehe 200 DM ein.)",
    ("Ereignis", 7): "Mache einen Ausflug zum Südbahnhof. Wenn du über Los kommst, ziehe 200 DM ein.",
    ("Ereignis", 8): "Rücke vor bis zur Seestraße. Wenn du über Los kommst, ziehe 200 DM ein.",
    ("Ereignis", 9): "Rücke vor bis zum Opernplatz. Wenn du über Los kommst, ziehe 200 DM ein.",
    ("Ereignis", 10): "Rücke vor bis zur Schlossallee.",
    ("Ereignis", 11): "Rücke vor bis zum nächsten Bahnhof. Der Eigentümer erhält das Doppelte der normalen Miete. Wenn der Bahnhof noch niemandem gehört, kannst du ihn von der Bank kaufen.",
    ("Ereignis", 12): "Rücke vor bis zum nächsten Bahnhof. Der Eigentümer erhält das Doppelte der normalen Miete. Wenn der Bahnhof noch niemandem gehört, kannst du ihn von der Bank kaufen.",
    ("Ereignis", 13): "Rücke vor bis zum nächsten Werk. Würfle und zahle dem Eigentümer den zehnfachen Betrag deines Wurfergebnisses. Wenn das Werk noch niemandem gehört, kannst du es von der Bank kaufen.",
    ("Ereignis", 14): "Gehe 3 Felder zurück.",
    ("Ereignis", 15): "Gehe in das Gefängnis! Begib dich direkt dorthin. Gehe nicht über Los. Ziehe nicht 200 DM ein.",
    ("Ereignis", 16): "Du kommst aus dem Gefängnis frei. Behalte diese Karte, bis du sie benötigst oder verkaufst.",
    ("Gemeinschaft", 1): "Du erhältst eine Beratungsgebühr von 25 DM.",
    ("Gemeinschaft", 2): "Aus Lagerverkäufen erhältst du 50 DM.",
    ("Gemeinschaft", 3): "Bankfehler zu deinen Gunsten. Ziehe 200 DM ein.",
    ("Gemeinschaft", 4): "Deine Lebensversicherung wird fällig. Du erhältst 100 DM.",
    ("Gemeinschaft", 5): "Zweiter Preis im Schönheitswettbewerb. Du erhältst 10 DM.",
    ("Gemeinschaft", 6): "Du erbst 100 DM.",
    ("Gemeinschaft", 7): "Einkommensteuer-Rückzahlung. Du erhältst 20 DM.",
    ("Gemeinschaft", 8): "Urlaubsgeld! Du erhältst 100 DM.",
    ("Gemeinschaft", 9): "Du hast Geburtstag! Jeder Spieler schenkt dir 10 DM.",
    ("Gemeinschaft", 10): "Zahle Schulgeld: 50 DM.",
    ("Gemeinschaft", 11): "Arztkosten. Zahle 50 DM.",
    ("Gemeinschaft", 12): "Krankenhausgebühr: Du zahlst 100 DM.",
    ("Gemeinschaft", 13): "Kosten für Straßenausbesserungen. Zahle 40 DM pro Haus und 115 DM pro Hotel.",
    ("Gemeinschaft", 14): "Rücke vor bis auf Los. (Ziehe 200 DM ein.)",
    ("Gemeinschaft", 15): "Gehe in das Gefängnis! Begib dich direkt dorthin. Gehe nicht über Los. Ziehe nicht 200 DM ein.",
    ("Gemeinschaft", 16): "Du kommst aus dem Gefängnis frei. Behalte diese Karte, bis du sie benötigst oder verkaufst.",
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
                    "text": CARD_TEXTS_DE.get((deck_name, item.get("id")), item.get("text_de", "")),
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
    return [{**c, "text": CARD_TEXTS_DE.get((deck_name, c["id"]), c["text"])} for c in fallback_cards]


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


def clean_text(value, max_len: int) -> str:
    """Entfernt HTML-relevante Zeichen und Steuerzeichen (Namen/Chat landen im DOM aller Spieler)."""
    if not isinstance(value, str):
        return ""
    cleaned = "".join(ch for ch in value if ch not in "<>\"'`&" and (ch >= " " or ch == "\t"))
    return cleaned.strip()[:max_len]


# Raum-Einstellungen (Host setzt sie in der Lobby). Reihenfolge = Anzeige-Reihenfolge im Client.
# type: "select" (options = [[wert, label], …]) oder "toggle".
SETTINGS_SCHEMA = [
    {"key": "start_money", "label": "Startgeld", "type": "select", "default": 1500,
     "options": [[1000, "1.000 DM"], [1500, "1.500 DM"], [2000, "2.000 DM"], [2500, "2.500 DM"]]},
    {"key": "time_limit_min", "label": "Spieldauer", "type": "select", "default": 0,
     "options": [[0, "∞ Unbegrenzt"], [30, "30 Min"], [45, "45 Min"], [60, "60 Min"], [90, "90 Min"], [120, "120 Min"]],
     "hint": "Bei Zeitende gewinnt das höchste Vermögen."},
    {"key": "turn_timer_sec", "label": "Zug-Timer", "type": "select", "default": 0,
     "options": [[0, "Aus"], [60, "60 s"], [90, "90 s"], [120, "2 Min"], [180, "3 Min"]],
     "hint": "Danach beendet der Computer den Zug."},
    {"key": "bot_difficulty", "label": "Bot-Schwierigkeit", "type": "select", "default": "normal",
     "options": [["easy", "Leicht"], ["normal", "Normal"], ["hard", "Schwer"]]},
    {"key": "free_parking_pot", "label": "Frei-Parken-Topf", "type": "toggle", "default": False,
     "hint": "Steuern und Strafen sammeln sich in der Mitte – wer auf Frei Parken landet, bekommt alles."},
    {"key": "double_go", "label": "Doppeltes Gehalt auf Los", "type": "toggle", "default": False,
     "hint": "Wer genau auf Los landet, bekommt 400 statt 200 DM."},
    {"key": "jail_rolls", "label": "Gefängnis-Würfe pro Runde", "type": "select", "default": 3,
     "options": [[1, "1 (Original)"], [3, "3"]]},
    {"key": "build_rule", "label": "Häuser bauen", "type": "select", "default": "on_group",
     "options": [["on_group", "Nur auf der Farbe, auf der man steht"], ["anytime", "Jederzeit (Original)"]],
     "hint": "Standard: im eigenen Zug, wenn die Figur auf einer Straße dieser Farbgruppe steht."},
    {"key": "play_mode", "label": "Spielmodus", "type": "select", "default": "auto",
     "options": [["auto", "Automatisch"], ["manual", "Manuell (selbst würfeln, ziehen & aufdecken)"]],
     "hint": "Manuell: Würfelbecher schütteln, Figur Schritt für Schritt ziehen und Karten selbst aufdecken."},
]
DEFAULT_SETTINGS = {item["key"]: item["default"] for item in SETTINGS_SCHEMA}


def validate_settings(changes: dict) -> dict:
    """Nur bekannte Schlüssel mit erlaubten Werten übernehmen."""
    valid = {}
    if not isinstance(changes, dict):
        return valid
    for item in SETTINGS_SCHEMA:
        key = item["key"]
        if key not in changes:
            continue
        value = changes[key]
        if item["type"] == "toggle":
            if isinstance(value, bool):
                valid[key] = value
        else:
            allowed = [opt[0] for opt in item["options"]]
            if value in allowed and type(value) is type(item["default"]):
                valid[key] = value
    return valid
