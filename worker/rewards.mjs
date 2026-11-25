const rewardsPrefix='store/v1/rewards/';
const passCookie='__Host-lemrix-pass';
const rewardPrints=[
  {id:'hill-club',name:'Hill Club',at:0},
  {id:'last-showing',name:'Last Showing',at:25},
  {id:'after-hours',name:'After Hours',at:100}
];
async function passDigest(raw){return hex(await crypto.subtle.digest('SHA-256',encoder.encode(raw)));}
const membershipKey = 'store/v2/rewards/members.json';
const codePattern = /^[a-f0-9]{32}$/;

async function readPass(env, code) {
  if (typeof code !== 'string' || !codePattern.test(code)) return null;
  const id = await passDigest(code);
  const object = await env.BUCKET.get(rewardsPrefix + id + '.json');
  return object ? {code, id, ledger:await object.json()} : null;
}

async function rewardAccount(request, env) {
  const user = await verifiedCustomer(request, env);
  return typeof user?.key === 'string' && user.key ? passDigest(user.key) : null;
}

async function membershipIndex(env) {
  let object = await env.BUCKET.get(membershipKey);
  if (!object) {
    // Older account links only indexed owner -> pass. Import them before allowing
    // a recovery code to claim a pass, including links owned by absent customers.
    const prefix = rewardsPrefix + 'accounts/';
    const members = {};
    let cursor;
    do {
      const page = await env.BUCKET.list({prefix, cursor});
      for (const entry of page.objects) {
        const owner = entry.key.slice(prefix.length);
        if (!/^[a-f0-9]{64}$/.test(owner)) continue;
        const binding = await env.BUCKET.get(entry.key);
        const code = binding && (await binding.json()).code;
        if (!codePattern.test(code || '')) reject(503, 'A legacy pass could not be migrated.');
        members[owner] = code;
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    await env.BUCKET.put(membershipKey, JSON.stringify(members), {onlyIf:new Headers({'If-None-Match':'*'})});
    object = await env.BUCKET.get(membershipKey);
    if (!object) reject(503, 'Rewards are temporarily unavailable.');
  }
  return {members:await object.json(), etag:object.etag};
}

function otherOwner(members, owner, code) {
  return Object.entries(members).some(([key, linked]) => key !== owner && linked === code);
}

async function memberPass(env, members, owner) {
  const code = members[owner];
  if (!code) return null;
  if (otherOwner(members, owner, code)) reject(409, 'Please contact Lemrix about access to this rewards balance.');
  const wallet = await readPass(env, code);
  if (!wallet) reject(503, 'Your Lem Points balance is temporarily unavailable.');
  return wallet;
}

async function currentPass(request, env) {
  const owner = await rewardAccount(request, env);
  return owner ? linkPass(env, owner) : null;
}

async function linkPass(env, owner, wantedCode) {
  let wallet;
  for (let attempt = 0; attempt < 8; attempt++) {
    const {members, etag} = await membershipIndex(env);
    if (members[owner]) {
      if (wantedCode && members[owner] !== wantedCode) reject(409, 'This account already has a collector pass.');
      return memberPass(env, members, owner);
    }
    if (!wallet) {
      if (wantedCode) {
        wallet = await readPass(env, wantedCode);
        if (!wallet) reject(400, 'That recovery code could not be linked.');
      } else {
        const code = randomId(), id = await passDigest(code), ledger = {orders:{}};
        const made = await env.BUCKET.put(rewardsPrefix+id+'.json', JSON.stringify(ledger), {onlyIf:new Headers({'If-None-Match':'*'})});
        if (!made) continue;
        wallet = {code, id, ledger};
      }
    }
    if (otherOwner(members, owner, wallet.code)) reject(409, 'That collector pass is already linked to an account.');
    members[owner] = wallet.code;
    // One conditional write enforces both one pass per account and one account
    // per pass, even if two accounts present the same old code simultaneously.
    if (await env.BUCKET.put(membershipKey, JSON.stringify(members), {onlyIf:new Headers({'If-Match':'"'+etag+'"'})})) return wallet;
  }
  reject(503, 'Please try opening your Lem Points balance again.');
}
function rewardView(wallet, member) {
  const orders = Object.values(wallet?.ledger.orders || {});
  const merchandiseCents = orders.reduce((sum, order) => sum + Math.max(0, (order.subtotal || 0) - (order.refund || 0)), 0);
  const points = Math.floor(merchandiseCents / 100);
  return {member, points, prints:rewardPrints.map(print => ({...print, available:member && points >= print.at}))};
}
async function rewardsRoute(request,env,url) {
  const action=url.pathname.slice('/api/rewards'.length);
  if(request.method==='POST')requireTrustedOrigin(request,url);
  const owner = await rewardAccount(request, env);
  if (!owner) {
    if (request.method === 'GET' && action === '') return json({...rewardView(null, false), signedOut:true}, 401);
    reject(401, 'Sign in to your customer account to use Lem Points.');
  }
  if (request.method === 'POST' && (action === '/join' || action === '/recover')) {
    const body = await readForm(request);
    let wantedCode;
    if (action === '/recover') {
      wantedCode = typeof body.code === 'string' ? body.code.replace(/[\s-]/g,'').toLowerCase() : '';
      if (!codePattern.test(wantedCode)) reject(400, 'Enter your collector pass recovery code.');
    } else if (body.useDevicePass === true) {
      wantedCode = readCookie(request, passCookie);
      if (!codePattern.test(wantedCode || '')) reject(400, 'The previous pass could not be found on this device.');
    }
    const wallet = await linkPass(env, owner, wantedCode);
    return json(rewardView(wallet, true), 200, {'Set-Cookie':shopCookie(passCookie, '', 0)});
  }
  if(request.method!=='GET')reject(405,'Method unavailable.');
  const {members} = await membershipIndex(env);
  const wallet = await memberPass(env, members, owner);
  if(action==='') {
    const code = readCookie(request, passCookie);
    const devicePass = !wallet && codePattern.test(code || '') && !otherOwner(members, owner, code) && !!await readPass(env, code);
    return json({...rewardView(wallet, true), devicePass});
  }
  if(action==='/code') {
    if(!wallet)reject(404,'No previous rewards record found.');
    return json({code:wallet.code.toUpperCase().match(/.{4}/g).join('-')});
  }
  const print=rewardPrints.find(p=>action==='/art/'+p.id);
  if(!print)reject(404,'Reward not found.');
  if(rewardView(wallet, true).points<print.at)reject(403,'This print is still locked.');
  const fixture=rewardArtwork[print.id];
  const stored=fixture ? null : await env.BUCKET.get('store/v2/reward-art/'+print.id);
  if(!fixture && !stored)reject(503,'This print is temporarily unavailable.');
  return new Response(fixture ? Uint8Array.from(atob(fixture),c=>c.charCodeAt(0)) : stored.body,{headers:{
    'Content-Type':'image/webp','Content-Disposition':'attachment; filename="Lemrix-'+print.id+'.webp"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'
  }});
}
async function recordReward(env,metadata,field,cents){
  if(metadata?.store!==checkoutStore||!/^[a-f0-9]{64}$/.test(metadata.reward_pass||'')||!/^[a-f0-9-]{36}$/.test(metadata.attempt||'')||!Number.isSafeInteger(cents)||cents<0)return;
  const key=rewardsPrefix+metadata.reward_pass+'.json';
  for(let tries=0;tries<8;tries++){
    const object=await env.BUCKET.get(key);
    if(!object)return;
    const ledger=await object.json(),order=ledger.orders[metadata.attempt]||{};
    if((order[field]??-1)>=cents)return;
    order[field]=cents;ledger.orders[metadata.attempt]=order;
    if(await env.BUCKET.put(key,JSON.stringify(ledger),{onlyIf:new Headers({'If-Match':'"'+object.etag+'"'})}))return;
  }
  reject(503,'Please retry the rewards update.');
}

