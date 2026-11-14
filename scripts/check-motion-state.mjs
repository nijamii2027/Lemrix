import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../dist/motion-state.js', import.meta.url), 'utf8');
function open({ reduced = false, touch = false, legacyMedia = false, search = "", saved = new Map() } = {}) {
  const classes = new Set();
  const root = { dataset: {}, classList: { toggle(name, on) {
    if (on) classes.add(name); else classes.delete(name);
  } } };
  const document = Object.assign(new EventTarget(), { documentElement: root, hidden: false });
  const window = new EventTarget();
  const system = Object.assign(new EventTarget(), { matches: reduced });
  if (legacyMedia) {
    system.addListener = callback => EventTarget.prototype.addEventListener.call(system, 'change', callback);
    system.addEventListener = undefined;
  }
  const timers = new Map();
  let nextTimer = 0;
  let now = 0;
  vm.runInNewContext(source, {
    document, window, Event, CustomEvent, URLSearchParams,
    location: { search },
    localStorage: {
      getItem: key => saved.get(key),
      setItem: (key, value) => saved.set(key, value),
      removeItem: key => saved.delete(key)
    },
    matchMedia: query => query.includes('reduced-motion') ? system : { matches: touch },
    performance: { now: () => now },
    setInterval: callback => {
      timers.set(++nextTimer, callback);
      return nextTimer;
    },
    clearInterval: id => timers.delete(id)
  });
  return {
    root, classes, document, window, state: window.LemrixMotionState,
    advance(milliseconds) {
      now += milliseconds;
      for (const callback of timers.values()) callback();
    }
  };
}

for (const reduced of [false, true]) {
  const app = open({ reduced });
  assert.equal(app.state.enabled, true, 'a fresh load starts without an interaction or storage');
  assert.equal(app.root.dataset.motion, 'running');
  assert.equal(app.root.dataset.systemMotion, 'full', 'the normal URL autoplays regardless of device settings');
  assert.equal(app.state.toggle, undefined);
  app.document.dispatchEvent(new Event('DOMContentLoaded'));
  app.window.dispatchEvent(new Event('pageshow'));
  assert.equal(app.state.enabled, true);
}

const saved = new Map();
const fullLink = open({ reduced: true, search: '?motion=full', saved });
assert.equal(fullLink.state.systemReduced, false, 'the opt-in restores full motion before page effects start');
assert.equal(fullLink.root.dataset.systemMotion, 'full');
assert.equal(open({ reduced: true, saved }).state.systemReduced, false, 'the choice follows visitors across pages');
assert.equal(open({ reduced: true, search: '?motion=system', saved }).state.systemReduced, true);
assert.equal(open({ reduced: true, saved }).state.systemReduced, true, 'the reset restores the device preference');

const phone = open({ touch: true, legacyMedia: true, reduced: true, search: '?motion=system' });
assert.equal(phone.root.dataset.motionDriver, 'touch');
const frames = [];
phone.state.onTouchFrame(time => frames.push(time));
phone.advance(42);
phone.advance(42);
assert.deepEqual(frames, [42, 84], 'the touch clock advances without RAF or a click');
phone.document.hidden = true;
phone.document.dispatchEvent(new Event('visibilitychange'));
assert.equal(phone.classes.has('page-hidden'), true);
phone.advance(1000);
assert.deepEqual(frames, [42, 84], 'hidden tabs stop the touch clock');
phone.document.hidden = false;
phone.document.dispatchEvent(new Event('visibilitychange'));
assert.equal(phone.classes.has('page-hidden'), false);
phone.advance(42);
assert.deepEqual(frames, [42, 84, 84, 126], 'returning to the page resumes without jumping through hidden time');
phone.window.dispatchEvent(new Event('pagehide'));
phone.advance(1000);
assert.equal(frames.length, 4);
phone.window.dispatchEvent(new Event('pageshow'));
phone.advance(42);
assert.deepEqual(frames, [42, 84, 84, 126, 126, 168]);
console.log('Motion startup, legacy media queries, touch timer, visibility and page restore pass.');

const desktop = open();
const desktopFrames=[];
const unsubscribe=desktop.state.onFrame(time=>desktopFrames.push(time));
desktop.advance(34);
desktop.advance(34);
assert.deepEqual(desktopFrames,[34,68], 'desktop playback starts without RAF or an interaction');
unsubscribe();
desktop.advance(34);
assert.equal(desktopFrames.length,2,'unused clocks are released');

const runtime=readFileSync(new URL('../dist/animation-runtime.js', import.meta.url),'utf8');
let heartbeat,frame=12,ticks=0;
const driverRoot={dataset:{}};
const animation={playState:'running',currentTime:0,playbackRate:1};
const runtimeWindow=Object.assign(new EventTarget(),{
 LemrixMotionState:{onFrame:callback=>{heartbeat=callback;}},
 gsap:{ticker:{get frame(){return frame;},tick(){frame++;ticks++;}}}
});
vm.runInNewContext(runtime,{window:runtimeWindow,document:{documentElement:driverRoot,getAnimations:()=>[animation]}});
heartbeat(34);heartbeat(68);heartbeat(102);heartbeat(136);heartbeat(170);
assert.equal(ticks,3,'stalled RAF is replaced with GSAP ticks after the grace period');
assert.equal(driverRoot.dataset.animationClock,'timer');
assert.ok(animation.currentTime>0,'stalled native UI animations also advance');
frame++;
heartbeat(204);
assert.equal(ticks,3,'normal browser frames must not be double-ticked');
assert.equal(driverRoot.dataset.animationClock,'browser');
console.log('Desktop stalled-frame recovery and native UI playback pass.');
