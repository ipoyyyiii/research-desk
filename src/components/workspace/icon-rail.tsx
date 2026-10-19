'use client';

import {
  BookMarked,
  BookOpenText,
  Database,
  FolderClosed,
  Images,
  ListTree,
  ScrollText,
  type LucideIcon,
} from 'lucide-react';
import { useT } from '@/lib/preferences';
import { SettingsDialog } from '@/components/workspace/settings-dialog';

export type LeftTab = 'drafts' | 'outline' | 'journals' | 'zotero' | 'figures' | 'data' | 'files';

// Views berbasis tujuan dulu (kiri atas), view file-manager mentah paling bawah.
// MCP & Skills pindah ke dialog Settings — tab 'extensions' gak ada lagi.
const TABS: Array<{ id: LeftTab; icon: LucideIcon; labelKey: string }> = [
  { id: 'drafts', icon: ScrollText, labelKey: 'views.drafts' },
  { id: 'outline', icon: ListTree, labelKey: 'left.tabOutline' },
  { id: 'journals', icon: BookOpenText, labelKey: 'tabs.journal' },
  { id: 'zotero', icon: BookMarked, labelKey: 'left.tabZotero' },
  { id: 'figures', icon: Images, labelKey: 'views.figures' },
  { id: 'data', icon: Database, labelKey: 'views.data' },
  { id: 'files', icon: FolderClosed, labelKey: 'tabs.file' },
];

/** Activity bar ala VS Code — strip ikon vertikal tipis di tepi kiri panel. */
export function IconRail({ active, onChange }: { active: LeftTab; onChange: (tab: LeftTab) => void }) {
  const t = useT();
  return (
    <nav className="flex w-11 flex-col items-center gap-1 border-r border-border bg-card py-2">
      {TABS.map(({ id, icon: TabIcon, labelKey }) => {
        const label = t(labelKey);
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

      {/* Dialog Settings: gear bukan tab (gak masuk LeftTab) — state dialog
          self-contained di komponennya, dipasang sebagai child terakhir nav. */}
      <SettingsDialog />
    </nav>
  );
}
