'use client';

import { useT } from '@/lib/preferences';
import { ThesisEditor } from '@/components/editor/thesis-editor';

export function CenterPanel({
  slug,
  openFile,
  openVersion,
}: {
  slug: string;
  openFile: string | null;
  openVersion: number;
}) {
  return (
    <section className="flex h-full min-w-0 flex-col bg-neutral-100/70 dark:bg-neutral-950/60">
      {openFile ? (
        <ThesisEditor key={`${openFile}:${openVersion}`} slug={slug} filePath={openFile} />
      ) : (
        <EmptyState />
      )}
    </section>
  );
}

function EmptyState() {
  const t = useT();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <div className="rounded-xl border border-dashed border-neutral-300 bg-white/70 px-8 py-10 shadow-sm dark:border-neutral-700 dark:bg-neutral-900/70">
        <p className="font-medium">{t('editor.noFile')}</p>
        <p className="mt-1 max-w-xs text-sm text-neutral-500">{t('editor.noFileHint')}</p>
      </div>
    </div>
  );
}

