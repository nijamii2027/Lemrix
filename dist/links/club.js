const reduced = matchMedia('(prefers-reduced-motion: reduce)');

function setUpMascotRun(stage) {
  const track = stage.querySelector('.mascot-path');
  const facing = stage.querySelector('.mascot-facing');
  const compact = matchMedia('(400px < width <= 600px)');
  const atlas = new Image();
  atlas.alt = '';
  atlas.className = 'mascot-frames';
  let ready = false;
  let animations = [];
  let period = 1;

  function play() {
    const elapsed = Number(animations[0]?.currentTime ?? 0);
    const phase = (elapsed % period) / period;
    for (const animation of animations) animation.cancel();
    animations = [];
    stage.classList.remove('is-running');
    if (reduced.matches || !ready) return;

    // Each stride advances the same distance in body lengths on a phone or desktop.
    const strides = compact.matches ? 1 : 2;
    const strideFrames = 20;
    const ramp = 0.16;
    const rampDistance = ramp / (2 * (1 - ramp));
    const runTime = 650 * strides / (1 - ramp);
    const turnTime = 740;
    const range = (first, last) => Array.from({length: last - first + 1}, (_, i) => first + i);
    const rear = range(20, 35);
    const lift = range(40, 45);
    const shake = range(46, 63);
    const wiggle = [...rear, ...lift, ...shake, ...shake, 46, ...lift.slice().reverse(), ...rear.slice().reverse()];
    const wiggleTime = 28 * (wiggle.length + 1);
    period = 2 * (runTime + turnTime) + wiggleTime;
    const positions = [];
    const drawings = [];
    const directions = [];
    let clock = 0;

    // Invert the distance curve so a planted foot slows down with the body.
    function timeAtDistance(distance) {
      if (distance < rampDistance) return ramp * Math.sqrt(distance / rampDistance);
      if (distance > 1 - rampDistance) return 1 - ramp * Math.sqrt((1 - distance) / rampDistance);
      return ramp / 2 + (1 - ramp) * distance;
    }

    function drawAt(frame, time) {
      const x = -(frame % 8) * 100 / 8;
      const y = -Math.floor(frame / 8) * 100 / 8;
      drawings.push({offset: time / period, transform: `translate(${x}%, ${y}%)`, easing: 'steps(1, end)'});
    }

    function run(from, to, duration, count) {
      for (const [time, distance, easing] of [
        [0, 0, 'cubic-bezier(.333333,0,.666667,.333333)'],
        [ramp, rampDistance, 'linear'],
        [1 - ramp, 1 - rampDistance, 'cubic-bezier(.333333,.666667,.666667,1)'],
        [1, 1, 'linear']
      ]) {
        const x = from + (to - from) * distance;
        positions.push({offset: (clock + time * duration) / period, transform: `translateX(${x}%)`, easing});
      }
      for (let step = 0; step <= count; step++) {
        drawAt(step % strideFrames, clock + duration * timeAtDistance(step / count));
      }
      clock += duration;
    }

    function act(frames, duration) {
      frames.forEach((frame, index) => drawAt(frame, clock + (index + 1) * duration / (frames.length + 1)));
      clock += duration;
    }

    // The mirrored drawings of 39 and 31 meet at the same silhouette.
    const turn = [...range(20, 39), ...range(20, 31).reverse()];
    function turnAround(facingAfter) {
      const switchTime = clock + 21 * turnTime / (turn.length + 1);
      directions.push({offset: switchTime / period, transform: `scaleX(${facingAfter})`, easing: 'steps(1, end)'});
      act(turn, turnTime);
    }

    const fullStride = strideFrames * strides;
    // Whole strides on both sides of the stop put both feet down before the turn.
    const midpointStep = Math.max(strideFrames, fullStride / 2);
    run(0, 50, runTime / 2, midpointStep);
    // Both adjacent position keys are at 50%, so the feet stay planted for the gag.
    act(wiggle, wiggleTime);
    run(50, 100, runTime / 2, midpointStep);
    turnAround(-1);
    run(100, 0, runTime, fullStride);
    turnAround(1);
    drawAt(0, period);
    positions.push({offset: 1, transform: 'translateX(0%)'});
    directions.unshift({offset: 0, transform: 'scaleX(1)', easing: 'steps(1, end)'});
    directions.push({offset: 1, transform: 'scaleX(1)'});

    const timing = {duration: period, iterations: Infinity};
    stage.classList.add('is-running');
    animations = [track.animate(positions, timing), facing.animate(directions, timing), atlas.animate(drawings, timing)];
    const now = document.timeline.currentTime;
    for (const animation of animations) {
      if (now !== null) animation.startTime = now - phase * period;
    }
  }

  function configure() {
    if (!reduced.matches && !atlas.hasAttribute('src')) {
      atlas.onload = () => {
        ready = true;
        facing.append(atlas);
        play();
      };
      atlas.src = 'art/lemrix-trot-wiggle.webp';
    }
    play();
  }
  compact.addEventListener('change', play);
  reduced.addEventListener('change', configure);
  configure();
}
const mascot = document.querySelector('.mascot-loop');
if (mascot && typeof mascot.animate === 'function') setUpMascotRun(mascot);
