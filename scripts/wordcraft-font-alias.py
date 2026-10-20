#!/usr/bin/env python3
"""Alias font Word (metric-compatible, nama internal DIUBAH) untuk pack WordCraft.

Font open di-copy + di-rename family-nya ke nama Word asli supaya dropdown
WordCraft nampil "Calibri", "Times New Roman", dst — tanpa melanggar lisensi
(font open di-distribusi ulang; alias hanya di pasangan user ini).
File keluar: data/wordcraft-fonts/wp-<Family>-<Style>.<ttf|otf>; manifest
di-bump ke versi 2 (seeder client nyema-nyema entri baru saja).
"""
import json
import os
from fontTools.ttLib import TTFont

PACK = os.path.join(os.path.dirname(__file__), "..", "data", "wordcraft-fonts")
PACK = os.path.abspath(PACK)

APTS = {
    "liberation": "/usr/share/fonts/truetype/liberation",
    "crosextra": "/usr/share/fonts/truetype/crosextra",
    "dejavu": "/usr/share/fonts/truetype/dejavu",
    "comic": "/usr/share/fonts/opentype/comic-neue",
    "gyre": "/usr/share/texmf/fonts/opentype/public/tex-gyre",
}

# (file sumber style, file sumber path, target family)
JOBS = [
    ("Regular", f"{APTS['crosextra']}/Carlito-Regular.ttf", "Calibri"),
    ("Bold", f"{APTS['crosextra']}/Carlito-Bold.ttf", "Calibri"),
    ("Italic", f"{APTS['crosextra']}/Carlito-Italic.ttf", "Calibri"),
    ("BoldItalic", f"{APTS['crosextra']}/Carlito-BoldItalic.ttf", "Calibri"),
    ("Regular", f"{APTS['crosextra']}/Carlito-Regular.ttf", "Calibri Light"),
    ("Regular", f"{APTS['crosextra']}/Caladea-Regular.ttf", "Cambria"),
    ("Bold", f"{APTS['crosextra']}/Caladea-Bold.ttf", "Cambria"),
    ("Italic", f"{APTS['crosextra']}/Caladea-Italic.ttf", "Cambria"),
    ("BoldItalic", f"{APTS['crosextra']}/Caladea-BoldItalic.ttf", "Cambria"),
    ("Regular", f"{APTS['liberation']}/LiberationSerif-Regular.ttf", "Times New Roman"),
    ("Bold", f"{APTS['liberation']}/LiberationSerif-Bold.ttf", "Times New Roman"),
    ("Italic", f"{APTS['liberation']}/LiberationSerif-Italic.ttf", "Times New Roman"),
    ("BoldItalic", f"{APTS['liberation']}/LiberationSerif-BoldItalic.ttf", "Times New Roman"),
    ("Regular", f"{APTS['liberation']}/LiberationSans-Regular.ttf", "Arial"),
    ("Bold", f"{APTS['liberation']}/LiberationSans-Bold.ttf", "Arial"),
    ("Italic", f"{APTS['liberation']}/LiberationSans-Italic.ttf", "Arial"),
    ("BoldItalic", f"{APTS['liberation']}/LiberationSans-BoldItalic.ttf", "Arial"),
    ("Regular", f"{APTS['liberation']}/LiberationMono-Regular.ttf", "Courier New"),
    ("Bold", f"{APTS['liberation']}/LiberationMono-Bold.ttf", "Courier New"),
    ("Italic", f"{APTS['liberation']}/LiberationMono-Italic.ttf", "Courier New"),
    ("BoldItalic", f"{APTS['liberation']}/LiberationMono-BoldItalic.ttf", "Courier New"),
    ("Variable", os.path.join(PACK, "Gelasio(wght).ttf"), "Georgia"),
    ("ItalicVariable", os.path.join(PACK, "Gelasio-Italic(wght).ttf"), "Georgia"),
    ("Regular", f"{APTS['dejavu']}/DejaVuSans.ttf", "Verdana"),
    ("Bold", f"{APTS['dejavu']}/DejaVuSans-Bold.ttf", "Verdana"),
    ("Regular", f"{APTS['dejavu']}/DejaVuSans.ttf", "Tahoma"),
    ("Bold", f"{APTS['dejavu']}/DejaVuSans-Bold.ttf", "Tahoma"),
    ("Regular", f"{APTS['comic']}/ComicNeue-Regular.otf", "Comic Sans MS"),
    ("Bold", f"{APTS['comic']}/ComicNeue-Bold.otf", "Comic Sans MS"),
    ("Italic", f"{APTS['comic']}/ComicNeue-Italic.otf", "Comic Sans MS"),
    ("BoldItalic", f"{APTS['comic']}/ComicNeue-BoldItalic.otf", "Comic Sans MS"),
    ("Regular", f"{APTS['gyre']}/texgyrepagella-regular.otf", "Palatino Linotype"),
    ("Bold", f"{APTS['gyre']}/texgyrepagella-bold.otf", "Palatino Linotype"),
    ("Italic", f"{APTS['gyre']}/texgyrepagella-italic.otf", "Palatino Linotype"),
    ("BoldItalic", f"{APTS['gyre']}/texgyrepagella-bolditalic.otf", "Palatino Linotype"),
]

FAM_SAFE = lambda f: f.replace(" ", "")


def rename_font(src: str, target: str, out: str) -> None:
    font = TTFont(src)
    name = font["name"]
    sub = name.getDebugName(2) or "Regular"
    full = f"{target} {sub}".strip()
    ps = FAM_SAFE(full)[:63]
    for rec in list(name.names):
        if rec.nameID == 1 or rec.nameID == 16:
            rec.string = target
        elif rec.nameID == 4:
            rec.string = full
        elif rec.nameID == 6:
            rec.string = ps
        elif rec.nameID == 3:
            rec.string = f"wp-{FAM_SAFE(target)}-{os.path.basename(out)}"
    font.save(out)


def main() -> None:
    added = []
    for style, src, target in JOBS:
        if not os.path.exists(src):
            print("SKIP (sumber hilang):", src)
            continue
        ext = ".ttf" if src.lower().endswith(".ttf") else ".otf"
        safe = FAM_SAFE(target)
        out = os.path.join(PACK, f"wp-{safe}-{style}{ext}")
        if os.path.exists(out) and os.path.getsize(out) > 0:
            pass
        else:
            rename_font(src, target, out)
        added.append({"file": os.path.basename(out), "family": target, "style": style})

    man_path = os.path.join(PACK, "manifest.json")
    man = json.load(open(man_path))
    have = {e["file"] for e in man["fonts"]}
    for a in added:
        if a["file"] in have:
            continue
        man["fonts"].append(
            {
                "file": a["file"],
                "bytes": os.path.getsize(os.path.join(PACK, a["file"])),
                "family": a["family"],
                "group": "word-alias",
            }
        )
    man["version"] = 2
    man["generated"] = __import__("datetime").datetime.utcnow().isoformat() + "Z"
    man["fonts"].sort(key=lambda e: e["file"])
    json.dump(man, open(man_path, "w"), indent=1)

    fams = {e["family"] for e in man["fonts"]}
    print("alias files:", len(added), "| total files:", len(man["fonts"]), "| total families:", len(fams))
    print("families kelompok word-alias:", sorted({a['family'] for a in added}))


if __name__ == "__main__":
    main()
