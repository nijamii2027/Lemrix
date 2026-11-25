# Lemrix TCG

The illustrated storefront source matches Lemrix TCG publication 26 (source commit `159d6e5244b8740b66da9da1d9816a99abf51fc9`). It includes the landing page, After Hours, shop, card photo tools, staff editor, rewards and checkout.

## Vercel

Import the repository from its root. The checked-in configuration serves the landing page, shop and After Hours from Vercel with their original HTML, scripts, fonts and media. Shop and admin links stay on the Vercel domain. A server-side gateway connects the shop to its existing inventory, uploads, rewards and payment backend. See the [deployment notes](VERCEL-DEPLOYMENT.md) for the required runtime secret and owner verification flow.

## Development

Use Node.js 24. The scripts run with Node's standard library.

- `npm run build` creates the complete Vercel frontend in `public/`, omitting the seed catalogue so the shop must load current inventory through the gateway.
- `npm test` exercises staff sign-in, shop editing, Google account handling, inventory reservations, Stripe webhook handling and rewards with test data and sample artwork.
- `npm run build:sites` builds the original Worker from `worker/`, `dist/` and the private reward originals in `rewards/prints/`. The originals are supplied separately for an authorised backend build. The store currently serves them through its rewards API.

The earlier storefront is available in the repository history at `d540507a2bf9bfb9c1c1253f482c2a83654b48ad`.
