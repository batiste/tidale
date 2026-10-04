"use strict";

// Aeropolis sound effects, synthesised with the Web Audio API (no audio files). Used by aeropolis-play.js via SFX.play(name, arg).
// The audio context starts on the first click (browsers block sound before a user gesture). Mute is remembered per browser.

const SFX = (() => {
  let ctx = null;
  let masterGain = null;
  let muted = false;
  let masterVolume = 0.7;
  let musicVolume = 0.25;
  let musicEnabled = true;
  const music = new Audio("music.mp3");
  music.loop = true;
  music.preload = "none";
  try {
    muted = localStorage.getItem("tf-muted") === "1";
    masterVolume = Number(localStorage.getItem("tf-master-volume") ?? masterVolume);
    musicVolume = Number(localStorage.getItem("tf-music-volume") ?? musicVolume);
    musicEnabled = localStorage.getItem("tf-music-enabled") !== "0";
  } catch (e) {}
  masterVolume = Math.max(0, Math.min(1, masterVolume));
  musicVolume = Math.max(0, Math.min(1, musicVolume));

  const audio = () => {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = masterVolume;
      masterGain.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  };

  const updateMusicVolume = () => (music.volume = musicEnabled ? musicVolume * masterVolume : 0);
  updateMusicVolume();

  // A tone with an attack/decay envelope; `to` glides the pitch.
  function tone({ freq, to = freq, type = "sine", start = 0, dur = 0.15, vol = 0.2 }) {
    const a = audio();
    const t = a.currentTime + start;
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(to, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(masterGain);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // Brass-like note: sawtooth through a lowpass that opens on the attack, with a slight vibrato.
  function brass({ freq, start = 0, dur = 0.2, vol = 0.12 }) {
    const a = audio();
    const t = a.currentTime + start;
    const osc = a.createOscillator();
    const vib = a.createOscillator();
    const vibGain = a.createGain();
    const f = a.createBiquadFilter();
    const gain = a.createGain();
    osc.type = "sawtooth";
    osc.frequency.value = freq;
    vib.frequency.value = 6;
    vibGain.gain.value = freq * 0.01;
    vib.connect(vibGain).connect(osc.frequency);
    f.type = "lowpass";
    f.frequency.setValueAtTime(freq * 1.5, t);
    f.frequency.linearRampToValueAtTime(freq * 5, t + 0.05);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.03);
    gain.gain.setValueAtTime(vol, t + dur - 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(f).connect(gain).connect(masterGain);
    [osc, vib].forEach((o) => {
      o.start(t);
      o.stop(t + dur + 0.02);
    });
  }

  // Filtered white noise: swishes, snaps, hisses, drum skins.
  function noise({ start = 0, dur = 0.15, vol = 0.2, filter = "bandpass", freq = 1500, to = freq, q = 1 }) {
    const a = audio();
    const t = a.currentTime + start;
    const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource();
    const f = a.createBiquadFilter();
    const gain = a.createGain();
    src.buffer = buf;
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(gain).connect(masterGain);
    src.start(t);
  }

  const SOUNDS = {
    // Recruit / tuck a card: paper swish.
    tuck: () => noise({ dur: 0.18, vol: 0.25, freq: 800, to: 3000, q: 0.8 }),
    // Scheme: a softer, lower swish.
    scheme: () => noise({ dur: 0.3, vol: 0.18, freq: 500, to: 1200, q: 0.7 }),
    // Street run draw: card snap; pitch rises with heat (ratio = heat / limit).
    draw: (ratio = 0) => {
      noise({ dur: 0.06, vol: 0.3, filter: "highpass", freq: 2500 });
      tone({ freq: 300 + 700 * ratio, to: 350 + 900 * ratio, type: "triangle", dur: 0.12, vol: 0.12 });
    },
    // Caught: two-tone siren blip.
    caught: () => [0, 0.18, 0.36].forEach((s, i) => tone({ freq: i % 2 ? 330 : 470, type: "square", start: s, dur: 0.16, vol: 0.07 })),
    // Stim: quick hiss.
    stim: () => noise({ dur: 0.25, vol: 0.2, filter: "highpass", freq: 4000, to: 7000 }),
    // Uprising result: drum hit, then a rising chord.
    uprising: () => {
      tone({ freq: 140, to: 45, dur: 0.35, vol: 0.5 });
      noise({ dur: 0.12, vol: 0.2, filter: "lowpass", freq: 900 });
      [523, 659, 784].forEach((f, i) => tone({ freq: f, type: "triangle", start: 0.25 + i * 0.08, dur: 0.5, vol: 0.12 }));
    },
    // Rise on the Spire: two ascending notes; Citizen higher than Outcast.
    rise: (k) => {
      const [a, b] = k === "cit" ? [660, 880] : [440, 587];
      tone({ freq: a, type: "sine", dur: 0.12, vol: 0.15 });
      tone({ freq: b, type: "sine", start: 0.1, dur: 0.18, vol: 0.15 });
    },
    // New player's turn: a small bell (two partials, long decay).
    turn: () => {
      tone({ freq: 1320, type: "sine", dur: 0.6, vol: 0.12 });
      tone({ freq: 1980, type: "sine", dur: 0.4, vol: 0.05 });
    },
    // Game start: a little trumpet call (da-da-da-daaa).
    start: () =>
      [
        [392, 0, 0.14],
        [392, 0.16, 0.14],
        [523, 0.32, 0.14],
        [659, 0.48, 0.55],
      ].forEach(([freq, start, dur]) => brass({ freq, start, dur })),
    // Characters meet / game over: short fanfare.
    fanfare: () => [392, 523, 659, 784].forEach((f, i) => tone({ freq: f, type: "triangle", start: i * 0.12, dur: i === 3 ? 0.6 : 0.16, vol: 0.15 })),
  };

  return {
    play(name, arg) {
      if (muted || !SOUNDS[name]) return;
      try {
        SOUNDS[name](arg);
      } catch (e) {} // sound must never break the game
    },
    get muted() {
      return muted;
    },
    get musicEnabled() {
      return musicEnabled;
    },
    get musicVolume() {
      return musicVolume;
    },
    get masterVolume() {
      return masterVolume;
    },
    startMusic() {
      if (!musicEnabled || musicVolume === 0 || masterVolume === 0) return;
      updateMusicVolume();
      music.play().catch(() => {});
    },
    setMusicEnabled(enabled) {
      musicEnabled = Boolean(enabled);
      try {
        localStorage.setItem("tf-music-enabled", musicEnabled ? "1" : "0");
      } catch (e) {}
      updateMusicVolume();
      if (musicEnabled) this.startMusic();
      else music.pause();
      return musicEnabled;
    },
    setMusicVolume(value) {
      musicVolume = Math.max(0, Math.min(1, Number(value) || 0));
      try {
        localStorage.setItem("tf-music-volume", String(musicVolume));
      } catch (e) {}
      updateMusicVolume();
      if (musicEnabled) this.startMusic();
      return musicVolume;
    },
    setMasterVolume(value) {
      masterVolume = Math.max(0, Math.min(1, Number(value) || 0));
      if (masterGain) masterGain.gain.setTargetAtTime(masterVolume, ctx.currentTime, 0.02);
      try {
        localStorage.setItem("tf-master-volume", String(masterVolume));
      } catch (e) {}
      updateMusicVolume();
      if (musicEnabled) this.startMusic();
      return masterVolume;
    },
    toggle() {
      muted = !muted;
      try {
        localStorage.setItem("tf-muted", muted ? "1" : "0");
      } catch (e) {}
      if (!muted) SOUNDS.tuck();
      return muted;
    },
  };
})();
