'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
} from 'lucide-react';
import {
  AgentPanel,
  type AgentSessionView,
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

/** Payload form dari tool `question` (probe Lane C 2026-10-19):
 * event `form.created` data.form — metadata.kind = "question". */
type QuestionFormPayload = {
  id: string;
  title?: string;
  fields?: Array<{
    key?: string;
    title?: string;
    description?: string;
    type?: string;
    options?: Array<{ value?: string; label?: string; description?: string }>;
    custom?: boolean;
  }>;
};

type QuestionOption = { value: string; label: string; description?: string };

type QuestionField = {
  key: string;
  question: string;
  type: string;
  options: QuestionOption[];
  custom: boolean;
};

type QuestionCard = {
  id: string;
  fields: QuestionField[];
  status: 'pending' | 'answered' | 'cancelled';
  /** jawaban bertahap sebelum semua question-field selesai dijawab */
  partial?: Record<string, string>;
  /** ringkasan jawaban yang dikirim (label opsi / teks bebas) */
  answer?: string;
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

/** Event `form.created` → pertanyaan + opsi untuk kartu. Field type lain
 * (bool/number/bg-apa) tetap bisa dijawab via opsi/freetext; multiselect
 * dijawab via teks bebas (pisah koma) — UI pilih-multi belum ada. */
function mapFormFields(fields: QuestionFormPayload['fields']): QuestionField[] {
  const out: QuestionField[] = [];
  for (const field of fields ?? []) {
    if (typeof field?.key !== 'string') continue;
    out.push({
      key: field.key,
      question: field.description ?? field.title ?? field.key,
      type: field.type ?? 'string',
      options: (field.options ?? [])
        .filter((option): option is QuestionOption => typeof option?.value === 'string' && typeof option?.label === 'string')
        .map((option) => ({ value: option.value, label: option.label, ...(option.description ? { description: option.description } : {}) })),
      custom: Boolean(field.custom),
    });
  }
  return out;
}

/** Label opsi terpilih (atau teks bebas) — untuk kartu "Sudah dijawab". */
function answerLabel(fields: QuestionField[], answers: Record<string, string>): string {
  const parts: string[] = [];
  for (const field of fields) {
    const value = answers[field.key];
    if (value === undefined) continue;
    const matched = field.options.find((option) => option.value === value || option.label === value);
    parts.push(matched ? matched.label : value);
  }
  return parts.join(' · ');
}

/**
 * Wiring beneran: status → session → prompt → SSE stream → state → AgentPanel.
 * Semua event OpenCode disalurkan dari /api/ai/stream (proxy server) ke sini.
 */
export function AgentView({
  slug,
  projectTitle,
  activeFilePath,
  onCollapse,
}: {
  slug: string;
  projectTitle: string;
  activeFilePath: string | null;
  onCollapse?: () => void;
}) {
  const t = useT();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState<boolean | null>(null); // null = belum dicek
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  // ── multi-sesi ala OpenCode (picker Sessions + slash menu) ───────────────────
  const [sessions, setSessions] = useState<AgentSessionView[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
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
  const [question, setQuestion] = useState<QuestionCard | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
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
  // Mapping juga dipakai pas ganti sesi (picker Sessions) → bentuk identik.
  /** Payload /api/ai/messages → ChatMessage[]. Multi-step agent = beberapa item
   * assistant server-side; UI livestream menampilkan SATU bubble, jadi item
   * assistant berurutan digabung (teks join, toolEvents concat). */
  const mapHistory = useCallback(
    (data: {
      messages?: Array<{
        id: string;
        role: 'user' | 'assistant' | 'system';
        text: string;
        toolEvents?: Array<{ id: string; title: string; detail?: string; status: string }>;
        createdAt?: number;
      }>;
    }) => {
      const history: ChatMessage[] = [];
      for (const item of data.messages ?? []) {
        const events = (item.toolEvents ?? []).filter(
          (event): event is { id: string; title: string; detail?: string; status: 'running' | 'done' | 'error' } =>
            (event.status === 'running' || event.status === 'done' || event.status === 'error') &&
            Boolean(event.title),
        );
        const last = history[history.length - 1];
        if (item.role === 'assistant' && last?.role === 'assistant') {
          history[history.length - 1] = {
            ...last,
            text: [last.text, item.text].filter(Boolean).join('\n\n'),
            toolEvents: [...(last.toolEvents ?? []), ...events],
          };
          continue;
        }
        history.push({ id: item.id, role: item.role, text: item.text, toolEvents: events });
      }
      return history;
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/ai/messages?slug=${encodeURIComponent(slug)}`);
        const data = (await res.json()) as Parameters<typeof mapHistory>[0];
        if (cancelled) return;
        // Gak nerobos obrolan yang udah jalan — cuma isi kalau masih kosong.
        setMessages((prev) => (prev.length > 0 ? prev : mapHistory(data)));
      } catch {
        // riwayat gagal → mulai kosong, bukan error keras.
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [slug, mapHistory]);

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

  // ── daftar sesi multi-sesi (picker Sessions strip + slash menu composer) ─────
  const refreshSessions = useCallback(async () => {
    try {
      const res = await fetch(`/api/ai/sessions?slug=${encodeURIComponent(slug)}`);
      const data = (await res.json()) as {
        sessionId?: string | null;
        sessions?: AgentSessionView[];
      };
      setSessions(data.sessions ?? []);
      setActiveSessionId(data.sessionId ?? null);
    } catch {
      setSessions([]); // list gagal → picker kosong, ambil/chat utama nggak ganggu.
    }
  }, [slug]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

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
      // Sesi ganti → kartu pertanyaan milik sesi lama jangan bocor; kartu yang
      // masih pending di sesi aktif dihidupkan ulang lewat restorePendingQuestion.
      setQuestion(null);
      setDrafts({});
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

      // Route meluluskan event 'error' (punya data). Kalau kena, turn mati → jangan
      // biarkan indikator "ngetik" menjadi zombie selamanya.
      es.addEventListener('error', (raw) => {
        try {
          const data = JSON.parse((raw as MessageEvent).data) as { message?: string } | undefined;
          if (!data?.message) return; // kesalahan koneksi asli → EventSource coba sambungkan kembali sendiri
          setBusy(false);
        } catch {
          // bukan pesan aplikasi — biarkan sambungkan kembali
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

      // Pertanyaan agent (tool `question`): form dibuat / dijawab / dibatalkan.
      // Kartu pertanyaan: pilih opsi pill atau jawab bebas; reply via
      // POST /api/ai/question (session.form.reply/cancel) — TIDAK mengunci turn.
      es.addEventListener('question', (raw) => {
        const ev = JSON.parse((raw as MessageEvent).data) as StreamEvent;
        if (ev.type === 'form.created') {
          const form = (ev.data as { form?: QuestionFormPayload } | undefined)?.form;
          if (!form?.id) return;
          const mapped = mapFormFields(form.fields);
          if (mapped.length === 0) return;
          setQuestion({ id: form.id, fields: mapped, status: 'pending' });
        } else if (ev.type === 'form.replied') {
          const replied = ev.data as { id?: string; answer?: Record<string, unknown> } | undefined;
          const formID = replied?.id ?? '';
          const answer = (replied?.answer ?? {}) as Record<string, string>;
          setQuestion((prev) =>
            prev && prev.id === formID && prev.status !== 'answered'
              ? { ...prev, status: 'answered', answer: answerLabel(prev.fields, answer), partial: undefined }
              : prev,
          );
        } else if (ev.type === 'form.cancelled') {
          const formID = (ev.data as { id?: string } | undefined)?.id ?? '';
          setQuestion((prev) =>
            prev && prev.id === formID && prev.status === 'pending' ? { ...prev, status: 'cancelled' } : prev,
          );
        }
      });

      esRef.current = es;
    },
    [refreshUsage],
  );

  // ── kartu pertanyaan (tool `question`): kirim jawaban ke form OpenCode ───────
  /** POST /api/ai/question → session.form.reply; gagal → kartu balik pending.
   * Teks yang muncul di kartu = label opsi/teks yang user pilih. */
  const submitAnswers = useCallback(
    async (form: QuestionCard, answers: Record<string, string>) => {
      const sid = sessionRef.current;
      if (!sid) return;
      const coerced: Record<string, string | number | boolean | string[]> = {};
      for (const field of form.fields) {
        const raw = answers[field.key];
        if (raw === undefined) continue;
        coerced[field.key] =
          field.type === 'boolean'
            ? raw === 'true'
            : field.type === 'number' || field.type === 'integer'
              ? Number(raw)
              : field.type === 'multiselect'
                ? raw.split(',').map((part) => part.trim()).filter(Boolean)
                : raw;
      }
      const text = answerLabel(form.fields, answers);
      setQuestion((prev) => (prev?.id === form.id ? { ...prev, status: 'answered', answer: text, partial: undefined } : prev));
      try {
        const res = await fetch('/api/ai/question', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sid, formId: form.id, answer: coerced }),
        });
        if (!res.ok) {
          const payload = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? String(res.status));
        }
      } catch {
        pushSystem(t('err.server'));
        setQuestion((prev) => (prev?.id === form.id ? { ...form, status: 'pending', partial: answers } : prev));
      }
    },
    [pushSystem, t],
  );

  /** Klik opsi / kirim teks bebas pada satu question-field. Reply baru jalan
   * pas SEMUA pertanyaan di form udah ada jawabannya (probe: form multi-field
   * jawabannya satu record). */
  const answerField = useCallback(
    (fieldKey: string, value: string) => {
      const form = question;
      if (!form || form.status !== 'pending') return;
      const next = { ...(form.partial ?? {}), [fieldKey]: value };
      setDrafts((prev) => ({ ...prev, [fieldKey]: '' }));
      if (form.fields.every((field) => field.key in next)) {
        void submitAnswers(form, next);
        return;
      }
      setQuestion({ ...form, partial: next });
    },
    [question, submitAnswers],
  );

  /** Lewati tanpa jawaban → session.form.cancel; agent nerima tool error dan
   * turn tetap lanjut (bukti probe: gak ada turn gantung). */
  const skipQuestion = useCallback(
    async () => {
      const form = question;
      if (!form || form.status !== 'pending') return;
      setQuestion({ ...form, status: 'cancelled' });
      try {
        const res = await fetch('/api/ai/question', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: sessionRef.current, formId: form.id, cancel: true, message: 'User skip' }),
        });
        if (!res.ok) throw new Error(String(res.status));
      } catch {
        pushSystem(t('err.server'));
      }
    },
    [question, pushSystem, t],
  );

  /** Tab refresh / ganti sesi → kartu pertanyaan yang masih pending dihidupkan
   * ulang dari server (soal turn gantung gak nyembunyiin pertanyaan). */
  const restorePendingQuestion = useCallback(async (sid: string) => {
    try {
      const res = await fetch(`/api/ai/question?sessionId=${encodeURIComponent(sid)}`);
      const data = (await res.json()) as { forms?: QuestionFormPayload[] };
      const form = (data.forms ?? [])[0];
      const mapped = form?.id ? mapFormFields(form.fields) : [];
      if (form?.id && mapped.length > 0) {
        setQuestion({ id: form.id, fields: mapped, status: 'pending' });
      }
    } catch {
      // restore gagal → event berikutnya akan menampilkan kartu.
    }
  }, []);

  // ── daftar model + pilihan tersimpan (refresh pas connect berubah) ───────────
  const refreshModels = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/models');
      const data = (await res.json()) as {
        groups?: ModelGroupView[];
        override?: ModelEntryView | null;
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
      // Optimis + bawa variant effort milik model ini (variants field).
      setCurrentModel(model);
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
        pushSystem(t('err.model'));
      }
    },
    [pushSystem, t],
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
          pushSystem(t('err.caps'));
        }
      })();
    },
    [slug, pushSystem, t],
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
          pushSystem(t('err.sessionPrep', { r: data.error ?? t('err.unknown') }));
          return;
        }
        sessionRef.current = data.sessionId;
        setSessionReady(true);
        setActiveSessionId(data.sessionId);
        openStream(data.sessionId);
        void restorePendingQuestion(data.sessionId);
        void refreshSessions();
      } catch {
        if (!cancelled) pushSystem(t('err.agentServer'));
      }
    };

    void ensure();
    return () => {
      cancelled = true;
      esRef.current?.close();
      esRef.current = null;
    };
  }, [slug, pushSystem, openStream, t, refreshSessions, restorePendingQuestion]);

  // ── aksi multi-sesi: buat sesi baru / ganti sesi (picker + slash menu) ────────
  /** "Sesi baru" → create fresh + bind + bersihkan obrolan + buka stream baru. */
  const createSession = useCallback(async () => {
    if (switching) return;
    setSwitching(true);
    try {
      const res = await fetch('/api/ai/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, createNew: true }),
      });
      const data = (await res.json()) as { sessionId?: string; error?: string };
      if (!res.ok || !data.sessionId) {
        pushSystem(t('err.sessionPrep', { r: data.error ?? t('err.unknown') }));
        return;
      }
      sessionRef.current = data.sessionId;
      setActiveSessionId(data.sessionId);
      assistantRef.current = null;
      setBusy(false);
      setMessages([]); // sesi baru = obrolan kosong
      openStream(data.sessionId);
      void restorePendingQuestion(data.sessionId);
      void refreshUsage();
      void refreshSessions();
    } catch {
      pushSystem(t('err.agentServer'));
    } finally {
      setSwitching(false);
    }
  }, [switching, slug, pushSystem, t, openStream, restorePendingQuestion, refreshUsage, refreshSessions]);

  /** Ganti sesi aktif → bind ke project → rebuild history dari sesi itu. */
  const switchSession = useCallback(
    async (targetId: string) => {
      if (switching || targetId === activeSessionId) return;
      setSwitching(true);
      try {
        const res = await fetch('/api/ai/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug, sessionId: targetId }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !data.ok) {
          pushSystem(t('err.sessionPrep', { r: data.error ?? t('err.unknown') }));
          return;
        }
        // Riwayat sesi target digabung dulu (stream bloh nyusul sesudahnya —
        // openStream tutup ES lama; event sesi lama juga disaring by sessionID).
        try {
          const msgRes = await fetch(`/api/ai/messages?slug=${encodeURIComponent(slug)}`);
          const payload = (await msgRes.json()) as Parameters<typeof mapHistory>[0];
          setMessages(mapHistory(payload));
        } catch {
          setMessages([]);
        }
        sessionRef.current = targetId;
        setActiveSessionId(targetId);
        assistantRef.current = null;
        setBusy(false);
        openStream(targetId);
        void restorePendingQuestion(targetId);
        void refreshUsage();
        void refreshSessions();
      } catch {
        pushSystem(t('err.agentServer'));
      } finally {
        setSwitching(false);
      }
    },
    [switching, activeSessionId, slug, pushSystem, t, mapHistory, openStream, restorePendingQuestion, refreshUsage, refreshSessions],
  );

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
          pushSystem(t('err.agentCall', { r: data.error ?? t('err.unknown') }));
          setBusy(false);
        }
      } catch {
        pushSystem(t('err.server'));
        setBusy(false);
      } finally {
        setSending(false);
      }
    },
    [activeFilePath, sending, slug, pushSystem, t],
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
        pushSystem(t('err.permission'));
      }
    },
    [permission, pushSystem, t],
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
    async (mode: 'device' | 'link' = 'device', restart = false, force = false) => {
      try {
        const res = await fetch(
          `/api/ai/connect?method=${mode}${restart ? '&restart=1' : ''}${force ? '&force=1' : ''}`,
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
        onCollapse={onCollapse}
        sessionReady={sessionReady}
        onEnsureSession={async () => undefined}
        messages={messages}
        sending={sending}
        onSend={(text) => void send(text)}
        activeFilePath={activeFilePath}
        connected={connected ?? false}
        onConnect={() => void connect('device', false, true)}
        onReconnect={() => void connect('device', false, true)}
        onModelPicked={(providerID, modelID) => {
          const entry = models
            .flatMap((group) => group.models)
            .find((model) => model.providerID === providerID && model.modelID === modelID);
          if (entry) void selectModel(entry);
          void refreshModels();
        }}
        onDoctorResult={(usable) => {
          // Gak ada satu pun model yang bisa dipakai -> jangan ngaku "terhubung".
          if (!usable) setConnected(false);
        }}
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
        sessions={sessions}
        activeSessionId={activeSessionId}
        switching={switching}
        onCreateSession={() => void createSession()}
        onSwitchSession={(id) => void switchSession(id)}
      />

      {/* Kartu pertanyaan + izin (agent nanya opsi via tool `question`, atau minta akses).
          Ditaruh di area chat (di atas composer); kartu = UI saja, reply jalan via route —
          TIDAK ada mekanisme yang menahan turn di browser. */}
      {(question || permission) && (
        <div className="absolute inset-x-2 bottom-16 z-30 space-y-2">
          {question && (
            <div
              className={`rounded-lg border bg-card p-3 text-xs shadow-lg transition-colors [transition-property:border-color] ${
                question.status === 'pending' ? 'border-primary/60' : 'border-border'
              }`}
            >
              <p className="mb-1 font-semibold">{t('question.title')}</p>
              {question.status === 'pending' && (
                <div className="space-y-3">
                  {question.fields.map((field) => {
                    const draft = drafts[field.key] ?? '';
                    return (
                      <div key={field.key}>
                        <p className="mb-1 text-foreground">{field.question}</p>
                        {field.options.length > 0 && field.type !== 'multiselect' && (
                          <div className="space-y-1.5">
                            {field.options.map((option) => (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() => answerField(field.key, option.value)}
                                className="block w-full cursor-pointer rounded-lg border border-border bg-background px-3 py-1.5 text-left transition-colors [transition-property:color,background-color,border-color] hover:border-primary/40 hover:bg-muted"
                              >
                                <span className="font-medium">{option.label}</span>
                                {option.description && (
                                  <span className="text-muted-foreground"> · {option.description}</span>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                        {/* Jawaban bebas: opt-in `custom` dari form, ATAU field tanpa
                            opsi pilihan sama sekali. Boolean dijawab lewat pill Ya/Tidak. */}
                        {field.type !== 'boolean' && (field.custom || field.options.length === 0) && (
                          <form
                            className="mt-1.5 flex items-center gap-1.5"
                            onSubmit={(event) => {
                              event.preventDefault();
                              const value = draft.trim();
                              if (!value) return;
                              answerField(field.key, field.type === 'multiselect' ? value.split(',').join(', ') : value);
                            }}
                          >
                            <input
                              value={draft}
                              onChange={(event) =>
                                setDrafts((prev) => ({ ...prev, [field.key]: event.target.value }))
                              }
                              placeholder={t('question.freePh')}
                              inputMode={field.type === 'number' || field.type === 'integer' ? 'numeric' : 'text'}
                              className="w-full rounded-md border border-border bg-transparent px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                            <button
                              type="submit"
                              aria-label={t('composer.send')}
                              title={t('composer.send')}
                              className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md bg-primary text-primary-foreground transition-colors [transition-property:color,background-color] hover:bg-primary/90"
                            >
                              <ArrowUp size={14} />
                            </button>
                          </form>
                        )}
                        {field.type === 'boolean' && (
                          <div className="space-y-1.5">
                            {[
                              { value: 'true', label: t('question.yes') },
                              { value: 'false', label: t('question.no') },
                            ].map((option) => (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() => answerField(field.key, option.value)}
                                className="block w-full cursor-pointer rounded-lg border border-border bg-background px-3 py-1.5 text-left transition-colors [transition-property:color,background-color,border-color] hover:border-primary/40 hover:bg-muted"
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => void skipQuestion()}
                      className="cursor-pointer rounded px-2 py-1 text-[11px] text-muted-foreground transition-colors [transition-property:color,background-color] hover:bg-muted hover:text-foreground"
                    >
                      {t('question.skip')}
                    </button>
                  </div>
                </div>
              )}
              {question.status === 'answered' && (
                <p className="text-muted-foreground">
                  {t('question.answered')}: <span className="font-medium text-foreground">{question.answer}</span>
                </p>
              )}
              {question.status === 'cancelled' && (
                <p className="text-muted-foreground">{t('question.expired')}</p>
              )}
            </div>
          )}
          {permission && (
            <div className="rounded-lg border border-amber-300 bg-white p-3 text-xs shadow-lg dark:border-amber-700 dark:bg-neutral-900">
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
      )}
    </div>
  );
}
