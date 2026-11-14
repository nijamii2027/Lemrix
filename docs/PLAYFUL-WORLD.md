# The little Lemrix world

The main landing page now uses the approved deep navy and cream identity with a physical-looking Cook’d × Lemrix keepsake card. The current mascot models are shared by live Three.js scenes and pre-rendered media. All graphics libraries and final media are self-hosted.

## Interactions

- Pointer tilt, foil glare, keyboard/button card flip, greeting, and save to the existing cabinet.
- Three-pancake timing game with honey, berry, and chocolate; an untimed option; forgiving outcomes; a completed stack and collector stamp.
- Two border companions on desktop, one smaller companion on phones. They yield over controls, pause for greetings, and can be hidden.
- Four local stamps unlock extra foil. A self-contained SVG keepsake can be downloaded from the cabinet.
- The shared adventure and keepsake work on both the homepage and shop placeholder. Existing archive saves, hunt lists, and exports stay compatible.

## State and motion

`lemrix.play.v1` stores sanitized browser-local progress, favourite topping, best stack, and companion preference. No account or server data is required. A storage failure uses memory and tells the visitor the finds last for the visit.

The owner-requested automatic motion mode starts on page readiness, independently of device reduced-motion flags. One shared pause state controls CSS, UI effects, mascot clocks and media; the footer pause option remains available. Hidden tabs, dialogs, offscreen scenes, and back/forward cache lifecycle are handled. The explicit cooking round has a separate timer so phone controls continue working while the illustration is above the viewport. Rounds pause when the complete kitchen section leaves view. Untimed mode is the default for reduced motion.

## Verification

Desktop and phone layouts, front/back, greeting, keeping/removing the card, cabinet counts, archive compatibility, cross-page persistence, toppings, three-pancake completion, untimed rounds, four-stamp unlock, and companion visibility were exercised in the browser during implementation. JavaScript syntax and static asset references are checked before publication.

The cloud QA browser does not expose WebGL. The rendered media path, animated-image fallback and game controls were tested there; live GPU rendering and performance remain unverified on hardware. The same authored mascot meshes were inspected in offline rendered frames. SVG generation reached the success message; a browser-provided download file path was not available.
