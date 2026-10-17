"use strict";

// Banners sound effects, synthesised with the Web Audio API (no audio files). play.js calls SFX.fromLog(lines) with the
// new log lines of each update. The audio context starts on the first click (browsers block sound before a gesture).
// Mute is remembered per browser.

const SFX = (() => {
  let ctx = null;
  let muted = false;
  try { muted = localStorage.getItem("bn-muted") === "1"; } catch (e) {}

  const audio = () => {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  };
  document.addEventListener("pointerdown", audio, { once: true });

  // A tone with an attack/decay envelope; `to` glides the pitch.
  function tone({ freq, to = freq, type = "sine", start = 0, dur = 0.15, vol = 0.15 }) {
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
    osc.connect(gain).connect(a.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // Filtered noise burst: cloth (banner flutter) or a thud.
  function noise({ start = 0, dur = 0.25, vol = 0.12, from = 800, to = 2400, q = 1.2 }) {
    const a = audio();
    const t = a.currentTime + start;
    const buf = a.createBuffer(1, Math.ceil(a.sampleRate * dur), a.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource();
    const filter = a.createBiquadFilter();
    const gain = a.createGain();
    src.buffer = buf;
    filter.type = "bandpass";
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(to, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(gain).connect(a.destination);
    src.start(t);
  }

  const SOUNDS = {
    move: () => tone({ freq: 520, to: 640, type: "triangle", dur: 0.08, vol: 0.08 }),
    place: () => { tone({ freq: 880, type: "sine", dur: 0.09, vol: 0.1 }); tone({ freq: 1320, start: 0.05, dur: 0.08, vol: 0.06 }); },
    flip: () => { noise({ dur: 0.18, from: 600, to: 2600 }); noise({ start: 0.12, dur: 0.18, from: 900, to: 3200, vol: 0.09 }); },
    hit: () => { tone({ freq: 180, to: 70, type: "square", dur: 0.18, vol: 0.09 }); noise({ dur: 0.12, from: 300, to: 120, vol: 0.1 }); },
    tandem: () => [660, 990].forEach((f, i) => tone({ freq: f, start: i * 0.07, dur: 0.16, vol: 0.08 })),
    out: () => [784, 523].forEach((f, i) => tone({ freq: f, start: i * 0.14, type: "triangle", dur: 0.4, vol: 0.12 })),
    win: () => [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, start: i * 0.13, type: "triangle", dur: i === 3 ? 0.7 : 0.2, vol: 0.14 })),
  };

  // Log line → sound. The most telling line of a batch wins (a turn often logs several lines).
  const RULES = [
    ["win", (m) => / wins with /.test(m)],
    ["out", (m) => / is out/.test(m)],
    ["flip", (m) => /→ .*(Crown|Church|Guilds|Commune|Underworld)$/.test(m)],
    ["hit", (m) => / −\d influence| becomes /.test(m)],
    ["tandem", (m) => /^ {2}(Coup|Last Rites|Smuggling|Blackmail):/.test(m)],
    ["place", (m) => /^ {2}(Sermon|Recruit|Place)/.test(m)],
    ["move", (m) => /^Turn /.test(m)],
  ];

  return {
    get muted() { return muted; },
    toggle() {
      muted = !muted;
      try { localStorage.setItem("bn-muted", muted ? "1" : "0"); } catch (e) {}
      return muted;
    },
    fromLog(lines) {
      if (muted || !lines.length || !ctx) return;
      const hit = RULES.find(([, test]) => lines.some(test));
      if (hit) SOUNDS[hit[0]]();
    },
  };
})();
