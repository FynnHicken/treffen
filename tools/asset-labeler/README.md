# Asset-Labeler

Lokale Seite zum Anhören/Ansehen und Benennen von Sounds und 3D-Modellen (für die Monopoly-Assets).
Nur Python-Standardbibliothek; die Assets verlassen den Rechner nicht (deshalb kein claude.ai-Artifact:
zu groß, kommerzielle Assets, und eine https-Seite darf keinen lokalen http-Server abfragen).

## Starten

```bash
cd ~/AGY/Treffen
python3 treffen/tools/asset-labeler/server.py \
  --root "Spiel=treffen/games/monopoly/static/assets" \
  --root "MonopolyPlus=Monopoly/extracted_assets" \
  --root "WiiAssets=Skribbol/Monopoly/Assets" \
  --labels ~/AGY/Treffen/asset-labels.json --port 8092
```

Öffnen: <http://127.0.0.1:8092/>. Standardmäßig nur lokal erreichbar; `--host 0.0.0.0` gibt die Dateien
im ganzen WLAN frei (nur bewusst verwenden).

- Gleiche Dateien in mehreren Ordnern werden per Inhalts-Hash zusammengefasst (ein Label gilt für alle).
- Labels landen in `--labels` (JSON, Schlüssel = Inhalts-Hash): `name`, `category`, `use` (⭐ fürs Spiel),
  `note`, `paths`. Export-Knopf lädt dieselbe Datei herunter.
- Tastatur: Leertaste abspielen · ↑/↓ wechseln (spielt direkt ab) · Enter Name · S ⭐ · Esc.
- Sprechende Dateinamen (`figur_hund_laufen.wav`, `BOARD_MESH.TMESH`) werden als Namensvorschlag angezeigt.

## Monopoly-Plus-Sounds abspielbar machen

Die extrahierten `.wav` aus Monopoly Plus enthalten **Wwise-Vorbis** (Codec `0xFFFF`) – kein Browser und
kein ffmpeg spielt das ab. Umwandeln mit [vgmstream](https://github.com/vgmstream/vgmstream) (Open Source):

```bash
# vgmstream-linux.zip vom Release herunterladen und entpacken, dann:
cd ~/AGY/Treffen/Monopoly/extracted_assets
for d in sfx voices_de voices_en music; do
  mkdir -p "audio_playable/$d"
  for f in "audio/$d"/*.wav; do /PFAD/vgmstream-cli -o "audio_playable/$d/$(basename "$f")" "$f"; done
done
```

Danach im Labeler „↻ Neu scannen“. Die umgewandelten Dateien erscheinen als eigene Einträge
(Ordner `MonopolyPlus/audio_playable/…`).

## 3D-Modelle

- `.obj` (Spiel, Wii-Konvertierungen) werden mit three.js angezeigt (lädt three.js von jsdelivr).
- `.tmesh` (Monopoly Plus, Asobo-Format `BFF0`) sind nicht im Browser darstellbar, aber bereits
  sprechend benannt (z. B. `BILLS_EXPORT_SIMPLEBILL100…`) – sie können über den Namen kategorisiert werden.
  Zum Konvertieren bräuchte es ein BFF-Werkzeug (im Ordner liegt `Monopoly/bff_bin/bff-cli`, ungeprüft).

## Herkunft der Sound-Namen

Im Originalarchiv liegt `SOUNDBANKS/StreamSoundNames.DEBUG.PC.txt` (Dateiname → ID, z. B.
`VO__MRMONOP__CLASSIC__BUYHOUSE__M__2.wav`). Die IDs passen **nicht** zu den IDs in `VO.PC.PCK`
(andere Build-Version: 141 statt 150 Zeilen pro Sprache, weder direkte IDs noch FNV-1-Hashes stimmen
überein) – deshalb ist Benennen von Hand bzw. per Spracherkennung nötig.
