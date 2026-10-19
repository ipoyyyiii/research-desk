'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ArrowUp, Check, ChevronDown, FileText, Info, Loader2, Plus, X } from 'lucide-react';
import { usePreferences, useT } from '@/lib/preferences';
import { sortVariants, VARIANT_LABEL_KEYS } from '@/lib/ai/effort';
import { StatusDot } from '@/components/ui';

// Komposer input AI ala Codex (ss2.png): card rounded-xl dengan textarea atas,
// baris bawah [+] · pill model ▾ · pill effort ▾ · tombol kirim ↑ (bulat).
// GAK ADA mic/voice. Popover model dipindah ke sini dari header panel.

export type ModelEntryView = { providerID: string; modelID: string; name: string; variants: string[] };
export type ModelGroupView = { providerID: string; label: string; free: boolean; models: ModelEntryView[] };
/** Satu integrasi popular di bagian "Login pakai API key" dropdown model. */
export type ProviderPickView = { integrationID: string; name: string; connected: boolean };

/** Satu sesi agent directory project — dipakai picker Sessions + slash menu. */
export type AgentSessionView = { id: string; title: string; timeCreated: number };

/** Item slash menu: buat sesi baru atau pindah ke sesi yang sudah ada. */
type SlashItem = { kind: 'new' } | { kind: 'session'; id: string; title: string; timeCreated: number };

/** Stempel waktu pendek sesi: "mm-dd hh:mm" lokal (kasar cukup utk picker). */
export function formatSessionTime(timeCreated: number): string {
  if (!timeCreated) return '';
  const date = new Date(timeCreated);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Satu lampiran yang sudah ter-upload ke project (relatif dari folder project). */
export type AgentAttachment = { id: string; name: string; path: string; size: number };

export type AgentComposerProps = {
  draft: string;
  onDraftChange: (draft: string) => void;
  onSubmit: () => void;
  sending: boolean;
  busy: boolean;
  /** Prompt cepat — sudah ditranslate di parent (key `chat.suggest*`). */
  suggestions: string[];
  suggestLabel: string;
  /** File yang terbuka di editor — disisipkan sebagai konteks. */
  activeFilePath: string | null;
  attachments: AgentAttachment[];
  /** Upload lampiran sedang jalan → [+] jadi spinner. */
  uploading: boolean;
  /** Pesan error upload — tampil di baris hint. */
  uploadError: string | null;
  onPickFiles: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  /** Model picker (dipindah dari header panel). */
  models: ModelGroupView[];
  currentModel: ModelEntryView | null;
  onSelectModel: (model: ModelEntryView) => void;
  /** Login provider lain pakai API key. */
  providerPicks: ProviderPickView[];
  onProviderConnect: (integrationID: string, key: string) => Promise<void>;
  onProviderDisconnect: (integrationID: string) => Promise<void>;
  /** Multi-sesi ala OpenCode: daftar sesi directory utk menu slash ("/"). */
  sessions: AgentSessionView[];
  activeSessionId: string | null;
  /** Buat sesi baru (slash menu / picker). */
  onCreateSession: () => void;
  /** Pindah ke sesi lain (slash menu / picker). */
  onSwitchSession: (sessionId: string) => void;
  /** Pindah/buat sesi masih berjalan → slash menu cuma baca. */
  switching: boolean;
};

const SUGGESTIONS_SEEN_KEY = 'research-desk:chat-suggestions-seen';

/** Label effort: variant yang dikenali → i18n; id eksotik dari server tetap
 * ditampilkan apa adanya (jujur, gak ngarang level). */
const effortLabel = (id: string, t: (key: string) => string): string => {
  const key = VARIANT_LABEL_KEYS[id];
  return key ? t(key) : id;
};

function basename(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? path : path.slice(index + 1);
}

/** Ukuran file pendek: 842 B → 842, 2048 → 2 KB, 3.2 MB → 3.2 MB. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AgentComposer({
  draft,
  onDraftChange,
  onSubmit,
  sending,
  busy,
  suggestions,
  suggestLabel,
  activeFilePath,
  attachments,
  uploading,
  uploadError,
  onPickFiles,
  onRemoveAttachment,
  sessions,
  activeSessionId,
  onCreateSession,
  onSwitchSession,
  switching,
  models,
  currentModel,
  onSelectModel,
  providerPicks,
  onProviderConnect,
  onProviderDisconnect,
}: AgentComposerProps) {
  const t = useT();
  const { aiEffort, setAiEffort } = usePreferences();
  const [modelOpen, setModelOpen] = useState(false);
  const [effortOpen, setEffortOpen] = useState(false);
  /** Integrasi yang lagi dibuka form input key-nya (id, atau null). */
  const [keyOpenId, setKeyOpenId] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState('');
  /** null = localStorage belum kebaca (biar gak flash); false = saran tampil pertama kali. */
  const [suggestionsSeen, setSuggestionsSeen] = useState<boolean | null>(null);

  const pickerRef = useRef<HTMLDivElement>(null);
  const effortRef = useRef<HTMLDivElement>(null);
  const slashRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /** Slash menu "/" (multi-sesi ala OpenCode): item "Sesi baru" + daftar sesi buat resume. */
  const [slashClosed, setSlashClosed] = useState(false);
  const [slashHighlight, setSlashHighlight] = useState(0);

  const trimmedDraft = draft.trim();
  // Terbuka pas draft (trim) mulai '/' — slashClosed = tutup sementara (Esc/klik-diluar).
  const slashOpen = !slashClosed && trimmedDraft.startsWith('/') && !switching;
  const slashItems: SlashItem[] = [
    { kind: 'new' },
    ...sessions.map((session): SlashItem => ({
      kind: 'session',
      id: session.id,
      title: session.title,
      timeCreated: session.timeCreated,
    })),
  ];
  const clampedHighlight = Math.min(slashHighlight, slashItems.length - 1);

  const runSlash = (item: SlashItem) => {
    setSlashClosed(true);
    setSlashHighlight(0);
    onDraftChange('');
    if (switching) return; // guard ganda — parent juga jaga
    if (item.kind === 'new') onCreateSession();
    else onSwitchSession(item.id);
  };

  // Chip saran muncul cuma SEKALI seumur hidup browser (bukan per project):
  // pertama kali mount → tampilkan + tandai '1'; ✕ dismiss juga set '1'.
  useEffect(() => {
    let seen = true;
    try {
      seen = localStorage.getItem(SUGGESTIONS_SEEN_KEY) === '1';
      if (!seen) localStorage.setItem(SUGGESTIONS_SEEN_KEY, '1');
    } catch {
      seen = true; // privat mode — jangan ganggu
    }
    setSuggestionsSeen(seen);
  }, []);

  // Popover model ketutup kalau klik di luar-nya.
  useEffect(() => {
    if (!modelOpen) return;
    const onDown = (event: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) setModelOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [modelOpen]);

  // Popover effort idem.
  useEffect(() => {
    if (!effortOpen) return;
    const onDown = (event: MouseEvent) => {
      if (effortRef.current && !effortRef.current.contains(event.target as Node)) setEffortOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [effortOpen]);

  // Slash menu ketutup kalau klik di luar-nya — textarea DI DALAM wrapper, jadi
  // mengetik/bertahan fokus gak menutup menu; klik area lain menutup.
  useEffect(() => {
    if (!slashOpen) return;
    const onDown = (event: MouseEvent) => {
      if (slashRef.current && !slashRef.current.contains(event.target as Node)) setSlashClosed(true);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [slashOpen]);

  // Draft keluar dari area '/' → tutup-sementara/resor di-reset (menu bisa buka lagi).
  useEffect(() => {
    if (!trimmedDraft.startsWith('/')) {
      setSlashClosed(false);
      setSlashHighlight(0);
    }
  }, [trimmedDraft]);

  // Sorotan mulai dari item pertama tiap menu dibuka.
  useEffect(() => {
    if (slashOpen) setSlashHighlight(0);
  }, [slashOpen]);

  // ── Effort: level ASLI dari variant model aktif (server OpenCode) ──────────
  // `currentModel` bawa daftar variant sendiri; tanpa cap buatan. Model tanpa
  // variant → pill effort disembunyikan (sama seperti OpenCode).
  const variantOptions = useMemo(() => sortVariants(currentModel?.variants ?? []), [currentModel]);
  const selected: string | null = aiEffort !== null && variantOptions.includes(aiEffort) ? aiEffort : null;
  const sliderMax = Math.max(variantOptions.length - 1, 1);
  const sliderValue = selected ? Math.max(variantOptions.indexOf(selected), 0) : 0;
  const fillPct = (sliderValue / sliderMax) * 100;

  const canSend = !sending && !busy && (draft.trim() !== '' || attachments.length > 0);
  const showHint = uploading || attachments.length > 0 || Boolean(uploadError);
  const showSuggestions = suggestionsSeen === false && !busy && suggestions.length > 0;

  const handleSubmit = () => {
    if (!canSend) return;
    onSubmit(); // parent merangkai <lampiranPaths> + reset draft/attachments.
  };

  // Enter = kirim, Shift+Enter = baris baru; isComposing guard biar IME aman.
  // Menu slash terbuka → panah navigasi item, Enter jalan item tersorot, Esc tutup.
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSlashHighlight((prev) => Math.min(prev + 1, slashItems.length - 1));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSlashHighlight((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setSlashClosed(true);
        return;
      }
      if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
        event.preventDefault();
        const target = slashItems[Math.min(slashHighlight, slashItems.length - 1)];
        if (target) runSlash(target);
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      handleSubmit();
    }
  };

  return (
    <>
      {/* Chip saran (fase 3.5): pertama kali aja — isi draft + fokus, gak auto-kirim. */}
      {showSuggestions && (
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{suggestLabel}</span>
          {suggestions.map((text) => (
            <button
              key={text}
              type="button"
              onClick={() => {
                onDraftChange(text);
                textareaRef.current?.focus();
              }}
              className="cursor-pointer rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors [transition-property:color,background-color] hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {text}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSuggestionsSeen(true)}
            aria-label={t('composer.dismiss')}
            title={t('composer.dismiss')}
            className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors [transition-property:color,background-color] hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X size={11} />
          </button>
        </div>
      )}

      <form
        className="rounded-xl border border-border bg-card p-2 shadow-sm"
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
      >
        {/* Chip file aktif di editor */}
        {activeFilePath && (
          <div
            className="mb-1.5 flex max-w-full items-center gap-1 self-start rounded-full border border-border bg-muted/60 px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
            title={activeFilePath}
          >
            <FileText size={11} className="shrink-0" />
            <span className="min-w-0 truncate">{t('ai.contextFile', { file: basename(activeFilePath) })}</span>
          </div>
        )}

        {/* Chip lampiran + hint (tampil/hilang halus) */}
        {attachments.length > 0 && (
          <ul className="mb-1 flex flex-wrap items-start gap-1">
            {attachments.map((attachment) => (
              <li
                key={attachment.id}
                className="flex max-w-full items-center gap-1 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11px]"
                title={attachment.path}
              >
                <FileText size={11} className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 max-w-36 truncate text-foreground">{attachment.name}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{formatSize(attachment.size)}</span>
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(attachment.id)}
                  aria-label={t('composer.remove')}
                  title={t('composer.remove')}
                  className="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors [transition-property:color,background-color] hover:bg-muted hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X size={10} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div
          aria-hidden={!showHint}
          className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
            showHint ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
          }`}
        >
          <p
            className={`col-start-1 row-start-1 min-h-0 overflow-hidden text-[10px] leading-snug ${
              uploadError ? 'text-destructive' : 'text-muted-foreground'
            }`}
          >
            {uploadError ?? t('composer.attachHint')}
          </p>
        </div>

        <div ref={slashRef} className="relative">
          {/* Menu slash "/": header kecil + "Sesi baru" + daftar sesi buat resume. */}
          {slashOpen && (
            <div className="absolute bottom-full left-0 z-50 mb-1 w-64 rounded-lg border border-border bg-card p-1 shadow-lg">
              <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('composer.slashTitle')}
              </p>
              {slashItems.map((item, index) => {
                const activeItem = item.kind === 'session' && item.id === activeSessionId;
                const stateClass = activeItem
                  ? 'bg-primary/10 text-primary'
                  : index === clampedHighlight
                    ? 'bg-muted text-foreground'
                    : 'text-foreground hover:bg-muted';
                const className = `flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-[11px] transition-colors ${
                  stateClass
                }${switching ? ' pointer-events-none opacity-50' : ''}`;
                if (item.kind === 'new') {
                  return (
                    <button key="new" type="button" onClick={() => runSlash(item)} className={className}>
                      <Plus size={12} className="shrink-0 text-accent" />
                      <span className="min-w-0 flex-1 truncate font-medium">{t('agent.sessionNew')}</span>
                    </button>
                  );
                }
                return (
                  <button key={item.id} type="button" onClick={() => runSlash(item)} className={className}>
                    <span className="min-w-0 flex-1 truncate">{item.title || item.id.slice(0, 10)}</span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {formatSessionTime(item.timeCreated)}
                    </span>
                    {item.id === activeSessionId && <Check size={11} className="shrink-0 text-primary" />}
                  </button>
                );
              })}
              {sessions.length === 0 && (
                <p className="px-2 py-1.5 text-[10px] leading-snug text-muted-foreground">
                  {t('agent.sessionsEmpty')}
                </p>
              )}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('ai.placeholder')}
            rows={2}
            className="block min-h-0 max-h-28 w-full resize-none bg-transparent px-1 py-1 text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>

        {/* Baris bawah ala Codex: [+] · (gap) · pill model ▾ · pill effort ▾ · ↑ */}
        <div className="mt-1 flex items-center gap-1.5">
          <label
            title={t('composer.attach')}
            className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors [transition-property:color,background-color] hover:bg-muted hover:text-foreground"
          >
            <input
              type="file"
              multiple
              accept="image/*,.pdf,.docx,.doc,.xlsx,.txt,.md,.bib"
              aria-label={t('composer.attach')}
              className="sr-only"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = ''; // boleh upload nama sama dua kali
                if (files.length > 0) onPickFiles(files);
              }}
            />
            {uploading ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
          </label>

          {/* Pill pilih model (popover dipindah sini; tetap ada login API key) */}
          <div
            ref={pickerRef}
            className="relative ml-auto min-w-0 shrink-0"
            onKeyDown={(event) => {
              if (event.key === 'Escape') setModelOpen(false);
            }}
          >
            <button
              type="button"
              onClick={() => setModelOpen((v) => !v)}
              aria-expanded={modelOpen}
              title={t('composer.selectModel')}
              className={`flex h-7 items-center gap-1 rounded-full border border-border bg-muted/60 px-2 text-[11px] transition-colors [transition-property:color,background-color,border-color] hover:bg-muted ${
                currentModel ? 'text-foreground' : 'text-muted-foreground'
              }`}
            >
              <span className="max-w-24 truncate">{currentModel?.name ?? t('composer.selectModel')}</span>
              <ChevronDown size={10} />
            </button>
            {modelOpen && (
              <div className="absolute bottom-9 right-0 z-50 max-h-72 w-64 overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-lg">
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
                            active ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted'
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
                            <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">{pick.name}</span>
                            <button
                              type="button"
                              onClick={() => {
                                setKeyOpenId(open ? null : pick.integrationID);
                                setKeyDraft('');
                              }}
                              disabled={Boolean(keyOpenId) && !open}
                              className="cursor-pointer rounded px-1.5 py-0.5 text-[10px] text-primary transition-colors disabled:opacity-40 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {open
                                ? t('ai.providerCancel')
                                : pick.connected
                                  ? t('ai.providerReplace')
                                  : t('ai.providerConnect')}
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
                                className="cursor-pointer rounded px-1.5 py-0.5 text-[10px] text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                                className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                              />
                              <button
                                type="button"
                                disabled={!keyDraft.trim()}
                                onClick={() => {
                                  void onProviderConnect(pick.integrationID, keyDraft.trim());
                                  setKeyDraft('');
                                  setKeyOpenId(null);
                                }}
                                className="shrink-0 cursor-pointer rounded-lg bg-primary px-2 py-1 text-[10px] text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                {t('ai.providerSave')}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <p className="px-1 pb-1 text-[9px] leading-snug text-muted-foreground">
                      {t('ai.providerKeyHint')}
                    </p>
                  </div>
                )}
                <p className="border-t border-border px-2 py-1.5 text-[10px] leading-snug text-muted-foreground">
                  {t('ai.providersNote')}
                </p>
              </div>
            )}
          </div>

          {/* Pill pilih effort — level ASLI dari variant model aktif (server).
              Model tanpa variant → pill disembunyikan (sama seperti OpenCode). */}
          {variantOptions.length > 0 && (
          <div
            ref={effortRef}
            className="relative shrink-0"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setEffortOpen(false);
                textareaRef.current?.focus(); // fokus balik ke drafting biar gak nyangkut di slider
              }
            }}
          >
            <button
              type="button"
              onClick={() => setEffortOpen((v) => !v)}
              aria-expanded={effortOpen}
              title={t('composer.selectEffort')}
              className="flex h-7 shrink-0 items-center gap-1 rounded-full border border-border bg-muted/60 px-2 text-[11px] text-muted-foreground transition-colors [transition-property:color,background-color,border-color] hover:bg-muted hover:text-foreground"
            >
              <span className="max-w-20 truncate">
                {selected ? effortLabel(selected, t) : t('composer.selectEffort')}
              </span>
              <ChevronDown size={10} />
            </button>
            {effortOpen && (
              <div className="absolute bottom-9 right-0 z-50 w-56 rounded-xl border border-border bg-card p-3 shadow-lg">
                <p className="text-center text-sm font-medium text-primary">
                  {selected ? effortLabel(selected, t) : t('composer.selectEffort')}
                </p>
                <p className="mt-1 flex items-center justify-center gap-1 text-[10px] leading-snug text-muted-foreground">
                  <Info size={11} className="shrink-0 text-accent" />
                  {t('settings.effortNote')}
                </p>
                <input
                  type="range"
                  min={0}
                  max={sliderMax}
                  step={1}
                  value={sliderValue}
                  aria-label={t('composer.selectEffort')}
                  onChange={(event) => {
                    const variant = variantOptions[Number(event.target.value) % variantOptions.length] ?? null;
                    setAiEffort(variant);
                  }}
                  style={{
                    backgroundImage: `linear-gradient(to right, var(--primary) ${fillPct}%, var(--border) ${fillPct}%)`,
                  }}
                  className="mt-3 block h-1.5 w-full cursor-pointer appearance-none rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-sm [&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-transparent [&::-webkit-slider-thumb]:mt-[-4px] [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-border [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-sm"
                />
              </div>
            )}
          </div>
          )}

          {/* Kirim ↑ bulat — disabled saat kosong/busy */}
          <button
            type="submit"
            disabled={!canSend}
            aria-label={t('composer.send')}
            title={t('composer.send')}
            className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground transition-[opacity,transform] duration-150 hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowUp size={14} />
          </button>
        </div>
      </form>
    </>
  );
}
