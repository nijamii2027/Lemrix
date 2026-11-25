(()=>{
  const id=s=>document.getElementById(s),dialog=id('rewards-dialog'),notice=id('reward-notice');
  let version=0;
  async function api(path='',body){
    const r=await fetch('/api/rewards'+path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store'});
    const data=await r.json().catch(()=>null);
    if(!r.ok||!data)throw new Error(data?.error||'Your pass could not be loaded. Try again.');
    return data;
  }
  function render(pass){
    const {points,member,prints}=pass;
    const next=prints.find(p=>p.at>points);
    id('reward-balance').textContent=member?points+' '+(points===1?'point':'points'):'Your collector pass';
    id('reward-rule').textContent=member?(next?(next.at-points)+' more points unlock '+next.name+'.':'Your full print collection is unlocked.')+' Earn 1 point per whole AUD spent on products.':'Join for the Hill Club print. Earn 1 point per whole AUD spent on products to unlock more artwork.';
    id('reward-join').hidden=member;id('reward-code').hidden=!member;id('reward-recovery').hidden=member;
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
    id('reward-code').open=false;id('reward-secret').textContent='';id('reward-recovery').open=false;
    id('restore-pass').reset();dialog.showModal();
    perform('Loading collector pass…',()=>api());
  }
  for(const button of ['rewards-open','cart-rewards','profile-rewards'])id(button).onclick=open;
  id('reward-join').onclick=()=>perform('Opening your pass…',()=>api('/join',{}));
  id('restore-pass').onsubmit=e=>{e.preventDefault();perform('Restoring your pass…',()=>api('/recover',{code:e.target.elements.code.value}));};
  id('show-code').onclick=async()=>{try{const data=await api('/code');if(dialog.open)id('reward-secret').textContent=data.code;}catch(e){notice.textContent=e.message;}};
  dialog.addEventListener('close',()=>{version++;id('reward-secret').textContent='';});
})();
