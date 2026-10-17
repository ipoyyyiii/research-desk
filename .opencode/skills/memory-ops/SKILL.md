---
name: Memory Ops (agentmemory lokal)
description: Start/stop/status/secret agentmemory server di mesin ini (REST :3111, data lokal, zero-LLM). Load saat memory tools gagal, saat sesi awal mendapati server mati, atau saat need mengubah mode embeddings.
---

# Memory Ops — agentmemory lokal di mesin ini

Server: `http://localhost:3111` (REST/MCP), viewer `http://localhost:3113`, data di `~/.local/share/agentmemory`,
engine iii pinned v0.22.1 di `~/.agentmemory/bin`. Node 20+ (via NodeSource). Mode **zero-LLM** (BM25).

## Cek hidup

```bash
curl -fsS http://localhost:3111/agentmemory/livez          # 200 = hidup
CI=1 npx -y @agentmemory/agentmemory@latest status         # health + mode + heap
```

## Start (jika mati)

```bash
EMBEDDING_PROVIDER=local CI=1 npx -y @agentmemory/agentmemory@latest   # jalankan background; ready saat livez 200
```

## Stop

```bash
CI=1 npx -y @agentmemory/agentmemory@latest stop
```

## REST manual (fallback saat MCP tools bermasalah)

Semua call REST butuh Bearer token dari `~/.agentmemory/secret` (jangan pernah print isinya):

```bash
TOKEN=$(cat ~/.agentmemory/secret)
curl -s -X POST http://localhost:3111/agentmemory/remember \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"content":"<fakta>","concepts":["<tag>"]}'
curl -s -X POST http://localhost:3111/agentmemory/smart-search \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"query":"<query>","limit":5}'
curl -s http://localhost:3111/agentmemory/health -H "Authorization: Bearer $TOKEN"
```

## MCP shim — WAJIB launch via runner lokal, BUKAN npx

`agentmemory connect` nulis config OpenCode pakai `npx -y @agentmemory/mcp` — di mesin ini bikin
**"Request timed out"** (npx menginstall ulang whole-tree tiap spawn, OpenCode MCP init timeout duluan).
Fix yang sudah diterapkan: config MCP di `~/.config/opencode/opencode.json` launch langsung node:

```json
"command": ["node", "/home/ubuntu/.agentmemory/mcp-runner/node_modules/@agentmemory/mcp/bin.mjs"]
```

Runner permanent di `~/.agentmemory/mcp-runner/` (instalasi satu kali, `@agentmemory/mcp@0.9.30`).
Kalau MCP error lagi: cek `opencode mcp list` → `✗ failed`, lalu tes shim manual:
`echo '{"jsonrpc":"2.0","id":1,"method":"initialize",...}' | node .../bin.mjs` (harus balas instan).

## Mode embeddings — SUDAH AKTIF di mesin ini (semantic recall on-device, gratis, bukan LLM)

Aktif via `EMBEDDING_PROVIDER=local` di `~/.agentmemory/.env` (model `Xenova/all-MiniLM-L6-v2`,
cache di `node_modules/@huggingface/transformers/.cache/`; dependensinya manual di-install
`--no-save` karena package bundlenya optionalDep). Tambahkan juga `AGENTMEMORY_VECTOR_BACKFILL=all`.

Gotcha penting:
- Panel `status` CLI-nya punya bug kosmetik (bandingkan string) — TAMPIL "bm25-only" padahal aktif.
  Verifikasi yang benar: `curl :3111/agentmemory/config/flags` → lihat `embeddingProvider:"local"`.
- `status` harus dari env yang sama; jika ragu, taruh env inline saat start:
  `EMBEDDING_PROVIDER=local CI=1 npx -y @agentmemory/agentmemory@latest`.
- Memory lama yang ke-save sebelum embeddings aktif gak punya vektor → gejala: gak muncul di
  query tanpa tampuk kata. Fix: re-save dokumennya via `remember` (embeds on write).

Revert (kalau mesin pada sesak): hapus 2 baris env itu, restart → balik BM25-only.

## Diagnostik

```bash
CI=1 npx -y @agentmemory/agentmemory@latest doctor
```

## Legacy arsip: mem0 cloud

`mem0` CLI masih tersedia (`~/.local/bin/mem0`, config `~/.mem0/config.json`, user `user_832d0ce7df56`).
Jangan dipakai untuk memory baru; jangan jalankan perintah delete kecuali diminta eksplisit.
