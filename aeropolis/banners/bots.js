// Aeropolis: Banners — bots. A value model of the board from the deciding player's point of view.
// Pick: each (character, location) is played out greedily to the end of the turn, then valued. Other decisions: one step ahead.
// Variety: each bot plays a style (STYLES), and picks at random among options close to the best one.

// time: value lost per Spire step (a step is worth about one point: the game lasts ~20 steps and winners score ~20).
// opp: weight of the opponents (above 1: hurting them beats helping yourself). leader: share of that weight on the leading opponent.
// stray: influence under another banner (points after a banner change). tol: options within this much of the best are equal.
const STYLES = [
  { name: "Builder", time: 1, opp: 0.7, leader: 0.6, stray: 0.3, tol: 0.3 },
  { name: "Raider", time: 1, opp: 1.3, leader: 0.8, stray: 0.2, tol: 0.3 },
  { name: "Schemer", time: 0.8, opp: 1, leader: 0.6, stray: 0.5, tol: 0.4 },
];
const styleOf = (S, p) => STYLES[(pl(S, p).style ??= Math.floor(Math.random() * STYLES.length))];

// q's position: points held now, plus influence that could become points, minus the time spent.
function estimate(S, q, st) {
  if (pl(S, q).out_ && pl(S, q).parts) return pl(S, q).score - st.time * spent(S, q); // scored when they went out
  const mine = factionsOf(S, q);
  let v = points(S, q) - st.time * spent(S, q);
  ALL_LOCS.forEach((l) => (v += mine.includes(S.banner[l]) ? 0 : S.inf[l][q] * st.stray));
  return v;
}

// p against the field. Once the game is over, only winning counts: a bot does not end it while behind if it can help it.
function value(S, p) {
  const st = styleOf(S, p);
  const opp = others(S, p);
  if (S.phase === "over") return pl(S, p).score - Math.max(...opp.map((q) => pl(S, q).score)) + (S.winner === p ? 100 : -100);
  const e = opp.map((q) => estimate(S, q, st));
  return estimate(S, p, st) - st.opp * (st.leader * Math.max(...e) + (1 - st.leader) * (e.reduce((a, b) => a + b, 0) / e.length));
}

// Random pick among the options valued within the style's tolerance of the best.
function pickNear(vals, tol) {
  const best = Math.max(...vals);
  const near = vals.map((v, i) => (v >= best - tol ? i : -1)).filter((i) => i >= 0);
  return near[Math.floor(Math.random() * near.length)];
}

// One step: the option whose immediate result is worth most to the deciding player.
function greedy(S) {
  const p = S.pending.player;
  return pickNear(S.pending.options.map((_, i) => value(choose(clone(S), i), p)), styleOf(S, p).tol);
}

// Play the rest of the turn greedily (other players' forced decisions too), then value it for p.
function rollout(S, p) {
  let guard = 20;
  while (S.pending && guard-- && S.task.t !== "pick") choose(S, greedy(S));
  return value(S, p);
}

function botChoose(S) {
  if (S.task.t !== "pick") return greedy(S);
  const p = S.pending.player;
  return pickNear(S.pending.options.map((_, i) => rollout(choose(clone(S), i), p)), styleOf(S, p).tol);
}
