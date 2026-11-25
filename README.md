# Lemrix TCG

The illustrated storefront includes the landing page, After Hours, shop, card photo tools, staff editor, rewards and checkout.

## Vercel

Import the repository from its root. Vercel serves the frontend and runs the store API as Vercel Functions. A private Vercel Blob store holds the inventory, uploaded images, sessions and rewards. Shop and admin links stay on the Vercel domain, and staff sign in with their Lemrix username and password. See the [deployment notes](VERCEL-DEPLOYMENT.md) for runtime configuration and verification.

## Development

Use Node.js 22 and run `npm ci --ignore-scripts` before building or running the test suite.

- `npm run build` creates the Vercel frontend and prepares the store server bundle. The static output omits the seed catalogue so the shop must load current inventory through its API.
- `npm test` exercises staff sign-in, shop editing, Google account handling, inventory reservations, Square webhook handling and rewards with test data and sample artwork.

Customer username accounts and offers that are labelled as demos remain browser-local demonstrations. Google customer sessions, staff editing, inventory, rewards and checkout use the server API. Deploying the site does not turn demo offers into submitted orders.

The earlier storefront is available in the repository history at `d540507a2bf9bfb9c1c1253f482c2a83654b48ad`.
