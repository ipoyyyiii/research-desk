import { redirect } from 'next/navigation';

/** /workspace kini legacy picker — semua lalu lintas lewat homepage `/`. */
export default function WorkspacePage() {
  redirect('/');
}
