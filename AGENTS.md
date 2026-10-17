# research-desk

## Long-term memory — agentmemory (local) — WAJIB

Project ini pakai **agentmemory lokal** (bukan cloud) sebagai memori lintas sesi OpenCode:

- Server REST di `http://localhost:3111`, data 100% lokal di `~/.local/share/agentmemory`.
- Mode **zero-LLM**: tanpa API key, retrieval hybrid BM25 + **local embeddings (MiniLM, on-device)** + graph fusion.
- Ops (start/stop/status/secret): lihat skill `memory-ops` di `.opencode/skills/`.
- MCP tools (`memory_recall`, `memory_save`, dst.) sudah di-wire global + 17 skills agentmemory terpasang di `.agents/skills/`.

Aturan utama:
1. **Awal tugas → recall dulu** (`memory_recall` / `memory_smart_search`) sebelum minta user ngulang konteks.
2. **Saat menetapkan keputusan / menemukan gotcha / user bilang preferensi → save segera** (`memory_save`), jangan tunda sampai akhir sesi.
3. **Dilarang** menyimpan API key, password, token, atau data sensitif.
4. Server mati? Start dulu (skill `memory-ops`), baru recall.

## Legacy: mem0 cloud (ARSIP)

Akun mem0 cloud (`user_832d0ce7df56`, CLI di `~/.local/bin/mem0`) hanya arsip — jangan dipakai untuk memory baru. Migrasi datanya sudah selesai.
