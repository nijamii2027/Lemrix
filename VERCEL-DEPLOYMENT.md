# Deploy Lemrix to Vercel

1. In Vercel, choose **Add New → Project** and import `nijamii2027/Lemrix`. To reuse the existing Lemrix Vercel project, connect the repo from **Settings → Git** in that project.
2. Keep the root directory set to the repository root. `vercel.json` serves `dist/` without an install or build step. No environment variables are required.
3. Deploy. Check `/`, `/shop/` and `/menu/` at the deployment URL.

For an existing Vercel project connected to this repository, subsequent pushes to its production branch deploy automatically. You can also run `vercel --prod` from the repository root with the project linked to your Vercel CLI.

## Enquiries and browser storage

`api/enquiries.mjs` forwards submissions to the live Lemrix Sites backend. Both deployments use the existing `enquiries` inbox, so keep that backend running. Shopify can be enabled later using the [Shopify handoff](SHOPIFY-HANDOFF.md).

Lucky Dip rewards, cooldowns and site motion preferences are stored per domain by the browser. Visitors moving to a different domain start with fresh browser storage.
