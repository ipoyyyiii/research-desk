# MEMORY — Riwayat & Keputusan Sesi (private context)

> File memori sesi. Kalau context hilang/session baru, BACA DULU file ini + `planning.md` sebelum kerja apapun di repo ini.
> Last updated: agentmemory lokal terpasang & semua pembahasan sesi ini sudah tersimpan DI DUA tempat (file ini + agentmemory, 9 entri baseline). Fase 0 belum dimulai.

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
