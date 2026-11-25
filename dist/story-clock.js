// Each scroll stop has a resting shot. The clock traverses every intervening transition.
window.LemrixStoryClock = function (fallLength, pullLength, revealLength) {
  const gripStart = fallLength + .24;
  const about = gripStart + pullLength;
  const tapeStart = about + .54;
  const end = tapeStart + revealLength;
  const stops = [0, fallLength, about, end];
  let time = 0, destination = 0, requestedCover = 0, cover = 0, nightRest = 0;
  const toward = (value, target, distance) => value < target
    ? Math.min(target, value + distance) : Math.max(target, value - distance);

  return {
    get fall() { return Math.min(fallLength, time); },
    get pull() { return Math.min(pullLength, Math.max(0, time - gripStart)); },
    get reveal() { return Math.min(revealLength, Math.max(0, time - tapeStart)); },
    get cover() { return cover; },
    setGoal(index, footerFraction, immediate = false) {
      destination = stops[index];
      requestedCover = index === 3 ? Math.max(0, Math.min(1, footerFraction)) : 0;
      if (immediate) {
        time = destination;
        cover = requestedCover;
        nightRest = time === end ? .40 : 0;
      }
    },
    tick(deltaSeconds) {
      // Limit each painted step, including after a lost frame or scrollbar fling.
      const dt = Math.min(Math.max(0, deltaSeconds), .085);
      const targetCover = time === end && nightRest >= .40 ? requestedCover : 0;
      cover = toward(cover, targetCover, dt * 2.65);
      if (cover > 0 && time === end && destination < end) return;
      const skippingAhead = destination >= about && time < fallLength ||
        destination === end && time < about || requestedCover > 0;
      const rate = destination < time ? 1.85 : skippingAhead ? 2.04 : 1;
      time = toward(time, destination, dt * rate);
      nightRest = time === end ? nightRest + dt : 0;
    }
  };
};
