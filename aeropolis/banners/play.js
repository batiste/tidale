// Banners hot-seat table. Rules run in engine.js; this file only draws S and forwards choices.

const COLORS = ["#e0a030", "#4fb8c8", "#d8669e", "#8cc04a", "#c9ced2"];
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const color = (p) => COLORS[p];
const pawnHtml = (p, ch) => `<span class="pawn ${ch}" style="background:${color(p)}" title="${esc(nm(S, p))}'s ${CHAR_NAME[ch]}"><span>${ch === "cit" ? "C" : "O"}</span></span>`;

let S = null;
let botTimer = null;
let openGroup = null; // two-step choices: the group the human opened

// ---------- drawing ----------

function render() {
  const p = S.pending?.player;
  $("status").innerHTML = S.phase === "over"
    ? `Game over: <b>${esc(nm(S, S.winner))}</b> wins.`
    : `Turn ${S.turn + 1} · <span class="who" style="background:${color(p)}"></span><b>${esc(nm(S, p))}</b> to decide.`;
  $("phase").textContent = "Citizens High, Outcasts Low";
  renderSpire();
  renderCity();
  $("reserve").innerHTML = FACTIONS.map((f) => `<span>${banner(f.id)} ×${S.reserve[f.id]}</span>`).join("");
  renderPlayers();
  const logEl = $("log");
  logEl.innerHTML = S.log.map((m) => `<div class="${m.startsWith("Turn") ? "turn" : m.startsWith("—") ? "event" : ""}">${esc(m)}</div>`).join("");
  logEl.scrollTop = logEl.scrollHeight;
  renderPrompt();
}

function renderSpire() {
  let html = "";
  for (let h = BN_CONFIG.spire; h >= 1; h--) {
    const toks = S.players.flatMap((P, p) => ["cit", "out"].filter((ch) => P[ch] === h).map((ch) => pawnHtml(p, ch)));
    html += `<div class="sp-row"><b>${h}</b>${toks.join("")}</div>`;
  }
  $("spire").innerHTML = html;
}

function site(l) {
  const L = locOf(l);
  const c = controller(S, l);
  const pawns = S.players.flatMap((P, p) => ["cit", "out"].filter((ch) => P.pos[ch] === l).map((ch) => pawnHtml(p, ch)));
  const cubes = S.inf[l].map((n, p) => (n ? `<span class="cube" style="background:${color(p)}" title="${esc(nm(S, p))}">${n}</span>` : "")).join("");
  return `<div class="site ${isHigh(l) ? "high" : "low"} ${c >= 0 ? "ctrl" : ""}" style="--ctrl:${c >= 0 ? color(c) : "transparent"}">
    <div class="site-head">${banner(S.banner[l])}<div><b>${L.name} ${time(L.cost)}</b><small><strong>${L.action}:</strong> ${L.text}</small></div></div>
    <div class="pawns">${pawns.join("")}</div>
    <div class="cubes">${cubes}${c >= 0 ? `<span class="ctrl-tag">controlled by ${esc(nm(S, c))}</span>` : ""}</div>
  </div>`;
}

function renderCity() {
  const live = S.pending ? tandemCols(S, S.pending.player) : []; // tandems the deciding player has set up
  $("city").innerHTML = [0, 1, 2, 3].map(site).join("")
    + COLUMNS.map((c, i) => `<div class="tandem ${live.includes(i) ? "live" : ""}"><span>⇅</span><p><strong>${c.tandem.name}:</strong> ${c.tandem.text}</p></div>`).join("")
    + [4, 5, 6, 7].map(site).join("");
}

function renderPlayers() {
  $("players").innerHTML = S.players.map((P, p) => {
    const chars = P.chars.map((id) => {
      const c = CHAR_BY_ID[id];
      return `<span title="${esc(c.text)}">${banner(c.faction)} <b>${c.name}</b> <em>${CHAR_NAME[c.char]} · ${esc(c.text)}</em></span>`;
    }).join("");
    return `<div class="player ${S.pending?.player === p ? "active" : ""}" style="border-left-color:${color(p)}">
      <h3>${esc(P.name)}${P.out_ ? " · out" : ""} <small>${P.bot ? `bot${P.style != null ? ` · ${STYLES[P.style].name}` : ""}` : "human"}</small></h3>
      <div class="chars">${chars}</div>
      <div class="meta">Spire <b>${P.cit}</b> / <b>${P.out}</b> · time <b>${spent(S, p)}</b> · supply <b>${P.supply}</b> · score <b>${P.out_ && BN_CONFIG.end.freeze ? `${P.score} (final)` : points(S, p)}</b></div>
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
  // Banner choices ({ l, f }) show the coloured banners: the location's current one in the group title, the new one on each button.
  const groups = new Map();
  options.forEach((o, i) => {
    const g = o.group || "";
    const flag = o.v?.f != null;
    if (!groups.has(g)) groups.set(g, { title: esc(g) + (flag ? ` ${banner(S.banner[o.v.l])} →` : ""), btns: [] });
    const label = flag ? `${banner(o.v.f)} ${FACTION[o.v.f].name}` : esc(o.label);
    groups.get(g).btns.push(`<button class="btn ${flag ? "flag" : ""}" data-i="${i}" type="button">${label}</button>`);
  });
  // Long choices go in two steps: first the group (e.g. the location), then its options.
  const named = [...groups.keys()].filter(Boolean);
  const twoStep = named.length > 1 && options.length > 8;
  if (twoStep && !groups.has(openGroup)) openGroup = null;
  let body;
  if (!twoStep) body = [...groups].map(([g, { title, btns }]) => (g ? `<div class="opt-group"><em>${title}</em>${btns.join("")}</div>` : btns.join(""))).join("");
  else if (openGroup) body = `<button class="btn" data-back type="button">← Back</button><div class="opt-group"><em>${groups.get(openGroup).title}</em>${groups.get(openGroup).btns.join("")}</div>`;
  else body = named.map((g) => `<button class="btn flag" data-g="${esc(g)}" type="button">${groups.get(g).title.replace(/ →$/, "")}</button>`).join("") + (groups.get("")?.btns.join("") || "");
  el.innerHTML = `<div class="msg">${who}: ${esc(prompt)}</div>${body}`;
  el.querySelectorAll("[data-i]").forEach((b) => (b.onclick = () => humanChoose(+b.dataset.i)));
  el.querySelectorAll("[data-g]").forEach((b) => (b.onclick = () => { openGroup = b.dataset.g; renderPrompt(); }));
  el.querySelectorAll("[data-back]").forEach((b) => (b.onclick = () => { openGroup = null; renderPrompt(); }));
}

// Victory: the winner's banners, then every player's score and where it came from.
function showVictory() {
  const W = pl(S, S.winner);
  const rows = S.players.map((P, p) => ({ P, p })).sort((a, b) => b.P.score - a.P.score)
    .map(({ P, p }) => `<tr><td><span class="who" style="background:${color(p)}"></span>${esc(P.name)}</td><td>${P.chars.map((id) => banner(CHAR_BY_ID[id].faction)).join(" ")}</td><td><b>${P.score}</b></td><td>${P.parts.map(([l, n]) => `${locOf(l).name} ${n}`).join(" · ") || "—"}</td></tr>`);
  const how = "Every player's Citizen and Outcast have met: the Revolution. Each player scored when they went out.";
  $("victory-body").innerHTML = `<div class="victory-head">${W.chars.map((id) => banner(CHAR_BY_ID[id].faction, "bn-xl")).join("")}<div><h2>${esc(W.name)} wins</h2><p>${how}</p></div></div>
    <table class="results"><thead><tr><th>Player</th><th>Banners</th><th>Score</th><th>From</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
  $("victory").showModal();
}

// ---------- choices ----------

function humanChoose(i) {
  openGroup = null;
  choose(S, i);
  render();
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

$("setup-count").onchange = setupRows;
$("setup").addEventListener("close", () => {
  if ($("setup").returnValue !== "start") { if (!S) openSetup(); return; }
  const players = [...document.querySelectorAll(".setup-player")].map((r) => ({ name: r.querySelector("input").value.trim() || "Player", bot: r.querySelector("select").value === "bot" }));
  clearTimeout(botTimer);
  S = newGame(players);
  render();
});
$("new-game").onclick = openSetup;
$("victory").addEventListener("close", () => $("victory").returnValue === "new" && openSetup());
// The log in reading order, as plain text (for pasting into an analysis).
$("copy-log").onclick = async () => {
  await navigator.clipboard.writeText(S.log.join("\n"));
  $("copy-log").textContent = "Copied";
  setTimeout(() => ($("copy-log").textContent = "Copy log"), 1200);
};
// play.html?demo: 4 bots, to watch a game (and for screenshots).
if (location.search.includes("demo")) {
  S = newGame([1, 2, 3, 4].map((i) => ({ name: `Bot ${i}`, bot: true })));
  render();
} else openSetup();
