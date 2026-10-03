"use strict";

// Headless simulator for Aeropolis: plays many games with bots and prints balance and "fun" metrics.
// Runs the real rules (aeropolis-data.js, aeropolis-play.js) in a VM with a stub page, so it never drifts from the game.
//
//   node aeropolis-sim.js [games=1000] [players=3]            full report: random, smart, 1 smart vs greedy
//   node aeropolis-sim.js compare  [games] [players]           rule variants side by side (see VARIANTS)
//   node aeropolis-sim.js profiles [games] [players]           bot profiles: mixed tournament + each against itself
//   node aeropolis-sim.js cards    [games] [players]           forced pick: does taking a strip win games?
//   node aeropolis-sim.js characters [games] [players]         random characters: win rate and play style per character
//
// Bots: "random" picks uniformly; the others are value-model profiles (see PROFILES in valueBot).

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const MODE = ["compare", "profiles", "cards", "characters"].includes(process.argv[2]) ? process.argv[2] : "report";
const args = process.argv.slice(MODE === "report" ? 2 : 3);
const GAMES = +args[0] || 1000;
const PLAYERS = +args[1] || 3;

// Rule variants for "compare". data: runs in the sandbox after loading (mutate TF_* data, define helpers).
// patch: [find, replace] pairs applied to aeropolis-play.js source before loading.
// Controller pays 1 troop at the location after taking its reward.
const controlCost = (ids) => [["    await effects(q, l.control);", `    await effects(q, l.control);\n    if (${JSON.stringify(ids)}.includes(l.id)) { S.troops[l.id][q]--; P(q).supply++; }`]];
// Cable Lift closed (meant for 2 players): no Lift; Uprisings fought only there leave the deck, the others lose it.
const closeLift = `
  LOCATIONS.splice(LOCATIONS.findIndex((l) => l.id === "lift"), 1);
  for (let i = TF_UPRISINGS.length - 1; i >= 0; i--) {
    TF_UPRISINGS[i].at = TF_UPRISINGS[i].at.filter((id) => id !== "lift");
    if (!TF_UPRISINGS[i].at.length) TF_UPRISINGS.splice(i, 1);
  }`;
// Sudden death: the game ends (and is scored) the moment a player's characters meet.
const suddenDeath = [["  log(`— ${nm(p)}'s Citizen and Outcast meet: the game ends after this round's Uprising. —`);\n  sound(\"fanfare\");", "  log(`— ${nm(p)}'s Citizen and Outcast meet: the game ends now. —`);\n  endGame();\n  throw ABORT;"]];
const VARIANTS = [
  { name: "Current rules" },
  { name: "Uprising tie: lower Outcast (old)", patch: [["res.sort((a, b) => b.s - a.s || fightTie(a.q, b.q, arms));", "res.sort((a, b) => b.s - a.s || P(a.q).out - P(b.q).out);"]] },
  { name: "Cable Lift closed", data: closeLift },
  { name: "Cable Lift closed + sudden death", data: closeLift, patch: suddenDeath },
  { name: "Meeting ends the game at once", patch: suddenDeath },
  { name: "Spire 12 for all (old)", data: `TF_CONFIG.spire = 12; TF_CONFIG.citStart = { 2: 12, 3: 12, 4: 12 };` },
  { name: "Pawnbroker: run 4 (old)", data: `CHARACTER.pawnbroker.up[0].run = 4;` },
  { name: "Courier: run 6, no extra Paper", data: `CHARACTER.courier.up[0].run = 6; delete CHARACTER.courier.goods;` },
  { name: "Courier: 1 extra Paper (old)", data: `CHARACTER.courier.goods = { P: 1 };` },
  // 2-player blowout candidates.
  { name: "Lone fighter takes only the second reward", patch: [["for (const [rank, key] of [[0, \"first\"], [1, \"second\"]]) {", "for (const [rank, key] of res.length === 1 ? [[0, \"second\"]] : [[0, \"first\"], [1, \"second\"]]) {"]] },
  { name: "Lone fighter second reward + catch-up 2 troops", patch: [["for (const [rank, key] of [[0, \"first\"], [1, \"second\"]]) {", "for (const [rank, key] of res.length === 1 ? [[0, \"second\"]] : [[0, \"first\"], [1, \"second\"]]) {"], ["await sendTroops(q, \"low\", 1);", "await sendTroops(q, \"low\", 2);"]] },
  { name: "Catch-up: 2 troops", patch: [["await sendTroops(q, \"low\", 1);", "await sendTroops(q, \"low\", 2);"]] },
  { name: "Catch-up: 1 troop anywhere", patch: [["await sendTroops(q, \"low\", 1);", "await sendTroops(q, \"any\", 1);"], ["(l) => l[zone], { kind: \"send\", zone }", "(l) => zone === \"any\" || l[zone], { kind: \"send\", zone }"]] },
  { name: "Spire 14 at 2 players", data: `TF_CONFIG.spire = 14; TF_CONFIG.citStart[2] = 14;` },
];

// ---------- load the game in a sandbox ----------

function sandbox(variant = {}) {
  const els = {};
  const stubEl = () => ({ innerHTML: "", textContent: "", value: "3", returnValue: "", children: [], addEventListener() {}, showModal() {} });
  const box = vm.createContext({
    console,
    process,
    setImmediate,
    document: { getElementById: (id) => els[id] || (els[id] = stubEl()), querySelectorAll: () => [], addEventListener() {} },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "aeropolis-data.js"), "utf8"), box, { filename: "aeropolis-data.js" });
  let play = fs.readFileSync(path.join(__dirname, "aeropolis-play.js"), "utf8");
  for (const [a, b] of variant.patch || []) {
    if (!play.includes(a)) throw new Error(`Variant "${variant.name}": patch target not found: ${a}`);
    play = play.replace(a, b);
  }
  vm.runInContext(play, box, { filename: "aeropolis-play.js" });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "aeropolis-bots.js"), "utf8"), box, { filename: "aeropolis-bots.js" });
  if (variant.data) vm.runInContext(variant.data, box);
  return box;
}

// Everything below runs inside the sandbox, where the game's globals (S, ui, busy, recruit, …) live.
// setups: [[title, botNames]]. done(results): [{ title, text, m }] (m: headline metrics).
function sim(GAMES, setups, done) {
  render = () => {};
  const pct = (x) => `${(100 * x).toFixed(0)}%`;
  // Forced pick: a bot that takes card key ("id.side") the first time it can, otherwise plays like base.
  function forcedBot(base, key) {
    const [id, side] = key.split(".");
    let done = false;
    return {
      ...base,
      turn(p) {
        if (!done) {
          const o = affordable(p).find((o) => o.id === id);
          if (o) {
            done = true;
            G.forced = p;
            return { type: "recruit", ...o, side };
          }
        }
        return base.turn(p);
      },
    };
  }

  /* ---------- one game, with stats ---------- */

  let G = null; // current game's stats
  const wrap = (fn, before, after) =>
    async function (...args) {
      if (before) before(...args);
      await fn(...args);
      if (after) after(...args);
    };
  activate = wrap(activate, (p, k, side) => G.sides[p].add(`${k}.${side}`));
  // Behaviour: where Spire steps come from (turn = card strips, uprising = rewards, control = locations), Schemes, troops.
  uprising = wrap(uprising, () => (G.src = "uprising"), () => (G.src = "turn"));
  control = wrap(control, () => (G.src = "control"), () => (G.src = "uprising"));
  const riseRule = rise;
  rise = (p, k, amount) => {
    const before = P(p)[k];
    riseRule(p, k, amount);
    G.stat[p][`${k}.${G.src}`] += P(p)[k] - before;
  };
  scheme = wrap(scheme, (p) => G.stat[p].schemes++);
  // Who triggered the meeting (recorded before: a sudden-death variant ends the game inside checkMet).
  const metRule = checkMet;
  checkMet = (p) => {
    if (!S.met && P(p).out >= P(p).cit) G.meeter = p;
    metRule(p);
  };
  const spendRule = spend;
  spend = async (p, e) => {
    const before = S.log.length;
    await spendRule(p, e);
    if (S.log.slice(0, S.log.length - before).some((l) => l.includes("cannot pay"))) G.stat[p].cantPay++;
  };
  const moveRule = moveTroops;
  moveTroops = async (p, amount) => {
    const before = S.log.length;
    await moveRule(p, amount);
    G.stat[p].moves += S.log.slice(0, S.log.length - before).filter((l) => l.includes("moves a troop")).length;
  };
  const sendRule = sendTroops;
  sendTroops = async (p, zone, amount) => {
    const before = P(p).supply;
    await sendRule(p, zone, amount);
    G.stat[p].troops += before - P(p).supply;
    G.stat[p].troopsWanted += amount;
  };
  run = wrap(
    run,
    (p) => (G.runGoods = Object.values(P(p).goods).reduce((a, b) => a + b, 0)),
    (p) => {
      G.runs++;
      G.stat[p].runs++;
      if (S.log[0].includes("caught")) {
        G.busts++;
        G.stat[p].caught++;
      } else G.stat[p].runGoods += Object.values(P(p).goods).reduce((a, b) => a + b, 0) - G.runGoods;
    },
  );
  uprising = wrap(
    uprising,
    () => {
      const u = upcoming();
      const fighters = S.players.map((_, q) => q).filter((q) => u.at.some((id) => S.troops[id][q] > 0));
      G.fights.push(fighters.length);
    },
    () => G.leaders.push(S.players.map(score)),
  );
  control = wrap(control, () =>
    LOCATIONS.forEach((l) => {
      const t = S.troops[l.id];
      const top = Math.max(...t);
      const c = G.ctrl[l.id];
      c.rounds++;
      if (top && t.filter((v) => v === top).length === 1) c.held++;
      if (t.filter((v) => v > 0).length >= 2) c.contested++;
    }),
  );

  const makeBot = (name) => {
    if (name === "random") return RANDOM;
    const [kind, base, key] = name.split(":");
    return kind === "forced" ? forcedBot(valueBot(base), key) : valueBot(name);
  };

  // seats: bot names, or { bot, chars: { cit, out } } to give characters (default: Councillor + Hustler).
  async function playGame(seats) {
    const names = seats.map((s) => s.bot ?? s);
    const chars = seats.map((s) => s.chars || DEFAULT_CHARS);
    const bots = names.map(makeBot);
    G = { meeter: null, deckRuns: { cit: 0, out: 0 }, forced: null, runs: 0, busts: 0, fights: [], leaders: [], ctrl: Object.fromEntries(LOCATIONS.map((l) => [l.id, { rounds: 0, held: 0, contested: 0 }])) };
    G.sides = bots.map(() => new Set());
    G.src = "turn";
    G.stat = bots.map(() => ({ cantPay: 0, moves: 0, schemeTurns: 0, troopsWanted: 0, runs: 0, caught: 0, runGoods: 0, sunk: 0, spent: 0, schemes: 0, troops: 0, "out.turn": 0, "out.uprising": 0, "out.control": 0, "cit.turn": 0, "cit.uprising": 0, "cit.control": 0 }));
    G.took = bots.map(() => new Set());
    G.options = [];
    startGame(bots.map((_, q) => ({ name: `P${q}`, chars: chars[q] })));
    const plan = {};
    for (let steps = 0; S.phase === "play"; steps++) {
      if (steps > 20000) throw new Error("stalled game");
      if (ui.msg && ui.player == null) settle(ui.buttons[0].value); // a result to read (no decision)
      else if (ui.msg) {
        const p = ui.player;
        const i = ui.info.kind === "side" ? Math.max(0, ui.buttons.findIndex((b) => b.value === plan[p])) : bots[p].choose(p, ui.info, ui.buttons);
        if (ui.info.kind === "runDeck") G.deckRuns[ui.buttons[i].value]++;
        settle(ui.buttons[i].value);
      } else if (!busy) {
        const p = current();
        G.options.push(affordable(p).length);
        const a = bots[p].turn(p);
        if (a.type === "pass") {
          G.stat[p].schemeTurns++; // counts forced "take 1 good" turns
          passTurn();
        }
        else {
          plan[p] = a.side;
          G.stat[p].spent += costSize(CARDS[a.id]);
          G.stat[p].sunk += missing(p, CARDS[a.id]);
          G.took[p].add(`${a.id}.${a.side}`);
          recruit(a.k, a.i);
        }
      }
      await new Promise((r) => setImmediate(r));
    }
    // Winner(s): the game's own ranking (score, then tie-break goods). Full ties split the win.
    const final = S.players.map((x) => [score(x)]);
    const best = [...S.players].sort(byRank)[0];
    const winners = S.players.map((x) => byRank(x, best) === 0);
    const share = winners.map((w) => (w ? 1 / winners.filter(Boolean).length : 0));
    const sorted = final.map((f) => f[0]).sort((a, b) => b - a);
    return { ...G, names, chars, onBoard: S.players.map((_, q) => LOCATIONS.reduce((t, l) => t + S.troops[l.id][q], 0)), supply: S.players.map((x) => x.supply), left: S.players.map((x) => Object.values(x.goods).reduce((a, b) => a + b, 0)), leftBy: S.players.map((x) => ({ ...x.goods })), rounds: S.round, met: S.met, final: final.map((f) => f[0]), cit: S.players.map((x) => x.cit), share, margin: sorted[0] - sorted[1] };
  }

  /* ---------- reports ---------- */

  function report(title, games) {
    const botNames = games[0].names;
    const n = botNames.length;
    const m = {};
    const lines = [`\n## ${title} — ${games.length} games, ${n} players\n`];
    const out = (s) => lines.push(s);

    out("### Game shape");
    const rounds = {};
    games.forEach((g) => (rounds[g.rounds] = (rounds[g.rounds] || 0) + 1));
    m.rounds = avg(games.map((g) => g.rounds));
    m.early = avg(games.map((g) => (g.rounds < TF_CONFIG.rounds ? 1 : 0)));
    out(`- Rounds: avg ${m.rounds.toFixed(1)} · ${Object.keys(rounds).sort((a, b) => a - b).map((r) => `${r}: ${pct(rounds[r] / games.length)}`).join(", ")}`);
    out(`- Ended by a meeting: ${pct(avg(games.map((g) => (g.met ? 1 : 0))))} (else: Uprising deck ran out) · the player who met wins ${pct(avg(games.filter((g) => g.meeter != null).map((g) => g.share[g.meeter])))}`);
    out(`- Final score (Citizen + Outcast): winner avg ${avg(games.map((g) => Math.max(...g.final))).toFixed(1)}, all players avg ${avg(games.flatMap((g) => g.final)).toFixed(1)}; Citizen avg ${avg(games.flatMap((g) => g.cit)).toFixed(1)}`);
    out(`- Affordable cards per turn: avg ${avg(games.flatMap((g) => g.options)).toFixed(1)} of ${2 * TF_CONFIG.row}`);

    out("\n### Tension (fun proxies)");
    m.margin = avg(games.map((g) => g.margin));
    m.close = avg(games.map((g) => (g.margin <= 1 ? 1 : 0)));
    m.blowout = avg(games.map((g) => (g.margin >= 4 ? 1 : 0)));
    out(`- Winning margin (1st − 2nd): avg ${avg(games.map((g) => g.margin)).toFixed(2)} · tie on score ${pct(avg(games.map((g) => (g.margin === 0 ? 1 : 0))))} · ≤1 ${pct(avg(games.map((g) => (g.margin <= 1 ? 1 : 0))))} · blowout ≥4 ${pct(avg(games.map((g) => (g.margin >= 4 ? 1 : 0))))}`);
    const leaderOf = (s) => {
      const top = Math.max(...s);
      return s.filter((v) => v === top).length === 1 ? s.indexOf(top) : null;
    };
    const changes = games.map((g) => {
      let c = 0;
      let last = null;
      g.leaders.map(leaderOf).forEach((l) => {
        if (l !== null && last !== null && l !== last) c++;
        if (l !== null) last = l;
      });
      return c;
    });
    m.changes = avg(changes);
    out(`- Lead changes per game: avg ${m.changes.toFixed(2)} · games with none ${pct(avg(changes.map((c) => (c ? 0 : 1))))}`);
    const early = games.filter((g) => g.leaders.length >= 3 && leaderOf(g.leaders[1]) !== null);
    m.runaway = avg(early.map((g) => g.share[leaderOf(g.leaders[1])]));
    out(`- Runaway: sole leader after round 2 wins ${pct(m.runaway)} (fair baseline ${pct(1 / n)})`);
    const mid = games.filter((g) => g.leaders.length >= 2);
    const comeback = mid.map((g) => {
      const s = g.leaders[Math.floor(g.leaders.length / 2) - 1];
      const low = Math.min(...s);
      return g.share.some((w, q) => w > 0 && s[q] === low && s.filter((v) => v === low).length === 1) ? 1 : 0;
    });
    m.comeback = avg(comeback);
    m.seats = botNames.map((_, q) => avg(games.map((g) => g.share[q])));
    out(`- Comeback: the sole last player at mid-game wins ${pct(m.comeback)}`);
    out(`- Win rate by seat: ${m.seats.map((w, q) => `P${q + 1} ${pct(w)}`).join(" · ")}`);

    out("\n### Uprisings & city");
    const fights = games.flatMap((g) => g.fights);
    out(`- Fighters per Uprising: avg ${avg(fights).toFixed(2)} · nobody ${pct(avg(fights.map((f) => (f === 0 ? 1 : 0))))} · uncontested (1) ${pct(avg(fights.map((f) => (f === 1 ? 1 : 0))))} · contested (2+) ${pct(avg(fights.map((f) => (f >= 2 ? 1 : 0))))}`);
    m.loc = {};
    LOCATIONS.forEach((l) => {
      const c = games.map((g) => g.ctrl[l.id]).reduce((a, b) => ({ rounds: a.rounds + b.rounds, held: a.held + b.held, contested: a.contested + b.contested }));
      m.loc[l.id] = { held: c.held / c.rounds, contested: c.contested / c.rounds };
      out(`- ${l.name.padEnd(13)} controlled ${pct(c.held / c.rounds)} of rounds · contested ${pct(c.contested / c.rounds)}`);
    });
    const tw = games.flatMap((g) => g.stat), sent = tw.reduce((t, x) => t + x.troops, 0), wanted = tw.reduce((t, x) => t + x.troopsWanted, 0);
    out(`- Troops: ${(sent / tw.length).toFixed(1)} sent per player (${pct(1 - sent / wanted)} of troop effects wasted: supply empty); on the board at the end ${avg(games.flatMap((g) => g.onBoard)).toFixed(1)}, in supply ${avg(games.flatMap((g) => g.supply)).toFixed(1)}`);
    const leftBy = Object.keys(GOODS).map((k) => `${GOODS[k].name} ${avg(games.flatMap((g) => g.leftBy.map((l) => l[k]))).toFixed(1)}`);
    out(`- Goods left at game end, per player: ${leftBy.join(" · ")}`);
    const runs = games.reduce((t, g) => t + g.runs, 0);
    m.caught = games.reduce((t, g) => t + g.busts, 0) / runs;
    m.sunk = avg(games.flatMap((g) => g.stat.map((s) => s.sunk)));
    m.spent = avg(games.flatMap((g) => g.stat.map((s) => s.spent)));
    m.left = avg(games.flatMap((g) => g.left));
    const steps = (src) => avg(games.flatMap((g) => g.stat.map((st) => st[`out.${src}`] + st[`cit.${src}`])));
    m.stepsUp = steps("uprising");
    m.stepsCtrl = steps("control");
    m.met = avg(games.map((g) => (g.met ? 1 : 0)));
    const met = games.filter((g) => g.meeter != null);
    m.meeterWins = avg(met.map((g) => g.share[g.meeter]));
    m.schemeTurns = avg(games.flatMap((g) => g.stat.map((st) => st.schemeTurns)));
    m.schemeWin = (() => {
      const all = games.flatMap((g) => g.stat.map((st, q) => ({ t: st.schemeTurns, w: g.share[q] })));
      const some = all.filter((x) => x.t > 0);
      return some.length ? avg(some.map((x) => x.w)) : 0;
    })();
    m.final = avg(games.flatMap((g) => g.final));
    const citRuns = games.reduce((t, g) => t + g.deckRuns.cit, 0);
    out(`- Street runs per game: ${(runs / games.length).toFixed(1)} · caught ${pct(m.caught)} · through the Citizen deck ${pct(citRuns / runs)}`);

    out("\n### Sides (does the game force 3 of 4?)");
    const players = games.flatMap((g) => g.sides.map((s, q) => ({ s, w: g.share[q] })));
    const bySides = [1, 2, 3, 4].map((k) => players.filter((x) => x.s.size === k));
    m.sides3 = players.filter((x) => x.s.size >= 3).length / players.length;
    out(`- Distinct sides activated: ${bySides.map((a, i) => `${i + 1}: ${pct(a.length / players.length)} (win ${pct(avg(a.map((x) => x.w)))})`).join(" · ")}`);
    const names = { "cit.up": "Rally", "cit.down": "Council", "out.up": "Street", "out.down": "Deal" };
    m.council = avg(players.map((x) => (x.s.has("cit.down") ? 1 : 0)));
    out(`- Used by: ${Object.entries(names).map(([k, v]) => `${v} ${pct(avg(players.map((x) => (x.s.has(k) ? 1 : 0))))}`).join(" · ")}`);

    out("\n### Cards (win rate of players who took it, vs fair " + pct(1 / n) + ")");
    const rows = [];
    TF_CARDS.forEach((c) =>
      ["up", "down"].forEach((side) => {
        const key = `${c.id}.${side}`;
        const takers = games.flatMap((g) => g.took.map((t, q) => (t.has(key) ? g.share[q] : null)).filter((v) => v !== null));
        m.strips = m.strips || {};
        m.strips[key] = { taken: takers.length, win: avg(takers) };
        if (takers.length >= 30) rows.push({ name: `${c.name} ${side === "up" ? "▲" : "▼"}`, fx: fxList(c[side]).replace(/<[^>]*>/g, " ").replace(/\s+/g, " "), taken: takers.length, win: avg(takers) });
      }),
    );
    rows.sort((a, b) => b.win - a.win);
    m.best = rows[0];
    m.worst = rows[rows.length - 1];
    const fmt = (r) => `  ${r.name.padEnd(16)} win ${pct(r.win).padStart(4)} · taken by ${String(r.taken).padStart(4)} players · ${r.fx.trim()}`;
    out("- Strongest:");
    rows.slice(0, 6).forEach((r) => out(fmt(r)));
    out("- Weakest:");
    rows.slice(-6).forEach((r) => out(fmt(r)));
    // Per bot name (seat-independent), and the forced pick's taker if any.
    // Per character (and per Citizen + Outcast pair): win rate, score and behaviour.
    m.byChar = {};
    m.byPair = {};
    games.forEach((g) =>
      g.chars.forEach((c, q) => {
        const add = (key) => {
          const r = (key.includes("+") ? m.byPair : m.byChar)[key] || { games: 0, win: 0, score: 0, troops: 0, moves: 0, runs: 0, schemes: 0, up: 0, ctrl: 0, sunk: 0 };
          r.moves += g.stat[q].moves;
          r.cantPay = (r.cantPay || 0) + g.stat[q].cantPay;
          r.deckOut = (r.deckOut || 0) + (g.deckBy ? g.deckBy[q].out : 0);
          r.games++;
          r.win += g.share[q];
          r.score += g.final[q];
          r.troops += g.stat[q].troops;
          r.runs += g.stat[q].runs;
          r.schemes += g.stat[q].schemes;
          r.up += g.stat[q]["out.uprising"] + g.stat[q]["cit.uprising"];
          r.ctrl += g.stat[q]["out.control"];
          r.sunk += g.stat[q].sunk;
          (key.includes("+") ? m.byPair : m.byChar)[key] = r;
        };
        add(c.cit);
        add(c.out);
        add(`${c.cit}+${c.out}`);
      }),
    );
    m.byBot = {};
    games.forEach((g) =>
      g.names.forEach((b, q) => {
        const r = (m.byBot[b] = m.byBot[b] || { games: 0, win: 0 });
        r.games++;
        r.win += g.share[q];
      }),
    );
    // Behaviour per bot name: averages per player per game.
    m.behaviour = {};
    games.forEach((g) =>
      g.names.forEach((b, q) => {
        const r = (m.behaviour[b] = m.behaviour[b] || { n: 0 });
        r.n++;
        Object.entries(g.stat[q]).forEach(([k, v]) => (r[k] = (r[k] || 0) + v));
      }),
    );
    const forced = games.filter((g) => g.forced != null);
    m.forced = { games: forced.length, win: avg(forced.map((g) => g.share[g.forced])) };
    return { title, text: lines.join("\n"), m };
  }

  (async () => {
    const results = [];
    for (const [title, names, count = GAMES] of setups) {
      const games = [];
      for (let i = 0; i < count; i++) games.push(await playGame(typeof names === "function" ? names() : names));
      results.push(report(title, games));
    }
    done(results);
  })().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}

// report / profiles / cards run on the current rules, or on a variant: VARIANT="<part of its name>" node aeropolis-sim.js profiles
const BASE = process.env.VARIANT ? VARIANTS.find((v) => v.name.includes(process.env.VARIANT)) : {};
if (!BASE) throw new Error(`No variant matches "${process.env.VARIANT}"`);
const run = (variant, setups) => new Promise((resolve) => vm.runInContext(`(${sim})`, sandbox(variant))(GAMES, setups, resolve));
const all = (bot) => Array(PLAYERS).fill(bot);
const pct = (x) => `${Math.round(100 * x)}%`;

const PROFILE_NAMES = ["smart", "smart-old", "greedy", "frugal", "warlord", "builder"];
const shuffled = (a) => a.map((x) => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map((x) => x[1]);
const cols = [
  ["Rounds", (m) => m.rounds.toFixed(1)],
  ["Ends early", (m) => pct(m.early)], // before the last round
  ["Runaway", (m) => pct(m.runaway)],
  ["Comeback", (m) => pct(m.comeback)],
  ["Lead chg", (m) => m.changes.toFixed(2)],
  ["Margin", (m) => m.margin.toFixed(1)],
  ["Close ≤1", (m) => pct(m.close)],
  ["Blowout", (m) => pct(m.blowout)],
  ["Seats", (m) => m.seats.map(pct).join("/")],
  ["3+ sides", (m) => pct(m.sides3)],
  ["Council", (m) => pct(m.council)],
  ["Caught", (m) => pct(m.caught)],
  ["Cost paid / sunk", (m) => `${m.spent.toFixed(1)} / ${m.sunk.toFixed(1)}`],
  ["Goods left", (m) => m.left.toFixed(1)],
  ["Steps: Uprising / control", (m) => `${m.stepsUp.toFixed(1)} / ${m.stepsCtrl.toFixed(1)}`],
  ["Ends by meeting", (m) => pct(m.met)],
  ["Meeter wins", (m) => pct(m.meeterWins)],
  ["Docks / Black Market held · contested", (m) => `${pct(m.loc.docks.held)}·${pct(m.loc.docks.contested)} / ${pct(m.loc.market.held)}·${pct(m.loc.market.contested)}`],
  ["Forced passes / player", (m) => m.schemeTurns.toFixed(2)],
  ["Avg score", (m) => m.final.toFixed(1)],
  ["Best strip", (m) => (m.best ? `${m.best.name.trim()} ${pct(m.best.win)}` : "—")],
  ["Worst strip", (m) => (m.worst ? `${m.worst.name.trim()} ${pct(m.worst.win)}` : "—")],
];
const md = (head, rows) => [head, head.map(() => "---"), ...rows].map((r) => `| ${r.join(" | ")} |`).join("\n");
const metricsTable = (rows) => md(["Setup", ...cols.map(([h]) => h)], rows.map(([name, m]) => [name, ...cols.map(([, f]) => f(m))]));
const tick = () => process.stderr.write(".");

const MODES = {
  // Full report: random, smart, and a skill check.
  async report() {
    const results = await run(BASE, [
      ["All random", all("random")],
      ["All smart", all("smart")],
      ["Skill check: 1 smart vs greedy", ["smart", ...all("greedy").slice(1)]],
    ]);
    console.log(results.map((r) => r.text).join("\n"));
  },

  // Rule variants side by side, all-smart and all-random.
  async compare() {
    const rows = { smart: [], random: [] };
    for (const v of VARIANTS) {
      const [s, r] = await run(v, [["smart", all("smart")], ["random", all("random")]]);
      rows.smart.push([v.name, s.m]);
      rows.random.push([v.name, r.m]);
      tick();
    }
    console.log(`# Variants — ${GAMES} games each, ${PLAYERS} players (fair win rate ${pct(1 / PLAYERS)})\n`);
    console.log(`## All smart\n\n${metricsTable(rows.smart)}\n\n## All random\n\n${metricsTable(rows.random)}`);
  },

  // Bot profiles: a mixed tournament (who wins?), then each profile against itself (does the game stay tight?).
  async profiles() {
    const setups = [["Mixed", () => shuffled(PROFILE_NAMES).slice(0, PLAYERS), GAMES * 2], ...PROFILE_NAMES.map((b) => [b, all(b)])];
    const [mixed, ...mirror] = await run(BASE, setups);
    const byBot = Object.entries(mixed.m.byBot).sort((a, b) => b[1].win / b[1].games - a[1].win / a[1].games);
    if (BASE.name) console.log(`Variant: ${BASE.name}\n`);
    console.log(`# Bot profiles — ${PLAYERS} players (fair win rate ${pct(1 / PLAYERS)})\n`);
    console.log(`## Mixed tournament (${GAMES * 2} games, random profiles and seats)\n`);
    const beh = mixed.m.behaviour;
    const per = (b, k) => (beh[b][k] / beh[b].n).toFixed(1);
    console.log(
      md(
        ["Profile", "Games", "Win rate", "Cost paid", "Schemes", "Troops sent", "Street runs", "Caught", "Goods from runs", "Outcast ↑ Uprisings", "Outcast ↑ control"],
        byBot.map(([b, r]) => [b, r.games, pct(r.win / r.games), per(b, "spent"), per(b, "schemes"), per(b, "troops"), per(b, "runs"), pct(beh[b].caught / (beh[b].runs || 1)), per(b, "runGoods"), per(b, "out.uprising"), per(b, "out.control")]),
      ),
    );
    console.log(`\n## Each profile against itself (${GAMES} games each)\n\n${metricsTable(mirror.map((r) => [r.title, r.m]))}`);
  },

  // Characters: smart bots, random distinct characters per player. Win rate and play style per character and pair.
  async characters() {
    const ids = (k) => vm.runInContext(`CHARACTERS.filter((c) => c.char === "${k}").map((c) => c.id)`, sandbox());
    const [cits, outs] = [ids("cit"), ids("out")];
    const seats = () => {
      const [c, o] = [shuffled(cits), shuffled(outs)];
      return all("smart").map((bot, q) => ({ bot, chars: { cit: c[q % c.length], out: o[q % o.length] } }));
    };
    const [r] = await run(BASE, [["characters", seats, GAMES * 2]]);
    const se = (x) => Math.sqrt(((x.win / x.games) * (1 - x.win / x.games)) / x.games);
    const per = (x, k) => (x[k] / x.games).toFixed(1);
    const rowOf = (id, x) => [id, x.games, `${pct(x.win / x.games)} ± ${pct(2 * se(x))}`, per(x, "score"), per(x, "troops"), per(x, "moves"), per(x, "cantPay"), per(x, "runs"), per(x, "schemes"), per(x, "up"), per(x, "ctrl"), per(x, "sunk")];
    const head = ["Character", "Games", "Win rate", "Score", "Troops sent", "Moves", "Cannot pay", "Street runs", "Schemes", "Steps from Uprisings", "Steps from control", "Citizen sinks"];
    console.log(`# Characters — ${GAMES * 2} games, ${PLAYERS} smart players, random distinct characters (fair ${pct(1 / PLAYERS)})\n`);
    console.log(md(head, [...cits, ...outs].map((id) => rowOf(id, r.m.byChar[id]))));
    const pairs = Object.entries(r.m.byPair).filter(([, x]) => x.games >= 60).sort((a, b) => b[1].win / b[1].games - a[1].win / a[1].games);
    console.log(`\n## Pairs (≥60 games), strongest first\n`);
    console.log(md(["Pair", "Games", "Win rate"], pairs.map(([id, x]) => [id.replace("+", " + "), x.games, `${pct(x.win / x.games)} ± ${pct(2 * se(x))}`])));
  },

  // Forced pick: one smart player at a random seat takes a given strip the first time it can.
  // Both sides of every card. Smart: one smart player takes the strip the first time it can, the others play normally.
  // Random: win rate of players who took the strip in all-random games (no judgment involved).
  async cards() {
    // ONLY="id,id" limits the test to some cards.
    const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
    const cards = sandboxCards().cards.filter((c) => !only || only.includes(c.id));
    const { fxList, costHtml, costSize } = sandboxCards();
    const forced = {};
    for (const c of cards)
      for (const side of ["up", "down"]) {
        const key = `${c.id}.${side}`;
        const [r] = await run(BASE, [[key, () => shuffled([`forced:smart:${key}`, ...all("smart").slice(1)])]]);
        forced[key] = r.m.forced;
        tick();
      }
    const [rnd] = await run(BASE, [["random", all("random"), GAMES * 5]]);
    const se = (r) => Math.sqrt((r.win * (1 - r.win)) / r.games);
    const text = (fx) => fx.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").replace(/\+ /g, "+").trim();
    const cell = (key) => `${pct(forced[key].win)} / ${pct(rnd.m.strips[key].win)}`;
    const stronger = (c) => {
      const [u, d] = [forced[`${c.id}.up`], forced[`${c.id}.down`]];
      const gap = u.win - d.win;
      return Math.abs(gap) < 2 * Math.hypot(se(u), se(d)) ? "≈" : gap > 0 ? `▲ +${Math.round(100 * gap)}` : `▼ +${Math.round(-100 * gap)}`;
    };
    const rows = [...cards]
      .sort((a, b) => a.char.localeCompare(b.char) || costSize(a) - costSize(b))
      .map((c) => [c.name, c.char === "cit" ? "Citizen" : "Outcast", text(costHtml(c)) || "free", text(fxList(c.up)), cell(`${c.id}.up`), text(fxList(c.down)), cell(`${c.id}.down`), stronger(c)]);
    const n = Object.values(forced)[0].games;
    console.log(`# Card sides — ${PLAYERS} players, fair win rate ${pct(1 / PLAYERS)}\n`);
    console.log(`Win rates: smart forced pick (~${n} games per strip, ± ~${pct(2 * Math.sqrt(1 / PLAYERS * (1 - 1 / PLAYERS) / n))}) / random takers (${GAMES * 5} games). "Stronger" compares the smart column; ≈ = within noise.\n`);
    console.log(md(["Card", "Deck", "Cost", "▲ Top strip", "▲ Win", "▼ Bottom strip", "▼ Win", "Stronger"], rows));
  },
};

// Card list and strip text for the "cards" mode, read from the data file.
function sandboxCards() {
  const box = sandbox(BASE);
  const get = (name) => vm.runInContext(name, box);
  return { cards: get("TF_CARDS"), fxList: get("fxList"), costHtml: get("costHtml"), costSize: get("costSize") };
}

(async () => {
  await MODES[MODE]();
  process.stderr.write("\n");
})();
