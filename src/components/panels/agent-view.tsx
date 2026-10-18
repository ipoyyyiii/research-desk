'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AgentPanel,
  type ChatMessage,
  type ChatToolEvent,
  type ModelEntryView,
  type ModelGroupView,
  type ProviderPickView,
} from '@/components/panels/agent-panel';
import { Button } from '@/components/ui';
import { useT } from '@/lib/preferences';

type StreamEvent = { id?: string; type?: string; data?: Record<string, unknown> };

type PermissionCard = {
  requestId: string;
  action: string;
  resources: string[];
  message?: string;
};

const uid = () => Math.random().toString(36).slice(2);

function toolTitle(event: StreamEvent): string {
  const data = event.data ?? {};
  const state = (data.state ?? {}) as { title?: string };
  if (state.title) return state.title;
  const input = (data.input ?? {}) as { filePath?: string; description?: string; pattern?: string };
  if (input.filePath) return input.filePath;
  if (input.description) return input.description;
  if (input.pattern) return input.pattern;
  return 'Aksi agent';
}

/**
 * Wiring beneran: status → session → prompt → SSE stream → state → AgentPanel.
 * Semua event OpenCode disalurkan dari /api/ai/stream (proxy server) ke sini.
 */
export function AgentView({
  slug,
  projectTitle,
  activeFilePath,
}: {
  slug: string;
  projectTitle: string;
  activeFilePath: string | null;
}) {
  const t = useT();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState<boolean | null>(null); // null = belum dicek
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [waiting, setWaiting] = useState<{
    method: 'device' | 'link';
    url: string | null;
    code: string | null;
    callbackPort: string | null;
    done: boolean;
    running: boolean;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [permission, setPermission] = useState<PermissionCard | null>(null);
  const [models, setModels] = useState<ModelGroupView[]>([]);
  const [currentModel, setCurrentModel] = useState<ModelEntryView | null>(null);
  const [providerPicks, setProviderPicks] = useState<ProviderPickView[]>([]);
  const [usage, setUsage] = useState<{ input: number; output: number } | null>(null);
  const [capabilities, setCapabilities] = useState<{ websearch: boolean; literature: boolean } | null>(null);

  const sessionRef = useRef<string | null>(null);
  const assistantRef = useRef<string | null>(null); // assistantMessageID aktif
  const esRef = useRef<EventSource | null>(null);

  const pushSystem = useCallback((text: string) => {
    setMessages((prev) => [...prev, { id: uid(), role: 'system', text }]);
  }, []);

  // ── riwayat chat persisten + meter token (fase 2 sisa) ──────────────────────
  // Riwayat di-load sekali saat panel kebuka; live SSE nyusul menimpa state sama.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/ai/messages?slug=${encodeURIComponent(slug)}`);
        const data = (await res.json()) as {
          messages?: Array<{
            id: string;
            role: 'user' | 'assistant' | 'system';
            text: string;
            toolEvents?: Array<{ id: string; title: string; detail?: string; status: string }>;
            createdAt?: number;
          }>;
        };
        if (cancelled) return;
        // Multi-step agent = beberapa item assistant server-side; UI livestream
        // menampilkan SATU bubble. Jadi item assistant berurutan digabung di sini
        // (teks join, toolEvents concat) biar riwayat = bentuk live.
        const history: ChatMessage[] = [];
        for (const m of data.messages ?? []) {
          const events = (m.toolEvents ?? []).filter(
            (t): t is { id: string; title: string; detail?: string; status: 'running' | 'done' | 'error' } =>
              (t.status === 'running' || t.status === 'done' || t.status === 'error') && Boolean(t.title),
          );
          const last = history[history.length - 1];
          if (m.role === 'assistant' && last?.role === 'assistant') {
            history[history.length - 1] = {
              ...last,
              text: [last.text, m.text].filter(Boolean).join('\n\n'),
              toolEvents: [...(last.toolEvents ?? []), ...events],
            };
            continue;
          }
          history.push({ id: m.id, role: m.role, text: m.text, toolEvents: events });
        }
        // Gak nerobos obrolan yang udah jalan — cuma isi kalau masih kosong.
        setMessages((prev) => (prev.length > 0 ? prev : history));
      } catch {
        // riwayat gagal → mulai kosong, bukan error keras.
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const refreshUsage = useCallback(async () => {
    try {
      const res = await fetch(`/api/ai/usage?slug=${encodeURIComponent(slug)}`);
      const data = (await res.json()) as { tokens?: { input: number; output: number } | null };
      setUsage(data.tokens ?? null);
    } catch {
      setUsage(null);
    }
  }, [slug]);

  useEffect(() => {
    void refreshUsage();
  }, [refreshUsage]);

  // ── status awal ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch('/api/ai/status');
        const data = (await res.json()) as { connected?: boolean };
        if (!cancelled) setConnected(Boolean(data.connected));
      } catch {
        if (!cancelled) setConnected(false);
      }
    };
    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  const openStream = useCallback(
    (sid: string) => {
      esRef.current?.close();
      const es = new EventSource(`/api/ai/stream?sessionId=${encodeURIComponent(sid)}`);

      es.addEventListener('delta', (raw) => {
        const ev = JSON.parse((raw as MessageEvent).data) as StreamEvent;
        if (ev.type !== 'session.text.delta') return;
        const mid = String(ev.data?.assistantMessageID ?? '');
        const text = String(ev.data?.delta ?? '');
        if (!text) return;

        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant') {
            const copy = prev.slice(0, -1);
            copy.push({ ...last, text: last.text + text });
            return copy;
          }
          return [...prev, { id: uid(), role: 'assistant', text }];
        });
        assistantRef.current = mid;
      });

      es.addEventListener('tool-event', (raw) => {
        const ev = JSON.parse((raw as MessageEvent).data) as StreamEvent;
        const entry: ChatToolEvent = {
          id: String(ev.data?.id ?? uid()),
          title: toolTitle(ev),
          status:
            ev.type === 'session.tool.failed' ? 'error' : ev.type === 'session.tool.success' ? 'done' : 'running',
        };

        setMessages((prev) => {
          if (prev.length === 0) return [{ id: uid(), role: 'assistant', text: '', toolEvents: [entry] }];
          const last = prev[prev.length - 1];
          if (last?.role !== 'assistant') return [...prev, { id: uid(), role: 'assistant', text: '', toolEvents: [entry] }];
          const tools = [...(last.toolEvents ?? [])];
          const idx = tools.findIndex((tool) => tool.id === entry.id);
          if (idx >= 0) tools[idx] = entry;
          else tools.push(entry);
          return [...prev.slice(0, -1), { ...last, toolEvents: tools }];
        });
      });

      es.addEventListener('agent-event', (raw) => {
        const ev = JSON.parse((raw as MessageEvent).data) as StreamEvent;
        switch (ev.type) {
          case 'session.step.started':
          case 'session.execution.started':
            setBusy(true);
            break;
          case 'session.step.failed':
          case 'session.execution.failed':
            setBusy(false);
            break;
          case 'session.idle':
            setBusy(false);
            void refreshUsage();
            break;
          default:
            break;
        }
      });

      es.addEventListener('permission', (raw) => {
        const ev = JSON.parse((raw as MessageEvent).data) as StreamEvent;
        const data = ev.data as unknown as
          | { id?: string; action?: string; resources?: string[]; message?: string }
          | undefined;
        if (!data?.id) return;
        setPermission({
          requestId: data.id,
          action: data.action ?? 'aksi',
          resources: data.resources ?? [],
          message: data.message,
        });
      });

      es.addEventListener('fs-change', (raw) => {
        const ev = JSON.parse((raw as MessageEvent).data) as StreamEvent;
        if (ev.data?.file) {
          window.dispatchEvent(
            new CustomEvent('workspace:agent-change', { detail: { file: String(ev.data.file) } }),
          );
        }
      });

      esRef.current = es;
    },
    [refreshUsage],
  );

  // ── daftar model + pilihan tersimpan (refresh pas connect berubah) ───────────
  const refreshModels = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/models');
      const data = (await res.json()) as {
        groups?: ModelGroupView[];
        override?: { providerID: string; modelID: string; name: string } | null;
      };
      setModels(data.groups ?? []);
      setCurrentModel(data.override ?? null);
    } catch {
      setModels([]);
    }
  }, []);

  useEffect(() => {
    void refreshModels();
  }, [refreshModels, connected]);

  const selectModel = useCallback(
    async (model: ModelEntryView) => {
      setCurrentModel({ providerID: model.providerID, modelID: model.modelID, name: model.name });
      try {
        await fetch('/api/ai/models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            providerID: model.providerID,
            modelID: model.modelID,
            sessionId: sessionRef.current,
          }),
        });
      } catch {
        pushSystem('Gagal mengganti model.');
      }
    },
    [pushSystem],
  );

  // ── daftar integrasi popular + login/putus API key ───────────────────────────
  const refreshProviders = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/providers');
      const data = (await res.json()) as { picks?: ProviderPickView[] };
      setProviderPicks(data.picks ?? []);
    } catch {
      setProviderPicks([]);
    }
  }, []);

  useEffect(() => {
    void refreshProviders();
  }, [refreshProviders]);

  const connectProvider = useCallback(
    async (integrationID: string, key: string) => {
      try {
        const res = await fetch('/api/ai/providers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ integrationID, key }),
        });
        const data = (await res.json()) as { error?: string };
        if (data.error) {
          pushSystem(`Gagal nyambung ${integrationID}: ${data.error}`);
        } else {
          pushSystem(
            `${integrationID} nyambung — modelnya udah bisa dipilih di daftar atas. Catatan: kalau key salah, error baru kelihatan pas pertama ngechat.`,
          );
        }
      } catch {
        pushSystem(`Gagal nyambung ${integrationID}.`);
      }
      void refreshProviders();
      void refreshModels();
    },
    [pushSystem, refreshProviders, refreshModels],
  );

  const disconnectProvider = useCallback(
    async (integrationID: string) => {
      try {
        await fetch('/api/ai/providers', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ integrationID }),
        });
        pushSystem(`${integrationID} diputus.`);
      } catch {
        pushSystem(`Gagal memutus ${integrationID}.`);
      }
      void refreshProviders();
      void refreshModels();
    },
    [pushSystem, refreshProviders, refreshModels],
  );

  // ── panel Kemampuan AI (fase 2.5): toggle websearch/jurnal ───────────────────
  const refreshCapabilities = useCallback(async () => {
    try {
      const res = await fetch(`/api/ai/capabilities?slug=${encodeURIComponent(slug)}`);
      const data = (await res.json()) as { websearch?: boolean; literature?: boolean };
      setCapabilities({ websearch: Boolean(data.websearch), literature: Boolean(data.literature) });
    } catch {
      setCapabilities(null);
    }
  }, [slug]);

  useEffect(() => {
    void refreshCapabilities();
  }, [refreshCapabilities]);

  const toggleCapability = useCallback(
    (key: 'websearch' | 'literature', enabled: boolean) => {
      setCapabilities((prev) => ({ websearch: false, literature: false, ...prev, [key]: enabled }));
      void (async () => {
        try {
          const res = await fetch('/api/ai/capabilities', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slug, [key]: enabled }),
          });
          const data = (await res.json()) as { websearch?: boolean; literature?: boolean; error?: string };
          if (data.error) {
            pushSystem(`Gagal nyimpan kemampuan: ${data.error}`);
          } else {
            setCapabilities({ websearch: Boolean(data.websearch), literature: Boolean(data.literature) });
            pushSystem(
              enabled
                ? key === 'websearch'
                  ? 'Web search nyala — agent bisa pakai tool websearch.'
                  : 'Pencarian jurnal nyala — agent boleh manggil API OpenAlex/Crossref/Semantic Scholar.'
                : key === 'websearch'
                  ? 'Web search mati.'
                  : 'Pencarian jurnal mati.',
            );
          }
        } catch {
          pushSystem('Gagal nyimpan kemampuan.');
        }
      })();
    },
    [slug, pushSystem],
  );

  // ── ensure session per project + buka stream (JALAN TANPA LOGIN — model gratis) ──
  useEffect(() => {
    let cancelled = false;

    const ensure = async () => {
      try {
        const res = await fetch('/api/ai/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug }),
        });
        const data = (await res.json()) as { sessionId?: string; error?: string };
        if (cancelled) return;
        if (!res.ok || !data.sessionId) {
          pushSystem(`Gagal menyiapkan sesi agent: ${data.error ?? 'tidak diketahui'}`);
          return;
        }
        sessionRef.current = data.sessionId;
        setSessionReady(true);
        openStream(data.sessionId);
      } catch {
        if (!cancelled) pushSystem('Gagal terhubung ke server agent.');
      }
    };

    void ensure();
    return () => {
      cancelled = true;
      esRef.current?.close();
      esRef.current = null;
    };
  }, [slug, pushSystem, openStream]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;
      setSending(true);
      setBusy(true);
      assistantRef.current = null;
      setMessages((prev) => [...prev, { id: uid(), role: 'user', text: trimmed }]);

      try {
        const res = await fetch('/api/ai/prompt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug, sessionId: sessionRef.current, text: trimmed, activeFilePath }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !data.ok) {
          pushSystem(`Agent gagal dipanggil: ${data.error ?? 'tidak diketahui'}`);
          setBusy(false);
        }
      } catch {
        pushSystem('Gagal terhubung ke server.');
        setBusy(false);
      } finally {
        setSending(false);
      }
    },
    [activeFilePath, sending, slug, pushSystem],
  );

  const answerPermission = useCallback(
    async (decision: 'once' | 'reject') => {
      if (!permission) return;
      const card = permission;
      setPermission(null);
      pushSystem(decision === 'once' ? `Diizinkan: ${card.action}` : `Ditolak: ${card.action}`);
      try {
        await fetch('/api/ai/permission', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sessionRef.current, requestId: card.requestId, decision }),
        });
      } catch {
        pushSystem('Gagal memproses izin.');
      }
    },
    [permission, pushSystem],
  );

  const pollConnect = useCallback(() => {
    const timer = setInterval(async () => {
      try {
        const res = await fetch('/api/ai/connect');
        const data = (await res.json()) as {
          running?: boolean;
          method?: 'device' | 'link';
          url?: string | null;
          code?: string | null;
          callbackPort?: string | null;
          connected?: boolean;
          done?: boolean;
        };
        if (data.connected) {
          clearInterval(timer);
          setWaiting(null);
          setConnected(true);
          return;
        }
        setWaiting((prev) =>
          prev
            ? { ...prev, url: data.url ?? null, code: data.code ?? null, done: Boolean(data.done), running: Boolean(data.running) }
            : null,
        );
      } catch {
        clearInterval(timer);
      }
    }, 2_500);
  }, []);

  const connect = useCallback(
    async (mode: 'device' | 'link' = 'device', restart = false) => {
      try {
        const res = await fetch(
          `/api/ai/connect?method=${mode}${restart ? '&restart=1' : ''}`,
          { method: 'POST' },
        );
        const data = (await res.json()) as {
          url?: string | null;
          code?: string | null;
          callbackPort?: string | null;
          method?: 'device' | 'link';
          running?: boolean;
          done?: boolean;
        };
        setWaiting({
          method: data.method ?? mode,
          url: data.url ?? null,
          code: data.code ?? null,
          callbackPort: data.callbackPort ?? null,
          running: Boolean(data.running ?? true),
          done: Boolean(data.done),
        });
        setCopied(false);
        pollConnect();
      } catch {
        setWaiting(null);
      }
    },
    [pollConnect],
  );

  const copyAuth = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_800);
    } catch {
      // clipboard ditolak browser — biarin user salin manual
    }
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* Banner login "Sign in with ChatGPT" — dua mode wajib tahan-banting SSH */}
      {waiting && (
        <div className="shrink-0 space-y-2 border-b border-blue-200 bg-blue-50 px-3 py-2 text-[11px] text-blue-900 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-200">
          {waiting.method === 'device' ? (
            <>
              <p className="font-medium">{t('ai.deviceUrlLabel')}</p>
              {waiting.url && (
                <a href={waiting.url} target="_blank" rel="noreferrer" className="block break-all underline">
                  {waiting.url}
                </a>
              )}
              <p className="font-medium">{t('ai.deviceCode')}</p>
              <div className="flex items-center gap-2">
                <code className="rounded bg-white px-2 py-1 text-sm font-bold tracking-widest dark:bg-neutral-900">
                  {waiting.code ?? '…'}
                </code>
                {waiting.code && (
                  <button
                    type="button"
                    onClick={() => void copyAuth(waiting.code ?? '')}
                    className="rounded border border-blue-300 px-2 py-0.5 text-[10px] hover:bg-blue-100 dark:border-blue-700 dark:hover:bg-blue-900/50"
                  >
                    {copied ? t('ai.copiedLabel') : t('ai.copyLabel')}
                  </button>
                )}
              </div>
              <p className="opacity-70">{t('ai.deviceHint')}</p>
            </>
          ) : (
            <>
              <p className="font-medium">{t('ai.waitingAuth')}</p>
              {waiting.url && (
                <a href={waiting.url} target="_blank" rel="noreferrer" className="block break-all underline">
                  {waiting.url.slice(0, 96)}…
                </a>
              )}
              {waiting.callbackPort && (
                <p className="opacity-70">
                  Port callback: <b>{waiting.callbackPort}</b> — {t('ai.linkPortHint')}
                </p>
              )}
            </>
          )}
          <div className="flex gap-3 pt-1 text-[10px] underline opacity-80">
            <button type="button" onClick={() => void connect(waiting.method, true)}>
              {t('ai.restartAuth')}
            </button>
            <button
              type="button"
              onClick={() => void connect(waiting.method === 'device' ? 'link' : 'device', true)}
            >
              {waiting.method === 'device' ? t('ai.linkModeLabel') : t('ai.deviceModeLabel')}
            </button>
          </div>
        </div>
      )}

      <AgentPanel
        slug={slug}
        projectTitle={projectTitle}
        sessionReady={sessionReady}
        onEnsureSession={async () => undefined}
        messages={messages}
        sending={sending}
        onSend={(text) => void send(text)}
        activeFilePath={activeFilePath}
        connected={connected ?? false}
        onConnect={() => void connect()}
        busy={busy}
        models={models}
        currentModel={currentModel}
        onSelectModel={(model) => void selectModel(model)}
        usage={usage}
        capabilities={capabilities}
        onToggleCapability={toggleCapability}
        providerPicks={providerPicks}
        onProviderConnect={(integrationID, key) => connectProvider(integrationID, key)}
        onProviderDisconnect={(integrationID) => disconnectProvider(integrationID)}
      />

      {/* Kartu izin (agent minta akses) */}
      {permission && (
        <div className="absolute inset-x-2 bottom-16 z-30 rounded-lg border border-amber-300 bg-white p-3 text-xs shadow-lg dark:border-amber-700 dark:bg-neutral-900">
          <p className="mb-1 font-semibold">
            {t('ai.permissionAsk')} {permission.action}
          </p>
          <p className="mb-2 break-all text-neutral-500">
            {permission.resources.join(' · ') || permission.message || '…'}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => void answerPermission('reject')}>
              {t('ai.permissionReject')}
            </Button>
            <Button onClick={() => void answerPermission('once')}>{t('ai.permissionAllow')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
