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
    <section className="flex h-full min-w-0 flex-col bg-muted/50">
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
      <div className="rounded-xl border border-dashed border-border bg-card px-8 py-10 shadow-sm">
        <p className="font-serif text-base font-semibold tracking-tight">{t('editor.noFile')}</p>
        <p className="mt-1 max-w-xs text-sm text-muted-foreground">{t('editor.noFileHint')}</p>
      </div>
    </div>
  );
}

