# poster

Poster styles A Trail Sign, B Night Ridge and E Survey Quad (DESIGN-SPEC §4), their shared layout
slots, and export.

- Export is client-side. Print sizes render as tiles of ≤ 4096 px, stitched in an OffscreenCanvas.
- Await `document.fonts.load(...)` for every face a style uses before drawing.
