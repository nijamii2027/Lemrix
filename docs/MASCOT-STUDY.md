# Cook’d × Lemrix 3D animation study

Standalone route: `/mascots/`. The existing landing page and shop are unchanged.

## Implementation

The scene is authored in `dist/mascots/world.js` with self-hosted Three.js 0.180.0 (MIT, included). No build step, external CDN, model service, generated bitmap character, or remote rendering service is needed for the live scene.

The two characters are separate procedural 3D models with continuous lathed bodies, tapered limbs and tails, rounded shoulder joints, feet, facial features and independent motion groups. Cook’d retains its bone, floppy ears, apron, curved bib, stitching and back bow. The blue Lemrix character retains its round head, smooth silhouette and tapered tail. These are interpretations based on the original eight-panel announcement, including its visible front views; they are not claimed as official production character models.

The shop is a miniature set with bevelled walls and roof, recessed window frames, lamps, café cups, display cards, paving, plants, crescent moon and stars. The paired sign artwork is sampled from panel one through an affine canvas transform, preserving the original marks and their aspect ratio. No old logos are used.

Scene and duo camera views interpolate smoothly. Drag or use Left/Right arrows with the canvas focused to change the angle; Home resets it. Space and the pause button toggle animation. Replay restarts the small character sequence. Breathing, tail movement, glances, a wave and small steps are driven by time. The animation stops advancing while a comparison/video dialog or hidden tab is open. Pausing also avoids redundant GPU renders once the camera settles. OS reduced motion starts the scene paused.

The original-artwork dialog uses the authentic announcement image. A separate six-second MP4 is rendered from the same procedural geometry and rig with Blender 4.3.2/Cycles. This is a rendered study, with different lighting from the live WebGL renderer; it is available from “Watch a rendered moment.” The video has native controls and does not require WebGL. It pauses when its dialog closes.

## Validation and limits

- JavaScript syntax and local file references checked.
- 188 mesh instances, approximately 110k unique geometry triangles, no model downloads; Three.js and its two helper modules total approximately 728kB uncompressed.
- The actual procedural geometry was exported and visually rendered from both camera views. Arm joints, apron shape, original sign proportions, feet, tails and set composition were inspected and refined.
- Finite transforms were checked at eight times across three camera/character blends, including the idle state after the one-shot sequence.
- Desktop composition and phone framing were inspected using the rendered geometry in a temporary layout harness. The harness and its temporary image are not shipped. Phone heading sizing was corrected to prevent clipping.
- The original-artwork comparison, video playback, close controls and unsupported-WebGL state were checked in the browser.
- The available cloud preview browser disables WebGL. Full live GPU rendering, frame rate, camera dragging and live shader compilation could not be verified there. The scene uses a readable original-artwork fallback if WebGL initialization fails. The connected local browser reached the owner-only site sign-in gate; no audience or authentication setting was changed.

No changes to the landing-page hero are made by this study. Review the standalone scene before integrating it.
