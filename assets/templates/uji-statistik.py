#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
uji-statistik.py — paket uji statistik standar skripsi dalam satu CLI.

Mencakup: deskriptif, normalitas Shapiro-Wilk, korelasi Pearson & Spearman,
uji-t independen / Welch, one-way ANOVA (+ Welch ANOVA & Tukey HSD),
uji-t berpasangan, regresi linear berganda (VIF, Durbin-Watson, diagnostik
residual), dan Cronbach's alpha.

Contoh:
    python uji-statistik.py --data sample.xlsx
    python uji-statistik.py --data sample.xlsx --group kelompok
    python uji-statistik.py --data sample.xlsx --y prestasi --x motivasi,dukungan_orangtua
    python uji-statistik.py --data sample.xlsx --items item1,item2,item3 --out hasil.md

Dependensi: pandas, scipy, statsmodels, openpyxl.
"""

from __future__ import annotations

import argparse
import math
import sys
import warnings
from pathlib import Path

VERSION = "1.0"

INSTALL_HINT = """python3 -m venv .venv
.venv/bin/pip install pandas scipy statsmodels openpyxl"""

_IMPORT_ERR = None
try:
    import numpy as np
    import pandas as pd
    import scipy
    from scipy import stats as st
except ImportError as exc:  # pragma: no cover
    _IMPORT_ERR = exc
    np = pd = st = scipy = None  # type: ignore

_SM_ERR = None
try:
    import statsmodels.api as sm
    from statsmodels.stats.diagnostic import het_breuschpagan
    from statsmodels.stats.multicomp import pairwise_tukeyhsd
    from statsmodels.stats.oneway import anova_oneway
    from statsmodels.stats.outliers_influence import variance_inflation_factor
    from statsmodels.stats.stattools import durbin_watson
except ImportError as exc:  # pragma: no cover
    _SM_ERR = exc
    sm = None  # type: ignore


# --------------------------------------------------------------------------
# Util
# --------------------------------------------------------------------------

def die(msg: str, code: int = 3) -> "NoReturn":  # noqa: F821
    print(f"ERROR: {msg}", file=sys.stderr)
    raise SystemExit(code)


def check_deps() -> None:
    if _IMPORT_ERR is not None:
        die(
            "dependency dasar belum terpasang "
            f"({_IMPORT_ERR}).\nInstall dulu:\n{INSTALL_HINT}",
            2,
        )
    if _SM_ERR is not None:
        die(
            "statsmodels belum terpasang "
            f"({_SM_ERR}).\nInstall dulu:\n{INSTALL_HINT}",
            2,
        )


def fmt(x, d: int = 2, dash: str = "–") -> str:
    """Format angka; NA/None jadi dash."""
    if x is None:
        return dash
    try:
        xf = float(x)
    except (TypeError, ValueError):
        return str(x)
    if math.isnan(xf):
        return dash
    if math.isinf(xf):
        return "∞" if xf > 0 else "−∞"
    return f"{xf:.{d}f}"


def fmt_p(p) -> str:
    if p is None:
        return "–"
    try:
        pf = float(p)
    except (TypeError, ValueError):
        return "–"
    if math.isnan(pf):
        return "–"
    if pf < 0.001:
        return "<0.001"
    return f"{pf:.4f}"


def stars(p) -> str:
    try:
        pf = float(p)
    except (TypeError, ValueError):
        return ""
    if math.isnan(pf):
        return ""
    if pf < 0.001:
        return "***"
    if pf < 0.01:
        return "**"
    if pf < 0.05:
        return "*"
    return ""


def verdict(p, alpha: float, positif: str = "signifikan", negatif: str = "tidak signifikan") -> str:
    try:
        pf = float(p)
    except (TypeError, ValueError):
        return "–"
    if math.isnan(pf):
        return "–"
    return f"**{positif}**" if pf < alpha else negatif


def md_table(headers, rows, aligns: str | None = None) -> str:
    """Tabel markdown sederhana. aligns: 'l'/'r'/'c' per kolom."""
    headers = [str(h) for h in headers]
    rows = [[("" if c is None else str(c)).replace("|", "\\|") for c in r] for r in rows]
    ncol = len(headers)
    for i, r in enumerate(rows):
        if len(r) != ncol:
            raise ValueError(f"baris tabel ke-{i} punya {len(r)} sel, harus {ncol}")

    widths = [len(h) for h in headers]
    for r in rows:
        for i, c in enumerate(r):
            widths[i] = max(widths[i], len(c))

    if not aligns:
        aligns = "l" * ncol

    def line(cells):
        return "| " + " | ".join(c.ljust(widths[i]) for i, c in enumerate(cells)) + " |"

    sep_cells = []
    for i in range(ncol):
        a = aligns[i]
        w = widths[i]
        if a == "r":
            sep_cells.append("-" * (w + 1) + ":")
        elif a == "c":
            sep_cells.append(":" + "-" * w + ":")
        else:
            sep_cells.append("-" * (w + 1))

    out = [line(headers), "|" + "|".join(sep_cells) + "|"]
    out += [line(r) for r in rows]
    return "\n".join(out)


def natural_key(v):
    s = str(v)
    try:
        return (0, float(s), "")
    except ValueError:
        return (1, 0.0, s)


def labelize(s: "pd.Series") -> "pd.Series":
    """Ubah kolom grup jadi label string yang rapi."""
    if pd.api.types.is_numeric_dtype(s):
        return s.map(lambda v: f"{v:g}" if pd.notna(v) else np.nan)
    out = s.astype("string").str.strip()
    return out.replace("", pd.NA)


class Report:
    def __init__(self) -> None:
        self.parts: list[str] = []
        self.n = 0

    def line(self, text: str = "") -> None:
        self.parts.append(text)

    def h1(self, text: str) -> None:
        self.parts.append(f"# {text}")

    def section(self, title: str, body: str) -> None:
        self.n += 1
        self.parts.append(f"## {self.n}. {title}\n\n{body.strip()}")

    def raw(self, text: str) -> None:
        self.parts.append(text.strip())

    def render(self) -> str:
        return "\n\n".join(p for p in self.parts if p is not None).strip() + "\n"


# --------------------------------------------------------------------------
# IO & validasi
# --------------------------------------------------------------------------

def load_table(path: str, sheet: str | None):
    p = Path(path).expanduser()
    if not p.exists():
        die(f"file data tidak ditemukan: {p}", 3)
    suffix = p.suffix.lower()

    if suffix in {".xlsx", ".xlsm"}:
        try:
            xls = pd.ExcelFile(p, engine="openpyxl")
        except Exception as exc:
            die(f"gagal membaca Excel {p.name}: {exc}", 3)
        names = list(xls.sheet_names)
        used = sheet or names[0]
        if used not in names:
            die(
                f"sheet '{used}' tidak ada. Sheet tersedia: {', '.join(names)}",
                3,
            )
        try:
            df = pd.read_excel(xls, sheet_name=used)
        except Exception as exc:
            die(f"gagal membaca sheet '{used}': {exc}", 3)
        return df, f"{p.name} (sheet: {used})", names

    if suffix == ".xls":
        die("format .xls lama tidak didukung; simpan ulang sebagai .xlsx", 3)

    if suffix in {".csv", ".txt", ".tsv"}:
        enc = "utf-8-sig"
        try:
            head = p.read_text(encoding=enc, errors="replace")[:8192]
        except Exception as exc:
            die(f"gagal membaca {p.name}: {exc}", 3)
        first = next((ln for ln in head.splitlines() if ln.strip()), "")
        cands = [",", ";", "\t", "|"]
        sep = max(cands, key=lambda c: first.count(c))
        if first.count(sep) == 0:
            sep = ","
        try:
            df = pd.read_csv(p, sep=sep, encoding=enc)
        except Exception as exc:
            die(f"gagal membaca CSV {p.name}: {exc}", 3)
        return df, f"{p.name} (delimiter: {repr(sep)})", []

    die(f"format file tidak didukung: {suffix or '(tanpa ekstensi)'} — pakai .xlsx atau .csv", 3)


def resolve_col(name: str, columns, flag: str) -> str:
    if name in columns:
        return name
    low = {}
    for c in columns:
        low.setdefault(str(c).strip().lower(), c)
    key = name.strip().lower()
    if key in low:
        return low[key]
    die(
        f"kolom '{name}' (dari {flag}) tidak ditemukan.\n"
        f"Kolom tersedia: {', '.join(str(c) for c in columns)}",
        3,
    )


def parse_cols(raw: str | None, columns, flag: str) -> list[str]:
    if not raw:
        return []
    out: list[str] = []
    for part in raw.split(","):
        name = part.strip()
        if not name:
            continue
        col = resolve_col(name, columns, flag)
        if col not in out:
            out.append(col)
    if not out:
        die(f"{flag} kosong; isi dengan nama kolom dipisah koma", 3)
    return out


def is_numeric_like(s: "pd.Series") -> bool:
    if pd.api.types.is_bool_dtype(s):
        return False
    if pd.api.types.is_numeric_dtype(s):
        return True
    if pd.api.types.is_object_dtype(s) or pd.api.types.is_string_dtype(s):
        nn = s.dropna()
        if nn.empty:
            return False
        conv = pd.to_numeric(
            nn.astype(str).str.strip().str.replace(",", ".", regex=False),
            errors="coerce",
        )
        return bool(conv.notna().all())
    return False


def coerce_numeric(df: "pd.DataFrame"):
    """Konversi kolom teks yang sepenuhnya numerik (termasuk desimal koma)."""
    out = df.copy()
    converted = []
    for c in out.columns:
        if pd.api.types.is_numeric_dtype(out[c]) or pd.api.types.is_bool_dtype(out[c]):
            continue
        if is_numeric_like(out[c]):
            out[c] = pd.to_numeric(
                out[c].astype(str).str.strip().str.replace(",", ".", regex=False),
                errors="coerce",
            )
            converted.append(str(c))
    return out, converted


def drop_missing(df: "pd.DataFrame", cols: list[str]):
    sub = df[cols].dropna()
    dropped = len(df) - len(sub)
    detail = {}
    if dropped:
        complete = df[cols].notna().all(axis=1)
        for c in cols:
            miss = int(df.loc[~complete, c].isna().sum())
            if miss:
                detail[str(c)] = miss
    return sub, dropped, detail


def drop_note(dropped: int, detail: dict[str, int]) -> str:
    if dropped == 0:
        return "_Tidak ada data terbuang (0 baris)._\n"
    parts = ", ".join(f"`{k}`={v}" for k, v in detail.items())
    return (
        f"_Data terbuang: **{dropped} baris** karena missing value"
        + (f" ({parts})" if parts else "")
        + "; analisis memakai listwise deletion._\n"
    )


def cohens_d(a, b) -> float:
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    na, nb = len(a), len(b)
    sp2 = ((na - 1) * a.var(ddof=1) + (nb - 1) * b.var(ddof=1)) / (na + nb - 2)
    if sp2 <= 0:
        return float("nan")
    return float((a.mean() - b.mean()) / math.sqrt(sp2))


def d_label(d: float) -> str:
    ad = abs(d)
    if math.isnan(ad):
        return "–"
    if ad < 0.2:
        return "sangat kecil"
    if ad < 0.5:
        return "kecil"
    if ad < 0.8:
        return "sedang"
    return "besar"


def eta_sq(groups) -> float:
    allv = np.concatenate([np.asarray(g, dtype=float) for g in groups])
    grand = allv.mean()
    ss_b = sum(len(g) * (np.asarray(g, dtype=float).mean() - grand) ** 2 for g in groups)
    ss_w = sum(((np.asarray(g, dtype=float) - np.asarray(g, dtype=float).mean()) ** 2).sum() for g in groups)
    ss_t = ss_b + ss_w
    return float(ss_b / ss_t) if ss_t > 0 else float("nan")


def welch_df(a, b) -> float:
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    va = a.var(ddof=1) / len(a)
    vb = b.var(ddof=1) / len(b)
    den = (va ** 2) / (len(a) - 1) + (vb ** 2) / (len(b) - 1)
    if den <= 0:
        return float("nan")
    return float((va + vb) ** 2 / den)


# --------------------------------------------------------------------------
# Analisis
# --------------------------------------------------------------------------

def sec_descriptives(df: "pd.DataFrame", cols: list[str], alpha: float) -> str:
    rows = []
    skewed = []
    for c in cols:
        s = df[c].dropna()
        if len(s) < 3:
            continue
        sd = float(s.std(ddof=1))
        skew = float(s.skew())
        kurt = float(s.kurt())
        rows.append([
            f"`{c}`", len(s), fmt(s.mean()), fmt(sd), fmt(s.min()), fmt(s.max()),
            fmt(s.median()), fmt(skew), fmt(kurt),
        ])
        if abs(skew) > 1:
            skewed.append((c, skew))

    body = [
        "Statistik dihitung per kolom setelah missing value dibuang (pairwise, bukan listwise).\n",
        md_table(
            ["Variabel", "n", "Mean", "SD", "Min", "Maks", "Median", "Skew", "Kurtosis*"],
            rows,
            "lrrrrrrrr",
        ),
        "\n\\* Kurtosis yang dilaporkan adalah *excess kurtosis* (0 = sebaran normal).",
    ]
    if skewed:
        txt = "; ".join(f"`{c}` (skew={fmt(s):.2f})" for c, s in skewed)
        body.append(
            f"\n**Catatan:** {txt} cukup menceng (|skew| > 1), pertimbangkan transformasi "
            "atau statistik non-parametrik."
        )
    else:
        body.append(
            "\n**Catatan:** semua variabel punya |skew| ≤ 1, sebaran cukup simetris."
        )
    return "\n".join(body)


def sec_normality(df: "pd.DataFrame", cols: list[str], alpha: float) -> str:
    rows = []
    abnormal = []
    skipped = []
    for c in cols:
        s = df[c].dropna()
        if len(s) < 3 or s.nunique() < 2:
            skipped.append(c)
            continue
        try:
            w, p = st.shapiro(s.to_numpy(dtype=float))
        except Exception:
            skipped.append(c)
            continue
        rows.append([
            f"`{c}`", len(s), fmt(w, 3), fmt_p(p),
            "Normal" if p >= alpha else "**Tidak normal**",
        ])
        if p < alpha:
            abnormal.append(c)

    body = [
        f"H₀: data berdistribusi normal. Keputusan diambil pada α = {alpha:g}.",
        "",
        md_table(["Variabel", "n", "W", "p", "Keputusan"], rows, "lrrrl"),
    ]
    if skipped:
        body.append(
            "\n_Dilewati (n < 3 atau nilai konstan): "
            + ", ".join(f"`{c}`" for c in skipped)
            + "._"
        )
    if abnormal:
        body.append(
            f"\n**Interpretasi:** {len(abnormal)} dari {len(rows)} variabel tidak normal "
            f"({', '.join('`'+c+'`' for c in abnormal)}). Untuk variabel tersebut, "
            "pakai Spearman atau uji non-parametrik sebagai pembanding."
        )
    else:
        body.append(
            f"\n**Interpretasi:** semua variabel normal pada α = {alpha:g}; "
            "asumsi parametrik terpenuhi."
        )
    body.append(
        "\n_Uji Shapiro-Wilk sangat sensitif pada n besar: dengan n > 200, "
        "penyimpangan kecil bisa tampak signifikan. Cek juga skewness dan grafik Q-Q._"
    )
    return "\n".join(body)


def corr_matrix(df: "pd.DataFrame", cols: list[str], method: str):
    k = len(cols)
    r = np.full((k, k), np.nan)
    p = np.full((k, k), np.nan)
    ns = np.zeros((k, k), dtype=int)
    for i in range(k):
        r[i, i] = 1.0
        p[i, i] = 0.0
        ns[i, i] = int(df[cols[i]].notna().sum())
        for j in range(i + 1, k):
            sub = df[[cols[i], cols[j]]].dropna()
            n = len(sub)
            ns[i, j] = ns[j, i] = n
            if n < 3 or sub.iloc[:, 0].nunique() < 2 or sub.iloc[:, 1].nunique() < 2:
                continue
            try:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore")
                    if method == "pearson":
                        rr, pp = st.pearsonr(sub.iloc[:, 0], sub.iloc[:, 1])
                    else:
                        rr, pp = st.spearmanr(sub.iloc[:, 0], sub.iloc[:, 1])
            except Exception:
                continue
            r[i, j] = r[j, i] = float(rr)
            p[i, j] = p[j, i] = float(pp)
    return r, p, ns


def matrix_block(cols: list[str], r, p, *, show_stars: bool, title: str, mode: str = "r") -> str:
    headers = ["Variabel"] + [f"`{c}`" for c in cols]
    rows = []
    for i, c in enumerate(cols):
        row = [f"`{c}`"]
        for j in range(len(cols)):
            if i == j:
                row.append("1" if mode == "r" else "–")
            elif math.isnan(r[i, j]):
                row.append("–")
            elif mode == "p":
                row.append(fmt_p(p[i, j]))
            else:
                cell = f"{r[i, j]:.2f}"
                if show_stars:
                    cell += stars(p[i, j])
                row.append(cell)
        rows.append(row)
    return f"**{title}**\n\n" + md_table(headers, rows, "l" + "r" * len(cols))


def sec_correlation(df: "pd.DataFrame", cols: list[str], alpha: float) -> str:
    usable = [c for c in cols if df[c].notna().sum() >= 3]
    const_cols = [c for c in usable if df[c].nunique() < 2]
    cols = [c for c in usable if c not in const_cols]
    if len(cols) < 2:
        return "_Butuh minimal 2 kolom numerik yang bervariasi untuk korelasi._"

    rp, pp, _ = corr_matrix(df, cols, "pearson")
    rs, ps, ns = corr_matrix(df, cols, "spearman")

    body = [
        "Korelasi dihitung pairwise (setiap pasangan memakai data lengkapnya sendiri). "
        "Tanda bintang: \\* p<0.05, \\*\\* p<0.01, \\*\\*\\* p<0.001.",
        "",
        matrix_block(cols, rp, pp, show_stars=True, title="Pearson (r)"),
        "",
        matrix_block(cols, rp, pp, show_stars=False, title="p-value Pearson", mode="p"),
        "",
        matrix_block(cols, rs, ps, show_stars=True, title="Spearman (ρ)"),
        "",
        matrix_block(cols, rs, ps, show_stars=False, title="p-value Spearman", mode="p"),
    ]

    pairs = []
    for i in range(len(cols)):
        for j in range(i + 1, len(cols)):
            if math.isnan(pp[i, j]):
                continue
            pairs.append((cols[i], cols[j], rp[i, j], pp[i, j], rs[i, j], ps[i, j], ns[i, j]))
    sig = [x for x in pairs if x[3] < alpha]
    sig.sort(key=lambda x: -abs(x[2]))

    if sig:
        rows = [
            [f"`{a}` – `{b}`", fmt(r), fmt_p(p), fmt(rsr), fmt_p(psr), n,
             "ya" if p < alpha and psr < alpha else "sebagian"]
            for a, b, r, p, rsr, psr, n in sig[:12]
        ]
        body += [
            "",
            f"**Pasangan signifikan (Pearson, α={alpha:g}): {len(sig)} dari {len(pairs)}.** "
            "Diurutkan berdasarkan |r|.",
            "",
            md_table(
                ["Pasangan", "r (Pearson)", "p", "ρ (Spearman)", "p", "n", "Konsisten"],
                rows,
                "lrrrrrl",
            ),
        ]
        if len(sig) > 12:
            body.append(f"\n_(ditampilkan 12 teratas dari {len(sig)} pasangan signifikan)_")
        top = sig[0]
        body.append(
            f"\n**Interpretasi:** korelasi terkuat adalah `{top[0]}` – `{top[1]}` "
            f"(r = {fmt(top[2])}, p = {fmt_p(top[3])}), "
            + ("positif" if top[2] > 0 else "negatif")
            + f" dan {verdict(top[3], alpha)} pada α = {alpha:g}."
        )
    else:
        body.append(
            f"\n**Interpretasi:** tidak ada pasangan yang signifikan pada α = {alpha:g}."
        )
    if const_cols:
        body.append(
            "\n_Kolom konstan (varians nol) tidak diikutkan dalam matriks: "
            + ", ".join(f"`{c}`" for c in const_cols)
            + "._"
        )
    body.append(
        "\n_Korelasi ≠ kausalitas. Nilai r sekitar 0.1/0.3/0.5 lazim dibaca sebagai "
        "lemah/sedang/kuat (Cohen)._"
    )
    return "\n".join(body)


def sec_group(df: "pd.DataFrame", group_col: str, num_cols: list[str], alpha: float) -> str:
    cols = [c for c in num_cols if c != group_col]
    if not cols:
        return f"_Tidak ada kolom numerik lain selain `{group_col}`._"

    g = labelize(df[group_col])
    base = df.assign(__g=g).dropna(subset=["__g"])
    cats = sorted(base["__g"].dropna().unique().tolist(), key=natural_key)
    k = len(cats)
    if k < 2:
        die(f"kolom grup '{group_col}' hanya punya {k} kategori; butuh minimal 2", 3)

    mean_rows, test_rows, notes = [], [], []
    tukey_blocks = []
    total_used = 0
    total_dropped = 0

    for c in cols:
        sub = base[["__g", c]].dropna()
        if len(sub) == 0:
            continue
        groups = [sub.loc[sub["__g"] == cat, c].to_numpy(dtype=float) for cat in cats]
        if min(len(x) for x in groups) < 2:
            notes.append(f"`{c}` dilewati: ada kelompok dengan n < 2.")
            continue
        total_used += len(sub)
        total_dropped += len(base) - len(sub)

        mean_cells = [f"`{c}`"]
        for cat, arr in zip(cats, groups):
            mean_cells.append(f"{fmt(arr.mean())} ± {fmt(arr.std(ddof=1))} ({len(arr)})")
        mean_rows.append(mean_cells)

        try:
            lev_p = float(st.levene(*groups, center="median").pvalue)
        except Exception:
            lev_p = float("nan")

        if k == 2:
            welch = (not math.isnan(lev_p)) and lev_p < alpha
            t, p = st.ttest_ind(groups[0], groups[1], equal_var=not welch)
            dfv = welch_df(groups[0], groups[1]) if welch else len(groups[0]) + len(groups[1]) - 2
            d = cohens_d(groups[0], groups[1])
            label = "Welch t" if welch else "t (pooled)"
            test_rows.append([
                f"`{c}`", len(sub), label, fmt(t, 3), fmt(dfv, 1), fmt_p(p),
                f"d = {fmt(d)} ({d_label(d)})", verdict(p, alpha),
            ])
        else:
            eta2 = eta_sq(groups)
            welch = (not math.isnan(lev_p)) and lev_p < alpha
            df1, df2 = k - 1, len(sub) - k
            if welch:
                try:
                    res = anova_oneway(groups, use_var="unequal", welch_correction=True)
                    F, p = float(res.statistic), float(res.pvalue)
                    label = "Welch ANOVA"
                    try:
                        d1, d2 = res.df
                        df1, df2 = float(d1), float(d2)
                    except Exception:
                        pass
                except Exception:
                    F, p = st.f_oneway(*groups)
                    label = "ANOVA (F)"
            else:
                F, p = st.f_oneway(*groups)
                label = "ANOVA (F)"

            test_rows.append([
                f"`{c}`", len(sub), label, fmt(F, 3), f"{fmt(df1, 1)}, {fmt(df2, 1)}",
                fmt_p(p), f"η² = {fmt(eta2, 3)}", verdict(p, alpha),
            ])

            if p < alpha:
                try:
                    tuk = pairwise_tukeyhsd(
                        endog=sub[c].to_numpy(dtype=float),
                        groups=sub["__g"].to_numpy(),
                        alpha=alpha,
                    )
                    trows = []
                    for row in tuk.summary().data[1:]:
                        g1, g2, diff, padj, lo, hi, _rej = row
                        trows.append([
                            f"{g1} vs {g2}", fmt(diff), fmt_p(padj),
                            f"{fmt(lo, 1)} … {fmt(hi, 1)}",
                            "ya" if float(padj) < alpha else "tidak",
                        ])
                    tukey_blocks.append(
                        f"**Tukey HSD — `{c}`**\n\n"
                        + md_table(
                            ["Perbandingan", "Selisih mean", "p adj", "CI 95%", "Signifikan"],
                            trows,
                            "lrrrl",
                        )
                    )
                except Exception as exc:
                    notes.append(f"Tukey HSD untuk `{c}` gagal: {exc}")

    if not test_rows:
        msg = (
            f"_Tidak ada variabel yang bisa diuji pada `{group_col}`: setiap variabel "
            "punya minimal satu kategori dengan n < 2._"
        )
        if notes:
            msg += "\n\n**Catatan:** " + " ".join(notes)
        return msg

    body = [
        f"Kolom grup: `{group_col}` dengan **{k} kategori** "
        f"({', '.join(str(c) for c in cats)}). "
        f"Jumlah observasi dalam tabel (gabungan semua variabel): {total_used}.",
        "",
        f"**Rata-rata ± SD (n) per kategori**",
        "",
        md_table(["Variabel"] + [f"{c}" for c in cats], mean_rows, "l" + "r" * k),
        "",
        f"**Hasil uji{' (Welch bila varians tidak homogen)' if k == 2 else ''}**",
        "",
        md_table(
            ["Variabel", "n", "Uji", "Statistik", "df", "p", "Effect size", "Keputusan"],
            test_rows,
            "llrrrrrl",
        ),
        "",
        f"_Data terbuang: **{total_dropped} observasi** (akumulasi antar variabel, karena "
        "missing pada variabel yang diuji); kolom `n` menunjukkan data yang benar-benar dipakai._",
    ]

    if k == 2:
        body.append(
            "\n_Varians diuji dengan Levene (center = median). Bila p Levene < α, "
            "dipakai Welch t-test yang tidak mengasumsikan varians sama._"
        )
    else:
        body.append(
            "\n_Uji Levene dipakai untuk memilih ANOVA klasik atau Welch ANOVA. "
            "η² = proporsi varians yang dijelaskan faktor grup (0.01 kecil, 0.06 sedang, 0.14 besar). "
            "Post-hoc Tukey hanya dijalankan untuk variabel yang signifikan._"
        )

    if tukey_blocks:
        body.append("")
        body += tukey_blocks
    if notes:
        body.append("\n**Catatan:** " + " ".join(notes))

    n_sig = sum(1 for r in test_rows if "**signifikan**" in r[-1])
    body.append(
        f"\n**Interpretasi:** {n_sig} dari {len(test_rows)} variabel berbeda "
        f"{'secara signifikan ' if n_sig else ''}antar kategori `{group_col}` pada α = {alpha:g}."
    )
    return "\n".join(body)


def sec_paired(df: "pd.DataFrame", cols: list[str], alpha: float) -> str:
    a, b = cols[0], cols[1]
    sub, dropped, detail = drop_missing(df, [a, b])
    if len(sub) < 3:
        return f"_Data lengkap untuk `{a}` dan `{b}` hanya {len(sub)} baris; uji berpasangan butuh ≥ 3._"

    x = sub[a].to_numpy(dtype=float)
    y = sub[b].to_numpy(dtype=float)
    diff = x - y
    t, p = st.ttest_rel(x, y)
    n = len(sub)
    se = diff.std(ddof=1) / math.sqrt(n)
    try:
        crit = float(st.t.ppf(1 - alpha / 2, n - 1))
    except Exception:
        crit = float("nan")
    lo, hi = diff.mean() - crit * se, diff.mean() + crit * se
    dz = float(diff.mean() / diff.std(ddof=1)) if diff.std(ddof=1) > 0 else float("nan")

    body = [
        f"Pasangan: `{a}` (A) vs `{b}` (B); n pasangan = **{n}**.",
        "",
        drop_note(dropped, detail),
        md_table(
            ["Statistik", "Nilai"],
            [
                ["Mean A", fmt(x.mean())],
                ["Mean B", fmt(y.mean())],
                ["Mean selisih (A − B)", fmt(diff.mean())],
                ["SD selisih", fmt(diff.std(ddof=1))],
                ["CI 95% selisih", f"{fmt(lo)} … {fmt(hi)}"],
                ["t", fmt(t, 3)],
                ["df", n - 1],
                ["p (2-tailed)", fmt_p(p)],
                ["Cohen's d (paired)", f"{fmt(dz)} ({d_label(dz)})"],
                ["Keputusan", verdict(p, alpha)],
            ],
            "lr",
        ),
        "",
        f"**Interpretasi:** rata-rata `{a}` {'lebih tinggi' if diff.mean() > 0 else 'lebih rendah'} "
        f"daripada `{b}` sebesar {fmt(abs(diff.mean()))} poin; perbedaan ini "
        f"{verdict(p, alpha)} pada α = {alpha:g}.",
    ]
    return "\n".join(body)


def sec_regression(df: "pd.DataFrame", y: str, xs: list[str], alpha: float) -> str:
    if y in xs:
        die(f"kolom target --y '{y}' tidak boleh ikut di --x", 3)
    sub, dropped, detail = drop_missing(df, [y] + xs)
    n = len(sub)
    k = len(xs)
    if n <= k + 1:
        return (
            f"_Regresi tidak bisa dijalankan: data lengkap hanya {n} baris "
            f"untuk {k} prediktor (butuh > {k + 1})._"
        )
    for c in [y] + xs:
        if sub[c].nunique() < 2:
            return f"_Regresi tidak bisa dijalankan: kolom `{c}` konstan._"

    X = sm.add_constant(sub[xs].astype(float), has_constant="add")
    yv = sub[y].astype(float)
    try:
        model = sm.OLS(yv, X).fit()
    except Exception as exc:
        return f"_Regresi gagal: {exc}_"

    params = model.params
    bse = model.bse
    tvals = model.tvalues
    pvals = model.pvalues
    ci = model.conf_int()

    try:
        dw = float(durbin_watson(model.resid))
    except Exception:
        dw = float("nan")

    Xv = X.to_numpy(dtype=float)
    vifs = []
    for i in range(k):
        if k == 1:
            vifs.append(1.0)
            continue
        try:
            vifs.append(float(variance_inflation_factor(Xv, i + 1)))
        except Exception:
            vifs.append(float("nan"))

    sd_y = float(yv.std(ddof=1))
    rows = []
    rows.append([
        "Konstanta", fmt(params.iloc[0]), fmt(bse.iloc[0]), "–",
        fmt(tvals.iloc[0], 3), fmt_p(pvals.iloc[0]), "–",
        f"{fmt(ci.iloc[0, 0])} … {fmt(ci.iloc[0, 1])}",
    ])
    for i, c in enumerate(xs):
        idx = list(params.index).index(c)
        beta = float(params.iloc[idx]) * float(sub[c].std(ddof=1)) / sd_y if sd_y > 0 else float("nan")
        rows.append([
            f"`{c}`", fmt(params.iloc[idx]), fmt(bse.iloc[idx]), fmt(beta, 3),
            fmt(tvals.iloc[idx], 3), fmt_p(pvals.iloc[idx]), fmt(vifs[i]),
            f"{fmt(ci.iloc[idx, 0])} … {fmt(ci.iloc[idx, 1])}",
        ])

    f_stat = float(model.fvalue) if model.fvalue is not None else float("nan")
    f_p = float(model.f_pvalue) if model.f_pvalue is not None else float("nan")

    # Diagnostik residual
    diag_rows = [
        ["Shapiro-Wilk residual", fmt_p(st.shapiro(model.resid).pvalue) if 3 <= n <= 5000 else "–",
         "residual normal" if (3 <= n <= 5000 and st.shapiro(model.resid).pvalue >= alpha) else "cek Q-Q plot"],
    ]
    try:
        bp = het_breuschpagan(model.resid, model.model.exog)
        diag_rows.append([
            "Breusch-Pagan (heteroskedastisitas)", fmt_p(bp[1]),
            "homoskedastis" if bp[1] >= alpha else "indikasi heteroskedastisitas",
        ])
    except Exception:
        pass
    diag_rows.append([
        "Durbin-Watson", fmt(dw, 3),
        "tidak ada autokorelasi berarti" if 1.5 <= dw <= 2.5 else "cek autokorelasi",
    ])
    max_vif = max([v for v in vifs if not math.isnan(v)], default=float("nan"))
    diag_rows.append([
        "VIF maksimum", fmt(max_vif),
        "aman (< 10)" if (not math.isnan(max_vif) and max_vif < 10) else "indikasi multikolinearitas",
    ])

    eq_terms = []
    for i, c in enumerate(xs):
        idx = list(params.index).index(c)
        b = float(params.iloc[idx])
        eq_terms.append(f"{'+ ' if b >= 0 else '− '}{fmt(abs(b))}·{c}")
    equation = f"{y} = {fmt(float(params.iloc[0]))} " + " ".join(eq_terms)

    # Prediktor signifikan
    sig_pred = []
    for c in xs:
        idx = list(params.index).index(c)
        if float(pvals.iloc[idx]) < alpha:
            sig_pred.append(c)

    body = [
        f"Model: `{y}` ~ {', '.join('`'+c+'`' for c in xs)} · n = **{n}** · k = {k} prediktor.",
        "",
        drop_note(dropped, detail),
        md_table(
            ["Variabel", "B", "SE", "β (std)", "t", "p", "VIF", "CI 95% B"],
            rows,
            "lrrrrrrl",
        ),
        "",
        "**Ringkasan model**",
        "",
        md_table(
            ["Statistik", "Nilai"],
            [
                ["R", fmt(math.sqrt(max(model.rsquared, 0)), 3)],
                ["R²", fmt(model.rsquared, 3)],
                ["Adjusted R²", fmt(model.rsquared_adj, 3)],
                ["F", f"{fmt(f_stat, 3)} (df = {int(model.df_model)}, {int(model.df_resid)})"],
                ["p (F)", fmt_p(f_p)],
                ["Durbin-Watson", fmt(dw, 3)],
                ["n", n],
            ],
            "lr",
        ),
        "",
        "**Diagnostik asumsi**",
        "",
        md_table(["Pemeriksaan", "p / nilai", "Pembacaan"], diag_rows, "lrl"),
        "",
        f"**Persamaan regresi:** `{equation}`",
        "",
        f"**Interpretasi:** model secara keseluruhan {verdict(f_p, alpha)} pada α = {alpha:g} "
        f"(F = {fmt(f_stat)}, p = {fmt_p(f_p)}) dan menjelaskan "
        f"{fmt(model.rsquared * 100, 1)}% varians `{y}` (R² = {fmt(model.rsquared, 3)}).",
    ]
    if sig_pred:
        bits = []
        for c in sig_pred:
            idx = list(params.index).index(c)
            b = float(params.iloc[idx])
            bits.append(
                f"`{c}` (B = {fmt(b)}, {'menaikkan' if b > 0 else 'menurunkan'})"
            )
        body.append(
            "Prediktor yang signifikan secara individual: "
            + ", ".join(bits)
            + "; nilai B menunjukkan perubahan `" + y + "` per 1 satuan prediktor "
            "dengan prediktor lain dianggap tetap."
        )
    else:
        body.append(
            f"Tidak ada prediktor yang signifikan secara individual pada α = {alpha:g}, "
            "meskipun model bisa tetap signifikan secara simultan."
        )
    if not math.isnan(max_vif) and max_vif >= 10:
        body.append(
            f"\n**Peringatan multikolinearitas:** VIF maksimum {fmt(max_vif)} ≥ 10; "
            "koefisien individual bisa tidak stabil."
        )
    body.append(
        "\n_Asumsi yang perlu dicek: linearitas, residual normal, homoskedastisitas, "
        "tidak ada multikolinearitas ekstrem, dan tidak ada outlier berpengaruh "
        "(cek Cook's distance)._"
    )
    return "\n".join(body)


def alpha_of(sub: "pd.DataFrame") -> float:
    k = sub.shape[1]
    if k < 2:
        return float("nan")
    item_var = sub.var(ddof=1)
    total_var = sub.sum(axis=1).var(ddof=1)
    if total_var <= 0:
        return float("nan")
    return float(k / (k - 1) * (1 - item_var.sum() / total_var))


def alpha_label(a: float) -> str:
    if math.isnan(a):
        return "–"
    if a >= 0.90:
        return "sangat baik"
    if a >= 0.80:
        return "baik"
    if a >= 0.70:
        return "cukup (umumnya diterima)"
    if a >= 0.60:
        return "meragukan"
    if a >= 0.50:
        return "buruk"
    return "tidak dapat diterima"


def sec_cronbach(df: "pd.DataFrame", items: list[str], alpha: float) -> str:
    sub, dropped, detail = drop_missing(df, items)
    n = len(sub)
    k = len(items)
    if n < 3:
        return f"_Data lengkap untuk item hanya {n} baris; butuh ≥ 3._"

    zero = [c for c in items if sub[c].nunique() < 2]
    if zero:
        return (
            "_Cronbach's alpha tidak bisa dihitung: item tanpa variasi (konstan): "
            + ", ".join(f"`{c}`" for c in zero)
            + "._"
        )

    a = alpha_of(sub)
    item_var = sub.var(ddof=1)
    total_var = sub.sum(axis=1).var(ddof=1)
    total = sub.sum(axis=1)

    # standardized alpha
    try:
        R = sub.corr().to_numpy(dtype=float)
        rbar = (np.nansum(R) - k) / (k * (k - 1))
        a_std = float(k * rbar / (1 + (k - 1) * rbar)) if (1 + (k - 1) * rbar) != 0 else float("nan")
    except Exception:
        a_std = float("nan")

    rows = []
    for c in items:
        rest = total - sub[c]
        try:
            r_it = float(np.corrcoef(sub[c].to_numpy(dtype=float), rest.to_numpy(dtype=float))[0, 1])
        except Exception:
            r_it = float("nan")
        a_del = alpha_of(sub.drop(columns=[c]))
        rows.append([
            f"`{c}`", fmt(sub[c].mean()), fmt(sub[c].std(ddof=1)), fmt(r_it, 3), fmt(a_del, 3),
        ])

    body = [
        f"Jumlah item: **{k}** · n responden lengkap: **{n}**.",
        "",
        drop_note(dropped, detail),
        md_table(
            ["Item", "Mean", "SD", "Corrected item-total r", "Alpha jika item dihapus"],
            rows,
            "lrrrr",
        ),
        "",
        md_table(
            ["Statistik", "Nilai", "Pembacaan"],
            [
                ["Cronbach's alpha", fmt(a, 3), alpha_label(a)],
                ["Standardized alpha", fmt(a_std, 3), alpha_label(a_std)],
                ["Jumlah item", k, "–"],
                ["Varians total skor", fmt(total_var, 3), "–"],
            ],
            "lrl",
        ),
        "",
        f"**Interpretasi:** alpha = **{fmt(a, 3)}** tergolong *{alpha_label(a)}*. "
        + (
            "Instrumen "
            + ("**reliabel**" if a >= 0.70 else "belum reliabel")
            + " pada ambang lazim 0.70."
            if not math.isnan(a)
            else "Alpha tidak bisa dihitung (varians total nol)."
        ),
    ]

    worst = None
    for c in items:
        a_del = alpha_of(sub.drop(columns=[c]))
        if worst is None or (not math.isnan(a_del) and a_del > worst[1]):
            worst = (c, a_del)
    if worst and not math.isnan(worst[1]) and worst[1] > a + 0.01:
        body.append(
            f"\n**Saran:** alpha naik menjadi {fmt(worst[1], 3)} bila item `{worst[0]}` "
            "dihapus — cek kembali isi item tersebut sebelum dibuang."
        )
    body.append(
        "\n_Alpha mengukur konsistensi internal, bukan validitas. Butuh ≥ 3 item "
        "agar nilai alpha bermakna; item dengan skala berbeda arah (reverse-scored) "
        "harus dibalik dulu sebelum dihitung._"
    )
    return "\n".join(body)


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="uji-statistik.py",
        description="Paket uji statistik standar skripsi (deskriptif, normalitas, korelasi, "
                    "uji-t, ANOVA, regresi, Cronbach's alpha) -> laporan Markdown.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""Contoh:
  uji-statistik.py --data sample.xlsx
  uji-statistik.py --data sample.xlsx --group kelompok --out grup.md
  uji-statistik.py --data sample.xlsx --y prestasi --x motivasi,dukungan_orangtua
  uji-statistik.py --data sample.xlsx --items item1,item2,item3
  uji-statistik.py --data data.csv --paired sebelum,sesudah
""",
    )
    p.add_argument("--data", required=True, help="path file .xlsx atau .csv")
    p.add_argument("--sheet", default=None, help="nama sheet Excel (default: sheet pertama)")
    p.add_argument("--alpha", type=float, default=0.05, help="taraf signifikansi (default 0.05)")
    p.add_argument("--out", default=None, help="tulis laporan ke file ini (default: stdout)")
    p.add_argument("--y", default=None, help="kolom target regresi")
    p.add_argument("--x", default=None, help="kolom prediktor, dipisah koma")
    p.add_argument("--group", default=None, help="kolom kategorikal untuk uji beda kelompok")
    p.add_argument("--items", default=None, help="item skala (>=2), dipisah koma, untuk Cronbach's alpha")
    p.add_argument("--paired", default=None, help="dua kolom untuk paired t-test: kolA,kolB")
    p.add_argument("--version", action="version", version=f"%(prog)s {VERSION}")
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    check_deps()

    if not (0 < args.alpha < 1):
        die("--alpha harus di antara 0 dan 1 (mis. 0.05)", 3)

    df_raw, source, sheet_names = load_table(args.data, args.sheet)
    if df_raw.empty:
        die("file data kosong (0 baris)", 3)

    # rapikan nama kolom
    df_raw.columns = [str(c).strip() for c in df_raw.columns]
    df, converted = coerce_numeric(df_raw)
    columns = list(df.columns)

    num_cols = [c for c in columns if is_numeric_like(df[c])]
    if not num_cols:
        die("tidak ada kolom numerik yang terdeteksi di dataset", 3)

    # validasi flag
    y = resolve_col(args.y, columns, "--y") if args.y else None
    xs = parse_cols(args.x, columns, "--x")
    group = resolve_col(args.group, columns, "--group") if args.group else None
    items = parse_cols(args.items, columns, "--items")
    paired = parse_cols(args.paired, columns, "--paired")

    if y and not xs:
        die("--y butuh --x (daftar prediktor, dipisah koma)", 3)
    if xs and not y:
        die("--x butuh --y (kolom target)", 3)
    if y and y not in num_cols:
        die(f"--y '{y}' bukan kolom numerik", 3)
    for c in xs:
        if c not in num_cols:
            die(f"--x '{c}' bukan kolom numerik", 3)
    for c in items:
        if c not in num_cols:
            die(f"--items '{c}' bukan kolom numerik", 3)
    for c in paired:
        if c not in num_cols:
            die(f"--paired '{c}' bukan kolom numerik", 3)
    if paired and len(paired) != 2:
        die(f"--paired butuh tepat 2 kolom, diberi {len(paired)}", 3)
    if args.items and len(items) < 2:
        die("--items butuh minimal 2 kolom", 3)
    if group and group in num_cols and df[group].nunique() > 10:
        die(
            f"--group '{group}' numerik dengan {df[group].nunique()} nilai unik; "
            "sepertinya bukan kolom kategorikal",
            3,
        )

    # kolom deskriptif: numerik, tapi buang kolom target grup bila sangat banyak level
    desc_cols = [c for c in num_cols if not (c == group and df[c].nunique() > 10)]

    rep = Report()
    rep.h1("Laporan Uji Statistik")
    rep.line(
        f"**Sumber data:** `{source}`  \n"
        f"**Alpha (α):** {args.alpha:g}  \n"
        f"**Baris:** {len(df)} · **Kolom:** {len(columns)} · "
        f"**Kolom numerik:** {len(num_cols)}  \n"
        f"**Dibuat oleh:** `uji-statistik.py` v{VERSION} (pandas {pd.__version__}, "
        f"scipy {scipy.__version__}, statsmodels {sm.__version__})"
    )

    # 1. Gambaran data
    overview_rows = []
    for c in columns:
        s = df[c]
        nn = int(s.notna().sum())
        miss = int(s.isna().sum())
        if c in num_cols:
            tip = "numerik"
        else:
            tip = f"kategorikal ({s.nunique(dropna=True)} level)"
        contoh = s.dropna().unique()[:3]
        if c in num_cols:
            contoh_txt = ", ".join(f"{float(v):g}" for v in contoh) if len(contoh) else "–"
        else:
            contoh_txt = ", ".join(str(v) for v in contoh) if len(contoh) else "–"
        overview_rows.append([f"`{c}`", tip, nn, miss, int(s.nunique(dropna=True)), contoh_txt])
    rep.section(
        "Gambaran Data",
        md_table(["Kolom", "Tipe", "Non-null", "Missing", "Unik", "Contoh nilai"],
                 overview_rows, "llrrrl")
        + "\n\n"
        + (
            f"Kolom yang otomatis dikonversi ke numerik: {', '.join('`'+c+'`' for c in converted)}.\n"
            if converted else ""
        )
        + f"Total sel missing: **{int(df.isna().sum().sum())}** dari {len(df) * len(columns)} sel. "
          "Setiap analisis memakai listwise deletion pada kolom yang dipakainya saja, "
          "sehingga n bisa berbeda antar bagian.",
    )

    # 2. Deskriptif
    if desc_cols:
        rep.section("Statistik Deskriptif", sec_descriptives(df, desc_cols, args.alpha))

    # 3. Normalitas
    if desc_cols:
        rep.section("Uji Normalitas (Shapiro-Wilk)", sec_normality(df, desc_cols, args.alpha))

    # 4. Korelasi
    rep.section("Korelasi Pearson & Spearman", sec_correlation(df, desc_cols, args.alpha))

    # 5. Uji kelompok
    if group:
        rep.section(
            f"Uji Beda Kelompok (`{group}`)",
            sec_group(df, group, desc_cols, args.alpha),
        )

    # 6. Paired
    if paired:
        rep.section(
            f"Uji-t Berpasangan (`{paired[0]}` vs `{paired[1]}`)",
            sec_paired(df, paired, args.alpha),
        )

    # 7. Regresi
    if y and xs:
        rep.section(
            f"Regresi Linear Berganda (`{y}`)",
            sec_regression(df, y, xs, args.alpha),
        )

    # 8. Cronbach
    if items:
        rep.section("Reliabilitas (Cronbach's Alpha)", sec_cronbach(df, items, args.alpha))

    rep.raw(
        "## Catatan Metodologis\n\n"
        "- Semua analisis memakai **listwise deletion** per bagian: baris yang punya missing "
        "pada kolom yang dipakai saja yang dibuang, dan jumlahnya dilaporkan di tiap bagian.\n"
        "- Uji dua sisi (two-tailed) dipakai untuk semua uji-t dan korelasi.\n"
        "- Korelasi dilaporkan berpasangan (pairwise), sehingga n tiap sel matriks bisa berbeda.\n"
        "- Asumsi regresi (linearitas, normalitas residual, homoskedastisitas, tidak ada "
        "multikolinearitas) diperiksa lewat diagnostik di bagian regresi; hasil uji otomatis "
        "bukan pengganti inspeksi grafik.\n"
        "- Output deterministik: tidak ada langkah acak dan tidak ada timestamp, sehingga "
        "dataset yang sama menghasilkan laporan yang sama."
    )

    text = rep.render()

    if args.out:
        outp = Path(args.out).expanduser()
        try:
            outp.parent.mkdir(parents=True, exist_ok=True)
            outp.write_text(text, encoding="utf-8")
        except Exception as exc:
            die(f"gagal menulis output ke {outp}: {exc}", 3)
        print(f"OK: laporan ditulis ke {outp} ({len(text.splitlines())} baris)")
        n_sections = rep.n
        print(f"Seksi: {n_sections} · baris data: {len(df)} · kolom numerik: {len(num_cols)}")
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
