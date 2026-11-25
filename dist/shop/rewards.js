(() => {
  const id = name => document.getElementById(name);
  const dialog = id('rewards-dialog');
  const account = id('deal-dialog');
  const notice = id('reward-notice');
  const progress = id('reward-progress');
  const signIn = id('reward-signin');
  const retry = id('reward-retry');
  const pointsLabel = count => count.toLocaleString('en-AU') + (count === 1 ? ' Lem Point' : ' Lem Points');
  let version = 0;
  let state = null;
  let returnAfterSignIn = false;

  async function downloadPrint(print, button) {
    const current = version;
    button.disabled = true;
    notice.textContent = 'Preparing ' + print.name + '…';
    try {
      const response = await fetch('/api/rewards/art/' + print.id, {cache:'no-store'});
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.error || 'The print could not be downloaded. Please try again.');
      }
      const file = await response.blob();
      if (version !== current) return;
      const href = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = href;
      link.download = 'Lemrix-' + print.id + '.webp';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 60000);
      notice.textContent = 'Download started for ' + print.name + '.';
    } catch (error) {
      if (version === current) notice.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  function printCard(print) {
    const card = document.createElement('article');
    const photo = new Image(375, 500);
    photo.src = 'art/reward-' + print.id + '.webp';
    photo.alt = '';
    photo.decoding = 'async';
    const title = document.createElement('h3');
    title.textContent = print.name;
    const action = document.createElement(print.available ? 'button' : 'span');
    if (print.available) {
      action.type = 'button';
      action.className = 'quiet-link';
      action.textContent = 'Download print';
      action.setAttribute('aria-label', 'Download ' + print.name + ' print');
      action.addEventListener('click', () => downloadPrint(print, action));
    } else {
      action.textContent = print.at ? pointsLabel(print.at) : 'Free with an account';
    }
    card.append(photo, title, action);
    return card;
  }

  function render() {
    if (!state) return;
    const {member, points, prints} = state;
    const staff = !member && window.shopEditor?.authenticated;
    const next = member && prints.find(print => print.at > points);
    signIn.hidden = member || staff;
    progress.hidden = !next;
    if (next) {
      progress.max = next.at;
      progress.value = points;
      progress.setAttribute('aria-valuetext', pointsLabel(points) + ' of ' + next.at + ' for ' + next.name);
    }
    id('reward-balance').textContent = member ? 'Your balance · ' + pointsLabel(points) : staff ? 'Shop staff account' : 'Collect Lemrix art prints';
    id('reward-rule').textContent = member
      ? next ? pointsLabel(next.at - points) + ' to unlock ' + next.name + '.' : 'You’ve unlocked all three prints.'
      : staff ? 'You’re signed in as shop staff. Customer purchases earn points when made with a customer account.'
        : 'The Hill Club print comes with your account. Earn points on purchases to unlock the next two prints.';
    id('reward-prints').replaceChildren(...prints.map(printCard));
  }

  async function refresh() {
    const current = ++version;
    state = null;
    signIn.hidden = progress.hidden = retry.hidden = true;
    id('reward-balance').textContent = '';
    id('reward-rule').textContent = '';
    id('reward-prints').replaceChildren();
    notice.textContent = 'Loading Lem Points…';
    try {
      const response = await fetch('/api/rewards', {cache:'no-store'});
      const result = await response.json();
      if ((!response.ok && response.status !== 401) || !Array.isArray(result.prints)) {
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
    id('reward-prints').replaceChildren();
  });
})();
