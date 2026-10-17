import fs from 'node:fs';
import path from 'node:path';
import { listTree, type TreeEntry } from '@/lib/workspace/files';

/**

/**
 * Persona + izin agent per project.
 *
 * Server OpenCode (v2) membaca config project dari `<project>/.opencode/opencode.json`
 * saat session dibuat dengan `location.directory` = folder project.
 * File persona instruksi = `<project>/AGENTS.md` (standar OpenCode).
 */

export type { TreeEntry };

/** Tulis ulang persona/permissions project (idempotent, dipanggil saat ensure session). */
export function ensureProjectAgentConfig(folderPath: string): void {
  try {
    const dir = path.join(folderPath, '.opencode');
    fs.mkdirSync(dir, { recursive: true });

    const config = {
      $schema: 'https://opencode.ai/config.json',
      agent: {
        thesis: {
          description: 'Asisten penulis skripsi — baca/tulis berkas project, cari jurnal, pasang sitasi',
          prompt:
            'Kamu "Thesis", asisten penulis skripsi di aplikasi research-desk. ' +
            'Bahasa pengguna: Indonesia santai-tapi-rapi. ' +
            'ATURAN: (1) Untuk sitasi, SELALU gunakan kunci bibliografi yang ada di references.bib — jangan pernah mengarang nomor sitasi. ' +
            '(2) Untuk merevisi isi dokumen, edit file markdown di folder dokumen/ secara konservatif (replace terhadap teks yang ada, bukan tulis ulang seluruh bab) dan sebut nama file yang kamu ubah. ' +
            '(3) Sebelum menambah jurnal, tampilkan singkat: judul, penulis, tahun, DOI, jumlah sitasi — jangan asal comot. ' +
            '(4) Kamu boleh membaca/mengubah berkas di dalam folder project ini saja. ' +
            '(5) Jawab singkat dan terstruktur; tanya balik kalau konteks dari dossier tidak jelas.',
        },
      },
    };

    fs.writeFileSync(path.join(dir, 'opencode.json'), JSON.stringify(config, null, 2), 'utf8');

    // AGENTS.md = instruksi level project (dibaca opencode saat start di folder itu)
    const agentsDoc = path.join(folderPath, 'AGENTS.md');
    if (!fs.existsSync(agentsDoc)) {
      fs.writeFileSync(
        agentsDoc,
        [
          '# Project skripsi',
          '',
          'Dokumen skripsi dalam markdown per-bab di `dokumen/`.',
          'Gunakan agent "thesis" untuk konsultasi, revisi isi, dan sitasi.',
          'Jangan mengubah file di luar folder project. Jangan menjalankan perintah shell.',
          '',
        ].join('\n'),
        'utf8',
      );
    }
  } catch (error) {
    console.error('[agent-config] gagal menulis config:', error);
  }
}

/**
 * Dossier ringkas — dikirim bersama tiap prompt supaya agent "paham konteks"
 * yang sedang dikerjakan user tanpa user mengulang.
 */
export async function buildDossier(opts: {
  slug: string;
  title: string;
  folderRealPath: string;
  activeFilePath: string | null;
}): Promise<string> {
  const lines: string[] = [];
  lines.push('[KONTEKS OTOMATIS — dossier project]');
  lines.push(`Judul project: ${opts.title}`);
  lines.push(`Folder: ${opts.folderRealPath}`);
  if (opts.activeFilePath) lines.push(`File aktif di editor: ${opts.activeFilePath}`);

  try {
    const tree = await listTree(opts.folderRealPath);
    const files = tree.filter((entry) => entry.type === 'file' && /\.(md|bib|ris|txt)$/i.test(entry.name));
    if (files.length > 0) {
      lines.push('Daftar dokumen/berkas teks:');
      for (const file of files.slice(0, 40)) {
        lines.push(`- ${file.path} (${formatSize(file.size)})`);
      }
      if (files.length > 40) lines.push(`- … dan ${files.length - 40} berkas lain`);
    }
  } catch {
    lines.push('(Daftar berkas tidak tersedia)');
  }
  lines.push('[AKHIR KONTEKS]');
  return lines.join('\n');
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
