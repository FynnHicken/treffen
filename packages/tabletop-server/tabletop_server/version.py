"""Versionsnummer des Spieltischs (Engine) – eine Quelle für Server und Client.

Schema (SemVer, siehe packages/CHANGELOG.md):
  MAJOR  bricht Spiele (Regel-Schnittstelle oder Protokoll inkompatibel geändert)
  MINOR  neue Möglichkeiten, alte Spiele laufen unverändert weiter
  PATCH  Fehlerbehebungen

Der Client hat dieselbe Nummer in packages/tabletop/src/version.ts; ein Test prüft, dass beide gleich sind.
"""
ENGINE_VERSION = "2.7.0"

#: Regel-Schnittstellen, die diese Engine versteht (rules.py). 1 = Mensch-Stil (würfeln/ziehen), 2 = Aktionen.
SUPPORTED_RULES_APIS = (1, 2)
