#!/usr/bin/env python3
"""Asset-Labeler: lokale Seite zum Anhören/Ansehen und Benennen von Sounds und 3D-Modellen.

Nur Python-Standardbibliothek. Liefert ausschließlich Dateien aus den angegebenen Wurzelordnern
aus und schreibt nur die Label-Datei. Die Assets selbst verlassen den Rechner nicht.

    python3 tools/asset-labeler/server.py \
        --root "Spiel=~/AGY/Treffen/treffen/games/monopoly/static/assets" \
        --root "MonopolyPlus=~/AGY/Treffen/Monopoly/extracted_assets" \
        --labels ~/AGY/Treffen/asset-labels.json --port 8092

Dann im Browser: http://127.0.0.1:8092/
Gleiche Dateien in mehreren Ordnern werden per Inhalts-Hash zusammengefasst (ein Label für alle).
"""
import argparse
import hashlib
import json
import os
import struct
import sys
import threading
import time
import urllib.parse
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

HERE = os.path.dirname(os.path.abspath(__file__))
AUDIO_EXT = {".wav", ".ogg", ".mp3", ".opus", ".flac"}
MODEL_EXT = {".obj", ".tmesh"}
PLAYABLE_WAV_CODECS = {0x0001, 0x0003, 0xFFFE}   # PCM, Float, Extensible
CODEC_NAMES = {0x0001: "PCM", 0x0003: "Float", 0xFFFE: "PCM (ext)", 0xFFFF: "Wwise Vorbis", 0x0002: "ADPCM"}

ROOTS = {}        # name -> absolute path
LABELS_PATH = ""
LABELS_LOCK = threading.Lock()
MANIFEST = None


def file_hash(path: str) -> str:
    h = hashlib.sha1()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:16]


def wav_info(path: str) -> dict:
    """Codec und Dauer aus dem RIFF-Header lesen (ohne die Audiodaten zu dekodieren)."""
    try:
        with open(path, "rb") as fh:
            head = fh.read(4096)
        if head[:4] != b"RIFF":
            return {"codec": "kein RIFF", "playable": False}
        fmt = head.find(b"fmt ")
        tag, ch, rate, byte_rate = struct.unpack("<HHII", head[fmt + 8:fmt + 20])
        data = head.find(b"data")
        size = struct.unpack("<I", head[data + 4:data + 8])[0] if data >= 0 else 0
        dur = (size / byte_rate) if (tag in PLAYABLE_WAV_CODECS and byte_rate) else None
        return {"codec": CODEC_NAMES.get(tag, hex(tag)), "playable": tag in PLAYABLE_WAV_CODECS,
                "channels": ch, "rate": rate, "duration": round(dur, 2) if dur else None}
    except Exception as e:  # defekte Datei soll den Scan nicht abbrechen
        return {"codec": f"Fehler: {e}", "playable": False}


def obj_info(path: str) -> dict:
    name, verts = None, 0
    with open(path, "r", errors="replace") as fh:
        for i, line in enumerate(fh):
            if line.startswith("# Model:") and not name:
                name = line.split(":", 1)[1].strip()
            elif line.startswith("v "):
                verts += 1
    return {"viewable": True, "vertices": verts, "model_name": name}


def build_manifest() -> dict:
    items = {}   # hash -> item
    for root_name, root in ROOTS.items():
        for dirpath, _, files in os.walk(root):
            for f in files:
                ext = os.path.splitext(f)[1].lower()
                if ext not in AUDIO_EXT and ext not in MODEL_EXT:
                    continue
                full = os.path.join(dirpath, f)
                rel = os.path.relpath(full, root)
                h = file_hash(full)
                if h in items:
                    items[h]["paths"].append(f"{root_name}/{rel}")
                    continue
                kind = "sound" if ext in AUDIO_EXT else "model"
                item = {"id": h, "kind": kind, "file": f, "ext": ext,
                        "paths": [f"{root_name}/{rel}"], "size": os.path.getsize(full),
                        "folder": f"{root_name}/{os.path.dirname(rel)}"}
                if ext == ".wav":
                    item.update(wav_info(full))
                elif kind == "sound":
                    item.update({"codec": ext[1:], "playable": True})
                elif ext == ".obj":
                    item.update(obj_info(full))
                else:
                    item.update({"viewable": False, "format": "Asobo TMESH (nicht im Browser darstellbar)"})
                items[h] = item
    ordered = sorted(items.values(), key=lambda x: (x["kind"], x["folder"], x["file"]))
    return {"generated": time.time(), "roots": list(ROOTS), "items": ordered}


def load_labels() -> dict:
    if os.path.exists(LABELS_PATH):
        with open(LABELS_PATH, "r", encoding="utf-8") as fh:
            return json.load(fh)
    return {}


def resolve_media(rel_url: str):
    """'<root>/<pfad>' → absoluter Pfad, nur innerhalb des Wurzelordners."""
    root_name, _, rel = rel_url.partition("/")
    root = ROOTS.get(root_name)
    if not root:
        return None
    full = os.path.realpath(os.path.join(root, rel))
    if not full.startswith(os.path.realpath(root) + os.sep):
        return None
    return full if os.path.isfile(full) else None


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # leise

    def _send(self, code, body: bytes, ctype="application/json; charset=utf-8", extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        global MANIFEST
        path = urllib.parse.unquote(urllib.parse.urlparse(self.path).path)
        if path in ("/", "/index.html"):
            with open(os.path.join(HERE, "index.html"), "rb") as fh:
                return self._send(200, fh.read(), "text/html; charset=utf-8")
        if path == "/api/manifest":
            if MANIFEST is None or "rescan" in self.path:
                MANIFEST = build_manifest()
            return self._send(200, json.dumps(MANIFEST).encode())
        if path == "/api/labels":
            with LABELS_LOCK:
                return self._send(200, json.dumps(load_labels()).encode())
        if path.startswith("/media/"):
            full = resolve_media(path[len("/media/"):])
            if not full:
                return self._send(404, b'{"error":"nicht gefunden"}')
            ext = os.path.splitext(full)[1].lower()
            ctype = {".wav": "audio/wav", ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".opus": "audio/ogg",
                     ".flac": "audio/flac", ".obj": "text/plain; charset=utf-8"}.get(ext, "application/octet-stream")
            with open(full, "rb") as fh:
                return self._send(200, fh.read(), ctype)
        return self._send(404, b'{"error":"unbekannt"}')

    def do_POST(self):
        if urllib.parse.urlparse(self.path).path != "/api/labels":
            return self._send(404, b'{"error":"unbekannt"}')
        length = int(self.headers.get("Content-Length", "0"))
        if length > 5_000_000:
            return self._send(413, b'{"error":"zu gross"}')
        try:
            update = json.loads(self.rfile.read(length))
            assert isinstance(update, dict)
        except Exception:
            return self._send(400, b'{"error":"kein JSON-Objekt"}')
        with LABELS_LOCK:
            labels = load_labels()
            for key, val in update.items():
                if val is None:
                    labels.pop(key, None)
                elif isinstance(val, dict):
                    labels[key] = {k: v for k, v in val.items() if k in ("name", "category", "use", "note", "paths", "file")}
            tmp = LABELS_PATH + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(labels, fh, ensure_ascii=False, indent=1, sort_keys=True)
            os.replace(tmp, LABELS_PATH)   # atomar – nie eine halbe Datei
        return self._send(200, json.dumps({"ok": True, "count": len(labels)}).encode())


def main():
    global LABELS_PATH
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", action="append", required=True, help="NAME=PFAD (mehrfach möglich)")
    ap.add_argument("--labels", default=os.path.expanduser("~/AGY/Treffen/asset-labels.json"))
    ap.add_argument("--host", default="127.0.0.1", help="0.0.0.0 = auch im WLAN erreichbar")
    ap.add_argument("--port", type=int, default=8092)
    args = ap.parse_args()
    for spec in args.root:
        name, _, p = spec.partition("=")
        p = os.path.realpath(os.path.expanduser(p))
        if not name or not os.path.isdir(p) or "/" in name:
            sys.exit(f"Ungültiger --root: {spec}")
        ROOTS[name] = p
    LABELS_PATH = os.path.expanduser(args.labels)
    print("Scanne Ordner …", flush=True)
    global MANIFEST
    MANIFEST = build_manifest()
    n_s = sum(1 for i in MANIFEST["items"] if i["kind"] == "sound")
    n_m = len(MANIFEST["items"]) - n_s
    print(f"{n_s} Sounds, {n_m} Modelle (Duplikate zusammengefasst). Labels: {LABELS_PATH}")
    print(f"Öffnen: http://{'127.0.0.1' if args.host in ('0.0.0.0', '127.0.0.1') else args.host}:{args.port}/", flush=True)
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
