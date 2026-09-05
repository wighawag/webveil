#!/usr/bin/env bash
# Contact sheet: per variant, mark @240 on light, mark @240 on dark, icon @64/32/16.
set -euo pipefail
cd "$(dirname "$0")"

LIGHT='#f8fafc'
DARK='#12141a'
OUT="${OUT:-sheet.png}"
VARIANTS=("$@")
if [ ${#VARIANTS[@]} -eq 0 ]; then
	VARIANTS=(a-refraction b-trail c-brokenring d-blanksender)
fi

command -v inkscape >/dev/null || { echo "need inkscape" >&2; exit 1; }
echo "rasteriser: $(command -v inkscape)"

T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT

rows=()
for v in "${VARIANTS[@]}"; do
	sed 's/color: #0f172a/color: #eef1f6/' "$v.svg" > "$T/$v-dark.svg"
	sed 's/color: #0f172a/color: #eef1f6/' "$v-icon.svg" > "$T/$v-idark.svg"

	inkscape "$v.svg"           -o "$T/l.png"  -w 960 >/dev/null 2>&1
	inkscape "$T/$v-dark.svg"   -o "$T/d.png"  -w 960 >/dev/null 2>&1
	inkscape "$v-icon.svg"      -o "$T/i.png"  -w 960 >/dev/null 2>&1
	inkscape "$T/$v-idark.svg"  -o "$T/id.png" -w 960 >/dev/null 2>&1

	magick "$T/l.png" -background "$LIGHT" -flatten -resize 240x240 "$T/L.png"
	magick "$T/d.png" -background "$DARK"  -flatten -resize 240x240 "$T/D.png"
	cells=("$T/L.png" "$T/D.png")
	for s in 64 32 16; do
		magick "$T/i.png" -background "$LIGHT" -flatten -resize ${s}x${s} \
			-background "$LIGHT" -gravity center -extent 110x240 "$T/S$s.png"
		cells+=("$T/S$s.png")
	done
	for s in 64 32 16; do
		magick "$T/id.png" -background "$DARK" -flatten -resize ${s}x${s} \
			-background "$DARK" -gravity center -extent 110x240 "$T/K$s.png"
		cells+=("$T/K$s.png")
	done
	magick -background '#e2e6ee' -fill '#1b2130' -pointsize 20 -size 150x240 \
		-gravity center label:"$v" "$T/tag.png"
	magick "$T/tag.png" "${cells[@]}" +append -bordercolor '#9aa3b2' -border 1 "$T/row-$v.png"
	rows+=("$T/row-$v.png")
done

magick -size 150x34 xc:'#e2e6ee' "$T/h0.png"
magick -background '#e2e6ee' -fill '#1b2130' -pointsize 18 -size 242x34 -gravity center label:'mark / light' "$T/h1.png"
magick -background '#e2e6ee' -fill '#1b2130' -pointsize 18 -size 242x34 -gravity center label:'mark / dark' "$T/h2.png"
magick -background '#e2e6ee' -fill '#1b2130' -pointsize 18 -size 332x34 -gravity center label:'icon light 64/32/16' "$T/h3.png"
magick -background '#e2e6ee' -fill '#1b2130' -pointsize 18 -size 334x34 -gravity center label:'icon dark 64/32/16' "$T/h4.png"
magick "$T/h0.png" "$T/h1.png" "$T/h2.png" "$T/h3.png" "$T/h4.png" +append "$T/head.png"

magick "$T/head.png" "${rows[@]}" -append "$OUT"
echo "wrote $OUT"
