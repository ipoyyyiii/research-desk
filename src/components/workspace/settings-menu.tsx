'use client';

import { useEffect, useRef, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { usePreferences, type Theme } from '@/lib/preferences';
import { EFFORT_LEVELS, maxModelEffort, type EffortLevel } from '@/lib/ai/effort';

/**
 * Menu Settings ala Claude: tombol gear di header → dropdown (Bahasa, Tema,
 * Effort AI). Semua state dari PreferencesContext; tanpa props (biar gampang
 * dimount di shell). Pilih ga nge-tutup menu — biar bisa nyoba-nyoba dulu.
 */

// Dasar aria/label i18n (effort.tLabel): map ke key dictionary yang sudah ada.
const EFFORT_LABEL_KEY: Record<EffortLevel, string> = {
  auto: 'settings.effortAuto',
  low: 'settings.effortLow',
  medium: 'settings.effortMedium',
  high: 'settings.effortHigh',
  xhigh: 'settings.effortXHigh',
  max: 'settings.effortMax',
};

const THEMES: Theme[] = ['light', 'dark', 'system'];

const THEME_LABEL_KEY: Record<Theme, string> = {
  light: 'settings.themeLight',
  dark: 'settings.themeDark',
  system: 'settings.themeSystem',
};

const rank = (level: EffortLevel) => EFFORT_LEVELS.indexOf(level); // 'auto' = 0

/** Chip satu pilihan (button asli + aria-pressed, ala SegmentedGroup tapi token repo). */
function Chip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`h-6 cursor-pointer rounded-md px-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
      }`}
    >
      {label}
    </button>
  );
}

export function SettingsMenu() {
  const { locale, theme, aiEffort, t, setLocale, setTheme, setAiEffort } = usePreferences();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Cap effort dari model aktif: settings.agentModelOverride ("providerID/modelID")
  // dibaca dari /api/settings; gagal/unknown → 'high'.
  const [cap, setCap] = useState<EffortLevel>('high');
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    if (!open || attempted) return undefined;
    let alive = true;
    void (async () => {
      try {
        const res = await fetch('/api/settings');
        const data = (await res.json()) as { settings?: { agentModelOverride?: string | null } };
        const modelID = (data.settings?.agentModelOverride ?? '').split('/').slice(1).join('/');
        if (alive) setCap(maxModelEffort(modelID));
      } catch {
        if (alive) setCap('high');
      } finally {
        // Sekali try saja — biar ga spam fetch tiap buka menu; nilai berikutnya dipegang.
        if (alive) setAttempted(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, attempted]);

  // Level yang ditampilkan: 'auto' + low..cap (cap memotong sisanya).
  const shownLevels = EFFORT_LEVELS.filter((level) => rank(level) <= rank(cap));
  const selected = aiEffort !== null && rank(aiEffort) <= rank(cap) ? aiEffort : 'auto';

  return (
    <div
      className="relative shrink-0"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setOpen(false);
          buttonRef.current?.focus();
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        title={t('settings.title')}
        aria-label={t('settings.title')}
        aria-expanded={open}
        className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Settings2 size={14} />
      </button>

      {open && (
        <>
          {/* Backdrop transparan buat klik-diluar (di bawah panel liat pola center-panel). */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            aria-label={t('settings.title')}
            className="absolute right-0 top-9 z-50 w-64 rounded-lg border border-border bg-card p-1 shadow-md"
          >
            {/* Bahasa */}
            <p className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('settings.language')}
            </p>
            <div className="flex flex-wrap gap-0.5 rounded-md border border-border bg-background p-0.5">
              <Chip active={locale === 'id'} label="Indonesia" onClick={() => setLocale('id')} />
              <Chip active={locale === 'en'} label="English" onClick={() => setLocale('en')} />
            </div>

            <div className="mx-1 my-1.5 h-px bg-border" />

            {/* Tema */}
            <p className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('settings.theme')}
            </p>
            <div className="flex flex-wrap gap-0.5 rounded-md border border-border bg-background p-0.5">
              {THEMES.map((next) => (
                <Chip
                  key={next}
                  active={theme === next}
                  label={t(THEME_LABEL_KEY[next])}
                  onClick={() => setTheme(next)}
                />
              ))}
            </div>

            <div className="mx-1 my-1.5 h-px bg-border" />

            {/* Effort AI */}
            <p className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('settings.aiEffort')}
            </p>
            <div className="flex flex-wrap gap-0.5 rounded-md border border-border bg-background p-0.5">
              {shownLevels.map((level) => (
                <Chip
                  key={level}
                  active={selected === level}
                  label={t(EFFORT_LABEL_KEY[level])}
                  onClick={() => setAiEffort(level === 'auto' ? null : level)}
                />
              ))}
            </div>
            {rank(cap) < EFFORT_LEVELS.length - 1 && (
              <p className="mt-1.5 px-2 text-[10px] leading-relaxed text-muted-foreground">
                {t('settings.effortCap', { level: t(EFFORT_LABEL_KEY[cap]) })}
              </p>
            )}
            <p className="mt-1 px-2 pb-2 text-[10px] leading-relaxed text-muted-foreground">
              {t('settings.effortNote')}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
