// Set the site's motion choice before styling or scene scripts run.
(() => {
  const root=document.documentElement, device=matchMedia('(prefers-reduced-motion: reduce)');
  const key='lemrix-motion';
  let manual;
  function restore(){
    try{manual=localStorage.getItem(key);}catch{}
    apply();
  }
  function apply(){
    const next=['full','reduced'].includes(manual)?manual:device.matches?'reduced':'full';
    const changed=root.dataset.motion!==next;
    root.dataset.motion=next;
    const button=document.querySelector('[data-motion-toggle]');
    if(button){
      button.textContent=next==='full'?'Pause animations':'Play animations';
      button.hidden=false;
    }
    if(changed)window.dispatchEvent(new Event('lemrix-motion-change'));
  }
  document.addEventListener('click',e=>{
    if(!e.target.closest?.('[data-motion-toggle]'))return;
    manual=root.dataset.motion==='full'?'reduced':'full';
    try{localStorage.setItem(key,manual);}catch{}
    apply();
  });
  window.LemrixMotion={get matches(){return root.dataset.motion==='reduced';}};
  if(device.addEventListener)device.addEventListener('change',apply);else device.addListener(apply);
  window.addEventListener('storage',e=>{if(e.key===key||e.key===null)restore();});
  window.addEventListener('pageshow',restore);
  document.addEventListener('DOMContentLoaded',apply,{once:true});
  restore();
})();
