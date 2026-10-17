'use client';

import { MessageCircle } from 'lucide-react';
import { useT } from '@/lib/preferences';
import { StatusDot } from '@/components/ui';

export function ChatPanel() {
  const t = useT();
  return (
    <aside className="flex h-full flex-col border-l border-neutral-200 bg-neutral-50/60 dark:border-neutral-800 dark:bg-neutral-900/40">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-neutral-200 px-3 dark:border-neutral-800">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-300">
          <MessageCircle size={13} />
          {t('chat.title')}
        </span>
        <StatusDot tone="amber" title={t('chat.statusOff')} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-xs text-neutral-400">{t('chat.comingSoon')}</p>
      </div>

      <div className="border-t border-neutral-200 p-2.5 dark:border-neutral-800">
        <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 opacity-60 dark:border-neutral-700 dark:bg-neutral-900">
          <input
            disabled
            placeholder={t('chat.placeholder')}
            className="w-full bg-transparent text-sm outline-none placeholder:text-neutral-400"
          />
          <span className="text-xs text-neutral-400">↵</span>
        </div>
      </div>
    </aside>
  );
}
