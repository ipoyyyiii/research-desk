'use client';

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Check, ChevronDown, ChevronRight, FileText, SendHorizontal, SlidersHorizontal, Sparkles } from 'lucide-react';
import { useT } from '@/lib/preferences';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button, SegmentedGroup, StatusDot } from '@/components/ui';

// Panel kanan fase 2 (pratinjau UI — belum nyambung API; wiring nyata menyusul).

export type ModelEntryView = { providerID: string; modelID: string; name: string };
export type ModelGroupView = { providerID: string; label: string; free: boolean; models: ModelEntryView[] };
/** Satu integrasi popular di bagian "Login pakai API key" dropdown model. */
export type ProviderPickView = { integrationID: string; name: string; connected: boolean };

export type ChatToolEvent = {
  id: string;
  title: string;
  detail?: string;
  status: 'running' | 'done' | 'error';
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  /** Konten teks — saat streaming akan di-append terus oleh parent. */
  text: string;
  /** Timeline tool/actions milik pesan assistant ini. */
  toolEvents?: ChatToolEvent[];
};

export type AgentPanelProps = {
  slug: string;
  projectTitle: string;
  /** Sudah ada session agent untuk project ini? */
  sessionReady: boolean;
  /** Buat/mulai session (tombol "Mulai" kalau sessionReady=false). */
  onEnsureSession: () => Promise<void>;
  messages: ChatMessage[];
  sending: boolean;
  onSend: (text: string) => void;
  /** File yang terbuka di editor — disisipkan sebagai konteks. */
  activeFilePath: string | null;
  /** Auth OpenCode (mis. provider ChatGPT) sudah tersambung? */
  connected: boolean;
  onConnect: () => void;
  /** Agent sedang mengerjakan sesuatu (tampilkan bubble "mengetik…"). */
  busy: boolean;
  /** Tutup panel kanan — dipanggil dari tombol arrow di header panel. */
  onCollapse?: () => void;
  /** Model picker (fase 2): daftar model per provider + pilihan aktif. */
  models: ModelGroupView[];
  currentModel: ModelEntryView | null;
  onSelectModel: (model: ModelEntryView) => void;
  /** Login provider lain pakai API key (fase 2.5-lite). */
  providerPicks: ProviderPickView[];
  onProviderConnect: (integrationID: string, key: string) => Promise<void>;
  onProviderDisconnect: (integrationID: string) => Promise<void>;
  /** Meter token sesi (opsional — nanti di-wire agent-view); undefined → tampil "—". */
  usage?: { input: number; output: number } | null;
  /** Kemampuan AI (fase 2.5): toggle websearch/jurnal; null = belum ke-load. */
  capabilities: { websearch: boolean; literature: boolean } | null;
  onToggleCapability: (key: 'websearch' | 'literature', enabled: boolean) => void;
};

const TOOL_DOT_TONE: Record<ChatToolEvent['status'], 'green' | 'amber' | 'red'> = {
  running: 'amber',
  done: 'green',
  error: 'red',
};

/** Chip saran (fase 3.5): prompt cepat di atas input — key i18n `chat.suggest*`. */
const SUGGESTION_KEYS = ['chat.suggestProgress', 'chat.suggestJournals', 'chat.suggestReview'] as const;

function basename(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? path : path.slice(index + 1);
}

type ActivityFilter = 'all' | 'read-edit' | 'run';

const ACTIVITY_FILTERS: Array<{ value: ActivityFilter; key: string }> = [
  { value: 'all', key: 'ai.activityAll' },
  { value: 'read-edit', key: 'ai.activityReadEdit' },
  { value: 'run', key: 'ai.activityRun' },
];

/** Format token pendek: 842 → "842", 12.300 → "12.3k", 123.456 → "123k". */
function formatTokenCompact(value: number): string {
  if (value < 1000) return String(value);
  if (value < 10000) return `${(value / 1000).toFixed(1)}k`;
  return `${Math.round(value / 1000)}k`;
}

/** Filter chip → cocokkan kata kunci judul (API belum kasih field kind). */
function matchActivityFilter(event: ChatToolEvent, filter: ActivityFilter): boolean {
  if (filter === 'all') return true;
  const title = event.title.toLowerCase();
  return filter === 'read-edit'
    ? title.includes('baca') || title.includes('ubah')
    : title.includes('jalankan');
}

/** Detail tool kadang membawa konfirmasi kunci BibTeX "✓ <bibKey>" — itu ditampilkan
 * sebagai chip mono amber (aksen) biar gampang dilirik; teks lain tetap polos. */
function DetailText({ detail }: { detail: string }) {
  const index = detail.indexOf('✓');
  if (index === -1) return <>{detail}</>;
  return (
    <>
      {detail.slice(0, index)}
      <span className="font-mono text-accent">{detail.slice(index)}</span>
    </>
  );
}

/** Kartu timeline collapsible: header 1 baris, detail terbuka pas diklik. */
function ActivityCard({ event }: { event: ChatToolEvent }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="overflow-hidden rounded-md border border-border bg-muted/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left transition-colors hover:bg-muted"
      >
        <StatusDot tone={TOOL_DOT_TONE[event.status]} title={event.status} />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
          {event.title}
        </span>
        {event.detail && (
          <span className="min-w-0 max-w-[45%] shrink-0 truncate text-[10px] text-muted-foreground">
            <DetailText detail={event.detail} />
          </span>
        )}
        <ChevronDown size={11} className={`shrink-0 text-muted-foreground transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && event.detail && (
        <div className="border-t border-border px-2 py-1.5">
          <p className="whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-muted-foreground">
            <DetailText detail={event.detail} />
          </p>
        </div>
      )}
    </li>
  );
}

/** Baris kecil satu event tool (dot status + judul + detail). */
function ToolRow({ event }: { event: ChatToolEvent }) {
  return (
    <li className="flex items-start gap-1.5 rounded-md border border-border bg-muted/60 px-2 py-1">
      <span className="mt-1 shrink-0">
        <StatusDot tone={TOOL_DOT_TONE[event.status]} title={event.status} />
      </span>
      <span className="min-w-0 flex-1 text-[11px] leading-snug">
        <span className="font-medium text-foreground">{event.title}</span>
        {event.detail && (
          <span className="text-muted-foreground"> · <DetailText detail={event.detail} /></span>
        )}
      </span>
    </li>
  );
}

/** Respons AI gaya-Claude: full-width, tanpa gelembung, markdown rapi. */
function AssistantText({ text }: { text: string }) {
  return (
    <div className="w-full max-w-[92%] text-[13px] leading-relaxed text-card-foreground [&_a]:break-all [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-2 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:border [&_code]:border-border [&_code]:bg-muted [&_code]:px-1 [&_h1]:mt-2 [&_h1]:text-sm [&_h1]:font-semibold [&_h2]:mt-2 [&_h2]:text-[13px] [&_h2]:font-semibold [&_h3]:text-[13px] [&_h3]:font-medium [&_li]:my-0.5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:my-1 [&_pre]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:rounded-none [&_pre_code]:border-0 [&_pre_code]:bg-transparent [&_pre_code]:px-0 [&_strong]:font-semibold [&_table]:my-1 [&_table]:text-[11px] [&_td]:border [&_td]:border-border [&_td]:px-1.5 [&_td]:py-0.5 [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-1.5 [&_th]:py-0.5 [&_th]:font-medium [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === 'system') {
    return (
      <div className="px-4 text-center text-[11px] text-muted-foreground">{message.text}</div>
    );
  }

  const isUser = message.role === 'user';
  // User = gelembung navy rata kanan. AI = blok teks bersih full-width (tanpa
  // gelembung, markdown di-render) gaya Claude.
  if (isUser) {
    return (
      <div className="flex flex-col items-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-[13px] leading-relaxed text-primary-foreground">
          {message.text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-1">
      {message.text ? <AssistantText text={message.text} /> : null}
      {!isUser && (message.toolEvents?.length ?? 0) > 0 && (
        <details className="w-full">
          <summary className="cursor-pointer select-none py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground">
            ⚡ Aktivitas AI ({message.toolEvents?.length ?? 0} langkah)
          </summary>
          <ul className="mt-1 w-full space-y-1">
            {message.toolEvents?.map((event) => <ToolRow key={event.id} event={event} />)}
          </ul>
        </details>
      )}
    </div>
  );
}

export function AgentPanel({
  slug,
  projectTitle,
  sessionReady,
  onEnsureSession,
  messages,
  sending,
  onSend,
  activeFilePath,
  connected,
  onConnect,
  busy,
  onCollapse,
  models,
  currentModel,
  onSelectModel,
  providerPicks,
  onProviderConnect,
  onProviderDisconnect,
  usage,
  capabilities,
  onToggleCapability,
}: AgentPanelProps) {
  const t = useT();
  const [activeTab, setActiveTab] = useState<'chat' | 'activity'>('chat');
  const [draft, setDraft] = useState('');
  const [modelOpen, setModelOpen] = useState(false);
  /** Popover Kemampuan AI (fase 2.5). */
  const [capsOpen, setCapsOpen] = useState(false);
  /** Filter chip di tab Aktivitas (dipertahankan saat pindah-pindah tab). */
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all');
  /** Integrasi yang lagi dibuka form input key-nya (id, atau null). */
  const [keyOpenId, setKeyOpenId] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState('');
  const pickerRef = useRef<HTMLDivElement>(null);
  const capsRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Popover kemampuan ikut ketutup pas klik di luar-nya.
  useEffect(() => {
    if (!capsOpen) return;
    const onDown = (event: MouseEvent) => {
      if (capsRef.current && !capsRef.current.contains(event.target as Node)) setCapsOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [capsOpen]);

  // Dropdown model ketutup kalau klik di luar-nya.
  useEffect(() => {
    if (!modelOpen) return;
    const onDown = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) setModelOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [modelOpen]);

  // Ganti project → draft dibersihkan (chat/session itu per project).
  useEffect(() => {
    setDraft('');
  }, [slug]);

  // Pesan baru / streaming / busy → tetap di ekor daftar.
  useEffect(() => {
    if (activeTab === 'chat' && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, busy, activeTab]);

  const canSend = !sending && draft.trim() !== '';
  // Timeline dikelompokkan per pesan assistant, pesan terbaru dulu → event baru nongol di atas.
  const activityGroups: Array<{ message: ChatMessage; events: ChatToolEvent[] }> = [];
  for (const message of [...messages].reverse()) {
    const events = message.role === 'assistant' ? message.toolEvents ?? [] : [];
    if (events.length > 0) activityGroups.push({ message, events });
  }
  const visibleGroups = activityGroups
    .map((group) => ({ ...group, events: group.events.filter((event) => matchActivityFilter(event, activityFilter)) }))
    .filter((group) => group.events.length > 0);
  const visibleCount = visibleGroups.reduce((total, group) => total + group.events.length, 0);

  const submitDraft = () => {
    const text = draft.trim();
    if (!text || sending) return;
    onSend(text);
    setDraft('');
  };

  // Enter = kirim, Shift+Enter = baris baru; isComposing guard biar IME aman.
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submitDraft();
    }
  };

  // Chip saran: isi draft + fokus ke textarea. Gak auto-kirim — user yang
  // menekan Enter (jujur & aman, pesannya masih bisa diedit).
  const applySuggestion = (text: string) => {
    setDraft(text);
    textareaRef.current?.focus();
  };

  return (
    <aside className="flex h-full flex-col border-l border-border bg-background">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border bg-card px-2">
        <Sparkles size={13} className="shrink-0 text-accent" />
        <SegmentedGroup
          options={[
            { value: 'chat', label: t('ai.chat') },
            { value: 'activity', label: t('ai.activity') },
          ]}
          active={activeTab}
          onSelect={(value) => setActiveTab(value as 'chat' | 'activity')}
        />
        <span
          className="ml-auto min-w-0 max-w-28 truncate font-serif text-sm font-semibold tracking-tight text-foreground"
          title={projectTitle}
        >
          {projectTitle}
        </span>
        <div ref={pickerRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setModelOpen((v) => !v)}
            className={`flex items-center gap-0.5 rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] transition-colors ${
              currentModel ? 'text-primary' : 'text-muted-foreground'
            }`}
            title={t('ai.models')}
          >
            <span className="max-w-20 truncate">{currentModel?.name ?? t('ai.autoModel')}</span>
            <ChevronDown size={11} />
          </button>
          {modelOpen && (
            <div className="absolute right-0 top-8 z-40 max-h-72 w-64 overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-lg">
              {models.length === 0 && (
                <p className="px-2 py-2 text-[11px] text-muted-foreground">{t('ai.modelsEmpty')}</p>
              )}
              {models.map((group) => (
                <div key={group.providerID} className="mb-0.5">
                  <p className="px-2 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                    {group.label}
                  </p>
                  {group.models.map((model) => {
                    const active =
                      currentModel?.providerID === model.providerID && currentModel?.modelID === model.modelID;
                    return (
                      <button
                        key={`${model.providerID}/${model.modelID}`}
                        type="button"
                        onClick={() => {
                          onSelectModel(model);
                          setModelOpen(false);
                        }}
                        className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[11px] transition-colors ${
                          active
                            ? 'bg-primary/10 text-primary'
                            : 'text-foreground hover:bg-muted'
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate">{model.name}</span>
                        {active && <Check size={11} className="shrink-0 text-primary" />}
                      </button>
                    );
                  })}
                </div>
              ))}
              {/* Login provider lain pakai API key — langsung dari dropdown. */}
              {providerPicks.length > 0 && (
                <div className="mt-0.5 border-t border-border px-1 pt-1">
                  <p className="px-1 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                    {t('ai.providersLogin')}
                  </p>
                  {providerPicks.map((pick) => {
                    const open = keyOpenId === pick.integrationID;
                    return (
                      <div key={pick.integrationID}>
                        <div className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-muted">
                          <StatusDot
                            tone={pick.connected ? 'green' : 'idle'}
                            title={pick.connected ? t('ai.providerConnected') : t('ai.providerNotConnected')}
                          />
                          <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">
                            {pick.name}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setKeyOpenId(open ? null : pick.integrationID);
                              setKeyDraft('');
                            }}
                            disabled={Boolean(keyOpenId) && !open}
                            className="rounded px-1.5 py-0.5 text-[10px] text-primary transition-colors hover:bg-primary/10 disabled:opacity-40"
                          >
                            {open ? t('ai.providerCancel') : pick.connected ? t('ai.providerReplace') : t('ai.providerConnect')}
                          </button>
                          {pick.connected && (
                            <button
                              type="button"
                              onClick={() => {
                                if (window.confirm(t('ai.providerDisconnectConfirm').replace('{name}', pick.name))) {
                                  void onProviderDisconnect(pick.integrationID);
                                  setModelOpen(false);
                                }
                              }}
                              className="rounded px-1.5 py-0.5 text-[10px] text-destructive transition-colors hover:bg-destructive/10"
                            >
                              {t('ai.providerDisconnect')}
                            </button>
                          )}
                        </div>
                        {open && (
                          <div className="flex items-center gap-1 px-1 py-1">
                            <input
                              autoFocus
                              type="password"
                              value={keyDraft}
                              onChange={(e) => setKeyDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && keyDraft.trim()) {
                                  void onProviderConnect(pick.integrationID, keyDraft.trim());
                                  setKeyDraft('');
                                  setKeyOpenId(null);
                                }
                                if (e.key === 'Escape') setKeyOpenId(null);
                              }}
                              placeholder={t('ai.providerKeyPlaceholder')}
                              className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
                            />
                            <button
                              type="button"
                              disabled={!keyDraft.trim()}
                              onClick={() => {
                                void onProviderConnect(pick.integrationID, keyDraft.trim());
                                setKeyDraft('');
                                setKeyOpenId(null);
                              }}
                              className="shrink-0 rounded-lg bg-primary px-2 py-1 text-[10px] text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {t('ai.providerSave')}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <p className="px-1 pb-1 text-[9px] leading-snug text-muted-foreground">{t('ai.providerKeyHint')}</p>
                </div>
              )}
              <p className="border-t border-border px-2 py-1.5 text-[10px] leading-snug text-muted-foreground">
                {t('ai.providersNote')}
              </p>
            </div>
          )}
        </div>
        <div ref={capsRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setCapsOpen((v) => !v)}
            className={`flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-[10px] transition-colors ${
              capsOpen
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-muted text-muted-foreground'
            }`}
            title={t('ai.capabilities')}
          >
            <SlidersHorizontal size={11} />
          </button>
          {capsOpen && (
            <div className="absolute right-0 top-8 z-40 w-64 rounded-lg border border-border bg-card p-1 shadow-lg">
              <p className="px-2 py-1 text-[10px] font-medium text-muted-foreground">
                {t('ai.capabilities')}
              </p>
              {(
                [
                  { key: 'websearch', title: t('ai.capWebsearch'), desc: t('ai.capWebsearchDesc') },
                  { key: 'literature', title: t('ai.capLiterature'), desc: t('ai.capLiteratureDesc') },
                ] as const
              ).map((item) => {
                const on = capabilities?.[item.key] ?? false;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => onToggleCapability(item.key, !on)}
                    className="flex w-full items-start gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-muted"
                  >
                    <span
                      className={`mt-0.5 flex h-4 w-7 shrink-0 items-center rounded-full px-0.5 transition-colors ${
                        on ? 'bg-primary justify-end' : 'bg-muted justify-start'
                      }`}
                    >
                      <span className="h-3 w-3 rounded-full bg-card" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[11px] font-medium text-foreground">
                        {item.title}
                      </span>
                      <span className="block text-[10px] leading-snug text-muted-foreground">{item.desc}</span>
                    </span>
                  </button>
                );
              })}
              <p className="border-t border-border px-2 py-1.5 text-[10px] leading-snug text-muted-foreground">
                {t('ai.capabilitiesNote')}
              </p>
            </div>
          )}
        </div>
        {/* Meter token sesi: total in+out; usage belum ke-wire → "—". */}
        <span
          className="shrink-0 rounded-md border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground"
          title={
            usage
              ? `Masuk ${formatTokenCompact(usage.input)} · Keluar ${formatTokenCompact(usage.output)}`
              : t('ai.usageTokens')
          }
        >
          {t('ai.usageTokens')} <span className="font-mono">{usage ? formatTokenCompact(usage.input + usage.output) : '—'}</span>
        </span>
        <StatusDot
          tone={connected ? 'green' : 'amber'}
          title={t(connected ? 'ai.connected' : 'ai.disconnected')}
        />
        {/* Tutup panel kanan — arrow menunjuk keluar (kanan). */}
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            aria-label={t('layout.rightClose')}
            title={t('layout.rightClose')}
            className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <ChevronRight size={12} />
          </button>
        )}
      </div>

      {activeTab === 'chat' ? (
        <>
          {!connected && (
            // Belum login provider Plus → chat tetap jalan (model gratis); CTA ramping di atas.
            <div className="flex shrink-0 items-center gap-2 border-b border-accent/40 bg-accent/10 px-2.5 py-1.5 text-[11px] text-foreground">
              <span className="min-w-0 flex-1 leading-snug">{t('ai.freeBanner')}</span>
              <Button
                variant="outline"
                className="shrink-0 px-2 py-0.5 text-[11px]"
                onClick={onConnect}
              >
                {t('ai.connect')}
              </Button>
            </div>
          )}
          {/* Banner status session */}
          <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-border px-2.5">
            <StatusDot tone="idle" />
            <span
              className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground"
              title={projectTitle}
            >
              {sessionReady ? t('ai.sessionReady') : projectTitle}
            </span>
            {!sessionReady && (
              <Button
                variant="outline"
                className="px-2 py-0.5 text-xs"
                onClick={() => void onEnsureSession()}
              >
                {t('ai.startSession')}
              </Button>
            )}
          </div>

          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2.5">
            {messages.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">{t('ai.empty')}</p>
            ) : (
              <div className="space-y-2.5">
                {messages.map((message) => <MessageBubble key={message.id} message={message} />)}
                {busy && (
                  <div className="flex justify-start" role="status" aria-label={t('ai.typing')}>
                    <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-muted-foreground">
                      <span className="typing-dots">
                        <span />
                        <span />
                        <span />
                      </span>
                      <span className="text-[10px]">{t('ai.typing')}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <form
            className="border-t border-border bg-card p-2.5"
            onSubmit={(event) => {
              event.preventDefault();
              submitDraft();
            }}
          >
            {/* Chip saran (fase 3.5): isi draft + fokus, gak auto-kirim. */}
            {!busy && (
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {t('chat.suggestLabel')}
                </span>
                {SUGGESTION_KEYS.map((key) => {
                  const text = t(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => applySuggestion(text)}
                      className="cursor-pointer rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
                    >
                      {text}
                    </button>
                  );
                })}
              </div>
            )}
            {activeFilePath && (
              <div
                className="mb-1.5 flex max-w-full items-center gap-1 self-start rounded-full border border-border bg-muted/60 px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
                title={activeFilePath}
              >
                <FileText size={11} className="shrink-0" />
                <span className="min-w-0 truncate">{t('ai.contextFile', { file: basename(activeFilePath) })}</span>
              </div>
            )}
            <div className="flex items-end gap-1.5">
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('ai.placeholder')}
                rows={2}
                className="min-h-0 max-h-28 flex-1 resize-none rounded-xl border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
              />
              <button
                type="submit"
                disabled={!canSend}
                className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
              >
                <SendHorizontal size={14} />
                {t('ai.send')}
              </button>
            </div>
          </form>
        </>
      ) : (
        // Tab Aktivitas: chip filter + timeline collapsible (grup per pesan, terbaru di atas).
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-1 border-b border-border bg-card px-2.5 py-1.5">
            {ACTIVITY_FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setActivityFilter(item.value)}
                className={`rounded-full px-2 py-0.5 text-[10px] transition-colors ${
                  activityFilter === item.value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {t(item.key)}
              </button>
            ))}
            <span className="ml-auto rounded-full border border-border bg-muted/60 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
              {t('ai.activitySteps', { n: visibleCount, count: visibleCount })}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2.5">
            {activityGroups.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-muted-foreground">{t('ai.activityEmpty')}</p>
            ) : (
              <div className="space-y-3">
                {visibleGroups.map((group) => (
                  <section key={group.message.id}>
                    <p
                      className="mb-1 truncate px-0.5 text-[9px] uppercase tracking-wide text-muted-foreground"
                      title={group.message.text}
                    >
                      {group.message.text}
                    </p>
                    <ul className="space-y-1.5">
                      {group.events.map((event) => <ActivityCard key={event.id} event={event} />)}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
