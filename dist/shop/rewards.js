(()=>{
  const id=s=>document.getElementById(s),dialog=id('rewards-dialog'),notice=id('reward-notice');
  let version=0, devicePass=false;
  async function api(path='',body){
    const r=await fetch('/api/rewards'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store'});
    const data=await r.json().catch(()=>null);
    if(r.status===401) return {signedOut:true};
    if(!r.ok||!data)throw new Error(data?.error||'Your pass could not be loaded. Try again.');
    return data;
  }
  function render(pass){
    devicePass=pass.devicePass===true;
    const {points,member,prints=[]}=pass;
    id('reward-signin').hidden=!pass.signedOut;
    id('reward-join').hidden=!!member||!!pass.signedOut;
    id('reward-recovery').hidden=!!member||!!pass.signedOut;
    id('reward-join').textContent=devicePass?'Link this device’s pass to my account':'Join rewards';
    const next=prints.find(p=>p.at>points);
    id('reward-balance').textContent=member?points+' '+(points===1?'point':'points'):'Your collector pass';
    if(pass.signedOut) id('reward-rule').textContent='Sign in to earn points and download member artwork. You can still check out as a guest.';
    else if(member) id('reward-rule').textContent=(next?(next.at-points)+' more points unlock '+next.name+'.':'Your full print collection is unlocked.')+' Earn 1 point per whole AUD spent on products.';
    else id('reward-rule').textContent=devicePass?'A previous pass is stored on this device. Link it to keep your points and artwork.':'Join for the Hill Club print. Earn 1 point per whole AUD spent on products to unlock more artwork.';
    id('reward-prints').replaceChildren(...prints.map(print=>{
      const card=document.createElement('article'),img=new Image(),name=document.createElement('h3'),label=document.createElement(print.available?'a':'span');
      img.src='art/reward-'+print.id+'.webp';img.width=375;img.height=500;img.alt='';img.decoding='async';
      name.textContent=print.name;label.textContent=print.available?'Download print':print.at?print.at+' points':'On joining';
      if(print.available){label.href='/api/rewards/art/'+print.id;label.download='Lemrix-'+print.id+'.webp';label.setAttribute('aria-label','Download '+print.name+' print');}
      card.append(img,name,label);return card;
    }));
  }
  async function perform(action,fn){
    const v=++version;notice.textContent=action;
    const buttons=[id('reward-join'),id('restore-pass').querySelector('button')];buttons.forEach(b=>b.disabled=true);
    try{const state=await fn();if(version===v){render(state);notice.textContent='';}}
    catch(e){if(version===v)notice.textContent=e.message;}
    finally{if(version===v)buttons.forEach(b=>b.disabled=false);}
  }
  function open(){
    if(id('deal-dialog').open)id('deal-dialog').close();
    devicePass=false;
    for(const element of ['reward-signin','reward-join','reward-recovery']) id(element).hidden=true;
    id('reward-balance').textContent='';id('reward-rule').textContent='';id('reward-prints').replaceChildren();
    id('reward-recovery').open=false;
    id('restore-pass').reset();if(!dialog.open)dialog.showModal();
    perform('Loading collector pass…',()=>api());
  }
  for(const button of ['rewards-open','cart-rewards','profile-rewards'])id(button).onclick=open;
  id('reward-signin').onclick=()=>{
    dialog.close();
    if(window.LemrixOffers?.openCustomerSignIn) window.LemrixOffers.openCustomerSignIn();
    else id('account-opener').click();
  };
  id('reward-join').onclick=()=>perform('Opening your pass…',()=>api('/join',{useDevicePass:devicePass}));
  id('restore-pass').onsubmit=e=>{e.preventDefault();perform('Restoring your pass…',()=>api('/recover',{code:e.target.elements.code.value}));};
  window.addEventListener('lemrix-customer-session',()=>{if(dialog.open)open();});
  dialog.addEventListener('close',()=>{version++;id('restore-pass').reset();id('reward-prints').replaceChildren();});
})();
