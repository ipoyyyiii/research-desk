'use client';

import { AgentView } from '@/components/panels/agent-view';

/**
 * Panel kanan — sesi agent OpenCode per project (fase 2).
 * Wrapper tipis: semua state di AgentView, UI di AgentPanel.
 * `onCollapse` diteruskan buat tombol arrow tutup panel di header (fase 8).
 */
export function ChatPanel({
  slug,
  projectTitle,
  activeFilePath,
  onCollapse,
}: {
  slug: string;
  projectTitle: string;
  activeFilePath: string | null;
  onCollapse?: () => void;
}) {
  return (
    <AgentView
      slug={slug}
      projectTitle={projectTitle}
      activeFilePath={activeFilePath}
      onCollapse={onCollapse}
    />
  );
}
