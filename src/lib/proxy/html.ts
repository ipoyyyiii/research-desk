/**
 * HTML rewriter untuk proxy browser-in-app:
 * - Buang tag yang bikin halaman nolak di-frame (CSP meta).
 * - Ganti semua <a href> jadi lewat /api/proxy biar navigasi tetap di-dalam tab.
 * - Subresource (img/css/js) tetap direct ke origin asli via <base> — cepat & aman.
 * - Form GET dibungkus proxy biar pencarian di dalam halaman tetap jalan.
 */
const CSP_META_RE = /<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi;

function proxied(absoluteUrl: string): string {
  return `/api/proxy?url=${encodeURIComponent(absoluteUrl)}`;
}

function absolutize(raw: string, base: string): string | null {
  try {
    const value = raw.trim();
    if (!value || value.startsWith('#')) return null;
    return new URL(value, base).toString();
  } catch {
    return null;
  }
}

/** href yang gak boleh dibungkus (biar perilaku aslinya tetap). */
function skipHref(value: string): boolean {
  const lower = value.trim().toLowerCase();
  return (
    lower.startsWith('#') ||
    lower.startsWith('javascript:') ||
    lower.startsWith('mailto:') ||
    lower.startsWith('tel:') ||
    lower.startsWith('data:')
  );
}

export function rewriteHtml(html: string, baseUrl: string): string {
  let out = html;

  // 1) Buang meta CSP (yang bikin browser nolak render di-frame).
  out = out.replace(CSP_META_RE, '');

  // 2) <a href="…"> → absolut + lewat proxy (kecuali anchor/JS/mailto).
  out = out.replace(/(<a\b[^>]*?\bhref=)["']([^"']*)["']/gi, (match, prefix: string, value: string) => {
    if (skipHref(value)) return match;
    const abs = absolutize(value, baseUrl);
    if (!abs) return match;
    return `${prefix}"${proxied(abs)}"`;
  });

  // 3) <form action="…"> GET-only → dibungkus proxy (querystring ikut lewat URL param).
  out = out.replace(
    /(<form\b[^>]*?\baction=)["']([^"']*)["']([^>]*>)/gi,
    (match, prefix: string, value: string, suffix: string) => {
      const methodMatch = /method=["']?(\w+)/i.exec(suffix);
      if (methodMatch && methodMatch[1] && methodMatch[1].toLowerCase() !== 'get') return match;
      const abs = absolutize(value || baseUrl, baseUrl);
      if (!abs) return match;
      return `${prefix}"${proxied(abs)}"${suffix}`;
    },
  );

  // 4) Suntik <base> ke seluruh subresource relatif → tetap direct origin asli.
  const baseTag = `\n<base href="${baseUrl.replace(/"/g, '&quot;')}">`;
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head[^>]*>/i, (match) => `${match}${baseTag}`);
  } else {
    out = `${baseTag}\n${out}`;
  }

  return out;
}

/** Halaman HTML error kecil untuk iframe (ganti JSON mentah). */
export function proxyErrorHtml(title: string, detail: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#f8fafc;color:#0f172a">
<div style="max-width:420px;padding:24px;text-align:center">
<p style="font-size:13px;color:#64748b;margin-bottom:8px">${detail}</p>
</div></body></html>`;
}
