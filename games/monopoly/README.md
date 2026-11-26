# Monopoly 3D Web Edition 🎲🎩
> **High-End 3D Mehrspieler-Brettspiel im Stil der Nintendo Wii / Konsolen-Edition (2012)**  
> Entwickelt mit FastAPI (Python Backend mit WebSockets) und Three.js (WebGL 3D-Engine).

---

## 📋 Inhaltsverzeichnis
1. [Überblick & Highlights](#-überblick--highlights)
2. [Quickstart (Standalone starten)](#-quickstart-standalone-starten)
3. [Integration in die Party-Hub Website](#-integration-in-die-party-hub-website)
4. [Projekt- & Verzeichnisstruktur](#-projekt--verzeichnisstruktur)
5. [Architektur & Schnittstellen](#-architektur--schnittstellen)
6. [WebSocket- & API-Protokoll](#-websocket--und-api-protokoll)
7. [Steuerung, Kamera & UX-Modi](#-steuerung-kamera--ux-modi)
8. [Assets & Lizenzen](#-assets--ressourcen)
9. [Deployment & Reverse Proxy (Nginx)](#-deployment--reverse-proxy)
10. [Checkliste für die Hub-Integration](#-checkliste-für-die-hub-integration)

---

## 🌟 Überblick & Highlights

Dieses Monopoly wurde als vollwertiges Web-Spiel konzipiert, das sich nahtlos als **Iframe** in eine übergeordnete Hub-Website (`party-hub`) oder als Standalone-Spiel betreiben lässt:

- **Echte 3D-Brettspiel-Atmosphäre**:
  - Physischer 3D-Holztisch mit Three.js & PBR-Materialien.
  - Spielfiguren, Häuser, Hotels, Würfel und Spielkarten existieren als echte 3D-Objekte auf dem Tisch.
  - Physische Besitzrechtkarten und DM-Geldbündel der Spieler liegen sichtbar an den 4 Tischplätzen.
  - Animierte Würfel-Physik und schrittweise hüpfende 3D-Spielfiguren mit synchronisierten Sounds.
- **Konsolen-Design ("Weniger ist mehr")**:
  - Minimalistische, aufgeräumte Benutzeroberfläche ohne störende Vollbild-Tabellen.
  - Sanfte Kamerafahrten, automatische Verfolgung am eigenen Zug und freie Rundumsicht, wenn andere Spieler am Zug sind.
  - **Nahansicht-Modus**: Klick auf eigene oder fremde Karten/Pods zoomt direkt an den Platz; ein Klick auf `↩ Zurück zur Brettansicht`, die `ESC`-Taste oder Klick ins Leere führt sofort zurück zur Übersicht.
- **Deutsches Original-Regelwerk**:
  - Alle 40 Original-Felder (Badstraße bis Schlossallee, 4 Bahnhöfe, Versorgungsbetriebe, Steuern, Gefängnis).
  - Häuser-/Hotelbau, Hypothekenverwaltung (+10% Zins), Gefängnis-Freikarten, Kaution, Pasch-Regeln.
  - Vollständiges Handelsmenü (Geld & Straßen tauschen zwischen Spielern).
  - Intelligente KI-Bots zum Auffüllen von Lobbys oder für Solo-Runden.
- **Plattformübergreifend**:
  - Automatische Optimierung für Mobilgeräte (Handys/Tablets mit Touch-Gesten) und Desktop-PCs.

---

## 🚀 Quickstart (Standalone starten)

### 1. Abhängigkeiten installieren
Benötigt Python 3.9+:
```bash
pip install -r requirements.txt
```
*(Pakete: `fastapi`, `uvicorn[standard]`, `websockets`, `pillow`)*

### 2. Server starten
Das Start-Skript startet das Spiel standardmäßig auf Port **`8090`** (dem vom Party-Hub erwarteten Port):
```bash
./run_server.sh
```

Alternativ manuell über Python (mit konfigurierbarem Port):
```bash
PORT=8090 python3 server/main.py
```

### 3. Im Browser öffnen
- Lokal: [http://localhost:8090](http://localhost:8090)
- Netzwerk (Handys/Laptops im selben WLAN): `http://<LOKALE_IP>:8090`

---

## 🔌 Integration in die Party-Hub Website

In der Party-Hub Website (`/var/home/lukhicken/AGY/Skribbol/party-hub`) ist Monopoly bereits im Spielekatalog registriert.

### 1. Iframe-Einbindung (`party-hub/app.js`)
Die Hub-Website öffnet das Spiel im Iframe über die Funktion `getGameUrl()`:
```javascript
// Bereits in party-hub/app.js hinterlegt:
if (game.id === "monopoly") {
    return `${proto}//${host}:8090/?room=${encodeURIComponent(ROOM_CODE)}&name=${encodeURIComponent(userName)}`;
}
```

### 2. Unterstützte URL-Query-Parameter
Beim Aufruf der URL wertet das Spiel folgende Parameter automatisch aus:

| Parameter | Aliasse | Typ | Beschreibung |
|---|---|---|---|
| `room` | `lobby`, `party`, `roomId` | String | Raum-Code (z. B. `LZAD0Z`). Alle Spieler mit demselben Code landen automatisch im selben Raum. |
| `name` | `user`, `player`, `username` | String | Spielername aus dem Hub. Wird direkt in der Spiellobby vorselektiert. |
| `token` | `figure` | String | Vorab gewählte 3D-Figur: `dog`, `hat`, `car`, `ship`, `boot`, `iron`, `thimble`, `wheelbarrow`. |
| `color` | - | String | Spielerfarbe (Hex-Code wie `#e74c3c` oder `3498db`). |

### 3. `postMessage` Iframe-Kommunikation
Monopoly tauscht Nachrichten mit dem übergeordneten Fenster (`window.parent`) aus:

#### Gesendet von Monopoly an den Party-Hub:
```javascript
// 1. Beim initialen Laden der Seite:
window.parent.postMessage({
    type: 'MONOPOLY_READY',
    roomId: 'LZAD0Z',
    playerId: 'p_xxxxxx'
}, '*');

// 2. Bei jedem Spielstatus-Update (Zug beendet, Würfelwurf, Kauf etc.):
window.parent.postMessage({
    type: 'MONOPOLY_UPDATE',
    state: gameState,      // Vollständiges JSON-State-Objekt
    event: 'DICE_ROLLED'   // bzw. 'TURN_ENDED', 'CARD', etc.
}, '*');
```

#### Empfangen vom Party-Hub (Fernsteuerung, optional):
```javascript
// Der Hub kann das Spiel im Iframe starten:
iframe.contentWindow.postMessage({ action: 'START_GAME' }, '*');
```

---

## 📁 Projekt- & Verzeichnisstruktur

```
web_game/
├── server/
│   ├── main.py              # FastAPI Web- & WebSocket-Server, REST-Endpoints & Bot-Runner
│   └── game_state.py        # Monopoly-Spiellogik (40 Felder, Bank, Runden, Karten, Bots)
├── static/
│   ├── index.html           # Minimalistisches Konsolen-HUD & Modals
│   ├── css/
│   │   └── style.css        # Clean Console UI, Glassmorphism, Responsive Mobile/Desktop
│   ├── js/
│   │   ├── three.min.js     # Three.js 3D WebGL Library (r128)
│   │   ├── OrbitControls.js # 3D-Kamerasteuerung (angepasst für fixe 2.5D & 3D Orbit)
│   │   ├── audio.js         # Web Audio API Synthesizer + Fallback für Original-WAVs
│   │   ├── board3d.js       # 3D-Engine: Spielfeld, Meshes, Hüpfen, Decks, Tischkarten
│   │   └── game_client.js   # Client-Logik, WebSocket-Handler, UI-Binds, postMessage
│   └── assets/
│       ├── models/          # 8 Original 3D-Figuren (.obj), Haus, Hotel
│       ├── textures/        # Deutsches Spielbrett 2048x2048, Holz, Geldnoten, Würfel
│       ├── cards/           # Alle 28 deutschen Original-Besitzrechtkarten (ROM)
│       ├── chance_chest/    # Mr. Monopoly Vektor-Illustrationen & Kartendeck-Texturen
│       └── audio/           # 31 originale Soundeffekte (.wav)
├── requirements.txt         # Python-Paketabhängigkeiten
├── run_server.sh            # Ausführbares Startskript (Port 8090)
├── README.md                # Diese Dokumentation
└── EMBEDDING_GUIDE.md       # Zusätzlicher technischer Integrations-Leitfaden
```

---

## ⚙️ Architektur & Schnittstellen

### Backend (`server/main.py` & `server/game_state.py`)
- **FastAPI Framework**: Schnelle, asynchrone Python-Architektur.
- **Dynamische Pfadauflösung**: Relative Pfadverarbeitung (`Path(__file__).resolve()`) – die Anwendung kann an einen beliebigen Ort verschoben werden, ohne Pfadkonflikte.
- **REST-Endpoints**:
  - `GET /`: Liefert die Hauptseite (`index.html`).
  - `GET /static/...`: Liefert statische Assets (3D-Modelle, Texturen, Audio).
  - `GET /api/config`: Liefert Konfiguration (verfügbare Spielfiguren, Farben, Felddaten).
- **WebSocket-Verbindung**:
  - Endpoint: `/ws/{room_id}/{player_id}`
  - Raum- und Sitzungsverwaltung mit automatischer Wiederverbindung.

---

## 📡 WebSocket- und API-Protokoll

Die gesamte bidirektionale Kommunikation erfolgt über JSON-Nachrichten über den WebSocket `/ws/{room_id}/{player_id}`.

### 1. Client an Server (`sendWsMessage`)

| Aktion (`action`) | Parameter | Beschreibung |
|---|---|---|
| `JOIN` | `name`, `token`, `color` | Spieler registriert sich in der Lobby |
| `ADD_BOT` | - | Fügt einen KI-Gegner zur Runde hinzu |
| `START_GAME` | - | Startet das Spiel aus der Lobby |
| `ROLL_DICE` | - | Würfelt (am eigenen Zug) |
| `BUY_PROPERTY` | - | Kauft das betretene Grundstück |
| `PASS_BUY` | - | Verzicht auf Direktkauf |
| `BUILD_HOUSE` | `square_index` | Baut ein Haus / Hotel auf der Straße |
| `SELL_HOUSE` | `square_index` | Verkauft ein Haus |
| `MORTGAGE` | `square_index` | Nimmt Hypothek auf das Grundstück auf |
| `UNMORTGAGE` | `square_index` | Löst Hypothek ab (+10% Bankgebühr) |
| `PAY_BAIL` | - | Zahlt 50 DM Kaution, um das Gefängnis zu verlassen |
| `USE_JAIL_CARD` | - | Nutzt "Frei aus dem Gefängnis"-Karte |
| `END_TURN` | - | Beendet den aktuellen Zug |
| `PROPOSE_TRADE` | `target_id`, `offer_money`, `offer_props`, `req_money`, `req_props` | Schlägt einem Mitspieler einen Handel vor |
| `ACCEPT_TRADE` | - | Akzeptiert ein eingehendes Angebot |
| `REJECT_TRADE` | - | Lehnt ein eingehendes Angebot ab |
| `CHAT` | `text` | Sendet Chatnachricht an alle Spieler im Raum |

### 2. Server an Client (`handleServerMessage`)

Jede Servernachricht enthält optional das Feld `state`, welches den vollständigen, aktuellen Raum-Zustand widerspiegelt (`players`, `board_state`, `current_player`, `status`, `logs` etc.).

Wichtige Ereignis-Typen (`type`):
- `ROOM_JOINED`: Eigene Bestätigung mit Spieler-ID und Raumstatus.
- `GAME_STARTED`: Spiel gestartet, Lobby schließt sich automatisch.
- `DICE_ROLLED`: Enthält Würfelergebnis (`dice: [d1, d2]`), Hop-Animation & Folgeaktion (`action: 'CARD'`, `'BUY_OR_AUCTION'`).
- `CARD`: Eine Ereignis- oder Gemeinschaftskarte wurde gezogen.
- `PROPERTY_BOUGHT`: Eine Straße/Bahnhof wurde erworben.
- `HOUSE_BUILT` / `HOUSE_SOLD`: Bauaktionen synchronisiert.
- `TRADE_PROPOSED`: Ein Handelsangebot liegt für den Zielspieler vor.
- `TURN_ENDED`: Nächster Spieler ist an der Reihe.

---

## 🎮 Steuerung, Kamera & UX-Modi

### 1. Kamera-Modi
- **2.5D Tisch-Modus** *(Standard auf Desktop)*:
  - Isometrischer Blickwinkel wie an einem echten Spieltisch.
  - **Fixer Neigungswinkel**: Vertikales Wackeln/Kippen ist gesperrt (`atan2(8.8, 8.5) = ~46°`), horizontale 360°-Drehung und Zoom sind flüssig möglich.
- **2D Draufsicht (Top-Down)** *(Standard auf Smartphones)*:
  - Vogelperspektive direkt von oben für perfekte Lesbarkeit auf kleinen Displays.
- **3D Freie Kamera**:
  - Vollständige Orbit-Kamera mit freier Neigung, Drehung und Zoom.
- **↺ / ↻ 90°-Drehbuttons**:
  - Dreht das Spielfeld in 90°-Schritten zur nächsten Kante.

### 2. Tisch-Nahansicht & Interaktionen
- **Karten & Geld auf dem Tisch**:
  - Vor jedem Spielerplatz liegen die erworbenen Besitzrechtkarten und DM-Geldscheine physisch auf dem Tisch.
  - Ein Klick auf die Karten oder auf den Spieler-Pod im Header wechselt nahtlos in die **Nahansicht dieses Spielers**.
  - In der Nahansicht schwebt der Button **`↩ Zurück zur Brettansicht`**. Alternativ führt die `ESC`-Taste oder ein Klick ins Leere sofort zurück.
- **Aufgedeckte Ereignis- & Gemeinschaftskarten**:
  - Liegen exakt in den gestrichelten Markierungen auf dem Spielbrett:
    - Gemeinschaftskarten: `x = -2.21`, `z = -2.21`
    - Ereigniskarten: `x = +2.205`, `z = +2.205`
  - Wenn ein Spieler auf einem Kartenfeld landet, poppt die Karte für ihn automatisch groß auf.
  - Für alle Mitspieler liegt die gezogene Karte aufgedeckt auf dem 3D-Stapel – ein Klick darauf öffnet die detaillierte Nahansicht.

---

## 🎨 Assets & Ressourcen

Alle Assets liegen lokal im Repository (`static/assets/`), es gibt **keine externen CDN-Abhängigkeiten** im Spielbetrieb:

| Verzeichnis | Inhalt |
|---|---|
| `assets/models/` | 8 Spielfiguren (`token_*.obj`), Haus (`house.obj`), Hotel (`hotel.obj`) |
| `assets/textures/` | Spielbrett (`board_de_2048.png`), Holztisch, Geldscheine (1, 5, 10, 20, 50, 100, 500 DM) |
| `assets/cards/` | 28 hochauflösende Besitzrechtkarten (`01_strasse_badstrasse.png` bis `28_strasse_schlossallee.png`) |
| `assets/chance_chest/` | Original Mr. Monopoly Vektor-Grafiken, Kartendeck-Rückseiten mit NotoSans-Prägung |
| `assets/audio/` | 31 originale Sounddateien für Würfeln, Kaufen, Miete, Gefängnis, Karten |

---

## 🌐 Deployment & Reverse Proxy

### Nginx-Konfiguration (Beispiel für Subdomain oder Subpath)
Damit WebSockets durch einen Reverse-Proxy (z. B. auf Port 80/443) einwandfrei funktionieren, müssen die Upgrade-Header weitergeleitet werden:

```nginx
server {
    listen 80;
    server_name monopoly.mein-partyhub.de;

    location / {
        proxy_pass http://127.0.0.1:8090;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## ✅ Checkliste für die Hub-Integration

Wenn du die andere AGY-Instanz bist, die das Spiel in die Hub-Website integriert:

1. **Dateien platzieren**:
   - Das entpackte `web_game/` Verzeichnis kann direkt an seinem Ort bleiben (`/var/home/lukhicken/AGY/Skribbol/Monopoly/web_game`) oder in das Hub-Verzeichnis verschoben werden.
2. **Abhängigkeiten**:
   - `pip install -r requirements.txt` ausführen.
3. **Server starten**:
   - `./run_server.sh` startet den Server auf Port `8090`.
   - (Falls ein anderer Port gewünscht ist: `PORT=xxxx ./run_server.sh` übergeben und in `party-hub/app.js:895` anpassen).
4. **Hub-Iframe testen**:
   - Party-Hub öffnen (`http://localhost:3000` bzw. konfigurierter Port).
   - In der Spieleauswahl "Monopoly" anklicken.
   - Der Iframe lädt `http://localhost:8090/?room=<PARTY_CODE>&name=<SPIELER_NAME>`.
   - Die Spieler treten automatisch demselben Monopoly-Raum bei.
   - Spiel starten & Spaß haben! 🎩🎲
