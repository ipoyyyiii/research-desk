'use client';

import { AgentView } from '@/components/panels/agent-view';

/**
 * Panel kanan — sesi agent OpenCode per project (fase 2).
 * Wrapper tipis: semua state di AgentView, UI di AgentPanel.
 */
export function ChatPanel({
  slug,
  projectTitle,
  activeFilePath,
}: {
  slug: string;
  projectTitle: string;
  activeFilePath: string | null;
}) {
  return <AgentView slug={slug} projectTitle={projectTitle} activeFilePath={activeFilePath} />;
}
