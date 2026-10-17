// Banners: Simple — rules engine. Rules: index.html. Data: data.js (+ ../banners-data.js for factions and location names).
// Same state-machine shape and helper names as ../engine.js, so ../bots.js and ../sim.js work with it unchanged.
//
// S.pending is the decision waiting for a player: { player, prompt, options: [{ label, group, v }] }.
// choose(S, i) applies option i and runs the game until the next decision.

const N_LOCS = 8; // 0–3 High City (column = index), 4–7 Low City (column = index − 4)
const ALL_LOCS = [...Array(N_LOCS).keys()];
const col = (l) => l % 4;
const isHigh = (l) => l < 4;
const locName = (l) => (isHigh(l) ? COLUMNS[l].high : COLUMNS[l - 4].low).name;
const flagLabel = (f) => `${FACTION[f].glyph} ${FACTION[f].name}`;

function shuffle(a, rnd) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- queries ----------

const pl = (S, p) => S.players[p];
const nm = (S, p) => S.players[p].name;
const others = (S, p) => S.players.map((_, q) => q).filter((q) => q !== p);
const spent = (S, p) => SB.spire - pl(S, p).cit + pl(S, p).out - 1;
const met = (S, p) => pl(S, p).out >= pl(S, p).cit;
const factionsOf = (S, p) => pl(S, p).factions; // [Citizen's banner, Outcast's banner]
function controller(S, l) {
  const max = Math.max(...S.inf[l]);
  const top = S.inf[l].map((n, p) => (n === max ? p : -1)).filter((p) => p >= 0);
  return max && top.length === 1 ? top[0] : -1;
}
// One total per banner: at each location flying it, your influence there, plus SB.control if you control it.
const bannerTotals = (S, p) => factionsOf(S, p).map((f) => ALL_LOCS.reduce((t, l) => t + (S.banner[l] === f ? S.inf[l][p] + (controller(S, l) === p ? SB.control : 0) : 0), 0));
const points = (S, p) => Math.min(...bannerTotals(S, p)); // your weaker banner
const fits = (S, p, ch) => (ch === "cit" ? pl(S, p).cit - SB.cost.cit >= 1 : pl(S, p).out + SB.cost.out <= SB.spire);

// Legal moves: a character goes to another location of its own city.
function picks(S, p) {
  const out = [];
  for (const ch of ["cit", "out"])
    if (fits(S, p, ch)) for (const l of ALL_LOCS) if ((ch === "cit") === isHigh(l) && pl(S, p).pos[ch] !== l) out.push({ ch, l });
  return out;
}

// Next player: least time spent, then least recently acted.
function nextPlayer(S, pool) {
  let best = -1;
  pool.forEach((p) => {
    if (best < 0 || spent(S, p) < spent(S, best) || (spent(S, p) === spent(S, best) && pl(S, p).last < pl(S, best).last)) best = p;
  });
  return best;
}

function log(S, msg) { if (!S.quiet) S.log.push(msg); }

// ---------- tasks ----------

const TASKS = {
  pick: {
    prompt: (S, t) => `${nm(S, t.p)}: move a character.`,
    options: (S, t) => picks(S, t.p).map(({ ch, l }) => ({ label: `${locName(l)} ⧗${SB.cost[ch]}`, group: CHAR_NAME[ch], v: { ch, l } })),
    apply: (S, t, { ch, l }) => {
      const P = pl(S, t.p);
      P.pos[ch] = l;
      log(S, `Turn ${S.turn + 1} · ${P.name}: ${CHAR_NAME[ch]} → ${locName(l)} (⧗${SB.cost[ch]})`);
      const other = ch === "cit" ? "out" : "cit";
      S.queue.push({ t: "act", p: t.p, ch, l });
      if (P.pos[other] != null && col(P.pos[other]) === col(l)) S.queue.push({ t: "act", p: t.p, ch: other, l: P.pos[other], tandem: true });
      S.queue.push({ t: "spire", p: t.p, ch });
    },
  },
  // Place influence, or raise one of your banners where you have control.
  act: {
    prompt: (S, t) => `${t.tandem ? "Tandem: your " : ""}${CHAR_NAME[t.ch]} at the ${locName(t.l)}: place influence or raise your banner.`,
    options: (S, t) => {
      const opts = [];
      if (pl(S, t.p).supply) opts.push({ label: `Place ${Math.min(SB.place[t.ch], pl(S, t.p).supply)} influence`, v: { k: "place" } });
      if (controller(S, t.l) === t.p) factionsOf(S, t.p).filter((f) => f !== S.banner[t.l]).forEach((f) => opts.push({ label: `Raise ${flagLabel(f)}`, v: { k: "raise", l: t.l, f } }));
      return opts.length && t.tandem ? opts.concat({ label: "Skip", v: null }) : opts;
    },
    apply: (S, t, v) => {
      if (!v) return;
      const tag = t.tandem ? " (tandem)" : "";
      S.stats.actions[v.k + tag] = (S.stats.actions[v.k + tag] || 0) + 1;
      if (v.k === "place") {
        const k = Math.min(SB.place[t.ch], pl(S, t.p).supply);
        pl(S, t.p).supply -= k;
        S.inf[t.l][t.p] += k;
        log(S, `  Place${tag}: +${k} influence at the ${locName(t.l)}`);
      } else {
        log(S, `  Raise${tag}: ${locName(t.l)} ${flagLabel(S.banner[t.l])} → ${flagLabel(v.f)}`);
        S.banner[t.l] = v.f;
        S.stats.flips++;
      }
    },
  },
  spire: {
    apply: (S, t) => {
      pl(S, t.p)[t.ch] += t.ch === "cit" ? -SB.cost.cit : SB.cost.out;
      S.stats.time[t.ch] += SB.cost[t.ch];
      endTurn(S, t.p);
    },
  },
  next: { apply: (S) => nextTurn(S) },
};

// ---------- flow ----------

// When your characters meet you score (your weaker banner) and are out. The game ends when every player is out.
function endTurn(S, p) {
  pl(S, p).last = ++S.turn;
  log(S, `  → ${nm(S, p)} Spire ${pl(S, p).cit}/${pl(S, p).out}, time ${spent(S, p)} · scores: ${S.players.map((P, q) => `${P.name} ${points(S, q)}`).join(", ")}`);
  S.players.forEach((P, q) => {
    if (P.out_ || !met(S, q)) return;
    score(S, q);
    P.out_ = true;
    S.firstOut ??= q;
    log(S, `— ${P.name}'s Citizen and Outcast meet: ${P.name} is out and scores ${P.score} (${totalsText(S, q)}). —`);
  });
  S.queue.push({ t: "next" });
}
function score(S, p) {
  const P = pl(S, p);
  P.parts = bannerTotals(S, p); // frozen: what happens after cannot touch it
  P.score = Math.min(...P.parts);
}
const totalsText = (S, p) => factionsOf(S, p).map((f, i) => `${flagLabel(f)} ${pl(S, p).parts[i]}`).join(", ");

function nextTurn(S) {
  const p = nextPlayer(S, S.players.map((_, q) => q).filter((q) => !pl(S, q).out_ && picks(S, q).length));
  if (p >= 0) return S.queue.push({ t: "pick", p });
  S.players.forEach((P, q) => P.out_ || score(S, q));
  // Tie: the stronger second banner, then most influence in the city.
  const onBoard = (q) => ALL_LOCS.reduce((t, l) => t + S.inf[l][q], 0);
  const rank = S.players.map((_, q) => q).sort((a, b) => pl(S, b).score - pl(S, a).score || Math.max(...pl(S, b).parts) - Math.max(...pl(S, a).parts) || onBoard(b) - onBoard(a));
  S.winner = rank[0];
  S.phase = "over";
  log(S, "— The game ends. —");
  S.players.forEach((P, q) => log(S, `  ${P.name}: ${P.score} (${totalsText(S, q)})`));
  log(S, `— ${nm(S, S.winner)} wins with ${pl(S, S.winner).score}. —`);
}

function advance(S) {
  while (S.queue.length) {
    const t = S.queue.shift();
    const T = TASKS[t.t];
    const options = T.options ? T.options(S, t) : [];
    if (options.length) {
      S.task = t;
      S.pending = { player: t.p, prompt: T.prompt(S, t), options };
      return S;
    }
    T.apply(S, t, undefined);
  }
  S.pending = null;
  return S;
}

function choose(S, i) {
  const t = S.task;
  S.pending = null;
  S.task = null;
  TASKS[t.t].apply(S, t, TASKS[t.t].options(S, t)[i].v); // options are a pure function of S: re-derive them
  return advance(S);
}

function clone(S) {
  const { log: _, ...rest } = S;
  const c = JSON.parse(JSON.stringify(rest));
  c.log = [];
  c.quiet = true;
  return c;
}

// ---------- setup ----------

// Each player gets two different factions (Citizen, Outcast); no two players share both.
function newGame(players, rnd = Math.random) {
  const n = players.length;
  let pairs;
  do pairs = players.map(() => shuffle(FACTIONS.map((f) => f.id), rnd).slice(0, 2));
  while (pairs.some((a, i) => pairs.some((b, j) => j < i && [...a].sort().join() === [...b].sort().join())));
  const S = {
    phase: "play",
    turn: 0,
    players: players.map((P, p) => ({
      name: P.name, bot: !!P.bot, factions: pairs[p],
      cit: SB.spire, out: 1, pos: { cit: null, out: null },
      supply: SB.influence, last: p - n, score: 0,
    })),
    banner: shuffle(FACTIONS.flatMap((f) => [f.id, f.id]), rnd).slice(0, N_LOCS),
    inf: ALL_LOCS.map(() => Array(n).fill(0)),
    queue: [{ t: "next" }],
    log: [],
    stats: { time: { cit: 0, out: 0 }, actions: {}, tandems: {}, flips: 0 },
  };
  log(S, `— New game. ${S.players.map((P) => `${P.name}: Citizen ${flagLabel(P.factions[0])} + Outcast ${flagLabel(P.factions[1])}`).join(" · ")} —`);
  log(S, `  City: ${ALL_LOCS.map((l) => `${locName(l)} ${flagLabel(S.banner[l])}`).join(", ")}`);
  return advance(S);
}
