// Local demo accounts and per-copy offers. All forms stay on this origin.
(() => {
  const id = name => document.getElementById(name);
  const dialog = id('deal-dialog');
  const prefix = 'lemrix.shop.demo.v1.';
  const sessionKey = prefix + 'session';
  const format = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', currencyDisplay: 'code' });
  const decimal = cents => (BigInt(cents) / 100n) + '.' + String(cents % 100).padStart(2, '0');
  const money = cents => format.formatToParts(BigInt(cents) / 100n).map(part => part.type === 'fraction' ? String(cents % 100).padStart(2, '0') : part.value).join('');
  const copyName = index => 'Copy ' + String.fromCharCode(65 + index);
  const accountKey = key => prefix + 'account.' + key;
  const offerPrefix = key => prefix + 'offer.' + key + ':';
  const offerKey = (user, choice) => offerPrefix(user.key) + choice.item.id + ':' + choice.index;
  const draftKey = (user, choice) => prefix + 'draft.' + (user?.key || 'guest') + ':' + choice.item.id + ':' + choice.index;
  const drafts = new Map();
  let selection, offerChoice, view = '', resumeOffer = false, generation = 0;

  function localEntry(key) {
    const raw = localStorage.getItem(key);
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  }
  let googleUser = null;
  function currentUser() {
    if (googleUser) return googleUser;
    try {
      const key = sessionStorage.getItem(sessionKey);
      if (!key) return null;
      const account = localEntry(accountKey(key));
      return key.startsWith('user/') && account?.key === key ? account : null;
    } catch { return null; }
  }
  function existing(user, choice) {
    if (!user || !choice) return null;
    const record = localEntry(offerKey(user, choice));
    return record?.itemId === choice.item.id && record.index === choice.index && Number.isSafeInteger(record.cents) && record.cents > 0 ? record : null;
  }
  function draft(user, choice) {
    const key = draftKey(user, choice);
    try { return sessionStorage.getItem(key) ?? drafts.get(key) ?? ''; } catch { return drafts.get(key) || ''; }
  }
  function setDraft(user, choice, raw) {
    const key = draftKey(user, choice);
    if (raw) drafts.set(key, raw); else drafts.delete(key);
    try {
      if (raw) sessionStorage.setItem(key, raw); else sessionStorage.removeItem(key);
    } catch { /* The in-memory draft still survives a sign-in in this tab. */ }
  }
  function parseAmount(input) {
    const value = input.trim();
    if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(value)) return null;
    const [whole, fraction = ''] = value.split('.');
    const cents = Number((whole || '0') + fraction.padEnd(2, '0'));
    return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
  }
  function hex(bytes) { return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(''); }
  async function credential(pass, salt) {
    const bytes = Uint8Array.from(salt.match(/../g), pair => parseInt(pair, 16));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits']);
    const hash = await crypto.subtle.deriveBits({name: 'PBKDF2', hash: 'SHA-256', salt: bytes, iterations: 185000}, key, 256);
    return hex(new Uint8Array(hash));
  }
  function alertText(message = '') { id('deal-error').textContent = message; }
  function storageError() { alertText('This browser could not save the demo. Enable site storage and try again.'); }
  function nav() {
    if (window.shopEditor?.authenticated) { id('account-nav-label').textContent='Lemrix'; id('account-opener').setAttribute('aria-label','Open shop owner account'); return; }
    const user = currentUser();
    id('account-nav-label').textContent = user ? 'Account' : 'Sign in';
    id('account-opener').setAttribute('aria-label', user ? 'Open account for ' + user.name : 'Sign in or create an account');
  }

  const sections = ['deal-product','deal-offer-form','deal-auth-form','deal-saved','deal-profile','staff-profile'];
  function show(next, heading, intro, shown) {
    generation++;
    view = next;
    alertText();
    for (const section of sections) id(section).hidden = !shown.includes(section);
    id('deal-heading').textContent = heading;
    id('deal-intro').textContent = intro;
    id('deal-auth-submit').disabled = false;
    if (!dialog.open) dialog.showModal();
    id('deal-heading').focus({ preventScroll: true });
  }
  function productSummary(choice) {
    const { item, index } = choice;
    const copy = item.copies[index];
    id('deal-image').src = item.image || 'art/' + item.id + '.webp';
    id('deal-item').textContent = item.name;
    id('deal-copy').textContent = copyName(index) + ' · ' + copy.condition;
    id('deal-list-price').textContent = 'Sample price ' + money(copy.cents);
  }
  function openOffer(choice, restored) {
    offerChoice = choice;
    resumeOffer = false;
    if (window.shopEditor?.authenticated) { show('staff','Lemrix','Press E in the shop to toggle editing.', ['staff-profile']); return; }
    const user = currentUser();
    let prior;
    try { prior = existing(user, choice); } catch { prior = null; }
    show('offer', prior ? 'Edit your offer' : 'Make an offer', 'Demo offers stay in this browser. They do not reserve a card or take payment.', ['deal-product','deal-offer-form']);
    productSummary(choice);
    const input = id('deal-amount');
    input.value = restored ?? (draft(user, choice) || (prior ? decimal(prior.cents) : ''));
    input.placeholder = decimal(choice.item.copies[choice.index].cents);
    input.removeAttribute('aria-invalid');
    id('deal-submit').textContent = user ? (prior ? 'Update demo offer' : 'Save demo offer') : 'Sign in to save offer';
  }
  function openAuth(signup = false) {
    const retained = resumeOffer ? ' Your offer draft is saved.' : '';
    show(signup ? 'signup' : 'signin', signup ? 'Create an account' : 'Sign in',
      (signup ? 'Join with Google, or create a username for this browser demo.' : 'Welcome back to the Lemrix shop.') + retained, ['deal-auth-form']);
    id('deal-pass').value = '';
    renderGoogleButton();
    id('deal-pass').autocomplete = signup ? 'new-password' : 'current-password';
    id('deal-auth-submit').textContent = signup ? 'Create account' : 'Sign in';
    id('deal-auth-swap').textContent = signup ? 'Already registered? Sign in' : "Don't have an account? Sign up";
  }
  function signedIn(user) {
    if (user === googleUser) sessionStorage.removeItem(sessionKey);
    else sessionStorage.setItem(sessionKey, user.key);
    nav();
    id('deal-pass').value = '';
    if (resumeOffer && offerChoice) {
      const amount = draft(null, offerChoice);
      setDraft(user, offerChoice, amount);
      setDraft(null, offerChoice, '');
      openOffer(offerChoice, amount);
    } else openAccount();
  }
  function accountOffers(user) {
    const rows = [];
    const start = offerPrefix(user.key);
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(start)) continue;
      const record = localEntry(key);
      const item = products.find(candidate => candidate.id === record?.itemId);
      if (Number.isInteger(record?.index) && item?.copies?.[record.index] && key === offerKey(user, {item,index:record.index}) && Number.isSafeInteger(record.cents) && record.cents > 0) rows.push({record,item});
    }
    return rows.sort((a,b) => b.record.updated - a.record.updated);
  }
  function openAccount() {
    resumeOffer = false;
    if (window.shopEditor?.authenticated) { show('staff','Lemrix','Press E in the shop to toggle editing.', ['staff-profile']); return; }
    const user = currentUser();
    if (!user) { openAuth(); return; }
    show('account', user.name, (user === googleUser ? user.email + '.' : 'Demo account.') + ' Your offers are saved on this browser.', ['deal-profile']);
    const list = id('deal-offers');
    list.replaceChildren();
    let rows;
    try { rows = accountOffers(user); } catch { storageError(); return; }
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.textContent = 'Choose a card and make an offer on a copy to see it here.';
      list.append(empty);
    }
    rows.forEach(({record, item}) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'deal-record';
      const image = new Image(43,43); image.src = item.image || 'art/' + item.id + '.webp'; image.alt = '';
      const info = document.createElement('span'), name = document.createElement('strong'), description = document.createElement('small');
      name.textContent = item.name; description.textContent = copyName(record.index) + ' · ' + item.copies[record.index].condition;
      info.append(name, description);
      const amount = document.createElement('b'); amount.textContent = money(record.cents);
      button.setAttribute('aria-label','Edit offer for ' + item.name + ', ' + description.textContent + ', ' + amount.textContent);
      button.append(image, info, amount);
      button.addEventListener('click', () => openOffer({item,index: record.index}));
      list.append(button);
    });
  }

  async function submitAuth(event) {
    event.preventDefault();
    const token = generation;
    const signup = view === 'signup';
    const name = id('deal-user').value.trim();
    const pass = id('deal-pass').value;
    alertText();
    if (!/^[a-z0-9._-]{2,24}$/i.test(name)) {
      alertText('Use a 2–24 character username with letters, numbers, dots, dashes or underscores.');
      id('deal-user').focus(); return;
    }
    if (name.toLowerCase() === 'lemrix') {
      if (signup) { alertText('That username is reserved.'); return; }
      id('deal-auth-submit').disabled=true;
      try {
        await window.shopEditor.login(pass);
        sessionStorage.removeItem(sessionKey);
        id('deal-pass').value='';
        nav();
        if (generation === token) openAccount();
      } catch (error) { if (generation === token) alertText(error.message); }
      finally { id('deal-auth-submit').disabled=false; }
      return;
    }
    if (pass.length < 6 || pass.length > 128) { alertText('Use a demo passphrase with 6–128 characters.'); id('deal-pass').focus(); return; }
    if (!window.crypto?.subtle) { alertText('Open the shop over HTTPS to use a demo passphrase or use Google sign-in.'); return; }
    const key = 'user/' + name.toLowerCase();
    id('deal-auth-submit').disabled = true;
    try {
      let user = localEntry(accountKey(key));
      if (signup) {
        if (user) { alertText('That username already has a demo account. Sign in or choose another.'); return; }
        const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
        const hash = await credential(pass, salt);
        if (generation !== token) return;
        if (localEntry(accountKey(key))) { alertText('That username is already in use.'); return; }
        user = {key, name, salt, hash};
        localStorage.setItem(accountKey(key), JSON.stringify(user));
      } else {
        if (!user || !user.salt || await credential(pass, user.salt) !== user.hash) {
          if (generation === token) alertText('That username and passphrase do not match a demo account on this browser.');
          return;
        }
      }
      if (generation === token) signedIn(user);
    } catch { if (generation === token) storageError(); }
    finally { if (generation === token) id('deal-auth-submit').disabled = false; }
  }
  function submitOffer(event) {
    event.preventDefault();
    if (view !== 'offer' || !offerChoice) return;
    const input = id('deal-amount'), raw = input.value;
    const cents = parseAmount(raw);
    if (!cents) {
      input.setAttribute('aria-invalid', 'true');
      alertText('Enter a positive AUD amount with up to two decimal places, such as 18.50.');
      input.focus(); return;
    }
    const user = currentUser();
    if (!user) {
      setDraft(null, offerChoice, raw);
      resumeOffer = true;
      openAuth();
      return;
    }
    const { item, index } = offerChoice;
    try {
      localStorage.setItem(offerKey(user, offerChoice),JSON.stringify({itemId: item.id, index, cents, updated: Date.now()}));
    } catch { storageError(); return; }
    setDraft(user, offerChoice, '');
    show('saved','Offer saved', 'Your ' + money(cents) + ' demo offer for ' + copyName(index) + ' is saved to ' + user.name + ' on this browser.', ['deal-product','deal-saved']);
    productSummary(offerChoice);
  }

  id('account-opener').addEventListener('click', openAccount);
  for (const opener of ['offer-opener','copy-offer']) id(opener).addEventListener('click', () => { if (selection) openOffer(selection); });
  id('deal-close').addEventListener('click', () => dialog.close());
  id('deal-done').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { if (dialog.open) return; generation++; resumeOffer = false; offerChoice = null; id('deal-pass').value = ''; });
  id('deal-offer-form').addEventListener('submit', submitOffer);
  id('deal-auth-form').addEventListener('submit', submitAuth);
  id('deal-auth-swap').addEventListener('click', () => openAuth(view !== 'signup'));
  id('deal-amount').addEventListener('input', () => {
    if (!offerChoice) return;
    id('deal-amount').removeAttribute('aria-invalid');
    alertText();
    setDraft(currentUser(), offerChoice, id('deal-amount').value);
  });
  let googleScript, initialized = 0;
  async function customerApi(action,body) {
    const response=await fetch('/api/customer/'+action, body===undefined?{cache:'no-store'}:{
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)
    });
    const data=await response.json();
    if(!response.ok) throw new Error(data.error || 'Google sign-in is unavailable.');
    return data;
  }
  function loadGoogle() {
    if (!googleScript) googleScript=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src='https://accounts.google.com/gsi/client';
      script.async=true;
      script.onload=resolve;
      script.onerror=()=>{googleScript=null;script.remove();reject(new Error('Google could not load. Reopen sign-in to retry.'));};
      document.head.append(script);
    });
    return googleScript;
  }
  let initialization;
  async function prepareGoogle() {
    const {client,nonce}=await customerApi('challenge',{});
    await loadGoogle();
    window.google.accounts.id.initialize({client_id:client,nonce,auto_select:false,callback:async answer=>{
      try {
        const result=await customerApi('google',{credential:answer.credential});
        googleUser=result.user;
        initialized=0;
        signedIn(googleUser);
      } catch(error){initialized=0;alertText(error.message);renderGoogleButton();}
    }});
    initialized=Date.now();
  }
  async function renderGoogleButton() {
    const container=id('google-button'), status=id('google-status');
    status.textContent='';container.replaceChildren();
    try {
      if (Date.now()-initialized>540000) {
        initialization ||= prepareGoogle().finally(()=>{initialization=null;});
        await initialization;
      }
      if (!['signup','signin'].includes(view)) return;
      container.replaceChildren();
      window.google.accounts.id.renderButton(container,{theme:'outline',size:'large',shape:'pill',text:view==='signup'?'signup_with':'signin_with',width:260});
    } catch(error){status.textContent=error.message;}
  }
  async function restoreGoogle(){
    try {googleUser=(await customerApi('session')).user;nav();if(googleUser && dialog.open && view==='signin' && !resumeOffer) openAccount();} catch {}
  }
  window.addEventListener('pageshow',restoreGoogle);
  id('deal-my-offers').addEventListener('click', openAccount);
  id('deal-logout').addEventListener('click', async () => {
    if(googleUser) {
      try { await customerApi('logout',{}); } catch(error) {alertText(error.message);return;}
      googleUser=null; initialized=0; window.google?.accounts.id.disableAutoSelect();
    }
    try { sessionStorage.removeItem(sessionKey); } catch { storageError(); return; }
    nav();
    id('deal-user').value = '';
    openAuth();
    id('deal-intro').textContent = 'You’re signed out. Sign in again on this browser to see your offers.';
  });
  window.addEventListener('hashchange', () => { if (dialog.open) dialog.close(); });
  window.addEventListener('shop-account-change',nav);
  id('staff-toggle').onclick=()=>{ dialog.close(); window.shopEditor.toggle(); };
  for (const key of ['staff-logout','staff-logout-all']) id(key).onclick=async()=>{
    try { if (await window.shopEditor.logout(key.endsWith('all'))) openAuth(); } catch(error) {alertText(error.message);}
  };
  window.addEventListener('pageshow', nav);
  window.LemrixOffers = {
    setCopy(item, index = 0) {
      selection = item?.copies?.[index] ? { item, index } : null;
      id('offer-opener').hidden = !selection;
      if (selection) id('copy-offer').textContent = 'Make an offer on ' + copyName(index);
    }
  };
  nav();
})();
