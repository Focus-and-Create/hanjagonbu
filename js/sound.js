const Sound = (() => {
  let ctx = null;

  function ac() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, start, dur, vol = 0.25, type = 'sine') {
    const c = ac();
    const osc = c.createOscillator();
    const env = c.createGain();
    osc.connect(env);
    env.connect(c.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(vol, start + 0.01);
    env.gain.exponentialRampToValueAtTime(0.001, start + dur);
    osc.start(start);
    osc.stop(start + dur);
  }

  function correct() {
    const now = ac().currentTime;
    tone(659, now,        0.13, 0.22); // E5
    tone(784, now + 0.11, 0.20, 0.22); // G5
  }

  function wrong() {
    const now = ac().currentTime;
    tone(200, now, 0.18, 0.18, 'sawtooth');
  }

  function mastered() {
    const now = ac().currentTime;
    tone(523, now,        0.10, 0.20); // C5
    tone(659, now + 0.09, 0.10, 0.20); // E5
    tone(784, now + 0.18, 0.22, 0.25); // G5
  }

  return { correct, wrong, mastered };
})();
