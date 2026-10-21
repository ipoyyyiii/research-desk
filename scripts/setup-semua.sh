#!/usr/bin/env bash
# Pasang semua binary lokal yang di-gitignore: WordCraft, GridCraft, pack font.
#
# Dipakai waktu pindah laptop / mesin baru / clone repo di tempat lain.
#   bash scripts/setup-semua.sh
#
# Butuh: curl, python3, unzip/zipfile. Butuh juga node (buat build app) dan
# pandoc (buat ekspor DOCX/PDF).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "== 1/3 WordCraft (tab Word) =="
bash scripts/fetch-wordcraft.sh

echo
echo "== 2/3 GridCraft (tab Excel) =="
bash scripts/fetch-gridcraft.sh

echo
echo "== 3/3 Pack font WordCraft =="
if [ -d data/wordcraft-fonts ] && [ -f data/wordcraft-fonts/manifest.json ]; then
  echo "pack font sudah ada — skip"
elif python3 -c 'import fontTools' 2>/dev/null; then
  python3 scripts/wordcraft-fontpack-v3.py || echo "pack font GAGAL (lanjutkan, font bawaan WordCraft tetap jalan)"
else
  echo "fontTools belum ada — lewati pack font."
  echo "  pasang: python3 -m pip install --user fonttools"
  echo "  font core Microsoft: sudo apt install ttf-mscorefonts-installer"
fi

echo
echo "== Selesai =="
echo "cek hasil:"
ls -d public/wordcraft public/gridcraft 2>/dev/null || true
ls data/wordcraft-fonts/manifest.json 2>/dev/null || true
echo
echo "lalu jalankan app:  pnpm install && pnpm build && pnpm start"
