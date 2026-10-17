'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

// ── i18n ─────────────────────────────────────────────────────────────────────
// Dictionary ringan (planning §stack): JSON per bahasa, tanpa framework berat.

import idDict from '@/../i18n/id.json';
import enDict from '@/../i18n/en.json';

export type Locale = 'id' | 'en';
export type Theme = 'light' | 'dark' | 'system';

const dictionaries: Record<Locale, Record<string, string>> = {
  id: flatten(idDict as NestedDict),
  en: flatten(enDict as NestedDict),
};

type NestedDict = { [key: string]: string | NestedDict };

function flatten(dict: NestedDict, prefix = ''): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(dict)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      flat[full] = value;
    } else {
      Object.assign(flat, flatten(value, full));
    }
  }
  return flat;
}

interface PreferencesValue {
  locale: Locale;
  theme: Theme;
  t: (key: string, vars?: Record<string, string | number>) => string;
  setLocale: (locale: Locale) => void;
  setTheme: (theme: Theme) => void;
}

const PreferencesContext = createContext<PreferencesValue | null>(null);

const LOCALE_STORAGE_KEY = 'research-desk:locale';
const THEME_STORAGE_KEY = 'research-desk:theme';

export function PreferencesProvider({
  initialLocale,
  initialTheme,
  children,
}: {
  initialLocale: Locale;
  initialTheme: Theme;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const [theme, setThemeState] = useState<Theme>(initialTheme);

  // Tema light/dark/system → class .dark di <html> (Tailwind 4 custom-variant),
  // default mengikuti OS saat "system".
  useEffect(() => {
    const apply = () => {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const resolved = theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
      document.documentElement.classList.toggle('dark', resolved === 'dark');
    };
    apply();
    if (theme === 'system') {
      const media = window.matchMedia('(prefers-color-scheme: dark)');
      media.addEventListener('change', apply);
      return () => media.removeEventListener('change', apply);
    }
    return undefined;
  }, [theme]);

  const persist = useCallback((payload: { locale?: Locale; theme?: Theme }) => {
    void fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }, []);

  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleState(next);
      try {
        localStorage.setItem(LOCALE_STORAGE_KEY, next);
      } catch {
        // privat mode — abaikan
      }
      persist({ locale: next });
    },
    [persist],
  );

  const setTheme = useCallback(
    (next: Theme) => {
      setThemeState(next);
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // privat mode — abaikan
      }
      persist({ theme: next });
    },
    [persist],
  );

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      let value = dictionaries[locale][key] ?? dictionaries.id[key] ?? key;
      if (vars) {
        for (const [varKey, varValue] of Object.entries(vars)) {
          value = value.replaceAll(`{${varKey}}`, String(varValue));
        }
      }
      return value;
    },
    [locale],
  );

  const value = useMemo(
    () => ({ locale, theme, t, setLocale, setTheme }),
    [locale, theme, t, setLocale, setTheme],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesValue {
  const context = useContext(PreferencesContext);
  if (!context) throw new Error('usePreferences dipakai di luar PreferencesProvider');
  return context;
}

export function useT() {
  return usePreferences().t;
}
