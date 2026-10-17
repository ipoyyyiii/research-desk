# RESEARCH-DESK — Planning Final (v1.0 locked)

> *"Satu tempat untuk nulis skripsi + baca jurnal + tanya AI — gak pindah-pindah tab lagi."*
> Dokumen ini = acuan implementasi. Jangan diubah sembarangan; update seiring keputusan baru.

---

## 0. Status & konteks lingkungan

| Item | Status |
|---|---|
| Repo: `/home/ubuntu/research-desk/` (git `main`, `first commit 06089eb`) | ✅ BERES |
| Remote GitHub: `ipoyyyiii/research-desk` (push sukses) | ✅ BERES |
| Identitas commit nyambung akun (Arrivo Arsa Mevano · `263784365+ipoyyyiii@users.noreply.github.com`) | ✅ BERES |
| Session OpenCode + VS Code → folder research-desk | ✅ BERES |
| **Fase 0: Node 24.22 + pnpm 12.14 + scaffold Next.js 15.5.28 + DB + attach-folder** | ✅ **BERES** (commit `2a00117`) |
| **Fase 1: layout 3-panel + Tiptap autosave→md + i18n id/en + file tree** | ✅ **BERES** (commit `c307d93`) |
| **Fase 1 polish: ribbon ala-Word + gambar (upload/paste/drop→`gambar/`, serve via `/raw`, `.md` tetap relatif) + prefs tampilan + tabel/link/align** | ✅ **BERES** (commit `ce0472a`) |
| Fase 2: chat ↔ OpenCode (session per project, streaming, tool timeline) | ⏳ berikutnya |

Lingkungan mesin: Ubuntu di AWS (VS Code Remote SSH, user `ubuntu`). Akses browser app nanti via **port forwarding VS Code** (`:3000`) — tidak ada expose publik. Push git HTTPS sudah terbukti jalan (via VS Code askpass).

---

## 1. Spesifikasi produk global (TERKUNCI)

| Aspek | Keputusan |
|---|---|
| Nama app | **research-desk** |
| Jenis | Web app **lokal single-user** (Next.js, bind `127.0.0.1:3000`) |
| Bahasa UI | **Indonesia (default) + English** — toggle di topbar/settings, tersimpan di DB |
| Dokumen sumber | **Markdown per-bab** (`bab1-pendahuluan.md`, …) — agent-editable; `.md` = invisible plumbing (kamu nulis dengan pengalaman ala-Word via Tiptap) |
| Target export | **DOCX (utama, pandoc)** · PDF · MD · PPTX (opsional fase 5) |
| Export one-way | `app → Word/DOCX`. File exported = hasil akhir untuk submit (bukan tempat lanjut menulis; kalau diedit di Word, tidak sinkron balik otomatis) |
| Sitasi | **Live di app**: file `references.bib` + style picker (APA/IEEE/Harvard/Chicago + CSL lain). **Zotero first-class** via Better BibTeX auto-export; Mendeley via import `.bib/.ris`. Catatan jujur: sitasi di DOCX hasil export = teks jadi (bukan live-field Word) |
| AI engine | **OpenCode service** + `@opencode/client` — login **"Sign in with ChatGPT"** (GPT Plus OAuth); bisa alternatif API key/OpenRouter/Ollama |
| REA | ❌ TIDAK dipasang (diputuskan mutlak) |
| `socautomation` | ❌ Dibiarkan, tidak disentuh |

**Tiga jalur masuk file jurnal/konten**: ① copy-paste manual via file manager (file tree auto-refresh saat window fokus), ② drag & drop ke panel kiri, ③ tombol [⬇ simpan] dari hasil pencarian open-access (PDF → `referensi/papers/`).

---

## 2. Layout & desain UI (3-panel)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ⌗ skripsi-ku ▾        [+ dokumen]        [Export ▾] ⚙︎ … ● opencode 🟢  │
├────────────┬────────────────────────────────────────┬────────────────────┤
│ LEFT 280px │              TENGAH (flex)              │ KANAN 420px        │
│            │                                         │                    │
│ [📁File]   │  ┌────────────────────────────────┐    │ Chat (streaming)   │
│ [🔎Jurnal] │  │  kertas serif, A4-ish 820px    │    │ 👤: tambah 2 sitasi│
│ [📚Lib]    │  │  BAB II · … [@key2024]         │    │ 🤖: timeline tool  │
│            │  │                                │    │  🔎 cari jurnal 8⏐ │
│ 📁 dokumen │  │  [toolbar seleksi Word-style]  │    │  💾 +2 → bib       │
│ 📁 gambar  │  │  B I ✑Cite H2 ✎Tanya-AI        │    │  ✎ edit bab2.md    │
│ 📁 referensi│  └────────────────────────────────┘   │ 🤖: Done …         │
│ 📁 export  │  footer: 4.312 kata · tersimpan ✓      │ [⏸stop] [model ▾]  │
│            │   [🤖 lagi ngedit bab2.md…] ← overlay  │                    │
└────────────┴────────────────────────────────────────┴────────────────────┘
  panel resizable · collapse/focus-mode · ⌘K quick-open · ⌘↵ kirim · ⌘S save
```

**Spesifikasi per area:**

| Area | Detail |
|---|---|
| **Kiri** | 3 tab: ① **File** = tree (klik → open editor; refetch on window-focus, file yang dicopy manual langsung muncul); ② **Jurnal** = search bar → hasil (judul/authors/tahun/citation count/badge 🟢 open-access), kartu: [⬇ simpan ke lib] & [↗ buka di browser]; ③ **Lib** = daftar entri `references.bib` + PDF viewer internal (PDF.js) + tombol [Insert citation @caret] |
| **Tengah** | Tiptap v3 (StarterKit + Table + TaskList + KaTeX + Image + Placeholder). Toolbar seleksi: B / I / H2 / list / tabel / gambar / **✑ Cite** / **✎ Tanya-AI** (kirim seleksi + konteks ke chat). **Autosave 800 ms → file md**. Overlay `🤖 lagi ngedit bab2.md…` saat agent menulis → editor auto-reload saat selesai. Footer: jumlah kata + status save |
| **Kanan** | Chat streaming; tiap tool-call = **kartu timeline collapsible** (🔎 hasil pencarian, 💾 bib diff, ✎ edit diff). Tombol stop, model picker, status dot auth (🟢 login / 🟡 belum config / 🔴 error + petunjuk fix) |
| **Top bar** | Project switcher, [+ dokumen], menu export, settings dialog: bahasa, tema, default citation style, status akun, persona agent |
| Keyboard | `⌘K` palette (cmdk) · `⌘↵` send · `⌘S` manual save · `Esc` focus-mode |
| Theme | Light/Dark, default ikut OS |

---

## 3. Arsitektur teknis

```
┌─────────────────── Next.js 15 (:3000 loopback) ───────────────────────────┐
│  App Router + React 19 + TypeScript strict                                │
│  src/app/  → UI routes + API routes                                       │
│  src/lib/  → workspace/ · literature/ · citations/ · db/                  │
│  UI memakai @opencode/client untuk bicara ke engine)                      │
└─────────────┬─────────────────────────────────────────────────────────────┘
              │ HTTP + SSE (event stream)
              ▼
┌────────────────── OpenCode service (proses background lokal) ─────────────┐
│  auth: "Sign in with ChatGPT" (GPT Plus) / API key lain — token di        │
│  SQLite internal OpenCode (auto refresh, multi-akun)                      │
│  session per project-folder; history chat disimpan oleh service           │
│  tool bawaan: read/edit file (exact-match, anti-"AI ngarang")             │
│  + MCP server app kita (stdio):                                           │
│     · search_literature (OpenAlex ⊕ Crossref, merge+dedup)                │
│     · get_paper_details  · update_bibliography  · export_document         │
│  + agent persona "thesis" via .opencode/opencode.jsonc (lihat §5)         │
└─────────────┬─────────────────────────────────────────────────────────────┘
              ▼
┌─ Data layer ──────────────────────────────────────────────────────────────┐
│  Dokumen jurnal: FILE NYATA di disk (md, bib, pdf, gambar)                │
│  App DB (SQLite + Drizzle): HANYA projects + settings                     │
│  (chat history milik OpenCode service — tidak di-duplicate)               │
└───────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Struktur repo (kode app)

```
/home/ubuntu/research-desk/
├─ src/app/
│  ├─ page.tsx                  → redirect /workspace
│  ├─ workspace/page.tsx        → list project + [attach folder]
│  ├─ p/[slug]/page.tsx         → workspace 3-panel
│  ├─ p/[slug]/pdf/[name]/      → PDF viewer (PDF.js)
│  └─ api/
│     ├─ projects/…             CRUD + attach folder (validasi path)
│     ├─ workspace/[...path]    read/write/upload/delete (guard dalam folder saja)
│     ├─ literature/search      proxy OpenAlex+Crossref
│     ├─ literature/details     metadata DOI/PMID
│     ├─ export/[slug]          jalankan pandoc (owned process + deadline)
│     └─ settings/
├─ src/components/   layout/ · editor/ · chat/ · library/ · export-dialog/
├─ src/lib/
│  ├─ workspace/   resolusi path + guard (gak bisa keluar folder project)
│  ├─ literature/  openalex.ts · crossref.ts · merge.ts
│  ├─ citations/   parse .bib + cache + format style (citation-js)
│  └─ db/          index.ts (better-sqlite3 + drizzle) + schema.ts
├─ mcp/literature/index.mjs      MCP stdio server (tool untuk agent)
├─ db/migrations/ (drizzle)
├─ templates/skripsi-reference.docx   (template export: TNR 12, spasi 1.5, margin 4-3-3-3 cm)
├─ i18n/ id.json · en.json  (dictionary ringan, hook custom)
└─ opencode project-config template → ditulis ke tiap folder project (.opencode/opencode.jsonc)
```

### 3.2 Schema SQLite (minimal)

```ts
projects: { id, slug, name, folder_path, created_at, last_opened_at }
settings: { locale ("id"|"en"), theme, default_citation_style,
            last_project_id, agent_model_override (nullable) }
```

### 3.3 Folder kerja dokumen (project folder — bebas lokasi, dibuat saat attach; file lama TIDAK disentuh)

```
~/Documents/skripsi/
├─ dokumen/          bab1-pendahuluan.md … bab5-kesimpulan.md
├─ gambar/
├─ referensi/
│  ├─ papers/*.pdf
│  └─ references.bib
├─ export/           hasil DOCX/PDF
└─ .opencode/opencode.jsonc   ← agent persona + izin + MCP app
```

---

## 4. Alur kerja utama + konteks-token strategy

| Operasi | Konteks yang dikirim ke agent |
|---|---|
| Chat umum | seleksi aktif (≤2k char) + outline dokumen (~300 token) |
| Tanya-AI (toolbar) | blok seleksi + header bab aktif |
| Revisi 1 bab | isi bab aktif penuh (cap ~30 halaman) |
| Search jurnal | hasil capped: **8 item/DB · abstract 1.500 char · authors max 20** (pola beeblio) |
| update_bibliography | entri bibtex terpilih saja — TIDAK seluruh .bib |

**Flow A — "tambahin 2 jurnal RAG ke bab 2":**
1. Chat → UI → `opencode` session.prompt (session per project)
2. Agent → MCP `search_literature("RAG evaluation")` → hasil merge/dedup
3. Agent pilih 2 → MCP `update_bibliography` → `references.bib` +2 (cek duplikat DOI)
4. Agent → tool edit built-in → sisip `[@karimi2024]` di bab2.md
5. SSE events → chat render + kartu tool; UI reload file → editor + Lib re-render
6. Konflik guard: file generation/hash check; kalau beda versi → toast "reload?"

**Flow B — Export DOCX:** concat bab (urut index) → `pandoc --citeproc --csl=styles/apa.csl --reference-doc=templates/skripsi-reference.docx -o export/skripsi.docx` (owned process, deadline 60s) → serve download. Error: pandoc missing → dialog instruksi install; bib unresolved → daftar key bermasalah.

**Flow C — Zotero sync:** Better BibTeX auto-export menulis `references.bib` → app detect change (fs watcher/poll) → re-parse → Lib refresh; entri dihapus tapi masih disitasi → chip kuning "broken citation" di editor + daftar di Lib.

**Flow D — Startup:** buka app → `Service.ensure()` → cek auth → status dot → model list → buka last project → load tree + last open file.

---

## 5. Agent persona & izin (`.opencode/opencode.jsonc` per project folder)

- **Agent "thesis"**: asisten riset, bahasa Indonesia akademik, sitasi WAJIB lewat `update_bibliography` (larangan hard-code nomor), editing konservatif (`replace_exact`/`insert_between`, bukan full rewrite), selalu sebut filename yang diedit
- **Permissions**: edit/glob dalam folder project = `allow`; **bash = `deny`**; delete berbahaya = `ask`; `.opencode/` = `deny`
- **Model**: default dari login (ChatGPT); bisa override per project
- Fair-use: batas token per session/turn dikonfigurasi (Plus = usage-based, bukan unlimited)

---

## 6. Tech stack (pinned)

| Layer | Pilihan |
|---|---|
| Runtime | **Node 24.x** (upgrade dari v18 — langkah fase 0) + pnpm (corepack) |
| Framework | Next.js 15 (stable, bukan preview) + React 19 + TS strict |
| Style | Tailwind 4 + shadcn/ui (radix) + lucide-react |
| Editor | Tiptap 3 (+extensions) + `@tiptap/markdown` |
| AI | OpenCode service + `@opencode/client` |
| Literatur | OpenAlex REST + Crossref REST (gratis, tanpa key) |
| Sitasi | citation-js + CSL styles |
| PDF | pdfjs-dist |
| Export | pandoc `--citeproc` (apt install) |
| DB | better-sqlite3 + Drizzle ORM + drizzle-kit |
| Validation | zod 4 |
| i18n | dictionary ringan id/en (custom hook) |

---

## 7. Keamanan & privasi

- Semua service **bind 127.0.0.1** — akses browser via VS Code port forward
- Guard `workspace/`: semua route file anti path-traversal (gak bisa keluar folder project)
- Upload: validasi MIME + size cap ~100 MB
- **Tidak ada secret di DB app** — credentials milik OpenCode service (SQLite internal)
- Agent: izin edit terbatas folder project; bash ditolak

---

## 8. Error states & edge cases (UI behavior)

| Kasus | Penanganan |
|---|---|
| OpenCode belum login / kredensial mati | 🔴 + dialog "Sign in with ChatGPT" (arahkan `opencode auth login openai`) |
| Pandoc belum ter-install | Dialog langkah install (`sudo apt install pandoc`), export diblok |
| `[@key]` tidak resolve | Chip kuning di editor + daftar broken citations di Lib |
| Kamu ngetik saat agent menulis | last-write-wins + toast "file diubah agent — reload?" |
| Rate limit GPT Plus | Chat warning + saran model API key alternatif |
| PDF besar/rusak | Error state PDF.js + tombol buka eksternal |
| OpenAlex/Crossref down parsial | Badge failure per source; hasil dari source hidup tetap tampil |

---

## 9. Fase pengerjaan + checklist

| Fase | Isi | Checklist DONE | Est |
|---|---|---|---|
| **0. Pondasi** | Node 24 + pnpm, scaffold Next.js, schema Drizzle, attach folder project | `pnpm dev` hidup; bisa attach folder demo | 2-3 hr |
| **1. Layout + Editor** | 3-panel, Tiptap autosave→md, file tree, i18n id/en, toolbar | nulis bab, tutup-buka, konten utuh | 1 mgg |
| **2. Chat ↔ OpenCode** | session per project, streaming, tool timeline, auto-reload, persona+izin | "tariin paragraf di 2.2" → bab2.md berubah | 1 mgg |
| **3. Jurnal & Library** | OpenAlex/Crossref search, add-to-lib, PDF viewer, drag-drop, [⬇ simpan] | cari → lib → insert citation jadi | 1 mgg |
| **4. Sitasi + Export** | references.bib + style picker + Zotero BBT + pandoc DOCX + template | DOCX final siap submit | 1-1,5 mgg |
| **5 (opsional)** | PPTX (python-pptx), broken-citation lint, import Mendeley (.bib/.ris) | bonus | — |
| **6 (opsional)** | OnlyOffice embed ("Mode Word asli, real-docx") jika nanti dibutuhkan | — | — |

**TIDAK masuk v1**: Electron desktop · RAG/embedding knowledge store · multi-user/auth · share-link/tunnel · track changes · review model eksternal.

---

## 10. Keputusan terkunci (receipts)

1. ✅ Nama: **research-desk** — repo sudah live di GitHub (`ipoyyyiii/research-desk`)
2. ✅ UI bilingual: **Indonesia (default) + English**
3. ✅ Dokumen: **markdown per-bab**, feel-Word via Tiptap; `.md` invisible; tiga jalur input file
4. ✅ Export: **pandoc DOCX/PDF**, one-way (app→Word), template standar skripsi Indonesia
5. ✅ Sitasi: **style picker (APA/IEEE/Harvard/Chicago/CSL)**, **Zotero via Better BibTeX auto-export** first-class, Mendeley via import file
6. ✅ AI: **OpenCode engine**, login **GPT Plus** (OAuth) — bukan OpenRouter wajib, bukan custom OAuth
7. ✅ Single-user, loopback-only, project folder bebas di home, 3 jalur masuk file
8. ✅ REA: **tidak dipasang**; `socautomation`: **tidak disentuh**
9. ✅ DB app: `projects` + `settings` saja; chat history milik OpenCode service
10. ✅ Fase 6 (opsional): embed **OnlyOffice** jika suatu saat butuh edit real-DOCX
