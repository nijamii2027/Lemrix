// Customer accounts, listing offers and staff decisions.
(() => {
  const id = name => document.getElementById(name);
  const dialog = id('deal-dialog');
  const prefix = 'lemrix.shop.v2.';
  const format = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', currencyDisplay: 'code' });
  const decimal = cents => (BigInt(cents) / 100n) + '.' + String(cents % 100).padStart(2, '0');
  const money = cents => format.formatToParts(BigInt(cents) / 100n).map(part => part.type === 'fraction' ? String(cents % 100).padStart(2, '0') : part.value).join('');
  const copyName = index => 'Copy ' + String.fromCharCode(65 + index);
  const draftKey = (user, choice) => prefix + 'draft.' + (user?.key || 'guest') + ':' + choice.item.id + ':' + choice.index;
  const drafts = new Map();
  let selection, offerChoice, view = '', resumeOffer = false, generation = 0;

  let providerUser = null;
  let sessionRevision=0;
  function currentUser() { return providerUser; }
  function updateCustomer(user) {
    sessionRevision++;
    providerUser=user || null;
    nav();
    window.dispatchEvent(new CustomEvent('lemrix-customer-session',{detail:{user:providerUser}}));
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
  function alertText(message = '') { id('deal-error').textContent = message; }
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
    const copy = item.copies?.[index];
    id('deal-image').src = copy?.photos?.front || item.image || 'art/' + item.id + '.webp';
    id('deal-item').textContent = item.name;
    id('deal-copy').textContent = copy ? copyName(index) + ' · ' + copy.condition : item.category;
    id('deal-list-price').textContent = 'Listed at ' + money(copy?.cents ?? item.cents);
  }
  function openOffer(choice, restored) {
    if (window.shopEditor?.authenticated) { openAccount(); return; }
    offerChoice = choice;
    resumeOffer = false;
    const user = currentUser();
    const prior = choice.record;
    show('offer', prior ? 'Edit your offer' : 'Make an offer',
      'Offer on one item. Check your account for a response. Shipping is calculated at checkout.',
      ['deal-product','deal-offer-form']);
    productSummary(choice);
    const input = id('deal-amount');
    input.value = restored ?? (draft(user, choice) || (prior ? decimal(prior.cents) : ''));
    input.placeholder = decimal(choice.item.copies?.[choice.index]?.cents ?? choice.item.cents);
    input.removeAttribute('aria-invalid');
    id('deal-submit').disabled = false;
    const submit = id('deal-submit');
    submit.textContent = user ? (prior ? 'Update offer' : 'Send offer') : 'Sign in to send offer';
    if (user && !prior) {
      const token = generation;
      submit.disabled = true;
      offerApi('offers/lookup',{itemId:choice.item.id,copy:choice.index}).then(({offer}) => {
        if (generation !== token || !offer) return;
        if (offer.status === 'pending') {
          offerChoice = {...choice,record:offer};
          id('deal-heading').textContent = 'Edit your offer';
          submit.textContent = 'Update offer';
          if (!input.value) input.value = decimal(offer.cents);
        } else if (offer.status === 'accepted') openAccount();
      }).catch(error => {if(generation === token) alertText(error.message);})
        .finally(() => {if(generation === token) submit.disabled = false;});
    }
  }
  function openAuth(signup = false) {
    const retained = resumeOffer ? ' Your offer draft is saved.' : '';
    show(signup ? 'signup' : 'signin', signup ? 'Create an account' : 'Sign in',
      (signup ? 'Choose a username and a password of at least 12 characters.' : 'Welcome back to the Lemrix shop.') + retained, ['deal-auth-form']);
    id('deal-pass').value = '';
    renderProviderButtons();
    id('deal-pass').minLength = signup ? 12 : 1;
    id('deal-pass').autocomplete = signup ? 'new-password' : 'current-password';
    id('deal-auth-submit').textContent = signup ? 'Create account' : 'Sign in';
    id('deal-auth-swap').textContent = signup ? 'Already registered? Sign in' : "Don't have an account? Sign up";
  }
  function signedIn(user) {
    updateCustomer(user);
    id('deal-pass').value = '';
    if (resumeOffer && offerChoice) {
      const amount = draft(null, offerChoice);
      setDraft(user, offerChoice, amount);
      setDraft(null, offerChoice, '');
      openOffer(offerChoice, amount);
    } else openAccount();
  }
  async function offerApi(action, body) {
    const response = await fetch('/api/' + action, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Offers are temporarily unavailable. Please try again.');
    return data;
  }
  function offerAction(label, callback) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'deal-text'; button.textContent = label;
    button.addEventListener('click', async () => {
      const token = generation;
      button.disabled = true; alertText();
      try { await callback(); } catch(error) { if (generation === token) alertText(error.message); }
      finally {button.disabled = false;}
    });
    return button;
  }
  const statusLabels = {pending:'Awaiting review',accepted:'Accepted',declined:'Declined',purchased:'Purchased',expired:'Expired'};
  function offerRow(record, staff) {
    const card = document.createElement('article'), info = document.createElement('div');
    card.className = 'offer-review'; info.className = 'deal-record';
    const summary = document.createElement('span'), title = document.createElement('strong'), details = document.createElement('small');
    title.textContent = record.name;
    const status = statusLabels[record.status] || record.status;
    const copy = record.copy === null ? '' : copyName(record.copy) + ' · ' + record.condition;
    details.textContent = [staff && record.buyer,copy,status].filter(Boolean).join(' · ');
    summary.append(title,details);
    const price = document.createElement('b'); price.textContent = money(record.cents);
    info.append(summary,price); card.append(info);
    const actions = document.createElement('div'); actions.className = 'offer-actions';
    if (staff && record.status === 'pending') {
      const listPrice = document.createElement('small'); listPrice.textContent = 'Listed at ' + money(record.listCents);
      actions.append(listPrice);
      for (const [label,decision] of [['Accept','accepted'],['Decline','declined']]) {
        actions.append(offerAction(label, async () => {
          await offerApi('staff/offers/review',{id:record.id,version:record.version,status:decision});
          if (view === 'staff' && dialog.open) openAccount();
        }));
      }
    }
    if (!staff && record.status === 'accepted') {
      const validity = document.createElement('small');
      validity.textContent = 'Valid for 7 days from acceptance, while stock lasts.';
      actions.append(validity,offerAction('Check out with Square',async () => {
        if (checkoutInProgress()) throw new Error('Finish or cancel the open checkout first.');
        const token = generation;
        const result = await offerApi('offers/checkout',{id:record.id,version:record.version});
        const url = squareAddress(result.url);
        if (!attemptPattern.test(result.attempt) || !url) throw new Error('Square could not open this checkout.');
        setOwnedAttempt(result.attempt);
        if (dialog.open && view === 'account' && generation === token) location.assign(url);
        else showRecovery('Your offer checkout is ready.',{resume:true,cancel:true});
      }));
    }
    if (!staff && record.status === 'pending') {
      const item = products.find(row => row.id === record.itemId);
      if (item && (item.copies?.[record.copy] || item).canBuy) {
        actions.append(offerAction('Edit offer',() => openOffer({item,index:record.copy,record})));
      }
    }
    if (actions.childElementCount) card.append(actions);
    return card;
  }
  async function loadOffers(list, staff, token, cursor) {
    const route = staff ? 'staff/offers/list' : 'offers/list';
    try {
      const data = await offerApi(route,{cursor});
      if (generation !== token || !dialog.open) return;
      if (!cursor) list.replaceChildren();
      list.querySelector('.more-offers')?.remove();
      for (const record of data.offers) list.append(offerRow(record,staff));
      if (data.cursor) {
        const more = offerAction('Show more offers',() => loadOffers(list,staff,token,data.cursor));
        more.classList.add('more-offers'); list.append(more);
      }
      if (!list.childElementCount) list.textContent = staff ? 'No customer offers yet.' : 'Your offers will appear here.';
    } catch(error) {
      if (generation !== token) return;
      if (!cursor) list.replaceChildren(offerAction('Retry loading offers',() => loadOffers(list,staff,token)));
      alertText(error.message);
    }
  }
  function openAccount() {
    resumeOffer = false;
    const staff = !!window.shopEditor?.authenticated;
    const user = currentUser();
    if (!staff && !user) { openAuth(); return; }
    if (staff) show('staff','Lemrix','Manage your shop and review customer offers.', ['staff-profile']);
    else show('account',user.name,user.email || 'Your Lemrix account', ['deal-profile']);
    const list = id(staff ? 'staff-offers' : 'deal-offers');
    list.textContent = 'Loading offers…';
    loadOffers(list,staff,generation);
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
        if (currentUser()) await customerApi('logout',{});
        updateCustomer(null);
        id('deal-pass').value='';
        nav();
        if (generation === token) openAccount();
      } catch (error) { if (generation === token) alertText(error.message); }
      finally { id('deal-auth-submit').disabled=false; }
      return;
    }
    id('deal-auth-submit').disabled = true;
    try {
      const {user}=await customerApi(signup?'register':'login',{username:name,password:pass});
      if (generation===token) signedIn(user);
      else updateCustomer(user);
    } catch(error) { if (generation===token) alertText(error.message); }
    finally { if (generation===token) id('deal-auth-submit').disabled=false; }
  }
  async function submitOffer(event) {
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
    const { item, index, record } = offerChoice;
    const token = generation, choice = offerChoice;
    const listCents = item.copies?.[index]?.cents ?? item.cents;
    if (cents > listCents) { alertText('Enter an offer up to the listed price.'); input.focus(); return; }
    id('deal-submit').disabled = true;
    try {
      await offerApi('offers/submit',{itemId:item.id,copy:index,cents,version:record?.version});
      setDraft(user, choice, '');
      if (generation !== token) return;
      show('saved','Offer sent','Lemrix received your ' + money(cents) + ' offer. You can check its status in your account.', ['deal-product','deal-saved']);
      productSummary(choice);
    } catch(error) { if (generation === token) alertText(error.message); }
    finally {if(generation===token) id('deal-submit').disabled=false;}
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
  let initialized=0, initialization;
  const scripts=new Map();
  async function customerApi(action,body) {
    const response=await fetch('/api/customer/'+action, body===undefined?{cache:'no-store'}:{
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)
    });
    const data=await response.json();
    if(!response.ok) throw new Error(data.error || 'Customer sign-in is unavailable.');
    return data;
  }
  function loadProvider(name,src) {
    if (!scripts.has(name)) scripts.set(name,new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src=src;
      script.async=true;
      script.onload=resolve;
      script.onerror=()=>{scripts.delete(name);script.remove();reject(new Error(name+' could not load. Reopen sign-in to retry.'));};
      document.head.append(script);
    }));
    return scripts.get(name);
  }
  async function finishProvider(provider,credential) {
    try {
      const {user}=await customerApi(provider,{credential});
      signedIn(user);
    } catch(error){alertText(error.message);}
    finally {initialized=0;}
  }
  async function setupProviderButtons() {
    const {clients,nonce}=await customerApi('challenge',{});
    const apple=id('apple-button');
    const tasks=[];
    if (clients.google) tasks.push((async()=>{
      await loadProvider('Google','https://accounts.google.com/gsi/client');
      window.google.accounts.id.initialize({client_id:clients.google,nonce,auto_select:false,
        callback:answer=>finishProvider('google',answer.credential)});
    })());
    if (clients.apple) tasks.push((async()=>{
      await loadProvider('Apple','https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js');
      const state=crypto.randomUUID();
      window.AppleID.auth.init({clientId:clients.apple,scope:'name email',redirectURI:location.origin+'/shop/',state,nonce,usePopup:true});
      apple.onclick=async()=>{
        apple.disabled=true;
        try {
          const {authorization}=await window.AppleID.auth.signIn();
          if (authorization?.state!==state || !authorization.id_token) throw new Error('Apple could not confirm the sign-in.');
          await finishProvider('apple',authorization.id_token);
        } catch(error) {
          if (error?.error!=='popup_closed_by_user') alertText(error?.message || 'Apple sign-in was interrupted. Please try again.');
        } finally {apple.disabled=false;}
      };
      apple.hidden=false;
    })());
    const settled=await Promise.allSettled(tasks);
    const errors=settled.filter(outcome=>outcome.status==='rejected').map(outcome=>outcome.reason.message);
    if (!errors.length) initialized=Date.now();
    return {google:!!clients.google && settled[0]?.status==='fulfilled',errors};
  }
  let available={};
  async function renderProviderButtons() {
    const container=id('google-button'), status=id('google-status');
    status.textContent='';container.replaceChildren();
    try {
      if (Date.now()-initialized>540000) {
        id('apple-button').hidden=true;
        initialization ||= setupProviderButtons().finally(()=>{initialization=null;});
        available=await initialization;
      }
      if (!['signup','signin'].includes(view)) return;
      container.replaceChildren();
      if (available.google) window.google.accounts.id.renderButton(container,{theme:'outline',size:'large',shape:'pill',text:view==='signup'?'signup_with':'signin_with',width:260});
      status.textContent=(available.errors || []).join(' ');
    } catch(error){status.textContent=error.message;}
  }
  async function restoreCustomer(){
    const revision=sessionRevision;
    try {
      const {user}=await customerApi('session');
      if (revision!==sessionRevision) return;
      updateCustomer(user);
      if (user && dialog.open && view==='signin' && !resumeOffer) openAccount();
    } catch { /* The sign-in form remains available during a network interruption. */ }
  }
  window.addEventListener('pageshow',restoreCustomer);
  id('deal-my-offers').addEventListener('click', openAccount);
  id('deal-logout').addEventListener('click', async () => {
    if(providerUser) {
      try { await customerApi('logout',{}); } catch(error) {alertText(error.message);return;}
      updateCustomer(null); initialized=0; window.google?.accounts.id.disableAutoSelect();
    }
    nav();
    id('deal-user').value = '';
    openAuth();
    id('deal-intro').textContent = 'You’re signed out.';
  });
  window.addEventListener('hashchange', () => { if (dialog.open) dialog.close(); });
  window.addEventListener('shop-account-change',nav);
  id('staff-toggle').onclick=()=>{ dialog.close(); window.shopEditor.toggle(); };
  for (const key of ['staff-logout','staff-logout-all']) id(key).onclick=async()=>{
    try { if (await window.shopEditor.logout(key.endsWith('all'))) openAuth(); } catch(error) {alertText(error.message);}
  };
  window.addEventListener('pageshow', nav);
  window.LemrixOffers = {
    openCustomerSignIn() { resumeOffer=false; openAuth(); },
    setCopy(item, index = 0) {
      const selected = item?.copies ? item.copies[index] : item;
      selection = selected?.canBuy && item.collection !== 'pre-orders' ? {item,index:item.copies ? index : null} : null;
      id('copy-offer').hidden = !selection || index === null;
      id('offer-opener').hidden = !selection;
      if (selection && index !== null) id('copy-offer').textContent = 'Make an offer on ' + copyName(index);
    }
  };
  nav();
})();
