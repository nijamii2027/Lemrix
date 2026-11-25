# Deploy Lemrix to Vercel

Import `nijamii2027/Lemrix` using branch `main` and the repository root. Vercel reads the build command and output directory from `vercel.json`. The frontend build needs Node.js and has no package dependencies or environment variables.

## Where pages run

| Entry point | Behaviour |
| --- | --- |
| `/` | Vercel serves the illustrated landing page and its local fonts, animations and video. |
| `/after-hours/` | The original page opens the After Hours scene on the landing page. |
| `/shop/` | The browser opens the operating Lemrix store on its existing origin. Product and cart fragments and checkout query parameters follow the redirect. |
| `/admin/` | The browser opens the existing shop account page for owner sign-in. |

The shop uses its current inventory, uploaded images, account cookies, rewards ledger and payment settings. Keep the existing Lemrix TCG site online. Sign-ins, carts and Stripe callbacks continue on that origin. The browser crosses domains when opening the shop from Vercel, so its same-origin landing-to-shop animation cannot span that navigation. Subsequent navigation follows the shop's own links.

## Verify after import

Open the landing page, play the embedded video, scroll to After Hours and open Shop. Check that the catalogue appears on the existing shop domain. Open an existing product bookmark and the admin shortcut. The current backend controls whether checkout is available.

[Operating Lemrix shop](https://lemrix-tcg-illustrated.beefybag2.chatgpt.site/shop/)
