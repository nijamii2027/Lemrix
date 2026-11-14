'use strict';
(async function () {
  const config = window.LEMRIX_SHOPIFY;
  const section = document.querySelector('#live-shop');
  // Disabled by default: the real existing shop links remain usable.
  if (!config?.enabled || !section) return;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(config.domain) ||
      !/^\d+$/.test(config.collectionId) ||
      !config.storefrontAccessToken || /YOUR-/i.test(config.storefrontAccessToken + config.domain)) {
    console.warn('Lemrix Shopify: replace the placeholder configuration before enabling.');
    return;
  }
  try {
    if (!window.ShopifyBuy?.UI) await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://sdks.shopifycdn.com/buy-button/latest/buy-button-storefront.min.js';
      script.async = true;
      const timer=setTimeout(()=>{script.remove();reject(new Error('Shopify SDK timed out'));},15000);
      script.onload=()=>{clearTimeout(timer);resolve();};
      script.onerror=()=>{clearTimeout(timer);reject(new Error('Shopify SDK unavailable'));};
      document.head.append(script);
    });
    const client = window.ShopifyBuy.buildClient({
      domain: config.domain,
      storefrontAccessToken: config.storefrontAccessToken
    });
    const ui = await window.ShopifyBuy.UI.onReady(client);
    const button = {'background-color':'#182359','border-radius':'100px',':hover':{'background-color':'#2a356e'},':focus':{'background-color':'#2a356e'}};
    await ui.createComponent('collection', {
      id: config.collectionId,
      node: document.querySelector('#shopify-collection'),
      options: {
        product: {buttonDestination:'cart',styles:{button,title:{color:'#182359'},price:{color:'#182359'}},text:{button:'Add to bag'}},
        cart: {styles:{button},text:{button:'Checkout'},popup:false},
        toggle: {styles:{toggle:{'background-color':'#182359'}}}
      }
    });
    section.hidden=false;
    document.documentElement.dataset.shopState='connected';
    const note=document.querySelector('.shop-preview-note');if(note)note.hidden=true;
    window.dispatchEvent(new CustomEvent('lemrix:shop-ready'));
  } catch (error) {
    section.hidden = true;
    console.warn('Lemrix Shopify is unavailable. The existing shop links are still available.');
  }
})();
