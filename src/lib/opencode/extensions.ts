import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

/**
 * MCP servers & skills per project — config di `<project>/.opencode/opencode.json`
 * (server OpenCode membacanya saat sesi chat baru dibuat, gak perlu restart service)
 * dan skills di `<project>/.opencode/skills/`.
 *
 * SEMANGAT merge-PRESERVE (patokan fix c8cc8be di agent-config.ts): app CUMA
 * pegang blok `mcp` — semua key lain ($schema, research-desk, agent, provider,
 * plugins, dsb.) yang ditulis manual/user/instaler WAJIB kejaga, jangan
 * full-replace. Config yang rusak (gak valid JSON) DITOLAK untuk ditulis
 * biar file manual user gak ke-lumat oleh config kosong.
 *
 * Bentuk config MCP (standar OpenCode):
 *  - `"mcp": { "<name>": { "type": "local", "command": ["npx","-y","pkg"], "enabled": true, "environment": {"VAR":"v"} } }`
 *  - `"mcp": { "<name>": { "type": "remote", "url": "https://…", "enabled": true } }`
 *
 * Rules keamanan: env/creds gak pernah di-log; placeholder `{env:VAR}` di
 * command dibiarkan literal as-is (OpenCode yang resolusi — UI gak menyentuh).
 */

const execFileP = promisify(execFile);

/** Nama MCP/skill: pendek, tanpa spasi — aman jadi key JSON + folder. */
export const MCP_NAME_RE = /^[a-zA-Z0-9._-]{1,64}$/;

type McpErrorCode =
  | 'ERR_CONFIG' // file config ada tapi gak valid JSON
  | 'ERR_SAVE' // gagal nulis config
  | 'ERR_NAME' // nama kosong / gak lolos regex
  | 'ERR_EXISTS' // nama sudah dipakai
  | 'ERR_URL' // command/url wajib di-isi atau gak valid
  | 'ERR_NO_SKILL' // SKILL.md gak ada di root repo hasil clone
  | 'ERR_INSTALL'; // kloning / install gagal

export class McpError extends Error {
  constructor(readonly code: McpErrorCode) {
    super(`extensions: ${code}`);
    this.name = 'McpError';
  }
}

/** Kode error server → status + key i18n `mcp.*` buat UI. */
export const MCP_ERROR_PAYLOAD: Record<McpErrorCode, { status: number; error: string }> = {
  ERR_CONFIG: { status: 400, error: 'mcp.errConfig' },
  ERR_SAVE: { status: 500, error: 'mcp.errSave' },
  ERR_NAME: { status: 400, error: 'mcp.errName' },
  ERR_EXISTS: { status: 409, error: 'mcp.errExists' },
  ERR_URL: { status: 400, error: 'mcp.errUrl' },
  ERR_NO_SKILL: { status: 422, error: 'mcp.errNoSkill' },
  ERR_INSTALL: { status: 500, error: 'mcp.errInstall' },
};

// ── Config opencode.json — read/write dengan preserve semua key lain ────────

const configPath = (folderPath: string) => path.join(folderPath, '.opencode', 'opencode.json');

/**
 * Baca config project. File gak ada → config kosong (normal). File ada tapi
 * rusak → `broken: true`; caller WAJIB menolak menulis agar file manual
 * gak ke-clobber.
 */
export function readOpencodeConfig(folderPath: string): {
  config: Record<string, unknown>;
  broken: boolean;
} {
  const file = configPath(folderPath);
  if (!fs.existsSync(file)) return { config: {}, broken: false };
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('root bukan objek');
    }
    return { config: parsed as Record<string, unknown>, broken: false };
  } catch {
    return { config: {}, broken: true };
  }
}

function writeOpencodeConfig(folderPath: string, config: Record<string, unknown>): void {
  fs.mkdirSync(path.join(folderPath, '.opencode'), { recursive: true });
  fs.writeFileSync(configPath(folderPath), JSON.stringify(config, null, 2), 'utf8');
}

// ── MCP: list / add / toggle / remove ────────────────────────────────────────

export type McpEntry =
  | { type: 'local'; command: string[]; enabled: boolean }
  | { type: 'remote'; url: string; enabled: boolean };

export type McpListItem = { name: string; entry: McpEntry };

function asMcpBlock(config: Record<string, unknown>): Record<string, unknown> | null {
  const block = config.mcp;
  if (!block || typeof block !== 'object' || Array.isArray(block)) return null;
  return block as Record<string, unknown>;
}

/** Parse satu entry mcp dari config existing — entry rusak dilewati (gak diamankan). */
function normalizeMcpEntry(raw: unknown): McpEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const enabled = source.enabled === undefined ? true : source.enabled === true;
  if (source.type === 'local') {
    const command = Array.isArray(source.command)
      ? source.command.filter((part): part is string => typeof part === 'string')
      : [];
    if (command.length === 0) return null;
    return { type: 'local', command, enabled };
  }
  if (source.type === 'remote') {
    const url = typeof source.url === 'string' && source.url.length > 0 ? source.url : null;
    if (!url) return null;
    return { type: 'remote', url, enabled };
  }
  return null;
}

export function listMcp(config: Record<string, unknown>): McpListItem[] {
  const block = asMcpBlock(config);
  if (!block) return [];
  const items: McpListItem[] = [];
  for (const [name, raw] of Object.entries(block)) {
    const entry = normalizeMcpEntry(raw);
    if (entry) items.push({ name, entry });
  }
  return items;
}

/** Split command sederhana per spasi — quote gak di-handle (sengaja, simpel). */
export function parseCommand(input: string): string[] {
  return input.trim().split(/\s+/).filter(Boolean);
}

/** Textarea env → object `VAR=value` per baris (baris tanpa `=` dilewati). */
export function parseEnvText(input: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of input.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    // Placeholder {env:VAR} dirujuk pakai nama var standar → key regex ketat.
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) env[key] = value;
  }
  return env;
}

export type AddMcpInput = {
  name: string;
  kind: 'local' | 'remote';
  command?: string | null;
  url?: string | null;
  env?: string | null;
};

/** Tambah entry MCP baru (dupe ditolak). Balik nama yang dipakai. */
export async function addMcp(folderPath: string, input: AddMcpInput): Promise<string> {
  const name = input.name.trim();
  if (!MCP_NAME_RE.test(name)) throw new McpError('ERR_NAME');

  const { config, broken } = readOpencodeConfig(folderPath);
  if (broken) throw new McpError('ERR_CONFIG');

  const block: Record<string, unknown> = { ...(asMcpBlock(config) ?? {}) };
  for (const existing of Object.keys(block)) {
    if (existing.toLowerCase() === name.toLowerCase()) throw new McpError('ERR_EXISTS');
  }

  let entry: Record<string, unknown>;
  if (input.kind === 'local') {
    const command = parseCommand(input.command ?? '');
    if (command.length === 0) throw new McpError('ERR_URL');
    entry = { type: 'local', command, enabled: true };
    const environment = parseEnvText(input.env ?? '');
    if (Object.keys(environment).length > 0) entry.environment = environment;
  } else {
    const url = (input.url ?? '').trim();
    if (!url || !/^https?:\/\//i.test(url)) throw new McpError('ERR_URL');
    entry = { type: 'remote', url, enabled: true };
  }

  // Placeholder {env:VAR} dalam command dibiarkan literal — pass-through;
  // resolusi placeholder itu kerjaan OpenCode, bukan UI.
  block[name] = entry;
  config.mcp = block;

  try {
    writeOpencodeConfig(folderPath, config);
  } catch (error) {
    console.error('[extensions] gagal menulis opencode.json:', error);
    throw new McpError('ERR_SAVE');
  }
  return name;
}

/**
 * Toggle enabled satu entry. Entry langsing dimodifikasi di tempat sehingga
 * field lain (environment/headers umum) kejaga. Entry gak ketemu → no-op
 * (idempotent, gak dikunci error).
 */
export async function toggleMcp(folderPath: string, name: string, enabled: boolean): Promise<boolean> {
  const { config, broken } = readOpencodeConfig(folderPath);
  if (broken) throw new McpError('ERR_CONFIG');
  const block = asMcpBlock(config);
  const raw = block?.[name];
  if (!block || !raw || typeof raw !== 'object') return false;
  (raw as Record<string, unknown>).enabled = enabled;
  config.mcp = block;
  try {
    writeOpencodeConfig(folderPath, config);
  } catch (error) {
    console.error('[extensions] gagal menulis opencode.json:', error);
    throw new McpError('ERR_SAVE');
  }
  return true;
}

/** Hapus satu entry (idempotent — nama gak ketemu tetap balik ok). */
export async function removeMcp(folderPath: string, name: string): Promise<boolean> {
  const { config, broken } = readOpencodeConfig(folderPath);
  if (broken) throw new McpError('ERR_CONFIG');
  const block = asMcpBlock(config);
  if (!block || !(name in block)) return false;
  const rest: Record<string, unknown> = { ...block };
  delete rest[name];
  if (Object.keys(rest).length === 0) delete config.mcp;
  else config.mcp = rest;
  try {
    writeOpencodeConfig(folderPath, config);
  } catch (error) {
    console.error('[extensions] gagal menulis opencode.json:', error);
    throw new McpError('ERR_SAVE');
  }
  return true;
}

// ── Skills: list + installer dari GitHub ────────────────────────────────────

const skillsDir = (folderPath: string) => path.join(folderPath, '.opencode', 'skills');

export type SkillListItem = { name: string; description: string | null };

export async function listSkills(folderPath: string): Promise<SkillListItem[]> {
  let names: string[];
  try {
    const dirents = await fsp.readdir(skillsDir(folderPath), { withFileTypes: true });
    names = dirents
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name)
      .filter((name) => MCP_NAME_RE.test(name))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
  const items: SkillListItem[] = [];
  for (const name of names) {
    const meta = readSkillMeta(await readHead(path.join(skillsDir(folderPath), name, 'SKILL.md')));
    items.push({ name, description: meta.description });
  }
  return items;
}

/** Baca maksimal 2 KB awal file — buat frontmatter best-effort. */
async function readHead(file: string, max = 2048): Promise<string | null> {
  try {
    const handle = await fsp.open(file, 'r');
    try {
      const buffer = Buffer.alloc(max);
      const { bytesRead } = await handle.read(buffer, 0, max, 0);
      return buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

/** Frontmatter best-effort dari head SKILL.md — field `name:` / `description:` pertama. */
function readSkillMeta(head: string | null): { name: string | null; description: string | null } {
  if (!head) return { name: null, description: null };
  const fields = new Map<string, string>();
  for (const line of head.split(/\r?\n/)) {
    const match = /^(name|description):\s*(.+?)\s*$/.exec(line);
    if (!match) continue;
    if (!fields.has(match[1])) {
      fields.set(match[1], match[2].replace(/^["']|["']$/g, ''));
    }
  }
  const description = fields.get('description');
  return {
    name: fields.get('name') ?? null,
    description: description ? truncateText(description, 240) : null,
  };
}

function truncateText(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function sanitizeSkillName(raw: string): string {
  const candidate = raw
    .trim()
    .toLowerCase()
    .replace(/\.git$/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[-.]+/, '')
    .slice(0, 64)
    .replace(/[-]+$/, '');
  return MCP_NAME_RE.test(candidate) ? candidate : 'skill';
}

/**
 * URL GitHub → data kloning. Terima `https://github.com/owner/repo`
 * (tolerir juga …/tree/<ref>/…). Sisanya ditolak.
 */
function parseGithubUrl(input: string): { cloneUrl: string; repoName: string } {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new McpError('ERR_URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new McpError('ERR_URL');
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'github.com') throw new McpError('ERR_URL');
  const segments = parsed.pathname.split('/').filter(Boolean);
  const owner = segments[0];
  const repo = (segments[1] ?? '').replace(/\.git$/, '');
  if (!owner || !repo || !/^[A-Za-z0-9._-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(repo)) {
    throw new McpError('ERR_URL');
  }
  return { cloneUrl: `https://github.com/${owner}/${repo}.git`, repoName: repo };
}

async function gitClone(cloneUrl: string, dest: string): Promise<void> {
  try {
    // GIT_TERMINAL_PROMPT=0 → repo private gagal cepat, bukan gantung 60 detik.
    // Env proses cuma diturunin apa adanya (gak disebar/di-log di log).
    await execFileP('git', ['clone', '--depth', '1', '--', cloneUrl, dest], {
      timeout: 60_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
  } catch (error) {
    console.error('[extensions] git clone gagal:', error);
    throw new McpError('ERR_INSTALL');
  }
}

/**
 * Pasang skill dari repo GitHub:
 * 1) clone --depth 1 ke tmp di luar project, 2) SKILL.md WAJIB ada di root,
 * 3) nama = frontmatter `name:` (best-effort, jaga 2 KB) → slug nama repo,
 * 4) dupe di `.opencode/skills/` ditolak, 5) salin isi clone KECUALI `.git/`,
 * 6) tmp dibersihkan apa pun hasilnya.
 */
export async function installSkillFromGithub(
  folderPath: string,
  rawUrl: string,
): Promise<{ name: string; description: string | null }> {
  const source = parseGithubUrl(rawUrl.trim());
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'rd-skill-'));
  try {
    const repoDir = path.join(tmpDir, 'repo');
    await gitClone(source.cloneUrl, repoDir);

    const head = await readHead(path.join(repoDir, 'SKILL.md'));
    if (head === null) throw new McpError('ERR_NO_SKILL');
    const meta = readSkillMeta(head);

    const name = sanitizeSkillName(meta.name ?? source.repoName);
    const dest = path.join(skillsDir(folderPath), name);
    if (fs.existsSync(dest)) throw new McpError('ERR_EXISTS');

    fs.mkdirSync(skillsDir(folderPath), { recursive: true });
    fs.cpSync(repoDir, dest, {
      recursive: true,
      // .git/ hasil clone gak dibutuhkan di folder skill.
      filter: (sourcePath) => path.basename(sourcePath) !== '.git',
    });
    return { name, description: meta.description };
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
}
