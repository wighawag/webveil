# webveil brand assets

## What the mark means

Two accent arcs of one circle, cut flat on a radius, and an ink bar that enters the top gap, **jogs sideways**, and leaves the bottom gap displaced. The request goes in at one point and comes out somewhere else, and the ring that would have joined the two ends is open at exactly the places it crosses: unlinkable in, unlinkable out, no closed loop and nobody in the middle holding both halves.

That is the differentiator the brief settled on, drawn rather than symbolised. webveil is not "we hide you", it is "there is no account, and no intermediary who could know you".

## Files

| File | Authored / generated | Produced by |
| --- | --- | --- |
| `logo.svg` | authored | `layout.py` (re-derive), then hand-editable |
| `icon.svg` | authored | `layout.py` (re-derive), then hand-editable |
| `logo-wordmark.src.svg` | authored, **live text** | `layout.py` |
| `preview.src.svg` | authored, **live text** | `layout.py` |
| `logo-wordmark.svg` | generated (outlined) | `build.sh` |
| `logo-wordmark-dark.svg` | generated (outlined, light ink) | `build.sh` |
| `preview.svg` | generated (outlined) | `build.sh` |
| `preview.png` | generated, 1280x640 | `build.sh` |
| `icon.png` | generated, 512x512 | `build.sh` |
| `solved.json` | generated (record of solved type sizes) | `layout.py` |
| `fonts/SpaceGroteskWV-700.ttf` | vendored | see *Type* below |
| `concepts/*.svg` | scratch, committed | every variant tried, including the rejects |
| `concepts/*.png` | **gitignored** | contact sheets; `./media/concepts/sheet.sh <variant>...` |

`build.sh` needs `inkscape` and `imagemagick` and **no installed font**. Run it twice; the generated files are byte-identical.

```sh
./media/build.sh
```

`layout.py` is the *derivation record*, not part of the normal build. It also needs no installed font. Re-run it only when the copy, the typeface or the mark geometry changes:

```sh
python3 media/layout.py
```

The contact sheets that drove the design are not committed (they were ~2.4MB of PNG). Regenerate any of them from the committed variant SVGs, one row per variant, mark at 240 on light and dark then the icon at 64/32/16 on both:

```sh
./media/concepts/sheet.sh m4-widebutt m5-flatbar g2-pane
```

## Easy to undo by mistake

Each of these looks like a wart and is load-bearing.

- **The accent fill is opaque, never translucent.** A translucent violet over the dark plate goes muddy brown; over the light theme it washes out. Solid renders identically on both.
- **`icon.svg` is a *different* mark, not a scaled `logo.svg`.** Heavier strokes (32/26 vs 27/17), a bigger ring and a wider jog, because the jog is the whole idea and it disappears first at small sizes. Scaling the logo down instead will look fine at 256 and turn to mush at 32. `build.sh` fails if the logo mark is pasted into it.
- **The arcs are cut flat (`stroke-linecap="butt"`), and so is the bar.** The bar had round caps until the typeface was chosen; Space Grotesk has flat terminals, and the mixed construction was visible. Rounding either one breaks the match with the type.
- **The bar's ink is `currentColor`; only the accent is a fixed hex.** One file serves both themes.
- **Inkscape resolves `currentColor` to a literal hex when it outlines text.** `build.sh` puts it back with a `sed`, then *measures* the wordmark's contrast on both backgrounds. Delete that step and `logo-wordmark-dark.svg` silently becomes dark-on-dark. This actually happened during the build; the render is what caught it.
- **The icon mark is inset to ~12% margins, not the ~7% it sits at by default.** At 7% it looks cramped against the plate's rounded corners.
- **Both READMEs use the absolute `raw.githubusercontent.com` URL.** A relative path renders on GitHub and breaks on npm, which serves the same README from its own domain. Expect the raw URL to lag briefly after a push.

## Type

**Space Grotesk**, instanced to a static weight 700 cut and vendored as `fonts/SpaceGroteskWV-700.ttf`.

Chosen because it shares a construction with the mark: terminals **cut flat**, bowls that are near-circles, one even stroke weight. Manrope was the runner-up (softer, reads consumer-app); Chivo and IBM Plex are humanist in ways the mark is not; Archivo is competent and anonymous.

Three deliberate precautions, all guarding silent failures:

- **Static, not variable.** The upstream is a variable font. A renderer that cannot resolve the `wght` axis falls back to Regular *with no error*, so the weight is baked into the file with `fontTools.varLib.instancer`.
- **A unique family name (`SpaceGroteskWV`).** The variable source was shadowing the static in fontconfig and a spec could have resolved to either. A one-file, one-family, weight-400 name cannot resolve two ways.
- **Sizes are solved to a measured ink box, never a nominal point size.** Nominal size is not comparable across faces, so swapping the face would silently change the real size of the wordmark. `solved.json` records the results:

| Use | Target | Solved size |
| --- | --- | --- |
| `logo-wordmark` wordmark | ink height 102 | 140.1099px |
| `preview` wordmark | ink height 140 | 192.3077px |
| `preview` tagline | ink width 600, tracking 0.4 | 37.2317px |

Re-derive with `python3 media/layout.py`.

**Licence:** SIL Open Font License 1.1 (`fonts/OFL.txt`). The copyright line carries **no Reserved Font Name**, so instancing, renaming and converting to outlines are all permitted. Outlines are a derivative of the font; OFL allows it.

## The drift check

The same mark geometry is duplicated into three files, because each needs different ink and framing. That rots silently, so `build.sh` compares the load-bearing path data across `logo.svg`, `logo-wordmark.src.svg` and `preview.src.svg` and **fails before rendering**. Both branches have been proven to fire by perturbing a number and by pasting the logo mark into `icon.svg`.

## Palette

| Role | Value | Notes |
| --- | --- | --- |
| Accent | `#7C4DFF` | exactly one idea wears it: the ring |
| Ink (light theme) | `#0f172a` | the default `color:` on the mark |
| Ink (dark theme) | `#eef1f6` | |
| Plate | `#12141a` | icon plate and card background |
| Muted | `#8e97a8` | tagline only |

Deliberately **not** Tor's `#7D4698`: webveil is not Tor-only, and borrowing it would imply an endorsement.

## Directions tried and dropped

So nobody re-proposes them cold. Every variant named below is a committed SVG in `concepts/`; render any of them with `sheet.sh`.

- **Magnifying glass, globe, padlock, shield, eye, onion, mask, keyhole, fingerprint, incognito glasses** — blacklisted before sketching started.
- **Trail with a dissolving tail** (`b-trail`) — a circle on the end of a diagonal stick *is* a magnifying glass, on a search tool. Fatal.
- **Blank sender card** (`d-blanksender`) — the dashed field is the standard file drop-zone idiom; the card reads as an ID badge or a keyboard; mush at 32px.
- **Broken ring with a straight centred bar** (`c-brokenring`) — the shape that started this, but `( | )` is the broadcast/signal icon, i.e. the opposite claim. The symmetry is *structural*: a straight bar through the centre exits at two opposite points, forcing equal mirrored arcs. Rotating it (`h2-rot`) turns the axis into a prohibition slash; moving it off-centre (`h3-chord`) reads as a letter D. Bending the bar was the fix.
- **Refraction through a veil pane** (`g2-pane`) — the runner-up, and genuinely good: a ray displaced by passing through an accent pane. Dropped only because the jogged ring says the same thing in a stronger silhouette.
- **Two panes for the two egress hops** (`f3-twohop`) — honest to `docs/adr/0003`, reads as venetian blinds, mush at 16px.
- **Ring with a single gap and a ray leaving it** (`c2-gapring`) — the reload/refresh spinner.

## Known gaps, accepted

- **16px.** The icon survives as a violet-and-dark tile, but the jog is roughly 3px of lateral shift and is not really legible. There is no web app here so 16px is not load-bearing; if one ships, revisit rather than scaling the existing icon down.
- **It reads as an abstract glyph** and could be mistaken for a currency or section symbol. That is a neutral misread rather than a wrong claim, which is the trade taken over "broadcast" or "no entry".
- **No favicon / maskable / apple-touch set.** Not owed until a web app exists. Generate it from `icon.svg` with a tool then, not by hand, and feed the maskable generator a transparent-background variant so it does not end up as a box inside a box.
- **`icon.svg` has no sibling to be drift-checked against**, since it is deliberately a different mark. `build.sh` asserts it still carries its own geometry and its plate, and that the logo mark has not been pasted in, which is weaker than a real comparison.
