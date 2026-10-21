#!/usr/bin/env bash
# Unduh GridCraft web build resmi ke public/gridcraft/ (di-gitignore, ±19MB).
#
# Versi diambil dari release terbaru GitHub, jadi script ini gak perlu diubah
# tiap ada release baru. Set GRIDCRAFT_VER=0.9.0 untuk mengunci versi.
set -euo pipefail

REPO="storytold/gridcraft"
DEST="$(cd "$(dirname "$0")/.." && pwd)/public/gridcraft"

if [ -f "$DEST/index.html" ]; then
  echo "GridCraft sudah ada di $DEST — skip (hapus foldernya dulu untuk update)"
  exit 0
fi

VER="${GRIDCRAFT_VER:-}"
if [ -z "$VER" ]; then
  VER=$(curl -sL "https://api.github.com/repos/${REPO}/releases/latest" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["tag_name"].lstrip("v"))')
fi

ASSET="gridcraft-web-${VER}.zip"
URL="https://github.com/${REPO}/releases/download/v${VER}/${ASSET}"
TMP="/tmp/gridcraft-${VER}.zip"

echo "GridCraft ${VER} diunduh dari ${URL}"
curl -fsSL "$URL" -o "$TMP"

rm -rf /tmp/gridcraft-extract
python3 - "$TMP" "$DEST" << 'PY'
import os, shutil, sys, zipfile

archive, dest = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(archive) as z:
    z.extractall('/tmp/gridcraft-extract')

root = '/tmp/gridcraft-extract'
# Release zip kadang berisi satu folder teratas — flatten.
entries = os.listdir(root)
if len(entries) == 1 and os.path.isdir(os.path.join(root, entries[0])):
    root = os.path.join(root, entries[0])

os.makedirs(dest, exist_ok=True)
for name in os.listdir(root):
    shutil.move(os.path.join(root, name), os.path.join(dest, name))
PY

rm -rf /tmp/gridcraft-extract "$TMP"
echo "GridCraft ${VER} siap di $DEST"
