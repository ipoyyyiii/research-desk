'use client';

import { useRouter } from 'next/navigation';
import { FilePlus2, Columns2, MessagesSquare } from 'lucide-react';
import { useT } from '@/lib/preferences';
import { Button, IconButton, StatusDot } from '@/components/ui';
import { NewDocModal, requestNewDocument } from '@/components/panels/new-doc-modal';

/**
 * Bar atas brand ala homepage: mark "R" navy + wordmark `research-desk` —
 * SELURUH brand bisa diklik balik ke halaman awal `/`. Nama project aktif
 * masih tampil kecil di sebelahnya (info context, bukan link).
 *
 * Dialog dokumen baru di-mount SATU kali di sini; komponen lain minta buka
 * lewat `requestNewDocument()` (event global). Sukses buat → event
 * `workspace:doc-created` yang di-listen shell buat buka tabnya.
 */
export function TopBar({
  projectName,
  projectSlug,
  focusMode,
  onToggleFocusMode,
  rightOpen = true,
  onToggleRight,
}: {
  projectName: string;
  projectSlug: string;
  focusMode: boolean;
  onToggleFocusMode: () => void;
  /** Panel kanan (AI Assistant) lagi kebuka? — buat aria-pressed toggle header. */
  rightOpen?: boolean;
  onToggleRight?: () => void;
}) {
  const router = useRouter();
  const t = useT();

  return (
    <header className="flex h-11 items-center justify-between border-b border-neutral-200 px-3 dark:border-neutral-800">
      <div className="flex min-w-0 items-center gap-2">
        {/* Brand → home: satu zona klik, title + focus ring eksplisit. */}
        <button
          type="button"
          onClick={() => router.push('/')}
          title={t('brand.home')}
          aria-label={t('brand.home')}
          className="flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-md px-2 -mx-2 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800 focus-visible:-mx-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            aria-hidden="true"
            className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary font-mono text-[13px] font-medium text-primary-foreground"
          >
            R
          </span>
          <span className="whitespace-nowrap text-sm font-semibold tracking-tight">
            {t('brand.name')}
          </span>
        </button>
        {/* Project aktif: info kecil di samping brand — bukan bagian zona klik. */}
        <span
          aria-hidden="true"
          className="select-none text-xs text-neutral-300 dark:text-neutral-700"
        >
          /
        </span>
        <span className="min-w-0 truncate text-xs text-muted-foreground">{projectName}</span>
      </div>

      <div className="flex items-center gap-2">
        {/* Export menu — aktif di fase 4 */}
        <Button variant="ghost" disabled title="Fase 4">
          Export ▾
        </Button>
        <IconButton onClick={onToggleFocusMode} title="Focus mode (Esc)" className={focusMode ? 'text-blue-500' : ''}>
          <Columns2 size={15} />
        </IconButton>
        {!focusMode && (
          <Button
            variant="ghost"
            onClick={onToggleRight}
            aria-pressed={rightOpen}
            title={rightOpen ? t('layout.rightClose') : t('layout.aiOpen')}
          >
            <MessagesSquare size={15} />
            {t('layout.aiAssistant')}
          </Button>
        )}
        <Button variant="subtle" onClick={requestNewDocument}>
          <FilePlus2 size={15} />
          {t('common.newDocument')}
        </Button>
        <StatusDot tone="amber" title={`OpenCode: ${t('chat.statusOff')} (fase 2)`} />
      </div>

      {/* Dialog dokumen baru — pindah ke new-doc-modal (shared: bisa dipanggil
          lewat event dari panel lain). */}
      <NewDocModal slug={projectSlug} />
    </header>
  );
}
