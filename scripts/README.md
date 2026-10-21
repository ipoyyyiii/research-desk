# Skrip setups

Folder ini berisi skrip buat menyiapkan mesin lokal. Semua yang dihasilkan di
sini besar dan lisensinya terpisah, jadi **tidak** ikut di-commit ke GitHub
(sudah masuk `.gitignore`).

## Sekali jalan di mesin baru

```bash
bash scripts/setup-semua.sh
```

Itu akan:

1. unduh **WordCraft** (tab Word) ke `public/wordcraft/`
2. unduh **GridCraft** (tab Excel) ke `public/gridcraft/`
3. bikin **pack font** WordCraft di `data/wordcraft-fonts/`

Selesai, lalu jalankan app-nya:

```bash
pnpm install
pnpm build
pnpm start
```

## Skrip individual

| Skrip | Guna |
|---|---|
| `setup-semua.sh` | orchestrator di atas |
| `fetch-wordcraft.sh` | unduh WordCraft web build (versi terbaru dari GitHub release) |
| `fetch-gridcraft.sh` | unduh GridCraft web build |
| `wordcraft-fontpack.mjs` | pack font Google Docs (v1) |
| `wordcraft-fontpack-v3.py` | pack font v3 — core font Microsoft asli + klon metrik |
| `wordcraft-font-alias.py` | tambah alias metrik (Calibri→Carlito dst) ke pack |
| `make-reference-docx.mjs` | generate `templates/skripsi-reference.docx` (TNR 12, spasi 1,5, margin 4-3-3-3 cm) |

## Catatan

- `fetch-wordcraft.sh` dan `fetch-gridcraft.sh` **skip** kalau foldernya sudah
  ada. Hapus foldernya dulu kalau mau update ke versi baru.
- Versi bisa dikunci: `GRIDCRAFT_VER=0.9.0 bash scripts/fetch-gridcraft.sh`.
- Pack font butuh `fontTools` (`python3 -m pip install --user fonttools`) dan
  core font Microsoft (`sudo apt install ttf-mscorefonts-installer`). Kalau
  belum ada, app tetap jalan — cuma daftar font di WordCraft kurang lengkap.
- `make-reference-docx.mjs` butuh `pandoc` + `jszip` (jszip sudah jadi
  dependency app).
