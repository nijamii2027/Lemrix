(() => {
  const id = name => document.getElementById(name);
  const dialog = id('rewards-dialog');
  const account = id('deal-dialog');
  const notice = id('reward-notice');
  const signIn = id('reward-signin');
  const retry = id('reward-retry');
  const pointsLabel = count => count.toLocaleString('en-AU') + (count === 1 ? ' Lem Point' : ' Lem Points');
  let version = 0;
  let state = null;
  let returnAfterSignIn = false;

  function render() {
    if (!state) return;
    const {member, points} = state;
    const staff = !member && window.shopEditor?.authenticated;
    signIn.hidden = member || staff;
    id('reward-balance').textContent = member ? 'Your balance · ' + pointsLabel(points) : staff ? 'Shop staff account' : '';
    id('reward-rule').textContent = member || staff ? '' : 'Sign in to earn points on your purchases.';
  }

  async function refresh() {
    const current = ++version;
    state = null;
    signIn.hidden = retry.hidden = true;
    id('reward-balance').textContent = '';
    id('reward-rule').textContent = '';
    notice.textContent = 'Loading Lem Points…';
    try {
      const response = await fetch('/api/rewards', {cache:'no-store'});
      const result = await response.json();
      if ((!response.ok && response.status !== 401) || typeof result.member !== 'boolean' || !Number.isSafeInteger(result.points)) {
        throw new Error(result.error || 'Your Lem Points could not be loaded.');
      }
      if (version !== current) return;
      state = result;
      render();
      notice.textContent = '';
    } catch {
      if (version !== current) return;
      notice.textContent = 'Your Lem Points could not be loaded. Please try again.';
      retry.hidden = false;
    }
  }

  function open() {
    if (account.open) account.close();
    if (!dialog.open) dialog.showModal();
    refresh();
  }
  for (const button of ['nav-rewards', 'rewards-open', 'cart-rewards', 'profile-rewards']) {
    id(button)?.addEventListener('click', open);
  }
  retry.addEventListener('click', refresh);
  signIn.addEventListener('click', () => {
    returnAfterSignIn = true;
    dialog.close();
    window.LemrixOffers.openCustomerSignIn();
  });
  account.addEventListener('close', () => { returnAfterSignIn = false; });
  window.addEventListener('lemrix-customer-session', event => {
    if (returnAfterSignIn && event.detail?.user) {
      returnAfterSignIn = false;
      queueMicrotask(open);
    } else if (dialog.open) {
      refresh();
    }
  });
  window.addEventListener('shop-account-change', () => { if (dialog.open) render(); });
  window.addEventListener('pageshow', event => { if (event.persisted && dialog.open) refresh(); });
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    version++;
    state = null;
  });
})();
