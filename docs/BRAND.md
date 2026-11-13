# Project brand mark

**Design checkpoint, 2026-11-06:** the simplified ribbon is a reversible preview
candidate, not the owner's final brand approval. It is included in the
`single-window-pink-ribbon-20261106` preview package. The earlier negative-space
candidate is retained. The sidebar and title icon have been observed in that
running package; this does not establish a system-tray or small-size pass.

The source is [ribbon-simple-v1.png](../src/assets/brand/ribbon-simple-v1.png),
generated for the owner's request to keep the flowing ribbon while making the
bot less prominent. A speech-bubble opening and two small eyes replace the
complete robot head. The [bundled source record](../src/assets/brand/README.md)
contains dimensions, exact hashes, generation boundaries and output licensing.
The build never retouches or overwrites a source PNG.

## One source, three surfaces

- The sidebar displays the original PNG in a 48×48 px box with
  `object-fit: contain`; accessible application text remains separate.
- The window and tray use `createBrandIcon` in `src/core/icon.cjs`. It verifies
  the exact candidate hash, scales proportionally and centers the native bitmap
  on transparent square padding. Runtime can fall back to Sprout if decoding
  fails; this is not the normal brand.
- `node scripts/build-icon.cjs`, also run by `prepack`/`predist`, starts an
  encoding-only Electron worker with no BrowserWindow or account startup. It
  writes `src/assets/app.png` and a nine-frame `app.ico`. Missing, changed or
  invalid input fails the build instead of silently substituting Sprout.

The existing Electron [nativeImage API](https://www.electronjs.org/docs/latest/api/native-image)
preserves aspect ratio when resizing by one dimension. `toBitmap()` and
`createFromBitmap()` share a platform-native format, so transparent padding
copies complete rows without changing channels. No image dependency, generation
request, color filter or raster artwork edit is added. ICO sizes are
16, 20, 24, 32, 40, 48, 64, 128 and 256 px.

## Preserve the ribbon tails

The source is **1374×1145**, a 1.2:1 aspect ratio. The old candidate's square crop
would cut the new tails and is no longer used. The complete source is resized;
transparent rows fill the remaining square space. Rounding may place one more
padding row on one side at small sizes. The sidebar uses equivalent CSS:

```css
.brand-mark-image { width: 48px; height: 48px; background: transparent; }
.brand-mark-image img { display: block; width: 100%; height: 100%; object-fit: contain; }
```

The ribbon identifies the application, not success, warnings or errors. Small
eye details need not remain distinct at 16 px.

## Decorative artwork

The generated persona motifs and cherry branch have their own exact source
records in [the bundled provenance](../src/assets/brand/README.md#decorative-ui-artwork).
They decorate empty UI space, not verified connections, QR codes, permissions,
messages or model capabilities. Their source pixels are unchanged; CSS position,
opacity and blending are presentation choices.

## Verification boundary

Normal HTML/CSS previews on white and mist-pink backgrounds were viewed at
240, 48 and 32 CSS px. Focused brand/core tests passed **40/40**, and the nine
ICO frames were checked. The encoding worker reads back outputs; tests check
exact input, aspect-preserving resize, complete pixel-row copying, transparent
padding, invalid native output, runtime fallback and ICO offsets. A separate
production-renderer logo fixture passed **one check / one screenshot**. These
are synthetic/encoding checks, not Windows tray observations.

The rebuilt pink-ribbon package was actually launched and its archive identity
verified. Its sidebar and title icon were inspected. A legacy pink-square
background was corrected by restricting that CSS rule to
`.brand-mark:not(.brand-mark-image)`; the transparent sidebar was then observed
in the rebuilt package. This is a bounded appearance check at the observed
window size, not final owner approval, tray/taskbar inspection, or validation at
every supported display scale. Those checks remain open.
