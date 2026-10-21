/**
 * All sounds are synthesised with the Web Audio API, so the game ships without
 * a single audio file.
 *
 * The context is created lazily on the first user gesture, otherwise browsers
 * keep it suspended and the game would start out silent.
 */

export function createAudio(storage) {
  let context = null;
  let master = null;
  let muted = readMuted();

  function readMuted() {
    try {
      return storage.getItem('paperwings.muted.v1') === '1';
    } catch {
      return false;
    }
  }

  function ensureContext() {
    if (context) {
      if (context.state === 'suspended') context.resume().catch(() => {});
      return context;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    try {
      context = new Ctor();
      master = context.createGain();
      master.gain.value = muted ? 0 : 0.9;
      master.connect(context.destination);
    } catch {
      context = null;
    }
    return context;
  }

  function tone({ frequency, endFrequency, type = 'sine', duration = 0.15, gain = 0.2, delay = 0 }) {
    const ctx = ensureContext();
    if (!ctx || muted) return;
    const start = ctx.currentTime + delay;
    const oscillator = ctx.createOscillator();
    const envelope = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (endFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
    }
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(gain, start + Math.min(0.02, duration * 0.3));
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope);
    envelope.connect(master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  function noise({ duration = 0.14, gain = 0.12, delay = 0, frequency = 900, q = 1 }) {
    const ctx = ensureContext();
    if (!ctx || muted) return;
    const start = ctx.currentTime + delay;
    const frames = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(gain, start);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(master);
    source.start(start);
  }

  return {
    get muted() {
      return muted;
    },
    setMuted(value) {
      muted = Boolean(value);
      try {
        storage.setItem('paperwings.muted.v1', muted ? '1' : '0');
      } catch {
        /* storage not available, the setting just will not persist */
      }
      if (master) master.gain.value = muted ? 0 : 0.9;
      if (!muted) ensureContext();
    },
    /**
     * Creates the audio context. This can take a moment, so it is done once
     * after the first frame instead of while the player is tapping.
     */
    prepare() {
      if (muted) return;
      ensureContext();
    },
    /** Called from the input handler: lets the browser start the sound. */
    unlock() {
      if (muted) return;
      const ctx = ensureContext();
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    },
    resume() {
      if (context && context.state === 'suspended') context.resume().catch(() => {});
    },
    flap() {
      tone({ frequency: 520, endFrequency: 220, type: 'triangle', duration: 0.13, gain: 0.16 });
      noise({ duration: 0.09, gain: 0.05, frequency: 1500, q: 0.8 });
    },
    score() {
      tone({ frequency: 740, type: 'triangle', duration: 0.1, gain: 0.13 });
      tone({ frequency: 1108, type: 'triangle', duration: 0.16, gain: 0.12, delay: 0.08 });
    },
    hit() {
      tone({ frequency: 220, endFrequency: 70, type: 'sawtooth', duration: 0.26, gain: 0.16 });
      noise({ duration: 0.22, gain: 0.14, frequency: 480, q: 0.6 });
    },
    gameOver() {
      tone({ frequency: 520, type: 'sine', duration: 0.16, gain: 0.13 });
      tone({ frequency: 392, type: 'sine', duration: 0.16, gain: 0.13, delay: 0.14 });
      tone({ frequency: 262, type: 'sine', duration: 0.34, gain: 0.14, delay: 0.28 });
    },
  };
}
