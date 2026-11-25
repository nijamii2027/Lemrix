# Deploy Lemrix to Vercel

Import `nijamii2027/Lemrix` using branch `main` and the repository root. Vercel reads the build command and output directory from `vercel.json`. The frontend and store API run on Vercel, with durable data in a private Vercel Blob store.

## Where pages run

| Entry point | Behaviour |
| --- | --- |
| `/` | Vercel serves the illustrated landing page and its local fonts, animations and video. |
| `/after-hours/` | Opens the After Hours scene on the same domain. |
| `/shop/` | Vercel serves the complete shop frontend. Product, collection and cart links stay on this domain. |
| `/admin/` | Opens `/shop/#account` on the same domain. |
| `/shop/catalogue.js`, `/media/...`, `/api/...` | Vercel Functions serve current inventory, uploaded images, authentication, rewards and checkout. |

The build copies the shop's scripts, fonts, images and photo tools, but deliberately omits the seed `shop/catalogue.js`. A failed storage connection must not silently show outdated sample stock.

## Runtime configuration

Configure runtime variables on the intended Vercel project and environment. Keep secret values out of `dist/`, browser code, Git and logs.

| Variable | Purpose |
| --- | --- |
| `BLOB_READ_WRITE_TOKEN` | Server access to the connected private Vercel Blob store. |
| `LEMRIX_CONFIG_KEY` | 32-byte hexadecimal encryption key for the private runtime configuration object. Keep it stable across redeployments. |
| `SESSION_SECRET` | Signing secret for staff sessions. |

The required private object `store/v2/runtime/config.json` contains an AES-256-GCM encrypted configuration: `ADMIN_PASSWORD_HASH`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SHIPPING_RATE`, and optional `GOOGLE_CLIENT_ID`. The staff password uses PBKDF2-SHA256 with 600,000 iterations and a random salt; the plaintext password is never stored. The runtime reads this object through the private Blob adapter and decrypts it only on the server. A missing object or invalid encryption key fails closed.

Those five configuration names can also be provided as server environment overrides when deliberately rotating a credential. The Stripe webhook URL is `https://lemrix.vercel.app/api/stripe/webhook`; retain the signing secret associated with that endpoint. If Google customer sign-in is enabled, its permitted JavaScript origins must include the storefront domain.

The private store holds the catalogue (including stock reservations), uploaded images, staff and customer sessions, rewards records and private reward artwork. Preserve these records when redeploying. Each object uses a versioned envelope with its original bytes and metadata; conditional writes prevent simultaneous stock edits from overwriting one another. Do not seed over an existing catalogue or use the production store for development tests.

Staff sign in directly using the Lemrix username and password. A successful password check creates a secure server session for editing the shop. No separate platform sign-in or authentication bridge is involved.

Customer sessions and browser storage belong to each domain. Existing carts and browser-only demo accounts from another domain do not automatically appear on Vercel. Collector passes can be restored using their existing recovery codes when their records have been migrated. Customer username accounts and offers labelled as demos remain browser-local; Google sign-in uses verified server sessions when configured.

## Verify after deployment

Open the landing page, play the embedded video, scroll to After Hours and open Shop. Confirm the address remains on the Vercel domain and the catalogue and uploaded product images load. Check `/shop`, `/shop/`, a product bookmark, the cart and the `/admin/` shortcut. Staff sign-in should open the editor without leaving the storefront.

Verify the dynamic catalogue uses current private-store data and that unauthenticated editing requests are rejected. Check checkout success and cancellation return URLs with isolated test fixtures, and verify the Stripe webhook against its endpoint secret. The server configuration controls whether checkout is available; deploying the site does not activate payments or create orders.
