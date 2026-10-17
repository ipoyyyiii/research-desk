# MEMORY — Riwayat & Keputusan Sesi (private context)

> File memori sesi. Kalau context hilang/session baru, BACA DULU file ini + `planning.md` sebelum kerja apapun di repo ini.
> Last updated: sesi pembuatan repo (baseline — belum ada fase 0).

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
- **Status: fase 0 belum mulai.** Langkah berikutnya menurut user: nyebut "gas fase 0" (Node 24 + pnpm → scaffold Next.js → fase 1 layout+editor)
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
