#!/usr/bin/env python3
"""Subsets the terminal fonts for the shell (client-architecture.md §8.4).

The build needs no Python: this runs by hand, and its output (assets/fonts/*.woff2) is
committed. The source is JetBrains Mono NL Nerd Font Mono, Regular and Bold; the files the
first web build shipped are in git history:

    git show f9618f1:web/assets/fonts/JetBrainsMonoNLNerdFontMono-Regular.woff2 > /tmp/src/Regular.woff2
    git show f9618f1:web/assets/fonts/JetBrainsMonoNLNerdFontMono-Bold.woff2    > /tmp/src/Bold.woff2
    python3 -m venv /tmp/fontenv && /tmp/fontenv/bin/pip install fonttools brotli
    /tmp/fontenv/bin/python web/scripts/subset-fonts.py /tmp/src web/assets/fonts

The core face comes in Regular and Bold (Latin, Latin-1, punctuation, arrows, box drawing,
block elements, Powerline), loaded before the first paint. One symbols fallback (Regular;
icons have one weight) holds the Nerd Font icon ranges, is loaded after the first paint and
is listed second in --font-mono.
"""
import sys
from pathlib import Path

from fontTools import subset

CORE = (
    "U+0020-007E,U+00A0-00FF,U+0131,U+0152-0153,U+02C6,U+02DA,U+02DC,"
    "U+2010-2027,U+2030-203A,U+2044,U+20AC,U+2122,U+2190-21FF,U+2212,U+2215,"
    "U+2500-257F,U+2580-259F,U+25A0-25FF,U+2713-2717,"
    "U+E0A0-E0A3,U+E0B0-E0B3,U+E0B4-E0D4"
)
# Powerline, Seti-UI, Devicons, Octicons and a few IEC symbols: 130 KB against the 150 KB
# budget. Font Awesome (80 KB), Codicons (40 KB) and Material (400 KB) don't fit; the probe
# gate (client-architecture.md §12) says whether Jimmy's prompt needs any of them.
SYMBOLS = "U+E0A0-E0D7,U+E5FA-E6B8,U+E700-E7C5,U+F400-F532,U+23FB-23FE,U+2665,U+26A1,U+2B58"


def build(src: Path, dst: Path, unicodes: str) -> None:
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["kern", "liga", "calt"] if dst.name.startswith("tether-mono-") else []
    options.name_IDs = [1, 2]
    options.notdef_outline = True
    options.hinting = False
    font = subset.load_font(str(src), options)
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=subset.parse_unicodes(unicodes))
    subsetter.subset(font)
    subset.save_font(font, str(dst), options)
    print(f"{dst.name}: {dst.stat().st_size:,} bytes")


def main() -> None:
    src_dir, out_dir = Path(sys.argv[1]), Path(sys.argv[2])
    out_dir.mkdir(parents=True, exist_ok=True)
    build(src_dir / "Regular.woff2", out_dir / "tether-mono-regular.woff2", CORE)
    build(src_dir / "Bold.woff2", out_dir / "tether-mono-bold.woff2", CORE)
    build(src_dir / "Regular.woff2", out_dir / "tether-symbols.woff2", SYMBOLS)


if __name__ == "__main__":
    main()
