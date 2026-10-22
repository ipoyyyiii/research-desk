# Vibe Research

**A local-first thesis workspace: chapters, literature, data and an AI assistant in one place.**

Writing a thesis means jumping between a document, a reference manager, a pile of PDFs, a
spreadsheet, a citation style guide and three AI chat tabs. Vibe Research puts all of that in
one window — and keeps every file on your own disk, in plain markdown and plain folders, so
nothing is locked inside the app.

> The name comes from *vibe researching*: you state the intent, the agent does the heavy
> lifting, and you keep the judgement — every generated sentence and every number stays
> traceable back to a source.

---

## Table of contents

- [What it does](#what-it-does)
- [Feature tour](#feature-tour)
- [Tech stack](#tech-stack)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Install](#install)
- [First run](#first-run)
- [Where your files live](#where-your-files-live)
- [Database](#database)
- [AI assistant setup](#ai-assistant-setup)
- [WordCraft and GridCraft](#wordcraft-and-gridcraft)
- [Export and citations](#export-and-citations)
- [Scripts reference](#scripts-reference)
- [Troubleshooting](#troubleshooting)
- [Known limits](#known-limits)
- [License](#license)

---

## What it does

Vibe Research is a single-user web app that runs on `127.0.0.1` and edits a folder you
choose (your thesis folder). It is not a hosted service: there is no account, no sync and no
cloud.

The workspace is a three-panel layout:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ V  Vibe Research  /  my-thesis        Export ▾   AI Assistant   New document │
├────────────┬──────────────────────────────────────────────┬──────────────────┤
│ left rail  │ centre: the actual work                      │ AI assistant     │
│            │                                              │                  │
│ Drafts     │  • markdown chapter editor (Word-like ribbon)│  chat            │
│ Outline    │  • Word tab (WordCraft, real .docx engine)   │  tool timeline   │
│ Journals   │  • Excel tab (GridCraft, real .xlsx engine)  │  model picker    │
│ Zotero     │  • PDF / image viewer                        │  effort control  │
│ Matrix     │  • web tab                                   │                  │
│ Revision   │                                              │                  │
│ Versions   │                                              │                  │
│ Figures    │                                              │                  │
│ Data       │                                              │                  │
│ Files      │                                              │                  │
└────────────┴──────────────────────────────────────────────┴──────────────────┘
```

## Feature tour

### Writing

- **One markdown file per chapter** (`dokumen/bab1-pendahuluan.md`, …) edited in a TipTap-based
  editor with a Word-style ribbon: paragraph styles, font family/size, line spacing,
  bold/italic/underline/strike, four-way alignment, three list types with indent/outdent,
  tables, links, images and clear-formatting.
- **Autosave** (800 ms debounce) plus <kbd>Ctrl/⌘</kbd>+<kbd>S</kbd>.
- **Word tab** — [WordCraft](https://github.com/storytold/wordcraft) runs inside the app
  (WebAssembly). A `.md` chapter can be opened there, edited with a real Word workflow, and
  saved back into the same `.md` file.
- **Excel tab** — [GridCraft](https://github.com/storytold/gridcraft) opens `.xlsx`/`.csv` files
  and saves the bytes back to the project.
- **Outline** — chapter list with word counts and per-chapter targets.
- **Draft quality scan** — flags filler phrases, stray quote notes, a "Daftar Pustaka" section
  that slipped into the middle of a chapter, headings with a stray sentence, and hanging
  ellipses. Fixable issues are fixed in one click.
- **Version history** — before a chapter is overwritten, the previous content is stored as a
  real file under `.riwayat/`. Compare against the current text, restore, or delete. Restoring
  also snapshots what it replaced, so a restore is undoable.

### Literature and citations

- **Journal search** across OpenAlex, Crossref and Semantic Scholar in parallel, merged and
  de-duplicated by DOI, with citation counts and open-access badges.
- **Save to library** — downloads the open-access PDF into `referensi/papers/` and appends a
  BibTeX entry to `references.bib`.
- **Literature matrix** (for Chapter 2) — pull papers from the library, fill in theme / method /
  findings / quote per paper, then export a markdown table.
- **Notes and quotes** — per-paper notes with an optional quote; one click pushes a quote into
  that paper's matrix row.
- **Zotero** via Better BibTeX auto-export (`references.bib` stays the single source) and
  Mendeley via `.bib`/`.ris` import.
- **Citation consistency check** — cites without a bib entry, and bib entries never cited.
- **Citations in the Word tab** — a citation panel inside WordCraft inserts `[@key]` markers at
  the caret, and the export warns about keys that don't exist.

### Data and statistics

- Upload CSV/XLSX into `data/` (raw data is never modified by the app).
- Install `scripts/uji-statistik.py` with one click: descriptives, Shapiro-Wilk normality,
  Pearson and Spearman correlation, independent/Welch t-test, one-way ANOVA (+ Tukey HSD),
  paired t-test, multiple linear regression (VIF, Durbin-Watson, residual diagnostics) and
  Cronbach's alpha.
- **Insert a table from an analysis report** (`hasil/*.md`) straight into a chapter, numbered
  the way a thesis numbers tables (`Tabel 3.1`), with a version snapshot taken first.

### Working with a supervisor

- **Revision loop** — paste the supervisor's comments, split them into a checklist, attach each
  item to a chapter, mark `todo` / `doing` / `done`, add a resolution note, and export the open
  items as markdown.
- **Version history** per chapter (see above) so "the version they read last week" is never
  lost.

### AI assistant

- Chat against the project folder: the agent can read and edit chapters, search the literature,
  run the statistics script and write reports — always inside the project folder.
- **Automatic context** each turn: project title, chapter list, bibliography, active file.
- **Streaming** text, a collapsible tool timeline, token meter, and a permission card when the
  agent needs approval.
- **Model picker** with free models, ChatGPT sign-in, or API keys for other providers.
- **Connection diagnosis** — probes one model per provider and reports *why* it fails (quota,
  account entitlement, missing model, bad credential), with a one-click switch to a model that
  actually works.
- **Never gets stuck** — the "typing" state is reconciled against the server every few seconds,
  so a dropped event stream can't freeze the chat.

### Interface

- Bilingual **Indonesian (default) / English** with 697 translation keys kept in parity.
- Light / dark / system theme, collapsible panels, focus mode, resizable panels.
- File manager with drag-to-move, create file/folder, delete, and OS drag-and-drop upload.

## Tech stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 24 · pnpm |
| Framework | Next.js 15.5 (App Router) · React 19.1 · TypeScript 5 (strict) |
| Styling | Tailwind CSS 4 · small in-house UI primitives (`src/components/ui.tsx`) |
| Editor | TipTap 3.32 + `@tiptap/markdown` · WordCraft 0.8 (WASM) · GridCraft 0.9 (WASM) |
| AI | OpenCode background service + `@opencode/client` 2.0.32 (SSE events) |
| Database | SQLite via `better-sqlite3` 13 · Drizzle ORM 0.45 · Drizzle Kit |
| Validation | Zod 4 |
| Literature | OpenAlex REST · Crossref REST · Semantic Scholar Graph API |
| Citations | `references.bib` + CSL styles (APA, IEEE) |
| Export | pandoc `--citeproc` → DOCX · pandoc → HTML → weasyprint/wkhtmltopdf → PDF |
| DOCX post-processing | JSZip (injects Word `b:Sources` so *Manage Sources* works) |
| i18n | 697-key JSON dictionaries + tiny React context |

## Architecture

```
┌──────────────────────── Next.js 15 on 127.0.0.1:3000 ────────────────────────┐
│  App Router (src/app)                                                        │
│    UI: 3-panel workspace, editor, Word/Excel/PDF/web tabs, panels            │
│    API: 51 route handlers (projects, files, journals, matrix, versions, …)   │
│  Libraries (src/lib)                                                         │
│    workspace/ guards · journals/ sources · citations/ · matrix/ · versions/  │
│    revision/ · notes/ · insert/ · opencode/ (service, events, history, …)    │
└───────────────┬──────────────────────────────────────┬──────────────────────┘
                │ HTTP + SSE                            │ file I/O
                ▼                                       ▼
┌──────────────────────────────────┐      ┌──────────────────────────────────┐
│ OpenCode background service      │      │ Your thesis folder               │
│  • session per project folder    │      │  dokumen/ gambar/ referensi/     │
│  • model/provider + credentials  │      │  data/ hasil/ scripts/ export/   │
│  • tool execution (read/edit/…)  │      │  .riwayat/ .opencode/            │
└──────────────────────────────────┘      │  + data/app.db (app state)       │
                                          └──────────────────────────────────┘
```

Everything the app stores for itself (projects, settings, saved papers, matrix rows, notes,
revision items) lives in **one SQLite file**, `data/app.db`. Everything you write lives in your
own folder as plain files.

## Requirements

| Dependency | Why | Required? |
|---|---|---|
| **Node.js ≥ 24** | `@opencode/client` uses `Promise.withResolvers` and modern APIs | yes |
| **pnpm** | package manager (corepack works) | yes |
| **pandoc ≥ 3** | DOCX/PDF export + citeproc | for export |
| **weasyprint** or **wkhtmltopdf** | PDF export pipeline | for PDF only |
| **Python 3.10+** + pandas/scipy/statsmodels/openpyxl | `scripts/uji-statistik.py` | for statistics |
| **OpenCode CLI** (`opencode`) | AI assistant engine | for AI features |
| **fontTools** + Microsoft core fonts | optional WordCraft font pack | optional |

Install the OS-level pieces on Debian/Ubuntu:

```bash
sudo apt install pandoc python3 python3-venv weasyprint
# optional, for the full WordCraft font pack:
sudo apt install ttf-mscorefonts-installer
python3 -m pip install --user fonttools
```

## Install

```bash
# 1. dependencies
corepack enable
pnpm install

# 2. local binaries that are too big for git (WordCraft, GridCraft, font pack)
bash scripts/setup-semua.sh

# 3. build and run
pnpm build
pnpm start
```

Then open **http://127.0.0.1:3000**.

The database is created automatically on first run from the SQL migrations in `drizzle/` (see
[Database](#database)) — there is no separate setup step.

For development use `pnpm dev` (Turbopack). On a small machine prefer the production build:
`pnpm build && pnpm start` is dramatically faster than the dev server.

## First run

1. **Attach a folder.** On the landing page click *Pasang folder project* and give a name and a
   path inside your home directory (e.g. `~/Documents/skripsi`). The folder is created if it
   doesn't exist; existing files are never touched.
2. **Create a chapter** (`+` → *Dokumen baru*) or drop an existing `.md` into `dokumen/`.
3. **Connect the AI** (optional) — see [AI assistant setup](#ai-assistant-setup).
4. **Add references** — search the *Journals* tab, or drop a `references.bib` into the project
   root (Zotero's Better BibTeX auto-export works well).
5. **Export** — the ribbon's export button produces a DOCX/PDF using
   `templates/skripsi-reference.docx` (Times New Roman 12 pt, 1.5 line spacing, A4, 4 cm top and
   3 cm side margins).

## Where your files live

The project folder is the source of truth. The app only reads and edits it.

```
~/Documents/skripsi/
├─ dokumen/            chapters, one .md per chapter
├─ gambar/             images inserted into the editor
├─ referensi/
│  ├─ papers/          journal PDFs
│  └─ references.bib   bibliography (source of truth for citations)
├─ data/               raw data — the app never rewrites these files
├─ hasil/              analysis reports (markdown)
├─ scripts/            reproducible analysis scripts
├─ export/             exported DOCX/PDF
├─ .riwayat/           per-chapter version snapshots
└─ .opencode/          agent config for this project (persona, MCP, toggles)
```

Inside the app repository, these folders are generated and **not** committed:

```
public/wordcraft/      WordCraft web build      → scripts/fetch-wordcraft.sh
public/gridcraft/      GridCraft web build      → scripts/fetch-gridcraft.sh
data/wordcraft-fonts/  font pack                → scripts/wordcraft-fontpack-v3.py
data/app.db            app database (see below)
```

## Database

The app keeps its own state in **SQLite** at `data/app.db` (created automatically, WAL mode).
It contains six tables, all defined in [`src/lib/db/schema.ts`](src/lib/db/schema.ts):

| Table | Columns | Purpose |
|---|---|---|
| `projects` | `id, slug, name, folder_path, created_at, last_opened_at, opencode_session_id` | Registered thesis folders + the bound AI session |
| `settings` | `id (=1), locale, theme, effort, default_citation_style, last_project_id, agent_model_override` | Single-row app preferences |
| `saved_papers` | `id, slug, paper_id, bib_key, data (JSON), created_at` | Library entries; unique on `(slug, paper_id)` |
| `matrix_rows` | `id, slug, paper_id, title, authors (JSON), year, tema, metode, temuan, kutipan, position, created_at` | Literature-matrix rows; unique on `(slug, paper_id)` |
| `paper_notes` | `id, slug, paper_id, matrix_row_id, note, quote, source, created_at` | Notes/quotes; `matrix_row_id` FK → `matrix_rows` with `ON DELETE SET NULL` |
| `revision_items` | `id, slug, text, status, chapter_path, note, resolved_at, position, created_at` | Supervisor revision checklist |

**Migrations.** `drizzle/0000_init.sql` is the initial schema. It is applied automatically when
the process starts (`src/lib/db/index.ts` calls drizzle's `migrate()`), and the SQL is idempotent
(`CREATE TABLE IF NOT EXISTS`), so an existing database is untouched and a fresh clone gets its
tables on first run. When you change `schema.ts`:

```bash
pnpm db:generate   # write a new migration into drizzle/
pnpm db:push       # or sync the local dev database directly
```

Nothing personal is stored in the database, and no API keys ever reach it — AI credentials
belong to the OpenCode service, which keeps them in its own store.

## AI assistant setup

The assistant is powered by the **OpenCode background service** (`opencode serve --service`). The
app discovers it through `~/.local/state/opencode/service.*.json`, authenticates with HTTP Basic,
and talks to it over its SDK and SSE event stream. The app never spawns its own provider
connection, so it uses exactly the same credentials as the `opencode` CLI.

```bash
# one-time, outside the app
opencode auth login openai --method chatgpt-headless   # "Sign in with ChatGPT" (device code)
# or connect any provider with an API key, from the app: Settings → Providers
```

Model choice matters:

- The catalogue lists **many** models, but a subscription account can only use a subset. If a
  model is rejected with *"not supported when using Codex with a ChatGPT account"*, pick another
  one — the **Check AI connection** button (stethoscope icon in the assistant header) probes the
  providers, explains the failure, and offers a one-click switch to a model that works.
- Free models need a moment on first use: the provider has to start a process, so the first
  answer can take up to a minute.

Project-level agent behaviour is configured in `<project>/.opencode/opencode.json` (persona, tool
toggles) and `<project>/AGENTS.md` (capabilities block). The app owns those files and rewrites
only its own section, preserving anything you add.

## WordCraft and GridCraft

Both are third-party open-source WASM builds (MIT / Apache-2.0) and are **not** vendored in this
repository — they are ~40 MB and ~19 MB of binaries. Fetch them with:

```bash
bash scripts/setup-semua.sh          # both + font pack
bash scripts/fetch-wordcraft.sh      # WordCraft only (pinned to a tested build)
bash scripts/fetch-gridcraft.sh      # GridCraft only
```

How they are wired:

- Both run in a same-origin `<iframe>` inside the centre panel.
- **Open**: the app fetches the file and performs a synthetic drag-and-drop **inside the iframe's
  realm**, after waiting until egui's drop handler is registered. Dropping from the parent realm
  (or too early) only registers the file in WordCraft's "Recent" list and never opens it.
- **Save**: both apps are intercepted at `showSaveFilePicker`; the bytes are posted to the parent
  and offered as "Save to chapter". WordCraft always saves `.docx`, so the app converts it to
  markdown (`pandoc -f docx -t gfm`) before writing the chapter back. For maximum fidelity use
  **WordCraft → File → Export → Markdown** instead, which produces native markdown.
- **Fonts**: `scripts/wordcraft-fontpack-v3.py` builds a font pack (Microsoft core fonts plus
  metric-compatible clones) into `data/wordcraft-fonts/`; the app seeds it into the browser's
  IndexedDB before WordCraft boots.

## Export and citations

- Citations are written as `[@key]` markers, resolved against `references.bib` at export time.
- **DOCX**: `pandoc --citeproc --csl csl/apa.csl|ieee.csl --reference-doc templates/skripsi-reference.docx`.
  The reference document sets Times New Roman 12 pt, 1.5 spacing, A4 and 4/3/3/3 cm margins. After
  conversion the app injects the bibliography into `customXml`, so Word's *Manage Sources* also
  shows the entries.
- **PDF**: pandoc → HTML → weasyprint (fallback: wkhtmltopdf) with `assets/pdf.css`, same page
  margins and page numbers.
- A preflight warns about `[@key]` markers that have no bib entry before exporting.
- The exported file is one-way. Editing the DOCX does not sync back; the markdown is the source of
  truth.

## Scripts reference

| Script | Purpose |
|---|---|
| `scripts/setup-semua.sh` | Fetch WordCraft + GridCraft + font pack (one-shot machine setup) |
| `scripts/fetch-wordcraft.sh` | Download WordCraft web build (`WORDCRAFT_VER` to override) |
| `scripts/fetch-gridcraft.sh` | Download GridCraft web build (`GRIDCRAFT_VER` to override) |
| `scripts/wordcraft-fontpack-v3.py` | Build the WordCraft font pack |
| `scripts/wordcraft-font-alias.py` | Add metric-compatible aliases (Calibri → Carlito, …) |
| `scripts/make-reference-docx.mjs` | Regenerate `templates/skripsi-reference.docx` |
| `assets/templates/uji-statistik.py` | The statistics script installed into projects |

`requirements.txt` lists the Python packages the statistics script needs.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `no such table: projects` | The DB was created before migrations existed. Run `pnpm db:push`. |
| Word tab shows a blank "Good afternoon" screen | The file was dropped before WordCraft finished booting. Click **Open in Word**; the app now waits for readiness, but a cold start can take a few seconds. |
| Chat says "not supported when using Codex with a ChatGPT account" | Pick another model — the account only allows a subset. Use **Check AI connection** to find a working one. |
| "Free usage limit reached" | The free provider quota is exhausted. Connect ChatGPT or an API key in Settings → Providers. |
| Export fails with "tool PDF belum terpasang" | Install `weasyprint` or `wkhtmltopdf`, or export DOCX instead. |
| `.docx`/`.pdf` save from Word doesn't return to the chapter | Only `.md` round-trips automatically; use **File → Export → Markdown** in WordCraft. |
| First AI answer takes ~1 minute on a free model | Expected: the free provider starts a process on first use. |
| App feels slow in development | Use `pnpm build && pnpm start`; the dev server compiles routes on demand. |

## Known limits

- **Single user, loopback only.** No authentication, no multi-user, no sharing, no cloud sync.
- **Markdown is the source of truth.** Word/Excel round-trips go through conversions; complex Word
  features (styles, fields, page numbering) do not survive a `.md` round-trip.
- **DOCX export is one-way.** The exported file is for submission, not for continuing to write.
- **PDF export is plain**: cover page, table of contents and per-chapter page numbering are not
  generated yet.
- **WordCraft saves `.docx`**, so the app has to convert on save; use WordCraft's own
  *Export → Markdown* when fidelity matters.
- **Google Scholar is not scraped** (no official API); OpenAlex, Crossref, Semantic Scholar and web
  search are used instead.

## License

Application code: yours to use. Third-party WASM bundles (WordCraft, GridCraft) keep their own
licenses (MIT / Apache-2.0) and are downloaded separately by `scripts/setup-semua.sh`.
