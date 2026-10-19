'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Blocks, BookOpen, Search, Settings, X, type LucideIcon } from 'lucide-react';
import { usePreferences, type Locale, type Theme } from '@/lib/preferences';
import { sortVariants, VARIANT_LABEL_KEYS } from '@/lib/ai/effort';
import { SegmentedGroup } from '@/components/ui';
import { McpPane, SkillsPane } from '@/components/panels/extensions-panel';

/**
 * Dialog Settings ala Claude (gambar referensi: ss.png) — modal dengan NAV kiri
 * bergrup (search + item ikon+label) dan pane kanan scrollable berisi baris
 * setting. Zero-props: tombol gear di ujung bawah rail + state dialog semuanya
 * di komponen ini; dipasang sebagai child <nav> IconRail (bukan tab, gak ngerusak
 * kontrak LeftTab). Konten pane MCP & Skills tinggal komponen panenya.
 */

type SettingsSection = 'general' | 'mcp' | 'skills';

// Label effort: variant yang dikenali → i18n; id eksotik dari server tampil apa adanya.
const effortLabelFor = (id: string, t: (key: string) => string): string => {
  const key = VARIANT_LABEL_KEYS[id];
  return key ? t(key) : id;
};

type NavItem = { id: SettingsSection; icon: LucideIcon; labelKey: string };
type NavGroup = { groupKey: string; items: NavItem[] };

/** Grup nav ikut ss.png: "Pengaturan" berisi Umum, "Kustomisasi" berisi MCP & Skills. */
const NAV_GROUPS: NavGroup[] = [
  { groupKey: 'settings.title', items: [{ id: 'general', icon: Settings, labelKey: 'settings.general' }] },
  {
    groupKey: 'settings.customize',
    items: [
      { id: 'mcp', icon: Blocks, labelKey: 'mcp.navMcp' },
      { id: 'skills', icon: BookOpen, labelKey: 'mcp.navSkills' },
    ],
  },
];

export function SettingsDialog() {
  const { locale, theme, aiEffort, t, setLocale, setTheme, setAiEffort } = usePreferences();
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<SettingsSection>('general');
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => setOpen(false), []);

  const openDialog = () => {
    // Dialog fresh tiap dibuka: mulai dari Umum, search kosong.
    setOpen(true);
    setSection('general');
    setQuery('');
  };

  // Esc menutup — dobel pasti aman: listener CAPTURE di window (kesempatan
  // duluan sebelum listener bubble milik shell, jadi Esc gak nyamber
  // toggle focus mode juga), preventDefault + stopPropagation.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, close]);

  // Fokus ke search saat dialog dibuka (pola ss.png — start mengetik langsung).
  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  // Variant effort model aktif — langsung dari /api/ai/model (server OpenCode).
  // null = belum kebaca (fallback aman), [] = model tanpa variant (konsep effort nggak ada).
  const [variantOptions, setVariantOptions] = useState<string[] | null>(null);
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    if (!open || attempted) return undefined;
    let alive = true;
    void (async () => {
      try {
        const res = await fetch('/api/ai/models');
        const data = (await res.json()) as { override?: { variants?: string[] } | null };
        if (alive) setVariantOptions(sortVariants(data.override?.variants ?? []));
      } catch {
        if (alive) setVariantOptions([]);
      } finally {
        if (alive) setAttempted(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, attempted]);

  // 'auto' di depan + variant nyata model. Belum kebaca → fallback auto..high.
  const shownLevels: string[] = variantOptions === null ? ['auto', 'low', 'medium', 'high'] : ['auto', ...variantOptions];
  const selected = aiEffort !== null && shownLevels.includes(aiEffort) ? aiEffort : 'auto';

  // Search nav: filter item live; grup tanpa item nyaris hilang sekalian.
  const needle = query.trim().toLowerCase();
  const filteredGroups = needle
    ? NAV_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter((item) => t(item.labelKey).toLowerCase().includes(needle)),
      }))
    : NAV_GROUPS;
  const anyNavVisible = filteredGroups.some((group) => group.items.length > 0);

  return (
    <>
      {/* Separator tipis di atas tombol gear — pemisah visual rail vs settings. */}
      <div className="mx-1.5 my-1 h-px w-8 bg-border" aria-hidden="true" />

      <button
        type="button"
        onClick={openDialog}
        title={t('settings.title')}
        aria-label={t('settings.title')}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`flex h-11 w-11 cursor-pointer items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          open ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        }`}
      >
        <Settings size={18} />
      </button>

      {open && (
        <div
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('settings.title')}
            className="flex h-[min(560px,calc(100vh_-_4rem))] w-[min(720px,calc(100vw_-_2rem))] overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
          >
            {/* NAV kiri: search di atas + grup berlabel berisi item ikon+label. */}
            <nav className="flex w-56 shrink-0 flex-col border-r border-border bg-muted/40 p-2">
              <div className="relative mb-2 shrink-0">
                <Search
                  size={13}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('settings.searchPh')}
                  aria-label={t('settings.searchPh')}
                  className="h-8 w-full rounded-md border border-border bg-background pl-7 pr-2 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
                />
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {filteredGroups.map((group) =>
                  group.items.length === 0 ? null : (
                    <div key={group.groupKey}>
                      <p className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {t(group.groupKey)}
                      </p>
                      {group.items.map(({ id, icon: ItemIcon, labelKey }) => {
                        const label = t(labelKey);
                        return (
                          <button
                            key={id}
                            type="button"
                            aria-current={section === id ? 'true' : undefined}
                            onClick={() => setSection(id)}
                            className={`mb-0.5 flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                              section === id
                                ? 'bg-primary/10 text-primary'
                                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                            }`}
                          >
                            <ItemIcon size={14} className="shrink-0" />
                            <span className="truncate">{label}</span>
                          </button>
                        );
                      })}
                    </div>
                  ),
                )}
                {!anyNavVisible && (
                  <p className="px-2 pt-2 text-[10px] text-muted-foreground">-</p>
                )}
              </div>
            </nav>

            {/* Pane kanan: judul seksi + konten; dia yang pegang scroll sendiri. */}
            <div className="relative flex min-w-0 flex-1 flex-col">
              <button
                type="button"
                onClick={close}
                title={t('settings.close')}
                aria-label={t('settings.close')}
                className="absolute right-2.5 top-2.5 z-10 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <X size={15} />
              </button>

              {section === 'general' && (
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-5">
                  <h2 className="text-[15px] font-semibold tracking-tight text-foreground">
                    {t('settings.general')}
                  </h2>
                  <div className="divide-y divide-border">
                    {/* Bahasa */}
                    <div className="flex items-center justify-between gap-4 py-4">
                      <span className="text-[13px] text-foreground">{t('settings.language')}</span>
                      <div className="rounded-md focus-within:ring-2 focus-within:ring-ring">
                        <SegmentedGroup
                          options={[
                            { value: 'id', label: 'Indonesia' },
                            { value: 'en', label: 'English' },
                          ]}
                          active={locale}
                          onSelect={(value) => setLocale(value as Locale)}
                        />
                      </div>
                    </div>

                    {/* Tema */}
                    <div className="flex items-center justify-between gap-4 py-4">
                      <span className="text-[13px] text-foreground">{t('settings.theme')}</span>
                      <div className="rounded-md focus-within:ring-2 focus-within:ring-ring">
                        <SegmentedGroup
                          options={[
                            { value: 'light', label: t('settings.themeLight') },
                            { value: 'dark', label: t('settings.themeDark') },
                            { value: 'system', label: t('settings.themeSystem') },
                          ]}
                          active={theme}
                          onSelect={(value) => setTheme(value as Theme)}
                        />
                      </div>
                    </div>

                    {/* Effort AI */}
                    <div className="flex items-start justify-between gap-4 py-4">
                      <div className="min-w-0">
                        <span className="block text-[13px] text-foreground">{t('settings.aiEffort')}</span>
                        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                          {t('settings.effortNote')}
                        </p>
                      </div>
                      <div className="rounded-md focus-within:ring-2 focus-within:ring-ring">
                        <SegmentedGroup
                          options={shownLevels.map((level) => ({
                            value: level,
                            label: effortLabelFor(level, t),
                          }))}
                          active={selected}
                          onSelect={(value) => setAiEffort(value === 'auto' ? null : value)}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {section === 'mcp' && (
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-5">
                  <h2 className="text-[15px] font-semibold tracking-tight text-foreground">
                    {t('mcp.title')}
                  </h2>
                  <p className="mb-2 mt-1 text-[11px] leading-snug text-muted-foreground">
                    {t('mcp.desc')}
                  </p>
                  <McpPane />
                </div>
              )}

              {section === 'skills' && (
                <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-5">
                  <h2 className="text-[15px] font-semibold tracking-tight text-foreground">
                    {t('mcp.skillsTitle')}
                  </h2>
                  <p className="mb-2 mt-1 text-[11px] leading-snug text-muted-foreground">
                    {t('mcp.skillsDesc')}
                  </p>
                  <SkillsPane />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
