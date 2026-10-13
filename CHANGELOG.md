# Changelog

All notable changes are documented here, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and [Semantic Versioning](https://semver.org/).

## [Unreleased]

Milestone 2: image geometry.

### Added

- **Image size** (Image menu, Ctrl+Alt+I): resample every layer to a new size with bicubic,
  bilinear, Lanczos or nearest-neighbour interpolation, optionally keeping proportions.
- **Canvas size** (Ctrl+Alt+C): grow or shrink the canvas around one of nine anchors; the new area
  on the bottom layer can be transparent, white or the secondary colour.
- **Crop tool** (C): drag a crop rectangle, adjust it with eight handles, apply with Enter. Also
  **Crop to selection**.
- **Rotate** the canvas 90° clockwise, 90° counter-clockwise or 180°, exactly.
- **Free transform** (Ctrl+T) of the active layer or the selected pixels:
  - drag inside to move, a handle to scale (Shift keeps proportions, Alt scales from the
    centre), or outside to rotate (Shift snaps to 15°);
  - arrow keys nudge, Enter applies and Esc cancels;
  - the preview is drawn on the GPU while dragging.
- Each of these is one undo step; resampling and transforms run in the background worker.

## [0.1.0] - 2026-10-12

First development version (milestone 1: core editor).

### Added

- Layered raster documents with 16 blend modes, opacity, visibility, reorder, rename and merge down.
- WebGL 2 compositor with half-float accumulation, pan, zoom and mipmapped zoom-out.
- Move, marquee (rectangle, ellipse; new/add/subtract/intersect), brush, eraser, eyedropper, hand
  and zoom tools; fill, clear, flip; select all/deselect/invert.
- Undo/redo with merged slider changes and memory limits.
- `.cproj` save/open with lossless per-layer PNGs and a launcher thumbnail; image import; PNG,
  JPEG and WebP export, all in a background worker.
- Recent files, unsaved-changes protection, one document per window.
- Auram Launcher integration and Windows ZIP packaging with a generated release manifest.
- English and Polish interface.
