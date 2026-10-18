'use client';

import { BookOpenText, Files, LibraryBig, type LucideIcon } from 'lucide-react';
import { useT } from '@/lib/preferences';

export type LeftTab = 'file' | 'journal' | 'library';

const TABS: Array<{ id: LeftTab; icon: LucideIcon }> = [
  { id: 'file', icon: Files },
  { id: 'journal', icon: BookOpenText },
  { id: 'library', icon: LibraryBig },
];

/** Activity bar ala VS Code — strip ikon vertikal tipis di tepi kiri panel. */
export function IconRail({ active, onChange }: { active: LeftTab; onChange: (tab: LeftTab) => void }) {
  const t = useT();
  return (
    <nav className="flex w-11 flex-col items-center gap-1 border-r border-border bg-card py-2">
      {TABS.map(({ id, icon: TabIcon }) => {
        const label = t(`tabs.${id}`);
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            title={label}
            aria-label={label}
            aria-pressed={active === id}
            className={`flex h-11 w-11 cursor-pointer items-center justify-center rounded-md transition-colors ${
              active === id
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <TabIcon size={18} />
          </button>
        );
      })}
    </nav>
  );
}
