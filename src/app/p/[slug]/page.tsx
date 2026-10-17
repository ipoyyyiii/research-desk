import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projects } from '@/lib/db/schema';
import { WorkspaceShell } from '@/components/workspace/shell';

export const dynamic = 'force-dynamic';

export default async function ProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const rows = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
  if (rows.length === 0) notFound();
  return <WorkspaceShell slug={slug} projectName={rows[0].name} />;
}
