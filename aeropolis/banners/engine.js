// Aeropolis: Banners — rules engine. Shared by play.html (hot-seat) and sim.js (headless, via vm).
// Rules: index.html. Data: banners-data.js.
//
// The game is a state machine. S.pending is the decision waiting for a player: { player, prompt, options: [{ label, group, v }] }.
// choose(S, i) applies option i and runs the game until the next decision. S is plain data: clone() copies it for bots.

const N_LOCS = 8; // 0–3 High City (column = index), 4–7 Low City (column = index − 4)
const ALL_LOCS = [...Array(N_LOCS).keys()];
const col = (l) => l % 4;
const isHigh = (l) => l < 4;
const locOf = (l) => (isHigh(l) ? COLUMNS[l].high : COLUMNS[l - 4].low);
const LOC_IDS = { palace: 0, cathedral: 1, barracks: 3, sewers: 4, catacombs: 5, slums: 7 };
const ACTIONS = ["decree", "sermon", "buyout", "purge", "slip", "relic", "recruit", "riot"]; // by location index
const charId = (c) => c.name.toLowerCase();
const CHAR_BY_ID = Object.fromEntries(CHARACTERS.map((c) => [charId(c), c]));

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
const has = (S, p, id) => pl(S, p).chars.includes(id);
const others = (S, p) => S.players.map((_, q) => q).filter((q) => q !== p);
const spent = (S, p) => BN_CONFIG.spire - pl(S, p).cit + pl(S, p).out - 1;
const factionsOf = (S, p) => pl(S, p).chars.map((id) => CHAR_BY_ID[id].faction);
const met = (S, p) => pl(S, p).out >= pl(S, p).cit;
function controller(S, l) {
  const inf = S.inf[l];
  const max = Math.max(...inf);
  if (!max) return -1;
  const top = inf.map((n, p) => (n === max ? p : -1)).filter((p) => p >= 0);
  if (top.length === 1) return top[0];
  return top.find((p) => has(S, p, "pretender")) ?? -1;
}
// Points p holds right now: each of their influence under one of their banners, more where they have control.
// scoreParts: [[location, points]] for the locations that score.
const scoreParts = (S, p) => ALL_LOCS.map((l) => [l, factionsOf(S, p).includes(S.banner[l]) ? S.inf[l][p] * (controller(S, l) === p ? BN_CONFIG.score.control : BN_CONFIG.score.backed) : 0]).filter(([, n]) => n);
const points = (S, p) => scoreParts(S, p).reduce((t, [, n]) => t + n, 0);
const protectedAt = (S, q, l) => (has(S, q, "abbess") && S.banner[l] === "church") || (has(S, q, "mendicant") && !isHigh(l));
const cost = (S, p, l) => (l === LOC_IDS.palace && has(S, p, "regent") ? 2 : locOf(l).cost);
const fits = (S, p, ch, n) => (ch === "cit" ? pl(S, p).cit - n >= 1 : pl(S, p).out + n <= BN_CONFIG.spire);

// Legal (character, location) pairs for a turn.
function picks(S, p) {
  const out = [];
  for (const ch of ["cit", "out"])
    for (let l = 0; l < N_LOCS; l++) {
      if ((ch === "cit") !== isHigh(l) || !fits(S, p, ch, cost(S, p, l))) continue;
      if (pl(S, p).pos[ch] === l && !(ch === "cit" && has(S, p, "spymaster"))) continue; // a character must move
      out.push({ ch, l });
    }
  return out;
}

// Columns whose tandem bonus p may take now.
function tandemCols(S, p) {
  const P = pl(S, p);
  const cols = new Set();
  const a = P.pos.cit, b = P.pos.out;
  if (a != null && b != null) {
    const d = Math.abs(col(a) - col(b));
    if (d === 0) cols.add(col(a));
    if (d === 1 && has(S, p, "tribune")) { cols.add(col(a)); cols.add(col(b)); }
  }
  if (has(S, p, "cutpurse") && b != null && others(S, p).some((q) => pl(S, q).pos.cit === col(b))) cols.add(col(b));
  return [...cols].sort();
}

// Next player: least time spent, then least recently acted.
function nextPlayer(S, pool) {
  let best = -1;
  pool.forEach((p) => {
    if (best < 0 || spent(S, p) < spent(S, best) || (spent(S, p) === spent(S, best) && pl(S, p).last < pl(S, best).last)) best = p;
  });
  return best;
}

// ---------- state changes ----------

function log(S, msg) { if (!S.quiet) S.log.push(msg); }

function place(S, p, l, n = 1) {
  const k = Math.min(n, pl(S, p).supply);
  pl(S, p).supply -= k;
  S.inf[l][p] += k;
  return k;
}
// Removed influence goes back to its owner.
function remove(S, q, l) {
  S.inf[l][q]--;
  pl(S, q).supply++;
}
function setBanner(S, l, f) {
  S.reserve[S.banner[l]]++;
  S.reserve[f]--;
  S.banner[l] = f;
}

// ---------- tasks: options() is the decision (none: apply runs at once), apply(v) resolves it ----------

const skip = { label: "Skip", v: null };
const flagLabel = (f) => `${FACTION[f].glyph} ${FACTION[f].name}`;
const targets = (S, p, locs) => locs.flatMap((l) => others(S, p).filter((q) => S.inf[l][q] > 0 && !protectedAt(S, q, l)).map((q) => ({ l, q })));
const targetOptions = (S, p, locs) => targets(S, p, locs).map(({ l, q }) => ({ label: nm(S, q), group: locOf(l).name, v: { l, q } }));
const bannerOptions = (S, locs) => locs.flatMap((l) => FACTIONS.filter((f) => f.id !== S.banner[l] && S.reserve[f.id] > 0).map((f) => ({ label: flagLabel(f.id), group: locOf(l).name, v: { l, f: f.id } })));
const placeOptions = (S, p, locs) => (pl(S, p).supply ? locs.map((l) => ({ label: locOf(l).name, v: l })).concat(skip) : []);
function flip(S, name, v) {
  if (!v) return;
  log(S, `  ${name}: ${locOf(v.l).name} ${flagLabel(S.banner[v.l])} → ${flagLabel(v.f)}`);
  setBanner(S, v.l, v.f);
}
function hit(S, t, name, v, again) {
  if (!v) return;
  log(S, `  ${name}: ${nm(S, v.q)} −1 influence at the ${locOf(v.l).name}`);
  remove(S, v.q, v.l);
  if (t.n === 1 && again) S.queue.unshift({ ...t, n: 2, ...again });
}

const TASKS = {
  pick: {
    prompt: (S, t) => `${nm(S, t.p)}: choose a character and a location.`,
    options: (S, t) => picks(S, t.p).map(({ ch, l }) => ({ label: `${locOf(l).name} · ${locOf(l).action} ⧗${cost(S, t.p, l)}`, group: CHAR_NAME[ch], v: { ch, l } })),
    apply: (S, t, { ch, l }) => {
      pl(S, t.p).pos[ch] = l;
      const k = place(S, t.p, l);
      log(S, `Turn ${S.turn + 1} · ${nm(S, t.p)}: ${CHAR_NAME[ch]} → ${locOf(l).name} (${locOf(l).action} ⧗${cost(S, t.p, l)})${k ? ", +1 influence" : ""}`);
      S.queue.push({ t: ACTIONS[l], p: t.p, n: 1 }, { t: "tandem", p: t.p }, { t: "spire", p: t.p, ch, n: cost(S, t.p, l) });
      S.stats.actions[locOf(l).action] = (S.stats.actions[locOf(l).action] || 0) + 1;
    },
  },
  decree: {
    prompt: () => "Decree: return 1 of your influence from the Palace to replace the banner of any location.",
    options: (S, t) => (S.inf[LOC_IDS.palace][t.p] ? bannerOptions(S, ALL_LOCS).concat(skip) : []),
    apply: (S, t, v) => {
      if (!v) return;
      remove(S, t.p, LOC_IDS.palace);
      log(S, `  Decree: ${nm(S, t.p)} returns 1 influence from the Palace`);
      flip(S, "Decree", v);
    },
  },
  sermon: {
    prompt: () => "Sermon: place 2 influence at one High City location.",
    options: (S, t) => placeOptions(S, t.p, [0, 1, 2, 3]),
    apply: (S, t, l) => { if (l != null) log(S, `  Sermon: +${place(S, t.p, l, 2)} influence at the ${locOf(l).name}`); },
  },
  buyout: {
    prompt: () => "Buy-out: replace 1 influence of another player with 1 of yours.",
    options: (S, t) => (pl(S, t.p).supply ? targetOptions(S, t.p, ALL_LOCS).concat(skip) : []),
    apply: (S, t, v) => {
      if (!v) return;
      log(S, `  Buy-out: ${nm(S, v.q)}'s influence at the ${locOf(v.l).name} becomes ${nm(S, t.p)}'s`);
      remove(S, v.q, v.l);
      place(S, t.p, v.l);
      if (t.n === 1 && has(S, t.p, "guildmaster")) S.queue.unshift({ ...t, n: 2 });
    },
  },
  purge: {
    prompt: () => "Purge: remove 1 influence of another player from any location.",
    options: (S, t) => targetOptions(S, t.p, ALL_LOCS).concat(skip),
    apply: (S, t, v) => hit(S, t, "Purge", v),
  },
  slip: {
    prompt: () => "Slip: move 1 of your influence to any location.",
    options: (S, t) => moves(S, t.p, 1).concat(skip),
    apply: (S, t, v) => {
      if (!v) return;
      moveInf(S, t.p, v, "Slip");
      if (t.n === 1 && has(S, t.p, "smuggler")) S.queue.unshift({ ...t, n: 2 });
    },
  },
  relic: {
    prompt: () => "Relic: replace the banner of the Catacombs or the Cathedral.",
    options: (S) => bannerOptions(S, [LOC_IDS.catacombs, LOC_IDS.cathedral]).concat(skip),
    apply: (S, t, v) => flip(S, "Relic", v),
  },
  recruit: {
    prompt: () => "Recruit: place 1 influence at any Low City location.",
    options: (S, t) => placeOptions(S, t.p, [4, 5, 6, 7]),
    apply: (S, t, l) => { if (l != null && place(S, t.p, l)) log(S, `  Recruit: +1 influence at the ${locOf(l).name}`); },
  },
  riot: {
    prompt: () => "Riot: remove 1 influence of another player from the Slums or the Barracks.",
    options: (S, t) => targetOptions(S, t.p, [LOC_IDS.slums, LOC_IDS.barracks]).concat(skip),
    apply: (S, t, v) => hit(S, t, "Riot", v, has(S, t.p, "agitator") && {}),
  },
  tandem: {
    prompt: () => "Tandem bonus.",
    options: (S, t) => {
      const opts = tandemCols(S, t.p).flatMap((c) => tandemOptions(S, t.p, c));
      return opts.length ? opts.concat(skip) : [];
    },
    apply: (S, t, v) => {
      if (!v) return;
      TANDEM_APPLY[v.c](S, t.p, v);
      S.stats.tandems[COLUMNS[v.c].tandem.name] = (S.stats.tandems[COLUMNS[v.c].tandem.name] || 0) + 1;
    },
  },
  spire: {
    apply: (S, t) => {
      pl(S, t.p)[t.ch] += t.ch === "cit" ? -t.n : t.n;
      S.stats.time[t.ch] += t.n;
      endTurn(S, t.p);
    },
  },
  next: { apply: (S) => nextTurn(S) },
};

// Moves of up to `max` of p's influence: { from, to, n }.
function moves(S, p, max) {
  const out = [];
  for (let a = 0; a < N_LOCS; a++)
    for (let b = 0; b < N_LOCS; b++)
      for (let n = 1; n <= Math.min(max, S.inf[a][p]); n++)
        if (a !== b) out.push({ label: `→ ${locOf(b).name}${max > 1 ? ` ×${n}` : ""}`, group: `From the ${locOf(a).name}`, v: { from: a, to: b, n } });
  return out;
}
function moveInf(S, p, { from, to, n }, name) {
  S.inf[from][p] -= n;
  S.inf[to][p] += n;
  log(S, `  ${name}: ${n} influence ${locOf(from).name} → ${locOf(to).name}`);
}

function tandemOptions(S, p, c) {
  const name = COLUMNS[c].tandem.name;
  if (c === 0) return targets(S, p, [LOC_IDS.palace]).flatMap(({ q }) => [1, 2].filter((n) => n <= S.inf[LOC_IDS.palace][q]).map((n) => ({ label: `${nm(S, q)} −${n}`, group: name, v: { c, q, n } })));
  if (c === 1) return targets(S, p, [1, 5]).map(({ l, q }) => ({ label: `${nm(S, q)} at the ${locOf(l).name}`, group: name, v: { c, l, q } }));
  if (c === 2) return moves(S, p, 1).map((o) => ({ ...o, group: `${name}: ${o.group}`, v: { c, ...o.v } }));
  return others(S, p).filter((q) => pl(S, q).cit > 1).map((q) => ({ label: `Sink ${nm(S, q)}'s Citizen`, group: name, v: { c, q } }));
}
const TANDEM_APPLY = [
  (S, p, v) => { log(S, `  Coup: ${nm(S, v.q)} −${v.n} influence at the Palace`); for (let i = 0; i < v.n; i++) remove(S, v.q, LOC_IDS.palace); },
  (S, p, v) => { log(S, `  Last Rites: ${nm(S, v.q)} −1 influence at the ${locOf(v.l).name}`); remove(S, v.q, v.l); },
  (S, p, v) => moveInf(S, p, v, "Smuggling"),
  (S, p, v) => { pl(S, v.q).cit--; log(S, `  Blackmail: ${nm(S, v.q)}'s Citizen sinks to ${pl(S, v.q).cit}`); },
];

// ---------- flow ----------

// The end, by BN_CONFIG.end.rule. A player whose characters meet is out (no more turns), then:
//   "out": the others play on; the game ends when every player is out.
//   "lastTurn": the game ends; every other player takes one last turn first.
//   "squeeze": every other player loses end.squeeze time (Citizen sinks), and plays on while they have time.
// end.freeze: a player scores the moment they go out, instead of at the end.
function endTurn(S, p) {
  pl(S, p).last = ++S.turn;
  log(S, `  → ${nm(S, p)} Spire ${pl(S, p).cit}/${pl(S, p).out}, time ${spent(S, p)} · scores: ${S.players.map((P, q) => `${P.name} ${points(S, q)}`).join(", ")}`);
  if (S.lastTurns) S.lastTurns = S.lastTurns.filter((q) => q !== p);
  else goOut(S);
  S.queue.push({ t: "next" });
}

// Players who met go out; a squeeze can make more players meet, so repeat until none is left.
function goOut(S) {
  const E = BN_CONFIG.end;
  let fresh;
  while ((fresh = S.players.map((_, q) => q).filter((q) => !pl(S, q).out_ && met(S, q))).length) {
    fresh.forEach((q) => {
      const P = pl(S, q);
      P.out_ = true;
      S.firstOut ??= q;
      if (E.freeze) { P.parts = scoreParts(S, q); P.score = points(S, q); }
      log(S, `— ${P.name}'s Citizen and Outcast meet: ${P.name} is out${E.freeze ? ` and scores ${P.score}` : ""}. —`);
      if (E.rule === "squeeze") squeeze(S, q);
    });
    if (E.rule === "lastTurn") {
      S.lastTurns = S.players.map((_, q) => q).filter((q) => !pl(S, q).out_);
      log(S, `— The Revolution! Last turn for ${S.lastTurns.map((q) => nm(S, q)).join(", ") || "nobody"}. —`);
      return;
    }
  }
}

// Every player still in loses time: their Citizen sinks (their Outcast rises for what the Citizen cannot sink).
function squeeze(S, from) {
  S.players.forEach((P, q) => {
    if (P.out_) return;
    const sink = Math.min(BN_CONFIG.end.squeeze, P.cit - 1);
    P.cit -= sink;
    P.out += BN_CONFIG.end.squeeze - sink;
    log(S, `  Squeeze: ${P.name} loses ${BN_CONFIG.end.squeeze} time (Spire ${P.cit}/${P.out}).`);
  });
}

function nextTurn(S) {
  const pool = S.lastTurns || S.players.map((_, q) => q).filter((q) => !pl(S, q).out_);
  const p = nextPlayer(S, pool.filter((q) => picks(S, q).length));
  if (p >= 0) return S.queue.push({ t: "pick", p });
  log(S, "— The game ends. —");
  finalScore(S);
}

function finalScore(S) {
  S.players.forEach((P, p) => { if (!(BN_CONFIG.end.freeze && P.out_)) { P.parts = scoreParts(S, p); P.score = points(S, p); } });
  const best = Math.max(...S.players.map((P) => P.score));
  // Tie: most influence in the city.
  const onBoard = (p) => ALL_LOCS.reduce((t, l) => t + S.inf[l][p], 0);
  S.winner = S.players.map((_, p) => p).filter((p) => pl(S, p).score === best).sort((a, b) => onBoard(b) - onBoard(a))[0];
  S.phase = "over";
  ALL_LOCS.forEach((l) => {
    const c = controller(S, l);
    const who = S.players.map((P, q) => (S.inf[l][q] ? `${P.name} ${S.inf[l][q]}${q === c ? " (control)" : ""}` : "")).filter(Boolean).join(", ") || "empty";
    log(S, `  ${locOf(l).name} ${flagLabel(S.banner[l])}: ${who}`);
  });
  S.players.forEach((P, q) => {
    const parts = P.parts;
    log(S, `  ${P.name} (${factionsOf(S, q).map(flagLabel).join(" + ")}): ${P.score}${parts.length ? ` = ${parts.map(([l, n]) => `${locOf(l).name} ${n}`).join(" + ")}` : ""}`);
  });
  log(S, `— ${nm(S, S.winner)} wins with ${best}. —`);
}

// Run tasks until a decision is needed (or the game is over).
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
    T.apply(S, t, undefined); // no decision: run it (option-less tasks, or nothing to choose)
  }
  S.pending = null;
  return S;
}

function choose(S, i) {
  const t = S.task;
  S.pending = null;
  S.task = null;
  const v = TASKS[t.t].options(S, t)[i].v; // options are a pure function of S: re-derive them
  if (v === null && t.t !== "tandem") log(S, `  ${t.t[0].toUpperCase() + t.t.slice(1)}: skipped`);
  TASKS[t.t].apply(S, t, v);
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

// players: [{ name, bot }]. rnd: random function (sim passes a seeded one).
function newGame(players, rnd = Math.random) {
  const n = players.length;
  let cits, outs;
  do {
    cits = shuffle(CHARACTERS.filter((c) => c.char === "cit"), rnd).slice(0, n);
    outs = shuffle(CHARACTERS.filter((c) => c.char === "out"), rnd).slice(0, n);
    // Each player's two banners differ, and no two players share both.
  } while (cits.some((c, i) => c.faction === outs[i].faction || cits.some((d, j) => j < i && [d.faction, outs[j].faction].sort().join() === [c.faction, outs[i].faction].sort().join())));
  const banners = shuffle(FACTIONS.flatMap((f) => Array(BN_CONFIG.bannerCopies).fill(f.id)), rnd);
  const S = {
    phase: "play",
    turn: 0,
    players: players.map((P, p) => ({
      name: P.name, bot: !!P.bot,
      chars: [charId(cits[p]), charId(outs[p])],
      cit: BN_CONFIG.spire, out: 1, pos: { cit: null, out: null },
      supply: BN_CONFIG.influence, last: p - n, score: 0,
    })),
    banner: banners.slice(0, N_LOCS),
    reserve: Object.fromEntries(FACTIONS.map((f) => [f.id, 0])),
    inf: ALL_LOCS.map(() => Array(n).fill(0)),
    queue: [{ t: "next" }],
    log: [],
    stats: { time: { cit: 0, out: 0 }, actions: {}, tandems: {} },
  };
  banners.slice(N_LOCS).forEach((f) => S.reserve[f]++);
  log(S, `— New game. ${S.players.map((P) => `${P.name}: ${P.chars.map((id) => `${CHAR_BY_ID[id].name} ${flagLabel(CHAR_BY_ID[id].faction)}`).join(" + ")}`).join(" · ")} —`);
  log(S, `  City: ${ALL_LOCS.map((l) => `${locOf(l).name} ${flagLabel(S.banner[l])}`).join(", ")}`);
  return advance(S);
}
