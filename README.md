# Lemrix TCG

The illustrated storefront includes the landing page, After Hours, shop, card photo tools, staff editor, rewards and checkout.

## Vercel

Import the repository from its root. Vercel serves the frontend and runs the store API as Vercel Functions. A private Vercel Blob store holds the inventory, uploaded images, sessions and rewards. Shop and admin links stay on the Vercel domain, and staff sign in with their Lemrix username and password. See the [deployment notes](VERCEL-DEPLOYMENT.md) for runtime configuration and verification.

## Development

Use Node.js 22 and run `npm ci --ignore-scripts` before building or running the test suite.

- `npm run build` creates the Vercel frontend and prepares the store server bundle. The static output omits the seed catalogue so the shop must load current inventory through its API.
- `npm test` exercises staff sign-in, shop editing, Google account handling, inventory reservations, Square webhook handling and rewards with test data and sample artwork.

Customers can sign in with a username and password or a configured identity provider. Staff review customer offers in the shop account menu. An accepted offer opens a Square checkout for one item at the agreed price plus shipping. Customers can track their offer status from any browser after signing in.

The earlier storefront is available in the repository history at `d540507a2bf9bfb9c1c1253f482c2a83654b48ad`.

After a paid checkout, the buyer can save their private tracking link. To update it, open the order under **Orders → Shipments → To-do** in Square Dashboard. Add the carrier and tracking number before marking the parcel as shipped. The tracking page reads the latest Square shipment details, and the carrier link shows scan updates.
