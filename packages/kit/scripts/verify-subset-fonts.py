"""Checks that a subset font shapes text exactly as its source does (design research chapter 09, section 3.1: a conversion must be
verified for tables, shaping and metrics). Run by scripts/subset-fonts.ts after it writes the files; needs fontTools, brotli and uharfbuzz.

    python3 scripts/verify-subset-fonts.py <the mock's assets/fonts directory>

For each face it shapes the same strings in the source file and in the subset, with contextual alternates off as the UI sets them,
with and without tabular numerals, and compares every glyph advance and offset (glyph ids differ between the two and are not compared).
Exit code 1 when anything differs.
"""
import io
import json
import pathlib
import sys

import uharfbuzz as hb
from fontTools.ttLib import TTFont

here = pathlib.Path(__file__).resolve().parent
fonts = here.parent / "fonts"
source_root = pathlib.Path(sys.argv[1])

# Covered characters only: Latin, Latin Extended-A, punctuation, arrows, operators and the key symbols of the range.
STRINGS = [
    "Hamburgefonstiv 0123456789",
    "cart-api-7d8c6f49b-f8q4m",
    "-7x5nx i-0x5a1 2x4 ->",
    "Pods \u00b7 89 Pods \u2014 Refresh Pods \u2026 Create Pod",
    "Name namespace: checkout 2/2 Running 17d 1,025 of 5,025",
    "Za\u017c\u00f3\u0142\u0107 g\u0119\u015bl\u0105 ja\u017a\u0144 \u010ce\u0161tina T\u00fcrk\u00e7e \u2014 \u20ac \u2122 \u2264 \u2265 \u2248 \u2192 \u2190 \u2191 \u2193 \u2318 \u21e7 \u2325 \u2303 \u21b5",
    "The quick brown fox jumps over the lazy dog. AVATAR To Wa Yo",
]
FEATURES = [{"calt": False}, {"calt": False, "tnum": True}, {}]


def font_of(blob: hb.Blob) -> hb.Font:
    return hb.Font(hb.Face(blob))


def uncompressed(path: pathlib.Path) -> hb.Blob:
    """A WOFF2 file as the plain font it holds, for HarfBuzz."""
    font = TTFont(path)
    font.flavor = None
    out = io.BytesIO()
    font.save(out)
    return hb.Blob(out.getvalue())


def advances(font: hb.Font, text: str, features: dict) -> list:
    buffer = hb.Buffer()
    buffer.add_str(text)
    buffer.guess_segment_properties()
    hb.shape(font, buffer, features)
    return [(position.x_advance, position.x_offset, position.y_offset) for position in buffer.glyph_positions]


manifest = json.loads((fonts / "manifest.json").read_text())
compared = 0
different = 0
for face in manifest["faces"]:
    source = font_of(hb.Blob.from_file_path(str(source_root / pathlib.Path(face["source"]["file"]).relative_to("app/OmniviewNativeLab/frontend/mock/assets/fonts"))))
    subset = font_of(uncompressed(fonts / face["file"]))
    for features in FEATURES:
        for text in STRINGS:
            compared += 1
            if advances(source, text, features) != advances(subset, text, features):
                different += 1
                print(f"DIFFERENT {face['file']} {features} {text!r}")

print(f"shaping compared on {compared} strings: {different} differences")
sys.exit(1 if different else 0)
