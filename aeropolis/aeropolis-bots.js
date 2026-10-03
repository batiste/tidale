"use strict";

// Aeropolis bots, shared by the playtest page (AI seats) and aeropolis-sim.js.
// They read the game's globals (S, P, CARDS, canPay, …) from aeropolis-play.js, so load this file after it.
// Bots: RANDOM (uniform) and valueBot(profile): a one-step value model; a profile is a set of weights (see PROFILES).
// Each bot has turn(p) → { type: "recruit", k, i, id, side } | { type: "pass" } and choose(p, info, buttons) → button index.

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const pickRandom = (a) => a[Math.floor(Math.random() * a.length)];
const upcoming = () => TF_UPRISINGS[S.uprisings[S.uprising]];
const affordable = (p) => CHARS.flatMap((k) => S.row[k].map((id, i) => ({ k, i, id })).filter((o) => canPay(p, CARDS[o.id])));

const RANDOM = {
  turn(p) {
    const opts = affordable(p);
    if (!opts.length) return { type: "pass" };
    return { type: "recruit", ...pickRandom(opts), side: pickRandom(["up", "down"]) };
  },
  choose: (p, info, buttons) => Math.floor(Math.random() * buttons.length),
};

// Value-model bots. A profile is a set of weights; greedy is the state-blind baseline.
// State-aware terms: tempo (end the game when ahead, stall when behind), contest (fight the leader's
// locations), deny (value a card has for the next player), engine (stack a side),
// future (a tucked strip fires again on later activations of its side).
const GV = { P: 0.6, S: 0.6, A: 0.5, T: 0.3 };
// plan: fight planning for the coming Uprising and no goods hoarding (0 = the older, naive bot).
// horizon: goods and spare troops lose value as the game runs out (0 = valued the same until the end).
// usage: a good is worth its best use still uncovered by stock (costs, own spend strips, fights, runs); 0 = fixed GV with a stock discount.
const BASE_W = { usage: 1, horizon: 1, needs: 1, plan: 1, riskBehind: 1, rise: 2.5, troop: 1, fight: 1.2, ctrl: 0.6, goods: 1, scheme: 1, limit: 0.2, cost: 1, arms: 1, tempo: 0, contest: 0, deny: 0, engine: 0, future: 0.6 };
const PROFILES = {
  greedy: {},
  myopic: { future: 0 }, // greedy without future activations: the old baseline
  frugal: { rise: 3.5, troop: 0.8, fight: 0.6, scheme: 0.5, tempo: 1 },
  warlord: { troop: 1.5, fight: 2.5, scheme: 1.6, ctrl: 0.3 },
  builder: { engine: 0.6, goods: 1.3, limit: 0.5 },
  smart: { tempo: 1, contest: 1.5, deny: 0.5, scheme: 2 },
  "smart-old": { tempo: 1, contest: 1.5, deny: 0.5, plan: 0 }, // smart before fight planning, for comparison
  daring: { tempo: 1, contest: 1.5, deny: 0.5, riskBehind: 0.3 }, // smart, but gambles on street runs when behind
};

// Expected haul of a street run by deck and heat limit, per good type (stop when a draw is more likely to hurt than help).
// RUN_BY_DECK[k][L] = { P, S, A, T }: lets a bot value a run by the goods it needs (the Outcast deck is where Stims are).
const RUN_BY_DECK = {};
for (const k of CHARS) {
  RUN_BY_DECK[k] = {};
  const cards = TF_CARDS.filter((c) => c.char === k).flatMap((c) => Array(c.copies).fill({ heat: heatOf(c), n: costSize(c), cost: c.cost }));
  for (let L = 1; L <= 14; L++) {
    const total = { P: 0, S: 0, A: 0, T: 0 };
    for (let t = 0; t < 300; t++) {
      const deck = shuffle([...cards]);
      let heat = 0;
      let got = [];
      while (deck.length && drawEV(heat, L, deck, got.reduce((a, c) => a + c.n, 0)) > 0) {
        const c = deck.pop();
        heat += c.heat;
        if (heat > L) {
          got = [];
          break;
        }
        got.push(c);
      }
      got.forEach((c) => Object.entries(c.cost).forEach(([g, n]) => (total[g] += n)));
    }
    RUN_BY_DECK[k][L] = Object.fromEntries(Object.entries(total).map(([g, n]) => [g, n / 300]));
  }
}
function drawEV(heat, limit, deck, haulGoods) {
  const bust = deck.filter((c) => heat + c.heat > limit);
  const safe = deck.filter((c) => heat + c.heat <= limit);
  const pb = bust.length / deck.length;
  return (1 - pb) * avg(safe.map((c) => c.n)) - pb * haulGoods;
}

// Average cost of a card, per good (weighted by copies): what a future recruit is expected to cost.
const AVG_COST = (() => {
  const t = { P: 0, S: 0, A: 0, T: 0 };
  let n = 0;
  TF_CARDS.forEach((c) => {
    n += c.copies;
    Object.entries(c.cost).forEach(([g, k]) => (t[g] += k * c.copies));
  });
  return Object.fromEntries(Object.entries(t).map(([g, k]) => [g, k / n]));
})();

const lead = (p) => score(P(p)) - Math.max(...S.players.filter((_, q) => q !== p).map(score));
const leader = () => {
  const s = S.players.map(score);
  const top = Math.max(...s);
  return s.filter((v) => v === top).length === 1 ? s.indexOf(top) : null;
};
const fighting = (p) => upcoming().at.some((id) => S.troops[id][p] > 0);

function valueBot(profile) {
  const w = { ...BASE_W, ...PROFILES[profile] };
  const schemeValue = (p) => w.scheme * (fighting(p) ? 1.8 : 0.5);
  // Turns this player has left after this one: the table's smallest Citizen–Outcast gap closes about 2.5 per round.
  const turnsLeft = () => {
    const gap = Math.min(...S.players.map((x) => x.cit - x.out));
    const rounds = S.met ? 1 : Math.min(S.uprisings.length - S.uprising, Math.max(1, gap / 2.5));
    return Math.max(0, 2 * rounds - Math.floor(S.step / n()) - 1);
  };
  // Horizon: goods and spare troops only matter while there are turns left to use them (Arms: also in the coming fight).
  // Score is all that counts at the end, so late in the game rises dominate.
  const late = (g, p) => {
    if (!w.horizon) return 1;
    const f = Math.min(1, 0.1 + turnsLeft() / 4);
    return g === "A" && p != null && fighting(p) ? Math.max(f, 0.8) : f;
  };
  // Tempo: closing your own Citizen–Outcast gap ends the game sooner: good when ahead, bad when behind.
  const tempo = (p, steps) => w.tempo * steps * Math.sign(lead(p) || -1) * 0.5;
  // Score = Citizen + Outcast, so every effective step up is worth the same.
  // Meeting ends the game after this round: a bot that is not ahead must not trigger it.
  const MEET_PENALTY = 25;
  const meetCost = (p, gap) => (gap <= 0 && !S.met && lead(p) <= 0 ? MEET_PENALTY : 0);
  const riseValue = (p, k, n) => {
    const x = P(p);
    const eff = Math.min(n, TF_CONFIG.spire - x[k]);
    const meet = k === "out" && eff > 0 ? meetCost(p, x.cit - x.out - eff) : 0;
    return eff * w.rise + (k === "out" ? tempo(p, eff) : -tempo(p, eff)) - meet;
  };
  // Force at the coming Uprising: troops at its locations + Arms (a rival's Arms are visible).
  const force = (q) => upcoming().at.reduce((t, id) => t + S.troops[id][q], 0) + P(q).goods.A;
  // Fight planning: a troop at the Uprising is worth a lot when it can tip the fight, less once clearly ahead.
  function fightValue(p) {
    if (!w.plan) return w.fight;
    const mine = force(p);
    const rival = Math.max(...S.players.map((_, q) => (q === p ? 0 : force(q))));
    const first = fxValue(p, upcoming().first, { goods: { ...P(p).goods }, limit: 0 });
    // Half the reward: the troop may still lose, and every fighter loses a troop.
    if (mine + 1 > rival && mine <= rival) return w.fight + first * 0.5; // this troop takes the lead
    if (mine <= rival) return w.fight; // too far behind: do not chase
    if (mine === 0) return w.fight + 1; // join for the second reward
    return w.fight * 0.5; // already clearly ahead
  }

  // Value of keeping one troop where it is: in the coming fight, or holding control by exactly 1 (or a tie
  // that denies a rival control), it matters; elsewhere it is nearly free to move.
  const movePlan = {};
  function keepValue(p, id) {
    const t = S.troops[id];
    const lead = t[p] - Math.max(...t.filter((_, q) => q !== p));
    const ctrl = w.ctrl * fxValue(p, LOC[id].control, { goods: { ...P(p).goods }, limit: 0 });
    let v = 0.3 * w.troop * late();
    if (upcoming().at.includes(id)) v += w.plan ? fightValue(p) : w.fight;
    if (lead === 1) v += ctrl; // moving it loses control
    if (lead === 0) v += 0.5 * ctrl; // moving it hands control to a rival
    return v;
  }

  function locValue(p, id) {
    let v = w.troop * late();
    if (upcoming().at.includes(id)) v += fightValue(p);
    const t = S.troops[id];
    const best = Math.max(...t.filter((_, q) => q !== p));
    if (t[p] <= best && t[p] + 1 > best) v += w.ctrl * fxValue(p, LOC[id].control, { goods: { ...P(p).goods }, limit: 0 });
    const l = leader();
    if (w.contest && l !== null && l !== p && t[l] === Math.max(...t) && t[p] + 1 >= t[l]) v += w.contest;
    return v;
  }
  const troopValue = (p, zone) => (P(p).supply ? Math.max(...LOCATIONS.filter((l) => l[zone]).map((l) => locValue(p, l.id))) : 0);

  // A good is worth less the more of it you already hold: a stockpile you cannot spend is worth little.
  // Goods that the bot's own characters spend (e.g. Arms for the Gunsmith) are worth more while it holds few.
  const needs = (p) => {
    const x = P(p);
    const own = CHARS.flatMap((k) => [...charOf(x, k).up, ...charOf(x, k).down]);
    return new Set(own.flatMap((e) => (e.spend ? Object.keys(e.spend) : [])));
  };
  const goodValue = (g, stock, p) => {
    if (stock >= TF_CONFIG.goodsCap) return 0; // over the cap: lost
    if (w.usage && p != null) return w.goods * marginal(uses(p)[g], stock);
    return ((w.goods * GV[g]) / (1 + stock / 4)) * (w.plan && w.needs && p != null && needs(p).has(g) && stock < 3 ? 1.6 : 1) * late(g, p);
  };
  // Uses of each good over this player's remaining turns: [{ v: value of one unit, d: expected units needed }].
  // Memoized per decision (cleared in turn / choose): the board does not change while a bot weighs its options.
  let usesMemo = {};
  function uses(p) {
    if (usesMemo[p]) return usesMemo[p];
    // Placeholder while computing: a strip's reward may itself be valued in goods (fixed values, no recursion).
    usesMemo[p] = Object.fromEntries(Object.entries(GV).map(([g, v]) => [g, [{ v, d: 2 }]]));
    const x = P(p);
    const t = turnsLeft() + 1; // this turn included: goods gained now can pay for this turn's later effects
    const u = { P: [], S: [], A: [], T: [] };
    // Card costs: a good that covers a future cost saves a Citizen step.
    Object.keys(u).forEach((g) => u[g].push({ v: w.cost * w.rise, d: turnsLeft() * AVG_COST[g] }));
    // Own spend strips: expected activations of their side × goods they take; a unit is worth what the strip gives for it.
    const total = CHARS.reduce((n, k) => n + x.sides[k].up.length + x.sides[k].down.length, 0);
    let runs = 0;
    for (const k of CHARS)
      for (const side of ["up", "down"]) {
        const acts = t * ((1 + x.sides[k][side].length) / (4 + total));
        const list = [...x.sides[k][side].flatMap((id) => CARDS[id][side]), ...charOf(x, k)[side]];
        for (const e of list) {
          if (e.run) runs += acts;
          if (!e.spend) continue;
          const parts = Object.entries(e.spend);
          const v = fxValue(p, [].concat(e.get), { goods: { P: 0, S: 0, A: 0, T: 0 }, limit: 0 }) / parts.reduce((t, [, n]) => t + n, 0);
          for (const [g, n] of parts) {
            if (g === "any") ["P", "S", "T"].forEach((h) => u[h].push({ v, d: (acts * n) / 3 }));
            else u[g].push({ v, d: acts * n });
          }
        }
      }
    // Arms: +1 strength each. The coming fight if this bot is in it, then later fights.
    const fightsLeft = Math.max(0, S.uprisings.length - S.uprising - (S.met ? 1 : 0));
    if (fighting(p)) u.A.push({ v: w.fight, d: 3 });
    u.A.push({ v: 0.5 * w.fight, d: 2 * Math.max(0, Math.min(fightsLeft, t / 2) - 1) });
    // Stims: a redraw on a street run.
    u.T.push({ v: 1, d: 0.5 * runs });
    return (usesMemo[p] = u);
  }
  // Value of one more unit when holding `stock`: the best uses are covered first; beyond all needs, a tie-break crumb.
  function marginal(list, stock) {
    let at = 0;
    let v = 0;
    for (const e of [...list].sort((a, b) => b.v - a.v)) {
      const overlap = Math.max(0, Math.min(stock + 1, at + e.d) - Math.max(stock, at));
      v += overlap * e.v;
      at += e.d;
      if (at >= stock + 1) return v;
    }
    return v + (stock + 1 - Math.max(stock, at)) * 0.02;
  }
  function fxValue(p, list, sim) {
    let v = 0;
    for (const e of list) {
      if (e.gain) {
        for (let i = 0; i < e.n; i++) v += goodValue(e.gain, sim.goods[e.gain]++, p);
      } else if (e.spend) {
        const parts = Object.entries(e.spend);
        const total = Object.values(sim.goods).reduce((a, b) => a + b, 0);
        if (parts.some(([g, n]) => (g === "any" ? total : sim.goods[g]) < n)) continue;
        // Spent goods cost what they are worth to this bot ("any": the least useful ones).
        const after = { ...sim.goods };
        let paid = 0;
        for (const [g, n] of parts)
          for (let i = 0; i < n; i++) {
            const h = g === "any" ? Object.keys(after).filter((k) => after[k] > 0).sort((a, b) => goodValue(a, after[a] - 1, p) - goodValue(b, after[b] - 1, p))[0] : g;
            paid += goodValue(h, --after[h], p);
          }
        const gain = fxValue(p, [].concat(e.get), sim) - paid;
        if (gain <= 0) continue;
        v += gain;
        sim.goods = after;
      } else if (e.rise) v += riseValue(p, e.rise, e.n);
      else if (e.troop) v += troopValue(p, e.troop) * e.n;
      else if (e.move) {
        // A move is only worth something with troops on the board to move.
        const onBoard = LOCATIONS.reduce((t, l) => t + S.troops[l.id][p], 0);
        v += 0.5 * Math.min(e.move, onBoard);
      }
      else if (e.limit) {
        sim.limit += e.limit;
        v += w.limit * e.limit;
      } else if (e.scheme) v += schemeValue(p);
      else if (e.run) {
        // A street run is worth less the more goods you already hold (no hoarding).
        const stock = w.plan ? Object.values(sim.goods).reduce((a, b) => a + b, 0) : 0;
        // Best deck for the goods this bot needs (goodValue boosts what its characters spend).
        const L = Math.min(14, e.run + sim.limit);
        const haul = Math.max(...CHARS.map((k) => Object.entries(RUN_BY_DECK[k][L]).reduce((t, [g, n]) => t + n * goodValue(g, sim.goods[g], p), 0)));
        v += haul / (1 + Math.max(0, stock - 6) / 6);
      }
      else if (e.choice)
        // Goods of your choice: each one is the most useful good for this bot (as chosen in choose "choice").
        for (let i = 0; i < e.choice; i++) {
          const g = bestChoice(p, sim.goods);
          v += goodValue(g, sim.goods[g]++, p);
        }
    }
    return v;
  }
  const bestChoice = (p, goods) => Object.keys(goods).reduce((a, b) => (goodValue(b, goods[b], p) > goodValue(a, goods[a], p) ? b : a));

  // Cost of a card: the goods it takes, plus a Citizen step (1 point) for each good lacking.
  function payValue(p, card) {
    const x = P(p);
    const steps = missing(p, card);
    const goods = Object.entries(card.cost).reduce((t, [g, k]) => t + Math.min(k, x.goods[g]) * goodValue(g, x.goods[g] - 1, p), 0);
    return goods + w.cost * w.rise * steps - tempo(p, steps) + (steps ? meetCost(p, x.cit - steps - x.out) : 0);
  }

  // Future activations of a strip: turns left × share of turns that activate its side (sides with more strips get more).
  // Spend strips are judged with a small stock of goods, not today's (often empty) one.
  function futureValue(p, k, side, strip, dropped) {
    if (!w.future) return 0;
    const x = P(p);
    const total = CHARS.reduce((t, c) => t + x.sides[c].up.length + x.sides[c].down.length, 0);
    const acts = turnsLeft() * ((2 + x.sides[k][side].length) / (8 + total));
    const val = (list) => fxValue(p, list, { goods: { P: 2, S: 2, A: 1, T: 1 }, limit: 0 });
    return w.future * acts * (val(strip) - (dropped ? val(dropped) : 0));
  }

  // Expected value of a street run through a deck: sampled runs, stopping when a draw hurts more than it helps;
  // goods valued against the current stock (so the deck with the goods you need wins).
  function deckRunValue(p, deck, limit) {
    let total = 0;
    for (let t = 0; t < 40; t++) {
      const d = shuffle([...deck]);
      const stock = { ...P(p).goods };
      let heat = 0;
      let got = [];
      while (d.length && drawEV(heat, limit, d, got.reduce((a, c) => a + c.n, 0)) > 0) {
        const c = d.pop();
        heat += c.heat;
        if (heat > limit) {
          got = [];
          break;
        }
        got.push(c);
      }
      got.forEach((c) => Object.entries(c.cost).forEach(([g, k]) => { for (let i = 0; i < k; i++) total += goodValue(g, stock[g]++, p); }));
    }
    return total / 40;
  }

  // Tucking card id on side: the new strip, then the side's strips newest to oldest (oldest dropped if full), then the base.
  function tuckValue(p, id, side) {
    const k = CARDS[id].char;
    const col = P(p).sides[k][side];
    const kept = col.length >= TF_CONFIG.sideCap ? col.slice(1) : col;
    const list = activationOrder([...CARDS[id][side], ...[...kept].reverse().flatMap((c) => CARDS[c][side]), ...charOf(P(p), k)[side]]);
    const cost = payValue(p, CARDS[id]);
    const dropped = kept !== col ? CARDS[col[0]][side] : null;
    return fxValue(p, list, { goods: { ...P(p).goods }, limit: 0 }) - cost + w.engine * kept.length + futureValue(p, k, side, CARDS[id][side], dropped);
  }
  const bestTuck = (p, id) => Math.max(tuckValue(p, id, "up"), tuckValue(p, id, "down"));

  return {
    turn(p) {
      usesMemo = {};
      const next = (S.step + 1) % n() === 0 && S.step + 1 >= 2 * n() ? null : (current() + 1) % n();
      const opts = affordable(p).flatMap((o) => {
        const deny = w.deny && next !== null && canPay(next, CARDS[o.id]) ? w.deny * bestTuck(next, o.id) : 0;
        return ["up", "down"].map((side) => ({ type: "recruit", ...o, side, v: tuckValue(p, o.id, side) + deny }));
      });
      if (!opts.length) return { type: "pass" };
      opts.forEach((o) => (o.v += Math.random() * 0.3));
      opts.sort((a, b) => b.v - a.v);
      return { ...opts[0], considered: opts.slice(0, 3) }; // top options, for the AI reasoning log
    },
    choose(p, info, buttons) {
      usesMemo = {};
      const idx = (f) => buttons.reduce((best, b, i) => (f(b.value) > f(buttons[best].value) ? i : best), 0);
      const x = P(p);
      switch (info.kind) {
        case "spend":
          return 0;
        case "spendGood":
          return idx((g) => -goodValue(g, x.goods[g] - 1, p)); // the least useful good
        case "send":
          return idx((id) => locValue(p, id));
        case "moveFrom": {
          // Best move = the (from, to) pair with the largest gain: value at the destination minus value of staying.
          // Never move a troop just moved (no back-and-forth); stop when no move gains enough.
          const froms = buttons.map((b) => b.value).filter((id) => id !== null && !(info.arrived || []).includes(id));
          let best = { gain: 0.5, from: null, to: null };
          froms.forEach((from) =>
            LOCATIONS.forEach((l) => {
              if (l.id === from) return;
              const gain = locValue(p, l.id) - keepValue(p, from);
              if (gain > best.gain) best = { gain, from, to: l.id };
            }),
          );
          movePlan[p] = best.to;
          return buttons.findIndex((b) => b.value === best.from);
        }
        case "moveTo": {
          const i = buttons.findIndex((b) => b.value === movePlan[p]);
          return i >= 0 ? i : idx((id) => locValue(p, id));
        }
        case "runDeck":
          return idx((k) => deckRunValue(p, info.decks[k], info.limit));
        case "draw": {
          // Behind: losing the haul matters less (riskBehind < 1 pushes further).
          const haul = info.haul.reduce((t, c) => t + c.n, 0) * (lead(p) < 0 ? w.riskBehind : 1);
          return drawEV(info.heat, info.limit, info.deck, haul) > 0 ? 0 : 1;
        }
        case "stim": // a Stim forces another draw: only worth it against a card that would bust you
          return buttons.findIndex((b) => b.value === info.heat + info.card.heat > info.limit);
        case "order": // choices come in activationOrder
          return 0;
        case "keep": {
          const base = upcoming().at.reduce((t, id) => t + S.troops[id][p], 0) + x.schemes.reduce((t, id) => t + (CARDS[id].str === "x2" ? 0 : CARDS[id].str), 0);
          return idx((id) => (CARDS[id].str === "x2" ? base : CARDS[id].str));
        }
        case "choice":
          return idx((g) => goodValue(g, x.goods[g], p)); // the most useful good among those offered (full ones are not)
        case "arms":
          return Math.round(w.arms * (buttons.length - 1));
        default:
          return 0;
      }
    },
  };
}
