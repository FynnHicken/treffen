import random
import time
from typing import Dict, List, Optional, Any

CATEGORIES = {
    "Essen & Trinken": [
        "Pizza", "Burger", "Sushi", "Döner", "Schokolade", "Eis", "Kaffee", "Spaghetti", "Pommes", "Kuchen", 
        "Lasagne", "Popcorn", "Pfannkuchen", "Salat", "Currywurst", "Brot", "Suppe", "Croissant", "Tacos"
    ],
    "Tiere": [
        "Hund", "Katze", "Elefant", "Löwe", "Pinguin", "Giraffe", "Delfin", "Känguru", "Panda", "Adler",
        "Eichhörnchen", "Krokodil", "Papagei", "Zebra", "Koala", "Igel", "Eule", "Schildkröte", "Wolf"
    ],
    "Gegenstände & Technik": [
        "Smartphone", "Kopfhörer", "Schlüssel", "Rucksack", "Gitarre", "Fahrrad", "Armbanduhr", "Kamera",
        "Laptop", "Kühlschrank", "Regenschirm", "Brille", "Taschenlampe", "Spiegel", "Kaffeemaschine"
    ],
    "Orte & Reisen": [
        "Flughafen", "Strand", "Kino", "Museum", "Supermarkt", "Schule", "Krankenhaus", "Zoo", "Hotel",
        "Bahnhof", "Bibliothek", "Freizeitpark", "Fitnessstudio", "Restaurant", "Campingplatz", "Stadion"
    ],
    "Berufe": [
        "Polizist", "Feuerwehrmann", "Arzt", "Pilot", "Lehrer", "Koch", "Detektiv", "Astronaut",
        "Mechaniker", "Anwalt", "Architekt", "Gärtner", "Journalist", "Tierarzt", "Schauspieler"
    ],
    "Freizeit & Hobbys": [
        "Fußball", "Gaming", "Schwimmen", "Kochen", "Tanzen", "Lesen", "Wandern", "Fotografie",
        "Yoga", "Zeichnen", "Schach", "Camping", "Klettern", "Singen", "Gärtnern"
    ]
}

# Bot hints knowledge base for believable AI clues
BOT_HINTS = {
    "Pizza": ["Käse", "Ofen", "Italien", "Teig", "Salami", "Belag", "Heiß", "Lieferung", "Kruste", "Rund"],
    "Burger": ["Fleisch", "Brötchen", "Fastfood", "Grill", "Ketchup", "Sesam", "Salat", "Pattie", "Saftig"],
    "Sushi": ["Reis", "Fisch", "Japan", "Rolle", "Alge", "Stäbchen", "Wasabi", "Lachs", "Frisch"],
    "Döner": ["Brot", "Spieß", "Soße", "Kräuter", "Knoblauch", "Salat", "Zwiebeln", "Imbiss", "Scharf"],
    "Schokolade": ["Süß", "Kakao", "Tafel", "Braune", "Zucker", "Milch", "Riegel", "Naschen", "Zart"],
    "Eis": ["Kalt", "Waffel", "Kugel", "Sommer", "Schmelzen", "Vanille", "Erdbeere", "Erfrischend"],
    "Kaffee": ["Bohne", "Tasse", "Morgen", "Heiß", "Wach", "Schwarz", "Espresso", "Milch", "Aroma"],
    "Spaghetti": ["Nudeln", "Italien", "Soße", "Bolognese", "Gabel", "Lang", "Kochen", "Teller"],
    "Pommes": ["Kartoffel", "Salz", "Frittiert", "Ketchup", "Mayo", "Knusprig", "Gelb", "Beilage"],
    "Hund": ["Bellen", "Leine", "Treue", "Pfote", "Haustier", "Gassigehen", "Fell", "Schwanz", "Hütte"],
    "Katze": ["Schnurren", "Mäuse", "Pfote", "Fell", "Kratzbaum", "Miau", "Samtpfote", "Schlafen", "Wolle"],
    "Elefant": ["Rüssel", "Groß", "Stoßzähne", "Grau", "Afrika", "Ohren", "Dickhäuter", "Savanne"],
    "Löwe": ["Mähne", "König", "Afrika", "Brüllen", "Raubkatze", "Savanne", "Rudel", "Jagd"],
    "Pinguin": ["Eis", "Frack", "Südpol", "Flossen", "Vogel", "Kalt", "Watscheln", "Fisch"],
    "Smartphone": ["Display", "App", "Nachricht", "Akku", "Touch", "Internet", "Tasche", "Klingeln", "Foto"],
    "Kopfhörer": ["Musik", "Ohren", "Sound", "Kabel", "Bluetooth", "Lautstärke", "Bass", "Beat"],
    "Fahrrad": ["Pedale", "Kette", "Reifen", "Lenker", "Helm", "Fahren", "Klingel", "Sattel", "Zweirad"],
    "Strand": ["Sand", "Meer", "Sonne", "Urlaub", "Wellen", "Muscheln", "Handtuch", "Sommer", "Wasser"],
    "Kino": ["Film", "Leinwand", "Popcorn", "Dunkel", "Sitze", "Ticket", "Saal", "Projektor", "Trailer"],
    "Flughafen": ["Flugzeug", "Koffer", "Terminal", "Pass", "Startbahn", "Gate", "Sicherheit", "Reise"],
    "Arzt": ["Kittel", "Spritze", "Praxis", "Gesundheit", "Rezept", "Patient", "Krank", "Helfen"],
    "Polizist": ["Uniform", "Sirene", "Blaulicht", "Wache", "Handschellen", "Recht", "Einsatz", "Streife"],
    "Fußball": ["Ball", "Tor", "Rasen", "Schiedsrichter", "Elfmeter", "Pfeife", "Stadion", "Trikot"]
}

GENERIC_IMPOSTER_HINTS = [
    "Beliebt", "Bekannt", "Klassisch", "Normal", "Typisch", "Oft", "Vielseitig", 
    "Spannend", "Wichtig", "Täglich", "Bunt", "Angenehm", "Modern", "Gemütlich"
]

class Player:
    def __init__(self, pid: str, name: str, is_host: bool = False, is_bot: bool = False):
        self.id = pid
        self.name = name
        self.is_host = is_host
        self.is_bot = is_bot
        self.role = "PLAYER" # "PLAYER" or "IMPOSTER"
        self.clues: List[str] = []
        self.voted_for: Optional[str] = None
        self.has_voted = False
        self.score = 0

    def to_dict(self, viewer_id: Optional[str] = None, show_roles: bool = False) -> dict:
        data = {
            "id": self.id,
            "name": self.name,
            "is_host": self.is_host,
            "is_bot": self.is_bot,
            "clues": self.clues,
            "has_voted": self.has_voted,
            "score": self.score
        }
        # Reveal role if viewer is self, or game is in reveal phase
        if show_roles or viewer_id == self.id:
            data["role"] = self.role
        else:
            data["role"] = "UNKNOWN"
        return data

class ImposterRoom:
    def __init__(self, code: str):
        self.code = code
        self.players: Dict[str, Player] = {}
        # Phases: LOBBY, REVEAL_ROLE, CLUES, DISCUSSION, VOTING, GUESSING, ROUND_OVER
        self.status = "LOBBY"
        self.category = "Essen & Trinken"
        self.secret_word = ""
        self.imposter_count = 1
        self.turn_order: List[str] = []
        self.current_turn_index = 0
        self.current_round = 1
        self.max_clue_rounds = 1 # 1 or 2 rounds of clues
        self.winner: Optional[str] = None # "PLAYERS" or "IMPOSTER"
        self.winner_reason: Optional[str] = None
        self.discussion_end_time = 0.0
        self.imposter_guess: Optional[str] = None
        self.created_at = time.time()
        self.last_activity = time.time()

    def add_player(self, pid: str, name: str, is_host: bool = False, is_bot: bool = False) -> Player:
        self.last_activity = time.time()
        if pid in self.players:
            p = self.players[pid]
            p.name = name
            if is_host: p.is_host = True
            return p
        p = Player(pid, name, is_host or (len(self.players) == 0), is_bot=is_bot)
        self.players[pid] = p
        return p

    def remove_player(self, pid: str):
        self.last_activity = time.time()
        if pid in self.players:
            was_host = self.players[pid].is_host
            del self.players[pid]
            if pid in self.turn_order:
                self.turn_order.remove(pid)
            if was_host and len(self.players) > 0:
                next_host = next(iter(self.players.values()))
                next_host.is_host = True

    def add_bot(self):
        if len(self.players) >= 12:
            return
        bot_names = ["Detektiv_Max", "Spionin_Lisa", "Bluff_Ben", "Rätsel_Mia", "Clue_Tom", "Sherlock", "Agent_007"]
        existing = {p.name for p in self.players.values()}
        name = next((b for b in bot_names if b not in existing), f"Bot_{random.randint(1,99)}")
        bot_id = f"bot_{random.randint(1000, 9999)}"
        self.add_player(bot_id, name, is_bot=True)

    def start_round(self, selected_category: Optional[str] = None):
        if len(self.players) < 3:
            raise ValueError("Mindestens 3 Spieler erforderlich!")

        self.last_activity = time.time()
        # Pick category & secret word
        if selected_category and selected_category in CATEGORIES:
            self.category = selected_category
        else:
            self.category = random.choice(list(CATEGORIES.keys()))

        word_list = CATEGORIES[self.category]
        self.secret_word = random.choice(word_list)

        # Reset player states
        player_list = list(self.players.values())
        random.shuffle(player_list)
        for p in player_list:
            p.role = "PLAYER"
            p.clues = []
            p.has_voted = False
            p.voted_for = None

        # Choose imposter(s) (1 for <=6, 2 for >=7 if configured)
        num_imposters = min(self.imposter_count, 1 if len(player_list) <= 6 else 2)
        imposters = random.sample(player_list, num_imposters)
        for imp in imposters:
            imp.role = "IMPOSTER"

        self.turn_order = [p.id for p in player_list]
        self.current_turn_index = 0
        self.current_round = 1
        self.status = "CLUES"
        self.winner = None
        self.winner_reason = None
        self.imposter_guess = None

    def submit_clue(self, pid: str, clue: str) -> bool:
        self.last_activity = time.time()
        if self.status != "CLUES":
            return False
        if self.current_turn_index >= len(self.turn_order):
            return False
        if self.turn_order[self.current_turn_index] != pid:
            return False

        # Validate clue (one word, not the secret word)
        clean_clue = clue.strip().split()[0].capitalize()
        if clean_clue.lower() == self.secret_word.lower():
            clean_clue = "***"

        player = self.players.get(pid)
        if player:
            player.clues.append(clean_clue)

        # Advance turn
        self.current_turn_index += 1
        if self.current_turn_index >= len(self.turn_order):
            if self.current_round < self.max_clue_rounds:
                self.current_round += 1
                self.current_turn_index = 0
            else:
                # Move to discussion
                self.status = "DISCUSSION"
                self.discussion_end_time = time.time() + 60.0 # 60 seconds discussion
        return True

    def start_voting(self):
        self.last_activity = time.time()
        self.status = "VOTING"
        for p in self.players.values():
            p.has_voted = False
            p.voted_for = None

    def cast_vote(self, voter_id: str, target_id: str):
        self.last_activity = time.time()
        if self.status != "VOTING":
            return
        voter = self.players.get(voter_id)
        if not voter or voter.has_voted:
            return
        voter.has_voted = True
        voter.voted_for = target_id

        if all(p.has_voted for p in self.players.values()):
            self.resolve_voting()

    def resolve_voting(self) -> dict:
        tally: Dict[str, int] = {}
        for p in self.players.values():
            if p.voted_for:
                tally[p.voted_for] = tally.get(p.voted_for, 0) + 1

        sorted_tally = sorted(tally.items(), key=lambda x: x[1], reverse=True)
        top_target = sorted_tally[0][0] if sorted_tally else None
        accused = self.players.get(top_target) if top_target else None

        imposters = [p for p in self.players.values() if p.role == "IMPOSTER"]
        imposter_ids = {imp.id for imp in imposters}

        if accused and accused.id in imposter_ids:
            # Imposter caught! Give chance to guess the secret word
            self.status = "GUESSING"
            return {
                "accused": accused.to_dict(show_roles=True),
                "is_imposter": True,
                "can_guess": True,
                "tally": tally
            }
        else:
            # Wrong person accused or tie -> Imposter wins!
            self.status = "ROUND_OVER"
            self.winner = "IMPOSTER"
            self.winner_reason = f"Die Gruppe hat {accused.name if accused else 'niemanden'} verdächtigt. Der Imposter hat alle getäuscht!"
            for imp in imposters:
                imp.score += 2
            return {
                "accused": accused.to_dict(show_roles=True) if accused else None,
                "is_imposter": False,
                "can_guess": False,
                "tally": tally
            }

    def submit_imposter_guess(self, guess: str) -> dict:
        self.last_activity = time.time()
        self.imposter_guess = guess.strip()
        correct = (self.imposter_guess.lower() == self.secret_word.lower())

        self.status = "ROUND_OVER"
        imposters = [p for p in self.players.values() if p.role == "IMPOSTER"]
        crew = [p for p in self.players.values() if p.role == "PLAYER"]

        if correct:
            self.winner = "IMPOSTER"
            self.winner_reason = f"Der Imposter wurde zwar enttarnt, hat das geheime Wort '{self.secret_word}' aber richtig erraten!"
            for imp in imposters:
                imp.score += 3
        else:
            self.winner = "PLAYERS"
            self.winner_reason = f"Die Gruppe gewinnt! Der Imposter lag mit '{self.imposter_guess}' falsch (Wort war '{self.secret_word}')."
            for c in crew:
                c.score += 1

        return {
            "correct": correct,
            "winner": self.winner,
            "secret_word": self.secret_word
        }

    def generate_bot_clue(self, bot: Player) -> str:
        if bot.role == "PLAYER":
            hints = BOT_HINTS.get(self.secret_word)
            if hints:
                used = set(bot.clues)
                available = [h for h in hints if h not in used]
                if available:
                    return random.choice(available)
            return "Passend"
        else:
            # Imposter bot: Listens to previous clues or uses generic hint
            all_clues = [c for p in self.players.values() for c in p.clues if c != "***"]
            if all_clues and random.random() < 0.5:
                return random.choice(GENERIC_IMPOSTER_HINTS)
            return random.choice(GENERIC_IMPOSTER_HINTS)

    def to_dict(self, viewer_id: Optional[str] = None) -> dict:
        viewer = self.players.get(viewer_id) if viewer_id else None
        show_all = (self.status == "ROUND_OVER")

        current_speaker_id = self.turn_order[self.current_turn_index] if (self.status == "CLUES" and self.current_turn_index < len(self.turn_order)) else None

        return {
            "code": self.code,
            "status": self.status,
            "category": self.category,
            "categories": list(CATEGORIES.keys()),
            # Secret word only revealed to non-imposters or in game over
            "secret_word": self.secret_word if (show_all or (viewer and viewer.role == "PLAYER")) else None,
            "your_role": viewer.role if viewer else "SPECTATOR",
            "players": [p.to_dict(viewer_id, show_all) for p in self.players.values()],
            "turn_order": self.turn_order,
            "current_speaker_id": current_speaker_id,
            "current_round": self.current_round,
            "max_clue_rounds": self.max_clue_rounds,
            "winner": self.winner,
            "winner_reason": self.winner_reason,
            "imposter_guess": self.imposter_guess,
            "discussion_remaining": max(0, int(self.discussion_end_time - time.time())) if self.status == "DISCUSSION" else 0
        }
