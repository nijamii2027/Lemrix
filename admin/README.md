# Lemrix stockroom development preview
Use Node.js 24. Set LEMRIX_ADMIN_PASSWORD to a local development password, then run `node admin/server.mjs` from the repository root.
 
Open http://localhost:4178/admin/ and sign in as Lemrix. The storefront is at http://localhost:4178/shop/. Choose a listing or Add a new product. Prices are AUD and existing condition-specific copies have separate prices. Enter the actual quantity on the first edit of an existing listing. Reload an open storefront after saving.

The server binds to loopback. Inventory and uploaded image bytes persist in .lemrix-data/inventory.sqlite across restarts. Back up the data directory with the server stopped. Restarting signs out all sessions. The static site on its own serves its original demonstration inventory. Production deployment requires a persistent database, object storage and production admin authentication. Do not expose this development server or reuse its test password in production.
