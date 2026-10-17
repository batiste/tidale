"use strict";

// Headless simulator for Banners: bots play many games with the real rules (banners-data.js, engine.js, bots.js in a VM).
//
//   node sim.js [games=100] [players=4] [random]     "random": seat 0 plays at random (does the value bot beat it?)
//   node sim.js log [games=3] [players=3]             print each game's log, then the report
//
// Report: scores, game length, who ends the game, action use, win rate by seat and character.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

// node sim.js log [games=3] [players=3]: print full game logs instead.
if (process.argv[2] === "log") process.argv.splice(2, 1, "LOG");
const LOG = process.argv.includes("LOG");
if (LOG) process.argv.splice(process.argv.indexOf("LOG"), 1);
const GAMES = +process.argv[2] || (LOG ? 3 : 100);
const PLAYERS = +process.argv[3] || (LOG ? 3 : 4);
const RANDOM_SEAT = process.argv[4] === "random";

const box = vm.createContext({ console });
for (const f of ["banners-data.js", "engine.js", "bots.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, f), "utf8"), box, { filename: f });
// END='{"rule":"lastTurn"}' node sim.js …: try another end rule (merged into BN_CONFIG.end).
if (process.env.END) vm.runInContext(`Object.assign(BN_CONFIG.end, ${process.env.END})`, box);
const G = vm.runInContext("({ newGame, choose, botChoose, CHAR_BY_ID, FACTION, STYLES })", box); // top-level consts are not properties of the context

// Seeded random, so runs are repeatable.
function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mean = (a) => a.reduce((t, x) => t + x, 0) / a.length;
const pct = (x) => `${(100 * x).toFixed(0)}%`;
const f1 = (x) => x.toFixed(1);
const add = (o, k, n = 1) => (o[k] = (o[k] || 0) + n);

const scores = [], winScores = [], margins = [], turns = [], actions = {}, tandems = {}, byChar = {};
const seatWins = Array(PLAYERS).fill(0);
let firstOutWins = 0, triggerWins = 0, ties = 0, citTime = 0, outTime = 0;
const t0 = Date.now();

for (let g = 0; g < GAMES; g++) {
  const rnd = mulberry(g + 1);
  vm.runInContext(`Math.random = (${mulberry.toString()})(${g + 1000})`, box); // bots' random choices, seeded too
  const S = G.newGame(Array.from({ length: PLAYERS }, (_, i) => ({ name: `P${i + 1}`, bot: true })), rnd);
  S.quiet = !LOG;
  while (S.pending) G.choose(S, RANDOM_SEAT && S.pending.player === 0 ? Math.floor(rnd() * S.pending.options.length) : G.botChoose(S));
  if (LOG) {
    console.log(`\n===== Game ${g + 1} =====`);
    S.players.forEach((P) => console.log(`${P.name} [${G.STYLES[P.style].name}]: ${P.chars.map((id) => `${G.CHAR_BY_ID[id].name} (${G.FACTION[G.CHAR_BY_ID[id].faction].name})`).join(", ")} → ${P.score}`));
    console.log(S.log.join("\n"));
  }
  const sc = S.players.map((P) => P.score);
  const sorted = [...sc].sort((a, b) => b - a);
  scores.push(...sc);
  winScores.push(sorted[0]);
  margins.push(sorted[0] - sorted[1]);
  if (sorted[0] === sorted[1]) ties++;
  turns.push(S.turn / PLAYERS);
  seatWins[S.winner]++;
  if (S.players.every((P) => P.last <= S.players[S.winner].last)) triggerWins++; // the winner took the last turn
  if (S.winner === S.firstOut) firstOutWins++;
  S.players.forEach((P, p) => { const k = `style ${G.STYLES[P.style].name}`; byChar[k] = byChar[k] || [0, 0]; byChar[k][0] += p === S.winner; byChar[k][1]++; });
  S.players.forEach((P, p) => P.chars.forEach((c) => { byChar[c] = byChar[c] || [0, 0]; byChar[c][0] += p === S.winner; byChar[c][1]++; }));
  for (const k in S.stats.actions) add(actions, k, S.stats.actions[k]);
  for (const k in S.stats.tandems) add(tandems, k, S.stats.tandems[k]);
  citTime += S.stats.time.cit; outTime += S.stats.time.out;
}

const out = [];
out.push(`Banners — ${GAMES} games, ${PLAYERS} players${RANDOM_SEAT ? ", P1 random" : ""} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
out.push("", "Scores");
out.push(`  mean ${f1(mean(scores))}, winner ${f1(mean(winScores))}, margin over second ${f1(mean(margins))}, tied on points ${pct(ties / GAMES)}`);
out.push("", "Length");
out.push(`  turns per player ${f1(mean(turns))}; Spire steps: Citizen ${pct(citTime / (citTime + outTime))}, Outcast ${pct(outTime / (citTime + outTime))}`);
out.push(`  the player with the last turn wins ${pct(triggerWins / GAMES)}; the first player out wins ${pct(firstOutWins / GAMES)}`);
const lowTurns = ["Slip", "Relic", "Recruit", "Riot"].reduce((t, k) => t + (actions[k] || 0), 0);
out.push(`  Outcast turns: ${pct(lowTurns / Object.values(actions).reduce((a, b) => a + b, 0))}`);
out.push("", "Actions (share of turns)");
const nAct = Object.values(actions).reduce((a, b) => a + b, 0);
Object.entries(actions).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => out.push(`  ${k.padEnd(9)} ${pct(n / nAct)}`));
out.push("", "Tandem bonuses taken (per game)");
Object.entries(tandems).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => out.push(`  ${k.padEnd(15)} ${f1(n / GAMES)}`));
out.push("", `Win rate (fair: ${pct(1 / PLAYERS)})`);
out.push(`  by seat: ${seatWins.map((w) => pct(w / GAMES)).join(" ")}`);
Object.entries(byChar).sort((a, b) => b[1][0] / b[1][1] - a[1][0] / a[1][1]).forEach(([c, [w, n]]) => out.push(`  ${c.padEnd(12)} ${pct(w / n)} (${n})`));
console.log(out.join("\n"));
