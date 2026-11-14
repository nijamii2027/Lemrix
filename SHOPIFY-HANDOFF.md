# Connecting the real Lemrix shop

The storefront is a finished preview at `/shop/`. It currently uses historical listing photographs, saved cards and working links to Lemrix’s eBay and Whatnot. There are no invented prices, stock counts, orders or checkout screens.

## The three store settings

Edit `dist/shopify-config.js` with the owner’s confirmed values:

```js
window.LEMRIX_SHOPIFY = Object.freeze({
  enabled: true,
  domain: 'YOUR-STORE.myshopify.com',
  storefrontAccessToken: 'YOUR-PUBLIC-STOREFRONT-ACCESS-TOKEN',
  collectionId: 'YOUR-PUBLISHED-COLLECTION-ID'
});
```

Use a public Storefront access token issued for the intended sales channel. Never use an Admin API token or private Storefront token in a browser file. The numeric collection ID must belong to a collection published to that channel, with products available for sale. Confirm the actual store domain with the owner; the old maintenance link is not assumed to be the live store.

`dist/shopify.js` loads Shopify’s current Buy Button JS SDK only when enabled and valid. It mounts the published collection and a real Shopify cart in `#shopify-collection`, then reveals the live shop section on both pages. Stock, prices, variants, currency and checkout come from Shopify. On the shop page, the coming-soon notice is hidden after a successful mount. The clearly labelled archive remains separate and continues to support saves.

The SDK load has a timeout and failure handling. If configuration is disabled, invalid or unavailable, the current eBay/Whatnot routes remain usable. With the default disabled configuration, no Shopify script or API request is made.

## Before enabling commerce

1. Publish the intended products and collection to the Storefront/Buy Button channel. Confirm AUD pricing, variants, stock, shipping, tax and policies in Shopify.
2. Replace the three placeholders; enable the configuration in a private test deployment.
3. Check the actual collection, sold-out behavior, variant selection and cart on desktop and mobile. Complete a merchant-approved test checkout through Shopify, including shipping and tax. Test failure recovery with the store unavailable.
4. Update the shop’s “first look” copy when the owner is ready to launch. Keep archive cards labelled as historical; do not map them to live products by name alone.

The current saved cabinet uses stable archive IDs in browser storage. It is not a customer account, live inventory reservation or Shopify wishlist. A later live wishlist can map verified Shopify product/variant IDs into the same cabinet UI; no such mapping is fabricated here.

Official setup: https://shopify.dev/docs/storefronts/headless/additional-sdks/buy-button

## Other prepared integration

`dist/media-config.js` remains disabled pending the exact verified Lemrix/Logan Paul clip and timestamp, approved still/video assets, captions and source URL. The website does not imply an endorsement or insert unrelated footage.
