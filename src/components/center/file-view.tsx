'use client';

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, StickyNote } from 'lucide-react';
import { useT } from '@/lib/preferences';
import { isPdfPath } from '@/lib/paths';
import { matchPaperByFileName, type MatchablePaper } from '@/lib/notes/match';
import { parsePaperNoteJson, type PaperNote } from '@/lib/notes/types';

type FileViewProps = {
  slug: string;
  path: string;
};

function rawUrl(slug: string, path: string): string {
  return `/api/projects/${encodeURIComponent(slug)}/raw?path=${encodeURIComponent(path)}`;
}

/** Paper library → kandidat pencocokan nama berkas (paperId, judul, DOI). */
function parseMatchPapers(value: unknown): MatchablePaper[] {
  if (!value || typeof value !== 'object') return [];
  const results = (value as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  const papers: MatchablePaper[] = [];
  for (const raw of results) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as { paperId?: unknown; paper?: { title?: unknown; doi?: unknown } };
    if (typeof entry.paperId !== 'string') continue;
    papers.push({
      paperId: entry.paperId,
      title: typeof entry.paper?.title === 'string' ? entry.paper.title : '',
      doi: typeof entry.paper?.doi === 'string' ? entry.paper.doi : null,
    });
  }
  return papers;
}

/**
 * Preview berkas biner di tab tengah: PDF via iframe (viewer bawaan browser,
 * udah ada zoom/print), gambar via <img> center. Sumber: route /raw (binary
 * inline, aman traversal — sudah diuji fase 3.5b).
 *
 * PDF di folder referensi/ juga nampilin catatan ringan yang menempel ke
 * paper itu (dicocokkan dari nama berkas ke paper di Perpustakaan).
 */
export function FileView({ slug, path }: FileViewProps) {
  const t = useT();
  const url = rawUrl(slug, path);
  const isPaperPdf = isPdfPath(path) && path.toLowerCase().includes('referensi/');
  const [notes, setNotes] = useState<PaperNote[]>([]);
  const [matched, setMatched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  const loadPaperNotes = useCallback(async () => {
    setLoading(true);
    try {
      const [papersRes, notesRes] = await Promise.all([
        fetch(`/api/journals/save?slug=${encodeURIComponent(slug)}`),
        fetch(`/api/projects/${encodeURIComponent(slug)}/notes`),
      ]);
      const papersData = (await papersRes.json().catch(() => null)) as unknown;
      const notesData = (await notesRes.json().catch(() => null)) as { notes?: unknown } | null;
      const fileName = path.split('/').pop() ?? '';
      const hit = matchPaperByFileName(fileName, parseMatchPapers(papersData));
      setMatched(hit !== null);
      if (!hit) {
        setNotes([]);
        return;
      }
      const raw = Array.isArray(notesData?.notes) ? notesData.notes : [];
      setNotes(
        raw
          .map(parsePaperNoteJson)
          .filter((item): item is PaperNote => item !== null)
          .filter((item) => item.paperId === hit.paperId),
      );
    } catch {
      setMatched(false);
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }, [slug, path]);

  useEffect(() => {
    setNotesOpen(false);
    if (!isPaperPdf) {
      setMatched(false);
      setNotes([]);
      return;
    }
    void loadPaperNotes();
  }, [isPaperPdf, loadPaperNotes]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center justify-end gap-1 border-b border-border bg-card px-2">
        {isPaperPdf && matched && (
          <button
            type="button"
            onClick={() => setNotesOpen((open) => !open)}
            title={t('notes.paperNotes')}
            aria-expanded={notesOpen}
            className="flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <StickyNote size={12} />
            {t('notes.count', { n: notes.length })}
          </button>
        )}
        <button
          type="button"
          onClick={() => window.open(url, '_blank', 'noopener')}
          title={t('views.openNewTab')}
          aria-label={t('views.openNewTab')}
          className="flex h-6 items-center gap-1 rounded px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ExternalLink size={12} />
          ↗
        </button>
      </div>

      {notesOpen && isPaperPdf && (
        <div className="max-h-[40vh] shrink-0 overflow-auto border-b border-border bg-card px-3 py-2">
          <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            {t('notes.paperNotes')}
          </p>
          {loading ? (
            <p className="text-[11px] text-muted-foreground">…</p>
          ) : notes.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">{t('notes.empty')}</p>
          ) : (
            <ul className="space-y-1.5">
              {notes.map((item) => (
                <li
                  key={item.id}
                  className="border-b border-border pb-1.5 last:border-b-0 last:pb-0"
                >
                  <p className="text-[11px] leading-snug text-foreground">{item.note}</p>
                  {item.quote && (
                    <p className="mt-0.5 border-l-2 border-border pl-2 text-[11px] italic leading-snug text-muted-foreground">
                      {item.quote}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {isPdfPath(path) ? (
        <iframe src={url} title={path} className="min-h-0 w-full flex-1 bg-muted" />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- daftar lokal route /raw */}
          <img
            src={url}
            alt={path}
            draggable={false}
            className="max-h-full max-w-full rounded-lg bg-card object-contain shadow-md"
          />
        </div>
      )}
    </div>
  );
}
