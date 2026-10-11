// Headless all-bot games.
//   node sim.js [games] [players]            play, write logs to sim-logs/, print stats
//   node sim.js compare [games] [players]    compare rule variants (see VARIANTS)
//   node sim.js balance [games] [players]    character and card strength
const fs = require("fs");
const path = require("path");
const E = require("./play.js");
E.boot(require("./cards.json"));

const ALL_VARIANTS = {
  base: {},
  "5 locations": { locations: ["governor", "military", "guild", "underground", "workers"] },
  "no upkeep": { upkeep: false },
  "arming: escalate": { arming: "escalate" },
  "arming: tax": { arming: "tax" },
};

// compare [games] [players] [variant names, comma separated]
const pick = process.argv[5] ? process.argv[5].split(",") : Object.keys(ALL_VARIANTS);
const VARIANTS = Object.fromEntries(pick.map((k) => [k, ALL_VARIANTS[k]]));

const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const sd = (a) => Math.sqrt(mean(a.map((x) => (x - mean(a)) ** 2)));
const f1 = (x) => x.toFixed(1);

async function batch(games, players, config = {}, logDir = null) {
  const out = { games: [], stats: {}, chars: {}, cards: {} };
  const add = (o, k, n = 1) => (o[k] = (o[k] || 0) + n);
  for (let g = 1; g <= games; g++) {
    await E.newGame(players, { allBots: true, delay: 0, config });
    const G = E.G;
    if (!G.over) throw new Error(`game ${g} did not finish: ${G.log[0].text}`);
    if (logDir) fs.writeFileSync(path.join(logDir, `game-${g}.txt`), [...G.log].reverse().map((l) => l.text).join("\n") + "\n");
    const vps = G.players.map((p) => p.vp.total);
    const avg = mean(vps);
    const board = E.LOCS.map((l) => G.board[l.id]);
    out.games.push({
      vps,
      margin: G.ranking[0].vp.total - G.ranking[1].vp.total,
      tiedTop: G.ranking[0].vp.total === G.ranking[1].vp.total,
      controlled: G.players.reduce((t, p) => t + p.vp.locs.length, 0) / E.LOCS.length,
      // players present (any agent) per location at the Revolution
      presence: mean(board.map((b) => G.players.filter((p) => b.high[p.id] || b.low[p.id]).length)),
      ranking: G.ranking.map((p) => p.id),
    });
    G.players.forEach((p, i) => {
      for (const [k, n] of Object.entries(G.stats[i])) add(out.stats, k, n);
      add(out.stats, "end:gold", p.gold);
      add(out.stats, "end:arms", p.arms);
      const won = G.ranking[0] === p;
      for (const c of [p.cit.char.name, p.out.char.name]) {
        const s = (out.chars[c] ||= { n: 0, wins: 0, dvp: 0 });
        s.n++;
        s.wins += won ? 1 : 0;
        s.dvp += p.vp.total - avg;
      }
      for (const [k, n] of Object.entries(G.stats[i]))
        if (k.startsWith("buy:")) {
          const s = (out.cards[k.slice(4)] ||= { buys: 0, buyers: 0, wins: 0, dvp: 0 });
          s.buys += n;
          s.buyers++;
          s.wins += won ? 1 : 0;
          s.dvp += p.vp.total - avg;
        }
    });
  }
  return out;
}

function summary(r, games, players) {
  const per = (k) => (r.stats[k] || 0) / (games * players);
  const turns = per("turns");
  const vps = r.games.flatMap((g) => g.vps);
  const stackBuys = ["Stipend", "Retainer", "Hired Muscle"].reduce((t, c) => t + per(`buy:${c}`), 0);
  const allBuys = Object.keys(r.stats).filter((k) => k.startsWith("buy:")).reduce((t, k) => t + per(k), 0);
  return {
    "VP avg": f1(mean(vps)),
    "VP sd": f1(sd(vps)),
    "win margin": f1(mean(r.games.map((g) => g.margin))),
    "tied top %": f1(100 * mean(r.games.map((g) => (g.tiedTop ? 1 : 0)))),
    "controlled %": f1(100 * mean(r.games.map((g) => g.controlled))),
    "players/location": f1(mean(r.games.map((g) => g.presence))),
    "plans/turn": f1(per("plans") / turns),
    investigate: f1(per("investigate")),
    "stack buys": f1(stackBuys),
    "market buys": f1(allBuys - stackBuys),
    "secret uses": f1(per("secret:exploit") + per("secret:contract") + per("secret:remove")),
    "limit discards": f1(per("secret:limit-discard")),
    "gold in/spent/end": `${f1(per("gold+"))}/${f1(per("spent:gold"))}/${f1(per("end:gold"))}`,
    "arms in/used/end": `${f1(per("arms+"))}/${f1(per("arm:slot") + per("arm:convert") + per("spent:arms"))}/${f1(per("end:arms"))}`,
    "reserve empty": f1(per("reserve-empty")),
    upkeep: f1(per("upkeep")),
    "arms placed at end": f1(per("arm:end")),
    "arms taxed": f1(per("arm:tax")),
    "cells formed": f1(per("cell-formed")),
    "paid effects": f1(per("pay")),
  };
}

function table(rows, cols) {
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c]).length)));
  const line = (r) => cols.map((c, i) => String(r[c]).padEnd(w[i])).join("  ");
  return [line(Object.fromEntries(cols.map((c) => [c, c]))), ...rows.map(line)].join("\n");
}

(async () => {
  const args = process.argv.slice(2);
  const mode = isNaN(Number(args[0])) ? args.shift() : "play";
  const games = Number(args[0]) || (mode === "play" ? 5 : 40);
  const players = Number(args[1]) || 4;

  if (mode === "compare") {
    const rows = [];
    for (const [name, config] of Object.entries(VARIANTS)) rows.push({ variant: name, ...summary(await batch(games, players, config), games, players) });
    const metrics = Object.keys(rows[0]).filter((k) => k !== "variant");
    console.log(`${games} games × ${players} players per variant (per player per game unless %)\n`);
    console.log(table(metrics.map((m) => ({ metric: m, ...Object.fromEntries(rows.map((r) => [r.variant, r[m]])) })), ["metric", ...rows.map((r) => r.variant)]));
    return;
  }

  if (mode === "balance") {
    const r = await batch(games, players);
    const base = 100 / players;
    const chars = Object.entries(r.chars)
      .map(([name, s]) => ({ character: name, games: s.n, "win %": f1((100 * s.wins) / s.n), "VP vs avg": f1(s.dvp / s.n) }))
      .sort((a, b) => b["VP vs avg"] - a["VP vs avg"]);
    console.log(`${games} games × ${players} players. Fair win rate ${f1(base)}%.\n\nCharacters\n${table(chars, ["character", "games", "win %", "VP vs avg"])}`);
    const cards = Object.entries(r.cards)
      .map(([name, s]) => ({ card: name, "buys/game": f1(s.buys / games), "buyer win %": f1((100 * s.wins) / s.buyers), "buyer VP vs avg": f1(s.dvp / s.buyers) }))
      .sort((a, b) => b["buyer VP vs avg"] - a["buyer VP vs avg"]);
    console.log(`\nCards (bought at least once by the player)\n${table(cards, ["card", "buys/game", "buyer win %", "buyer VP vs avg"])}`);
    return;
  }

  const logDir = path.join(__dirname, "sim-logs");
  fs.rmSync(logDir, { recursive: true, force: true });
  fs.mkdirSync(logDir);
  const r = await batch(games, players, {}, logDir);
  r.games.forEach((g, i) => console.log(`Game ${i + 1}: VP ${g.ranking.map((id) => `Bot ${id + 1} ${g.vps[id]}`).join(" | ")}`));
  console.log("\n" + table(Object.entries(summary(r, games, players)).map(([metric, v]) => ({ metric, value: v })), ["metric", "value"]));
  console.log(`\nLogs: ${logDir}`);
})();
