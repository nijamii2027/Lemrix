# Lemrix TCG

The illustrated storefront source matches Lemrix TCG publication 25 (source commit `868ece8ed14734868179f3393b0d1a16fd5f6265`). It includes the landing page, After Hours, shop, card photo tools, staff editor, rewards and checkout.

## Vercel

Import the repository from its root. The checked-in configuration builds the landing page and After Hours with their original HTML, scripts, fonts and media. Shop and admin links open the operating store on its existing domain. See the [deployment notes](VERCEL-DEPLOYMENT.md).

## Development

Use Node.js 24. The scripts run with Node's standard library.

- `npm run build` creates the Vercel static output in `public/`.
- `npm test` exercises staff sign-in, shop editing, Google account handling, inventory reservations, Stripe webhook handling and rewards with test data and sample artwork.
- `npm run build:sites` builds the original Worker from `worker/`, `dist/` and the private reward originals in `rewards/prints/`. The originals are supplied separately for an authorised backend build. The store currently serves them through its rewards API.

The earlier storefront is available in the repository history at `d540507a2bf9bfb9c1c1253f482c2a83654b48ad`.
