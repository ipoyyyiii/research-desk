// Dictionary i18n untuk sisi server (route API). Versi client ada di
// src/lib/preferences.tsx — file ini cuma buat label server-side (mis. judul
// heading pada export matriks) yang butuh locale app dari tabel settings.

import idDict from '@/../i18n/id.json';
import enDict from '@/../i18n/en.json';

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

export type DictLocale = 'id' | 'en';

const dictionaries: Record<DictLocale, Record<string, string>> = {
  id: flatten(idDict as NestedDict),
  en: flatten(enDict as NestedDict),
};

/** Dictionary flattened untuk locale given; locale tak dikenal → id (default app). */
export function dictFor(locale: string | null | undefined): Record<string, string> {
  return locale === 'en' ? dictionaries.en : dictionaries.id;
}
