# The wordmark face

`style.css` carries one `@font-face`, **Helm Display** — a subset of
[Big Shoulders Display](https://github.com/xotypeco/big_shoulders), a condensed
grotesk drawn for Chicago civic and industrial signage. SIL Open Font License
1.1; the full licence is in `BigShouldersDisplay-OFL.txt` beside this file, as
the OFL requires.

It is inlined as base64 inside the stylesheet, not served from here. Rule 4
says the page makes exactly two kinds of external call — the Worker and ESPN —
and a font request would be a third. Nothing in this directory is ever fetched
at runtime; these two files are provenance and licence, not assets.

## Rebuilding the subset

The upstream file is a variable font. It is instanced to one weight, then cut
down to the twenty-three characters the wordmark, a version string and Wren's
card title can ever need (`The Helm v0123456789.WREN` — W R E N added in
v1.40.0, WT15; her title is `Wren` set uppercase), which is what keeps it at
~2 KB, not 220 KB. The face reaches the wordmark and that one title, never
body text.

```sh
python3 -m venv /tmp/helmfont && /tmp/helmfont/bin/pip install fonttools brotli
curl -sSL -o /tmp/bsd.ttf \
  'https://raw.githubusercontent.com/google/fonts/main/ofl/bigshouldersdisplay/BigShouldersDisplay%5Bwght%5D.ttf'
/tmp/helmfont/bin/fonttools varLib.instancer /tmp/bsd.ttf wght=600 -o /tmp/bsd-600.ttf
/tmp/helmfont/bin/pyftsubset /tmp/bsd-600.ttf \
  --text='The Helm v0123456789.WREN' \
  --layout-features='' --no-hinting --desubroutinize \
  --drop-tables+=DSIG,GSUB,GPOS,GDEF,MVAR,STAT,FFTM,gasp \
  --name-IDs=1,2,3,6 --notdef-outline \
  --flavor=woff2 --output-file=/tmp/helm-wordmark.woff2
base64 < /tmp/helm-wordmark.woff2 | tr -d '\n'
```

Paste the result into the `src: url(data:font/woff2;base64,…)` in `style.css`.
`tools/test-shell.js` fails the build if that blob ever grows past 15 KB or if
a `url()` in the stylesheet ever points off-origin.

**Adding a character to the wordmark means rebuilding this subset.** The font
has no other glyphs; anything outside that set falls through to the system
stack mid-word, which looks like a bug and is one.
