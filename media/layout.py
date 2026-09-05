#!/usr/bin/env python3
"""Derivation record for the webveil brand sources.

This script SOLVES the layout numbers (type sizes to a measured ink box, mark
placement) and emits the four authored SVG sources. It is not part of the
normal build: `build.sh` only rasterises and outlines what is committed here.

Re-run this ONLY when the copy, the typeface or the mark geometry changes:

    python3 media/layout.py

It points fontconfig at ./fonts itself, so it needs no font installed either.

Why sizes are solved rather than written by hand: a nominal font-size is not
comparable across typefaces, so swapping the face would silently change the
real size of the wordmark. Every size below is solved against a *measured* ink
box (the rendered bounding box of the glyphs), which stays true across faces.
"""

import json
import os
import subprocess
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
FONTS = HERE / "fonts"
FAM = "SpaceGroteskWV"
ACCENT = "#7C4DFF"
INK_LIGHT = "#eef1f6"
INK_DARK = "#0f172a"
MUTED = "#8e97a8"
PLATE = "#12141a"

WORD = "webveil"
TAG = "account-free web search + fetch"

# The canonical mark. Two accent arcs of one circle, cut flat on a radius, and
# an ink bar that enters the top gap, jogs, and leaves the bottom gap displaced.
# Measured ink box of this group, in its own 256 user units:
MARK_BOX = (34.5667, 13.5, 186.867, 229.0)
MARK = """  <g id="mark" fill="none">
    <g stroke="{accent}" stroke-width="27" stroke-linecap="butt">
      <path d="M133.0 207.8 A80 80 0 0 1 72.8 70.1"/>
      <path d="M123.0 48.2 A80 80 0 0 1 183.2 185.9"/>
    </g>
    <path d="M96 22 L96 96 L160 164 L160 234" stroke="currentColor"
          stroke-width="17" stroke-linecap="butt" stroke-linejoin="miter"/>
  </g>""".format(accent=ACCENT)

# The icon is a SIMPLIFIED mark, not a scaled one: a bigger ring, heavier
# strokes and a wider jog, so the displacement still reads at 32px.
ICON_BOX = (24.0446, 18.0, 207.911, 220.0)
MARK_ICON = """  <g id="mark-icon" fill="none">
    <g stroke="{accent}" stroke-width="32" stroke-linecap="butt">
      <path d="M137.4 215.5 A88 88 0 0 1 64.6 67.0"/>
      <path d="M118.6 40.5 A88 88 0 0 1 191.4 189.0"/>
    </g>
    <path d="M92 18 L92 94 L164 166 L164 238" stroke="currentColor"
          stroke-width="26" stroke-linecap="butt" stroke-linejoin="miter"/>
  </g>""".format(accent=ACCENT)

def _fontconfig():
    """Point fontconfig at the vendored font for the length of this run, so the
    solved sizes come from the SAME file build.sh will outline with."""
    d = tempfile.mkdtemp(prefix="webveil-fc-")
    conf = Path(d) / "fonts.conf"
    conf.write_text(
        '<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n'
        f"<fontconfig><dir>{FONTS}</dir><dir>/usr/share/fonts</dir>"
        f"<cachedir>{d}/cache</cachedir></fontconfig>\n"
    )
    return str(conf)


ENV = dict(os.environ, FONTCONFIG_FILE=_fontconfig())
X0, Y0 = 200.0, 400.0


def ink(text, size, tracking=0.0):
    """Rendered ink box of `text`. dx = ink left minus the text anchor x;
    asc = baseline minus ink top. SVG places text by BASELINE, so both are
    needed to put an ink box at an exact coordinate."""
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="800">'
        f'<text id="t" x="{X0}" y="{Y0}" xml:space="preserve" '
        f"style=\"font-family:'{FAM}';font-size:{size}px;letter-spacing:{tracking}px\">"
        f"{text}</text></svg>"
    )
    with tempfile.NamedTemporaryFile("w", suffix=".svg", delete=False) as fh:
        fh.write(svg)
        p = fh.name
    out = subprocess.run(
        ["inkscape", p, "--query-all"], capture_output=True, text=True, env=ENV
    ).stdout
    os.unlink(p)
    for line in out.splitlines():
        f = line.split(",")
        if f[0] == "t":
            x, y, w, h = (float(v) for v in f[1:5])
            return {"dx": x - X0, "asc": Y0 - y, "w": w, "h": h,
                    "size": size, "tracking": tracking}
    raise SystemExit(f"no ink box for {text!r}:\n{out}")


def solve(text, tracking=0.0, height=None, width=None):
    """Scale the font size until the ink box hits a target. Text width is
    linear in size, so this converges immediately."""
    s = 100.0
    for _ in range(5):
        m = ink(text, s, tracking)
        s *= (height / m["h"]) if height else (width / m["w"])
    return ink(text, round(s, 4), tracking)


def place(box, x, y, height):
    """Transform putting a group's ink `box` at (x, y) with a given ink height."""
    bx, by, _, bh = box
    s = height / bh
    return f"translate({x - bx * s:.4f},{y - by * s:.4f}) scale({s:.7f})", s


def text_el(m, x, y, fill, el_id):
    """A <text> whose INK top-left lands exactly on (x, y).

    The id survives outlining, which is how build.sh finds the glyph path
    afterwards: Inkscape RESOLVES currentColor to a literal hex when it converts
    text to paths, so the ink has to be put back by id."""
    return (
        f'<text id="{el_id}" x="{x - m["dx"]:.4f}" y="{y + m["asc"]:.4f}" '
        f'fill="{fill}" xml:space="preserve" '
        f"style=\"font-family:'{FAM}';font-size:{m['size']}px;"
        f"letter-spacing:{m['tracking']}px\">"
    )


def main():
    solved = {}

    # ---------------------------------------------------------------- logo.svg
    (HERE / "logo.svg").write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" '
        f'width="256" height="256" role="img" aria-label="webveil" '
        f'style="color: {INK_DARK}">\n'
        f"  <title>webveil</title>\n"
        f"  <defs>\n{MARK}\n  </defs>\n"
        f'  <use href="#mark"/>\n'
        f"</svg>\n"
    )

    # ---------------------------------------------------------------- icon.svg
    # Plate corner radius is 18% of the side. The mark is inset to ~12% margins:
    # at scale 1 it sits at 7%, which looks cramped against the rounded corners.
    ICON_H = 196.0
    it, _ = place(ICON_BOX, (256 - ICON_BOX[2] * ICON_H / ICON_BOX[3]) / 2,
                  (256 - ICON_H) / 2, ICON_H)
    (HERE / "icon.svg").write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" '
        f'width="256" height="256" role="img" aria-label="webveil" '
        f'style="color: {INK_LIGHT}">\n'
        f"  <title>webveil</title>\n"
        f"  <defs>\n{MARK_ICON}\n  </defs>\n"
        f'  <rect width="256" height="256" rx="46" fill="{PLATE}"/>\n'
        f'  <use href="#mark-icon" transform="{it}"/>\n'
        f"</svg>\n"
    )

    # ------------------------------------------------------- logo-wordmark.src
    MH, WH, GAP = 200.0, 102.0, 46.0
    w = solve(WORD, height=WH)
    solved["lockup_word"] = w
    mt, _ = place(MARK_BOX, 0.0, 0.0, MH)
    mark_w = MARK_BOX[2] * MH / MARK_BOX[3]
    word_x = mark_w + GAP
    total_w = word_x + w["w"]
    (HERE / "logo-wordmark.src.svg").write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {total_w:.3f} {MH:.0f}" width="{total_w:.3f}" '
        f'height="{MH:.0f}" role="img" aria-label="webveil" '
        f'style="color: {INK_DARK}">\n'
        f"  <title>webveil</title>\n"
        f"  <defs>\n{MARK}\n  </defs>\n"
        f'  <use href="#mark" transform="{mt}"/>\n'
        f'  {text_el(w, word_x, (MH - WH) / 2, "currentColor", "wordmark")}{WORD}</text>\n'
        f"</svg>\n"
    )

    # ------------------------------------------------------------- preview.src
    W, H = 1280, 640
    CMH, CWH, CGAP = 300.0, 140.0, 64.0
    RULE_W, RULE_H, RULE_GAP, TAG_GAP = 120.0, 6.0, 20.0, 34.0
    cw = solve(WORD, height=CWH)
    ct = solve(TAG, tracking=0.4, width=600.0)
    solved["card_word"], solved["card_tag"] = cw, ct

    mark_w_c = MARK_BOX[2] * CMH / MARK_BOX[3]
    block_h = CWH + RULE_GAP + RULE_H + TAG_GAP + ct["h"]
    lock_w = mark_w_c + CGAP + max(cw["w"], ct["w"])
    lock_x = (W - lock_w) / 2                      # centre the lockup AS A GROUP
    text_x = lock_x + mark_w_c + CGAP
    block_y = H / 2 - block_h / 2
    mt_c, _ = place(MARK_BOX, lock_x, H / 2 - CMH / 2, CMH)

    def tex(cx, cy, k, op):
        return (f'    <use href="#mark" opacity="{op}" '
                f'transform="translate({cx - 128 * k:.2f},{cy - 128 * k:.2f}) '
                f'scale({k})"/>\n')

    (HERE / "preview.src.svg").write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
        f'width="{W}" height="{H}" role="img" '
        f'aria-label="webveil - {TAG}" style="color: {INK_LIGHT}">\n'
        f"  <title>webveil - {TAG}</title>\n"
        f"  <defs>\n{MARK}\n"
        f'    <radialGradient id="glow" cx="18%" cy="82%" r="62%">\n'
        f'      <stop offset="0" stop-color="{ACCENT}" stop-opacity="0.16"/>\n'
        f'      <stop offset="1" stop-color="{ACCENT}" stop-opacity="0"/>\n'
        f"    </radialGradient>\n"
        f"  </defs>\n"
        f'  <rect width="{W}" height="{H}" fill="{PLATE}"/>\n'
        f'  <rect width="{W}" height="{H}" fill="url(#glow)"/>\n'
        f"  <g>\n{tex(1206, 74, 2.4, 0.05)}{tex(96, 592, 1.8, 0.05)}"
        f"{tex(1218, 556, 1.2, 0.05)}  </g>\n"
        f'  <use href="#mark" transform="{mt_c}"/>\n'
        f'  {text_el(cw, text_x, block_y, INK_LIGHT, "wordmark")}{WORD}</text>\n'
        f'  <rect x="{text_x:.4f}" y="{block_y + CWH + RULE_GAP:.4f}" '
        f'width="{RULE_W}" height="{RULE_H}" fill="{ACCENT}"/>\n'
        f'  {text_el(ct, text_x, block_y + CWH + RULE_GAP + RULE_H + TAG_GAP, MUTED, "tagline")}'
        f"{TAG}</text>\n"
        f"</svg>\n"
    )

    (HERE / "solved.json").write_text(json.dumps(solved, indent=1) + "\n")
    for k, v in solved.items():
        print(f"{k:14} size={v['size']:9.4f}px  ink {v['w']:8.3f} x {v['h']:7.3f}")
    print("wrote logo.svg icon.svg logo-wordmark.src.svg preview.src.svg solved.json")


if __name__ == "__main__":
    main()
