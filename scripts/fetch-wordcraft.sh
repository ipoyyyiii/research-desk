#!/usr/bin/env bash
# Unduh WordCraft web build ke public/wordcraft/ (di-gitignore, ±41MB).
#
# Versi dikunci ke build yang sudah diuji dengan integrasi tab Word di app ini.
# Zip release berisi satu folder teratas; script ini meratakan isinya.
#
#   bash scripts/fetch-wordcraft.sh                        # versi teruji (0.8.0)
#   WORDCRAFT_VER=0.9.0 bash scripts/fetch-wordcraft.sh    # kalau mau versi lain
set -euo pipefail

REPO="storytold/wordcraft"
VER="${WORDCRAFT_VER:-0.8.0}"
DEST="$(cd "$(dirname "$0")/.." && pwd)/public/wordcraft"

if [ -f "$DEST/index.html" ]; then
  echo "WordCraft sudah ada di $DEST — skip (hapus foldernya dulu untuk update)"
  exit 0
fi

URL="https://github.com/${REPO}/releases/download/v${VER}/wordcraft-web-${VER}.zip"
TMP="/tmp/wordcraft-${VER}.zip"

echo "WordCraft ${VER} diunduh dari ${URL}"
curl -fsSL "$URL" -o "$TMP"

rm -rf /tmp/wordcraft-extract
python3 - "$TMP" "$DEST" << 'PY'
import os, shutil, sys, zipfile

archive, dest = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(archive) as z:
    z.extractall('/tmp/wordcraft-extract')

root = '/tmp/wordcraft-extract'
entries = os.listdir(root)
if len(entries) == 1 and os.path.isdir(os.path.join(root, entries[0])):
    root = os.path.join(root, entries[0])

os.makedirs(dest, exist_ok=True)
for name in os.listdir(root):
    shutil.move(os.path.join(root, name), os.path.join(dest, name))
PY

rm -rf /tmp/wordcraft-extract "$TMP"
echo "WordCraft ${VER} siap di $DEST"
