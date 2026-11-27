"""Stockfish (offizielles Release von GitHub) holen, Prüfsumme prüfen, Programm + Lizenz ablegen.

    python games/schach/tools/fetch_stockfish.py /opt/stockfish        # → /opt/stockfish/stockfish

Genutzt von games/schach/Dockerfile, Dockerfile.fly und der CI. Version/Prüfsummen nur hier ändern
(Stockfish-Update: neue Version eintragen, Tarballs laden, `shasum -a 256` eintragen, Tests laufen lassen).
Stockfish steht unter GPL-3.0 (Copying.txt wird mit abgelegt); unser Server spricht nur per UCI mit dem
eigenständigen Programm.
"""
import hashlib
import io
import platform
import sys
import tarfile
import urllib.request
from pathlib import Path

VERSION = "sf_19"            # Stockfish 19, Release vom 2026-09-05
BASE = f"https://github.com/official-stockfish/Stockfish/releases/download/{VERSION}"
BUILDS = {   # Rechnerarchitektur → (Datei, SHA-256)
    "x86_64": ("stockfish-linux-x86-64-universal.tar.gz", "9defc0d4e55d49c65a6d042f3e571a39fcea499ade6dbe741b53b8c65e03611f"),
    "aarch64": ("stockfish-linux-arm64-universal.tar.gz", "fe26cfd1d9db4c8af3d21e24d9ff34cacb31c1f940085a7583da11796f2bac01"),
}
BUILDS["amd64"], BUILDS["arm64"] = BUILDS["x86_64"], BUILDS["aarch64"]


def main(dest: str) -> None:
    arch = platform.machine().lower()
    if arch not in BUILDS:
        sys.exit(f"Kein Stockfish-Build für {arch}")
    name, sha = BUILDS[arch]
    with urllib.request.urlopen(f"{BASE}/{name}", timeout=300) as r:
        data = r.read()
    got = hashlib.sha256(data).hexdigest()
    if got != sha:
        sys.exit(f"Prüfsumme falsch für {name}: {got}")
    out = Path(dest)
    out.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        for m in tar.getmembers():
            base = m.name.split("/")[-1]
            if m.isfile() and (base.startswith("stockfish-linux-") or base in ("Copying.txt", "AUTHORS")):
                target = out / ("stockfish" if base.startswith("stockfish-linux-") else base)
                target.write_bytes(tar.extractfile(m).read())
                if target.name == "stockfish":
                    target.chmod(0o755)
    (out / "VERSION").write_text(VERSION + "\n")
    print(f"Stockfish {VERSION} ({arch}) → {out / 'stockfish'}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/opt/stockfish")
