const rewardsPrefix='store/v1/rewards/';
const passCookie='__Host-lemrix-pass';
const rewardPrints=[
  {id:'hill-club',name:'Hill Club',at:0},
  {id:'last-showing',name:'Last Showing',at:25},
  {id:'after-hours',name:'After Hours',at:100}
];
async function passDigest(raw){return hex(await crypto.subtle.digest('SHA-256',encoder.encode(raw)));}
function passResponse(data,code){
  return json(data,200,code?{'Set-Cookie':shopCookie(passCookie,code,365*86400)}:{});
}
async function readPass(env,code){
  if(!/^[a-f0-9]{32}$/.test(code||''))return null;
  const id=await passDigest(code),object=await env.BUCKET.get(rewardsPrefix+id+'.json');
  return object?{code,id,ledger:await object.json()}:null;
}
async function accountPassKey(request,env){
  const token=readCookie(request,customerCookie);
  if(!/^[a-f0-9]{64}$/.test(token||''))return null;
  const obj=await env.BUCKET.get(await sessionPath(token));
  const session=obj&&await obj.json();
  return session?.expires>Date.now()&&session.user?.key?rewardsPrefix+'accounts/'+await passDigest(session.user.key):null;
}
async function currentPass(request,env){
  const account=await accountPassKey(request,env);
  if(account){
    const linked=await env.BUCKET.get(account);
    if(linked)return readPass(env,(await linked.json()).code);
  }
  return readPass(env,readCookie(request,passCookie));
}
function rewardView(wallet){
  const points=wallet?Object.values(wallet.ledger.orders).reduce((sum,o)=>sum+Math.floor(Math.max(0,(o.subtotal||0)-(o.refund||0))/100),0):0;
  return {member:!!wallet,points,prints:rewardPrints.map(p=>({...p,available:!!wallet&&points>=p.at}))};
}
async function rewardsRoute(request,env,url) {
  const action=url.pathname.slice('/api/rewards'.length);
  if(request.method==='POST')requireTrustedOrigin(request,url);
  if(request.method==='POST' && (action==='/join'||action==='/recover')){
    let wallet;
    if(action==='/recover'){
      const {code}=await readForm(request);
      wallet=await readPass(env,typeof code==='string'?code.replace(/[\s-]/g,'').toLowerCase():'');
      if(!wallet)reject(400,'That recovery code did not open a pass.');
    }else wallet=await currentPass(request,env);
    if(!wallet){
      const code=randomId(),id=await passDigest(code),ledger={orders:{}};
      await env.BUCKET.put(rewardsPrefix+id+'.json',JSON.stringify(ledger),{onlyIf:new Headers({'If-None-Match':'*'})});
      wallet={code,id,ledger};
    }
    const account=await accountPassKey(request,env);
    if(account){
      const created=await env.BUCKET.put(account,JSON.stringify({code:wallet.code}),{onlyIf:new Headers({'If-None-Match':'*'})});
      if(!created){
        const linked=await env.BUCKET.get(account),known=linked&&await readPass(env,(await linked.json()).code);
        if(known&&known.id!==wallet.id){
          if(action==='/recover')reject(409,'This account already has a different pass. Sign out to restore this code.');
          wallet=known;
        }
      }
    }
    return passResponse(rewardView(wallet),wallet.code);
  }
  if(request.method!=='GET')reject(405,'Method unavailable.');
  const wallet=await currentPass(request,env);
  if(action==='')return passResponse(rewardView(wallet));
  if(!wallet)reject(401,'Join rewards or restore your collector pass.');
  if(action==='/code')return passResponse({code:wallet.code.toUpperCase().match(/.{4}/g).join('-')});
  const print=rewardPrints.find(p=>action==='/art/'+p.id);
  if(!print)reject(404,'Reward not found.');
  if(rewardView(wallet).points<print.at)reject(403,'This print is still locked.');
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

