# Vibe Research

> Satu tempat untuk nulis skripsi + baca jurnal + tanya AI.
>
> Repo GitHub: `ipoyyyiii/vibe-research`.

Workspace lokal buat ngulis skripsi: naskah per-bab, literatur, data, dan
asisten AI dalam satu aplikasi. Semua file nyimpan di disk (bukan di cloud),
jadi skripsi lu tetap milik lu dan bisa dibuka ulang di mesin mana pun.

Dibuat buat satu orang: yang lagi nulis skripsi dan capek lompat-lompat
antar aplikasi — jurnal di satu tab, Word di tab lain, PPT lagi, chat AI di
tiga window, sitasi dicatat manual.

## Isi

- [Yang bisa dilakuin](#yang-bisa-dilakuin)
- [Stack](#stack)
- [Jalanin](#jalanin)
- [Struktur folder kerja](#struktur-folder-kerja)
- [Dokumen & sitasi](#dokumen--sitasi)
- [AI](#ai)
- [Struktur kode](#struktur-kode)
- [Catatan & batasan](#catatan-&batasan)

## Yang bisa dilakuin

**Menulis naskah**
- Naskah per-bab (`dokumen/bab1-pendahuluan.md`) — format markdown, tapi ditulis
  di editor yang berasa kayak Word: ribbon lengkap, font, spasi baris, tabel,
  gambar, daftar, heading bab.
- Tab **Word** (WordCraft) — buat yang terbiasa pakai Word beneran: dokumen .md bisa
  dibuka di Word, diedit, lalu dikembalikan ke bab (round-trip otomatis).
- Tab **Excel** (GridCraft) — buka .xlsx/.csv di app, simpan balik ke project.
- **Riwayat versi** tiap bab: sebelum isi bab ditimpa, versi lamanya disimpan
  sebagai file di dalam folder project. Bandingkan, kembalikan, atau hapus.
- **Kualitas draf**: deteksi basa-basi, catatan kutip nyelip, "Daftar Pustaka"
  nyelip di tengah bab, judul bab nyelip kalimat, kalimat gantung (…); sebagian
  bisa diperbaiki otomatis.

**Literatur & sitasi**
- Cari jurnal di OpenAlex + Crossref + Semantic Scholar, filter, unduh PDF
  open-access, simpan ke perpustakaan.
- **Matriks literatur** (Bab 2): tarik paper dari perpustakaan, isi kolom tema
  / metode / temuan / kutipan, ekspor jadi tabel markdown.
- **Anotasi**: catat dan kutipin dari paper; kutipannya bisa langsung didorong
  ke kolom Kutipan di matriks.
- **Zotero** (Better BibTeX auto-export) dan import `.bib`/`.ris` (Mendeley).
- Sitasi ditulis sebagai marker `[@kunci]`; daftar pustaka dibikin otomatis
  saat ekspor (pandoc + citeproc), gaya APA/IEEE.

**Data & analisis**
- Panel Data: unggah CSV/XLSX, pasang skrip `uji-statistik.py` (deskriptif,
  normalitas, korelasi, uji-t, ANOVA, regresi, Cronbach's alpha) dengan satu
  klik.
- Hasil analisis berupa laporan markdown di folder `hasil/`; tabelnya bisa
  disisipin ke bab dengan nomor **"Tabel 3.1"** — dan versinya disimpan sebagai
  riwayat.

**AI (asisten)**
- Chat dengan agent yang punya akses folder project: baca & edit bab, cari
  jurnal, jalankan skrip analisis, bikin draft sitasi, dll.
- Setiap bab punya konteks otomatis (daftar bab, status, pustaka) — lu ga perlu
  nginget ulang.
- Model picker: model gratis tanpa login, atau **"Sign in with ChatGPT"**
  (langganan GPT Plus), atau API key provider lain (Anthropic, Google,
  OpenRouter, DeepSeek, Groq, Mistral).
- Tombol **Cek koneksi AI** di header panel: ngecek beneran model mana yang
  bisa dipakai, plus cara memperbaikinya.

**Kolaborasi**
- **Loop revisi dosen**: tempel komentar pembimbing, pecah jadi checklist,
  sambung ke bab tertentu, tandai sudah/berjalan/belum, ekspor markdown
  buat dibales.
- Dua bahasa (Indonesia/Inggris), mode terang/gelap, panel bisa disembunyikan.

## Stack

| Lapisan | Pilihan |
|---|---|
| Runtime | Node 24 · pnpm |
| Framework | Next.js 15 (App Router) · React 19 · TypeScript strict |
| Style | Tailwind 4 |
| Editor | Tiptap 3 + `@tiptap/markdown` · WordCraft (wasm) · GridCraft (wasm) |
| AI | OpenCode service + `@opencode/client` |
| Data | SQLite (better-sqlite3) + Drizzle ORM |
| Literatur | OpenAlex · Crossref · Semantic Scholar |
| Sitasi | `references.bib` + CSL (APA/IEEE) + Zotero BBT |
| Export | pandoc `--citeproc` (+ template skripsi TNR 12 / spasi 1,5 / margin 4-3-3-3) |
| PDF | weasyprint / wkhtmltopdf |

## Jalanin

```bash
# 1. binary lokal (WordCraft, GridCraft, pack font) — sekali saja per mesin
bash scripts/setup-semua.sh

# 2. dependency + build
pnpm install
pnpm build

# 3. jalan (loopback saja, akses lewat port forwarding VS Code)
pnpm start
```

Buka `http://127.0.0.1:3000`, attach folder project, lalu buka babnya.

Buat ngoding: `pnpm dev` (Turbopack). Untuk ngetes fitur, **prod mode jauh
lebih cepat** di mesin kecil — `pnpm build && pnpm start`.

Butuh juga: `pandoc` (ekspor DOCX/PDF) dan `python3` + `pandas`/`scipy`/
`statsmodels`/`openpyxl` (analisis data).

## Struktur folder kerja

Folder project lu itu sumber kebenaran — app cuma nampilin dan mengedit isinya.

```
~/Documents/skripsi/
├─ dokumen/          naskah per-bab (.md)
├─ gambar/           gambar yang disisipin
├─ referensi/        PDF jurnal + references.bib
├─ data/             data mentah (CSV/XLSX) — TIDAK pernah diubah app
├─ hasil/            laporan hasil analisis
├─ scripts/          skrip analisis (reproducible)
├─ export/           hasil ekspor
├─ .riwayat/         riwayat versi tiap bab
└─ .opencode/        konfigurasi agent project
```

## Dokumen & sitasi

- Naskah = markdown per-bab. `.md` itu "plumbing" — lu nulisnya di editor
  yang berasa Word, format lengkap tetap utuh.
- Sitasi = marker `[@kunci]` + `references.bib` di root project.
- **DOCX = export satu arah.** File hasil ekspor itu buat dikumpulkan/
  diserahin; mengeditnya di Word tidak nyinkron balik.
- Struktur bab (format Indonesia): baris pertama `# BAB I`, baris kedua
  `# PENDAHULUAN`, lalu isi.

## AI

Agent-nya jalan di **OpenCode service** (proses lokal, datanya nyatu sama
installasi OpenCode lu). App cuma antarmuka: bikin session per project,
ngirim prompt, nampilin stream + timeline tool.

- Persona: bahasa Indonesia akademik, sitasi selalu pakai kunci yang ada di
  `references.bib`, editing konservatif (bukan tulis ulang seluruh bab).
- Folder project = area kerja; data mentah di `data/` tidak boleh diubah.
- Ongkos token mengikuti provider yang dipakai (ChatGPT Plus / API key /
  model gratis).

## Struktur kode

```
src/
├─ app/
│  ├─ p/[slug]/          workspace 3-panel
│  └─ api/               51 route (AI, project, jurnal, matriks, revisi, versi…)
├─ components/
│  ├─ panels/            panel kiri (10 tab), panel chat
│  ├─ center/            tab Word, Excel, web, file
│  ├─ editor/            editor naskah + ribbon
│  └─ layout/            top bar, rail ikon
├─ lib/
│  ├─ opencode/          integrasi service OpenCode + diagnosa
│  ├─ workspace/         guard path, file, folder kerja
│  ├─ journals/          OpenAlex/Crossref/S2 + merge
│  ├─ citations/         cek sitasi, b:Sources untuk Word
│  ├─ matrix/ versions/ notes/ revision/   fitur riset
│  └─ db/                skema Drizzle (6 tabel)
i18n/                    id.json + en.json (695 key, parity dijaga)
scripts/                 setup binary + generator template ekspor
templates/               reference docx untuk ekspor
```

Yang **tidak** ikut di-commit: `public/wordcraft/`, `public/gridcraft/`,
`data/wordcraft-fonts/` (besar + lisensi terpisah). Ambil ulang dengan
`scripts/setup-semua.sh`.

## Catatan & batasan

- **Single-user, lokal.** Semua service bind `127.0.0.1`; tidak ada multi-user,
  tidak ada share link, tidak ada sinkronisasi cloud.
- **Dokumen = sumber kebenaran.** Round-trip .md → Word → .md melewati konversi,
  jadi fitur Word yang kompleks (gaya, field, nomor halaman) bisa berubah
  bentuk. Kalau butuh kesetiaan penuh, edit langsung di file .md-nya.
- **Tabel hasil analisis** masuk lewat konversi, jadi periksa cepat setelah
  disisipin.
- **Kuota model gratis** provider OpenCode terbatas; kalau habis, hubungkan
  ChatGPT atau API key lain.
- **Riwayat versi** disimpan sebagai file di `.riwayat/`, bukan di database —
  jadi ikut ter-copy kalau folder project lu di-backup.

## Lisensi

Kode aplikasi: milik lu. Bundle pihak ketiga (WordCraft, GridCraft) punya
lisensi masing-masing (MIT/Apache-2.0) dan diunduh terpisah lewat
`scripts/setup-semua.sh`.
