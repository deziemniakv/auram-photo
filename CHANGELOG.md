# Changelog

All notable changes are documented here, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - Unreleased

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
