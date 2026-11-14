# Automatic motion fix — 5 November 2026

The old implementation could stop every decorative animation when the browser reported reduced motion or retained the legacy paused flag. CSS, mascot clocks, UI animations and the standalone scene used different gates; the shared footer control was also disabled by the device flag. The standalone Play handler could unpause its own clock while the rest of the site remained stopped. Browser autoplay rejection was silently ignored, leaving the cooking poster static.

## Current behavior

The owner explicitly requested automatic animation. `/motion-state.js` now starts the shared running state before page styles and application scripts load. DOM readiness, load, pageshow and visibility events reconcile the same state. Effects on clicks retain their real controls and call animation functions directly. No invisible buttons or synthetic activation are used.

`lemrix.motion.mode.v2` stores only a deliberate running/paused choice. The obsolete `lemrix.motion.paused.v1` flag is no longer consumed. Device reduced motion still selects the untimed cooking game by default; it cannot silently disable the entire site. The footer and scene pause controls remain operable, including on reduced-motion devices.

The muted inline cooking video starts automatically on entering view. Autoplay rejection, media stalls and unexpected playback pauses expose a 48-frame animated WebP from the same renders. Without WebGL, the standalone scene automatically uses a 72-frame rendered WebP. Both image paths switch to stills when paused or hidden. Live graphics, images and CSS all follow the shared state. Updated script/style URLs invalidate older browser-cached motion files.

## Checks

| Case | Observed result |
| --- | --- |
| Reduced device flag plus legacy pause flag | A temporary browser fixture supplies both conditions before application startup. Shared state is running and the pause control is enabled. |
| No first click | Two DOM/computed-style samples show changing mascot route position, sprite frame, wave transform and card breathing transform before any interaction. |
| Blocked video autoplay | A fixture rejects `play()` with NotAllowedError. The animated cooking image loads at 640×480 and becomes visible automatically while the video stays paused. |
| Explicit pause and navigation | Pausing switches mascots to idle images and removes CSS animation. Navigating to home preserves the deliberate pause. Resume restores wave-flow and pal-walk. |
| Click effects with reduced device flag | Card flip reaches the back with its 0.85-second transition enabled. |
| Phone | 375-pixel content viewport has no horizontal overflow; walking sprite starts automatically. Menu entrance opacity advances from 0 to 1. |
| No live graphics | The standalone scene automatically displays its 900×676 animated render; pause swaps to its still, resume restores the moving image. |
| State regression script | `node scripts/check-motion-state.mjs` covers startup without a click, legacy migration, both device preference values, explicit pause, ready/pageshow, hidden/visible transitions and unavailable storage. |
| Media validation | WebP files decode as 48 and 72 frames with infinite looping. |

The device preference and autoplay failures were simulated before the application loaded; no physical OS setting was changed. Phone verification uses a responsive browser frame. Live GPU rendering remains unverified because the QA browser disables WebGL. Temporary fixture pages and browser API shims are removed before packaging. Existing card, story, cabinet and cooking-game verification is recorded in PLAYFUL-WORLD.md.
