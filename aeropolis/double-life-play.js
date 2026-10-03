"use strict";

// Hot-seat engine for Double Life. Rules: double-life.html. Data: double-life-data.js.
// Every action runs as an async coroutine that awaits board/button picks; Undo restores the
// snapshot taken before the current (or last) action and aborts any pending pick.

const COLORS = ["#e07a5a", "#6fa8e0", "#e0c25a", "#b08ae8"];
const SIDE = { C: "Citizen", O: "Outcast", S: "Shared" };
const ABORT = Symbol("abort");
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const byId = (list, id) => list.find((x) => x.id === id);

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
const LOC = (l) => DL_LOCATIONS[l];
const nm = (i) => `<b style="color:${P(i).color}">${esc(P(i).name)}</b>`;
function log(msg) {
  S.log.unshift(`R${S.round} · ${msg}`);
}

/* ---------- control & scoring ---------- */

function controller(l) {
  let best = 0, who = null, tie = false;
  S.locs[l].cubes.forEach((n, q) => {
    if (n > best) { best = n; who = q; tie = false; }
    else if (n === best && n > 0) tie = true;
  });
  return tie ? null : who;
}

function projected(q) {
  const g = { C: 0, O: 0 };
  S.locs.forEach((_, l) => {
    if (controller(l) !== q) return;
    const pts = DL_CONTROL[LOC(l).side];
    g.C += pts.C;
    g.O += pts.O;
  });
  return g;
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
  const full = (l, q) => S.locs[l].cubes[q] > 0 && ok(l, q);
  if (!S.locs.some((_, l) => S.players.some((_, q) => full(l, q)))) return Promise.resolve(null);
  return ask({ kind: "cube", msg, ok: full, ...opts });
}

/* ---------- actions ---------- */

async function recruit(p) {
  if (!P(p).reserve) return log(`${nm(p)} has no cubes in reserve.`);
  const l = await pickLoc("Recruit: choose a location with a resident.", (l) => S.locs[l].res > 0, { player: p, skip: true });
  if (l == null) return log(`${nm(p)}: Recruit had no effect.`);
  const loc = S.locs[l];
  const n = Math.min(DL_CONFIG.recruitCount, loc.res, P(p).reserve);
  const placed =
    n > 1
      ? await ask({
          kind: "btn",
          msg: `Recruit how many at ${LOC(l).name}?`,
          buttons: Array.from({ length: n }, (_, i) => ({ label: String(n - i), value: n - i })),
          player: p,
        })
      : n;
  loc.res -= placed;
  loc.cubes[p] += placed;
  P(p).reserve -= placed;
  log(`${nm(p)} recruits ${placed} at ${LOC(l).name}.`);
}

async function move(p) {
  const arrived = {};
  let done = 0;
  for (let i = 0; i < 2; i++) {
    const c = await pickCube(`Move ${i + 1}/2: choose one of your cubes, or Done.`, (l, q) => q === p && S.locs[l].cubes[p] > (arrived[l] || 0), {
      player: p,
      skip: true,
    });
    if (!c) break;
    const d = await pickLoc(`Move it from ${LOC(c.l).name} to an adjacent location.`, (a) => DL_ADJ[c.l].includes(a), { player: p });
    S.locs[c.l].cubes[p]--;
    S.locs[d].cubes[p]++;
    arrived[d] = (arrived[d] || 0) + 1;
    log(`${nm(p)} moves ${LOC(c.l).name} → ${LOC(d).name}.`);
    done++;
  }
  if (!done) log(`${nm(p)}: Move had no effect.`);
}

async function agitate(p) {
  const c = await pickCube("Agitate: choose an opponent cube at a location where you have a cube.", (l, q) => q !== p && S.locs[l].cubes[p] > 0, {
    player: p,
    skip: true,
  });
  if (!c) return log(`${nm(p)}: Agitate had no effect.`);
  const d = await pickLoc(`Push ${esc(P(c.q).name)}'s cube to an adjacent location.`, (a) => DL_ADJ[c.l].includes(a), { player: p });
  S.locs[c.l].cubes[c.q]--;
  S.locs[d].cubes[c.q]++;
  log(`${nm(p)} pushes ${nm(c.q)} ${LOC(c.l).name} → ${LOC(d).name}.`);
}

async function seize(p) {
  const c = await pickCube("Seize: choose an opponent cube where you have more cubes than them.", (l, q) => q !== p && S.locs[l].cubes[p] > S.locs[l].cubes[q], {
    player: p,
    skip: true,
  });
  if (!c) return log(`${nm(p)}: Seize had no effect.`);
  S.locs[c.l].cubes[c.q]--;
  P(c.q).reserve++;
  log(`${nm(p)} seizes ${nm(c.q)}'s cube at ${LOC(c.l).name}.`);
}

const ACTION_FX = { recruit, move, agitate, seize };

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
  kick();
}

function undo() {
  if (!history.length) return;
  const reject = ui.reject;
  ui = {};
  S = JSON.parse(history.pop());
  busy = false;
  if (reject) reject(ABORT);
  kick();
}

// Starts whatever step the state calls for; row clicks drive the play phase.
function kick() {
  if (!busy && S.phase === "setup") {
    guarded(async () => {
      const p = S.setupQueue[0];
      log(`${nm(p)} places starting cubes.`);
      await recruit(p);
      S.setupQueue.shift();
      if (!S.setupQueue.length) newRound();
    });
    return;
  }
  render();
}

function takeAction(i) {
  if (busy || S.phase !== "play") return;
  guarded(async () => {
    const p = S.current;
    const id = S.row.splice(i, 1)[0];
    P(p).taken++;
    log(`${nm(p)} takes <b>${byId(DL_ACTIONS, id).name}</b>.`);
    await ACTION_FX[id](p);
    if (S.actDeck.length) S.row.splice(i, 0, S.actDeck.pop());
    endTurn(p);
  });
}

function endTurn(p) {
  const max = DL_CONFIG.actionsPerPlayer;
  if (S.players.every((x) => x.taken >= max)) return cleanup();
  let q = p;
  do q = (q + 1) % S.players.length;
  while (P(q).taken >= max);
  S.current = q;
}

function newRound() {
  S.round++;
  S.phase = "play";
  S.actDeck = shuffle(DL_ACTIONS.flatMap((a) => Array(a.copies).fill(a.id)));
  S.row = S.actDeck.splice(-DL_CONFIG.rowSize);
  S.players.forEach((x) => (x.taken = 0));
  S.current = S.first;
  log(`— Round ${S.round} begins. ${nm(S.first)} goes first. —`);
}

function cleanup() {
  S.players.forEach((_, q) => {
    const g = projected(q);
    P(q).cit += g.C;
    P(q).out += g.O;
    log(`${nm(q)} scores control: Citizen +${g.C}, Outcast +${g.O}.`);
  });
  S.locs.forEach((loc, l) => (loc.res = LOC(l).residents));
  if (S.round >= DL_CONFIG.rounds) {
    S.phase = "end";
    log("— Game over. —");
    return;
  }
  S.first = (S.first + 1) % S.players.length;
  newRound();
}

function startGame(names) {
  const n = names.length;
  S = {
    players: names.map((name, i) => ({ name, color: COLORS[i], reserve: DL_CONFIG.reserve, cit: 0, out: 0, taken: 0 })),
    locs: DL_LOCATIONS.map((l) => ({ res: l.residents, cubes: Array(n).fill(0) })),
    actDeck: [],
    row: [],
    round: 0,
    first: 0,
    current: 0,
    phase: "setup",
    setupQueue: names.map((_, i) => n - 1 - i),
    log: [],
  };
  history = [];
  ui = {};
  busy = false;
  kick();
}

/* ---------- render ---------- */

function actingPlayer() {
  if (ui.player != null) return ui.player;
  if (S.phase === "setup") return S.setupQueue[0];
  return S.phase === "play" ? S.current : null;
}

function renderStatus() {
  if (S.phase === "end") return ($("status").innerHTML = renderResults());
  let s = `Round ${Math.max(S.round, 1)}/${DL_CONFIG.rounds}`;
  if (S.phase === "setup") s += " · Setup: each player takes a free Recruit, last player first";
  else s += ` · ${nm(S.current)} — action ${Math.min(P(S.current).taken + (busy ? 0 : 1), DL_CONFIG.actionsPerPlayer)}/${DL_CONFIG.actionsPerPlayer}`;
  $("status").innerHTML = s;
}

function renderResults() {
  const rank = S.players
    .map((x, q) => ({ q, lo: Math.min(x.cit, x.out), hi: Math.max(x.cit, x.out) }))
    .sort((a, b) => b.lo - a.lo || b.hi - a.hi);
  const rows = rank.map((r) => `<tr><td>${nm(r.q)}</td><td>${r.lo}</td><td>${P(r.q).cit}</td><td>${P(r.q).out}</td></tr>`).join("");
  return `<b>Game over.</b> Score = lower Spire token; tie → higher other token.
    <table class="results"><tr><th>Player</th><th>Score</th><th>Citizen</th><th>Outcast</th></tr>${rows}</table>`;
}

function renderRow() {
  $("deck-count").textContent = S.phase === "play" ? `· deck ${S.actDeck.length}` : "";
  const live = S.phase === "play" && !busy;
  $("row").innerHTML = S.row
    .map((id, i) => {
      const a = byId(DL_ACTIONS, id);
      return `<button class="action ${live ? "live" : ""}" data-row="${i}" ${live ? "" : "disabled"}><h3>${a.name}</h3><p>${a.text}</p></button>`;
    })
    .join("");
}

function controlText(side) {
  const pts = DL_CONTROL[side];
  return ["C", "O"]
    .filter((h) => pts[h])
    .map((h) => `${SIDE[h]} +${pts[h]}`)
    .join(" · ");
}

function renderBoard() {
  const lines = [];
  DL_ADJ.forEach((adj, l) =>
    adj.forEach((a) => {
      if (a > l) lines.push(`<line x1="${LOC(l).x}" y1="${LOC(l).y}" x2="${LOC(a).x}" y2="${LOC(a).y}"/>`);
    }),
  );
  const locs = S.locs
    .map((loc, l) => {
      const d = LOC(l);
      const c = controller(l);
      const live = ui.kind === "loc" && ui.ok(l);
      const chips = S.players
        .map((x, q) => {
          const n = loc.cubes[q];
          if (!n) return "";
          const cl = ui.kind === "cube" && ui.ok(l, q);
          return `<span class="chip ${cl ? "live" : ""}" style="background:${x.color}" data-cube="${l},${q}" title="${esc(x.name)}">${n}</span>`;
        })
        .join("");
      const border = c != null ? `border-color:${P(c).color};` : "";
      return `<div class="loc ${d.side} ${live ? "live" : ""} ${c != null ? "ctrl" : ""}" data-loc="${l}" style="left:${d.x - 105}px;top:${d.y - 45}px;${border}">
        <div class="loc-head"><b>${d.name}</b><span class="res">${"<i></i>".repeat(loc.res)}</span></div>
        <div class="loc-gain ${d.side}">${controlText(d.side)}</div>
        <div class="chips">${chips}</div></div>`;
    })
    .join("");
  $("board").innerHTML = `<svg viewBox="0 0 760 540">${lines.join("")}</svg>${locs}`;
}

function renderSpire() {
  const max = DL_CONFIG.spireMax;
  const tok = (x, side) => `<i class="tok ${side}" style="background:${x.color}" title="${esc(x.name)} ${SIDE[side]}"></i>`;
  let rows = "";
  for (let v = max; v >= 0; v--) {
    const toks = S.players.flatMap((x) => [Math.min(x.cit, max) === v ? tok(x, "C") : "", Math.min(x.out, max) === v ? tok(x, "O") : ""]).join("");
    rows += `<div class="sp-row ${v % 5 ? "" : "five"}"><b>${v === max ? max + "+" : v}</b>${toks}</div>`;
  }
  $("spire").innerHTML = rows;
}

function renderPlayers() {
  const a = actingPlayer();
  $("players").innerHTML = S.players
    .map((x, q) => {
      const g = projected(q);
      return `<div class="player ${q === a ? "active" : ""}" style="border-left-color:${x.color}">
        <h3><span style="color:${x.color}">${esc(x.name)}</span>
          <small>reserve ${x.reserve} · actions ${x.taken}/${DL_CONFIG.actionsPerPlayer}</small></h3>
        <div class="score">Citizen <b>${x.cit}</b> <em>+${g.C}</em> · Outcast <b>${x.out}</b> <em>+${g.O}</em></div></div>`;
    })
    .join("");
}

function renderPrompt() {
  let msg = "";
  let buttons = "";
  if (ui.kind) {
    msg = (ui.player != null ? `${nm(ui.player)}: ` : "") + ui.msg;
    if (ui.kind === "btn") buttons = ui.buttons.map((b, i) => `<button class="btn" data-btn="${i}">${esc(b.label)}</button>`).join("");
    if (ui.skip) buttons += `<button class="btn" data-skip>Done / skip</button>`;
  } else if (S.phase === "play") {
    msg = `${nm(S.current)}: take an action from the row.`;
  } else if (S.phase === "end") {
    msg = "Game over.";
  }
  buttons += `<button class="btn" data-undo ${history.length ? "" : "disabled"}>Undo</button>`;
  $("prompt").innerHTML = `<div class="msg">${msg}</div>${buttons}`;
}

function render() {
  renderStatus();
  renderRow();
  renderBoard();
  renderSpire();
  renderPlayers();
  renderPrompt();
  $("log").innerHTML = S.log.map((m) => `<li>${m}</li>`).join("");
}

/* ---------- events ---------- */

document.addEventListener("click", (e) => {
  if (!S) return;
  const t = e.target.closest("[data-row],[data-loc],[data-cube],[data-btn],[data-skip],[data-undo]");
  if (!t) return;
  if (t.dataset.undo !== undefined) return undo();
  if (t.dataset.row !== undefined) return takeAction(+t.dataset.row);
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
