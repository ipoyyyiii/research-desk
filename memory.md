# MEMORY — Riwayat & Keputusan Sesi (private context)

> File memori sesi. Kalau context hilang/session baru, BACA DULU file ini + `planning.md` sebelum kerja apapun di repo ini.
> Last updated: 2026-10-21 (sesi lanjutan). Fase 0–5 + Tier 1 selesai; sesi ini nutup 2 "utang" tes Tier 1 dan nyiapin Tier 2 (matriks literatur).
> Kode app = repo `/home/ubuntu/research-desk` (branch `main`, commit terakhir `d4c58d6` sebelum sesi ini).

---

## 1. Profil user (konteks personal)

- Nama: **Arrivo Arsa Mevano** — GitHub **`ipoyyyiii`** (user ID GitHub: `263784365`, email noreply: `263784365+ipoyyyiii@users.noreply.github.com`)
- Target personal: sedang/nanti mengerjakan **skripsi** — App "research-desk" ini dibuat karena **TOOL untuk membantu mengerjakan skripsi-nya**, BUKAN topik skripsi-nya (awal sempat salah paham, sudah terklarifikasi)
- Pain point inti: mengerjakan skripsi = lompat-lompat platform (jurnal di sini, Word di sana, PPT, AI chat, cite manual) → makanya satu workspace
- Punya akun **GPT Plus** — ingin pakai langganan itu sebagai AI (bukan beli API key). Sudah login "Sign in with ChatGPT"-style credit keOpenCode
- Gaya komunikasi: santai (bahasa gaul "men/bro"), suka jawaban jujur dan detail
- Mesin: **Ubuntu server di AWS** (user `ubuntu`, host `ip-172-26-15-134`), kerja via **VS Code Remote SSH** (`GIT_ASKPASS` vscode-server aktif — push GitHub HTTPS sudah terbukti jalan tanpa setup tambahan)
- ⚠️ Node saat sesi ini **v18.19.1** — HARUS naik ke **24.x** (fase 0) sebelum scaffold; pnpm belum ada (pakai corepack)

## 2. Repo & status pengerjaan

- Repo app: `/home/ubuntu/research-desk/` — git `main`, `first commit 06089eb` (README)
- Remote: `https://github.com/ipoyyyiii/research-desk.git` (push `-u origin main` SUKSES)
- Identity git: diset **local per repo** (user.name `Arrivo Arsa Mevano`, email noreply) — global masih kosong, machine default "Ubuntu@..." dipakai di repo lama
- Session OpenCode sudah di-`session_move` ke `/home/ubuntu/research-desk`; user juga diarahkan membuka folder yang sama di VS Code
- **Status: FASE 0 BERES** (commit `2a00117`, sudah push): Node 24.22.0 + pnpm 12.14.0 · Next.js 15.5.28 (React 19.1, Tailwind 4.3.3, TS, src-dir, dev borong turbopack bind 127.0.0.1) · DB better-sqlite3 13 + Drizzle (projects, settings) di `data/app.db` · API `/api/projects` (GET list + POST attach dengan guard anti-traversal/symlink) · `/workspace` page attach + root redirect · `pnpm build` ✅ `pnpm lint` ✅ · folder demo `~/Documents/skripsi` sudah terpasang (subfolder baku dibuat)
- **Gotcha fase 0** (biar gak kena lagi): pnpm 12 blokir postinstall native → allowlist di `pnpm-workspace.yaml` `onlyBuiltDependencies` + `pnpm approve-builds --all`; guard realpath jangan jalan sebelum mkdir (sudah difix di `src/lib/workspace/paths.ts`)
- **FASE 1 BERES** (commit `c307d93`): layout 3-panel resizable (react-resizable-panels API baru: `Group/Panel/Separator`, ukuran pakai string %), Tiptap 3 + `@tiptap/markdown` (serialize = `editor.getMarkdown()`, opsi `markedOptions`), BubbleMenu import dari `@tiptap/react/menus`, file tree refetch-on-focus, autosave 800ms + ⌘S, i18n dictionary id/en + PreferencesProvider (locale persist ke DB settings), topbar + settings dialog + focus mode (Esc), API file/tree/documents/settings lengkap dengan guard anti-traversal+symlink. Build ✅ lint ✅ smoke test 7-tes hijau.
- **Gotcha fase 1**: shadcn CLI v5/v4 semua kena prompt interaktif via shell → pivot ke UI primitives mini sendiri (`src/components/ui.tsx`); `pkill -f "next dev"` nembak shell sendiri (pattern match cmdline) → pakai `pkill -f 'next[ ]dev'`; jangan pipa server ke `head` (SIGPIPE); StarterKit v3 TIDAK include Table/TaskList → registrasi eksplisit.
- Langkah berikutnya: **fase 2** — chat ↔ OpenCode: session per project, streaming chat, tool timeline, auto-reload editor saat agent ngedit, persona "thesis" + izin, auto start service OpenCode
- ❗ `socautomation` (repo lama, `/home/ubuntu/socautomation`) = project <> lain, **JANGAN disentuh**
- **STATUS PER 2026-10-21 (akhir sesi OpenCode "research-desk: setup repo + planning + memory")**: Fase 0–5 + Tier 1 selesai, `main` = `origin/main` di commit `d4c58d6` "Sitasi langsung di WordCraft, konfirmasi key hilang, pustaka ikut ke DOCX".
  - Fase 2 (chat ↔ OpenCode) ✅ `d3005b5` · model picker `c1c79c2` · provider login `119f7cd` · sisa fase 2 (riwayat + token meter + aktivitas) `6e211be` · fase 2.5 ✅
  - Fase 3 (jurnal/library/PDF/gambar) ✅ · **WordCraft** (tab Word, `public/wordcraft/`) ✅ `3d3688f` + bridge simpan `f920a57` + font pack v3 `f8e9b52` · **GridCraft** (tab Excel, `public/gridcraft/`) ✅ `cebc6af` · file manager penuh `c03adeb`
  - Tier 1 ✅: sitasi di tab Word (`d4c58d6`), preflight key hilang + `b:Sources` ke DOCX (`606f073`), alur AI↔data + skrip `uji-statistik.py` (`032f825`)
  - **Tier 2 belum mulai** (matriks literatur = item 1, sedang dikerjakan sesi ini)
  - ⚠️ Repo lokal `socautomation` JANGAN disentuh · `public/wordcraft` & `public/gridcraft` **gitignored** (binary lokal, script pasang ada di `scripts/`)

## 3. Topik yang dibahas dalam sesi (kronologi)

1. **REA (`morluto/rea`)** — user tanya cara kerja; dijelaskan: MCP server reverse-engineering (binary/app/web/Android/firmware/pcap…), evidence-based, alur `npx rea-agents setup`; bedah singkat arsitekturnya.
2. **Pertanyaan "bisa nge-reverse rumus generate code absen?"** — jawaban jujur: generate+validasi **server-side CSPRNG → tidak bisa di-reverse** dari sisi user; client-side → bisa; pola lemah → cukup observasi. Ini hypothetical, bukan case user (gue sempat ini salah anggap = tugas skripsi-nya).
3. **beeblio (`alharkan7/beeblio`)** — user inspirasi; awal gue salah paham jadi "topik skripsi" — user klarifikasi: workspace ini tool bantu skripsi, "beberapa nge-adopsi" dari beeblio.
4. **Bedah kode beeblio** (clone di `/tmp/opencode/beeblio`):
   - Elenah: Next.js 16-preview + React 19 + Tiptap v3 + SQLite(drizzle/better-sqlite3) + agent "Eve" proses terpisah di :2000 (npm pkg `eve`) proxied via `app/eve/[...path]/route.ts` (allowlist + token mint)
   - Pola penting: tool `edit_document` (replace_exact ONE-match / insert_between unique anchor + SHA256+generation), `search_literature` (OpenAlex+Crossref+PubMed, merge/dedup DOI/PMID/title, truncate abstract), bib metadata tertanam di md (`BIBLIOGRAPHY_MARKER`), sync via event `beeblio:reload-workspace-file` + `WORKSPACE_CHANGED` (bukan fs-watch), DB cuma 138 baris (projects/agent_sessions/knowledge/public_files)
   - ⚠️ **Lisensi beeblio = PolyForm Noncommercial 1.0.0** (BUKAN MIT) → strategi: pelajari pola & tulis kode sendiri; boleh dipakai nonkomersial; JANGAN copy-paste kodenya untuk sesuatu komersial
5. **AI provider untuk app-nya** — user tidak mau terikat OpenRouter; ingin "kayak OpenCode: login pakai akun GPT Plus (OAuth)". Konfirmasi dari docs OpenCode V2: `/connect`/`opencode auth login` — OAuth ChatGPT (Plus/Pro) didukung, API key, env var; token di SQLite service. Solusi: **OpenCode adalah engine app-nya**; app = frontend via `@opencode/client` (`Service.ensure()` → `OpenCode.make({baseUrl, headers: Service.headers(endpoint)})` → `session.create`/`session.prompt`/`event.subscribe`).
6. **REA final decision: TIDAK dibutuhkan** di app full-stack ini (REA = alat bedah software ORANG LAIN; app kita = alat produksi). Sempat gue salah tulis jawaban ruwet — minta maaf & fixed.
7. **Plan mode** — rancangan lengkap dibahas lalu final (lihat `planning.md`); user konfirmasi naam repo/folder & git-baru via pertanyaan interaktif.

## 4. Keputusan kunci (dengan alasan — jangan dibuka ulang tanpa alasan baru)

| Keputusan | Alasan singkat |
|---|---|
| Repo baru `/home/ubuntu/research-desk` (BUKAN di socautomation) | pisah history, git bersih |
| AI = **OpenCode service** sebagai engine, app = frontend `@opencode/client` | user punya GPT Plus; OAuth langganan cuma berlaku untuk klien disetujui (OpenCode/Codex/ClaudeCode) — cara sah memakai langganan di app sendiri; bonus: tools bawaan (edit exact-match, sessions, events) gak perlu dibangun ulang |
| Dokumen = **markdown per-bab** via Tiptap (`@tiptap/markdown`) | agent-editable & presisi (edit exact-match), diff bersih, tampilan tetap feel-Word (.md = invisible); menulis pengalaman tetap SAMA KAYA WORD, format tetap utuh ke DOCX |
| Source-of-truth = md; **DOCX = export one-way** (`app → Word`) | round-trip docx lossy + agent edit docx rapuh; DOCX exported = final untuk submit |
| Sitasi: `references.bib` + style picker; **Zotero via Better BibTeX auto-export**; Mendeley via import `.bib/.ris` | .bib nyambung semua (app, agent, pandoc); Zotero live-sync gratis-murni; Mendeley tak punya local API |
| Export: pandoc `--citeproc` + template docx skripsi (TNR 12, margin 4-3-3-3) | bebas sitasi+daftar pustaka otomatis |
| UI **bilingual BI default + EN** (dictionary ringan, bukan framework i18n berat) | permintaan user |
| DB app minimal: `projects` + `settings` | chat history milik OpenCode service; hindari duplikasi |
| Sitasi v1 shows APA/IEEE/Harvard/Chicago + CSL | user minta "bisa milih kayak Word" |
| Google Docs / Office Online embed → **DITOLAK untuk v1** | butuh file di cloud (dotak local-first) + agent gak bisa menulis ke sana; alternatif real-docx = OnlyOffice (fase 6 opsional) |
| PDF = bukan format kerja/SHORT | PDF hanya baca (jurnal) + hasil export |
| REA ❌; socautomation ❌ dilangkahi | klarifikasi final |

## 5. Referensi & artefak yang ada di mesin

- **Clone beeblio**: `/tmp/opencode/beeblio` (referensi pola; jangan copy kode — lisensi PolyForm Noncommercial)
- **skill OpenCode** sudah dimuat (docs V2): client: `@opencode/client`, service auto-start, API `opencode api get /api/info`, auth: `opencode auth login <provider> [--method key|oauth]`, config `opencode.json(c)` + `agents`/`permissions`
- Machine: node v18.19.1 · npm 9.2 · Python 3.12 · git 2.43 · pnpm ❗belum ada
- TMP `/tmp/opencode` = workspace untuk hal eksternal (approved)

## 6. Benda yang LALI DIBUAT (jangan terulang)

- ✔ Sempat salah paham: "bikin workspace = topik skripsi" → klarifikasi ke user: itu TOOL bantu; topik skripsi beda
- ✔ Sempat salah anggap "fitur absen generate code" = app user (itu hypothetical saja)
- ✔ Sempat salah anggap workspace terpakai oleh piatta juga, tragah; biar gak kejadian lagi: workspace ini **satu-satunya deliverable** untuk fase ini
- ✔ Sempat salah anggap REA mastek diterapkan di app-nya → BUKAN (REA skip)

## 7. Langkah berikutnya (Next steps)

1. (user confirm switch dulu ke build mode — sudah selesai saat penulisan, yaitu fase berikut boleh jalan)
2. **Fase 0**: nvm install 24 · corepack pnpm · scaffold Next.js+TS+Tailwind+shadcn · drizzle schema (projects/settings) · `/workspace` attach-folder flow · default folder demo
3. Setelah itu ikut `planning.md` fase 1-4 → user setiap fase punya checklist DONE
4. Setiap fase: commit kecil-kali kecil push ke `origin/main`

## 8. agentmemory (lokal) — pipeline memori ganda

User memasang **agentmemory lokal** (REST `http://localhost:3111`, data `~/.local/share/agentmemory`, zero-LLM: BM25 + MiniLM on-device + graph fusion). Sejak sesi ini:

- **Setiap keputusan/pembahasan penting → wajib save di DUA tempat**: file `memory.md` ini (commit/push) **dan** agentmemory via `memory_save` (dengan concept tags spesifik biar gampang di-retrieval).
- Sesi ini sudah di-backfill **9 entri** ke agentmemory (project identity, repo/GitHub status, AI engine decision, format dokumen, sitasi stack, beeblio reference + lisensi, REA/socautomation decisions, fase 0 status, agentmemory setup).
- Aturan operasional (dari AGENTS.md): awal tugas → `memory_recall` dulu · keputusan/gotcha/preferensi → save segera · ❌ dilarang simpan secret · server mati → skill `memory-ops` untuk start.
- Session ini di-rename: *"research-desk: setup repo + planning + memory"*.
- Legacy mem0 cloud (`user_832d0ce7df56`) = arsip saja, jangan dipakai.

## 10. Fase 2 inti beres — chat AI ↔ OpenCode (commit `d3005b5`, 2026-10-17)

**Arsitektur yang ketemu di lapangan (FAKTUR, bukan tebakan):**
- OpenCode menjalankan **background service** 1 per mesin (`opencode serve --service`, PID 550850, port acak).
- Discovery: `~/.local/state/opencode/service.json` → `{ url, password, pid, version }`.
- Auth ke server = **Basic header** `Basic opencode:<password>` — SDK `@opencode/client@2.0.32` (persis versi CLI v2.0.32).
- `opencode auth login openai --method chatgpt-token-sharing` = **"Sign in with ChatGPT"** (GPT Plus) — CLI nyetak URL OAuth `auth.openai.com`, nunggu callback di `127.0.0.1:<port-acak>`.
- Event bus: `client.event.subscribe()` → `session.text.delta` (data: sessionID, assistantMessageID, ordinal, delta), `session.tool.*` (called/progress/success/failed), `session.step.*`, `session.idle`, `permission.asked` (data.id = requestId), `filesystem.changed` (data.file).
- Prompt: `client.session.prompt({ sessionID, text, files?: [{uri: 'file://abso', name}] })` — **promise, streaming via event bus**.
- Session per project: `session.create({ location: { directory }, agent: 'thesis', model? })`; list by `session.list({ directory, order:'desc' })`; remove pakai `{ sessionID }` (BENERAN beda key dgn create!).
- Model gratis utk tes: provider `opencode` — glm-5.3-flash-free dll. Connected-deteksi = provider selain `opencode` ada di `provider.list()`.
- Persona project: `<project>/.opencode/opencode.json` (agent.thesis prompt) + `AGENTS.md` — otomatis ditulis app.

**Gotchas fase 2 (PENTING buat sisi depan):**
1. `@opencode/client` event.subscribe & `Promise.withResolvers` butuh **Node 24** — jangan lupa sourcing `nvm use 24` di shell.
2. `session.remove({ sessionID })` — BUKAN `{ id }` (typo = `Expected string starting with "ses"`).
3. `auth.json` awal gak ada → belum connected; UI = state "Hubungkan ChatGPT".
4. Cron/VS Code port-forward: callback OAuth redirect ke `127.0.0.1:<port>` — bila browser user nolak, butuh forward port tambahan (VS Code auto-forward kebanyakan sabar; kalau gagal, user harus pastikan link auth dibuka & dapprove).
5. `OPENCODE_SERVER_PASSWORD` env gak dipakai usaha app (discovery file sudah ada password) — jangan bingung.
6. Criticize test: prompt "Sebutkan satu kata doang: kopi" → jawab streaming "kopi" — pipeline End-to-End VALID.
7. Status page: `/api/ai/status` → `{ connected:false, providers:['opencode'] }` — indikator UI CTA connect.
8. **"Safari can't connect to server" pas login (mode tautan): OAuth redirect-nya ke `127.0.0.1:<port-acak>` di mesin SERVER, bukan laptop user yang terhubung SSH.** Solusi: connect route dua mode — `?method=device` (chatgpt-headless: kode perangkat + URL statis `auth.openai.com/codex/device`, TANPA port forwarding) jadi default; `?method=link` (chatgpt-token-sharing) tersisa utk browser di mesin yang sama + forwarding port VS Code.
9. **Model picker** (commit `c1c79c2` + fix grup): dropdown di header panel chat; `GET /api/ai/models` → `{groups:[{providerID,label,free,models}], override, connected}`; POST set session via `switchModel` + simpan `settings.agentModelOverride` ("providerID/modelID", kolom sudah ada sejak fase 0). Aturan model di `src/lib/opencode/model-pick.ts` `applyModelToSession` — **override picker > auto model `openai` pertama saat connected > default service** — dipanggil di session route (create+reuse) & prompt route. BUG yang pernah kejadian: seen-set lintas group bikin grup openai gak muncul — dedupe harus PER GROUP.
10. **`opencode auth login --answer` utk integrasi key-based gak terdokumentasi nama field-nya** (v2.0.32: key/apiKey/value/secret/token/api_key semua "Unknown form field"; registry/SDK gak ngekspos field id; log trace gak bantu). Solusi sementara: login provider lain manual via terminal (`opencode auth login openrouter --method key`); UI paste-key → fase 2.5.
11. Override picker yang di-set saat smoke test HARUS di-reset ke NULL (biar auto-ChatGPT jalan) — smoke test set `settings.agent_model_override` via sqlite langsung pakai better-sqlite3 + `nvm use 24` (node 20 → SIGSEGV karena native module beda versi).
12. **Login provider lain dari app = jalur RESMI `client.integration.connect.key({ integrationID, key })`** (commit `119f7cd`) — hot nyala tanpa restart service, provider langsung masuk `provider.list()`; gak divalidasi (key salah baru kena pas chat pertama). Kebalikannya manual: hapus baris di `~/.local/share/opencode/opencode.db` tabel `credential` (`DELETE FROM credential WHERE integration_id = ?`) — bentuk tabel terverifikasi v2.0.32 (kolom id/integration_id/label/value/method_id/active). CLI `opencode auth login --answer` (gotcha #10) jadi tak relevan buat app-route ini. 235 integrasi ada di `integration.list()`; dropdown cuma nawarin 6 popular (anthropic, google, openrouter, deepseek, groq, mistral) yang punya method `key`.

**Yang masih hidden di fase 2 sisa:** *(semua BERES di `6e211be` — riwayat chat persisten + token meter + tab aktivitas detail). Model picker (`c1c79c2`) & login provider (`119f7cd`) juga udah masuk.*

13. **Riwayat chat**: route `GET /api/ai/messages?slug=` — BACA doang (list desc, first.id), GAK boleh bikin session baru (beda dr session route). Item assistant multi-step di-gabung jadi 1 bubble saat load (teks join + toolEvents concat) biar konsisten dgn tampilan streaming. `history.ts` buang type aneh (`model-switched`, `compaction`) + teks user display cuma blok `[PERINTAH USER]` (dossier otomatis dipotong).
14. **Token meter**: sumber resmi = field top-level `tokens?: {input, output, reasoning, cache}` pada pesan assistant dr `session.context`; sum cocok dgn `session.tokens` (39603/192). Route `GET /api/ai/usage?slug=` → `{tokens, messageCount}`; pesan in-flight `tokens: null` (jujur). Lagi-nya didengang pas `session.idle` (SSE).
15. **Tab aktivitas**: kartu collapsible grouped per pesan + filter chips (Semua/Baca/Edit/Jalankan; match pakai kata judul — API gak kasih field kind; belakangan bisa kasih `kind` di toolLabel).
16. **Tool `question` = JEBAKAN turn**: agent bisa manggil tool `question`, state `running` selamanya karena app gak punya jalur jawab → SEMUA prompt berikut ngantre (inbox kosong, context gak nambah, session.updated doang yang maju). UNBLOCK: `client.session.interrupt({sessionID})` — prompt ngantre langsung diproses. FIX DURABLE: agent config `tools: { question: false }` + persona nyuruh nanya via teks. Bubble chat: toolEvents = `<details>` collapsed "⚡ Aktivitas AI (n langkah)" — jangan full-width card (user kebingungan, bukti ss.png).
17. **Config agent project = tempat capability toggle (fase 2.5)**: `<project>/.opencode/opencode.json` → `agent.thesis.tools` (question:false, websearch bool) + custom key `research-desk.capabilities` {websearch, literature} buat persistensi UI. `tools` HARUS di dalam objek thesis (bukan sebelahnya — salah level = toggle gak aktif, kejadian nyata). AGENTS.md project = blok managed `<!-- research-desk:capabilities:start/end -->` di-rewrite idempotent (pompa instruksi OpenAlex/Crossref/Semantic Scholar + kalimat MATI/AKTIF per toggle).
18. **Toggle capability LIVE tapi gak instan**: service opencode hot-reload instruksi project (muncul pesan `system` "The instructions changed" di context) — tapi turn pertama setelah toggle bisa kena debounce watcher (agent baca instruksi STALE, mis. nyangka websearch masih mati); turn kedua normal. Pesan `system` itu = internal plumbing → di-filter dari riwayat (history.ts mapItem: selain user/assistant dibuang). Literature search TANPA MCP: agent pakai tool `execute` + fetch() langsung ke API OpenAlex — terbukti dari tes nyata (paper Huisman & Saab 2018 doi:10.1080/02602938.2018.14243).

## 9. Fase 1 polish — editor ala-Word (commit `ce0472a`, 2026-10-17)

**Konteks keputusan:** user ke loncatan komponen Word/GDocs lalu nanya "kenapa gak pake GDocs/Word beneran di dalam". Dibahas jujur:
- Embed editor Google/Office **ditolak via header** mereka sendiri (`x-frame-options: DENY`, CSP) — bukan keterbatasan coding. API mereka = OAuth restricted scope (verifikasi bulan-bulan) / WOPI partner resmi — overkill utk 1 mahasiswa, file pindah ke cloud mereka, agent gak bisa nulis presisi.
- **OnlyOffice** (embed self-hosted, .docx real) = escape hatch fase 6 opsional. Tradeoff: AI presisi turun (docx = ZIP berisi XML; teks dipecah jadi "runs", diff gak kebaca, risiko korup senyap). Edit presisi md = tetap standar.
- **Keputusan: tetap jalur md (Tiptap di-polish); OnlyOffice tetap terbuka** kalau nanti mesin di-upgrade dan user masih pengen feel-Word 100%. Mesin 2GB RAM: OnlyOffice kemungkinan gak muat tanpa swap.

Yang dibuat di polish:
- `ribbon.tsx` (baru): ribbon penuh — undo/redo, gaya paragraf (Normal/BAB/H2/H3), **font family/ukuran pt/spasi baris (tampilan sisir localStorage; `.md` gak ikut simpan — formatting final otomatis saat export pandoc)**, B/I/U/S, rata kiri/tengah/kanan/justify, list 3 jenis + indent/outdent, tabel (insert + baris/kolom), tautan (modal), gambar, hr, hapus format.
- Gambar: `POST /api/projects/[slug]/upload` → `gambar/` (max 10MB, whitelist mime, nama di-sanitize) · tampil via `GET /raw?path=` (guard) · **paste & drag-drop langsung ke editor** · `.md` menyimpan path relatif (`![alt](gambar/x.png)`), extension Image di-override `renderHTML` mapping src→URL raw (keluaran md tetap relatif).
- Bubble menu dipringankan krn ribbon mengangkat operasi utama.
- Styling: `.paper img { max-width:100% }`, kertas apply `fontFamily/fontSize(pt)/lineHeight` dari prefs.

Gotcha build: `unsetAllFormatting` gak ada di StarterKit-only (pakai `clearNodes().unsetAllMarks()`); `TextAlign` perlu `@tiptap/extension-text-align` (terpasang). Smoke test: upload→serve `200 image/png`, guard `..%2F..%2Fetc/passwd` ditolak, roundtrip md path relatif utuh ✓. Root `bab1.md` sempat ketimpa smoke test → pulih ke stub (file asli user di `dokumen/bab1-pendahuluan.md` aman).

## 11. Sesi lanjutan 2026-10-21 — nutup 2 utang Tier 1 + Tier 2 (matriks)

**Konteks:** sesi OpenCode sebelumnya berhenti tepat di "gue lakuin 2 tes ini sendiri" (save round-trip WordCraft + AI chat ↔ spreadsheet). Sesi ini continuation dari situ.

### 11.1 BUG BESAR: file `.md` TIDAK PERNAH kebuka di tab Word (ketemu & dibenerin)

AppOpened `.md` → tab Word → lempar file ke WordCraft. **Hasil: dokumen gak pernah tampil** (user cuma lihat "Good afternoon" + file masuk section "Recent"). App sendiri nulis "Not showing? click again or drag it in manually" — jadi app TAHU ini bisa gagal.

**Akar masalah = 2 hal terpisah:**

1. **Timing**: app lempar file ~1,2 detik setelah hook terpasang, padahal wasm WordCraft (42 MB) butuh ~6,2 detik boot. egui belum daftar handler drop → event drop hilang.
   - Sinyal readiness yang terbukti jalan: kirim `dragover` sintetis ke canvas → kalau egui sudah listen, `event.defaultPrevented === true`. (Sinyal lain: `window.wasmBindings` ada, canvas bukan 300x150, `#wordcraft_loading` hilang.)
2. **Cross-realm**: `DragEvent`/`DataTransfer`/`File` dibuat di realm PARENT lalu didispatch ke canvas iframe. WordCraft cuma mendaftarkan file-nya (muncul di "Recent"), tidak pernah membuka.
   - **Bukti**: WordCraft terisolasi (`/wordcraft/index.html` langsung, tanpa app) → drop dari realm sendiri → dokumen langsung kebuka.

**Fix (di `src/components/center/word-tab.tsx`):**
- Hook suntik ke iframe nambah `window.__wcProbeReady()` (probe `dragover`) + `window.__rwDropFile(name, base64)` (drop **di dalam realm iframe**, File/DataTransfer lahir di sana).
- State baru `wcReady` → gerbang lempar file (ganti `booted`).
- Parent panggil `win.__rwDropFile(fileName, base64)` (base64 supaya aman lintas realm).

**Belum terbukti (utang):** round-trip lengkap edit→Save→"Simpan ke bab"→file berubah di disk (lihat 11.3).

### 11.2 BUG: dossier ctx bocor file `.venv`

`buildDossier()` di `src/lib/opencode/agent-config.ts` cuma filter ekstensi (`.md|.bib|.ris|.txt`) → 245 file paket Python (`.venv/...`) masuk daftar → context terbuang 4.2 KB + agent bingung.
**Fix:** `SKIP_DIRS` di `src/lib/workspace/files.ts` diperluas (`.venv`, `venv`, `site-packages`, `__pycache__`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`, `.ipynb_checkpoints`, `.next`, `.turbo`, `.cache`) → file tree **dan** dossier bersih.

### 11.3 Status 2 "utang" Tier 1

- **Save round-trip WordCraft: ✅ TUTUP (bukti lengkap)**. Alur yang TERBUKTI jalan: **WordCraft `File → Export → Markdown`** → WordCraft download `uji-save.md` → hook anchor-download app nangkep → banner *"Word saved 'uji-save.md' — put it back into the chapter?"* → klik **"Save to chapter"** → file `.md` di disk berubah. Bukti konkret: `"# Uji Save\n\nHalo"` → `"# Uji Save\n\nHalo TES-SAVE"` (sha `12cda885…` → `8a54ec54…`).
  - **Temuan penting: WordCraft SELALU nyimpen .docx** (magic byte `PK\x03\x04`), walau file sumbernya `.md` — nama yang dipaksa di picker gak ngaruh. Jadi tombol **Save** biasa TIDAK bisa balik ke `.md`; cuma **Export → Markdown** (ekspor markdown NATIVE WordCraft) yang hasilnya markdown.
  - Karena itu sesi ini nambah jalur konversi: `POST /api/projects/[slug]/word-save` (docx→markdown via `pandoc -f docx -t gfm --wrap=none`, marker sitasi `\[@key]` di-unescape balik ke `[@key]`), dan tombol "Save to chapter" sekarang muncul juga buat hasil simpan `.docx` (file bab `.md`). Jalur Export → Markdown tetap ada (fidelitas lebih baik, tanpa lewat pandoc).
  - Catatan fidelity: `pandoc` escape `[@key]` → `\[@key]` (diperbaiki manual) dan tabel `.md` → GFM pipe table (bagus). Tapi konversi docx→md tetap lossy untuk fitur Word (gaya, nomor halaman, field).
- **Kecepatan buka dokumen di tab Word: LAMBAT (~40-120 detik)** — akar masalahnya bukan drop, tapi **font seeding**: `seedWordcraftFonts()` nulis ~315 file font ke IndexedDB di main thread, memblokir probe & drop. Di browser user seeding cuma sekali (flag `localStorage`), jadi reopen berikutnya jauh lebih cepat. Di Playwright (profil baru tiap run) selalu bayar biaya penuh.
- **AI chat ↔ spreadsheet: TERBLOKIR DI LUAR APP** (bukan bug app):
  - Free tier provider `opencode` habis: `provider.free-limit` / `FreeUsageLimitError`, `retryAfterMs` ≈ 8,8 jam. Tried: deepseek-v4.1-flash-free, glm-5.3-flash-free, minimax-m3.1-flash-free, big-pickle, beam-free, longcat, nemotron → semua limit.
  - Semua 19 model provider `openai` (ChatGPT OAuth) ditolak: *"The 'gpt-5.x' model is not supported when using Codex with a ChatGPT account"*. Kredensial valid (`chatgpt-headless`, ada refresh token, belum expired 28 Okt 2026) — jadi masalahnya **entitlement akun**, bukan token kadaluarsa.
  - Model di luar katalog (mis. `gpt-5.1-codex`) → *"Model unavailable"*.
  - **Sisi app yang TERBUKA**: `getAuthState().connected` = true selama provider `openai` ADA, padahal nol model yang bisa dipakai → UI ngaku "terhubung" padahal agent bakal error. **Perbaikan yang perlu: deteksi konektivitas nyata (cek minimal 1 model bisa dipakai), bukan cuma provider Terdaftar.**
  - Yang SUDAH terbukti dari sisi app: route `POST /api/projects/[slug]/stats-template` ✅, skrip `uji-statistik.py` jalan ✅ (angka cocok hitungan independen: mean_x 34,5250 · mean_y 61,0663 · Pearson r 0,992636 · grup A 64,9227 · grup B 57,2100), data mentah utuh ✅ (sha256 sama sebelum/sesudah).

### 11.4 Tier 2 item 1 — Matriks literatur (selesai)

Tab baru di rail kiri (`matrix`, ikon `TableProperties` — jangan `Table2`, itu dipakai placeholder "Matriks" di menu `+` panel tengah).
- Table DB baru `matrix_rows` (slug, paper_id, title, authors JSON, year, tema, metode, temuan, kutipan, position, created_at) + unique `(slug, paper_id)`; duplikasi `paper_id` dicek di app level (SQLite anggap NULL distinct).
- API: `GET/POST/PATCH/DELETE /api/projects/[slug]/matrix` + `POST /api/projects/[slug]/matrix/export` (GFM table, heading & label ikut locale).
- Panel `src/components/panels/matrix-panel.tsx`: search + tombol "+", empty state, tabel 5 kolom editable (auto-save saat blur), picker dari Library (judul/penulis/tahun terisi otomatis) atau baris manual, delete + konfirmasi, Export Markdown.
- i18n: `matrix.*` 50 key, id/en parity 503 → **553/553**.
- **BUG lama yang ditemukan (belum dibenerin)**: `library-panel.tsx` + `journal-panel.tsx` fetch `/api/journals/saved` → **404**, route yang benar `/api/journals/save`. Jadi tab "Tersimpan" error. (Panel matriks sengaja fetch yang benar.)

### 11.5 Gotcha operasional sesi ini

- **Mesin mepet**: RAM 1,9 GB total (available ~180-340 MB, swap 4 GB dipakai 2,9 GB). Build Next + Chromium + agentmemory + opencode semuanya nanggung bareng. **Jangan paralel**: build dulu → restart server → baru jalankan browser test. Playwright harus install Chromium headless **dengan `--no-sandbox --disable-dev-shm-usage`**.
- Server prod: `node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3000`. `pnpm start` pakai `-H 0.0.0.0` (bukan loopback!) — untuk mesin ini pake `-H 127.0.0.1`.
- `source ~/.bashrc && ...` di shell non-interaktif → **exit 127** (bashrc bail). Pake path absolut: `~/.nvm/versions/node/v24.22.0/bin/node`.
- `npx drizzle-kit push` aman (CREATE TABLE baru, data lama utuh) tapi **HINDARI jalan bareng** dengan `npx eslint`/build → ESLint sempat gagal load `eslint-plugin-react-hooks` (race di node_modules pnpm), build lanjut setelah error itu.
- `drizzle-kit push` TIDAK bikin folder `drizzle/` (belum ada migrations sama sekali) — `drizzle.config.ts` cuma nunjuk `out`.
- Skema kolom DB = **snake_case**, properti Drizzle = camelCase (`folderPath: text('folder_path')`). Raw SQL query harus pakai nama kolom snake_case (`folder_path`), bukan nama properti.
- `session.remove({sessionID})` BUKAN `{id}`; `client.session.create` → `session.list({directory})` → `session.prompt({sessionID,text})`.
- Loop playback: stream SSE `/api/ai/stream?sessionId=…`; event `permission` (data.id = requestId) → balas `POST /api/ai/permission` `{sessionId, requestId, decision:'once'}` (meniru user klik "Allow once").
- Symlink `~/.agentmemory/secret` = Bearer token REST agentmemory. **REST-nya sempat mati total** (semua route 404) karena engine `iii` jalan tanpa worker agentmemory →修复: `CI=1 EMBEDDING_PROVIDER=local npx -y @agentmemory/agentmemory@latest` (start ulang). Data mentah tetap ada di `~/.local/share/agentmemory/state_store.db/mem%3Amemories.bin` (JSON polos + trailer biner — parse sampai `lastIndexOf('}')`).
- Repo `~/.tier1-test` + `~/.local/share/agentmemory` = artefak tes; project test `probe-wc` (foldernya udah dihapus) **sudah dibersih** dari tabel `projects`, `tier1-test` sengaja dibiarin buat tes statistik lanjutan.
- **`.commandcode/`** = folder tooling sesi CommandCode → sudah masuk `.gitignore` (jangan ikut commit).

### 11.6 Tier 2 item 2 — Anotasi PDF ringan (selesai)

Catatan/kutipan dari paper, menempel ke baris matriks (atau ke paper doang), lalu bisa didorong ke kolom `kutipan` dalam satu klik.
- Table DB baru `paper_notes` (id, slug, paper_id, matrix_row_id FK→`matrix_rows.id` ON DELETE SET NULL, note, quote, source, created_at). Diterapkan `npx drizzle-kit push --force` (prompt-nya butuh TTY) → hanya CREATE TABLE baru, data lama utuh.
- API: `GET/POST/PATCH/DELETE /api/projects/[slug]/notes`; `GET` bisa disaring `?paperId=` / `?matrixRowId=`. Error pakai `{ error, code }` dengan code `notes.noteMissing` / `notes.rowMissing` / `notes.notFound` (bisa diterjemahkan client via `errorText`).
- Panel matriks: chip "N catatan" di sel Paper → expand jadi baris tambahan (`<tr>` colspan 6) berisi daftar catatan (isi + kutipan, auto-save saat blur), tombol hapus, dan form tambah. Tombol "kutip" (ikon `Quote`) PATCH `/matrix` kolom `kutipan` — kalau sel sudah ada isi, kutipan di-append (dilewati kalau sudah ada).
- Baris matriks dihapus → `matrix_row_id` catatannya di-null-kan (catatan tetap nempel ke paper). FK-nya juga `ON DELETE SET NULL`, tapi `PRAGMA foreign_keys` di `src/lib/db/index.ts` gak di-set ON, jadi cleanup dilakukan di app level.
- Preview PDF di tab tengah (`src/components/center/file-view.tsx`): PDF di `referensi/` yang namanya cocok dengan paper di Perpustakaan nampilin chip "N catatan" + panel catatan (read-only). Cocok dari nama berkas ↔ paperId / judul / turunan DOI (`src/lib/notes/match.ts`, `pdfFileStem` meniru route `/api/journals/pdf`).
- i18n: `notes.*` 28 key, id/en parity 554 → **582/582**.
- Yang SENGAJA gak dibangun: canvas overlay / PDF.js text-layer annotator / alat gambar (editor PDF visual = lift besar sendiri), dan tombol push-kutipan di preview PDF (cukup di panel matriks).
