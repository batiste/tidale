// Bribes & Grievances — cheap hot-seat prototype (rules: plan-2.txt). Rules, bots and drawing in one file.
// Location names come from ../banners/banners-data.js.

const CFG = {
  spire: 20, // Citizens start on 20, Outcasts on 1
  tiers: [7, 14], // heights 1–7: ×1, 8–14: ×2, 15–20: ×3
  // 15 districts per city. High City is worth more: its multiplier (your Citizen) only goes down.
  shares: { high: [2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4], low: [1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3] },
  hand: [1, 2, 3], // everyone's betting cards
  loserKeeps: false, // true: a losing bid returns to your hand; false: every played card goes to the discard
};
const COLORS = ["#e0a030", "#4fb8c8", "#d8669e", "#8cc04a", "#c9ced2"];
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const who = (p) => `<span class="who" style="background:${COLORS[p]}"></span> <b>${esc(S.players[p].name)}</b>`;
const cardName = (c) => String(c);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const CITY = { high: { name: "High City", pawn: "cit", places: COLUMNS.map((c) => c.high.name) }, low: { name: "Low City", pawn: "out", places: COLUMNS.map((c) => c.low.name) } };
const districtName = (d) => `${CITY[d.city].name} ${d.place} ${"◆".repeat(d.shares)}`;

let S = null;
let botTimer = null;

// ---------- rules ----------

const tier = (h) => 1 + CFG.tiers.filter((t) => h > t).length;

function newGame(players) {
  const first = Math.floor(Math.random() * players.length);
  S = {
    players: players.map((P, i) => ({ ...P, cit: CFG.spire, out: 1, cards: [], hand: [...CFG.hand], discard: [], profile: PROFILES[(i + Math.floor(Math.random() * PROFILES.length)) % PROFILES.length] })),
    deck: shuffle(["high", "low"].flatMap((city) => CFG.shares[city].map((shares, i) => ({ city, shares, place: CITY[city].places[i % 4] })))),
    first, auctioneer: first, revolution: false, over: false, log: [],
  };
  log(`— New game. Citizens on ${CFG.spire}, Outcasts on 1. Everyone holds betting cards 1, 2, 3. —`);
  startAuction();
}

function log(m) { S.log.push(m); }
const n = () => S.players.length;
const sharesOf = (p, city) => S.players[p].cards.filter((d) => d.city === city).reduce((t, d) => t + d.shares, 0);
// Score: High City shares × your Citizen's tier + Low City shares × your Outcast's tier.
function score(p) {
  const P = S.players[p];
  const high = sharesOf(p, "high") * tier(P.cit);
  const low = sharesOf(p, "low") * tier(P.out);
  return { high, low, total: high + low };
}
const gap = (p) => S.players[p].cit - S.players[p].out;

function startAuction() {
  if (!S.deck.length) return endGame("The deck is empty.");
  S.card = S.deck.pop();
  S.players.forEach((P) => {
    if (P.hand.length) return;
    P.hand = P.discard; // empty hand: take all your betting cards back
    P.discard = [];
    log(`  ${P.name} takes their betting cards back.`);
  });
  S.order = Array.from({ length: n() }, (_, i) => (S.auctioneer + 1 + i) % n());
  S.picks = {}; // p → hand index, or -1 (pass); hidden until everyone has chosen
  log(`Auction · ${S.players[S.auctioneer].name} reveals ${districtName(S.card)}`);
}

const toAct = () => S.order.find((p) => !(p in S.picks));

function act(p, i) {
  S.picks[p] = i;
  if (toAct() == null) resolve();
}

// Reveal: the highest card wins; between equal cards, the player closest to the auctioneer's left wins (S.order starts there).
function resolve() {
  const played = S.order.filter((p) => S.picks[p] >= 0).map((p) => ({ p, c: S.players[p].hand.splice(S.picks[p], 1)[0] }));
  log(`  Reveal: ${S.order.map((p) => `${S.players[p].name} ${S.picks[p] >= 0 ? cardName(played.find((x) => x.p === p).c) : "pass"}`).join(", ")}`);
  const top = Math.max(...played.map(({ c }) => c));
  const win = played.find(({ c }) => c === top); // played is in seat order from the auctioneer's left
  if (played.filter(({ c }) => c === top).length > 1) log(`  Tie on ${top}: ${S.players[win.p].name} is closest to the auctioneer's left.`);
  played.forEach(({ p, c }) => (CFG.loserKeeps && p !== win.p ? S.players[p].hand : S.players[p].discard).push(c));
  S.last = { card: S.card, by: win ? win.p : -1, amount: win ? win.c : 0, picks: played };
  if (!played.length) {
    log("  Nobody bids: the district burns. Every Outcast rises 1.");
    S.players.forEach((P) => (P.out = Math.min(CFG.spire, P.out + 1)));
  } else {
    const W = S.players[win.p];
    W.cit = Math.max(1, W.cit - win.c);
    W.cards.push(S.card);
    log(`  ${W.name} wins with ${win.c}: Citizen sinks to ${W.cit} (×${tier(W.cit)}).`);
    // Grievance: every player who bid and lost rises 1.
    played.filter(({ p }) => p !== win.p).forEach(({ p }) => {
      const P = S.players[p];
      P.out = Math.min(CFG.spire, P.out + 1);
      log(`  ${P.name} loses: Outcast rises to ${P.out} (×${tier(P.out)})${CFG.loserKeeps ? ", keeps their card" : ""}.`);
    });
  }
  log(`  Scores: ${S.players.map((P, q) => `${P.name} ${score(q).total}`).join(" · ")}`);
  if (!S.revolution) {
    const m = S.players.findIndex((P) => P.out >= P.cit);
    if (m >= 0) {
      S.revolution = true;
      log(`— ${S.players[m].name}'s Citizen and Outcast meet: Revolution! The round is finished, then the game ends. —`);
    }
  }
  S.auctioneer = (S.auctioneer + 1) % n();
  if (S.revolution && S.auctioneer === S.first) return endGame("The round is over.");
  startAuction();
}

function endGame(why) {
  S.over = true;
  S.card = null;
  S.ranked = S.players.map((_, p) => p).sort((a, b) => score(b).total - score(a).total || S.players[b].cit - S.players[a].cit); // tie: highest Citizen
  S.winner = S.ranked[0];
  log(`— ${why} —`);
  S.ranked.forEach((p) => {
    const P = S.players[p];
    const s = score(p);
    log(`  ${P.name}: ${s.total} = High City ${sharesOf(p, "high")} × ${tier(P.cit)} (Citizen ${P.cit}) + Low City ${sharesOf(p, "low")} × ${tier(P.out)} (Outcast ${P.out})`);
  });
  log(`— ${S.players[S.winner].name} wins with ${score(S.winner).total}. —`);
}

// ---------- bot ----------

// Profiles: bias = extra worth for High (−) or Low (+) City districts, thrift = how much a bid hurts as the Citizen runs low,
// close = lead needed before ending the game, farm = chance to bid low just to lose and rise.
const PROFILES = [
  { name: "Establishment", bias: -0.6, thrift: 1.5, close: 3, farm: 0.2 },
  { name: "Revolutionary", bias: 0.6, thrift: 0.7, close: 3, farm: 0.5 },
  { name: "Balanced", bias: 0, thrift: 1, close: 3, farm: 0.35 },
  { name: "Closer", bias: 0, thrift: 1, close: 1, farm: 0.3 },
];

// Worth to p of winning the district with a card of value c: the shares at the tier its pawn will likely end on,
// minus what the sinking Citizen takes off p's High City holdings. Pawns drift toward the middle, so expect a few steps more.
function worth(p, c) {
  const P = S.players[p];
  const pr = P.profile;
  const d = S.card;
  const citAfter = Math.max(1, P.cit - c);
  const endCit = Math.max(1, citAfter - 2), endOut = Math.min(CFG.spire, P.out + 3);
  const gain = d.shares * (d.city === "high" ? tier(endCit) : tier(endOut)) + (d.city === "high" ? -pr.bias : pr.bias);
  const loss = sharesOf(p, "high") * (tier(Math.max(1, P.cit - 2)) - tier(endCit));
  return gain - loss - c * pr.thrift * 0.3 + (Math.random() - 0.5) * 0.6;
}

// Pick a hand index (or -1): the card worth most (if worth playing), or the lowest card just to lose and rise.
// A district that would pay the leader well is worth taking from them.
function botChoose(p) {
  const P = S.players[p];
  const pr = P.profile;
  const totals = S.players.map((_, q) => score(q).total);
  const leader = totals.indexOf(Math.max(...totals));
  const L = S.players[leader];
  const deny = leader !== p && S.card.shares * tier(S.card.city === "high" ? L.cit : L.out) >= 4 ? 1.5 : 0;
  let best = -1, bestW = 0.8;
  P.hand.forEach((c, i) => {
    if (c >= gap(p)) { // winning would start the revolution: only with a lead of at least `close`
      const others = Math.max(...S.players.map((_, q) => (q === p ? -99 : score(q).total)));
      if (score(p).total + S.card.shares < others + pr.close) return;
    }
    // A higher card wins more often: weigh worth by a rough chance to win.
    const w = (worth(p, c) + deny) * Math.min(1, 0.35 + c * 0.2);
    if (w > bestW) { bestW = w; best = i; }
  });
  if (best >= 0) return best;
  // Bid the lowest card just to lose and rise (pays when Low City holdings are near a tier step).
  const low = P.hand.indexOf(Math.min(...P.hand));
  if (P.hand.length && sharesOf(p, "low") && Math.random() < pr.farm * (CFG.loserKeeps ? 1 : 0.5)) return low;
  return -1;
}

// ---------- drawing ----------

function render() {
  const p = S.over ? null : toAct();
  $("status").innerHTML = S.over ? `Game over: ${who(S.winner)} wins.` : `${who(S.auctioneer)} is the auctioneer · ${who(p)} to choose a betting card · ${S.deck.length} districts left`;
  let sp = "";
  for (let h = CFG.spire; h >= 1; h--) sp += `<div class="sp-row tier${tier(h)} ${CFG.tiers.includes(h) ? "edge" : ""}"><b>${h}</b>${S.players.flatMap((P, q) => ["cit", "out"].filter((k) => P[k] === h).map((k) => `<span class="pawn ${k}" style="background:${COLORS[q]}" title="${esc(P.name)} ${k === "cit" ? "Citizen" : "Outcast"}"></span>`)).join("")}<i>×${tier(h)}</i></div>`;
  $("spire").innerHTML = sp;
  const c = S.card;
  $("card").innerHTML = c
    ? `<div class="district ${c.city}"><small>District for sale</small><h3>${c.place}</h3><div class="shares">${"◆".repeat(c.shares)}</div><small>${CITY[c.city].name} · × your ${c.city === "high" ? "Citizen" : "Outcast"}'s tier</small></div>`
    : `<div class="district empty"><small>No auction</small><h3>—</h3></div>`;
  const L = S.last;
  $("auction").innerHTML = `<h2>${S.over ? "Final" : "Secret bids"}</h2>`
    + (S.revolution ? `<div class="revolution">Revolution! The round is finished, then the game ends.</div>` : "")
    + (S.over ? "" : `<ul class="bids">${S.order.map((q) => `<li class="${q === p ? "now" : ""}">${who(q)}${q === S.auctioneer ? " (auctioneer)" : ""}<em>${q in S.picks ? "chosen" : q === p ? "choosing…" : "—"}</em></li>`).join("")}</ul>`)
    + (L ? `<p class="deck">Last: ${esc(districtName(L.card))} — ${L.picks.length ? L.picks.map(({ p: q, c: x }) => `${esc(S.players[q].name)} ${cardName(x)}`).join(", ") : "no bids"} → ${L.by < 0 ? "burnt" : `${esc(S.players[L.by].name)} wins with ${L.amount}`}</p>` : "");
  $("players").innerHTML = S.players.map((P, q) => {
    const sc = score(q);
    const bets = `<span class="bets">${P.hand.map((x) => `<i class="bet">${cardName(x)}</i>`).join("")}${P.discard.map((x) => `<i class="bet used">${cardName(x)}</i>`).join("")}</span>`;
    return `<div class="player ${q === p ? "active" : ""}" style="border-left-color:${COLORS[q]}">
      <h3>${esc(P.name)} <small>${P.bot ? `bot · ${P.profile.name}` : "human"}</small></h3>
      <div class="portfolio"><span class="pf high">High City <b>${sharesOf(q, "high")}</b> ◆ × <b>${tier(P.cit)}</b> = ${sc.high}</span><span class="pf low">Low City <b>${sharesOf(q, "low")}</b> ◆ × <b>${tier(P.out)}</b> = ${sc.low}</span></div>
      <div class="row">${bets}</div>
      <div class="meta">Citizen <b>${P.cit}</b> · Outcast <b>${P.out}</b> · gap <b>${gap(q)}</b> · score <b>${sc.total}</b></div>
    </div>`;
  }).join("");
  const logEl = $("log");
  logEl.innerHTML = S.log.map(logLine).join("");
  logEl.scrollTop = logEl.scrollHeight;
  renderPrompt(p);
}

// One log line as HTML: player names in their colour, a class per kind of line.
function logLine(m) {
  const kind = m.startsWith("Auction") ? "auction" : m.startsWith("—") ? "event" : / wins with /.test(m) ? "win" : / loses| burns/.test(m) ? "lose" : m.includes("Scores:") ? "scores" : "";
  let h = esc(m).replace(/High City/g, '<span class="c-high">High City</span>').replace(/Low City/g, '<span class="c-low">Low City</span>');
  S.players.forEach((P, p) => (h = h.split(esc(P.name)).join(`<b style="color:${COLORS[p]}">${esc(P.name)}</b>`)));
  return `<div class="${kind}">${h}</div>`;
}

function renderPrompt(p) {
  const el = $("prompt");
  clearTimeout(botTimer);
  if (S.over) {
    el.innerHTML = `<div class="msg">Game over: ${who(S.winner)} wins.</div><button class="btn" id="show" type="button">Show results</button>`;
    $("show").onclick = showVictory;
    if (!S.shown) { S.shown = true; showVictory(); }
    return;
  }
  if (S.players[p].bot) {
    el.innerHTML = `<div class="msg">${who(p)} is choosing…</div>`;
    botTimer = setTimeout(() => { act(p, botChoose(p)); render(); }, +$("speed").value);
    return;
  }
  const P = S.players[p];
  const btns = P.hand.map((c, i) => `<button class="btn ${c >= gap(p) ? "meet" : ""}" data-i="${i}" type="button" title="${c >= gap(p) ? "If you win, your characters meet: revolution" : ""}">${c} <small>Citizen → ${Math.max(1, P.cit - c)} (×${tier(Math.max(1, P.cit - c))})</small></button>`);
  el.innerHTML = `<div class="msg">${who(p)}: play a betting card face down, or pass. Highest card wins and sinks your Citizen by it; on a tie, closest to the auctioneer's left wins. Players who bid and lose: Outcast +1. Red = your characters would meet.</div>`
    + `<button class="btn primary" data-i="-1" type="button">Pass</button>${btns.join("")}`;
  el.querySelectorAll("[data-i]").forEach((b) => (b.onclick = () => { act(p, +b.dataset.i); render(); }));
}

function showVictory() {
  const rows = S.ranked.map((p) => {
    const P = S.players[p];
    const s = score(p);
    return `<tr><td>${who(p)}</td><td>${sharesOf(p, "high")} ◆ × ${tier(P.cit)} = ${s.high}</td><td>${sharesOf(p, "low")} ◆ × ${tier(P.out)} = ${s.low}</td><td><b>${s.total}</b></td></tr>`;
  });
  $("victory-body").innerHTML = `<h2>${esc(S.players[S.winner].name)} wins</h2><table class="results"><thead><tr><th>Player</th><th>High City (× Citizen)</th><th>Low City (× Outcast)</th><th>Total</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
  $("victory").showModal();
}

// ---------- setup ----------

function setupRows() {
  const k = +$("setup-count").value;
  $("setup-players").innerHTML = Array.from({ length: k }, (_, i) => `<div class="setup-player"><i style="background:${COLORS[i]}"></i><span><input value="Player ${i + 1}" /> <select><option value="human" ${i ? "" : "selected"}>Human</option><option value="bot" ${i ? "selected" : ""}>Bot</option></select></span></div>`).join("");
}
$("setup-count").onchange = setupRows;
$("setup").addEventListener("close", () => {
  if ($("setup").returnValue !== "start") { if (!S) $("setup").showModal(); return; }
  newGame([...document.querySelectorAll(".setup-player")].map((r) => ({ name: r.querySelector("input").value.trim() || "Player", bot: r.querySelector("select").value === "bot" })));
  render();
});
$("victory").addEventListener("close", () => $("victory").returnValue === "new" && $("setup").showModal());
$("new-game").onclick = () => $("setup").showModal();
// The log in reading order, as plain text (for pasting into an analysis).
$("copy-log").onclick = async () => {
  await navigator.clipboard.writeText(S.log.join("\n"));
  $("copy-log").textContent = "Copied";
  setTimeout(() => ($("copy-log").textContent = "Copy log"), 1200);
};
setupRows();
// play.html?demo: 4 bots, to watch a game.
if (location.search.includes("demo")) { newGame([1, 2, 3, 4].map((i) => ({ name: `Bot ${i}`, bot: true }))); render(); }
else $("setup").showModal();
