"use strict";

// Hot-seat engine for Aeropolis: Spire. Rules: spire.html. Data: spire-data.js.
// Same pattern as undercity-play.js: each turn runs as an async coroutine that awaits picks;
// Undo restores the snapshot taken before the current (or last) turn and aborts any pending pick.

const COLORS = ["#e07a5a", "#6fa8e0", "#e0c25a", "#b08ae8"];
const PAWN = { cit: "Citizen", out: "Outcast" };
const EFFECT_TAG = { patron: "Outcast ↑", blackmail: "Citizen ↑", buy: "Buy", scrap: "Scrap", regroup: "Regroup" };
const WIDTHS = SP_CONFIG.widths;
const R = WIDTHS.length;
const ABORT = Symbol("abort");
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const CARDS = Object.fromEntries([...SP_STARTER, ...SP_MARKET].map((c) => [c.id, c]));

let S = null; // game state (plain JSON, snapshotted for undo)
let history = [];
let ui = {}; // pending pick: { kind, msg, ok, buttons, skip, skipLabel, player, resolve, reject }
let busy = false;

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const P = (q) => S.players[q];
const nm = (q) => `<b style="color:${P(q).color}">${esc(P(q).name)}</b>`;
const pn = (q, k) => `${nm(q)}'s ${PAWN[k]}`;
function log(msg) {
  S.log.unshift(`T${S.turn} · ${msg}`);
}

/* ---------- map ---------- */

// Stacked hex rows sit half a hex apart. Rows of equal width therefore stagger; each row's offset
// is chosen to keep it as centred as possible, alternating sides on a tie.
const HEXES = [];
{
  let base = -(WIDTHS[0] - 1) / 2;
  let lean = 1;
  WIDTHS.forEach((w, r) => {
    if (r) {
      const opts = [base - 0.5, base + 0.5].map((b) => ({ b, c: b + (w - 1) / 2 }));
      opts.sort((a, b) => Math.abs(a.c) - Math.abs(b.c) || (Math.sign(a.c) === lean ? 1 : -1));
      base = opts[0].b;
      if (opts[0].c) lean = Math.sign(opts[0].c);
    }
    for (let i = 0; i < w; i++) HEXES.push({ r, i, x: base + i });
  });
}
const HEX = Object.fromEntries(HEXES.map((h) => [`${h.r},${h.i}`, h]));
const same = (a, b) => a.r === b.r && a.i === b.i;
const height = (r) => R - r;
const topZone = (r) => r < SP_CONFIG.topZone;
const neighbors = (h) => {
  const a = HEX[`${h.r},${h.i}`];
  return HEXES.filter((b) => (Math.abs(b.r - a.r) === 1 && Math.abs(b.x - a.x) === 0.5) || (b.r === a.r && Math.abs(b.x - a.x) === 1));
};
const isNext = (a, b) => neighbors(a).some((n) => same(n, b));

function hexInfo({ r, i }) {
  const named = SP_HEXES[`${r},${i}`];
  const c = SP_CONFIG.cost;
  return { name: "Street", ...named, cost: (topZone(r) ? c.top : c.street) + (named ? c.named : 0) };
}

function pawnsAt(h) {
  const at = [];
  S.players.forEach((x, q) => ["cit", "out"].forEach((k) => same(x[k], h) && at.push({ q, k })));
  return at;
}

// Top zone: any number of pawns. Elsewhere: 1 pawn per hex.
const free = (h) => topZone(h.r) || !pawnsAt(h).length;

// Rival pawns next to one of p's pawns. Nothing interacts in the top zone.
function rivalsNext(p, k) {
  const own = P(p)[k];
  if (topZone(own.r)) return [];
  return neighbors(own)
    .filter((h) => !topZone(h.r))
    .flatMap(pawnsAt)
    .filter((w) => w.q !== p);
}

/* ---------- coin ---------- */

// Coin the player could raise right now: their stock plus every hand card burned.
const reach = (p) => P(p).coins + P(p).hand.reduce((t, id) => t + CARDS[id].value * 2, 0);

// Pay cost from the stock, first cashing cards from hand (used, or burned for double) until it covers it.
// Only call when reach(p) >= cost.
async function pay(p, cost, why) {
  const x = P(p);
  while (x.coins < cost) {
    const opts = x.hand.flatMap((id, i) => [
      { label: `Cash ${CARDS[id].name} (+${CARDS[id].value})`, value: [false, i] },
      { label: `Burn ${CARDS[id].name} (+${CARDS[id].value * 2})`, value: [true, i] },
    ]);
    const [burn, i] = await pickBtn(`${why} costs ${cost}; you have ${x.coins} coin. Cash cards from your hand.`, opts, { player: p });
    const id = x.hand.splice(i, 1)[0];
    const gain = CARDS[id].value * (burn ? 2 : 1);
    (burn ? x.burned : x.used).push(id);
    x.coins += gain;
    log(`${nm(p)} ${burn ? "burns" : "cashes"} <b>${CARDS[id].name}</b>: +${gain} coin.`);
  }
  x.coins -= cost;
}

/* ---------- picks ---------- */

function ask(spec) {
  return new Promise((resolve, reject) => {
    ui = { ...spec, resolve, reject };
    render();
  });
}

function settle(v) {
  const r = ui.resolve;
  ui = {};
  r(v);
}

function pickHex(msg, ok, opts = {}) {
  if (!HEXES.some(ok)) return Promise.resolve(null);
  return ask({ kind: "hex", msg, ok, ...opts });
}

function pickPawn(msg, ok, opts = {}) {
  if (!S.players.some((_, q) => ok(q, "cit") || ok(q, "out"))) return Promise.resolve(null);
  return ask({ kind: "pawn", msg, ok, ...opts });
}

function pickBtn(msg, buttons, opts = {}) {
  if (!buttons.length) return Promise.resolve(null);
  return ask({ kind: "btn", msg, buttons, ...opts });
}

/* ---------- effects ---------- */

function place(q, k, h) {
  P(q)[k] = { r: h.r, i: h.i };
}

async function climb(p, k, n = 1) {
  for (let s = 0; s < n; s++) {
    const from = P(p)[k];
    const h = await pickHex(`${PAWN[k]} climbs: choose a free hex above.`, (h) => h.r === from.r - 1 && isNext(from, h) && free(h), { player: p });
    if (!h) return log(`${pn(p, k)} cannot climb.`);
    place(p, k, h);
    log(`${pn(p, k)} climbs to height ${height(h.r)}.`);
  }
}

async function pushDown(p, w, steps) {
  for (let s = 0; s < steps; s++) {
    const from = P(w.q)[w.k];
    const h = await pickHex(`Push ${esc(P(w.q).name)}'s ${PAWN[w.k]}: choose a free hex below.`, (h) => h.r === from.r + 1 && isNext(from, h) && free(h), {
      player: p,
    });
    if (!h) return log(`${pn(w.q, w.k)} cannot be pushed further.`);
    place(w.q, w.k, h);
    log(`${nm(p)} pushes ${pn(w.q, w.k)} down to height ${height(h.r)}.`);
  }
}

async function push(p, steps) {
  const ok = (q, k) => ["cit", "out"].some((own) => rivalsNext(p, own).some((w) => w.q === q && w.k === k));
  const w = await pickPawn("Push: choose a rival pawn next to one of yours.", ok, { player: p, skip: true });
  if (!w) return log(`${nm(p)}: no rival pawn to push.`);
  await pushDown(p, w, steps);
}

async function pushAll(p, k) {
  const rivals = rivalsNext(p, k);
  if (!rivals.length) return log(`${nm(p)}: no rival pawn next to your ${PAWN[k]}.`);
  for (const w of rivals) await pushDown(p, w, 1);
}

async function swap(p) {
  const mine = (q, k) => q === p && rivalsNext(p, k).length > 0;
  const own = await pickPawn("Swap: choose one of your pawns.", mine, { player: p, skip: true });
  if (!own) return log(`${nm(p)}: no rival pawn to swap with.`);
  const w = await pickPawn("Swap with which rival pawn?", (q, k) => rivalsNext(p, own.k).some((x) => x.q === q && x.k === k), { player: p });
  const a = P(p)[own.k];
  const b = P(w.q)[w.k];
  place(p, own.k, b);
  place(w.q, w.k, a);
  log(`${pn(p, own.k)} swaps places with ${pn(w.q, w.k)}.`);
}

async function scrap(p) {
  const x = P(p);
  if (x.hand.length + x.used.length + x.burned.length <= SP_CONFIG.minCards) return log(`${nm(p)} is at the ${SP_CONFIG.minCards}-card minimum: no scrap.`);
  const opts = [
    ...x.hand.map((id, i) => ({ label: `${CARDS[id].name} (hand)`, value: ["hand", i] })),
    ...x.used.map((id, i) => ({ label: `${CARDS[id].name} (used)`, value: ["used", i] })),
  ];
  const v = await pickBtn("Scrap: remove 1 card from the game?", opts, { player: p, skip: true });
  if (v) log(`${nm(p)} scraps <b>${CARDS[x[v[0]].splice(v[1], 1)[0]].name}</b>.`);
}

async function buy(p) {
  const opts = S.market
    .map((id, i) => ({ c: CARDS[id], i }))
    .filter(({ c }) => c.cost <= reach(p))
    .map(({ c, i }) => ({ label: `Buy ${c.name} (${c.cost} coin)`, value: i }));
  const i = await pickBtn(`Buy 1 market card? You have ${P(p).coins} coin, plus cards to cash.`, opts, { player: p, skip: true });
  if (i == null) return log(`${nm(p)} buys nothing.`);
  const id = S.market[i];
  await pay(p, CARDS[id].cost, CARDS[id].name);
  S.market.splice(i, 1);
  P(p).hand.push(id);
  if (S.marketDeck.length) S.market.push(S.marketDeck.pop());
  log(`${nm(p)} buys <b>${CARDS[id].name}</b>.`);
}

function regroup(p) {
  const x = P(p);
  log(`${nm(p)} regroups: takes back ${x.used.length} card${x.used.length === 1 ? "" : "s"}${x.burned.length ? `, ${x.burned.length} burned card(s) become used` : ""}.`);
  x.hand.push(...x.used);
  x.used = x.burned;
  x.burned = [];
}

async function activate(p, k) {
  const info = hexInfo(P(p)[k]);
  if (!info.effect) return;
  log(`${pn(p, k)} activates <b>${info.name}</b>.`);
  const fx = {
    patron: () => climb(p, "out"),
    blackmail: () => climb(p, "cit"),
    buy: () => buy(p),
    scrap: () => scrap(p),
    regroup: () => regroup(p),
  };
  await fx[info.effect]();
}

async function activateHere(p, times = 1) {
  const w = await pickPawn("Activate the hex under which pawn?", (q, k) => q === p && hexInfo(P(p)[k]).effect, { player: p, skip: true });
  if (!w) return log(`${nm(p)}: no named hex to activate.`);
  for (let t = 0; t < times; t++) await activate(p, w.k);
}

// Sell Out: your Citizen moves down, earning 1 coin per row. Like any move, it activates where it stops.
async function sellOut(p, rows) {
  let moved = 0;
  for (; moved < rows; moved++) {
    const from = P(p).cit;
    const h = await pickHex("Sell Out: choose a free hex below for your Citizen.", (h) => h.r === from.r + 1 && isNext(from, h) && free(h), { player: p });
    if (!h) break;
    place(p, "cit", h);
  }
  P(p).coins += moved;
  log(`${pn(p, "cit")} sells out: down ${moved}, +${moved} coin.`);
  if (moved) await activate(p, "cit");
}

const CARD_FX = {
  sellout: (p) => sellOut(p, 2),
  patron: (p) => climb(p, "out"),
  clerk: (p) => climb(p, "cit"),
  informer: (p) => activateHere(p),
  courier: regroup,
  thug: (p) => push(p, 1),
  socialite: swap,
  organizer: (p) => climb(p, "out", 2),
  banker: (p) => climb(p, "cit", 2),
  smuggler: async (p) => {
    P(p).coins += 3;
    log(`${nm(p)} gains 3 coin.`);
    await steps(p, "out");
  },
  fence: buy,
  fixer: (p) => activateHere(p, 2),
  enforcer: (p) => push(p, 2),
  agitator: (p) => pushAll(p, "out"),
};

/* ---------- turns ---------- */

// Runs one undoable turn: snapshot, then the coroutine. An Undo aborts it via ABORT.
async function guarded(fn) {
  history.push(JSON.stringify(S));
  busy = true;
  try {
    await fn();
  } catch (e) {
    if (e === ABORT) return;
    throw e;
  }
  busy = false;
  render();
}

function undo() {
  if (!history.length) return;
  const reject = ui.reject;
  ui = {};
  S = JSON.parse(history.pop());
  busy = false;
  if (reject) reject(ABORT);
  render();
}

const canAct = () => S.phase === "play" && !busy;

// Action: play 1 card for its action.
function playCard(i) {
  const p = S.current;
  const id = P(p).hand[i];
  if (!canAct() || !CARDS[id].text) return;
  guarded(async () => {
    P(p).hand.splice(i, 1);
    P(p).used.push(id);
    log(`${nm(p)} plays <b>${CARDS[id].name}</b>.`);
    await CARD_FX[id](p);
    endTurn(p);
  });
}

// Step one pawn hex by hex, paying each hex's cost. Where it stops, its hex activates.
async function steps(p, k) {
  const x = P(p);
  let moved = 0;
  for (;;) {
    const from = x[k];
    const ok = (h) => isNext(from, h) && free(h) && hexInfo(h).cost <= reach(p);
    const h = await pickHex(`${PAWN[k]}: ${x.coins} coin, plus cards to cash. Choose the next hex, or Stop.`, ok, { player: p, skip: true, skipLabel: "Stop" });
    if (!h) break;
    await pay(p, hexInfo(h).cost, `Stepping to ${hexInfo(h).name}`);
    place(p, k, h);
    moved++;
  }
  if (!moved) return log(`${nm(p)}: no step taken.`);
  log(`${pn(p, k)} stops at ${hexInfo(x[k]).name}, height ${height(x[k].r)}.`);
  await activate(p, k);
}

// Move: step one pawn, paying in coin.
function moveTurn() {
  if (!canAct() || !P(S.current).hand.length) return;
  guarded(async () => {
    const p = S.current;
    const k = await pickBtn("Move which pawn?", [{ label: "Citizen", value: "cit" }, { label: "Outcast", value: "out" }], { player: p });
    await steps(p, k);
    endTurn(p);
  });
}

// A player who starts their turn with an empty hand spends the whole turn on Regroup.
function regroupTurn() {
  if (!canAct() || P(S.current).hand.length) return;
  guarded(async () => {
    regroup(S.current);
    endTurn(S.current);
  });
}

const met = (x) => x.out.r <= x.cit.r;

function endTurn(p) {
  if (S.finalTurns != null) {
    if (--S.finalTurns === 0) return endGame();
  } else {
    const q = S.players.findIndex(met);
    if (q >= 0) {
      log(`— ${nm(q)}'s Citizen and Outcast meet: every player but ${nm(p)} takes 1 last turn. —`);
      S.finalTurns = S.players.length - 1;
      if (!S.finalTurns) return endGame();
    }
  }
  S.current = (p + 1) % S.players.length;
  S.turn++;
}

function endGame() {
  S.phase = "end";
  log("— Game over. —");
}

function startGame(names) {
  const n = names.length;
  const baseW = WIDTHS[R - 1];
  S = {
    players: names.map((name, q) => ({
      name,
      color: COLORS[q],
      cit: { r: 0, i: Math.round(((q + 0.5) * WIDTHS[0]) / n - 0.5) }, // spread along the top
      out: { r: R - 1, i: Math.round(((q + 0.5) * baseW) / n - 0.5) }, // spread along the base
      coins: SP_CONFIG.startCoins,
      hand: SP_STARTER.flatMap((c) => Array(c.copies).fill(c.id)),
      used: [],
      burned: [],
    })),
    marketDeck: shuffle(SP_MARKET.flatMap((c) => Array(c.copies).fill(c.id))),
    market: [],
    current: 0,
    turn: 1,
    phase: "play",
    finalTurns: null,
    log: [],
  };
  S.market = S.marketDeck.splice(-SP_CONFIG.marketSize);
  history = [];
  ui = {};
  busy = false;
  log(`— Game starts. ${nm(0)} goes first. —`);
  render();
}

/* ---------- render ---------- */

const score = (x) => ({ lo: height(Math.max(x.cit.r, x.out.r)), cit: height(x.cit.r), out: height(x.out.r) });

function renderStatus() {
  if (S.phase === "end") return ($("status").innerHTML = renderResults());
  let s = `Turn ${S.turn} · ${nm(S.current)} to play`;
  if (S.finalTurns != null) s += ` · final turns left: ${S.finalTurns}`;
  $("status").innerHTML = s;
}

function renderResults() {
  const rows = S.players
    .map((x, q) => ({ q, ...score(x) }))
    .sort((a, b) => b.lo - a.lo || b.cit - a.cit)
    .map((r) => `<tr><td>${nm(r.q)}</td><td>${r.lo}</td><td>${r.cit}</td><td>${r.out}</td></tr>`)
    .join("");
  return `<b>Game over.</b> Score = height of your lower pawn; tie → higher Citizen.
    <table class="results"><tr><th>Player</th><th>Score</th><th>Citizen</th><th>Outcast</th></tr>${rows}</table>`;
}

function cardHtml(id, attrs = "", cls = "") {
  const c = CARDS[id];
  const lev = `<span class="val" title="Coin value">${c.value}</span>`;
  const cost = c.cost ? `<span class="cost" title="Cost">cost ${c.cost}</span>` : "";
  return `<div class="card ${cls}" ${attrs}><h3><span>${c.name} ${lev}</span>${cost}</h3><p>${c.text || "<i>No action.</i>"}</p></div>`;
}

function renderMarket() {
  $("market-count").textContent = `· deck ${S.marketDeck.length}`;
  $("market").innerHTML = S.market.map((id) => cardHtml(id)).join("");
}

const SIZE = 28;
const HW = SIZE * Math.sqrt(3);
const HH = SIZE * 1.5;
const XMIN = Math.min(...HEXES.map((h) => h.x));
const XMAX = Math.max(...HEXES.map((h) => h.x));
const BW = Math.ceil((XMAX - XMIN + 1) * HW + 40);
const BH = Math.ceil(SIZE * 2 + (R - 1) * HH + 20);
const centre = ({ r, i }) => ({ x: 30 + HW / 2 + (HEX[`${r},${i}`].x - XMIN) * HW, y: SIZE + 10 + r * HH });

function renderBoard() {
  const hexPts = (c) =>
    Array.from({ length: 6 }, (_, k) => {
      const a = (Math.PI / 180) * (60 * k - 90);
      return `${(c.x + SIZE * Math.cos(a)).toFixed(1)},${(c.y + SIZE * Math.sin(a)).toFixed(1)}`;
    }).join(" ");
  const hexes = HEXES.map((h) => {
    const c = centre(h);
    const info = hexInfo(h);
    const live = ui.kind === "hex" && ui.ok(h);
    const words = info.effect ? info.name.split(" ") : [];
    const label = words.map((w, n) => `<tspan x="${c.x}" dy="${n ? 8 : 0}">${esc(w)}</tspan>`).join("");
    const tag = info.effect ? `<text class="hx-tag" x="${c.x}" y="${c.y + 4}">${EFFECT_TAG[info.effect]}</text>` : "";
    const title = `${info.name} · height ${height(h.r)} · cost ${info.cost}${info.effect ? ` · ${SP_EFFECTS[info.effect]}` : ""}`;
    return `<g class="hx ${info.effect ? "named" : ""} ${topZone(h.r) ? "top" : ""} ${live ? "live" : ""}" data-hex="${h.r},${h.i}">
      <title>${esc(title)}</title><polygon points="${hexPts(c)}"/>
      <text class="hx-cost" x="${c.x}" y="${c.y - 17}">${info.cost}</text>
      <text class="hx-name" x="${c.x}" y="${c.y - (words.length > 1 ? 11 : 6)}">${label}</text>${tag}</g>`;
  }).join("");
  const pawns = HEXES.flatMap((h) => {
    const at = pawnsAt(h);
    const c = centre(h);
    return at.map((w, n) => {
      const x = c.x + (n - (at.length - 1) / 2) * Math.min(11, 36 / at.length);
      const y = c.y + 14;
      const live = ui.kind === "pawn" && ui.ok(w.q, w.k);
      const shape = w.k === "cit" ? `<circle cx="${x}" cy="${y}" r="6"/>` : `<rect x="${x - 5}" y="${y - 5}" width="10" height="10" transform="rotate(45 ${x} ${y})"/>`;
      return `<g class="pawn ${live ? "live" : ""}" data-pawn="${w.q},${w.k}" fill="${P(w.q).color}"><title>${esc(P(w.q).name)} ${PAWN[w.k]}</title>${shape}</g>`;
    });
  }).join("");
  const heights = Array.from({ length: R }, (_, r) => `<text class="hx-h" x="4" y="${SIZE + 14 + r * HH}">${height(r)}</text>`).join("");
  $("board").innerHTML = `<svg viewBox="0 0 ${BW} ${BH}" width="${BW}" height="${BH}">${heights}${hexes}${pawns}</svg>`;
}

function renderPlayers() {
  const acting = ui.player != null ? ui.player : S.phase === "play" ? S.current : null;
  const pile = (label, ids) =>
    ids.length ? `<div class="played-row"><span class="mini-label">${label}</span>${ids.map((id) => `<span class="played">${CARDS[id].name}</span>`).join("")}</div>` : "";
  $("players").innerHTML = S.players
    .map((x, q) => {
      const s = score(x);
      let hand;
      if (q === S.current && S.phase === "play") {
        const cards = x.hand.map((id, i) => cardHtml(id, `data-hand="${i}"`, canAct() && CARDS[id].text ? "live" : ""));
        hand = `<div class="hand">${cards.join("")}</div>`;
      } else hand = pile("Hand", x.hand);
      return `<div class="player ${q === acting ? "active" : ""}" style="border-left-color:${x.color}">
        <h3><span style="color:${x.color}">${esc(x.name)}</span><small>score ${s.lo}</small></h3>
        <div class="score">● Citizen <b>${s.cit}</b> · ◆ Outcast <b>${s.out}</b> · coin <b>${x.coins}</b></div>
        ${hand}${pile("Used", x.used)}${pile("Burned", x.burned)}</div>`;
    })
    .join("");
}

function renderPrompt() {
  let msg = "";
  let buttons = "";
  if (ui.kind) {
    msg = (ui.player != null ? `${nm(ui.player)}: ` : "") + ui.msg;
    if (ui.kind === "btn") buttons = ui.buttons.map((b, i) => `<button class="btn" data-btn="${i}">${esc(b.label)}</button>`).join("");
    if (ui.skip) buttons += `<button class="btn" data-skip>${ui.skipLabel || "Done / skip"}</button>`;
  } else if (S.phase === "play") {
    if (P(S.current).hand.length) {
      msg = `${nm(S.current)}: click a card to play its action, or Move.`;
      buttons = `<button class="btn primary" data-move>Move</button>`;
    } else {
      msg = `${nm(S.current)}: your hand is empty — this turn you Regroup.`;
      buttons = `<button class="btn primary" data-regroup>Regroup</button>`;
    }
  } else if (S.phase === "end") msg = "Game over.";
  buttons += `<button class="btn" data-undo ${history.length ? "" : "disabled"}>Undo</button>`;
  $("prompt").innerHTML = `<div class="msg">${msg}</div>${buttons}`;
}

function render() {
  renderStatus();
  renderMarket();
  renderBoard();
  renderPlayers();
  renderPrompt();
  $("log").innerHTML = S.log.map((m) => `<li>${m}</li>`).join("");
}

/* ---------- events ---------- */

document.addEventListener("click", (e) => {
  if (!S) return;
  const t = e.target.closest("[data-undo],[data-regroup],[data-move],[data-hand],[data-hex],[data-pawn],[data-btn],[data-skip]");
  if (!t) return;
  const d = t.dataset;
  if (d.undo !== undefined) return undo();
  if (d.regroup !== undefined) return regroupTurn();
  if (d.move !== undefined) return moveTurn();
  if (d.hand !== undefined) return playCard(+d.hand);
  if (d.skip !== undefined && ui.skip) return settle(null);
  if (d.btn !== undefined && ui.kind === "btn") return settle(ui.buttons[+d.btn].value);
  if (d.pawn !== undefined && ui.kind === "pawn") {
    const [q, k] = d.pawn.split(",");
    if (ui.ok(+q, k)) return settle({ q: +q, k });
  }
  const hexEl = e.target.closest("[data-hex]");
  if (hexEl && ui.kind === "hex") {
    const [r, i] = hexEl.dataset.hex.split(",").map(Number);
    if (ui.ok({ r, i })) settle({ r, i });
  }
});

/* ---------- setup dialog ---------- */

function renderSetup() {
  const n = +$("setup-count").value;
  const prev = [...document.querySelectorAll(".setup-player input")].map((i) => i.value);
  $("setup-players").innerHTML = Array.from(
    { length: n },
    (_, i) => `<div class="setup-player"><i style="background:${COLORS[i]}"></i><input value="${esc(prev[i] || `Player ${i + 1}`)}" /></div>`,
  ).join("");
}

function openSetup() {
  $("setup").returnValue = "";
  renderSetup();
  $("setup").showModal();
}

$("setup-count").addEventListener("change", renderSetup);
$("new-game").addEventListener("click", openSetup);
$("setup").addEventListener("close", () => {
  if ($("setup").returnValue !== "start") return;
  startGame([...document.querySelectorAll(".setup-player input")].map((i) => i.value.trim() || "Player"));
});

openSetup();
