"use strict";
// Aeropolis core prototype (rules: plan-1.txt, cards: cards.json).
// One async game loop; every decision goes through choose(): the human answers
// through the UI, bots answer at once with botChoose().

const ROUNDS = 6;
const TURNS = 3;
const LINE = 2;
const RESERVE = 12;
const COLORS = ["#e06c5a", "#5aa0e0", "#e0c25a", "#7cc46f"];
const ALL_LOCS = [
  { id: "governor", name: "Governor", vp: 3, reward: "draw a Secret" },
  { id: "military", name: "Military", vp: 3, reward: "+1 arm" },
  { id: "guild", name: "Guild", vp: 3, reward: "+2 gold" },
  { id: "underground", name: "Underground", vp: 3, reward: "Outcast line holds 3 cards" },
  { id: "printer", name: "Printer", vp: 1, reward: "draw 2 Secrets, discard 1" },
  { id: "workers", name: "Workers", vp: 1, reward: "place 1 agent" },
];
const LOC = Object.fromEntries(ALL_LOCS.map((l) => [l.id, l]));
let LOCS = ALL_LOCS; // the locations in play this game (see CONFIG.locations)

// Rule switches, so the simulator can compare variants (newGame(n, { config })).
const CONFIG = {
  locations: ALL_LOCS.map((l) => l.id),
  handLimit: 3, // max Secrets in hand
  upkeep: true, // end of round: each controller sends 1 Low agent there back to reserve
  emptyMove: true, // empty reserve: a placement moves one of your agents instead
  arming: "one", // end-of-round arming: "one" | "escalate" | "tax" (see armingPhase)
};
const ABORT = Symbol("abort");

let DATA = null; // cards.json
let PERS_LOC = {}; // personality -> location
let G = null; // game state

// ---------- helpers ----------

const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const sum = (a) => a.reduce((t, x) => t + x, 0);
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const sleep = (ms) =>
  new Promise((ok) => setTimeout(ok, ms)).then(() => {
    if (G.token !== currentToken) throw ABORT;
  });
let currentToken = 0;

function log(text, cls) {
  if (G.sim) return;
  G.log.unshift({ text, cls });
}

function fx(e) {
  if (e.pay) return `pay ${costText(e.pay)} → ${fx(e.get)}`;
  if (e.choice) return e.choice.map(fx).join(" or ");
  if (e.ifNoArms) return `${fx({ ...e, ifNoArms: false })} if you have none`;
  const at = e.at ? ` (${LOC[e.at].name})` : "";
  if (e.gold) return `+${e.gold} gold`;
  if (e.arms) return `+${plural(e.arms, "arm")}`;
  if (e.secret) return `draw ${plural(e.secret, "Secret")}`;
  if (e.high) return `${plural(e.high, "agent")} → High${at}`;
  if (e.low) return `${plural(e.low, "agent")} → Low${at}`;
  if (e.move) return `move ${plural(e.move, "agent")}`;
  return "?";
}
const fxList = (list) => (list.length ? list.map(fx).join(", ") : "—");

function costText(c) {
  const parts = [];
  if (c.gold) parts.push(`${c.gold} gold`);
  if (c.arms) parts.push(plural(c.arms, "arm"));
  if (c.secret) parts.push(plural(c.secret, "Secret"));
  return parts.length ? parts.join(" + ") : "free";
}
const slotText = (s) => (s ? `Arms slot: ${LOC[s.at].name}${s.convert ? ` → ${fx(s.convert)}` : ""}` : "");
function vpText(v) {
  if (!v) return "";
  return v.per === "seat" ? `${v.n} VP per seat of power you control` : `${v.n} VP if you control ${LOC[v.control].name}`;
}

// ---------- sound (synthesized, Web Audio) ----------

const SFX = {
  on: true,
  ctx: null,
  // Each sound: [frequency Hz, start s, duration s, waveform, volume].
  sounds: {
    play: [[520, 0, 0.07, "triangle", 0.12], [780, 0.05, 0.09, "triangle", 0.1]],
    turn: [[660, 0, 0.12, "sine", 0.16], [880, 0.12, 0.12, "sine", 0.16], [1320, 0.24, 0.22, "sine", 0.12]],
    round: [[392, 0, 0.35, "triangle", 0.14], [494, 0.12, 0.35, "triangle", 0.12], [587, 0.24, 0.5, "triangle", 0.12]],
  },
  play(name) {
    if (!this.on || typeof window === "undefined" || G.sim) return;
    try {
      this.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === "suspended") this.ctx.resume();
      const t0 = this.ctx.currentTime;
      for (const [f, start, dur, type, vol] of this.sounds[name]) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.value = f;
        gain.gain.setValueAtTime(0.0001, t0 + start);
        gain.gain.exponentialRampToValueAtTime(vol, t0 + start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
        osc.connect(gain).connect(this.ctx.destination);
        osc.start(t0 + start);
        osc.stop(t0 + start + dur + 0.02);
      }
    } catch {
      // No audio available: stay silent.
    }
  },
};

// ---------- icons (inline SVG) ----------

const HIGH_C = "#c9a55a";
const LOW_C = "#3f8f86";
const cubeSvg = (c) =>
  `<svg viewBox="0 0 16 16"><path d="M8 1.5 14 4.8v6.4L8 14.5 2 11.2V4.8Z" fill="${c}" stroke="rgba(0,0,0,.45)" stroke-width=".8"/><path d="M8 1.5 14 4.8 8 8 2 4.8Z" fill="#fff" opacity=".35"/><path d="M8 8v6.5" stroke="rgba(0,0,0,.3)"/></svg>`;
const SVG = {
  gold: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="#e9c477" stroke="#8a6a22" stroke-width="1.2"/><circle cx="8" cy="8" r="3.6" fill="none" stroke="#a9852f"/></svg>',
  arms: '<svg viewBox="0 0 16 16"><path d="M12.6 1.4 14.6 3.4 6.6 11.4 4.6 9.4Z" fill="#d7dde2" stroke="#6b757c" stroke-width=".8"/><path d="M3.2 8.4 7.6 12.8" stroke="#b0812f" stroke-width="1.8" stroke-linecap="round"/><path d="M4.8 11.2 2 14" stroke="#7a5326" stroke-width="2" stroke-linecap="round"/></svg>',
  secret: '<svg viewBox="0 0 16 16"><rect x="1.5" y="3.5" width="13" height="9" rx="1" fill="#efe7d8" stroke="#7d6b55"/><path d="M1.8 4 8 9l6.2-5" fill="none" stroke="#7d6b55"/><circle cx="8" cy="9.3" r="2.1" fill="#b23a48"/></svg>',
  move: '<svg viewBox="0 0 16 16"><path d="M2 8h10M9 4.5 12.5 8 9 11.5" fill="none" stroke="#9aa7ae" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  vp: '<svg viewBox="0 0 16 16"><path d="M8 1.2l2 4.3 4.7.5-3.5 3.2 1 4.6L8 11.5l-4.2 2.3 1-4.6L1.3 6l4.7-.5Z" fill="#e9c477" stroke="#8a6a22" stroke-width=".6"/></svg>',
  high: cubeSvg(HIGH_C),
  low: cubeSvg(LOW_C),
  agent: cubeSvg("#8d979e"),
};
const TITLES = { gold: "gold", arms: "arms", secret: "Secret", move: "move", vp: "VP", high: "High agent", low: "Low agent", agent: "agent" };
const ic = (name) => `<span class="ic" title="${TITLES[name]}">${SVG[name]}</span>`;
const cubeIc = (color) => `<span class="ic">${cubeSvg(color)}</span>`;

function fxHtml(e) {
  if (e.pay) return `${costHtml(e.pay)} → ${fxHtml(e.get)}`;
  if (e.choice) return e.choice.map(fxHtml).join(" or ");
  if (e.ifNoArms) return `${fxHtml({ ...e, ifNoArms: false })} if 0`;
  const at = e.at ? ` ${LOC[e.at].name}` : "";
  for (const k of ["gold", "arms", "secret"]) if (e[k]) return `+${e[k]}${ic(k)}`;
  for (const k of ["high", "low"]) if (e[k]) return `${e[k]}${ic(k)}${at}`;
  if (e.move) return `${ic("move")}${e.move}${ic("agent")}`;
  return "?";
}
const fxListHtml = (list) => (list.length ? list.map(fxHtml).join(" ") : "—");
function costHtml(c) {
  const parts = [["gold", c.gold], ["arms", c.arms], ["secret", c.secret]].filter(([, n]) => n).map(([k, n]) => `${n}${ic(k)}`);
  return parts.length ? parts.join(" ") : "free";
}
const slotHtml = (sl) => `${ic("arms")} slot: ${LOC[sl.at].name}${sl.convert ? ` → ${fxHtml(sl.convert)}` : ""}`;
const vpHtml = (v) => (v.per === "seat" ? `${v.n}${ic("vp")} per seat of power` : `${v.n}${ic("vp")} if you control ${LOC[v.control].name}`);
const REWARD_HTML = {
  governor: fxHtml({ secret: 1 }),
  military: fxHtml({ arms: 1 }),
  guild: fxHtml({ gold: 2 }),
  printer: `+2${ic("secret")}, discard 1`,
  workers: `+1${ic("high")}/${ic("low")}`,
};

// ---------- setup ----------

function expand(list, side) {
  return list.flatMap((d) => Array.from({ length: d.copies }, () => ({ ...d, side })));
}

// Effects naming a location not in play become "any location"; such slots disappear.
function fitLocs(def) {
  const ok = (at) => !at || LOCS.some((l) => l.id === at);
  const fix = (list) => list.map((e) => (ok(e.at) ? e : { ...e, at: undefined }));
  const d = { ...def };
  for (const k of ["effects", "reveal", "prepared"]) if (d[k]) d[k] = fix(d[k]);
  if (d.slot && !ok(d.slot.at)) d.slot = null;
  if (d.personality && !ok(PERS_LOC[d.personality])) d.personality = null;
  return d;
}

function newGame(n, { allBots = false, delay = 500, config = {} } = {}) {
  const cfg = { ...CONFIG, ...config };
  LOCS = ALL_LOCS.filter((l) => cfg.locations.includes(l.id));
  currentToken++;
  if (G && G.pending) G.pending.reject(ABORT);
  if (typeof document !== "undefined" && $("round-modal").open) $("round-modal").close();
  const cits = shuffle(DATA.characters.filter((c) => c.side === "citizen").map(fitLocs));
  const outs = shuffle(DATA.characters.filter((c) => c.side === "outcast").map(fitLocs));
  G = {
    token: currentToken,
    cfg,
    delay,
    n,
    players: Array.from({ length: n }, (_, i) => ({
      id: i,
      name: allBots ? `Bot ${i + 1}` : i === 0 ? "You" : `Bot ${i}`,
      bot: allBots || i !== 0,
      color: COLORS[i],
      gold: 2,
      arms: 1,
      reserve: RESERVE,
      secrets: [],
      cit: { char: cits[i], line: [] },
      out: { char: outs[i], line: [] },
      vp: null,
    })),
    board: Object.fromEntries(LOCS.map((l) => [l.id, { high: Array(n).fill(0), low: Array(n).fill(0) }])),
    decks: {
      citizen: shuffle(expand(DATA.citizen, "citizen").map(fitLocs)),
      outcast: shuffle(expand(DATA.outcast, "outcast").map(fitLocs)),
      secrets: shuffle(DATA.secrets.map(fitLocs)),
    },
    discards: { citizen: [], outcast: [], secrets: [] },
    market: { citizen: [], outcast: [] },
    basics: DATA.basic.map((d) => ({ ...d, basic: true })),
    stats: Array.from({ length: n }, () => ({})),
    first0: Math.floor(Math.random() * n),
    round: 0,
    turn: 0,
    current: null,
    ugHolder: null,
    revolution: 0,
    uid: 0,
    log: [],
    pending: null,
    over: false,
  };
  for (const side of ["citizen", "outcast"]) G.market[side] = [drawCard(side), drawCard(side)];
  log(`New game, ${n} players. ${G.players[G.first0].name} starts.`, "round");
  render();
  return run(G.token);
}

function drawCard(side) {
  const deck = G.decks[side];
  if (!deck.length) deck.push(...shuffle(G.discards[side].splice(0)));
  return deck.pop() || null;
}

async function drawSecrets(p, k, { limit = true } = {}) {
  const got = [];
  for (let i = 0; i < k; i++) {
    const deck = G.decks.secrets;
    if (!deck.length) deck.push(...shuffle(G.discards.secrets.splice(0)));
    const s = deck.pop();
    if (s) {
      p.secrets.push(s);
      got.push(s);
    }
  }
  log(`${p.name} draws ${plural(got.length, "Secret")}.`);
  if (limit) await handLimit(p);
  return got;
}

async function handLimit(p) {
  while (p.secrets.length > G.cfg.handLimit) {
    const s = await choose(p, "discard-secret", `Hand limit ${G.cfg.handLimit}: discard a Secret`, secretOptions(p, "Discard"));
    discardSecret(p, s);
    stat(p, "secret:limit-discard");
    log(`${p.name} discards a Secret (hand limit).`);
  }
}

function discardSecret(p, s) {
  p.secrets.splice(p.secrets.indexOf(s), 1);
  G.discards.secrets.push(s);
}

function discardCard(def) {
  if (!def.basic) G.discards[def.side].push(def);
}

// ---------- queries ----------

const order = () => {
  const f = (G.first0 + Math.max(G.round, 1) - 1) % G.n;
  return Array.from({ length: G.n }, (_, k) => G.players[(f + k) % G.n]);
};
const lines = (p) => [...p.cit.line, ...p.out.line];
const lineLimit = (p, side) => (side === "out" && G.ugHolder === p.id ? LINE + 1 : LINE);
const armsAt = (p, loc) => sum(lines(p).filter((c) => c.def.slot && c.def.slot.at === loc).map((c) => c.arms));
// Cell: a Citizen and an Outcast card in the same column whose arms slots name the
// same location. Each cell adds 1 strength there while both cards stay.
function cellsOf(p) {
  const cells = [];
  p.cit.line.forEach((c, i) => {
    const o = p.out.line[i];
    if (o && c.def.slot && o.def.slot && c.def.slot.at === o.def.slot.at) cells.push({ cit: c, out: o, at: c.def.slot.at });
  });
  return cells;
}
const cellsAt = (p, loc) => cellsOf(p).filter((c) => c.at === loc).length;
const strength = (p, loc) => G.board[loc].low[p.id] + armsAt(p, loc) + cellsAt(p, loc);
const onBoard = (p) => sum(LOCS.map((l) => G.board[l.id].high[p.id] + G.board[l.id].low[p.id]));

// Control: highest Low strength among players with 1+ High agent there. Tie: nobody.
function control(loc) {
  let best = 0;
  let who = null;
  for (const p of G.players) {
    if (!G.board[loc].high[p.id]) continue;
    const s = strength(p, loc);
    if (s > best) [best, who] = [s, p.id];
    else if (s === best) who = null;
  }
  return who;
}

const canAfford = (p, c) => p.gold >= (c.gold || 0) && p.arms >= (c.arms || 0) && p.secrets.length >= (c.secret || 0);

function stat(p, key, n = 1) {
  const st = G.stats[p.id];
  st[key] = (st[key] || 0) + n;
}

// ---------- choices ----------

// options: [{ label, value, key? }] — key ties the option to a clickable element.
function choose(p, kind, text, options, ctx = {}) {
  if (!options.length) return Promise.resolve(null);
  if (p.bot) return Promise.resolve(botChoose(p, kind, options, ctx));
  return new Promise((resolve, reject) => {
    G.pending = {
      kind,
      text,
      options,
      resolve: (v) => {
        G.pending = null;
        resolve(v);
      },
      reject,
    };
    render();
  });
}

const locOptions = (half, except) =>
  LOCS.filter((l) => l.id !== except).map((l) => ({ label: l.name, value: l.id, key: `loc:${l.id}:${half}` }));

async function chooseLoc(p, half, text, except) {
  return choose(p, `loc-${half}`, text, locOptions(half, except), { half });
}

// ---------- effects ----------

async function placeAgent(p, half, at) {
  if (p.reserve <= 0) {
    stat(p, "reserve-empty");
    if (!G.cfg.emptyMove) return log(`${p.name} has no agent left in reserve.`);
    log(`${p.name} has no agent left in reserve: moves one instead.`);
    return moveAgent(p, half, at);
  }
  const loc = at || (await chooseLoc(p, half, `Place 1 agent in ${cap(half)}: choose a location`));
  G.board[loc][half][p.id]++;
  p.reserve--;
  stat(p, `agent:${half}`);
  log(`${p.name} places 1 agent in ${LOC[loc].name} ${cap(half)}.`);
}

function myAgentOptions(p, half, kind) {
  const opts = [];
  for (const l of LOCS)
    for (const h of half ? [half] : ["high", "low"])
      if (G.board[l.id][h][p.id]) opts.push({ label: `${l.name} ${cap(h)}`, value: { loc: l.id, half: h }, key: `loc:${l.id}:${h}`, kind });
  return opts;
}

// Move: an agent changes location, staying in its half.
async function moveAgent(p, half, to) {
  const opts = myAgentOptions(p, half);
  if (!opts.length) return log(`${p.name} has no agent to move.`);
  opts.push({ label: "Don't move", value: null });
  const src = await choose(p, "move-src", "Move: choose one of your agents", opts);
  if (!src) return;
  const dst = to && to !== src.loc ? to : await choose(p, "move-dst", `Move to which location (${cap(src.half)})?`, locOptions(src.half, src.loc), src);
  if (!dst) return;
  G.board[src.loc][src.half][p.id]--;
  G.board[dst][src.half][p.id]++;
  log(`${p.name} moves an agent from ${LOC[src.loc].name} to ${LOC[dst].name} (${cap(src.half)}).`);
}

async function applyEffect(p, e) {
  if (e.pay) {
    if (!canAfford(p, e.pay)) return;
    const yes = await choose(p, "pay", `Pay ${costText(e.pay)} → ${fx(e.get)}?`, [
      { label: `Pay ${costText(e.pay)}`, value: true },
      { label: "No", value: false },
    ], e);
    if (!yes) return;
    p.gold -= e.pay.gold || 0;
    p.arms -= e.pay.arms || 0;
    stat(p, "spent:gold", e.pay.gold || 0);
    stat(p, "pay");
    log(`${p.name} pays ${costText(e.pay)}.`);
    return applyEffect(p, e.get);
  }
  if (e.choice) {
    const pick = await choose(p, "effect-choice", "Choose one effect", e.choice.map((x) => ({ label: fx(x), value: x })));
    return applyEffect(p, pick);
  }
  if (e.ifNoArms && p.arms) return;
  if (e.gold) p.gold += e.gold;
  if (e.arms) p.arms += e.arms;
  if (e.gold) stat(p, "gold+", e.gold);
  if (e.arms) stat(p, "arms+", e.arms);
  if (e.gold || e.arms) log(`${p.name}: ${fx(e)}.`);
  if (e.secret) await drawSecrets(p, e.secret);
  for (const half of ["high", "low"]) for (let i = 0; i < (e[half] || 0); i++) await placeAgent(p, half, e.at);
  for (let i = 0; i < (e.move || 0); i++) await moveAgent(p);
}

async function activate(p, side) {
  const s = p[side];
  log(`${p.name} activates the ${side === "cit" ? "Citizen" : "Outcast"} line.`);
  for (const e of s.char.effects) await applyEffect(p, e);
  for (const c of [...s.line]) for (const e of c.def.effects) await applyEffect(p, e);
}

async function armCard(p, inst) {
  p.arms--;
  const conv = inst.def.slot.convert;
  stat(p, conv ? "arm:convert" : "arm:slot");
  if (conv) {
    log(`${p.name} arms ${inst.def.name}: converted.`);
    await applyEffect(p, conv);
  } else {
    inst.arms++;
    log(`${p.name} arms ${inst.def.name} (${LOC[inst.def.slot.at].name}).`);
  }
}

function trimLine(p, side) {
  const line = p[side].line;
  while (line.length > lineLimit(p, side)) {
    const old = line.shift();
    discardCard(old.def);
    stat(p, "pushed");
    log(`${p.name} discards ${old.def.name} from the line${old.arms ? " (and its arms)" : ""}.`);
  }
}

async function addToLine(p, def) {
  const side = def.side === "outcast" ? "out" : "cit";
  const inst = { def, arms: 0, uid: ++G.uid };
  p[side].line.push(inst);
  SFX.play("play");
  log(`${p.name} adds ${def.name} to the ${side === "cit" ? "Citizen" : "Outcast"} line.`);
  trimLine(p, side);
  if (def.slot && p.arms > 0) {
    const yes = await choose(p, "arm-on-add", `Arm ${def.name}? (${slotText(def.slot)})`, [
      { label: "Arm it (−1 arm)", value: true },
      { label: "No", value: false },
    ], inst);
    if (yes) await armCard(p, inst);
  }
  for (const c of cellsOf(p)) if (c.cit === inst || c.out === inst) {
    log(`${p.name} forms a cell at ${LOC[c.at].name} (${c.cit.def.name} + ${c.out.def.name}).`);
    stat(p, "cell-formed");
  }
  await activate(p, side);
}

function takeFromMarket(side, i) {
  if (side === "basic") return G.basics[i];
  const def = G.market[side][i];
  G.market[side][i] = drawCard(side);
  return def;
}

async function buy(p, side, i) {
  const def = side === "basic" ? G.basics[i] : G.market[side][i];
  const c = def.cost;
  p.gold -= c.gold || 0;
  p.arms -= c.arms || 0;
  for (let k = 0; k < (c.secret || 0); k++) {
    const s = await choose(p, "discard-secret", `Pay ${def.name}: discard a Secret`, secretOptions(p, "Discard"));
    discardSecret(p, s);
  }
  log(`${p.name} buys ${def.name} (${costText(c)}).`);
  stat(p, `buy:${def.name}`);
  stat(p, "spent:gold", c.gold || 0);
  stat(p, "spent:arms", c.arms || 0);
  stat(p, "spent:secret", c.secret || 0);
  takeFromMarket(side, i);
  await addToLine(p, def);
}

const secretOptions = (p, label, list = p.secrets) =>
  list.map((s) => ({ label: `${label} ${s.title}`, value: s, key: `secret:${s.id}`, btn: label }));

// ---------- secrets ----------

async function exploit(p, s) {
  log(`${p.name} exploits ${s.title}: ${fxList(s.reveal)}.`);
  discardSecret(p, s);
  for (const e of s.reveal) await applyEffect(p, e);
}

async function contract(p, s) {
  const opts = marketOptions(() => true);
  const pick = await choose(p, "contract", `Blackmail (${s.title}): take a market card for free`, opts);
  discardSecret(p, s);
  const def = takeFromMarket(pick.side, pick.i);
  log(`${p.name} blackmails the ${cap(s.personality)} with ${s.title}: wins a contract for ${def.name}.`);
  await addToLine(p, def);
}

function removeOptions(p, loc) {
  const opts = [];
  for (const q of G.players)
    if (q !== p)
      for (const h of ["high", "low"])
        if (G.board[loc][h][q.id]) opts.push({ label: `${q.name}'s ${cap(h)} agent`, value: { pid: q.id, half: h } });
  return opts;
}

async function removeAgent(p, s) {
  const loc = PERS_LOC[s.personality];
  const pick = await choose(p, "remove", `Blackmail (${s.title}): remove an agent from ${LOC[loc].name}`, removeOptions(p, loc), { loc });
  discardSecret(p, s);
  G.board[loc][pick.half][pick.pid]--;
  G.players[pick.pid].reserve++;
  log(`${p.name} blackmails the ${cap(s.personality)} with ${s.title}: ${G.players[pick.pid].name} loses a ${cap(pick.half)} agent at ${LOC[loc].name}.`);
}

// ---------- turns ----------

function marketOptions(ok) {
  const opts = [];
  for (const side of ["citizen", "outcast"])
    G.market[side].forEach((def, i) => {
      if (def && ok(def)) opts.push({ label: `Buy ${def.name}`, value: { type: "buy", side, i }, key: `market:${side}:${i}`, side, i });
    });
  G.basics.forEach((def, i) => {
    if (ok(def)) opts.push({ label: `Buy ${def.name}`, value: { type: "buy", side: "basic", i }, key: `market:basic:${i}`, side: "basic", i });
  });
  return opts;
}

function turnOptions(p) {
  const opts = [{ label: "Investigate (draw 1 Secret)", value: { type: "investigate" } }];
  opts.push(...marketOptions((d) => canAfford(p, d.cost)));
  for (const s of p.secrets) {
    opts.push({ label: "Exploit", value: { type: "exploit", sid: s.id }, key: `secret:${s.id}`, btn: "Exploit", tip: "Reveal: apply the Reveal effect, then discard" });
    if (s.personality) {
      opts.push({ label: "Contract", value: { type: "contract", sid: s.id }, key: `secret:${s.id}`, btn: "Blackmail: contract", tip: "Blackmail: take a market card for free" });
      if (removeOptions(p, PERS_LOC[s.personality]).length)
        opts.push({ label: "Remove", value: { type: "remove", sid: s.id }, key: `secret:${s.id}`, btn: "Blackmail: remove agent", tip: "Blackmail: remove an opponent agent at this location" });
    }
  }
  return opts;
}

const SECRET_USES = ["exploit", "contract", "remove"];

async function useSecret(p, a) {
  const s = p.secrets.find((x) => x.id === a.sid);
  if (!s) return;
  stat(p, `secret:${a.type}`);
  if (a.type === "exploit") await exploit(p, s);
  if (a.type === "contract") await contract(p, s);
  if (a.type === "remove") await removeAgent(p, s);
}

async function doAction(p, a) {
  if (a.type === "investigate") {
    log(`${p.name} investigates.`);
    stat(p, "investigate");
    await drawSecrets(p, 1);
  } else if (a.type === "buy") await buy(p, a.side, a.i);
}

async function takeTurn(p) {
  if (p.bot) {
    await sleep(G.delay);
    for (const a of await botPlan(p)) await perform(p, a);
    return;
  }
  SFX.play("turn");
  // Secrets are free: use any number, then take the action.
  for (;;) {
    const a = await choose(p, "turn", "Your turn: choose an action (or use a Secret)", turnOptions(p));
    if (SECRET_USES.includes(a.type)) await useSecret(p, a);
    else return doAction(p, a);
  }
}

// ---------- end of round ----------

// End-of-round arming, in turn order (CONFIG.arming):
//   "one":      each player may put 1 arm on one card.
//   "escalate": laps around the table; each turn, put any number of arms on one card;
//               fewer than 2 and you are out. Ends when everybody is out.
//   "tax":      laps around the table; each turn, put any number of arms on one card
//               and discard 1 more arm; passing means you are out.
const armable = (p) => lines(p).filter((c) => c.def.slot);

async function armingPhase() {
  const mode = G.cfg.arming;
  const can = (p) => p.arms > (mode === "tax" ? 1 : 0) && armable(p).length;
  let active = order().filter(can);
  while (active.length) {
    const next = [];
    for (const p of active) {
      const n = await armTurn(p, mode);
      if (mode !== "one" && n >= (mode === "escalate" ? 2 : 1) && can(p)) next.push(p);
      else if (mode !== "one") log(`${p.name} is out of the arming.`);
    }
    if (mode === "one") break;
    active = next;
  }
}

async function armTurn(p, mode) {
  const max = mode === "one" ? 1 : mode === "tax" ? p.arms - 1 : p.arms;
  const rule = mode === "escalate" ? " (fewer than 2: you are out)" : mode === "tax" ? " (+1 arm discarded)" : "";
  const opts = armable(p).map((c) => ({ label: `${c.def.name} (${slotText(c.def.slot)})`, value: c, key: `card:${c.uid}` }));
  opts.push({ label: "Pass", value: null });
  const inst = await choose(p, "arm-end", `End of round: arm one card${rule}`, opts);
  if (!inst) return 0;
  let n = 1;
  if (!inst.def.slot.convert && max > 1)
    n = await choose(p, "arm-count", `How many arms on ${inst.def.name}?${rule}`, Array.from({ length: max }, (_, k) => ({ label: String(k + 1), value: k + 1 })), { inst, mode });
  if (mode === "tax") {
    p.arms--;
    stat(p, "arm:tax");
  }
  for (let k = 0; k < n; k++) await armCard(p, inst);
  stat(p, "arm:end", n);
  return n;
}

async function reward(p, loc) {
  log(`${p.name} controls ${LOC[loc].name}: ${LOC[loc].reward}.`);
  stat(p, `reward:${loc}`);
  if (loc === "military") stat(p, "arms+", 1);
  if (loc === "guild") stat(p, "gold+", 2);
  if (loc === "governor") await drawSecrets(p, 1);
  if (loc === "military") p.arms += 1;
  if (loc === "guild") p.gold += 2;
  if (loc === "printer") {
    const got = await drawSecrets(p, 2, { limit: false });
    if (got.length === 2) {
      const s = await choose(p, "printer", "Printer: discard 1 of the 2 Secrets drawn", secretOptions(p, "Discard", got));
      discardSecret(p, s);
    }
    await handLimit(p);
  }
  if (loc === "workers") {
    const opts = ["high", "low"].flatMap((h) =>
      LOCS.map((l) => ({ label: `${l.name} ${cap(h)}`, value: { loc: l.id, half: h }, key: `loc:${l.id}:${h}` }))
    );
    if (p.reserve > 0) {
      const a = await choose(p, "workers", "Workers: place 1 agent (High or Low)", opts);
      await placeAgent(p, a.half, a.loc);
    }
  }
}

async function endOfRound() {
  SFX.play("round");
  log("End of round: arming.");
  await armingPhase();
  // Let the armed slots be seen before control resolves and discards them.
  render();
  await sleep(G.delay * 3);
  if (G.round === ROUNDS) return revolution();
  const ctrl = Object.fromEntries(LOCS.map((l) => [l.id, control(l.id)]));
  const rows = LOCS.map((l) => controlRow(l.id, ctrl[l.id]));
  log(`Control after round ${G.round}: ${rows.map(rowText).join("; ")}.`, "round");
  const before = G.players.map(snapshot);
  for (const l of LOCS) if (ctrl[l.id] !== null) await reward(G.players[ctrl[l.id]], l.id);
  G.ugHolder = ctrl.underground;
  await showRoundSummary(rows, before);
  if (G.cfg.upkeep)
    for (const l of LOCS) {
      const q = ctrl[l.id] !== null && G.players[ctrl[l.id]];
      if (q && G.board[l.id].low[q.id]) {
        G.board[l.id].low[q.id]--;
        q.reserve++;
        stat(q, "upkeep");
      }
    }
  for (const p of G.players) log(`Status ${p.name}: ${statusText(p)}.`, "round");
  for (const p of G.players) trimLine(p, "out");
  for (const p of G.players) for (const c of lines(p)) c.arms = 0;
  G.revolution++;
}

// ---------- round summary ----------

function controlRow(loc, who) {
  const b = G.board[loc];
  const contenders = G.players.filter((p) => b.high[p.id] || b.low[p.id] || strength(p, loc));
  const withHigh = G.players.filter((p) => b.high[p.id]);
  const why =
    who !== null ? ""
    : !withHigh.length ? "nobody has a High agent"
    : !withHigh.some((p) => strength(p, loc)) ? "no Low strength (needs Low agents or arms)"
    : "tie";
  return {
    loc,
    who,
    why,
    cells: contenders.map((p) => ({ p, high: b.high[p.id], low: b.low[p.id], arms: armsAt(p, loc), cell: cellsAt(p, loc), str: strength(p, loc) })),
  };
}

function statusText(p) {
  const line = (side) => p[side].line.map((c) => c.def.name).join(", ") || "—";
  return `${p.gold} gold, ${p.arms} arms, ${p.secrets.length} Secrets, ${p.reserve} in reserve; Citizen line [${line("cit")}], Outcast line [${line("out")}]`;
}

function rowText(r) {
  const who = r.who !== null ? G.players[r.who].name : `nobody (${r.why})`;
  const str = r.cells.map((c) => `${c.p.name} ${c.high}H/${c.low}L${c.arms ? `+${c.arms}a` : ""}${c.cell ? `+${c.cell}c` : ""}`).join(", ");
  return `${LOC[r.loc].name} → ${who}${str ? ` [${str}]` : ""}`;
}

const snapshot = (p) => ({ gold: p.gold, arms: p.arms, secrets: p.secrets.length, reserve: p.reserve });

function gainsHtml(before, p) {
  const d = (k) => snapshot(p)[k] - before[k];
  const parts = [];
  if (d("gold")) parts.push(`+${d("gold")}${ic("gold")}`);
  if (d("arms")) parts.push(`+${d("arms")}${ic("arms")}`);
  if (d("secrets")) parts.push(`${d("secrets") > 0 ? "+" : ""}${d("secrets")}${ic("secret")}`);
  if (d("reserve") < 0) parts.push(`+${-d("reserve")}${ic("agent")} placed`);
  if (G.ugHolder === p.id) parts.push(`Outcast line holds ${LINE + 1}`);
  return parts.join(" ") || "—";
}

function showRoundSummary(rows, before) {
  if (typeof document === "undefined" || G.players.every((p) => p.bot)) return Promise.resolve();
  const name = (p) => `<b style="color:${p.color}">${p.name}</b>`;
  const cell = (c) =>
    `<div>${name(c.p)}: ${c.high}${ic("high")} ${c.low}${ic("low")}${c.arms ? ` +${c.arms}${ic("arms")}` : ""}${c.cell ? ` +${c.cell} cell` : ""}${
      c.high ? ` → <b>${c.str}</b>` : ' <span class="muted">(no High)</span>'
    }</div>`;
  const locRows = rows
    .map((r) => {
      const l = LOC[r.loc];
      return `<tr class="${r.who !== null ? "won" : ""}">
        <td><b>${l.name}</b></td>
        <td>${r.cells.map(cell).join("") || '<span class="muted">empty</span>'}</td>
        <td>${r.who !== null ? name(G.players[r.who]) : `<span class="muted">— ${r.why}</span>`}</td>
        <td>${r.who !== null ? REWARD_HTML[l.id] || l.reward : ""}</td>
      </tr>`;
    })
    .join("");
  const playerRows = G.players.map((p, i) => `<tr><td>${name(p)}</td><td>${gainsHtml(before[i], p)}</td></tr>`).join("");
  const dlg = $("round-modal");
  dlg.innerHTML = `<h2>End of round ${G.round}</h2>
    <p class="muted">Control: highest Low strength (Low agents + arms + cells) among players with a High agent. Then arms on cards are discarded and each controller sends 1 Low agent there back to reserve (upkeep).</p>
    <table class="summary"><tr><th>Location</th><th>Presence → strength</th><th>Control</th><th>Reward</th></tr>${locRows}</table>
    <h3>Rewards received</h3>
    <table class="summary">${playerRows}</table>
    <form method="dialog"><button class="btn">Continue to round ${G.round + 1}</button></form>`;
  const token = G.token;
  return new Promise((ok) => {
    dlg.onclose = () => ok();
    dlg.showModal();
  }).then(() => {
    if (G.token !== token) throw ABORT;
  });
}

async function revolution() {
  G.revolution = ROUNDS;
  log("THE REVOLUTION", "round");
  for (const p of order())
    for (const s of [...p.secrets]) {
      log(`${p.name} reveals ${s.title} (Prepared: ${fxList(s.prepared)}).`);
      for (const e of s.prepared) await applyEffect(p, e);
    }
  const ctrl = Object.fromEntries(LOCS.map((l) => [l.id, control(l.id)]));
  log(`Revolution control: ${LOCS.map((l) => rowText(controlRow(l.id, ctrl[l.id]))).join("; ")}.`, "round");
  for (const p of G.players) {
    const locs = LOCS.filter((l) => ctrl[l.id] === p.id);
    const seats = locs.filter((l) => l.vp === 3).length;
    const locVp = sum(locs.map((l) => l.vp));
    const secVp = sum(
      p.secrets.filter((s) => s.vp).map((s) => (s.vp.per === "seat" ? s.vp.n * seats : ctrl[s.vp.control] === p.id ? s.vp.n : 0))
    );
    p.vp = { locs: locs.map((l) => l.name), locVp, secVp, total: locVp + secVp };
  }
  G.ranking = [...G.players].sort((a, b) => b.vp.total - a.vp.total || b.gold - a.gold || b.arms - a.arms);
  for (const p of G.ranking)
    log(`Score ${p.name}: ${p.vp.total} VP (locations ${p.vp.locs.join(", ") || "none"} = ${p.vp.locVp}, Secrets ${p.vp.secVp}); gold ${p.gold}, arms ${p.arms}, ${plural(onBoard(p), "agent")} on board.`, "round");
  G.over = true;
  log(`${G.ranking[0].name} ${G.ranking[0].bot ? "wins" : "win"} with ${G.ranking[0].vp.total} VP.`, "round");
}

async function run(token) {
  try {
    for (G.round = 1; G.round <= ROUNDS; G.round++) {
      log(`Round ${G.round} (Revolution ${G.revolution}/${ROUNDS}).`, "round");
      for (G.turn = 1; G.turn <= TURNS; G.turn++)
        for (const p of order()) {
          G.current = p.id;
          render();
          await takeTurn(p);
        }
      G.current = null;
      await endOfRound();
      render();
    }
  } catch (e) {
    if (e !== ABORT) {
      console.error(e);
      if (G.token === token) log(`Error: ${e.message}`);
    }
  }
  if (G.token === token) render();
}

// ---------- bots ----------
// Each turn a bot tries every legal plan (main action, optionally preceded by one
// Secret use) on a copy of the game and keeps the plan whose position evaluates
// best. Choices inside a plan (where to place, what to arm…) are also made by
// evaluating the position after each option.

// Value of holding a location's reward for one more round.
const REWARD_VALUE = { governor: 1.2, military: 1, guild: 0.9, underground: 0.6, printer: 1.2, workers: 0.8 };

const turnsLeft = () => Math.max(0, (ROUNDS - G.round) * TURNS + (TURNS - G.turn));

// Chance-like estimate that p controls loc at the next control check.
function controlChance(p, loc) {
  const b = G.board[loc];
  const mine = strength(p, loc);
  // Rivals without a High agent can still add one: count them at a discount.
  const best = Math.max(0, ...G.players.filter((q) => q !== p).map((q) => strength(q, loc) * (b.high[q.id] ? 1 : 0.6)));
  if (!b.high[p.id]) return mine > best ? 0.25 : mine ? 0.1 : 0;
  if (!mine) return best ? 0.05 : 0.15;
  const margin = mine - best;
  if (margin > 0) return Math.min(1, 0.6 + 0.15 * margin);
  if (margin === 0) return 0.3;
  return Math.max(0.03, 0.25 + 0.08 * margin);
}

function effWorth(e) {
  if (e.pay) return Math.max(0, effWorth(e.get) - 0.45 * (e.pay.gold || 0));
  if (e.choice) return Math.max(...e.choice.map(effWorth));
  if (e.ifNoArms) return 0.25;
  return (e.gold || 0) * 0.45 + (e.arms || 0) * 0.5 + (e.secret || 0) * 0.9 + ((e.high || 0) + (e.low || 0)) * 0.7 + (e.move || 0) * 0.3;
}
const defWorth = (def) => sum(def.effects.map(effWorth));

// A Prepared agent lands at the Revolution, when nobody can answer it: worth more
// where it is pivotal (a first High agent, a Low agent at a seat of power).
function preparedAgentWorth(p, e) {
  const one = (loc) =>
    (e.high ? (G.board[loc].high[p.id] ? 0.2 : LOC[loc].vp * 0.45) * e.high : 0) + (e.low ? LOC[loc].vp * 0.4 * e.low : 0);
  return e.at ? one(e.at) : Math.max(...LOCS.map((l) => one(l.id)));
}

// Expected worth of drawing an unknown Secret (net of the hand-limit discard).
function drawWorth(p) {
  const pool = [...G.decks.secrets, ...G.discards.secrets];
  const avg = pool.length ? sum(pool.map((s) => secretWorth(p, s))) / pool.length : 0;
  if (p.secrets.length < G.cfg.handLimit) return avg;
  return Math.max(0, avg - Math.min(...p.secrets.map((s) => secretWorth(p, s))));
}

function secretWorth(p, s) {
  let prepared = sum(s.prepared.map((e) => (e.high || e.low ? preparedAgentWorth(p, e) : (e.move || 0) * 0.3)));
  if (s.vp)
    prepared +=
      s.vp.per === "seat"
        ? s.vp.n * sum(LOCS.filter((l) => l.vp === 3).map((l) => controlChance(p, l.id)))
        : s.vp.n * controlChance(p, s.vp.control) + 0.3;
  return Math.max(sum(s.reveal.map(effWorth)) * 0.9, prepared) + (s.personality ? 0.3 : 0);
}

const lineWorth = (p, side) => sum(p[side].char.effects.map(effWorth)) + sum(p[side].line.map((c) => defWorth(c.def)));

function evaluate(p) {
  const left = ROUNDS - G.round;
  let score = 0;
  for (const l of LOCS) score += (l.vp + REWARD_VALUE[l.id] * (left + 1) * 0.5) * controlChance(p, l.id);
  // Resources only matter if they can still be spent: unusable surplus is worth little.
  const ownTurns = turnsLeft() / G.n;
  const usable = (n, cap) => Math.min(n, cap) + Math.max(0, n - cap) * 0.2;
  score += usable(p.gold, Math.ceil(ownTurns) * 2) * 0.45 * Math.min(1, ownTurns / 2);
  score += usable(p.arms, left + 1 + Math.ceil(ownTurns / 2)) * 0.5;
  score += Math.min(p.reserve, 4) * 0.05;
  score += sum(p.secrets.map((s) => secretWorth(p, s)));
  // A line fires again on about half of the remaining own turns.
  score += ((turnsLeft() / G.n) * 0.5 * (lineWorth(p, "cit") + lineWorth(p, "out"))) * 0.5;
  return score;
}

// Evaluate p after a temporary change; undo restores the state.
function tryEval(p, apply, undo) {
  apply();
  const v = evaluate(p);
  undo();
  return v;
}

async function perform(p, a) {
  if (SECRET_USES.includes(a.type)) return useSecret(p, a);
  if (a.type === "buy") {
    const def = a.side === "basic" ? G.basics[a.i] : G.market[a.side][a.i];
    if (!def || !canAfford(p, def.cost)) return;
  }
  return doAction(p, a);
}

function snapshotFor(p) {
  return {
    ctrl: Object.fromEntries(LOCS.map((l) => [l.id, control(l.id)])),
    str: Object.fromEntries(LOCS.map((l) => [l.id, strength(p, l.id)])),
    high: Object.fromEntries(LOCS.map((l) => [l.id, G.board[l.id].high[p.id]])),
    gold: p.gold,
    arms: p.arms,
    secrets: p.secrets.length,
  };
}

// Play a plan on a copy of the game; never touches the real state.
async function simulate(p, plan) {
  const real = G;
  const copy = structuredClone(real);
  copy.sim = true;
  copy.log = [];
  copy.delay = 0;
  // No peeking at hidden decks.
  for (const k of ["citizen", "outcast", "secrets"]) shuffle(copy.decks[k]);
  G = copy;
  try {
    const me = G.players[p.id];
    for (const a of plan) await perform(me, a);
    return { score: evaluate(me), after: snapshotFor(me) };
  } finally {
    if (G === copy) G = real;
  }
}

function planText(p, plan) {
  return plan
    .map((a) => {
      if (a.type === "investigate") return "Investigate";
      if (a.type === "buy") return `buy ${(a.side === "basic" ? G.basics[a.i] : G.market[a.side][a.i]).name}`;
      const s = p.secrets.find((x) => x.id === a.sid);
      return a.type === "exploit" ? `exploit ${s.title}` : `blackmail the ${cap(s.personality)} (${a.type})`;
    })
    .join(" + ");
}

function whyText(p, before, after) {
  const parts = [];
  for (const l of LOCS) {
    const id = l.id;
    if (after.ctrl[id] === p.id && before.ctrl[id] !== p.id) parts.push(`takes ${l.name}`);
    else if (before.ctrl[id] !== null && before.ctrl[id] !== p.id && after.ctrl[id] !== before.ctrl[id])
      parts.push(`breaks ${G.players[before.ctrl[id]].name} at ${l.name}`);
    else if (after.high[id] > before.high[id]) parts.push(`High at ${l.name}`);
    else if (after.str[id] > before.str[id]) parts.push(`${l.name} strength ${before.str[id]}→${after.str[id]}`);
  }
  for (const k of ["gold", "arms", "secrets"]) {
    const d = after[k] - before[k];
    if (d) parts.push(`${d > 0 ? "+" : ""}${d} ${k}`);
  }
  return parts.join(", ") || "builds the line";
}

async function botPlan(p) {
  const mains = [{ type: "investigate" }, ...marketOptions((d) => canAfford(p, d.cost)).map((o) => o.value)];
  const uses = turnOptions(p)
    .map((o) => o.value)
    .filter((a) => SECRET_USES.includes(a.type));
  const plans = [...mains.map((m) => [m]), ...uses.flatMap((u) => mains.map((m) => [u, m]))];
  const base = evaluate(p);
  const before = snapshotFor(p);
  stat(p, "turns");
  stat(p, "plans", plans.length);
  const results = [];
  for (const plan of plans) {
    const runs = plan.some((a) => a.type === "investigate") ? 3 : 1;
    const sims = [];
    for (let k = 0; k < runs; k++) sims.push(await simulate(p, plan));
    results.push({ plan, score: sum(sims.map((x) => x.score)) / runs, after: sims[0].after });
  }
  results.sort((a, b) => b.score - a.score);
  const best = results[0];
  const alts = results
    .filter((r) => r.plan.length === 1 && r !== best)
    .slice(0, 2)
    .map((r) => `${planText(p, r.plan)} ${(r.score - base).toFixed(1)}`)
    .join(", ");
  log(`${p.name} → ${planText(p, best.plan)} (${(best.score - base >= 0 ? "+" : "") + (best.score - base).toFixed(1)}): ${whyText(p, before, best.after)}. Rejected: ${alts}.`, "bot");
  return best.plan;
}

function botChoose(p, kind, options, ctx) {
  const best = (score) => {
    let top = options[0];
    let topScore = -Infinity;
    for (const o of options) {
      const v = score(o);
      if (v > topScore) [top, topScore] = [o, v];
    }
    return top.value;
  };
  const b = G.board;
  switch (kind) {
    case "loc-high":
    case "loc-low":
      return best((o) => tryEval(p, () => b[o.value][ctx.half][p.id]++, () => b[o.value][ctx.half][p.id]--));
    case "workers":
      return best((o) => tryEval(p, () => b[o.value.loc][o.value.half][p.id]++, () => b[o.value.loc][o.value.half][p.id]--));
    case "move-src":
      // Agent whose departure costs least, plus the best place to send it.
      return best((o) => {
        if (!o.value) return evaluate(p);
        const { loc, half } = o.value;
        b[loc][half][p.id]--;
        const v = Math.max(...LOCS.filter((l) => l.id !== loc).map((l) => tryEval(p, () => b[l.id][half][p.id]++, () => b[l.id][half][p.id]--)));
        b[loc][half][p.id]++;
        return v;
      });
    case "move-dst":
      return best((o) => {
        b[ctx.loc][ctx.half][p.id]--;
        const v = tryEval(p, () => b[o.value][ctx.half][p.id]++, () => b[o.value][ctx.half][p.id]--);
        b[ctx.loc][ctx.half][p.id]++;
        return v;
      });
    case "pay":
      // Pay when the gain beats the gold, keeping 1 gold for later when poor.
      return effWorth(ctx.get) > 0.45 * (ctx.pay.gold || 0) && p.gold > (G.round < ROUNDS ? 0 : -1);
    case "effect-choice":
      return best((o) => (o.value.secret ? drawWorth(p) * o.value.secret : effWorth(o.value)));
    case "arm-on-add":
    case "arm-end": {
      const armValue = (inst) =>
        inst.def.slot.convert
          ? evaluate(p) - 0.5 + effWorth(inst.def.slot.convert)
          : tryEval(p, () => (inst.arms++, p.arms--), () => (inst.arms--, p.arms++));
      if (kind === "arm-on-add") return armValue(ctx) > evaluate(p) + 0.05;
      return best((o) => (o.value ? armValue(o.value) : evaluate(p) + 0.05));
    }
    case "arm-count":
      return best((o) => {
        const tax = ctx.mode === "tax" ? 1 : 0;
        return tryEval(p, () => ((ctx.inst.arms += o.value), (p.arms -= o.value + tax)), () => ((ctx.inst.arms -= o.value), (p.arms += o.value + tax)));
      });
    case "discard-secret":
    case "printer":
      return best((o) => -secretWorth(p, o.value));
    case "remove":
      return best((o) => {
        const q = G.players[o.value.pid];
        const row = b[ctx.loc][o.value.half];
        return tryEval(p, () => row[q.id]--, () => row[q.id]++);
      });
    case "contract":
      return best((o) => defWorth(o.side === "basic" ? G.basics[o.i] : G.market[o.side][o.i]) + 0.3 * sum(Object.values(o.side === "basic" ? {} : G.market[o.side][o.i].cost)));
    default:
      return options[Math.floor(Math.random() * options.length)].value;
  }
}

// ---------- rendering ----------

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function targets() {
  const map = {};
  if (G.pending) for (const o of G.pending.options) if (o.key) (map[o.key] ||= []).push(o);
  return map;
}

function cubes(loc, half) {
  return G.players.map((p) => cubeIc(p.color).repeat(G.board[loc][half][p.id])).join("");
}

const fxBlock = (list) => (list.length ? list.map((e) => `<div>${fxHtml(e)}</div>`).join("") : "<div>—</div>");
const sec = (cls, label, body) => `<div class="sec ${cls}">${label ? `<span class="lbl">${label}</span>` : ""}<div class="body">${body}</div></div>`;

function cardHtml(def, { inst, key, t, char, cell } = {}) {
  if (!def) return '<div class="card empty"><div class="sec">empty</div></div>';
  const tgt = key && t[key] ? " target" : "";
  const armed = inst && inst.arms;
  const slot = def.slot
    ? sec(`slot${armed ? " armed" : ""}`, "", armed ? `<b>Armed</b> ${ic("arms").repeat(inst.arms)}<br>+${inst.arms} strength · ${LOC[def.slot.at].name}` : slotHtml(def.slot))
    : "";
  return `<div class="card ${def.side}${char ? " char" : ""}${armed ? " has-arms" : ""}${cell ? " cell" : ""}${tgt}" ${cell ? `title="Cell at ${LOC[cell].name}: +1 strength"` : ""} ${tgt ? `data-key="${key}"` : ""}>
    ${sec("name", "", `${esc(def.name)}${def.basic ? " <span class='muted'>(stack)</span>" : ""}`)}
    ${char ? sec("cost muted", "", `${cap(def.side)} character`) : sec("cost", "Cost:", costHtml(def.cost))}
    ${sec("fx", "", fxBlock(def.effects))}
    ${slot}
  </div>`;
}

function secretHtml(s, t) {
  const opts = t[`secret:${s.id}`] || [];
  const btns = opts.map((o) => `<button class="btn" title="${o.tip || ""}" data-opt="${G.pending.options.indexOf(o)}">${o.btn}</button>`).join("");
  const actions = btns ? `<div class="tab">actions</div><div class="actions">${btns}</div>` : "";
  return `<div class="secret-wrap${btns ? " has-actions" : ""}">${actions}<div class="card secret">
    ${sec("name", "", esc(s.title))}
    ${s.personality ? sec("cost muted", "", `${cap(s.personality)} · ${LOC[PERS_LOC[s.personality]].name}`) : ""}
    ${sec("fx", "Reveal", fxBlock(s.reveal))}
    ${sec("fx", "Prepared", s.vp ? `<div>${vpHtml(s.vp)}</div>` : fxBlock(s.prepared))}
  </div></div>`;
}

function renderBoard(t) {
  $("board").innerHTML = LOCS.map((l) => {
    const c = control(l.id);
    const pers = Object.keys(PERS_LOC).find((k) => PERS_LOC[k] === l.id);
    const half = (h) => {
      const key = `loc:${l.id}:${h}`;
      const arms = h === "low"
        ? G.players.map((p) => (armsAt(p, l.id) ? `<span class="armtag" style="--c:${p.color}">+${armsAt(p, l.id)}${ic("arms")}</span>` : "")).join("")
        : "";
      return `<div class="half ${h}${t[key] ? " target" : ""}" ${t[key] ? `data-key="${key}"` : ""}><span class="tag">${h}</span>${cubes(l.id, h)}${arms}</div>`;
    };
    const str = G.players.filter((p) => G.board[l.id].high[p.id]).map((p) => `<span style="color:${p.color}">${strength(p, l.id)}</span>`).join(" · ");
    return `<div class="loc${c !== null ? " ctrl" : ""}" style="--ctrl:${c !== null ? G.players[c].color : "transparent"}">
      <header><b>${l.name}</b><span class="vp">${l.vp}${ic("vp")}</span></header>
      <div class="meta">${pers ? `<span class="pers">${cap(pers)}</span> · ` : ""}${REWARD_HTML[l.id] || l.reward}</div>
      ${half("high")}${half("low")}
      <footer>Control: ${c !== null ? `<b style="color:${G.players[c].color}">${G.players[c].name}</b>` : "—"}${str ? ` · strength ${str}` : ""}</footer>
    </div>`;
  }).join("");
}

function renderMarket(t) {
  const cards = [];
  for (const side of ["citizen", "outcast"]) G.market[side].forEach((d, i) => cards.push(cardHtml(d, { key: `market:${side}:${i}`, t })));
  G.basics.forEach((d, i) => cards.push(cardHtml(d, { key: `market:basic:${i}`, t })));
  $("market").innerHTML = cards.join("");
}

function renderPlayers(t) {
  $("players").innerHTML = G.players.map((p) => {
    const cells = cellsOf(p);
    const cellAt = (c) => (cells.find((x) => x.cit === c || x.out === c) || {}).at;
    const line = (side) => [cardHtml(p[side].char, { char: true }), ...p[side].line.map((c) => cardHtml(c.def, { inst: c, key: `card:${c.uid}`, t, cell: cellAt(c) }))].join("");
    const showSecrets = !p.bot || G.over;
    const vp = p.vp ? ` · <b>${p.vp.total}</b>${ic("vp")} (${p.vp.locs.join(", ") || "no location"}${p.vp.secVp ? `, +${p.vp.secVp} Secrets` : ""})` : "";
    return `<div class="player${G.current === p.id ? " current" : ""}" style="--c:${p.color}">
      <h3>${p.name} <small>${p.cit.char.name} / ${p.out.char.name}${order()[0] === p ? " · first" : ""}</small></h3>
      <div class="stats">${ic("gold")}<b>${p.gold}</b> ${ic("arms")}<b>${p.arms}</b> ${ic("agent")}<b>${p.reserve}</b> ${ic("secret")}<b>${p.secrets.length}</b>${vp}</div>
      <div class="line">${line("cit")}</div>
      <div class="line">${line("out")}</div>
      ${showSecrets && p.secrets.length ? `<div class="hand">${p.secrets.map((s) => secretHtml(s, t)).join("")}</div>` : ""}
    </div>`;
  }).join("");
}

function renderPrompt() {
  const el = $("prompt");
  if (G.over) {
    el.innerHTML = `<span class="text">The Revolution is over.</span><table><tr><th></th><th>VP</th><th>Locations</th><th>Secrets</th></tr>${G.ranking
      .map((p, i) => `<tr><td style="color:${p.color}">${i + 1}. ${p.name}</td><td>${p.vp.total}</td><td>${p.vp.locs.join(", ") || "—"}</td><td>${p.vp.secVp}</td></tr>`)
      .join("")}</table>`;
    return;
  }
  if (!G.pending) {
    const p = G.current !== null ? G.players[G.current] : null;
    el.innerHTML = `<span class="text">${p ? `${p.name} is playing…` : "…"}</span>`;
    return;
  }
  const free = G.pending.options.map((o, i) => [o, i]).filter(([o]) => !o.key);
  el.innerHTML = `<span class="text">${esc(G.pending.text)}</span>${free.map(([o, i]) => `<button class="btn" data-opt="${i}">${esc(o.label)}</button>`).join("")}${
    G.pending.options.some((o) => o.key) ? '<span class="muted">or click a highlighted element</span>' : ""
  }`;
}

function render() {
  if (typeof document === "undefined") return;
  const t = targets();
  $("status").textContent = G.over
    ? `Game over · ${G.ranking[0].name} ${G.ranking[0].bot ? "wins" : "win"}`
    : `Round ${Math.max(G.round, 1)}/${ROUNDS} · Turn ${Math.max(G.turn, 1)}/${TURNS} · Revolution ${G.revolution}/${ROUNDS}` +
      (G.current !== null ? ` · ${G.players[G.current].name} to play` : "");
  renderPrompt();
  renderBoard(t);
  renderMarket(t);
  renderPlayers(t);
  $("log").innerHTML = G.log.slice(0, 300).map((l) => `<li class="${l.cls || ""}">${esc(l.text)}</li>`).join("");
}

function onClick(ev) {
  if (!G || !G.pending) return;
  const btn = ev.target.closest("[data-opt]");
  if (btn) return G.pending.resolve(G.pending.options[Number(btn.dataset.opt)].value);
  const el = ev.target.closest("[data-key]");
  if (el) {
    const o = G.pending.options.find((x) => x.key === el.dataset.key);
    if (o) G.pending.resolve(o.value);
  }
}

function boot(data) {
  DATA = data;
  PERS_LOC = data._schema.personalities;
}

if (typeof document !== "undefined") {
  document.addEventListener("click", onClick);
  $("new-game").addEventListener("click", () => newGame(Number($("count").value)));
  const soundBtn = $("sound");
  try {
    SFX.on = localStorage.getItem("aeropolis-sound") !== "off";
  } catch {}
  const showSound = () => (soundBtn.textContent = SFX.on ? "Sound on" : "Sound off");
  showSound();
  soundBtn.addEventListener("click", () => {
    SFX.on = !SFX.on;
    try {
      localStorage.setItem("aeropolis-sound", SFX.on ? "on" : "off");
    } catch {}
    showSound();
    SFX.play("play");
  });
  fetch("cards.json")
    .then((r) => r.json())
    .then((data) => {
      boot(data);
      newGame(Number($("count").value));
    })
    .catch(() => {
      $("status").textContent = "Could not load cards.json. Serve this folder over http (e.g. python3 -m http.server).";
    });
} else {
  module.exports = { boot, newGame, get G() { return G; }, get LOCS() { return LOCS; }, ROUNDS };
}
