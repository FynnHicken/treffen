"""Treffen-Spieltisch: gemeinsamer Server für alle Tisch-Spiele (siehe docs/tabletop/KONZEPT.md)."""
from .version import ENGINE_VERSION, SUPPORTED_RULES_APIS
from .rules import GameRules, Rules
from .rooms import GameDef, Room, Variant, clean_text
from .app import create_app

__version__ = ENGINE_VERSION
__all__ = ["ENGINE_VERSION", "SUPPORTED_RULES_APIS", "GameDef", "GameRules", "Room", "Rules", "Variant", "clean_text",
           "create_app"]
