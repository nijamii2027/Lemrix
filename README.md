# Lemrix TCG

The storefront lives in `dist/`. The homepage contains the Cook’d × Lemrix comic, live breaks, Lucky Dip and the card enquiry form. `/shop/` links to current eBay and Whatnot listings. `/menu/` is a sample café menu. Both use the shared navigation and enquiry form.

## Vercel deployment

Import the GitHub repo in Vercel and deploy from its root. The checked-in configuration serves `dist/` and forwards enquiries to the existing Lemrix inbox. See the [deployment guide](VERCEL-DEPLOYMENT.md).

## Sites deployment

Run `node scripts/build-sites.mjs` to copy the storefront into the Worker’s static assets directory. `worker/index.js` handles enquiry submissions and `drizzle/` contains the D1 migration. The production Sites project provides the `DB` binding.

Enquiries are recorded in `enquiries`. Site owners can read them in the site’s database viewer and reply using the submitted email. There is no email notification service configured.

Shopify settings are in `dist/shopify-config.js`. See [Shopify handoff](SHOPIFY-HANDOFF.md) for integration details. The source imagery and its attribution are documented in [Brand notes](BRAND-NOTES.md).
