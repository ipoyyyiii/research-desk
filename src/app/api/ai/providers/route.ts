import { NextResponse } from 'next/server';
import { ensureServer } from '@/lib/opencode/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Login provider lain dari dalam app (fase 2.5-lite):
 * - GET  → daftar integrasi popular yang bisa login pakai API key + status sambung.
 * - POST → { integrationID, key } → client.integration.connect.key (langsung nyala,
 *          tanpa restart service).
 * - DELETE → { integrationID } → putus koneksi (hapus baris credential di DB opencode).
 *
 * Catatan: key PALSU ikut diterima server (gak divalidasi pas connect) —
 * kebentuk error baru pas pertama ngechat pakai model provider itu, jadi ditulis di ampe UI.
 */

type IntegrationListInfo = {
  id: string;
  name: string;
  methods?: Array<{ type: string }>;
  connections?: Array<{ id?: string } | unknown>;
};

/** Integrasi pular yang ditawarkan di dropdown (urutan = prioritas tampil). */
const POPULAR = ['anthropic', 'google', 'openrouter', 'deepseek', 'groq', 'mistral'];

export async function GET() {
  try {
    const client = await ensureServer();
    const all = ((await client.integration.list())?.data ?? []) as IntegrationListInfo[];
    const providers = ((await client.provider.list())?.data ?? []).map((p) => p.id);

    const picks: Array<{
      integrationID: string;
      name: string;
      connected: boolean;
    }> = [];
    for (const id of POPULAR) {
      const found = all.find((i) => i.id === id);
      if (!found) continue;
      const keyCapable = (found.methods ?? []).some((m) => m?.type === 'key');
      if (!keyCapable) continue;
      picks.push({
        integrationID: found.id,
        name: found.name ?? found.id,
        connected: providers.includes(found.id),
      });
    }
    // Provider yang sudah nyambung selain POPULAR (mis. deepseek manual via terminal).
    const extra = all.filter(
      (i) =>
        !POPULAR.includes(i.id) &&
        i.id !== 'openai' &&
        i.id !== 'opencode' && // provider bawaan (model gratis) gak perlu daftar "ternyambung"
        (i.methods ?? []).some((m) => m?.type === 'key') &&
        providers.includes(i.id),
    );

    return NextResponse.json({
      picks,
      extra: extra.map((i) => ({ integrationID: i.id, name: i.name ?? i.id })),
      providers,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal membaca daftar integrasi';
    return NextResponse.json({ picks: [], extra: [], error: message }, { status: 200 });
  }
}

type ConnectBody = { integrationID?: string; key?: string };

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ConnectBody;
    const integrationID = body.integrationID ?? '';
    const key = body.key ?? '';
    if (!integrationID || !key) {
      return NextResponse.json({ error: 'integrationID dan key wajib ada' }, { status: 400 });
    }

    const client = await ensureServer();
    await client.integration.connect.key({ integrationID, key });

    // Verifikasi: muncul di provider.list?
    const providers = ((await client.provider.list())?.data ?? []).map((p) => p.id);
    if (!providers.includes(integrationID)) {
      return NextResponse.json(
        { error: `Server gak ngenalin integration "${integrationID}" setelah connect` },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, integrationID, providers });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal menyambungkan provider';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

type DisconnectBody = { integrationID?: string };

/** Putus koneksi: hapus baris credential (bentuk tabel terverifikasi di v2.0.32). */
export async function DELETE(request: Request) {
  try {
    const body = (await request.json()) as DisconnectBody;
    const integrationID = body.integrationID ?? '';
    if (!integrationID) {
      return NextResponse.json({ error: 'integrationID wajib ada' }, { status: 400 });
    }
    if (integrationID === 'openai') {
      return NextResponse.json(
        { error: 'Logout ChatGPT via tombol Hubungkan di banner (alur device code), bukan dari sini' },
        { status: 400 },
      );
    }

    const Database = (await import('better-sqlite3')).default as typeof import('better-sqlite3');
    const db = new Database('/home/ubuntu/.local/share/opencode/opencode.db');
    const info = db
      .prepare('DELETE FROM credential WHERE integration_id = ?')
      .run(integrationID);
    db.close();

    const providers = await (async () => {
      const client = await ensureServer();
      return ((await client.provider.list())?.data ?? []).map((p) => p.id);
    })();
    return NextResponse.json({ ok: true, removed: info.changes, providers });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal memutus koneksi provider';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
