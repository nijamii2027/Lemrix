# Deploy Lemrix to Vercel

Import `nijamii2027/Lemrix` using branch `main` and the repository root. Vercel reads the build command and output directory from `vercel.json`. The frontend build uses Node.js with no package dependencies. The server gateway in `api/gateway.mjs` needs the production runtime configuration below.

## Where pages run

| Entry point | Behaviour |
| --- | --- |
| `/` | Vercel serves the illustrated landing page and its local fonts, animations and video. |
| `/after-hours/` | Opens the After Hours scene on the same domain. |
| `/shop/` | Vercel serves the complete shop frontend. Product, collection and cart links stay on this domain. |
| `/admin/` | Opens `/shop/#account` on the same domain. |
| `/shop/catalogue.js`, `/media/...`, `/api/...` | The Vercel server gateway accesses the existing store backend. |

The build copies the shop's scripts, fonts, images and photo tools, but deliberately omits the seed `shop/catalogue.js`. A failed backend connection must not silently show outdated sample stock.

## Backend connection

Set `LEMRIX_BACKEND_TOKEN` as a server-only encrypted Vercel runtime environment variable. It is the Sites service credential used by the gateway to reach the existing backend; do not put it in `dist/`, build output, browser code, Git, logs or a public environment variable. Configure the environment separately for any preview deployment that needs to exercise the gateway.

The existing Lemrix backend remains responsible for its inventory, uploaded images, account sessions, rewards ledger, Stripe configuration and webhook processing. Keep that backend online. This deployment moves the frontend and browser-facing routes to Vercel; it does not copy or replace the live store database.

Owner verification starts at `/api/owner/connect`. It uses the existing owner sign-in in a temporary authentication round trip, then returns the verified owner to the Vercel shop. Shop editing still requires the owner verification and shop password. Ordinary browsing does not navigate to the backend's site address.

Customer sessions and browser storage belong to each domain. Existing carts and browser-only demo accounts from the old site do not automatically appear on Vercel. Collector passes can be restored using their existing recovery codes. If Google customer sign-in is configured, its OAuth client must include the Vercel origin in its permitted JavaScript origins.

## Verify after deployment

Open the landing page, play the embedded video, scroll to After Hours and open Shop. Confirm the address remains on the Vercel domain and the catalogue and uploaded product images load. Check `/shop`, `/shop/`, a product bookmark, the cart and the `/admin/` shortcut. Owner verification must return to the Vercel shop without exposing authentication credentials.

Verify the dynamic catalogue uses current backend data and that unauthenticated editing requests are rejected. Check checkout success and cancellation return URLs with isolated test fixtures. The existing backend controls whether checkout is available; deploying the frontend does not activate payments or create orders.
