# Brand files

**Not covered by the AGPL. See [TRADEMARKS.md](../../../../../TRADEMARKS.md).**

The PactJoy logo and symbol are the property of Victor Olave. They live in this repository so the
app can render them, not so they can be reused. Do not use them to suggest a project is official or
endorsed.

## Provenance

- `pactjoy-horizontal-proposed.svg` and `pactjoy-symbol-gradient.svg`: Claude Design project
  `239122e1-7217-4b6b-ac98-3383f1876fc6`, `assets/logo/`. They are the official logo and symbol.
- Vendored 2026-10-03 through `read_file` (HTML entities decoded). The only change is that the
  embedded `<metadata><c2pa:manifest>` content-credentials block, a base64 provenance signature
  (about 8 KB in the symbol and 12 KB in the logo) that is not artwork, was left out; the vector
  art is untouched. The files are not edited by hand.
- Illustrations: `registro-guardado`, `sin-conexion`, `cocinar` and `crear-pacto` (the ones the app wires),
  from the design's `assets/imagery/*.png` (800x800, with alpha), converted with
  `cwebp -q 80 -alpha_q 90 -m 6 in.png -o out.webp`. Sizes before and after: cocinar 399,806 to
  43,692 bytes, crear-pacto 461,360 to 70,080, registro-guardado 347,708 to 49,918, sin-conexion 431,084 to 49,984. The other
  Lote screens' illustrations are not used yet; without a `name` or `src`, `Illustration` keeps its
  neutral placeholder.

The PWA icons in `apps/web/public/icons/` are the symbol rasterised (Quick Look render, then
composited on the cream token) at 192, 512 and 512 maskable.
