import random
import time
import math
from typing import Dict, List, Optional, Any

MAP_WIDTH = 2000
MAP_HEIGHT = 1094

# Spawn point (Cafeteria emergency table)
SPAWN_X = 1100
SPAWN_Y = 320

ROOMS = {
    "Cafeteria": {"x": 1100, "y": 320, "r": 180},
    "Weapons": {"x": 1470, "y": 240, "r": 100},
    "O2": {"x": 1260, "y": 420, "r": 80},
    "Navigation": {"x": 1780, "y": 500, "r": 110},
    "Shields": {"x": 1500, "y": 780, "r": 110},
    "Communications": {"x": 1250, "y": 850, "r": 90},
    "Storage": {"x": 1050, "y": 760, "r": 140},
    "Admin": {"x": 1300, "y": 620, "r": 100},
    "Electrical": {"x": 750, "y": 620, "r": 110},
    "Lower Engine": {"x": 480, "y": 750, "r": 120},
    "Upper Engine": {"x": 480, "y": 320, "r": 120},
    "Security": {"x": 650, "y": 480, "r": 80},
    "Reactor": {"x": 260, "y": 520, "r": 130},
    "MedBay": {"x": 800, "y": 360, "r": 90},
}

TASKS_DEF = [
    {"id": "wires_admin", "type": "wires", "name": "Kabel reparieren (Admin)", "x": 1310, "y": 640, "room": "Admin"},
    {"id": "wires_elec", "type": "wires", "name": "Kabel reparieren (Elektrik)", "x": 740, "y": 610, "room": "Electrical"},
    {"id": "wires_nav", "type": "wires", "name": "Kabel reparieren (Navigation)", "x": 1780, "y": 510, "room": "Navigation"},
    {"id": "swipe_card", "type": "swipe", "name": "Karte durchziehen (Admin)", "x": 1270, "y": 610, "room": "Admin"},
    {"id": "asteroids", "type": "asteroids", "name": "Asteroiden zerstören (Waffen)", "x": 1480, "y": 230, "room": "Weapons"},
    {"id": "divert_power", "type": "power", "name": "Energie umleiten (Elektrik)", "x": 760, "y": 640, "room": "Electrical"},
    {"id": "clean_o2", "type": "o2", "name": "O2-Filter leeren (O2)", "x": 1260, "y": 420, "room": "O2"},
    {"id": "start_reactor", "type": "reactor", "name": "Reaktor kalibrieren (Reaktor)", "x": 250, "y": 510, "room": "Reactor"},
    {"id": "medbay_scan", "type": "scan", "name": "MedBay-Scan durchführen (MedBay)", "x": 810, "y": 350, "room": "MedBay"},
    {"id": "shields", "type": "shields", "name": "Schilde aufladen (Schilde)", "x": 1510, "y": 790, "room": "Shields"},
    {"id": "download_data", "type": "download", "name": "Daten downloaden (Kommunikation)", "x": 1240, "y": 860, "room": "Communications"}
]

VENTS = [
    {"id": "v_cafe", "x": 1180, "y": 280, "connects": ["v_admin", "v_o2"], "name": "Cafeteria Vent"},
    {"id": "v_admin", "x": 1270, "y": 670, "connects": ["v_cafe"], "name": "Admin Vent"},
    {"id": "v_o2", "x": 1290, "y": 390, "connects": ["v_cafe", "v_nav1"], "name": "O2 Vent"},
    {"id": "v_nav1", "x": 1750, "y": 480, "connects": ["v_nav2", "v_o2"], "name": "Nav Vent 1"},
    {"id": "v_nav2", "x": 1750, "y": 530, "connects": ["v_nav1", "v_shields"], "name": "Nav Vent 2"},
    {"id": "v_shields", "x": 1490, "y": 800, "connects": ["v_nav2"], "name": "Shields Vent"},
    {"id": "v_elec", "x": 720, "y": 590, "connects": ["v_medbay", "v_sec"], "name": "Electrical Vent"},
    {"id": "v_medbay", "x": 780, "y": 380, "connects": ["v_elec", "v_sec"], "name": "MedBay Vent"},
    {"id": "v_sec", "x": 670, "y": 460, "connects": ["v_elec", "v_medbay"], "name": "Security Vent"},
    {"id": "v_reactor_up", "x": 280, "y": 440, "connects": ["v_reactor_low", "v_engine_up"], "name": "Reactor Upper Vent"},
    {"id": "v_reactor_low", "x": 280, "y": 600, "connects": ["v_reactor_up", "v_engine_low"], "name": "Reactor Lower Vent"},
    {"id": "v_engine_up", "x": 460, "y": 360, "connects": ["v_reactor_up"], "name": "Upper Engine Vent"},
    {"id": "v_engine_low", "x": 460, "y": 720, "connects": ["v_reactor_low"], "name": "Lower Engine Vent"},
]

AVAILABLE_COLORS = [
    {"name": "Rot", "hex": "#c51111", "dark": "#7a0808"},
    {"name": "Blau", "hex": "#132ed1", "dark": "#09158e"},
    {"name": "Grün", "hex": "#117f2d", "dark": "#0a4d1a"},
    {"name": "Pink", "hex": "#ed54ba", "dark": "#ab2c81"},
    {"name": "Orange", "hex": "#ef7d0d", "dark": "#b05203"},
    {"name": "Gelb", "hex": "#f5f557", "dark": "#c2be1b"},
    {"name": "Schwarz", "hex": "#3f474e", "dark": "#1e1f26"},
    {"name": "Weiß", "hex": "#d6e0f0", "dark": "#8394bf"},
    {"name": "Lila", "hex": "#6b2fbc", "dark": "#3b1770"},
    {"name": "Cyan", "hex": "#38fedc", "dark": "#24a891"},
    {"name": "Braun", "hex": "#71491e", "dark": "#46290c"},
    {"name": "Hellgrün", "hex": "#50ef39", "dark": "#2a931a"},
]

class Player:
    def __init__(self, pid: str, name: str, is_host: bool = False, color_idx: int = 0):
        self.id = pid
        self.name = name
        self.is_host = is_host
        self.color = AVAILABLE_COLORS[color_idx % len(AVAILABLE_COLORS)]
        self.x = SPAWN_X + random.randint(-50, 50)
        self.y = SPAWN_Y + random.randint(-40, 40)
        self.role = "CREWMATE" # "CREWMATE" or "IMPOSTOR"
        self.alive = True
        self.in_vent = False
        self.current_vent: Optional[str] = None
        self.tasks: List[Dict[str, Any]] = []
        self.completed_tasks: List[str] = []
        self.voted_for: Optional[str] = None # None or target pid or "SKIP"
        self.has_voted = False
        self.last_kill_time = 0.0
        self.emergency_meetings_left = 1

    def to_dict(self, viewer_role: Optional[str] = None, show_roles: bool = False) -> dict:
        data = {
            "id": self.id,
            "name": self.name,
            "is_host": self.is_host,
            "color": self.color,
            "x": round(self.x, 1),
            "y": round(self.y, 1),
            "alive": self.alive,
            "in_vent": self.in_vent,
            "has_voted": self.has_voted,
            "tasks_count": len(self.tasks),
            "completed_count": len(self.completed_tasks)
        }
        # Only show Impostor role if game is over, or viewer is also impostor
        if show_roles or viewer_role == "IMPOSTOR" or not self.alive:
            data["role"] = self.role
        else:
            data["role"] = "UNKNOWN"
        return data

class DeadBody:
    def __init__(self, victim_id: str, victim_name: str, color: dict, x: float, y: float):
        self.victim_id = victim_id
        self.victim_name = victim_name
        self.color = color
        self.x = x
        self.y = y

    def to_dict(self) -> dict:
        return {
            "victim_id": self.victim_id,
            "victim_name": self.victim_name,
            "color": self.color,
            "x": round(self.x, 1),
            "y": round(self.y, 1)
        }

class AmongUsRoom:
    def __init__(self, room_code: str):
        self.code = room_code
        self.players: Dict[str, Player] = {}
        self.status = "LOBBY" # LOBBY, PLAYING, MEETING, GAME_OVER
        self.dead_bodies: List[DeadBody] = []
        self.kill_cooldown = 20.0
        self.meeting_duration = 35.0
        self.meeting_end_time = 0.0
        self.meeting_caller: Optional[str] = None
        self.meeting_reason: Optional[str] = None # "EMERGENCY" or "BODY_REPORTED"
        self.winner: Optional[str] = None # "CREWMATES" or "IMPOSTORS"
        self.winner_reason: Optional[str] = None
        self.sabotage_lights = False
        self.created_at = time.time()
        self.last_activity = time.time()
        self.bots_count = 0

    def add_player(self, pid: str, name: str, is_host: bool = False) -> Player:
        self.last_activity = time.time()
        if pid in self.players:
            p = self.players[pid]
            p.name = name
            if is_host:
                p.is_host = True
            return p
        
        used_colors = {p.color["name"] for p in self.players.values()}
        color_idx = 0
        for i, c in enumerate(AVAILABLE_COLORS):
            if c["name"] not in used_colors:
                color_idx = i
                break

        p = Player(pid, name, is_host or (len(self.players) == 0), color_idx)
        self.players[pid] = p
        return p

    def remove_player(self, pid: str):
        self.last_activity = time.time()
        if pid in self.players:
            was_host = self.players[pid].is_host
            del self.players[pid]
            if was_host and len(self.players) > 0:
                next_host = next(iter(self.players.values()))
                next_host.is_host = True
            self.check_win_conditions()

    def add_bot(self):
        if len(self.players) >= 10:
            return
        bot_id = f"bot_{random.randint(1000, 9999)}"
        bot_names = ["MiniCrew", "SpaceDoge", "RedSus", "CyanGhost", "Cosmo", "Astro", "Nebula", "Alien99"]
        existing = {p.name for p in self.players.values()}
        name = next((b for b in bot_names if b not in existing), f"Bot_{random.randint(1,99)}")
        self.add_player(bot_id, name)
        self.bots_count += 1

    def start_game(self, impostor_count: int = 1):
        if len(self.players) < 1:
            return
        self.status = "PLAYING"
        self.winner = None
        self.winner_reason = None
        self.dead_bodies = []
        self.sabotage_lights = False

        player_list = list(self.players.values())
        random.shuffle(player_list)

        # Decide impostors (default: 1 for <=6 players, 2 for >=7)
        actual_impostors = min(impostor_count, max(1, len(player_list) // 3))
        for i, p in enumerate(player_list):
            p.alive = True
            p.in_vent = False
            p.current_vent = None
            p.has_voted = False
            p.voted_for = None
            p.emergency_meetings_left = 1
            p.x = SPAWN_X + random.randint(-60, 60)
            p.y = SPAWN_Y + random.randint(-50, 50)
            p.last_kill_time = time.time() + 10.0 # Grace period at start

            if i < actual_impostors:
                p.role = "IMPOSTOR"
                p.tasks = []
            else:
                p.role = "CREWMATE"
                # Assign 4 random tasks
                sample_tasks = random.sample(TASKS_DEF, min(4, len(TASKS_DEF)))
                p.tasks = [dict(t) for t in sample_tasks]
                p.completed_tasks = []

    def update_player_pos(self, pid: str, x: float, y: float):
        self.last_activity = time.time()
        p = self.players.get(pid)
        if not p or not p.alive or self.status != "PLAYING":
            return
        # Bound to map
        p.x = max(100, min(MAP_WIDTH - 100, x))
        p.y = max(100, min(MAP_HEIGHT - 100, y))

    def kill_target(self, killer_id: str, target_id: str) -> Optional[dict]:
        self.last_activity = time.time()
        if self.status != "PLAYING":
            return None
        killer = self.players.get(killer_id)
        target = self.players.get(target_id)
        if not killer or not target:
            return None
        if killer.role != "IMPOSTOR" or not killer.alive:
            return None
        if not target.alive or target.role == "IMPOSTOR":
            return None

        # Check distance
        dist = math.hypot(killer.x - target.x, killer.y - target.y)
        if dist > 140:
            return None

        # Check cooldown
        now = time.time()
        if now - killer.last_kill_time < self.kill_cooldown:
            return None

        # Perform kill
        killer.last_kill_time = now
        target.alive = False
        # Move killer to victim
        killer.x = target.x
        killer.y = target.y

        # Drop dead body
        body = DeadBody(target.id, target.name, target.color, target.x, target.y)
        self.dead_bodies.append(body)

        self.check_win_conditions()
        return {
            "killer": killer.to_dict(show_roles=True),
            "victim": target.to_dict(show_roles=True),
            "body": body.to_dict()
        }

    def complete_task(self, pid: str, task_id: str) -> bool:
        self.last_activity = time.time()
        p = self.players.get(pid)
        if not p or not p.alive or p.role != "CREWMATE" or self.status != "PLAYING":
            return False
        if task_id not in p.completed_tasks and any(t["id"] == task_id for t in p.tasks):
            p.completed_tasks.append(task_id)
            self.check_win_conditions()
            return True
        return False

    def enter_or_exit_vent(self, pid: str, vent_id: Optional[str] = None):
        self.last_activity = time.time()
        p = self.players.get(pid)
        if not p or not p.alive or p.role != "IMPOSTOR" or self.status != "PLAYING":
            return
        if p.in_vent:
            # Exit vent
            p.in_vent = False
            p.current_vent = None
        else:
            # Enter vent
            matching = None
            if vent_id:
                matching = next((v for v in VENTS if v["id"] == vent_id), None)
            else:
                for v in VENTS:
                    if math.hypot(p.x - v["x"], p.y - v["y"]) < 90:
                        matching = v
                        break
            if matching:
                p.in_vent = True
                p.current_vent = matching["id"]
                p.x = matching["x"]
                p.y = matching["y"]

    def switch_vent(self, pid: str, target_vent_id: str):
        self.last_activity = time.time()
        p = self.players.get(pid)
        if not p or not p.alive or not p.in_vent or p.role != "IMPOSTOR":
            return
        curr_vent = next((v for v in VENTS if v["id"] == p.current_vent), None)
        if curr_vent and target_vent_id in curr_vent["connects"]:
            target_vent = next((v for v in VENTS if v["id"] == target_vent_id), None)
            if target_vent:
                p.current_vent = target_vent_id
                p.x = target_vent["x"]
                p.y = target_vent["y"]

    def trigger_emergency(self, caller_id: str, reason: str = "EMERGENCY"):
        self.last_activity = time.time()
        caller = self.players.get(caller_id)
        if not caller or not caller.alive:
            return False
        if reason == "EMERGENCY" and caller.emergency_meetings_left <= 0:
            return False
        if reason == "EMERGENCY":
            caller.emergency_meetings_left -= 1

        self.status = "MEETING"
        self.meeting_caller = caller.id
        self.meeting_reason = reason
        self.meeting_end_time = time.time() + self.meeting_duration
        self.dead_bodies = [] # Clear dead bodies after meeting starts

        for p in self.players.values():
            p.has_voted = False
            p.voted_for = None
            p.in_vent = False
            # Reposition to table
            p.x = SPAWN_X + random.randint(-70, 70)
            p.y = SPAWN_Y + random.randint(-50, 50)
        return True

    def cast_vote(self, voter_id: str, target_id: str):
        self.last_activity = time.time()
        if self.status != "MEETING":
            return
        voter = self.players.get(voter_id)
        if not voter or not voter.alive or voter.has_voted:
            return
        voter.has_voted = True
        voter.voted_for = target_id

        # Check if all living players have voted
        living = [p for p in self.players.values() if p.alive]
        if all(p.has_voted for p in living):
            self.resolve_votes()

    def resolve_votes(self) -> dict:
        tally: Dict[str, int] = {"SKIP": 0}
        for p in self.players.values():
            if p.alive and p.has_voted and p.voted_for:
                tally[p.voted_for] = tally.get(p.voted_for, 0) + 1

        # Determine highest vote
        sorted_votes = sorted(tally.items(), key=lambda x: x[1], reverse=True)
        ejected: Optional[Player] = None
        tie = False

        if sorted_votes and sorted_votes[0][1] > 0:
            top_target, top_count = sorted_votes[0]
            if len(sorted_votes) > 1 and sorted_votes[1][1] == top_count:
                tie = True
            elif top_target != "SKIP":
                ejected = self.players.get(top_target)

        if ejected:
            ejected.alive = False

        result = {
            "ejected": ejected.to_dict(show_roles=True) if ejected else None,
            "tie": tie,
            "was_impostor": ejected.role == "IMPOSTOR" if ejected else False,
            "tally": tally
        }

        # Back to playing or game over
        self.status = "PLAYING"
        for p in self.players.values():
            if p.role == "IMPOSTOR":
                p.last_kill_time = time.time() + 10.0 # Grace period after meeting

        self.check_win_conditions()
        return result

    def check_win_conditions(self):
        if self.status in ["LOBBY", "GAME_OVER"]:
            return

        alive_crew = [p for p in self.players.values() if p.alive and p.role == "CREWMATE"]
        alive_imp = [p for p in self.players.values() if p.alive and p.role == "IMPOSTOR"]

        # 1. Impostors eliminated -> Crewmates win
        if len(alive_imp) == 0:
            self.status = "GAME_OVER"
            self.winner = "CREWMATES"
            self.winner_reason = "Alle Verräter wurden enttarnt und verbannt!"
            return

        # 2. Impostors >= Crewmates -> Impostors win
        if len(alive_imp) >= len(alive_crew):
            self.status = "GAME_OVER"
            self.winner = "IMPOSTORS"
            self.winner_reason = "Die Verräter haben das Raumschiff übernommen!"
            return

        # 3. All tasks completed by Crewmates -> Crewmates win
        total_tasks = sum(len(p.tasks) for p in self.players.values() if p.role == "CREWMATE")
        total_completed = sum(len(p.completed_tasks) for p in self.players.values() if p.role == "CREWMATE")
        if total_tasks > 0 and total_completed >= total_tasks:
            self.status = "GAME_OVER"
            self.winner = "CREWMATES"
            self.winner_reason = "Alle Aufgaben wurden erfolgreich abgeschlossen!"
            return

    def get_task_progress(self) -> float:
        total = sum(len(p.tasks) for p in self.players.values() if p.role == "CREWMATE")
        completed = sum(len(p.completed_tasks) for p in self.players.values() if p.role == "CREWMATE")
        return (completed / total) if total > 0 else 0.0

    def to_state_dict(self, viewer_id: Optional[str] = None) -> dict:
        viewer = self.players.get(viewer_id) if viewer_id else None
        viewer_role = viewer.role if viewer else None
        show_all = (self.status == "GAME_OVER")

        return {
            "code": self.code,
            "status": self.status,
            "players": [p.to_dict(viewer_role, show_all) for p in self.players.values()],
            "dead_bodies": [b.to_dict() for b in self.dead_bodies],
            "task_progress": round(self.get_task_progress(), 3),
            "meeting": {
                "caller": self.meeting_caller,
                "reason": self.meeting_reason,
                "remaining_seconds": max(0, int(self.meeting_end_time - time.time())) if self.status == "MEETING" else 0
            } if self.status == "MEETING" else None,
            "winner": self.winner,
            "winner_reason": self.winner_reason,
            "sabotage_lights": self.sabotage_lights,
            "vents": VENTS,
            "tasks_def": TASKS_DEF,
            "rooms": ROOMS
        }
