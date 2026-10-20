#!/usr/bin/env python3
"""Pack v3: ganti alias klon dengan font ASLI Microsoft (core fonts for the Web,
diunduh oleh ttf-mscorefonts-installer dari server Microsoft) + hapus duplikat
klon yang sudan digantikan, jadi list font WordCraft bersih kayak list Word.

Output: data/wordcraft-fonts/ (file baru wp-*, manifest version 3).
Dasar resmi:
- 11 corefont Word (Arial, Times New Roman, dsb.) = file asli MS, bebas
  diredistribusi lewat EULA corefonts.
- Calibri/Cambria/Palatino Linotype TIDAK bebas → tetap klon metrik (Carlito,
  Caladea, TeX Gyre Pagella) yang ukurannya identik.
"""
import json
import os
from datetime import datetime, timezone
from fontTools.ttLib import TTFont

PACK = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data", "wordcraft-fonts"))
MST = "/usr/share/fonts/truetype/msttcorefonts"

# File ASLI MS (sumber → tujuan, keluarga). Tidak di-rename: nama internalnya
# sudah "Times New Roman", "Arial", dst.
REAL = {
    "times.ttf": ("wp-TimesNewRoman-Regular.ttf", "Times New Roman"),
    "timesbd.ttf": ("wp-TimesNewRoman-Bold.ttf", "Times New Roman"),
    "timesi.ttf": ("wp-TimesNewRoman-Italic.ttf", "Times New Roman"),
    "timesbi.ttf": ("wp-TimesNewRoman-BoldItalic.ttf", "Times New Roman"),
    "arial.ttf": ("wp-Arial-Regular.ttf", "Arial"),
    "arialbd.ttf": ("wp-Arial-Bold.ttf", "Arial"),
    "ariali.ttf": ("wp-Arial-Italic.ttf", "Arial"),
    "arialbi.ttf": ("wp-Arial-BoldItalic.ttf", "Arial"),
    "ariblk.ttf": ("wp-ArialBlack-Regular.ttf", "Arial Black"),
    "andalemo.ttf": ("wp-AndaleMono-Regular.ttf", "Andale Mono"),
    "comic.ttf": ("wp-ComicSansMS-Regular.ttf", "Comic Sans MS"),
    "comicbd.ttf": ("wp-ComicSansMS-Bold.ttf", "Comic Sans MS"),
    "cour.ttf": ("wp-CourierNew-Regular.ttf", "Courier New"),
    "courbd.ttf": ("wp-CourierNew-Bold.ttf", "Courier New"),
    "couri.ttf": ("wp-CourierNew-Italic.ttf", "Courier New"),
    "courbi.ttf": ("wp-CourierNew-BoldItalic.ttf", "Courier New"),
    "georgia.ttf": ("wp-Georgia-Regular.ttf", "Georgia"),
    "georgiab.ttf": ("wp-Georgia-Bold.ttf", "Georgia"),
    "georgiai.ttf": ("wp-Georgia-Italic.ttf", "Georgia"),
    "georgiaz.ttf": ("wp-Georgia-BoldItalic.ttf", "Georgia"),
    "impact.ttf": ("wp-Impact-Regular.ttf", "Impact"),
    "trebuc.ttf": ("wp-TrebuchetMS-Regular.ttf", "Trebuchet MS"),
    "trebucbd.ttf": ("wp-TrebuchetMS-Bold.ttf", "Trebuchet MS"),
    "trebucit.ttf": ("wp-TrebuchetMS-Italic.ttf", "Trebuchet MS"),
    "trebucbi.ttf": ("wp-TrebuchetMS-BoldItalic.ttf", "Trebuchet MS"),
    "verdana.ttf": ("wp-Verdana-Regular.ttf", "Verdana"),
    "verdanab.ttf": ("wp-Verdana-Bold.ttf", "Verdana"),
    "verdanai.ttf": ("wp-Verdana-Italic.ttf", "Verdana"),
    "verdanaz.ttf": ("wp-Verdana-BoldItalic.ttf", "Verdana"),
    "webdings.ttf": ("wp-Webdings-Regular.ttf", "Webdings"),
}

# Duplikat alias/kron (sudan digantikan oleh file asli di atas daripada alias
# yang sama bentuknya) → remove dari manifest + disk.
PRUNE = [
    "wp-ComicSansMS-Regular.otf",
    "wp-ComicSansMS-Bold.otf",
    "wp-ComicSansMS-Italic.otf",
    "wp-ComicSansMS-BoldItalic.otf",
    "wp-Georgia-Variable.ttf",
    "wp-Georgia-ItalicVariable.ttf",
    "Carlito-Regular.ttf", "Carlito-Bold.ttf", "Carlito-Italic.ttf", "Carlito-BoldItalic.ttf",
    "Caladea-Regular.ttf", "Caladea-Bold.ttf", "Caladea-Italic.ttf", "Caladea-BoldItalic.ttf",
    "LiberationSerif-Regular.ttf", "LiberationSerif-Bold.ttf", "LiberationSerif-Italic.ttf", "LiberationSerif-BoldItalic.ttf",
    "LiberationSans-Regular.ttf", "LiberationSans-Bold.ttf", "LiberationSans-Italic.ttf", "LiberationSans-BoldItalic.ttf",
    "LiberationMono-Regular.ttf", "LiberationMono-Bold.ttf", "LiberationMono-Italic.ttf", "LiberationMono-BoldItalic.ttf",
    "Gelasio(wght).ttf",
    "Gelasio-Italic(wght).ttf",
]


def fam_of(path: str) -> tuple[str, str]:
    f = TTFont(path)
    n = f["name"]
    family = n.getDebugName(16) or n.getDebugName(1) or "?"
    style = n.getDebugName(2) or "Regular"
    return family, style


def main() -> None:
    man_path = os.path.join(PACK, "manifest.json")
    man = json.load(open(man_path))
    by_file = {e["file"]: e for e in man["fonts"]}

    replaced, added, skipped = [], [], []
    for src, (outname, _family) in REAL.items():
        srcp = os.path.join(MST, src)
        if not os.path.exists(srcp):
            print("SKIP (font asli gak ada):", src)
            skipped.append(src)
            continue
        fam, style = fam_of(srcp)
        outp = os.path.join(PACK, outname)
        with open(srcp, "rb") as reader, open(outp, "wb") as writer:
            writer.write(reader.read())
        entry = {"file": outname, "bytes": os.path.getsize(outp), "family": fam, "group": "ms-core"}
        if outname in by_file:
            by_file[outname] = {**by_file[outname], **entry}
            replaced.append(outname)
        else:
            by_file[outname] = entry
            added.append(outname)

    pruned = []
    for fname in PRUNE:
        if fname in by_file:
            del by_file[fname]
        fpath = os.path.join(PACK, fname)
        if os.path.exists(fpath):
            os.remove(fpath)
        pruned.append(fname)

    man["fonts"] = sorted(by_file.values(), key=lambda e: e["file"])
    man["version"] = 3
    man["generated"] = datetime.now(timezone.utc).isoformat()
    json.dump(man, open(man_path, "w"), indent=1)

    fams = {e["family"] for e in man["fonts"]}
    print("asli terpasang:", len(REAL) - len(skipped), "| replaced:", len(replaced), "| baru:", len(added) + len(replaced), "| pruned:", len(pruned))
    print("total files:", len(man["fonts"]), "| total families:", len(fams))
    new_fams = sorted({by_file[f]["family"] for f in set(added) | set(replaced)} & {e["family"] for e in man["fonts"]})
    print("families ms-core:", new_fams)


if __name__ == "__main__":
    main()
