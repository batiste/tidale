// Banners: Simple hot-seat table. Rules run in engine.js; this file only draws S and forwards choices.
// Styles come from ../play.css (shared with the full game's table).

const COLORS = ["#e0a030", "#4fb8c8", "#d8669e", "#8cc04a", "#c9ced2"];
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const color = (p) => COLORS[p];
const pawnHtml = (p, ch) => `<span class="pawn ${ch}" style="background:${color(p)}" title="${esc(nm(S, p))}'s ${CHAR_NAME[ch]}"><span>${ch === "cit" ? "C" : "O"}</span></span>`;

let S = null;
let botTimer = null;
let heard = 0; // log lines already turned into sound

// ---------- drawing ----------

function render() {
  const p = S.pending?.player;
  $("status").innerHTML = S.phase === "over"
    ? `Game over: <b>${esc(nm(S, S.winner))}</b> wins.`
    : `Turn ${S.turn + 1} · <span class="who" style="background:${color(p)}"></span><b>${esc(nm(S, p))}</b> to decide.`;
  let spire = "";
  for (let h = SB.spire; h >= 1; h--) spire += `<div class="sp-row"><b>${h}</b>${S.players.flatMap((P, q) => ["cit", "out"].filter((ch) => P[ch] === h).map((ch) => pawnHtml(q, ch))).join("")}</div>`;
  $("spire").innerHTML = spire;
  const live = S.task?.tandem ? [col(S.task.l)] : [];
  $("city").innerHTML = [0, 1, 2, 3].map(site).join("")
    + COLUMNS.map((_, c) => `<div class="tandem ${live.includes(c) ? "live" : ""}"><span>⇅</span><p>Tandem</p></div>`).join("")
    + [4, 5, 6, 7].map(site).join("");
  renderPlayers();
  SFX.fromLog(S.log.slice(heard));
  heard = S.log.length;
  const logEl = $("log");
  logEl.innerHTML = S.log.map((m) => `<div class="${m.startsWith("Turn") ? "turn" : m.startsWith("—") ? "event" : ""}">${esc(m)}</div>`).join("");
  logEl.scrollTop = logEl.scrollHeight;
  renderPrompt();
}

function site(l) {
  const c = controller(S, l);
  const pawns = S.players.flatMap((P, q) => ["cit", "out"].filter((ch) => P.pos[ch] === l).map((ch) => pawnHtml(q, ch)));
  const cubes = S.inf[l].map((n, q) => (n ? `<span class="cube" style="background:${color(q)}" title="${esc(nm(S, q))}">${n}</span>` : "")).join("");
  return `<div class="site ${isHigh(l) ? "high" : "low"} ${c >= 0 ? "ctrl" : ""}" style="--ctrl:${c >= 0 ? color(c) : "transparent"}">
    <div class="site-head">${banner(S.banner[l])}<b>${locName(l)}</b></div>
    <div class="pawns">${pawns.join("")}</div>
    <div class="cubes">${cubes}${c >= 0 ? `<span class="ctrl-tag" title="Control">⚑ ${esc(nm(S, c))}</span>` : ""}</div>
  </div>`;
}

function renderPlayers() {
  $("players").innerHTML = S.players.map((P, p) => {
    const totals = P.out_ ? P.parts : bannerTotals(S, p);
    const chars = ["cit", "out"].map((ch, i) => `<span>${banner(P.factions[i])} <b>${FACTION[P.factions[i]].name}</b> <em>${CHAR_NAME[ch]} · total ${totals[i]}</em></span>`).join("");
    return `<div class="player ${S.pending?.player === p ? "active" : ""}" style="border-left-color:${color(p)}">
      <h3>${esc(P.name)}${P.out_ ? " · out" : ""} <small>${P.bot ? `bot${P.style != null ? ` · ${STYLES[P.style].name}` : ""}` : "human"}</small></h3>
      <div class="chars">${chars}</div>
      <div class="meta">Spire <b>${P.cit}</b> / <b>${P.out}</b> · time <b>${spent(S, p)}</b> · supply <b>${P.supply}</b> · score <b>${Math.min(...totals)}</b>${P.out_ ? " (final)" : ""}</div>
    </div>`;
  }).join("");
}

function renderPrompt() {
  const el = $("prompt");
  if (!S.pending) {
    el.innerHTML = S.phase === "over" ? `<div class="msg">Game over: <b>${esc(nm(S, S.winner))}</b> wins.</div><button class="btn" id="show-victory" type="button">Show results</button>` : "";
    if (S.phase === "over") {
      $("show-victory").onclick = showVictory;
      if (!S.victoryShown) { S.victoryShown = true; showVictory(); }
    }
    return;
  }
  const { player: p, prompt, options } = S.pending;
  const who = `<span class="who" style="background:${color(p)}"></span><b>${esc(nm(S, p))}</b>`;
  if (pl(S, p).bot) {
    el.innerHTML = `<div class="msg">${who} is thinking… <small>${esc(prompt)}</small></div>`;
    scheduleBot();
    return;
  }
  const groups = new Map();
  options.forEach((o, i) => {
    const g = o.group || "";
    if (!groups.has(g)) groups.set(g, []);
    const label = o.v?.f ? `${banner(o.v.f)} Raise ${FACTION[o.v.f].name}` : esc(o.label);
    groups.get(g).push(`<button class="btn ${o.v?.f ? "flag" : ""}" data-i="${i}" type="button">${label}</button>`);
  });
  el.innerHTML = `<div class="msg">${who}: ${esc(prompt)}</div>`
    + [...groups].map(([g, btns]) => (g ? `<div class="opt-group"><em>${esc(g)}</em>${btns.join("")}</div>` : btns.join(""))).join("");
  el.querySelectorAll("[data-i]").forEach((b) => (b.onclick = () => { choose(S, +b.dataset.i); render(); }));
}

function showVictory() {
  const W = pl(S, S.winner);
  const rows = S.players.map((P, p) => ({ P, p })).sort((a, b) => b.P.score - a.P.score)
    .map(({ P, p }) => `<tr><td><span class="who" style="background:${color(p)}"></span>${esc(P.name)}</td><td>${P.factions.map((f, i) => `${banner(f)} ${P.parts[i]}`).join(" ")}</td><td><b>${P.score}</b></td></tr>`);
  $("victory-body").innerHTML = `<div class="victory-head">${W.factions.map((f) => banner(f, "bn-xl")).join("")}<div><h2>${esc(W.name)} wins</h2><p>Each player scored their weaker banner when they went out.</p></div></div>
    <table class="results"><thead><tr><th>Player</th><th>Banner totals</th><th>Score</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
  $("victory").showModal();
}

function scheduleBot() {
  clearTimeout(botTimer);
  botTimer = setTimeout(() => {
    if (!S.pending || !pl(S, S.pending.player).bot) return;
    choose(S, botChoose(S));
    render();
  }, +$("speed").value);
}

// ---------- setup ----------

function setupRows() {
  const n = +$("setup-count").value;
  const prev = [...document.querySelectorAll(".setup-player")].map((r) => ({ name: r.querySelector("input").value, bot: r.querySelector("select").value === "bot" }));
  $("setup-players").innerHTML = Array.from({ length: n }, (_, i) => {
    const d = prev[i] || { name: `Player ${i + 1}`, bot: i > 0 };
    return `<div class="setup-player"><i style="background:${color(i)}"></i><span><input value="${esc(d.name)}" /> <select><option value="human" ${d.bot ? "" : "selected"}>Human</option><option value="bot" ${d.bot ? "selected" : ""}>Bot</option></select></span></div>`;
  }).join("");
}
function openSetup() {
  setupRows();
  $("setup").showModal();
}
function start(players) {
  clearTimeout(botTimer);
  S = newGame(players);
  heard = S.log.length;
  render();
}

$("setup-count").onchange = setupRows;
$("setup").addEventListener("close", () => {
  if ($("setup").returnValue !== "start") { if (!S) openSetup(); return; }
  start([...document.querySelectorAll(".setup-player")].map((r) => ({ name: r.querySelector("input").value.trim() || "Player", bot: r.querySelector("select").value === "bot" })));
});
$("victory").addEventListener("close", () => $("victory").returnValue === "new" && openSetup());
$("new-game").onclick = openSetup;
const soundLabel = () => ($("sound").textContent = SFX.muted ? "Sound off" : "Sound on");
$("sound").onclick = () => { SFX.toggle(); soundLabel(); };
soundLabel();
$("copy-log").onclick = async () => {
  await navigator.clipboard.writeText(S.log.join("\n"));
  $("copy-log").textContent = "Copied";
  setTimeout(() => ($("copy-log").textContent = "Copy log"), 1200);
};
// play.html?demo: 3 bots, to watch a game (and for screenshots).
if (location.search.includes("demo")) start([1, 2, 3].map((i) => ({ name: `Bot ${i}`, bot: true })));
else openSetup();
