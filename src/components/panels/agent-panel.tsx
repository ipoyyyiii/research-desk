'use client';

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Check, ChevronDown, FileText, SendHorizontal, Sparkles } from 'lucide-react';
import { useT } from '@/lib/preferences';
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
  /** Model picker (fase 2): daftar model per provider + pilihan aktif. */
  models: ModelGroupView[];
  currentModel: ModelEntryView | null;
  onSelectModel: (model: ModelEntryView) => void;
  /** Login provider lain pakai API key (fase 2.5-lite). */
  providerPicks: ProviderPickView[];
  onProviderConnect: (integrationID: string, key: string) => Promise<void>;
  onProviderDisconnect: (integrationID: string) => Promise<void>;
};

const TOOL_DOT_TONE: Record<ChatToolEvent['status'], 'green' | 'amber' | 'red'> = {
  running: 'amber',
  done: 'green',
  error: 'red',
};

function basename(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? path : path.slice(index + 1);
}

/** Baris kecil satu event tool (dot status + judul + detail). */
function ToolRow({ event }: { event: ChatToolEvent }) {
  return (
    <li className="flex items-start gap-1.5 rounded-md bg-neutral-50 px-2 py-1 dark:bg-neutral-800/60">
      <span className="mt-1 shrink-0">
        <StatusDot tone={TOOL_DOT_TONE[event.status]} title={event.status} />
      </span>
      <span className="min-w-0 flex-1 text-[11px] leading-snug">
        <span className="font-medium text-neutral-700 dark:text-neutral-200">{event.title}</span>
        {event.detail && <span className="text-neutral-400 dark:text-neutral-500"> · {event.detail}</span>}
      </span>
    </li>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === 'system') {
    return (
      <div className="px-4 text-center text-[11px] text-neutral-400 dark:text-neutral-500">{message.text}</div>
    );
  }

  const isUser = message.role === 'user';
  return (
    <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
      <div
        className={
          isUser
            ? 'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-blue-600/15 px-3 py-1.5 text-[13px] leading-relaxed text-neutral-900 dark:bg-blue-400/15 dark:text-neutral-50'
            : 'max-w-[90%] whitespace-pre-wrap break-words rounded-2xl rounded-bl-sm bg-neutral-100 px-3 py-1.5 text-[13px] leading-relaxed text-neutral-800 dark:bg-neutral-800/70 dark:text-neutral-100'
        }
      >
        {message.text}
      </div>
      {!isUser && (message.toolEvents?.length ?? 0) > 0 && (
        <ul className="mt-1 w-full space-y-1">
          {message.toolEvents?.map((event) => <ToolRow key={event.id} event={event} />)}
        </ul>
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
  models,
  currentModel,
  onSelectModel,
  providerPicks,
  onProviderConnect,
  onProviderDisconnect,
}: AgentPanelProps) {
  const t = useT();
  const [activeTab, setActiveTab] = useState<'chat' | 'activity'>('chat');
  const [draft, setDraft] = useState('');
  const [modelOpen, setModelOpen] = useState(false);
  /** Integrasi yang lagi dibuka form input key-nya (id, atau null). */
  const [keyOpenId, setKeyOpenId] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState('');
  const pickerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

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
  const activityEvents = messages.flatMap((message) =>
    message.role === 'assistant' ? message.toolEvents ?? [] : [],
  );

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

  return (
    <aside className="flex h-full flex-col border-l border-neutral-200 bg-neutral-50/60 dark:border-neutral-800 dark:bg-neutral-900/40">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-neutral-200 px-2 dark:border-neutral-800">
        <Sparkles size={13} className="shrink-0 text-neutral-400" />
        <SegmentedGroup
          options={[
            { value: 'chat', label: t('ai.chat') },
            { value: 'activity', label: t('ai.activity') },
          ]}
          active={activeTab}
          onSelect={(value) => setActiveTab(value as 'chat' | 'activity')}
        />
        <span
          className="ml-auto min-w-0 max-w-20 truncate text-[10px] text-neutral-400"
          title={projectTitle}
        >
          {projectTitle}
        </span>
        <div ref={pickerRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setModelOpen((v) => !v)}
            className="flex items-center gap-0.5 rounded-md border border-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-600 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            title={t('ai.models')}
          >
            <span className="max-w-20 truncate">{currentModel?.name ?? t('ai.autoModel')}</span>
            <ChevronDown size={11} />
          </button>
          {modelOpen && (
            <div className="absolute right-0 top-8 z-40 max-h-72 w-64 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
              {models.length === 0 && (
                <p className="px-2 py-2 text-[11px] text-neutral-400">{t('ai.modelsEmpty')}</p>
              )}
              {models.map((group) => (
                <div key={group.providerID} className="mb-0.5">
                  <p className="px-2 py-0.5 text-[9px] uppercase tracking-wide text-neutral-400">
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
                            ? 'bg-blue-50 text-blue-900 dark:bg-blue-950/40 dark:text-blue-200'
                            : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800'
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate">{model.name}</span>
                        {active && <Check size={11} className="shrink-0 text-blue-600 dark:text-blue-400" />}
                      </button>
                    );
                  })}
                </div>
              ))}
              {/* Login provider lain pakai API key — langsung dari dropdown. */}
              {providerPicks.length > 0 && (
                <div className="mt-0.5 border-t border-neutral-100 px-1 pt-1 dark:border-neutral-800">
                  <p className="px-1 py-0.5 text-[9px] uppercase tracking-wide text-neutral-400">
                    {t('ai.providersLogin')}
                  </p>
                  {providerPicks.map((pick) => {
                    const open = keyOpenId === pick.integrationID;
                    return (
                      <div key={pick.integrationID}>
                        <div className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/60">
                          <StatusDot
                            tone={pick.connected ? 'green' : 'idle'}
                            title={pick.connected ? t('ai.providerConnected') : t('ai.providerNotConnected')}
                          />
                          <span className="min-w-0 flex-1 truncate text-[11px] text-neutral-700 dark:text-neutral-200">
                            {pick.name}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setKeyOpenId(open ? null : pick.integrationID);
                              setKeyDraft('');
                            }}
                            disabled={Boolean(keyOpenId) && !open}
                            className="rounded px-1.5 py-0.5 text-[10px] text-blue-700 transition-colors hover:bg-blue-50 disabled:opacity-40 dark:text-blue-300 dark:hover:bg-blue-950/40"
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
                              className="rounded px-1.5 py-0.5 text-[10px] text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
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
                              className="min-w-0 flex-1 rounded border border-neutral-200 bg-white px-2 py-1 text-[11px] outline-none focus:border-blue-400 dark:border-neutral-700 dark:bg-neutral-900"
                            />
                            <button
                              type="button"
                              disabled={!keyDraft.trim()}
                              onClick={() => {
                                void onProviderConnect(pick.integrationID, keyDraft.trim());
                                setKeyDraft('');
                                setKeyOpenId(null);
                              }}
                              className="shrink-0 rounded bg-blue-600 px-2 py-1 text-[10px] text-white transition-colors hover:bg-blue-700 disabled:opacity-40"
                            >
                              {t('ai.providerSave')}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <p className="px-1 pb-1 text-[9px] leading-snug text-neutral-400">{t('ai.providerKeyHint')}</p>
                </div>
              )}
              <p className="border-t border-neutral-100 px-2 py-1.5 text-[10px] leading-snug text-neutral-400 dark:border-neutral-800">
                {t('ai.providersNote')}
              </p>
            </div>
          )}
        </div>
        <StatusDot
          tone={connected ? 'green' : 'amber'}
          title={t(connected ? 'ai.connected' : 'ai.disconnected')}
        />
      </div>

      {activeTab === 'chat' ? (
        <>
          {!connected && (
            // Belum login provider Plus → chat tetap jalan (model gratis); CTA ramping di atas.
            <div className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
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
          <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-neutral-200 px-2.5 dark:border-neutral-800">
            <StatusDot tone="idle" />
            <span
              className="min-w-0 flex-1 truncate text-[11px] text-neutral-500 dark:text-neutral-400"
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
              <p className="px-2 py-4 text-center text-xs text-neutral-400">{t('ai.empty')}</p>
            ) : (
              <div className="space-y-2.5">
                {messages.map((message) => <MessageBubble key={message.id} message={message} />)}
                {busy && (
                  <div className="flex justify-start" role="status" aria-label={t('ai.typing')}>
                    <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm bg-neutral-100 px-3 py-2 text-neutral-400 dark:bg-neutral-800/70 dark:text-neutral-500">
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
            className="border-t border-neutral-200 p-2.5 dark:border-neutral-800"
            onSubmit={(event) => {
              event.preventDefault();
              submitDraft();
            }}
          >
            {activeFilePath && (
              <div
                className="mb-1.5 flex max-w-full items-center gap-1 self-start rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                title={activeFilePath}
              >
                <FileText size={11} className="shrink-0" />
                <span className="min-w-0 truncate">{t('ai.contextFile', { file: basename(activeFilePath) })}</span>
              </div>
            )}
            <div className="flex items-end gap-1.5">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('ai.placeholder')}
                rows={2}
                className="min-h-0 max-h-28 flex-1 resize-none rounded-md border border-neutral-300 bg-transparent px-2.5 py-1.5 text-[13px] outline-none transition-colors placeholder:text-neutral-400 focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-neutral-200"
              />
              <Button type="submit" disabled={!canSend}>
                <SendHorizontal size={14} />
                {t('ai.send')}
              </Button>
            </div>
          </form>
        </>
      ) : (
        // Tab Aktivitas: timeline semua event tool dari pesan assistant.
        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2.5">
          {activityEvents.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-neutral-400">{t('ai.activityEmpty')}</p>
          ) : (
            <ul className="space-y-1.5">
              {activityEvents.map((event) => (
                <li key={event.id} className="rounded-md border border-neutral-200 dark:border-neutral-800">
                  <ToolRow event={event} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}
