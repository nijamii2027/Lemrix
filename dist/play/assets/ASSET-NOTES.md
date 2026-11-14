# Procedural mascot assets

These renders use the exact character meshes and colours extracted from `dist/mascots/world.js` into `dist/play/characters.js`. No raster character reconstruction or generated image was used. Cook’d retains its bone, floppy ears, curved apron, pocket and rear bow; Lemrix retains the soft blue body and curved tail.

The reusable module has no DOM or renderer dependencies. `makeCharacters(parent)` returns both rigs. `poseCharacters(pair, seconds, {mode, facing})` supplies idle and one-second walking poses. The live card and the offline renders share the rig.

## Assets

| File | Dimensions | Detail |
| --- | --- | --- |
| duo-front.webp | 820 × 700 | Transparent front duo |
| cookd-walk.webp | 1536 × 160 | 12 horizontal 128 × 160 alpha frames |
| lemrix-walk.webp | 1536 × 160 | 12 horizontal 128 × 160 alpha frames |
| cookd-idle.webp | 128 × 160 | Transparent walking-layout still |
| lemrix-idle.webp | 128 × 160 | Transparent walking-layout still |
| cooking-loop.mp4 | 640 × 480 | 4 seconds, 12 fps, silent H.264, faststart |
| cooking-poster.jpg | 640 × 480 | First movie frame over navy #182359 |
| cooking-transparent.webp | 640 × 480 | Transparent first cooking frame |
| kitchen-frames.webp | 3072 × 1728 | 48 transparent cooking frames in an eight-column atlas |

Walking repeats after one second. Movie movement repeats after four seconds. Mirror the walking sprite for the opposite edge direction. Exact playback information is in `sprites.json`. The kitchen resizes the original alpha renders to 384 × 288 per frame. Its idle motion alternates forward and backward through frames 24–47. Tapping plays frames 0–24 once. The toss projects the original pancake mesh with a higher arc and a full rotation over the original kitchen render. The idle frames still use the original stirring motion.

## Reproduction and checks

The persistent `mascot-assets-work` directory adjacent to the checkout contains `export.mjs`, `render.py`, `pack.py`, scene JSON, all PNG frames and the Blender 4.3.2 distribution. Rendered with Blender Cycles CPU, denoising and soft area lighting, then packed with Pillow and ffmpeg. All 24 walking frames have clear alpha margins. Module syntax and MP4 dimensions, frame rate, codec and duration are checked before delivery.
