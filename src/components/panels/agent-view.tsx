'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AgentPanel, type ChatMessage, type ChatToolEvent } from '@/components/panels/agent-panel';
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
  const [waitingUrl, setWaitingUrl] = useState<string | null>(null);
  const [permission, setPermission] = useState<PermissionCard | null>(null);

  const sessionRef = useRef<string | null>(null);
  const assistantRef = useRef<string | null>(null); // assistantMessageID aktif
  const esRef = useRef<EventSource | null>(null);

  const pushSystem = useCallback((text: string) => {
    setMessages((prev) => [...prev, { id: uid(), role: 'system', text }]);
  }, []);

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
    [],
  );

  // ── ensure session per project + buka stream ────────────────────────────────
  useEffect(() => {
    if (!connected) return;
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
  }, [slug, connected, pushSystem, openStream]);

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
          url?: string | null;
          connected?: boolean;
          done?: boolean;
        };
        setWaitingUrl(data.url ?? null);
        if (data.connected) {
          clearInterval(timer);
          setWaitingUrl(null);
          setConnected(true);
          return;
        }
        if (data.done && !data.running) {
          clearInterval(timer);
          if (!data.url) setWaitingUrl(null);
        }
      } catch {
        clearInterval(timer);
      }
    }, 2_500);
  }, []);

  const connect = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/connect', { method: 'POST' });
      const data = (await res.json()) as { url?: string | null };
      if (data.url) setWaitingUrl(data.url);
      pollConnect();
    } catch {
      setWaitingUrl(null);
    }
  }, [pollConnect]);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* Banner "Sign in dengan link" saat proses koneksi berjalan */}
      {waitingUrl && (
        <div className="shrink-0 border-b border-blue-200 bg-blue-50 px-3 py-2 text-[11px] text-blue-900 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-200">
          <p className="mb-1 font-medium">{t('ai.waitingAuth')}</p>
          <a href={waitingUrl} target="_blank" rel="noreferrer" className="break-all underline">
            {waitingUrl.slice(0, 96)}…
          </a>
          <p className="mt-1 opacity-70">{t('ai.waitingAuthHint')}</p>
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
