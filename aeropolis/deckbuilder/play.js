// Hot-seat playtest table (see rules.html). Cards come from deck-data.js and the
// board from board-data.js; effects are resolved by parsing the card text, so an
// edit there shows up here with no extra step. Text the parser does not know is
// logged with a ⚠ — apply it by hand with the Adjust controls.

const LINES = ["citizen", "outcast"];
const OTHER = { citizen: "outcast", outcast: "citizen" };
const LINE_LABEL = { citizen: "Citizen", outcast: "Outcast", any: "Broker" };
const HAND_SIZE = 4;
const STARTING_COINS = 2;
const CONFLICT_DECK_SIZE = 6;
const STARTING_CUBES = 1; // per location
const REVOLUTION_ROUNDS = 3;
const TOP = SPIRE_SPACES;
const SAVE_KEY = "aeropolis-playtest";

const CARDS = Object.fromEntries([...DECK, ...MARKET].map((c) => [c.title, c]));
const CONFLICT_CARDS = Object.fromEntries(
  [...CONFLICTS, ...REVOLUTION_CONFLICTS].map((c) => [c.title, c])
);
const CHARS = Object.fromEntries(CHARACTERS.map((c) => [c.title, c]));
const LOC = Object.fromEntries(LOCATIONS.map((l) => [l.name, l]));
const MARKET_SLOTS = LOCATIONS.find((l) => l.marketSlots).marketSlots;
const capOf = (loc) => loc.slots || 2;

let state = null;
let history = [];
let pending = null; // the open prompt, if any
let busy = false; // an action is resolving
const peek = new Set(); // players whose hand is shown while it is not their turn

class Abort extends Error {}

/* ---------- utils ---------- */

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const clone = (o) => JSON.parse(JSON.stringify(o));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const pIndex = (p) => state.players.indexOf(p);
const who = (p) => `<b class="pname p${pIndex(p)}">${escapeHtml(p.name)}</b>`;
const charOf = (p, line) => CHARS[p.chars[line]];

function log(html) {
  state.log.push(html);
}

/* ---------- effect text parser ---------- */

const PATTERNS = [
  [/^once per round,?/i, () => null],
  [/^for each card in your other line:?/i, () => ({ op: "foreach" })],
  [/^(\d+)\s+coins?\b/i, (m) => ({ op: "coin", n: +m[1] })],
  [/^coins?\b/i, () => ({ op: "coin", n: 1 })],
  [
    /^(rise|sink)s?\b(?:\s+(citizen|outcast))?(?:\s+(\d+))?/i,
    (m) => ({
      op: "move",
      dir: /rise/i.test(m[1]) ? 1 : -1,
      who: m[2]?.toLowerCase(),
      n: m[3] ? +m[3] : 1,
    }),
  ],
  [/^draw\s+(\d+)\s+cards?/i, (m) => ({ op: "draw", n: +m[1] })],
  [/^cube\b/i, () => ({ op: "plant", n: 1 })],
  [/^refresh\s+(\d+)/i, (m) => ({ op: "refresh", n: +m[1] })],
  [/^intrigue\s+(\d+)/i, (m) => ({ op: "intrigue", n: +m[1] })],
  [/^discard\s+(\d+)\s+cards?/i, (m) => ({ op: "discard", n: +m[1] })],
  [/^trash\s+(?:a|an|1)\s+cards?(?:\s+from\s+your\s+hand\s+or\s+discard)?/i, () => ({ op: "trash", n: 1 })],
  [/^buy\s+1\s+card(?:,?\s*paying\s+its\s+coin\s+cost)?/i, () => ({ op: "buy", n: 1 })],
  [/^your next card played into this line costs nothing/i, () => ({ op: "freeNext" })],
  [/^repeat the effect of every slotted card in your other line/i, () => ({ op: "echo" })],
  [/^may not commit an intrigue/i, () => ({ op: "noCommit" })],
  [/^or\b/i, () => ({ op: "or" })],
];

function tokenize(text) {
  const ops = [];
  const unknown = [];
  let rest = text || "";
  for (;;) {
    rest = rest.replace(/^[\s,.;:]+/, "");
    if (!rest) break;
    const hit = PATTERNS.find(([re]) => re.test(rest));
    if (hit) {
      const m = rest.match(hit[0]);
      const op = hit[1](m);
      if (op) ops.push(op);
      rest = rest.slice(m[0].length);
    } else {
      const word = rest.match(/^\S+/)[0];
      unknown.push(word);
      rest = rest.slice(word.length);
    }
  }
  return { ops, unknown: unknown.join(" ") };
}

// "cost → payoff"; a payoff may offer alternatives split by "or".
function parseEffect(text) {
  const [costText, gainText] = text.includes("→") ? text.split("→") : ["", text];
  const cost = tokenize(costText);
  const gain = tokenize(gainText);
  const alts = [[]];
  gain.ops.forEach((op) => (op.op === "or" ? alts.push([]) : alts.at(-1).push(op)));
  return {
    cost: cost.ops,
    alts,
    unknown: [cost.unknown, gain.unknown].filter(Boolean).join(" "),
  };
}

function describeOps(ops) {
  return ops
    .map((op) => {
      switch (op.op) {
        case "coin": return `${op.n} coin`;
        case "move": return `${op.dir > 0 ? "Rise" : "Sink"}${op.who ? " " + LINE_LABEL[op.who] : ""} ${op.n}`;
        case "draw": return `Draw ${op.n} card`;
        case "plant": return "cube";
        case "refresh": return `Refresh ${op.n}`;
        case "intrigue": return `Intrigue ${op.n}`;
        case "discard": return `Discard ${op.n} card`;
        case "trash": return "Trash a card";
        case "buy": return "Buy 1 card";
        case "foreach": return "for each card in your other line:";
        default: return op.op;
      }
    })
    .join(" ");
}

// Conflict Conditions name a subject, then an effect.
function parseCondition(text) {
  let m;
  let cond;
  if ((m = text.match(/^(the player|player\(s\)) with the (longest line|highest citizen|lowest citizen|highest outcast|lowest outcast):?\s*(.*)$/i))) {
    // "The player" = a unique best only; "Player(s)" = everyone tied for best.
    cond = { kind: "metric", unique: /^the player$/i.test(m[1]), metric: m[2].toLowerCase(), body: m[3] };
  } else if ((m = text.match(/^(?:each|every) losing player:?\s*(.*)$/i))) {
    cond = { kind: "losers", body: m[1] };
  } else if ((m = text.match(/^each player:?\s*(.*)$/i))) {
    cond = { kind: "all", body: m[1] };
  } else {
    cond = { kind: "unknown", body: text };
  }
  const ops = tokenize(cond.body).ops;
  cond.timing = ops.some((o) => o.op === "noCommit")
    ? "during"
    : ops.some((o) => o.op === "intrigue")
      ? "before"
      : "after";
  return cond;
}

function metricValue(p, metric) {
  switch (metric) {
    case "longest line": return Math.max(...LINES.map((l) => p.lines[l].length));
    case "highest citizen": return p.pos.citizen;
    case "lowest citizen": return -p.pos.citizen;
    case "highest outcast": return p.pos.outcast;
    case "lowest outcast": return -p.pos.outcast;
  }
}

function conditionSubjects(cond, winner) {
  const ps = state.players;
  if (cond.kind === "all") return ps;
  if (cond.kind === "losers") return ps.filter((p) => p !== winner);
  if (cond.kind === "metric") {
    const best = Math.max(...ps.map((p) => metricValue(p, cond.metric)));
    const top = ps.filter((p) => metricValue(p, cond.metric) === best);
    return cond.unique && top.length > 1 ? [] : top;
  }
  return [];
}

/* ---------- prompts ---------- */

// Options: { label (html), value, disabled, target (data-target on the table) }.
function ask(title, options, { detail = "", auto = false } = {}) {
  const enabled = options.filter((o) => !o.disabled);
  if (auto && enabled.length === 1) return Promise.resolve(enabled[0].value);
  return new Promise((resolve, reject) => {
    pending = { title, options, detail, resolve, reject };
    render();
  });
}

function answer(value) {
  const p = pending;
  pending = null;
  p.resolve(value);
}

function cancelPrompt() {
  const p = pending;
  pending = null;
  p.reject(new Abort());
}

// Every state change runs through here: snapshot for Undo, abort restores it.
async function act(fn, { endsTurn = false } = {}) {
  if (busy || state.over) return;
  busy = true;
  const snap = clone(state);
  try {
    await fn();
    history.push(snap);
    if (history.length > 100) history.shift();
    // A free action (e.g. an ability discarding the last card) can also leave
    // the active player with nothing to do.
    const stuck = state.phase === "action" && isDone(state.players[state.active]);
    if ((endsTurn || stuck) && !state.over) endTurn();
  } catch (e) {
    state = snap;
    if (!(e instanceof Abort)) {
      console.error(e);
      log(`⚠ Error: ${escapeHtml(e.message)} — action undone.`);
    }
  }
  busy = false;
  save();
  render();
}

function undo() {
  if (busy || !history.length) return;
  state = history.pop();
  save();
  render();
}

/* ---------- game state ---------- */

function newGame(setup) {
  state = {
    round: 0,
    phase: "action",
    active: 0,
    over: false,
    result: null,
    revolution: false,
    revolutionRoundsDone: 0,
    conflictDeck: shuffle(CONFLICTS.map((c) => c.title)).slice(0, CONFLICT_DECK_SIZE),
    conflict: null,
    conflictIsRevolution: false,
    locations: Object.fromEntries(LOCATIONS.map((l) => [l.name, Math.min(STARTING_CUBES, capOf(l))])),
    market: { deck: shuffle(MARKET.map((c) => c.title)), offer: [], discard: [] },
    players: setup.map((s) => ({
      name: s.name,
      chars: { citizen: s.citizen, outcast: s.outcast },
      pos: { citizen: TOP, outcast: 1 },
      coins: STARTING_COINS,
      deck: shuffle(DECK.map((c) => c.title)),
      hand: [],
      discard: [],
      trash: [],
      lines: { citizen: [], outcast: [] },
      charCubes: { citizen: 0, outcast: 0 },
      used: { citizen: false, outcast: false },
      freeNext: { citizen: false, outcast: false },
      intrigueBonus: 0,
    })),
    log: [],
  };
  history = [];
  peek.clear();
  if (CONFLICTS.length < CONFLICT_DECK_SIZE) {
    log(`⚠ Setup asks for ${CONFLICT_DECK_SIZE} Conflict cards; only ${CONFLICTS.length} exist, using all of them.`);
  }
  for (let i = 0; i < MARKET_SLOTS; i++) state.market.offer.push(drawMarket());
  startRound();
  save();
  render();
}

function drawMarket() {
  const m = state.market;
  if (!m.deck.length) {
    m.deck = shuffle(m.discard);
    m.discard = [];
  }
  return m.deck.pop() ?? null;
}

function startRound() {
  state.round++;
  state.phase = "draw";
  log(`<span class="log-round">Round ${state.round}</span>`);
  if (!state.conflictDeck.length) startRevolution("the Conflict deck is exhausted");
  revealConflict();
  state.players.forEach((p) => draw(p, HAND_SIZE));
  state.phase = "action";
  state.active = 0;
}

function revealConflict() {
  state.conflict = state.conflictDeck.pop();
  state.conflictIsRevolution = state.revolution;
  log(`Conflict revealed: <b>${escapeHtml(state.conflict)}</b>.`);
}

function startRevolution(reason) {
  if (state.revolution) return;
  state.revolution = true;
  state.conflictDeck = shuffle(REVOLUTION_CONFLICTS.map((c) => c.title));
  log(`<span class="log-rev">The Revolution begins</span> — ${reason}.`);
  // Playtest: a Revolution triggered mid-round replaces the current conflict.
  if (state.phase === "action") revealConflict();
}

function draw(p, n) {
  for (let i = 0; i < n; i++) {
    if (!p.deck.length) {
      if (!p.discard.length) break;
      p.deck = shuffle(p.discard);
      p.discard = [];
      log(`${who(p)} reshuffles their discard pile.`);
    }
    p.hand.push(p.deck.pop());
  }
}

function move(p, line, delta) {
  const before = p.pos[line];
  p.pos[line] = clamp(before + delta, 1, TOP);
  if (p.pos[line] !== before) {
    log(`${who(p)}'s ${LINE_LABEL[line]} ${delta > 0 ? "rises" : "sinks"} ${before} → ${p.pos[line]}.`);
  }
  checkMeet(p);
}

function checkMeet(p) {
  if (p.pos.outcast < p.pos.citizen) return;
  if (p.pos.citizen === TOP && p.pos.outcast === TOP) {
    endGame(`${escapeHtml(p.name)}'s Citizen and Outcast meet at the top of the Spire`, p);
    return;
  }
  if (state.revolution) return;
  startRevolution(`${escapeHtml(p.name)}'s Citizen and Outcast meet`);
  p.pos.citizen = Math.min(TOP, p.pos.citizen + 2);
  p.pos.outcast = Math.min(TOP, p.pos.outcast + 2);
  log(`${who(p)} raises Citizen and Outcast by 2 (→ ${p.pos.citizen} / ${p.pos.outcast}).`);
  if (p.pos.citizen === TOP && p.pos.outcast === TOP) {
    endGame(`${escapeHtml(p.name)}'s Citizen and Outcast meet at the top of the Spire`, p);
  }
}

const vpOf = (p) => spireVp(Math.min(p.pos.citizen, p.pos.outcast));

function endGame(reason, winner = null) {
  if (state.over) return;
  const scores = state.players.map((p) => ({ name: p.name, vp: vpOf(p) }));
  if (!winner) {
    const best = Math.max(...scores.map((s) => s.vp));
    const top = state.players.filter((p) => vpOf(p) === best);
    winner = top.length === 1 ? top[0] : null;
  }
  state.over = true;
  state.result = { reason, winner: winner ? winner.name : null, scores };
  log(`<span class="log-rev">Game over</span> — ${reason}.`);
}

const isDone = (p) => !p.hand.length && !LINES.some((l) => p.lines[l].some((c) => c.faceDown));

function endTurn() {
  const n = state.players.length;
  for (let k = 1; k <= n; k++) {
    const i = (state.active + k) % n;
    if (!isDone(state.players[i])) {
      state.active = i;
      return;
    }
  }
  state.phase = "conflict";
  log("Every player is done — resolve the conflict.");
}

/* ---------- effect execution ---------- */

// ctx: { p, line (null = ask when needed), card (the placed card, if any),
//        plantLines, echo, source, autoPay }
async function resolveText(ctx, text) {
  if (!text || !text.trim()) return;
  const eff = parseEffect(text);
  const src = escapeHtml(ctx.source);
  if (eff.unknown) {
    log(`⚠ ${src}: could not parse “${escapeHtml(eff.unknown)}” in “${escapeHtml(text)}” — apply it by hand.`);
  }
  if (eff.cost.length) {
    const why = cannotPay(ctx, eff.cost);
    if (why) {
      log(`${who(ctx.p)} cannot pay for ${src} (${why}).`);
      return;
    }
    const pay =
      ctx.autoPay ||
      (await ask(`${ctx.source}: pay the cost?`, [
        { label: `Pay: ${withIcons(text)}`, value: true },
        { label: "Skip", value: false },
      ]));
    if (!pay) return;
    await runOps(ctx, eff.cost, true);
  }
  let ops = eff.alts[0];
  if (eff.alts.length > 1) {
    ops = await ask(
      `${ctx.source}: choose one`,
      eff.alts.map((a) => ({ label: withIcons(describeOps(a)), value: a }))
    );
  }
  await runOps(ctx, ops);
}

function cannotPay(ctx, ops) {
  const p = ctx.p;
  for (const op of ops) {
    if (op.op === "coin" && p.coins < op.n) return "not enough coin";
    if (op.op === "discard" && p.hand.length < op.n) return "not enough cards in hand";
    if (op.op === "move" && op.dir < 0) {
      const line = op.who || ctx.line;
      if (line && p.pos[line] - op.n < 1) return `${LINE_LABEL[line]} cannot sink`;
    }
  }
  return null;
}

async function askLine(ctx, why) {
  return ask(`${ctx.source}: ${why} which character?`, LINES.map((l) => ({ label: LINE_LABEL[l], value: l })));
}

// asCost: the cost half of "cost → payoff" — coin is paid, not gained.
async function runOps(ctx, ops, asCost = false) {
  const p = ctx.p;
  let mult = 1;
  for (const op of ops) {
    if (op.op === "foreach") {
      const line = ctx.line || (await askLine(ctx, "other line of"));
      mult = p.lines[OTHER[line]].length;
      continue;
    }
    const n = (op.n || 1) * mult;
    switch (op.op) {
      case "coin":
        p.coins += asCost ? -n : n;
        break;
      case "move": {
        const line = op.who || ctx.line || (await askLine(ctx, op.dir > 0 ? "Rise" : "Sink"));
        move(p, line, op.dir * n);
        break;
      }
      case "draw":
        draw(p, n);
        log(`${who(p)} draws ${n}.`);
        break;
      case "plant":
        for (let i = 0; i < n && !ctx.echo; i++) await plant(ctx);
        break;
      case "refresh":
        for (let i = 0; i < n; i++) await refresh(ctx);
        break;
      case "intrigue":
        p.intrigueBonus += n;
        log(`${who(p)} gains Intrigue ${n} for this conflict.`);
        break;
      case "discard":
        for (let i = 0; i < n; i++) {
          const hi = await ask(
            `${ctx.source}: discard a card`,
            p.hand.map((t, i) => ({ label: escapeHtml(t), value: i, target: `hand:${pIndex(p)}:${i}` }))
          );
          log(`${who(p)} discards ${escapeHtml(p.hand[hi])}.`);
          p.discard.push(...p.hand.splice(hi, 1));
        }
        break;
      case "trash":
        await trash(ctx);
        break;
      case "buy":
        await buy(ctx);
        break;
      case "freeNext": {
        const line = ctx.line || (await askLine(ctx, "free next card for"));
        p.freeNext[line] = true;
        log(`${who(p)}'s next ${LINE_LABEL[line]} card costs nothing.`);
        break;
      }
      case "echo":
        if (!ctx.echo) await echo(ctx);
        break;
    }
    if (op.op === "coin") log(`${who(p)} ${asCost ? "pays" : "gains"} ${withIcons(`${n} coin`)}.`);
  }
}

async function plant(ctx) {
  const p = ctx.p;
  const pi = pIndex(p);
  const lines = ctx.plantLines || (ctx.line ? [ctx.line] : LINES);
  const opts = [];
  for (const line of lines) {
    const ch = charOf(p, line);
    if (p.charCubes[line] < ch.sockets) {
      opts.push({
        label: `${escapeHtml(ch.title)} (${p.charCubes[line]}/${ch.sockets})`,
        value: { line, char: true },
        target: `char:${pi}:${line}`,
      });
    }
    p.lines[line].forEach((pc, ci) => {
      // Plant goes into another card's socket, never the card doing the planting.
      if (pc.faceDown || pc === ctx.card) return;
      pc.cubes.forEach((filled, si) => {
        if (filled) return;
        opts.push({
          label: `${escapeHtml(pc.title)}: ${withIcons(CARDS[pc.title].slots[si].text) || "—"}`,
          value: { line, ci, si },
          target: `slot:${pi}:${line}:${ci}:${si}`,
        });
      });
    });
  }
  if (!opts.length) {
    log(`${who(p)} has no empty slot to plant into.`);
    return;
  }
  const t = await ask(`${ctx.source}: plant a cube`, opts, { auto: true });
  if (t.char) {
    await addCharCube(p, t.line);
    return;
  }
  const pc = p.lines[t.line][t.ci];
  pc.cubes[t.si] = true;
  log(`${who(p)} plants a cube on ${escapeHtml(pc.title)}.`);
  await resolveText({ p, line: t.line, card: pc, source: pc.title }, CARDS[pc.title].slots[t.si].text);
}

// A character pays its Reward once all its sockets are filled, then empties.
async function addCharCube(p, line) {
  const ch = charOf(p, line);
  p.charCubes[line]++;
  log(`${who(p)} plants a cube on ${escapeHtml(ch.title)} (${p.charCubes[line]}/${ch.sockets}).`);
  if (p.charCubes[line] < ch.sockets) return;
  p.charCubes[line] = 0;
  log(`${who(p)}'s ${escapeHtml(ch.title)} is full — Reward.`);
  await resolveText({ p, line, source: `${ch.title} reward` }, ch.reward);
}

async function refresh(ctx) {
  const m = state.market;
  const opts = m.offer
    .map((t, i) => ({ label: escapeHtml(t), value: i, target: `market:${i}` }))
    .filter((o) => m.offer[o.value]);
  if (!opts.length) return;
  const i = await ask(`${ctx.source}: Refresh — discard a card on offer`, [...opts, { label: "Skip", value: -1 }]);
  if (i < 0) return;
  log(`${who(ctx.p)} refreshes ${escapeHtml(m.offer[i])} out of the Noodle Shop.`);
  m.discard.push(m.offer[i]);
  m.offer[i] = drawMarket();
}

async function buy(ctx) {
  const p = ctx.p;
  const m = state.market;
  const opts = m.offer
    .map((t, i) => ({
      label: t ? `${escapeHtml(t)} — ${withIcons(`${CARDS[t].cost} coin`)}` : "—",
      value: i,
      disabled: !t || CARDS[t].cost > p.coins,
      target: `market:${i}`,
    }));
  const i = await ask(`${ctx.source}: buy a card`, [...opts, { label: "Buy nothing", value: -1 }]);
  if (i < 0) return;
  const title = m.offer[i];
  p.coins -= CARDS[title].cost;
  p.discard.push(title);
  m.offer[i] = drawMarket();
  log(`${who(p)} buys ${escapeHtml(title)} for ${withIcons(`${CARDS[title].cost} coin`)} (to discard pile).`);
}

async function trash(ctx) {
  const p = ctx.p;
  const pi = pIndex(p);
  const opts = [
    ...p.hand.map((t, i) => ({ label: `Hand: ${escapeHtml(t)}`, value: { from: "hand", i }, target: `hand:${pi}:${i}` })),
    ...p.discard.map((t, i) => ({ label: `Discard: ${escapeHtml(t)}`, value: { from: "discard", i } })),
  ];
  const pick = await ask(`${ctx.source}: trash a card`, [...opts, { label: "Trash nothing", value: null }]);
  if (!pick) return;
  const [title] = p[pick.from].splice(pick.i, 1);
  p.trash.push(title);
  log(`${who(p)} trashes ${escapeHtml(title)}.`);
}

// Repeats every slotted socket in the other line; never moves cubes.
async function echo(ctx) {
  const p = ctx.p;
  const other = OTHER[ctx.line];
  for (const pc of p.lines[other]) {
    if (pc.faceDown) continue;
    const slots = CARDS[pc.title].slots;
    for (let si = 0; si < slots.length; si++) {
      if (!pc.cubes[si]) continue;
      await resolveText({ p, line: other, card: pc, echo: true, source: `Echo → ${pc.title}` }, slots[si].text);
    }
  }
}

/* ---------- rules helpers ---------- */

function playCost(p, line) {
  if (p.freeNext[line]) return 0;
  const costs = charOf(p, line).playCosts;
  return costs[Math.min(p.lines[line].length, costs.length - 1)];
}

function unlocked(p, loc) {
  return !loc.unlock || p.pos[loc.unlock.track] >= loc.unlock.level;
}

function eligibleLocations(p, line) {
  return LOCATIONS.filter(
    (l) => (l.side === line || l.side === "shared") && state.locations[l.name] > 0 && unlocked(p, l)
  );
}

function currentCondition() {
  return parseCondition(CONFLICT_CARDS[state.conflict].condition);
}

function commitBlocked(p) {
  const cond = currentCondition();
  return cond.timing === "during" && conditionSubjects(cond, null).includes(p);
}

function conflictTotal(p) {
  const committed = LINES.flatMap((l) => p.lines[l]).filter((c) => c.intrigue);
  return committed.reduce((sum, c) => sum + CARDS[c.title].conflictValue, 0) + p.intrigueBonus;
}

function abilityText(ch) {
  const m = ch.ability.match(/^once per round,?\s*(.+)$/i);
  return m ? m[1] : null;
}

/* ---------- player actions ---------- */

// Every way a card can be played, each with why it cannot (null = allowed).
function playOptions(p, title) {
  const card = CARDS[title];
  const lines = card.line === "any" ? LINES : [card.line];
  return lines.flatMap((line) => {
    const cost = playCost(p, line);
    const locs = eligibleLocations(p, line);
    return [false, true].map((faceDown) => {
      let why = null;
      if (p.coins < cost) why = "not enough coin";
      else if (!locs.length) why = "no eligible location has a cube";
      else if (faceDown && p.pos[line] <= 1) why = `${LINE_LABEL[line]} cannot sink`;
      else if (faceDown && commitBlocked(p)) why = "blocked by this round's Condition";
      return { line, faceDown, cost, why };
    });
  });
}

async function playCard(p, hi) {
  const title = p.hand[hi];
  const card = CARDS[title];
  const opts = playOptions(p, title).map(({ line, faceDown, cost, why }) => ({
    label: `${faceDown ? "Face down (Intrigue)" : "Face up"} → ${LINE_LABEL[line]} line · ${
      cost ? withIcons(`${cost} coin`) : "free"
    }${faceDown ? ` · ${withIcons(`Sink ${LINE_LABEL[line]} 1`)}` : ""}${why ? ` <em>(${why})</em>` : ""}`,
    value: { line, faceDown },
    disabled: !!why,
  }));
  const { line, faceDown } = await ask(`Play ${title}`, opts, { detail: cardHtml(title) });
  const cost = playCost(p, line);
  if (p.freeNext[line]) p.freeNext[line] = false;
  p.coins -= cost;
  p.hand.splice(hi, 1);

  const locName = await ask(
    "Recruit a cube from",
    eligibleLocations(p, line).map((l) => ({
      label: `${escapeHtml(l.name)} — ${withIcons(l.reward)}`,
      value: l.name,
      target: `loc:${l.name}`,
    }))
  );
  state.locations[locName]--;
  const pc = { title, faceDown, intrigue: false, cubes: card.slots.map(() => false) };
  p.lines[line].push(pc);
  log(
    `${who(p)} plays ${faceDown ? "a card face down" : escapeHtml(title)} into their ${LINE_LABEL[line]} line${
      cost ? ` for ${withIcons(`${cost} coin`)}` : ""
    }, recruiting from ${escapeHtml(locName)}.`
  );

  const runLoc = () => resolveText({ p, line, card: pc, source: locName }, LOC[locName].reward);
  if (faceDown) {
    move(p, line, -1);
    await runLoc();
  } else {
    const si = await ask(
      "Slot the recruit into",
      card.slots.map((s, i) => ({ label: withIcons(s.text) || "—", value: i, target: `slot:${pIndex(p)}:${line}:${p.lines[line].length - 1}:${i}` })),
      { auto: true }
    );
    pc.cubes[si] = true;
    const slotText = card.slots[si].text;
    const runSlot = () => resolveText({ p, line, card: pc, source: title }, slotText);
    const locFirst =
      !slotText.trim() ||
      (await ask("Resolve first", [
        { label: `${escapeHtml(locName)}: ${withIcons(LOC[locName].reward)}`, value: true },
        { label: `${escapeHtml(title)}: ${withIcons(slotText)}`, value: false },
      ]));
    if (locFirst) {
      await runLoc();
      await runSlot();
    } else {
      await runSlot();
      await runLoc();
    }
  }

  // Passive character abilities, e.g. "Play 3 cards on this line → Rise 1."
  const ch = charOf(p, line);
  const passive = ch.ability.match(/^play (\d+) cards on this line\s*(→.*)$/i);
  if (passive && p.lines[line].length === +passive[1]) {
    await resolveText({ p, line, source: ch.title, autoPay: true }, passive[2]);
  }
}

async function discardHand(p) {
  const cards = p.hand.splice(0);
  log(`${who(p)} discards their hand (${cards.map(escapeHtml).join(", ")}).`);
  for (const title of cards) {
    p.discard.push(title);
    const c = CARDS[title];
    await resolveText({ p, line: c.line === "any" ? null : c.line, source: `${title} (discard)` }, c.discardEffect);
  }
}

async function resolveIntrigue(p) {
  const pi = pIndex(p);
  const candidates = LINES.map((line) => {
    const ci = p.lines[line].findLastIndex((c) => c.faceDown);
    return ci < 0 ? null : { line, ci };
  }).filter(Boolean);
  const { line, ci } = await ask(
    "Flip the rightmost face-down card of",
    candidates.map((c) => ({
      label: `${LINE_LABEL[c.line]} line: ${escapeHtml(p.lines[c.line][c.ci].title)}`,
      value: c,
      target: `card:${pi}:${c.line}:${c.ci}`,
    })),
    { auto: true }
  );
  const pc = p.lines[line][ci];
  const card = CARDS[pc.title];
  const where = await ask(`${pc.title}: socket the cube in`, [
    { label: `Normal socket — resolve ${card.slots.map((s) => withIcons(s.text) || "—").join(" / ")}`, value: "normal" },
    { label: `Intrigue socket — ${card.conflictValue} toward the conflict`, value: "intrigue" },
  ], { detail: cardHtml(pc.title) });
  pc.faceDown = false;
  if (where === "intrigue") {
    pc.intrigue = true;
    log(`${who(p)} flips ${escapeHtml(pc.title)} into the Intrigue socket (${card.conflictValue}).`);
    return;
  }
  const si = await ask(
    "Socket",
    card.slots.map((s, i) => ({ label: withIcons(s.text) || "—", value: i })),
    { auto: true }
  );
  pc.cubes[si] = true;
  log(`${who(p)} flips ${escapeHtml(pc.title)} into its normal socket.`);
  await resolveText({ p, line, card: pc, source: pc.title }, card.slots[si].text);
}

async function useAbility(p, line) {
  const ch = charOf(p, line);
  p.used[line] = true;
  log(`${who(p)} uses ${escapeHtml(ch.title)}'s ability.`);
  await resolveText({ p, line, source: ch.title, autoPay: true }, abilityText(ch));
}

/* ---------- round end ---------- */

async function resolveConflict() {
  const c = CONFLICT_CARDS[state.conflict];
  const cond = currentCondition();
  const ctxFor = (p, source) => ({ p, line: c.line, plantLines: LINES, source });

  if (cond.timing === "before") {
    for (const p of conditionSubjects(cond, null)) await resolveText(ctxFor(p, `${c.title} condition`), cond.body);
  }
  const totals = state.players.map(conflictTotal);
  log(`${escapeHtml(c.title)}: ${state.players.map((p, i) => `${who(p)} ${totals[i]}`).join(" vs ")}.`);

  // Highest total wins; ties break on Citizen, then Outcast position.
  const ranked = state.players
    .map((p, i) => ({ p, key: [totals[i], p.pos.citizen, p.pos.outcast] }))
    .sort((a, b) => b.key[0] - a.key[0] || b.key[1] - a.key[1] || b.key[2] - a.key[2]);
  const [first, second] = ranked;
  const tied = second && first.key.every((v, i) => v === second.key[i]);
  const winner = first.key[0] > 0 && !tied ? first.p : null;

  if (winner) {
    log(`${who(winner)} wins the conflict.`);
    await resolveText(ctxFor(winner, `${c.title} reward`), c.reward);
  } else {
    log("No winner — the reward is discarded.");
  }
  if (cond.timing === "after") {
    for (const p of conditionSubjects(cond, winner)) await resolveText(ctxFor(p, `${c.title} condition`), cond.body);
  }
  if (cond.kind === "unknown") log(`⚠ Condition not understood: “${escapeHtml(c.condition)}” — apply it by hand.`);

  if (state.conflictIsRevolution && ++state.revolutionRoundsDone >= REVOLUTION_ROUNDS) {
    endGame(`${REVOLUTION_ROUNDS} Revolution rounds resolved`);
    return;
  }
  state.phase = "replenish";
}

function replenish() {
  const c = CONFLICT_CARDS[state.conflict];
  let left = 2 * state.players.length + c.refill;
  let i = LOCATIONS.findIndex((l) => l.name === c.refillStart);
  if (i < 0) {
    log(`⚠ Refill start “${escapeHtml(c.refillStart)}” is not a board location; starting at ${escapeHtml(LOCATIONS[0].name)}.`);
    i = 0;
  }
  let placed = 0;
  while (left > 0 && LOCATIONS.some((l) => state.locations[l.name] < capOf(l))) {
    const loc = LOCATIONS[i++ % LOCATIONS.length];
    if (state.locations[loc.name] < capOf(loc)) {
      state.locations[loc.name]++;
      left--;
      placed++;
    }
  }
  log(`Replenish: ${placed} cubes placed from ${escapeHtml(c.refillStart)}${left ? ` (${left} unused, board full)` : ""}.`);
  for (const p of state.players) {
    for (const line of LINES) {
      p.discard.push(...p.lines[line].map((pc) => pc.title));
      p.lines[line] = [];
    }
    p.used = { citizen: false, outcast: false };
    p.freeNext = { citizen: false, outcast: false };
    p.intrigueBonus = 0;
  }
  startRound();
}

/* ---------- rendering ---------- */

function cardHtml(title, { pc = null, target = null, action = "" } = {}) {
  const c = CARDS[title];
  const cardTarget = target ? ` data-target="${target.replace(/^slot/, "card")}"` : "";
  // A face-down card shows its back, with the Intrigue cube on top.
  if (pc?.faceDown) {
    return `
      <div class="pcard is-down"${cardTarget} title="${escapeHtml(title)} (face down)">
        <span class="back-glyph">${c.glyph}</span>
        <span class="cube on top-cube"></span>
        <span class="back-title">${escapeHtml(title)}</span>
      </div>`;
  }
  const slots = c.slots
    .map(
      (s, si) =>
        `<div class="pslot${pc?.cubes[si] ? " filled" : ""}"${target ? ` data-target="${target}:${si}"` : ""}>
          <span class="sock"></span><span>${withIcons(s.text) || "<em>no effect</em>"}</span>
        </div>`
    )
    .join("");
  return `
    <div class="pcard side-${c.line}${pc?.intrigue ? " in-intrigue" : ""}${action ? " clickable" : ""}" ${action}${cardTarget}>
      <div class="pcard-head">
        <b>${escapeHtml(title)}</b>
        <span class="line-badge">${LINE_LABEL[c.line]}</span>
      </div>
      <div class="pcard-art">
        <span class="art-glyph">${c.glyph}</span>
        ${c.cost != null ? `<span class="price">${withIcons(`${c.cost} coin`)}</span>` : ""}
        <span class="intrigue-badge${pc?.intrigue ? " filled" : ""}" title="Intrigue value${pc?.intrigue ? " — cube in the Intrigue socket" : ""}">${c.conflictValue}</span>
      </div>
      <div class="pcard-body">${slots}</div>
      <div class="pcard-foot" title="Discard effect">Discard ${withIcons(c.discardEffect)}</div>
    </div>`;
}

function statusHtml() {
  const s = state;
  const active = s.players[s.active];
  const phase = {
    action: `${who(active)} to act`,
    conflict: "Resolve the conflict",
    replenish: "Replenish and start the next round",
  }[s.phase];
  const buttons = s.over
    ? ""
    : s.phase === "conflict"
      ? `<button class="btn primary" data-action="conflict">Resolve conflict</button>`
      : s.phase === "replenish"
        ? `<button class="btn primary" data-action="replenish">Replenish → next round</button>`
        : "";
  return `
    <div class="status-info">
      <span>Round <b>${s.round}</b></span>
      <span>${s.over ? "Game over" : phase}</span>
      <span>${s.revolution ? `<b class="rev">Revolution</b> ${s.revolutionRoundsDone}/${REVOLUTION_ROUNDS} resolved` : `Conflicts left: ${s.conflictDeck.length}`}</span>
    </div>
    <div class="status-buttons">
      ${buttons}
      <button class="btn" data-action="undo" ${history.length && !busy ? "" : "disabled"}>Undo</button>
      <button class="btn" data-action="new">New game</button>
    </div>`;
}

function conflictHtml() {
  const c = CONFLICT_CARDS[state.conflict];
  const totals = state.players.map((p) => `${who(p)} ${conflictTotal(p)}`).join(" · ");
  return `
    <div class="conflict side-${c.line}${state.conflictIsRevolution ? " revolution" : ""}">
      <p class="mini-label">${state.conflictIsRevolution ? "Revolution conflict" : "Conflict"} · ${LINE_LABEL[c.line]}</p>
      <h3><span class="glyph">${c.glyph}</span> ${escapeHtml(c.title)}</h3>
      <p><span class="k">Reward</span> ${withIcons(c.reward)}</p>
      <p><span class="k">Condition</span> ${withIcons(c.condition)}</p>
      <p><span class="k">Refill</span> from ${escapeHtml(c.refillStart)} · +${c.refill}</p>
      <p class="totals"><span class="k">Intrigue</span> ${totals}</p>
    </div>`;
}

function locationsHtml() {
  const active = state.players[state.active];
  return LOCATIONS.map((l) => {
    const n = state.locations[l.name];
    const cubes = Array.from({ length: capOf(l) }, (_, i) => `<span class="cube${i < n ? " on" : ""}"></span>`).join("");
    const lock = l.unlock
      ? `<p class="lock${unlocked(active, l) ? "" : " locked"}">🔒 ${LINE_LABEL[l.unlock.track]} ≥ ${l.unlock.level}</p>`
      : "";
    return `
      <div class="ploc side-${l.side}" data-target="loc:${escapeHtml(l.name)}" style="--accent:${l.accent}">
        <div class="ploc-head"><span class="glyph">${l.glyph}</span> <b>${escapeHtml(l.name)}</b></div>
        <div class="cubes">${cubes}</div>
        <p class="reward">${withIcons(l.reward)}</p>
        ${lock}
      </div>`;
  }).join("");
}

function marketHtml() {
  const m = state.market;
  return `
    <p class="mini-label">Noodle Shop on offer · deck ${m.deck.length} · discard ${m.discard.length}</p>
    <div class="market">
      ${m.offer.map((t, i) => (t ? `<div data-target="market:${i}">${cardHtml(t)}</div>` : `<div class="empty-slot">empty</div>`)).join("")}
    </div>`;
}

// Rows are drawn once; each token is a persistent element whose `top` moves,
// so a Rise/Sink slides it along the track (transition in play.css).
function renderSpire() {
  const el = document.getElementById("spire");
  if (!el.querySelector(".sp-track")) {
    const rows = Array.from({ length: TOP }, (_, i) => TOP - i)
      .map((space) => `<div class="sp"><span class="sp-no">${space}</span><span class="sp-vp">${spireVp(space)}</span></div>`)
      .join("");
    el.innerHTML = `<p class="mini-label">Spire · VP</p><div class="sp-track">${rows}<div class="sp-tokens"></div></div>`;
  }
  const layer = el.querySelector(".sp-tokens");
  const ids = new Set();
  state.players.forEach((p, pi) =>
    LINES.forEach((line, li) => {
      const id = `tok-${pi}-${line}`;
      ids.add(id);
      let tok = layer.querySelector(`#${id}`);
      if (!tok) {
        tok = document.createElement("span");
        tok.id = id;
        tok.className = `tok p${pi} ${line}`;
        tok.textContent = LINE_LABEL[line][0];
        tok.style.setProperty("--lane", pi * 2 + li);
        layer.append(tok);
      }
      tok.title = `${p.name} ${LINE_LABEL[line]}: ${p.pos[line]}`;
      tok.style.top = `${((TOP - p.pos[line]) / TOP) * 100}%`;
    })
  );
  layer.querySelectorAll(".tok").forEach((t) => ids.has(t.id) || t.remove());
}

function characterHtml(p, pi, line, canAct) {
  const ch = charOf(p, line);
  const sockets = Array.from({ length: ch.sockets }, (_, i) => `<span class="cube${i < p.charCubes[line] ? " on" : ""}"></span>`).join("");
  const next = p.lines[line].length;
  const costs = ch.playCosts
    .map((c, i) => `<span class="${i === Math.min(next, ch.playCosts.length - 1) ? "next" : ""}">${c}</span>`)
    .join("");
  const ability = abilityText(ch);
  const btn =
    ability && canAct
      ? `<button class="btn small" data-action="ability" data-line="${line}" ${
          p.used[line] || cannotPay({ p, line }, parseEffect(ability).cost) ? "disabled" : ""
        }>${p.used[line] ? "Used" : "Use"}</button>`
      : "";
  return `
    <div class="pchar side-${line}" data-target="char:${pi}:${line}">
      <div class="pcard-head"><b>${escapeHtml(ch.title)}</b><span class="line-badge">${LINE_LABEL[line]} · ${ch.glyph}</span></div>
      <div class="pchar-body">
        <div class="cubes">${sockets}</div>
        <p class="costs">Play cost ${p.freeNext[line] ? "<b>next free</b>" : costs}</p>
        <p>${withIcons(ch.ability)} ${btn}</p>
        <p><span class="k">Reward</span> ${withIcons(ch.reward)}</p>
      </div>
    </div>`;
}

function playerHtml(p, pi) {
  const s = state;
  const isActive = s.phase === "action" && s.active === pi && !s.over;
  const canAct = isActive && !busy;
  const lines = LINES.map(
    (line) => `
      <div class="pline">
        ${characterHtml(p, pi, line, canAct)}
        <div class="pline-cards">
          ${p.lines[line].map((pc, ci) => cardHtml(pc.title, { pc, target: `slot:${pi}:${line}:${ci}` })).join("") || `<p class="empty">${LINE_LABEL[line]} line empty</p>`}
        </div>
      </div>`
  ).join("");
  const showHand = isActive || peek.has(pi);
  const hand = showHand
    ? p.hand
        .map((t, i) => {
          const blocked = playOptions(p, t).every((o) => o.why);
          const why = [...new Set(playOptions(p, t).map((o) => o.why))].join("; ");
          const action = canAct && !blocked ? `data-action="play" data-i="${i}"` : "";
          return `<div data-target="hand:${pi}:${i}"${canAct && blocked ? ` class="unplayable" title="Cannot play: ${escapeHtml(why)}"` : ""}>${cardHtml(t, { action })}</div>`;
        })
        .join("")
    : p.hand.map(() => `<div class="card-back"></div>`).join("");
  const hasDown = LINES.some((l) => p.lines[l].some((c) => c.faceDown));
  const actions = canAct
    ? `<div class="actions">
        ${p.hand.length ? `<span class="hint">Click a card to play it, or</span> <button class="btn" data-action="discard">Discard hand</button>` : ""}
        ${!p.hand.length && hasDown ? `<button class="btn primary" data-action="intrigue">Resolve an Intrigue</button>` : ""}
      </div>`
    : "";
  const adjust = [
    ["coins", -1, "−", "coin"], ["coins", 1, "+", "coin"],
    ["citizen", -1, "▼", "Citizen"], ["citizen", 1, "▲", "Citizen"],
    ["outcast", -1, "▼", "Outcast"], ["outcast", 1, "▲", "Outcast"],
    ["intrigue", -1, "−", "Intrigue"], ["intrigue", 1, "+", "Intrigue"],
    ["draw", 1, "+1", "Draw"],
  ]
    .map(([k, d, sym, lbl]) => `<button class="btn tiny" data-action="adjust" data-k="${k}" data-d="${d}" title="${lbl} ${d > 0 ? "+" : "−"}1">${lbl} ${sym}</button>`)
    .join("");
  return `
    <section class="player p${pi}${isActive ? " active" : ""}">
      <header class="player-head">
        <h2>${escapeHtml(p.name)}</h2>
        <span class="stat">${withIcons(`${p.coins} coin`)}</span>
        <span class="stat">Deck ${p.deck.length}</span>
        <span class="stat">Discard ${p.discard.length}</span>
        <span class="stat">Trashed ${p.trash.length}</span>
        <span class="stat">Intrigue ${conflictTotal(p)}</span>
        <span class="stat">${vpOf(p)} VP</span>
        ${isDone(p) && s.phase === "action" ? `<span class="stat done">done</span>` : ""}
      </header>
      ${lines}
      <div class="hand-row">
        <p class="mini-label">Hand (${p.hand.length})
          ${!isActive && p.hand.length ? `<button class="btn tiny" data-action="peek" data-p="${pi}">${peek.has(pi) ? "Hide" : "Peek"}</button>` : ""}
        </p>
        <div class="hand">${hand || `<p class="empty">No cards</p>`}</div>
      </div>
      ${actions}
      <details class="adjust"><summary>Adjust (manual fixes)</summary><div data-p="${pi}">${adjust}</div></details>
    </section>`;
}

function promptHtml() {
  if (!pending) return "";
  const opts = pending.options
    .map((o, i) => `<button class="btn opt" data-opt="${i}" ${o.disabled ? "disabled" : ""}>${o.label}</button>`)
    .join("");
  return `
    <div class="prompt-inner">
      <div>
        <p class="prompt-title">${escapeHtml(pending.title)}</p>
        <div class="prompt-opts">${opts}</div>
      </div>
      ${pending.detail ? `<div class="prompt-detail">${pending.detail}</div>` : ""}
      <button class="btn cancel" data-action="cancel">Cancel action</button>
    </div>`;
}

function resultHtml() {
  const r = state.result;
  if (!r) return "";
  return `
    <div class="result">
      <h2>${r.winner ? `${escapeHtml(r.winner)} wins` : "Tie"}</h2>
      <p>${r.reason}.</p>
      <p>${r.scores.map((s) => `${escapeHtml(s.name)}: ${s.vp} VP`).join(" · ")}</p>
    </div>`;
}

function render() {
  if (!state) return;
  document.getElementById("status").innerHTML = statusHtml();
  document.getElementById("result").innerHTML = resultHtml();
  document.getElementById("conflict").innerHTML = conflictHtml();
  document.getElementById("locations").innerHTML = locationsHtml();
  document.getElementById("market").innerHTML = marketHtml();
  renderSpire();
  document.getElementById("players").innerHTML = state.players.map(playerHtml).join("");
  document.getElementById("prompt").innerHTML = promptHtml();
  document.getElementById("prompt").hidden = !pending;
  document.getElementById("log").innerHTML = [...state.log].reverse().map((l) => `<li>${l}</li>`).join("");

  // Options that name a table element make that element clickable too.
  pending?.options.forEach((o, i) => {
    if (!o.target || o.disabled) return;
    document.querySelectorAll(`[data-target="${CSS.escape(o.target)}"]`).forEach((el) => {
      el.classList.add("pickable");
      el.dataset.opt = i;
    });
  });
}

/* ---------- events ---------- */

document.addEventListener("click", (e) => {
  const optEl = e.target.closest("[data-opt]");
  if (optEl && pending) {
    e.stopPropagation();
    answer(pending.options[+optEl.dataset.opt].value);
    return;
  }
  const el = e.target.closest("[data-action]");
  if (!el || el.disabled) return;
  const p = state?.players[state.active];
  switch (el.dataset.action) {
    case "cancel": return pending && cancelPrompt();
    case "undo": return undo();
    case "new": return openSetup();
    case "peek": {
      const pi = +el.dataset.p;
      peek.has(pi) ? peek.delete(pi) : peek.add(pi);
      return render();
    }
    case "play": return act(() => playCard(p, +el.dataset.i), { endsTurn: true });
    case "discard": return act(() => discardHand(p), { endsTurn: true });
    case "intrigue": return act(() => resolveIntrigue(p), { endsTurn: true });
    case "ability": return act(() => useAbility(p, el.dataset.line));
    case "conflict": return act(resolveConflict);
    case "replenish": return act(async () => replenish());
    case "adjust": {
      const target = state.players[+el.closest("[data-p]").dataset.p];
      const d = +el.dataset.d;
      const k = el.dataset.k;
      return act(async () => {
        if (k === "coins") target.coins = Math.max(0, target.coins + d);
        else if (k === "intrigue") target.intrigueBonus += d;
        else if (k === "draw") draw(target, 1);
        else move(target, k, d);
        log(`<i>Manual:</i> ${who(target)} ${k} ${d > 0 ? "+" : ""}${d}.`);
      });
    }
  }
});

/* ---------- setup & persistence ---------- */

function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch {}
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    // Card data may have changed since the save; drop a save that no longer fits.
    const titles = [
      ...s.players.flatMap((p) => [...p.deck, ...p.hand, ...p.discard, ...LINES.flatMap((l) => p.lines[l].map((c) => c.title))]),
      ...s.market.offer.filter(Boolean),
    ];
    const ok =
      titles.every((t) => CARDS[t]) &&
      CONFLICT_CARDS[s.conflict] &&
      s.players.every((p) => LINES.every((l) => CHARS[p.chars[l]])) &&
      LOCATIONS.every((l) => l.name in s.locations);
    return ok ? s : null;
  } catch {
    return null;
  }
}

function openSetup() {
  if (busy) return;
  const dlg = document.getElementById("setup");
  const opts = (line) =>
    CHARACTERS.filter((c) => c.line === line).map((c) => `<option>${escapeHtml(c.title)}</option>`).join("");
  document.getElementById("setup-players").innerHTML = [0, 1]
    .map(
      (i) => `
      <fieldset>
        <legend>Player ${i + 1}</legend>
        <label>Name <input name="name${i}" value="Player ${i + 1}" /></label>
        <label>Citizen <select name="citizen${i}">${opts("citizen")}</select></label>
        <label>Outcast <select name="outcast${i}">${opts("outcast")}</select></label>
      </fieldset>`
    )
    .join("");
  // Characters are dealt at random (distinct while the pool allows); the
  // selects let a playtest force a pairing.
  const deal = () =>
    LINES.forEach((line) => {
      const pool = shuffle(CHARACTERS.filter((c) => c.line === line));
      [0, 1].forEach((i) => (dlg.querySelector(`[name=${line}${i}]`).value = pool[i % pool.length].title));
    });
  deal();
  document.getElementById("setup-random").onclick = deal;
  dlg.querySelector("[value=cancel]").hidden = !state;
  dlg.showModal();
}

document.getElementById("setup").addEventListener("close", (e) => {
  const dlg = e.target;
  if (dlg.returnValue !== "start") return;
  const f = new FormData(dlg.querySelector("form"));
  newGame([0, 1].map((i) => ({
    name: f.get(`name${i}`) || `Player ${i + 1}`,
    citizen: f.get(`citizen${i}`),
    outcast: f.get(`outcast${i}`),
  })));
});

state = load();
if (state) render();
else openSetup();
