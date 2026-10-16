"use strict";

// Hot-seat engine for Aeropolis: Undercity. Rules: undercity.html. Data: undercity-data.js.
// Every card runs as an async coroutine that awaits board/button picks; Undo restores the
// snapshot taken before the current (or last) card and aborts any pending pick.

const COLORS = ["#e07a5a", "#6fa8e0", "#e0c25a", "#b08ae8"];
const SIDE = { C: "Citizen", O: "Outcast", S: "Service" };
const BONUS = (bonus) => UC_LOCATIONS.findIndex((l) => l.bonus === bonus);
const SHOP = BONUS("buy");
const SCRAP = BONUS("trash");
const BANK = BONUS("reserve");
const ABORT = Symbol("abort");
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const CARDS = Object.fromEntries([...UC_STARTER, ...UC_MARKET].map((c) => [c.id, c]));

let S = null; // game state (plain JSON, snapshotted for undo)
let history = [];
let ui = {}; // pending pick: { kind, msg, ok, buttons, skip, player, resolve, reject }
let busy = false;

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const P = (i) => S.players[i];
const LOC = (l) => UC_LOCATIONS[l];
const nm = (i) => `<b style="color:${P(i).color}">${esc(P(i).name)}</b>`;
function log(msg) {
  S.log.unshift(`T${S.turn} · ${msg}`);
}

/* ---------- control & spire ---------- */

function controller(l) {
  let best = 0, who = null, tie = false;
  S.locs[l].forEach((n, q) => {
    if (n > best) { best = n; who = q; tie = false; }
    else if (n === best && n > 0) tie = true;
  });
  return tie ? null : who;
}

// Regroup score if it happened now.
function projected(q) {
  const g = { C: 0, O: 0 };
  S.locs.forEach((_, l) => {
    const side = LOC(l).side;
    if (side !== "S" && controller(l) === q) g[side]++; // service locations give no Spire
  });
  return g;
}

// Citizen never rises above the top; Outcast never passes the Citizen (they meet).
// Returns how far the token actually moved.
function rise(p, side, n) {
  const x = P(p);
  const key = side === "C" ? "cit" : "out";
  const before = x[key];
  x[key] = Math.min(side === "C" ? UC_CONFIG.spireTop : x.cit, before + n);
  return x[key] - before;
}

function gainText(side, earned, moved) {
  return `${SIDE[side]} +${moved}${moved < earned ? ` (${earned} earned, capped)` : ""}`;
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

function pickLoc(msg, ok, opts = {}) {
  if (!S.locs.some((_, l) => ok(l))) return Promise.resolve(null);
  return ask({ kind: "loc", msg, ok, ...opts });
}

function pickCube(msg, ok, opts = {}) {
  const full = (l, q) => S.locs[l][q] > 0 && ok(l, q);
  if (!S.locs.some((_, l) => S.players.some((_, q) => full(l, q)))) return Promise.resolve(null);
  return ask({ kind: "cube", msg, ok: full, ...opts });
}

function pickBtn(msg, buttons, opts = {}) {
  if (!buttons.length) return Promise.resolve(null);
  return ask({ kind: "btn", msg, buttons, ...opts });
}

/* ---------- effects ---------- */

async function recruit(p, max) {
  if (!P(p).reserve) return log(`${nm(p)} has no cubes in reserve.`);
  const l = await pickLoc(`Recruit: choose a location.`, () => true, { player: p, skip: true });
  if (l == null) return log(`${nm(p)}: no cube placed.`);
  const n = Math.min(max, P(p).reserve);
  const placed =
    n > 1 ? await pickBtn(`Place how many at ${LOC(l).name}?`, Array.from({ length: n }, (_, i) => ({ label: String(n - i), value: n - i })), { player: p }) : n;
  S.locs[l][p] += placed;
  P(p).reserve -= placed;
  log(`${nm(p)} places ${placed} at ${LOC(l).name}.`);
}

async function move(p, count, anywhere = false) {
  const arrived = {};
  let done = 0;
  for (let i = 0; i < count; i++) {
    const c = await pickCube(`Move ${i + 1}/${count}: choose one of your cubes, or Done.`, (l, q) => q === p && S.locs[l][p] > (arrived[l] || 0), {
      player: p,
      skip: true,
    });
    if (!c) break;
    const d = await pickLoc(
      `Move it from ${LOC(c.l).name} to ${anywhere ? "any" : "an adjacent"} location.`,
      (a) => (anywhere ? a !== c.l : UC_ADJ[c.l].includes(a)),
      { player: p },
    );
    S.locs[c.l][p]--;
    S.locs[d][p]++;
    arrived[d] = (arrived[d] || 0) + 1;
    log(`${nm(p)} moves ${LOC(c.l).name} → ${LOC(d).name}.`);
    done++;
  }
  if (!done) log(`${nm(p)}: no cube moved.`);
}

async function agitate(p) {
  const l = await pickLoc("Agitate: choose a location.", () => true, { player: p, skip: true });
  if (l == null) return log(`${nm(p)}: Agitate had no effect.`);
  if (P(p).reserve) {
    S.locs[l][p]++;
    P(p).reserve--;
    log(`${nm(p)} places 1 at ${LOC(l).name}.`);
  } else log(`${nm(p)} has no cubes in reserve.`);
  const c = await pickCube(`Agitate: move a cube out of ${LOC(l).name}, or skip.`, (cl) => cl === l, { player: p, skip: true });
  if (!c) return;
  const d = await pickLoc(`Move ${esc(P(c.q).name)}'s cube to an adjacent location.`, (a) => UC_ADJ[l].includes(a), { player: p });
  S.locs[l][c.q]--;
  S.locs[d][c.q]++;
  log(`${nm(p)} moves ${nm(c.q)}'s cube ${LOC(l).name} → ${LOC(d).name}.`);
}

async function seize(p) {
  const c = await pickCube("Seize: choose an opponent cube where you have more cubes than them.", (l, q) => q !== p && S.locs[l][p] > S.locs[l][q], {
    player: p,
    skip: true,
  });
  if (!c) return log(`${nm(p)}: Seize had no effect.`);
  S.locs[c.l][c.q]--;
  P(c.q).reserve++;
  log(`${nm(p)} seizes ${nm(c.q)}'s cube at ${LOC(c.l).name}.`);
}

async function bribe(p) {
  if (!P(p).reserve) return log(`${nm(p)} has no cubes in reserve.`);
  const c = await pickCube("Bribe: choose an opponent cube at a location where you have a cube.", (l, q) => q !== p && S.locs[l][p] > 0, {
    player: p,
    skip: true,
  });
  if (!c) return log(`${nm(p)}: Bribe had no effect.`);
  S.locs[c.l][c.q]--;
  P(c.q).reserve++;
  S.locs[c.l][p]++;
  P(p).reserve--;
  log(`${nm(p)} bribes ${nm(c.q)}'s cube at ${LOC(c.l).name}.`);
}

async function riot(p) {
  const l = await pickLoc(
    "Riot: choose a location where you have a cube and opponents do too.",
    (l) => S.locs[l][p] > 0 && S.locs[l].some((n, q) => q !== p && n > 0),
    { player: p, skip: true },
  );
  if (l == null) return log(`${nm(p)}: Riot had no effect.`);
  log(`${nm(p)} starts a riot at ${LOC(l).name}.`);
  for (let q = 0; q < S.players.length; q++) {
    if (q === p) continue;
    while (S.locs[l][q] > 0) {
      const d = await pickLoc(`Push ${esc(P(q).name)}'s cube out of ${LOC(l).name}.`, (a) => UC_ADJ[l].includes(a), { player: p });
      S.locs[l][q]--;
      S.locs[d][q]++;
      log(`${nm(q)} is pushed to ${LOC(d).name}.`);
    }
  }
}

function patron(p) {
  const g = projected(p).O;
  log(`${nm(p)} Patron: ${gainText("O", g, rise(p, "O", g))}.`);
}

// only: score just that side's districts (Guild Assembly / Street Summons).
async function regroup(p, only = null) {
  const g = projected(p);
  if (only) g[only === "C" ? "O" : "C"] = 0;
  const c = rise(p, "C", g.C);
  const o = rise(p, "O", g.O);
  log(`${nm(p)} regroups${only ? ` (${SIDE[only]} districts only)` : ""}: ${gainText("C", g.C, c)}, ${gainText("O", g.O, o)}.`);
  if (!S.locs[SHOP][p]) log(`${nm(p)}: no cube in the Noodle Shop, no buy.`);
  else {
    const x = P(p);
    const buyable = S.market
      .map((id, i) => ({ c: CARDS[id], i }))
      .filter(({ c }) => x.cit - c.cost >= x.out)
      .map(({ c, i }) => ({ label: `${c.name} (−${c.cost})`, sub: c.text, value: i }));
    const i = await pickBtn("Buy 1 market card? Its cost sinks your Citizen.", buyable, { player: p, skip: true });
    if (i != null) {
      const id = S.market[i];
      x.cit -= CARDS[id].cost;
      x.hand.push(id);
      S.market.splice(i, 1);
      if (S.marketDeck.length) S.market.push(S.marketDeck.pop());
      log(`${nm(p)} buys <b>${CARDS[id].name}</b>: Citizen −${CARDS[id].cost}.`);
    }
  }
  log(`${nm(p)} takes back ${P(p).played.length} card${P(p).played.length === 1 ? "" : "s"}.`);
  P(p).hand.push(...P(p).played);
  P(p).played = [];
  if (!S.locs[SCRAP][p]) log(`${nm(p)}: no cube in the Scrapyard, no scrap.`);
  else if (P(p).hand.length <= UC_CONFIG.minCards) {
    log(`${nm(p)} Scrapyard: already at the ${UC_CONFIG.minCards}-card minimum, nothing to scrap.`);
  } else {
    const hand = P(p).hand;
    const i = await pickBtn(
      "Scrapyard: remove 1 card from the game?",
      hand.map((id, i) => ({ label: CARDS[id].name, value: i })),
      { player: p, skip: true },
    );
    if (i != null) log(`${nm(p)} scraps <b>${CARDS[hand.splice(i, 1)[0]].name}</b>.`);
  }
  if (!S.locs[BANK][p]) log(`${nm(p)}: no cube in the Counting House, no hire.`);
  else if (!P(p).stock) log(`${nm(p)} Counting House: stock empty, no hire.`);
  else {
    P(p).stock--;
    P(p).reserve++;
    log(`${nm(p)} Counting House: +1 cube to reserve.`);
  }
}

const CARD_FX = {
  recruit: (p) => recruit(p, 2),
  move: (p) => move(p, 2),
  agitate,
  safehouse: (p) => regroup(p),
  "guild-assembly": (p) => regroup(p, "C"),
  "street-summons": (p) => regroup(p, "O"),
  "mass-recruit": (p) => recruit(p, 3),
  rally: async (p) => {
    await recruit(p, 1);
    await move(p, 1);
  },
  procession: (p) => move(p, 4),
  smuggle: (p) => move(p, 1, true),
  seize,
  bribe,
  riot,
  patron,
};

/* ---------- flow ---------- */

// Runs one undoable step: snapshot, then the coroutine. An Undo aborts it via ABORT.
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

function playCard(i) {
  if (busy || S.phase !== "play") return;
  guarded(async () => {
    const p = S.current;
    const id = P(p).hand.splice(i, 1)[0];
    P(p).played.push(id);
    log(`${nm(p)} plays <b>${CARDS[id].name}</b>.`);
    await CARD_FX[id](p);
    endTurn(p);
  });
}

// A player who starts their turn with an empty hand spends the whole turn on Regroup.
function regroupTurn() {
  if (busy || S.phase !== "play" || P(S.current).hand.length) return;
  guarded(async () => {
    const p = S.current;
    await regroup(p);
    endTurn(p);
  });
}

function endTurn(p) {
  if (S.finalTurns != null) {
    if (--S.finalTurns === 0) return endGame();
  } else if (P(p).out >= P(p).cit) {
    log(`— ${nm(p)}'s Citizen and Outcast meet: every other player takes 1 last turn. —`);
    S.finalTurns = S.players.length - 1;
    if (!S.finalTurns) return endGame();
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
  S = {
    players: names.map((name, i) => ({
      name,
      color: COLORS[i],
      reserve: UC_CONFIG.reserve,
      stock: UC_CONFIG.cubes - UC_CONFIG.reserve,
      cit: UC_CONFIG.spireTop,
      out: 0,
      hand: UC_STARTER.map((c) => c.id),
      played: [],
    })),
    locs: UC_LOCATIONS.map(() => Array(n).fill(0)),
    marketDeck: shuffle(UC_MARKET.flatMap((c) => Array(c.copies).fill(c.id))),
    market: [],
    current: 0,
    turn: 1,
    phase: "play",
    finalTurns: null,
    log: [],
  };
  S.market = S.marketDeck.splice(-UC_CONFIG.marketSize);
  history = [];
  ui = {};
  busy = false;
  spireAtTurn = {};
  log(`— Game starts. ${nm(0)} goes first. —`);
  render();
}

/* ---------- render ---------- */

function actingPlayer() {
  if (ui.player != null) return ui.player;
  return S.phase === "play" ? S.current : null;
}

function renderStatus() {
  if (S.phase === "end") return ($("status").innerHTML = renderResults());
  let s = `Turn ${S.turn} · ${nm(S.current)} to play`;
  if (S.finalTurns != null) s += ` · final turns left: ${S.finalTurns}`;
  $("status").innerHTML = s;
}

function renderResults() {
  const rank = S.players
    .map((x, q) => ({ q, lo: Math.min(x.cit, x.out), hi: Math.max(x.cit, x.out) }))
    .sort((a, b) => b.lo - a.lo || b.hi - a.hi);
  const rows = rank.map((r) => `<tr><td>${nm(r.q)}</td><td>${r.lo}</td><td>${P(r.q).cit}</td><td>${P(r.q).out}</td></tr>`).join("");
  return `<b>Game over.</b> Score = lower Spire token; tie → higher Citizen.
    <table class="results"><tr><th>Player</th><th>Score</th><th>Citizen</th><th>Outcast</th></tr>${rows}</table>`;
}

function cardHtml(id, attrs = "", live = false) {
  const c = CARDS[id];
  return `<div class="card ${live ? "live" : ""}" ${attrs}><h3>${c.name}${c.cost ? `<span class="cost">−${c.cost}</span>` : ""}</h3><p>${c.text}</p></div>`;
}

function renderMarket() {
  $("market-count").textContent = `· deck ${S.marketDeck.length}`;
  $("market").innerHTML = S.market.map((id) => cardHtml(id)).join("");
}

function renderBoard() {
  const lines = [];
  UC_ADJ.forEach((adj, l) =>
    adj.forEach((a) => {
      if (a > l) lines.push(`<line x1="${LOC(l).x}" y1="${LOC(l).y}" x2="${LOC(a).x}" y2="${LOC(a).y}"/>`);
    }),
  );
  const locs = S.locs
    .map((cubes, l) => {
      const d = LOC(l);
      const c = controller(l);
      const live = ui.kind === "loc" && ui.ok(l);
      const chips = S.players
        .map((x, q) => {
          if (!cubes[q]) return "";
          const cl = ui.kind === "cube" && ui.ok(l, q);
          return `<span class="chip ${cl ? "live" : ""}" style="background:${x.color}" data-cube="${l},${q}" title="${esc(x.name)}">${cubes[q]}</span>`;
        })
        .join("");
      const border = c != null ? `border-color:${P(c).color};` : "";
      const bonus = { buy: "Buy on Regroup", trash: "Scrap on Regroup", reserve: "+1 reserve on Regroup" }[d.bonus];
      const gain = d.side === "S" ? bonus : `${SIDE[d.side]} +1`;
      return `<div class="loc ${d.side} ${live ? "live" : ""} ${c != null ? "ctrl" : ""}" data-loc="${l}" style="left:${d.x - 105}px;top:${d.y - 45}px;${border}">
        <div class="loc-head"><b>${d.name}</b></div>
        <div class="loc-gain ${d.side}">${gain}</div>
        <div class="chips">${chips}</div></div>`;
    })
    .join("");
  $("board").innerHTML = `<svg viewBox="0 0 760 540">${lines.join("")}</svg>${locs}`;
}

// Spire positions at the start of each turn, so tokens that moved during the previous or current
// turn can be highlighted with how far they went.
let spireAtTurn = {};

function renderSpire() {
  const top = UC_CONFIG.spireTop;
  const pos = S.players.map((x) => ({ C: x.cit, O: x.out }));
  if (!spireAtTurn[S.turn]) spireAtTurn[S.turn] = pos;
  const base = spireAtTurn[S.turn - 1] || spireAtTurn[S.turn];
  const tok = (x, q, side) => {
    const d = pos[q][side] - base[q][side];
    const delta = d ? `<span class="delta" style="color:${x.color}">${d > 0 ? "+" : "−"}${Math.abs(d)}</span>` : "";
    return `<i class="tok ${side} ${d ? "moved" : ""}" style="background:${x.color}" title="${esc(x.name)} ${SIDE[side]}"></i>${delta}`;
  };
  let rows = "";
  for (let v = top; v >= 0; v--) {
    const toks = S.players.flatMap((x, q) => [x.cit === v ? tok(x, q, "C") : "", x.out === v ? tok(x, q, "O") : ""]).join("");
    rows += `<div class="sp-row ${v % 5 ? "" : "five"}"><b>${v}</b>${toks}</div>`;
  }
  $("spire").innerHTML = rows;
}

function renderPlayers() {
  const a = actingPlayer();
  const canPlay = S.phase === "play" && !busy;
  $("players").innerHTML = S.players
    .map((x, q) => {
      const g = projected(q);
      const live = canPlay && q === S.current;
      const hand =
        q === S.current && S.phase === "play"
          ? `<div class="hand">${x.hand.map((id, i) => cardHtml(id, `data-hand="${i}"`, live)).join("")}</div>`
          : `<div class="played-row"><span class="mini-label">Hand</span>${x.hand.map((id) => `<span class="played">${CARDS[id].name}</span>`).join("")}</div>`;
      const played = x.played.map((id) => `<span class="played">${CARDS[id].name}</span>`).join("");
      return `<div class="player ${q === a ? "active" : ""}" style="border-left-color:${x.color}">
        <h3><span style="color:${x.color}">${esc(x.name)}</span><small>reserve ${x.reserve} · stock ${x.stock}</small></h3>
        <div class="score">Citizen <b>${x.cit}</b> · Outcast <b>${x.out}</b> <em>next Regroup: +${g.C} / +${g.O}</em></div>
        ${hand}
        ${played ? `<div class="played-row"><span class="mini-label">Played</span>${played}</div>` : ""}</div>`;
    })
    .join("");
}

function renderPrompt() {
  let msg = "";
  let buttons = "";
  if (ui.kind) {
    msg = (ui.player != null ? `${nm(ui.player)}: ` : "") + ui.msg;
    if (ui.kind === "btn") {
      buttons = ui.buttons.map((b, i) => `<button class="btn" data-btn="${i}">${esc(b.label)}${b.sub ? `<small>${b.sub}</small>` : ""}</button>`).join("");
    }
    if (ui.skip) buttons += `<button class="btn" data-skip>Done / skip</button>`;
  } else if (S.phase === "play") {
    if (P(S.current).hand.length) msg = `${nm(S.current)}: play a card from your hand.`;
    else {
      msg = `${nm(S.current)}: your hand is empty — this turn you Regroup.`;
      buttons = `<button class="btn primary" data-regroup>Regroup</button>`;
    }
  } else if (S.phase === "end") {
    msg = "Game over.";
  }
  buttons += `<button class="btn" data-undo ${history.length ? "" : "disabled"}>Undo</button>`;
  $("prompt").innerHTML = `<div class="msg">${msg}</div>${buttons}`;
}

function render() {
  renderStatus();
  renderMarket();
  renderBoard();
  renderSpire();
  renderPlayers();
  renderPrompt();
  $("log").innerHTML = S.log.map((m) => `<li>${m}</li>`).join("");
}

/* ---------- events ---------- */

document.addEventListener("click", (e) => {
  if (!S) return;
  const t = e.target.closest("[data-regroup],[data-hand],[data-loc],[data-cube],[data-btn],[data-skip],[data-undo]");
  if (!t) return;
  if (t.dataset.undo !== undefined) return undo();
  if (t.dataset.regroup !== undefined) return regroupTurn();
  if (t.dataset.hand !== undefined) return t.classList.contains("live") && playCard(+t.dataset.hand);
  if (t.dataset.skip !== undefined && ui.skip) return settle(null);
  if (t.dataset.btn !== undefined && ui.kind === "btn") return settle(ui.buttons[+t.dataset.btn].value);
  if (t.dataset.cube !== undefined && ui.kind === "cube") {
    const [l, q] = t.dataset.cube.split(",").map(Number);
    if (ui.ok(l, q)) return settle({ l, q });
  }
  const locEl = e.target.closest("[data-loc]");
  if (locEl && ui.kind === "loc" && ui.ok(+locEl.dataset.loc)) settle(+locEl.dataset.loc);
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
