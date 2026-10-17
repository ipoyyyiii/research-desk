'use client';

import { useEffect, useState } from 'react';

type Project = {
  id: number;
  slug: string;
  name: string;
  folderPath: string;
  createdAt: string;
  lastOpenedAt: string | null;
};

export default function WorkspacePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState('Skripsi-ku');
  const [folder, setFolder] = useState('~/Documents/skripsi');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    try {
      const res = await fetch('/api/projects');
      const data = await res.json();
      setProjects(data.projects ?? []);
    } catch {
      setError('Gagal terhubung ke server');
    }
  };

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  const attach = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, folder }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Gagal membuat project');
      } else {
        setProjects((prev) => [...prev, data.project]);
      }
    } catch {
      setError('Gagal terhubung ke server');
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">research-desk</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Satu tempat untuk nulis skripsi + baca jurnal + tanya AI.
      </p>

      <section className="mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          Project terpasang
        </h2>
        {loading ? (
          <p className="mt-3 text-sm text-neutral-400">Memuat…</p>
        ) : projects.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-400">
            Belum ada project. Pasang folder skripsi kamu di bawah 👇
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-neutral-200 rounded-md border border-neutral-200">
            {projects.map((project) => (
              <li key={project.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="font-medium">{project.name}</p>
                  <p className="text-xs text-neutral-500">{project.folderPath}</p>
                </div>
                <span className="text-xs text-neutral-400">slug: {project.slug}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          Pasang folder project
        </h2>
        <form onSubmit={attach} className="mt-3 space-y-4 rounded-md border border-neutral-200 p-4">
          <div>
            <label htmlFor="name" className="block text-sm font-medium">
              Nama project
            </label>
            <input
              id="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
              required
            />
          </div>
          <div>
            <label htmlFor="folder" className="block text-sm font-medium">
              Folder (harus dalam ~)
            </label>
            <input
              id="folder"
              value={folder}
              onChange={(event) => setFolder(event.target.value)}
              className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-sm outline-none focus:border-neutral-900"
              required
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={creating}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
          >
            {creating ? 'Memasang…' : 'Pasang folder'}
          </button>
          <p className="text-xs text-neutral-400">
            Subfolder baku (dokumen/, gambar/, referensi/papers/, export/) dibuat otomatis kalau belum ada.
            File lama tidak disentuh.
          </p>
        </form>
      </section>
    </main>
  );
}
