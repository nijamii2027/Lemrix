'use strict';
function rewardIcon(path, attributes = '') {
 return `<svg ${attributes} viewBox="0 0 24 24" class="reward-ink-icon" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>`;
}
const spinIcon = rewardIcon('M20 11a8 8 0 1 1-2-5.3L20 8m0-5v5h-5');
const arrowIcon = rewardIcon('M5 19 19 5M7 5h12v12');
const prizes=[
 {id:'blue-hour',label:'NIGHT SKY',type:'PHONE WALLPAPER',title:'Night Sky wallpaper',description:'Download the phone wallpaper as an SVG.',file:'/rewards/blue-hour-phone.svg',filename:'Lemrix-Blue-Hour-Phone.svg',icon:'M12 2v20M2 12h20M5 5l14 14M5 19 19 5',colour:'#182359'},
 {id:'binder-kit',label:'BINDER KIT',type:'PRINTABLE LABELS',title:'Binder labels',description:'Print the A4 sheet at actual size and cut along the guides.',file:'/rewards/binder-labels.svg',filename:'Lemrix-Binder-Labels.svg',icon:'M5 3h14v18H5zM8 8h8M8 12h8M8 16h5',colour:'#627d7e'},
 {id:'club-badge',label:'MOON CLUB',type:'DIGITAL COLLECTOR BADGE',title:'Moon Club badge',description:'Your digital badge is in My rewards.',icon:'M12 2v20M2 12h20M5 5l14 14M5 19 19 5',colour:'#182359'},
 {id:'desk-drop',label:'DESK DROP',type:'DESKTOP WALLPAPER',title:'Desk Drop wallpaper',description:'Download the 16:9 desktop wallpaper as an SVG.',file:'/rewards/desk-drop.svg',filename:'Lemrix-Desk-Drop.svg',icon:'M5 19 19 5M7 5h12v12',colour:'#182359'},
 {id:'collector-notes',label:'COLLECTOR NOTES',type:'COLLECTION TRACKER',title:'Collection tracker',description:'Open the CSV in a spreadsheet to track cards, sets, condition and notes.',file:'/rewards/collector-notes.csv',filename:'Lemrix-Collector-Notes.csv',icon:'M12 3v18M3 12h18',colour:'#627d7e'},
 {id:'gold-badge',label:'GOLDEN FIND',type:'DIGITAL COLLECTOR BADGE',title:'Golden Find badge',description:'Your digital badge is in My rewards.',icon:'M12 2l3 7 7 3-7 3-3 7-3-7-7-3 7-3z',colour:'#9b7833'}
];
let rewards=read('lemrix.rewards.v1',[]);rewards=Array.isArray(rewards)?rewards.filter(r=>r&&prizes.some(p=>p.id===r.id)&&Number.isFinite(r.date)):[];
let lastSpin=Number(read('lemrix.last-spin.v1',0))||0,spinning=false,rotation=0;const DAY=86400000;
function wheelSVG(){
 const palette=['#fff5dd','#ffd27b','#bfdce7'];
 const slices=prizes.map((prize,index)=>{
  const start=(index*60-90)*Math.PI/180;
  const end=start+Math.PI/3;
  const point=angle=>`${210+199*Math.cos(angle)} ${210+199*Math.sin(angle)}`;
  const [first,second]=prize.label.split(' ');
  return `<path d="M210 210 L${point(start)} A199 199 0 0 1 ${point(end)} Z" fill="${palette[index%palette.length]}" stroke="#182359"/>
   <g transform="rotate(${index*60+30} 210 210)" fill="#182359" color="#182359" text-anchor="middle" font-family="Ranade,sans-serif">
    <text x="210" y="65" font-weight="700" font-size="15"><tspan x="210">${first}</tspan><tspan x="210" dy="17">${second}</tspan></text>
    ${rewardIcon(prize.icon, 'x="197" y="94" width="26" height="26"')}
   </g>`;
 });
 return `<svg viewBox="0 0 420 420" xmlns="http://www.w3.org/2000/svg"><circle cx="210" cy="210" r="208" fill="#182359" stroke="#ffd27b"/>${slices.join('')}</svg>`;
}
$('#prize-wheel').innerHTML=wheelSVG();$('#prize-odds').innerHTML=prizes.map(p=>`<li><span>${p.label.toLowerCase()} · ${p.type.toLowerCase()}</span><b>1 in 6</b></li>`).join('');
function updateSpinState(){const rem=Math.max(0,DAY-(Date.now()-lastSpin)),b=$('#spin-button');b.disabled=spinning||rem>0;if(spinning){b.textContent='Spinning…';return;}if(rem){const minutes=Math.ceil(rem/60000);b.textContent=`Next spin in ${Math.floor(minutes/60)}h ${minutes%60}m`;}else{b.innerHTML=`Take a free spin ${spinIcon}`;}$('#rewards-count').textContent=new Set(rewards.map(r=>r.id)).size;}
function randomPrize(){if(!globalThis.crypto?.getRandomValues)return Math.floor(Math.random()*6);const b=new Uint32Array(1);do{crypto.getRandomValues(b);}while(b[0]>=4294967292);return b[0]%6;}
function showReward(p){$('#reward-detail').innerHTML=`<div class="reward-symbol" style="color:${p.colour}" aria-hidden="true">${rewardIcon(p.icon)}</div><h2 id="reward-title">${p.title}</h2><p>${p.description}</p>${p.file?`<a class="button button-blue" href="${p.file}" download="${p.filename}">Download</a>`:''}<button class="text-link view-all-rewards">View my rewards</button>`;openDialog('#reward-dialog');}
let finishSpin=null,pendingReward=null;
function revealPendingReward(){if(!pendingReward||document.hidden||$('dialog[open]'))return;const prize=pendingReward;pendingReward=null;showReward(prize);}
$('#spin-button').addEventListener('click',()=>{
 lastSpin=Number(read('lemrix.last-spin.v1',lastSpin))||0;if(spinning||Date.now()-lastSpin<DAY){updateSpinState();return;}
 spinning=true;const i=randomPrize();lastSpin=Date.now();const persist=write('lemrix.last-spin.v1',lastSpin);rewards.push({id:prizes[i].id,date:lastSpin});write('lemrix.rewards.v1',rewards);
 const target=(690-i*60)%360;
 const from=rotation;
 rotation+=1800+((target-rotation%360+360)%360);
 const wheel=$('#prize-wheel'),stage=$('.wheel-stage'),button=$('#spin-button');
 const motion=window.LemrixMotionState;
 let complete=false,stop,began;
 const finish=()=>{
  if(complete)return;complete=true;stop?.();wheel.style.transform=`rotate(${rotation}deg)`;stage.classList.remove('is-spinning');button.removeAttribute('aria-busy');
  spinning=false;finishSpin=null;updateSpinState();$('#wheel-caption').textContent=`You found ${prizes[i].title}.`;pendingReward=prizes[i];revealPendingReward();if(!persist)notify('Browser storage is unavailable. Download your prize to keep it.');
 };
 finishSpin=finish;
 stage.classList.add('is-spinning');button.setAttribute('aria-busy','true');updateSpinState();
 if(!motion||motion.systemReduced){finish();return;}
 stop=motion.onFrame(time=>{
  began??=time;
  const progress=Math.min(1,(time-began)/4800);
  const angle=from+(rotation-from)*(1-(1-progress)**4);
  wheel.style.transform=`rotate(${angle}deg)`;
  if(progress===1)finish();
 });
});
window.addEventListener('lemrix:motion-change',e=>{if(!e.detail.enabled)finishSpin?.();});
document.addEventListener('visibilitychange',()=>{if(document.hidden)finishSpin?.();else revealPendingReward();});
window.addEventListener('lemrix:dialog',()=>setTimeout(revealPendingReward,0));
function openRewards(){if($('#reward-dialog').open)closeDialog($('#reward-dialog'));const ids=[...new Set(rewards.map(r=>r.id))];$('#rewards-list').innerHTML=ids.length?ids.map(id=>{const p=prizes.find(p=>p.id===id);return `<button class="reward-list-item" data-reward="${p.id}"><span class="reward-list-icon" style="color:${p.colour}" aria-hidden="true">${rewardIcon(p.icon)}</span><span><b>${p.label}</b><small>${p.type}</small></span><span aria-hidden="true">${arrowIcon}</span></button>`;}).join(''):`<div class="reward-empty"><span aria-hidden="true">${rewardIcon(prizes[0].icon)}</span><p>No rewards yet.</p><button class="text-link" id="go-to-wheel">Go to Lucky Dip</button></div>`;openDialog('#rewards-dialog');}
$('#open-rewards').addEventListener('click',openRewards);document.addEventListener('click',e=>{if(e.target.closest('.view-all-rewards'))openRewards();const r=e.target.closest('[data-reward]');if(r){closeDialog($('#rewards-dialog'));showReward(prizes.find(p=>p.id===r.dataset.reward));}if(e.target.closest('#go-to-wheel')){closeDialog($('#rewards-dialog'));window.LemrixMotion?.scrollTo('#lucky-find');}});

window.addEventListener('storage',e=>{if(e.key==='lemrix.last-spin.v1'){lastSpin=Number(read('lemrix.last-spin.v1',0))||0;updateSpinState();}});
setInterval(updateSpinState,60000);updateSpinState();
