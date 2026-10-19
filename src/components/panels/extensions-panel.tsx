'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useT } from '@/lib/preferences';
import { Button, SegmentedGroup } from '@/components/ui';

/**
 * Pane MCP & Skills buat dialog Settings (pindahan dari tab 'extensions' di
 * rail kiri). Dua komponen: McpPane (kelola server MCP project — config
 * `.opencode/opencode.json` yang dibaca server OpenCode saat sesi chat baru
 * dibuat — tanpa restart) dan SkillsPane (pasang skill agent dari repo GitHub
 * ke `.opencode/skills/`). Isi & logika identik dengan panel lama; header
 * judul/desc-nya rendah di dialog, bukan di pane. Keduanya zero-props: slug
 * project aktif dibaca dari URL `/p/<slug>`.
 */

type McpItem = {
  name: string;
  type: 'local' | 'remote';
  enabled: boolean;
  command?: string;
  url?: string;
};

type SkillItem = { name: string; description?: string | null };

type ExtensionsData = {
  mcp?: McpItem[];
  skills?: SkillItem[];
  configError?: boolean;
};

/** Pesan kode → "mcp.added:<name>" / "mcp.installed:<name>" dibuka var-nya. */
function unwrapNamed(code: string): { key: string; name?: string } {
  for (const prefix of ['mcp.added:', 'mcp.installed:']) {
    if (code.startsWith(prefix)) return { key: prefix.slice(0, -1), name: code.slice(prefix.length) };
  }
  return { key: code };
}

/** Slug project aktif dari URL workspace (`/p/<slug>`). */
function slugFromLocation(): string | null {
  const match = /^\/p\/([^/?#]+)\/?/.exec(window.location.pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

/** Pane hidup cuma di browser — baca slug dari URL sekali saat mount. */
function useProjectSlug(): string | null {
  const [slug, setSlug] = useState<string | null>(null);
  useEffect(() => {
    setSlug(slugFromLocation());
  }, []);
  return slug;
}

const inputClass =
  'mb-1 w-full rounded-md border border-border bg-background px-2 py-1.5 outline-none placeholder:text-muted-foreground/70 focus:ring-1 focus:ring-ring';
const labelClass = 'mb-1 block text-[11px] font-medium text-card-foreground';

export function McpPane() {
  const t = useT();
  const slug = useProjectSlug();
  const [mcpItems, setMcpItems] = useState<McpItem[]>([]);
  const [configError, setConfigError] = useState(false);

  const [name, setName] = useState('');
  const [kind, setKind] = useState<'local' | 'remote'>('local');
  const [command, setCommand] = useState('');
  const [url, setUrl] = useState('');
  const [env, setEnv] = useState('');

  const [busy, setBusy] = useState<'add' | null>(null);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const applyResult = (ok: boolean, serverError?: string, fallback = 'mcp.errSave') => {
    if (ok) return true;
    setMsg(serverError && serverError.startsWith('mcp.') ? serverError : fallback);
    return false;
  };

  const loadList = useCallback(async () => {
    if (!slug) {
      setConfigError(true);
      return;
    }
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/extensions`);
      const data = (await res.json()) as ExtensionsData;
      setMcpItems(res.ok ? (data.mcp ?? []) : []);
      setConfigError(!res.ok || Boolean(data.configError));
    } catch {
      setConfigError(true);
    }
  }, [slug]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const busyOther = busy !== null || busyRow !== null;

  const addServer = async () => {
    if (busyOther || !slug) return;
    setBusy('add');
    setMsg(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/extensions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', name, kind, command, url, env }),
      });
      const data = (await res.json()) as { name?: string; error?: string };
      if (res.ok && applyResult(Boolean(data.name), data.error)) {
        setMsg(`mcp.added:${data.name}`);
        setName('');
        setCommand('');
        setUrl('');
        setEnv('');
        await loadList();
      }
    } catch {
      setMsg('mcp.errSave');
    } finally {
      setBusy(null);
    }
  };

  const toggleServer = async (item: McpItem) => {
    if (busyOther || !slug) return;
    setBusyRow(item.name);
    setMsg(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/extensions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: item.enabled ? 'disable' : 'enable', name: item.name }),
      });
      const data = (await res.json()) as { error?: string };
      applyResult(res.ok, data.error);
      await loadList();
    } catch {
      setMsg('mcp.errSave');
    } finally {
      setBusyRow(null);
    }
  };

  const removeServer = async (item: McpItem) => {
    if (busyOther || !slug) return;
    setBusyRow(item.name);
    setMsg(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/extensions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove', name: item.name }),
      });
      const data = (await res.json()) as { error?: string };
      applyResult(res.ok, data.error);
      await loadList();
    } catch {
      setMsg('mcp.errSave');
    } finally {
      setBusyRow(null);
    }
  };

  const canAdd =
    name.trim().length > 0 &&
    (kind === 'remote' ? url.trim().length > 0 : command.trim().length > 0);

  /** Chip jenis pendek: buang bagian dalam kurung ("Lokal (command)" → "Lokal"). */
  const kindLabel = (type: 'local' | 'remote') =>
    t(type === 'local' ? 'mcp.typeLocal' : 'mcp.typeRemote').replace(/\s*\(.*\)$/, '').trim();

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto text-[12px]">
        {configError && (
          <p className="mb-2.5 text-[11px] leading-snug text-amber-700 dark:text-amber-300">
            {t('mcp.errConfig')}
          </p>
        )}

        {mcpItems.length === 0 ? (
          <p className="mb-1 text-muted-foreground">{t('mcp.empty')}</p>
        ) : (
          <ul className="mb-4 space-y-1">
            {mcpItems.map((item) => (
              <li
                key={item.name}
                className="flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1.5"
              >
                <span className="truncate font-mono text-[11px] text-card-foreground" title={item.name}>
                  {item.name}
                </span>
                <span className="shrink-0 rounded bg-muted px-1 text-[9px] font-mono uppercase text-muted-foreground">
                  {kindLabel(item.type)}
                </span>
                <span className="flex-1" />
                {busyRow === item.name && (
                  <Loader2 size={12} className="shrink-0 animate-spin text-muted-foreground" />
                )}
                <button
                  type="button"
                  disabled={busyOther}
                  onClick={() => void toggleServer(item)}
                  title={t(item.enabled ? 'mcp.enabled' : 'mcp.disabled')}
                  aria-label={`${item.name}: ${t(item.enabled ? 'mcp.enabled' : 'mcp.disabled')}`}
                  className={`shrink-0 cursor-pointer rounded-full border px-1.5 py-0.5 text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    item.enabled
                      ? 'border-amber-500/40 bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 dark:text-amber-300'
                      : 'border-border bg-muted/50 text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {t(item.enabled ? 'mcp.enabled' : 'mcp.disabled')}
                </button>
                <button
                  type="button"
                  disabled={busyOther}
                  onClick={() => void removeServer(item)}
                  title={t('mcp.remove')}
                  aria-label={`${item.name}: ${t('mcp.remove')}`}
                  className="cursor-pointer px-1 text-[13px] leading-none text-muted-foreground transition-colors hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="border-t border-border pt-3">
          <label className={labelClass}>{t('mcp.name')}</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('mcp.namePh')}
            className={`${inputClass} font-mono`}
          />
          <div className="mb-2 mt-1">
            <SegmentedGroup
              options={[
                { value: 'local', label: t('mcp.typeLocal') },
                { value: 'remote', label: t('mcp.typeRemote') },
              ]}
              active={kind}
              onSelect={(value) => setKind(value as 'local' | 'remote')}
            />
          </div>
          {kind === 'local' ? (
            <>
              <label className={labelClass}>{t('mcp.command')}</label>
              <input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder={t('mcp.commandPh')}
                className={`${inputClass} font-mono`}
              />
              <textarea
                value={env}
                onChange={(e) => setEnv(e.target.value)}
                placeholder={t('mcp.env')}
                rows={2}
                className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[11px] outline-none placeholder:text-muted-foreground/70 focus:ring-1 focus:ring-ring"
              />
              <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{t('mcp.envNote')}</p>
            </>
          ) : (
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t('mcp.urlPh')}
              aria-label={t('mcp.add')}
              className={`${inputClass} font-mono`}
            />
          )}
          <Button
            variant="default"
            className="mt-2 h-7 px-2.5 text-[11px]"
            disabled={busyOther || !canAdd}
            onClick={() => void addServer()}
          >
            {busy === 'add' && <Loader2 size={12} className="animate-spin" />}
            {t('mcp.add')}
          </Button>
        </div>

        {msg && (
          <p className="mt-2.5 text-[11px] leading-snug text-amber-700 dark:text-amber-300">
            {(() => {
              const { key, name: named } = unwrapNamed(msg);
              return named ? t(key, { name: named }) : t(key);
            })()}
          </p>
        )}
      </div>
    </section>
  );
}

export function SkillsPane() {
  const t = useT();
  const slug = useProjectSlug();
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [configError, setConfigError] = useState(false);

  const [skillUrl, setSkillUrl] = useState('');
  const [busy, setBusy] = useState<'install' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const applyResult = (ok: boolean, serverError?: string, fallback = 'mcp.errSave') => {
    if (ok) return true;
    setMsg(serverError && serverError.startsWith('mcp.') ? serverError : fallback);
    return false;
  };

  const loadList = useCallback(async () => {
    if (!slug) {
      setConfigError(true);
      return;
    }
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/extensions`);
      const data = (await res.json()) as ExtensionsData;
      setSkills(res.ok ? (data.skills ?? []) : []);
      setConfigError(!res.ok || Boolean(data.configError));
    } catch {
      setConfigError(true);
    }
  }, [slug]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const busyOther = busy !== null;

  const installSkill = async () => {
    if (busyOther || !slug) return;
    setBusy('install');
    setMsg(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}/skills`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: skillUrl }),
      });
      const data = (await res.json()) as { name?: string; error?: string };
      if (res.ok && applyResult(Boolean(data.name), data.error, 'mcp.errInstall')) {
        setMsg(`mcp.installed:${data.name}`);
        setSkillUrl('');
        await loadList();
      }
    } catch {
      setMsg('mcp.errInstall');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto text-[12px]">
        {configError && (
          <p className="mb-2.5 text-[11px] leading-snug text-amber-700 dark:text-amber-300">
            {t('mcp.errConfig')}
          </p>
        )}

        {skills.length === 0 ? (
          <p className="mb-2 text-[11px] text-muted-foreground">{t('mcp.skillsEmpty')}</p>
        ) : (
          <ul className="mb-2.5 space-y-1">
            {skills.map((skill) => (
              <li key={skill.name} className="rounded-md bg-muted/50 px-2 py-1.5">
                <p className="truncate font-mono text-[11px] text-card-foreground" title={skill.name}>
                  {skill.name}
                </p>
                {skill.description && (
                  <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-muted-foreground">
                    {skill.description}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="border-t border-border pt-3">
          <input
            value={skillUrl}
            onChange={(e) => setSkillUrl(e.target.value)}
            placeholder={t('mcp.skillUrlPh')}
            aria-label={t('mcp.skillUrl')}
            className={`${inputClass} font-mono`}
          />
          <Button
            variant="default"
            className="mt-2 h-7 px-2.5 text-[11px]"
            disabled={busyOther || skillUrl.trim().length === 0}
            onClick={() => void installSkill()}
          >
            {busy === 'install' && <Loader2 size={12} className="animate-spin" />}
            {busy === 'install' ? t('mcp.installing') : t('mcp.install')}
          </Button>
        </div>

        {msg && (
          <p className="mt-2.5 text-[11px] leading-snug text-amber-700 dark:text-amber-300">
            {(() => {
              const { key, name: named } = unwrapNamed(msg);
              return named ? t(key, { name: named }) : t(key);
            })()}
          </p>
        )}
      </div>
    </section>
  );
}
