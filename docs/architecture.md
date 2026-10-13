# Architecture

Auram Photo is an Electron application in a pnpm workspace. The image engine is a separate
package so that it can be tested without a window and reused later.

## Packages

| Package                                        | Responsibility                                                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/photo`                                   | Electron main process (files, dialogs, windows, launcher integration), preload bridge, React UI.                                                  |
| `@auram/photo-engine`                          | Document model, raster buffers, blend modes, selections, brush strokes, undoable operations, history, `.cproj` reader/writer, WebGL 2 compositor. |
| `@auram/design-tokens`, `@auram/ui`            | Shared Auram design system (vendored from Auram Launcher).                                                                                        |
| `@auram/project-format`, `@auram/app-manifest` | Shared formats: the `.cproj` manifest and the launcher's app descriptor / release manifest.                                                       |

## Document model

- A `PhotoDocument` has a fixed size, a stack of layers (bottom to top), an active layer and an
  optional selection.
- Every layer is a full-document-size **straight-alpha RGBA8** `Raster`. Layers have no offset
  yet, so moving or transforming pixels beyond the canvas edge discards them.
- The document size can change (image size, canvas size, crop, rotation). `setGeometry` replaces
  the size, every layer's raster and the selection at once and emits a `size` change.
- A `Selection` is an 8-bit coverage mask with soft edges (elliptical selections are anti-aliased).
- Documents emit change events: `pixels` (layer + rectangle), `layers`, `active-layer`,
  `selection` and `size`. The compositor and the UI subscribe to them.

## Editing and undo

Operations in `operations.ts` (add/duplicate/delete/move/merge layers, fill, clear, translate,
flip, selection changes) apply a change and return a `Command` that can undo and redo it. Pixel
changes are stored as before/after patches of the affected rectangle only. `History` keeps up to
200 steps or 1 GiB, merges rapid property changes (an opacity drag is one step) and reports a
version number that the UI compares with the last saved version to show unsaved changes.

Brush and eraser strokes (`brush.ts`) accumulate dab coverage with `max` into a stroke mask and
recompute the layer from its pre-stroke pixels. A stroke therefore never exceeds its opacity where
it overlaps itself, respects soft selection edges, and produces an exact undo patch.

## Geometry and resampling

`resample.ts` resizes rasters and selection masks with a separable filter (bilinear, Catmull-Rom
bicubic, Lanczos-3, or nearest neighbour). Colour is filtered premultiplied by alpha, so
transparent pixels never darken edges, and shrinking widens the filter so every source pixel
contributes. Same-size resampling and whole-pixel transforms are exact.

`transform.ts` builds on it:

- **Image size** resamples every layer and the selection.
- **Canvas size** and **crop** reposition pixels without resampling.
- **Rotate** turns the canvas by exact quarter turns.
- **Free transform** lifts the selected pixels (or the layer's content), maps them through an
  affine matrix (prefiltering when it shrinks them), and composites them back. The selection is
  transformed with them.

Size changes are undone with a `geometryChange` command that keeps the previous rasters.

Resampling, rotation and free transforms run in the worker; the editor blocks input while it
waits, then records the result as one undo step. While a free transform is being edited, the
lifted pixels are a preview change outside the history. The compositor draws them through the
inverse matrix with premultiplied bilinear sampling, so dragging the box never touches the CPU.

## Rendering

`Compositor` (`packages/engine/src/webgl`) keeps one RGBA8 texture per layer, updated with
`texSubImage2D` for just the changed rectangle. Visible layers are composited into ping-pong
accumulation buffers (RGBA16F when `EXT_color_buffer_float` is available, RGBA8 otherwise) by a
shader implementing the W3C blend modes, then drawn into the canvas with the view transform over a
transparency checkerboard: nearest-neighbour above 100%, trilinear mipmaps below.

`FloatCanvas` in `blend.ts` is the CPU reference implementation of the same maths. It is used for
export, merge down, colour sampling and thumbnails, and the end-to-end suite checks that the GPU
result matches it within 3/255 for all 16 blend modes.

The move tool previews whole-layer moves on the GPU with a texture offset; moves of selected
pixels are applied on the CPU at most once per frame.

## Files and threads

Encoding and decoding (`.cproj` ZIP + PNG, image import, export) runs in a module Web Worker
(`apps/photo/src/renderer/src/workers`) so the editor stays responsive. The main process never
parses images: it shows dialogs, reads and writes bytes, and enforces which paths a window may
use. See [document-format.md](document-format.md).

## Process security

The renderer is sandboxed with context isolation and a strict CSP. The preload exposes a typed
`window.auramPhoto` API; every handler validates input with Zod and checks the calling frame. Each
window keeps a set of granted paths: files it opened (dialog, recent list, launcher argument),
saved, or chose in a save dialog. Saving to any other path is refused.

## Launcher integration

- Auram Launcher starts `Auram Photo.exe <project.cproj>`; the main process opens that file. A second
  launch while Photo is running is routed to the existing process (single-instance lock) and opens
  in a window without a document, or in a new window.
- `scripts/write-app-descriptor.mjs` writes `auram-app.json`, which electron-builder places next to
  the executable; `scripts/write-release-manifest.mjs` writes `auram-release.json` with the size and
  SHA-256 of each ZIP. Both are validated in tests against the launcher's schemas.
- Settings and logs live in `%LOCALAPPDATA%\Auram\Photo`; projects default to
  `Documents\Auram\Projects`, the folder the launcher scans.
