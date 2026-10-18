import { NextResponse } from 'next/server';
import { rewriteHtml, proxyErrorHtml } from '@/lib/proxy/html';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * PROXY browser-in-app (fase 3.5d): halaman di-fetch di server, header anti-frame
 * TIDAK ikut diteruskan (kita yang bikin response sendiri), link ditulis ulang
 * supaya navigasi tetap di-dalam tab tengah.
 * Keamanan SSRF: hanya http(s) ke host publik — private/localhost diblok.
 */

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const MAX_BYTES = 8 * 1024 * 1024;

function isPublicHttpUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return null;
    if (/^127\.|^10\.|^192\.168\.|^169\.254\./.test(host)) return null;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return null;
    if (host === '[::1]' || host === '::1' || host === '0.0.0.0') return null;
    return url;
  } catch {
    return null;
  }
}

function errorPage(context: string, detail: string): NextResponse {
  return new NextResponse(proxyErrorHtml(context, detail), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function GET(request: Request) {
  const reqUrl = new URL(request.url);
  const raw = reqUrl.searchParams.get('url') ?? '';
  const target = isPublicHttpUrl(raw);
  if (!target) return errorPage('URL tidak valid', 'Alamat harus http(s) ke host publik.');

  // Param tambahan (?q=… hasil form di dalam tab) ikut diteruskan ke target.
  for (const [key, value] of reqUrl.searchParams) {
    if (key !== 'url' && !target.searchParams.has(key)) target.searchParams.set(key, value);
  }

  // Header terbatas yang boleh diteruskan (tanpa cookie — tab ini tanpa-sesi).
  const forwardHeaders: Record<string, string> = {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'id,en;q=0.9',
  };

  try {
    const upstream = await fetch(target.toString(), {
      headers: forwardHeaders,
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });

    const finalUrl = upstream.url || target.toString();
    const type = upstream.headers.get('content-type') ?? 'application/octet-stream';

    if (!upstream.ok && type.includes('text/html')) {
      return errorPage(
        `Gagal memuat (${upstream.status})`,
        `Situs membalas ${upstream.status}. Coba alamat lain atau buka di tab browser asli.`,
      );
    }

    // HTML → tulis ulang lalu serve (strip CSP/X-Frame otomatis karena kita yang bikin response).
    if (type.includes('text/html') || type.includes('application/xhtml')) {
      const text = await upstream.text();
      return new NextResponse(rewriteHtml(text, finalUrl), {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Robots-Tag': 'noindex',
        },
      });
    }

    // Bukan HTML (gambar/teks/pdf/…) → passthrough dengan content-type asli.
    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.length > MAX_BYTES) {
      return errorPage('Terlalu besar', 'Berkas melebihi batas 8 MB untuk tab web.');
    }
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': type,
        'Content-Disposition': 'inline',
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex',
      },
    });
  } catch (error) {
    console.error('[api/proxy] GET gagal:', error);
    return errorPage(
      'Gagal memuat halaman',
      'Situs lambat/menolak proxy atau alamat salah. Pakai tombol ↗ untuk buka di browser asli.',
    );
  }
}
