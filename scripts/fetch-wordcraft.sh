#!/usr/bin/env bash
# Unduh WordCraft web build resmi ke public/wordcraft/ (di-gitignore, 41MB).
set -euo pipefail
VER="0.8.0"
DEST="$(dirname "$0")/../public/wordcraft"
mkdir -p "$DEST"
if [ -f "$DEST/index.html" ]; then echo "sudah ada — skip"; exit 0; fi
curl -sL "https://github.com/storytold/wordcraft/releases/download/v${VER}/wordcraft-web-${VER}.zip" -o /tmp/wordcraft.zip
python3 - "$DEST" << 'PY'
import sys, zipfile
dest = sys.argv[1]
z = zipfile.ZipFile('/tmp/wordcraft.zip')
inner = z.namelist()[0].split('/')[0]
z.extractall('/tmp/wordcraft-extract')
import shutil, os
src = os.path.join('/tmp/wordcraft-extract', inner)
for f in os.listdir(src):
    shutil.move(os.path.join(src, f), os.path.join(dest, f))
PY
echo "WordCraft ${VER} siap di $DEST"
