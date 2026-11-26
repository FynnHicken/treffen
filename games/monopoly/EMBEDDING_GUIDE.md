# Monopoly 3D Web Edition – Embedding & Integration Guide 🎩🎲

Dieses Dokument dient als vollständige Referenz für Entwickler und nachfolgende AGY-Instanzen, um das Monopoly-Spiel nahtlos in die **Party-Hub Website** (`/var/home/lukhicken/AGY/Skribbol/party-hub`) oder andere Plattformen einzubetten.

---

## 1. Architektur & Übersicht

- **Backend**: Python FastAPI mit asynchronem WebSocket-Server (`server/main.py`).
- **Standard-Port**: `8090` (konfigurierbar über Umgebungsvariable `PORT`).
- **Frontend**: Three.js WebGL 3D-Engine (`client/src/legacy/board3d.js`) + Reaktive HTML5/CSS3 Touch-Benutzeroberfläche (`client/src/legacy/game_client.js`).
- **Assets**: 100% originale Assets direkt aus der **Monopoly 2012 ROM** extrahiert:
  - Hochauflösendes deutsches Spielbrett (`2048x2048`).
  - Alle 28 offiziellen deutschen Besitzrechtkarten (`static/assets/cards/`).
  - Originale Vektor-Illustrationen von Mr. Monopoly / Uncle Pennybags (`static/assets/chance_chest/`).
  - 31 originale WAV-Soundeffekte (`static/assets/audio/`).
  - Konvertierte 3D-Meshes als Wavefront OBJ (`static/assets/models/`: alle 8 Spielfiguren, Häuser, Hotels, Würfel, Gefängnis).

---

## 2. Einbettung in den Party-Hub

Im Party-Hub (`party-hub/app.js`) wird das Spiel als `<iframe>` gestartet.

### Iframe URL-Format
```javascript
const monopolyUrl = `${protocol}//${host}:8090/?room=${encodeURIComponent(ROOM_CODE)}&name=${encodeURIComponent(userName)}`;
```

### Unterstützte URL-Query-Parameter
| Parameter | Typ | Beschreibung |
|---|---|---|
| `room` / `lobby` / `party` / `roomId` | String | Eindeutiger Raumcode. Alle Party-Teilnehmer mit demselben Code landen synchron im selben Spiel. |
| `name` / `user` / `player` | String | Spielername aus dem Party-Hub. Wird automatisch in der Lobby eingetragen. |
| `token` | String | Vorab gewählte Spielfigur: `dog`, `hat`, `car`, `ship`, `boot`, `iron`, `thimble`, `wheelbarrow`. |
| `color` | String (Hex) | Spielerfarbe, z. B. `#e74c3c` oder `3498db`. |

### Iframe PostMessage API
Das Spiel kommuniziert mit dem übergeordneten Fenster (`window.parent`):

- **Gesendet von Monopoly an den Party-Hub**:
  ```javascript
  // Beim Laden des Spiels:
  window.parent.postMessage({ type: 'MONOPOLY_READY', roomId: roomId, playerId: playerId }, '*');
  ```
- **Vom Party-Hub empfangen (optional)**:
  ```javascript
  // Der Party-Hub kann das Spiel fernsteuern:
  iframe.contentWindow.postMessage({ action: 'START_GAME' }, '*');
  ```

---

## 3. Kamera-Modi & Responsive Design (Handy vs. Desktop)

Das Spiel erkennt automatisch das Endgerät des Spielers und passt Steuerung und Perspektive an:

### 📱 Smartphone / Handy UX (`<= 850px` Bildschirmbreite)
1. **2D Draufsicht (Top-Down)** *(Standard auf Mobilgeräten)*:
   - Reine Vogelperspektive von oben auf das deutsche Spielbrett.
   - Die 3D-Kipprotation (`controls.enableRotate`) ist gesperrt, damit Wisch- und Tippgesten auf dem Touchscreen das Brett nicht versehentlich verdrehen.
2. **2.5D Schrägansicht (Tisch-Modus)**:
   - Schräge isometrische Perspektive wie an einem echten Wohnzimmertisch.
3. **90°-Schnelldrehtasten (`↺` / `↻`)**:
   - Mit einem Fingertipp dreht sich die Ansicht zur nächsten Kante des Bretts, sodass Spieler ihre Straßen aus optimalem Winkel betrachten können.
4. **Touch-Optimierung**:
   - Daumengerechtes Aktions-Cockpit am unteren Bildschirmrand (`Würfeln`, `Kaufen`, `Mein Besitz`, `Zug beenden`).
   - Horizontales Spielerband oben für schnellen Überblick über Mitspieler & Kontostände.

### 💻 Desktop UX (`> 850px` Bildschirmbreite)
1. **3D Freie Kamera**:
   - Volle 360-Grad Orbit-Kamerasteuerung (linke/rechte Maustaste zum Drehen, Mausrad zum Zoomen).
   - Dynamischer Kamera-Fokus auf hüpfende Spielfiguren beim Ziehen.
2. **Kamera-Umschalter in der Kopfleiste**:
   - Drei Buttons (`2D`, `2.5D`, `3D`) erlauben den blitzschnellen Wechsel zu jeder Zeit. Der aktuell aktive Modus wird farblich hervorgehoben.
3. **Erweitertes Dashboard**:
   - Linke Seitenleiste: Detaillierte Spielerkarten mit Spielfigur-Icon, Bargeld und Status (Gefängnis, Bot).
   - Rechte Seitenleiste: Live-Spielprotokoll und Party-Chat.

---

## 4. Karten & Interaktionen aus der ROM

### Besitzrechtkarten (Deeds)
- Ein Klick auf ein beliebiges Feld auf dem 3D-Brett oder in der Vermögensübersicht ("Mein Besitz") öffnet die detailgetreue deutsche Original-Karte aus der 2012 ROM (`static/assets/cards/`).
- Befindet sich die Straße in Hypothek, wird ein authentischer roter **HYPOTHEK**-Stempel über die Karte gelegt.
- Über die Aktionsbuttons unter der Karte können berechtigte Spieler direkt Häuser/Hotels bauen, verkaufen oder Hypotheken aufnehmen/ablösen.

### Ereignis- & Gemeinschaftskarten
- Beim Ziehen einer Karte erscheint ein Popup im Stil der klassischen Karten.
- Je nach Text der Karte wird automatisch die passende Original-Illustration des Monopoly-Mannes (Uncle Pennybags) aus der ROM eingeblendet (Gefängnis, Geldstrafe, Bank-Erbe, Renovierung, Los).

---

## 5. Server starten & testen

```bash
# In das Verzeichnis wechseln:
cd /var/home/lukhicken/AGY/Skribbol/Monopoly/web_game

# Server starten (Port 8090):
./run_server.sh

# Alternativ via Python direkt mit individuellem Port:
PORT=8090 python3 server/main.py
```

- **Lokale Adresse**: `http://localhost:8090/?name=Spieler1`
- **Netzwerk/Handy-Adresse**: `http://<DEINE_LAN_IP>:8090/?name=HandySpieler`
