#!/usr/bin/env bash
#
# Regenerates every derived brand asset from the committed SVG sources.
#
#   authored   logo.svg  icon.svg  logo-wordmark.src.svg  preview.src.svg
#   generated  logo-wordmark.svg  preview.svg  preview.png  icon.png
#
# Run it twice and the generated files are byte-identical. Nothing here needs a
# font installed on the machine: the .src.svg files carry live text, this script
# converts that text to outlines using the vendored font in ./fonts, and the
# outlined .svg files are what everything else consumes.
#
set -euo pipefail
cd "$(dirname "$0")"

# --- rasteriser ------------------------------------------------------------
# ImageMagick will happily accept an SVG and render it through its own weak
# internal delegate, so name the rasteriser explicitly and prove which one ran.
command -v inkscape >/dev/null || { echo "error: inkscape not found" >&2; exit 1; }
command -v magick   >/dev/null || { echo "error: imagemagick not found" >&2; exit 1; }
echo "rasteriser: $(inkscape --version 2>/dev/null | head -1)"

# --- fonts, without installing anything ------------------------------------
FC=$(mktemp -d)
trap 'rm -rf "$FC"' EXIT
cat > "$FC/fonts.conf" <<EOF
<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
 <dir>$PWD/fonts</dir>
 <dir>/usr/share/fonts</dir>
 <cachedir>$FC/cache</cachedir>
</fontconfig>
EOF
export FONTCONFIG_FILE="$FC/fonts.conf"

# --- drift check -----------------------------------------------------------
# The same mark geometry is duplicated into three files, because each needs a
# different ink colour and framing. That duplication rots silently, so compare
# the load-bearing path data and FAIL BEFORE RENDERING rather than shipping
# three marks that no longer match.
geom() {
	grep -o 'd="M133\.0 207\.8[^"]*"\|d="M123\.0 48\.2[^"]*"\|d="M96 22[^"]*"\|stroke-width="27"\|stroke-width="17"' "$1" \
		| tr -d ' ' | sort -u
}
ref=$(geom logo.svg)
[ -n "$ref" ] || { echo "error: no mark geometry found in logo.svg" >&2; exit 1; }
for f in logo-wordmark.src.svg preview.src.svg; do
	if [ "$ref" != "$(geom "$f")" ]; then
		echo "error: mark geometry in $f has drifted from logo.svg" >&2
		diff <(echo "$ref") <(geom "$f") >&2 || true
		exit 1
	fi
done

# The icon is a deliberately DIFFERENT, simplified mark (heavier strokes, wider
# jog) so the displacement still reads at 32px. It has no sibling to be
# compared against, so assert the two things that would silently break it:
# that it still carries its own geometry, and that nobody pasted the logo mark
# into it.
grep -q 'stroke-width="32"' icon.svg && grep -q 'stroke-width="26"' icon.svg || {
	echo "error: icon.svg no longer carries the simplified icon geometry" >&2; exit 1; }
grep -q 'rx="46"' icon.svg || { echo "error: icon.svg lost its opaque plate" >&2; exit 1; }
! grep -q 'M133\.0 207\.8' icon.svg || {
	echo "error: icon.svg contains the LOGO mark; it must use the simplified one" >&2; exit 1; }
echo "drift check: ok"

# --- outline the type ------------------------------------------------------
for n in logo-wordmark preview; do
	inkscape "$n.src.svg" --export-text-to-path --export-plain-svg -o "$n.svg" >/dev/null 2>&1
	grep -q '<text' "$n.svg" && { echo "error: text survived outlining in $n.svg" >&2; exit 1; }
done

# Inkscape RESOLVES currentColor to a literal hex while outlining, which
# silently welds the wordmark to the light theme (the mark keeps currentColor
# because it lives in <defs>). Put the ink back.
sed -i 's/fill:#0f172a/fill:currentColor/' logo-wordmark.svg
grep -q 'fill:currentColor' logo-wordmark.svg || {
	echo "error: could not restore currentColor on the outlined wordmark" >&2; exit 1; }

# The mark's ink is currentColor so ONE file serves both themes, but an <img>
# cannot set currentColor. Ship a light-ink twin for dark backgrounds; GitHub
# picks between them with <picture media="(prefers-color-scheme: dark)">.
sed 's/color: #0f172a/color: #eef1f6/' logo-wordmark.svg > logo-wordmark-dark.svg
cmp -s logo-wordmark.svg logo-wordmark-dark.svg && {
	echo "error: ink colour substitution did not apply to logo-wordmark-dark.svg" >&2; exit 1; }

# ...and prove the twin is legible on a dark plate, rather than trusting that
# the substitution reached the wordmark. This is the check that catches the
# currentColor trap: measure contrast in the WORDMARK region, don't assume it.
contrast() { # svg, background -> stddev of the right-hand (wordmark) 60%
	inkscape "$1" -o "$FC/c.png" -w 900 >/dev/null 2>&1
	magick "$FC/c.png" -background "$2" -flatten -gravity east -crop '60x100%+0+0' \
		+repage -colorspace gray -format '%[fx:standard_deviation]' info:
}
for pair in 'logo-wordmark.svg|#f8fafc' 'logo-wordmark-dark.svg|#12141a'; do
	f=${pair%%|*}; bg=${pair##*|}
	sd=$(contrast "$f" "$bg")
	if awk -v v="$sd" 'BEGIN{exit !(v < 0.15)}'; then
		echo "error: $f wordmark has almost no contrast on $bg (stddev $sd)" >&2
		exit 1
	fi
done
echo "wordmark contrast: ok on both themes"

# --- rasterise (always at 2x, then downsample) -----------------------------
inkscape preview.svg -o "$FC/preview@2x.png" -w 2560 >/dev/null 2>&1
magick "$FC/preview@2x.png" -resize 1280x640 -strip preview.png
inkscape icon.svg -o "$FC/icon@2x.png" -w 1024 >/dev/null 2>&1
magick "$FC/icon@2x.png" -resize 512x512 -strip icon.png

# --- prove the outlines still match the live text --------------------------
inkscape preview.src.svg -o "$FC/live.png" -w 1280 >/dev/null 2>&1
inkscape preview.svg     -o "$FC/out.png"  -w 1280 >/dev/null 2>&1
d=$(magick compare -metric AE "$FC/live.png" "$FC/out.png" null: 2>&1 || true)
if [ "$d" != "0" ]; then
	echo "error: outlined preview.svg differs from live-text preview.src.svg ($d px)" >&2
	exit 1
fi
echo "outline check: 0 differing pixels"

echo "ok: logo-wordmark.svg logo-wordmark-dark.svg preview.svg preview.png icon.png"
