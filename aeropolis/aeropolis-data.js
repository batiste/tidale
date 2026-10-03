// Aeropolis — data shared by index.html (rules) and aeropolis-play.html (hot-seat game).

const TF_CONFIG = {
  spire: 13, // Spire heights 1 (base) to 13 (top). Outcast starts on 1.
  citStart: { 2: 13, 3: 12, 4: 12 }, // Citizen start by player count (marked on the Spire)
  row: 2, // cards on offer from each deck (Citizen, Outcast)
  rounds: 5, // Uprisings drawn: the game ends after the last one (or when characters meet)
  sideCap: 3,
  freeHeat: 2, // Street run: heat of a free card (it gives no goods) // strips per side; a new one beyond this discards the oldest
  troops: 12, // troops per player
  goodsCap: 6, // at most this many of each good; any extra is lost
  tieBreak: ["A", "T", "S", "P"], // final tie: most Arms, then Stims, Secrets, Papers
  start: { P: 1, S: 1, A: 0, T: 0 }, // starting goods
};

const GOODS = {
  P: { name: "Papers", one: "Paper", use: "Mostly pays Deal strips: troops to the lower city." },
  S: { name: "Secrets", one: "Secret", use: "Mostly pays Rally strips: troops to the upper city." },
  A: { name: "Arms", one: "Arms", use: "Uprising: +1 strength each, committed in secret." },
  T: { name: "Stims", one: "Stim", use: "Street run: discard the card just drawn, then draw again." },
}; // Every good also pays card costs.

// The city. Deal sends troops to the lower city, Rally to the upper city; the Cable Lift is in both.
// control: reward for the player with the most troops there after each Uprising (tie: nobody).
// upkeep: the controller then loses that many troops there (back to supply).
const LOCATIONS = [
  { id: "docks", name: "Docks", low: true, control: [{ gain: "A", n: 2 }, { gain: "T", n: 1 }] },
  { id: "market", name: "Black Market", low: true, control: [{ choice: 2 }] },
  { id: "lift", name: "Cable Lift", low: true, high: true, control: [{ rise: "out", n: 1 }], upkeep: 1 },
  { id: "forum", name: "Forum", high: true, control: [{ rise: "out", n: 1 }], upkeep: 1 },
  { id: "archives", name: "Archives", high: true, control: [{ scheme: true }] },
];

// A side = the column tucked above or below a character. The character card is the base of both its sides.
const SIDES = {
  cit: { name: "Citizen", up: { name: "Rally" }, down: { name: "Council" } },
  out: { name: "Outcast", up: { name: "Street" }, down: { name: "Deal" } },
};

// Characters: each player plays one Citizen and one Outcast. Their own strips (up / down) are the base of their sides.
// Setup dials: goods (extra starting goods, may be negative), cit / out (starting heights), troops (placed at setup).
// art: illustration shown on the card (else a silhouette).
const CHARACTERS = [
  { id: "councillor", name: "Councillor", char: "cit", up: [{ spend: { S: 1 }, get: { troop: "high", n: 1 } }], down: [{ gain: "S", n: 1 }, { gain: "P", n: 1 }] },
  { id: "banker", name: "Banker", char: "cit", up: [{ spend: { P: 1 }, get: { troop: "high", n: 1 } }], down: [{ gain: "P", n: 2 }], goods: { P: 1 } },
  { id: "demagogue", name: "Demagogue", char: "cit", up: [{ spend: { S: 2 }, get: { troop: "low", n: 3 } }], down: [{ gain: "S", n: 1 }] },
  { id: "chancellor", name: "Chancellor", char: "cit", up: [{ spend: { S: 1 }, get: { troop: "high", n: 1 } }], down: [{ gain: "S", n: 1 }, { scheme: true }], goods: { P: -1 } },
  { id: "whip", name: "Whip", char: "cit", up: [{ spend: { S: 1 }, get: { troop: "high", n: 1 } }], down: [{ gain: "S", n: 1 }, { move: 1 }] },
  { id: "hustler", name: "Hustler", char: "out", up: [{ run: 7 }], down: [{ spend: { P: 1 }, get: { troop: "low", n: 1 } }], goods: { P: 1 } },
  { id: "firebrand", name: "Firebrand", char: "out", up: [{ run: 3 }], down: [{ spend: { P: 1 }, get: { troop: "low", n: 2 } }], goods: { P: -1 } },
  { id: "pawnbroker", name: "Pawnbroker", char: "out", up: [{ run: 5 }, { gain: "T", n: 1 }], down: [{ spend: { T: 1, A: 1 }, get: { troop: "low", n: 2 } }] },
  { id: "gunsmith", name: "Gunsmith", char: "out", up: [{ run: 4 }], down: [{ spend: { A: 1 }, get: { troop: "low", n: 2 } }] },
  { id: "courier", name: "Courier", char: "out", up: [{ run: 5 }], down: [{ spend: { P: 1 }, get: { troop: "low", n: 1 } }, { move: 1 }] },
];
const CHARACTER = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));
const DEFAULT_CHARS = { cit: "councillor", out: "hustler" };
// Setup text of a character, e.g. "Citizen starts at 13, 1 troop at the Forum".
function charSetupText(c) {
  const parts = [];
  Object.entries(c.goods || {}).forEach(([g, n]) => parts.push(n > 0 ? `${icon(g, n)} extra` : `no starting ${GOODS[g].one}`));
  if (c.cit) parts.push(`Citizen starts at ${c.cit}`);
  if (c.out) parts.push(`Outcast starts at ${c.out}`);
  Object.entries(c.troops || {}).forEach(([id, n]) => parts.push(`${n} troop${n > 1 ? "s" : ""} at the ${LOCATIONS.find((l) => l.id === id).name}`));
  return parts.join(", ") || "—";
}

// Effects: {gain, n} · {rise, n} · {troop: "low"|"high", n} · {move} · {spend, get} (optional; get: an effect or a list) · {limit} (Street only)
// · {scheme} · {run} (base only) · {choice}.
// Card: character (= its deck), cost (goods; each one you lack sinks your Citizen 1), heat (optional, see heatOf), strength as a Scheme (+N, or "x2": doubles your total), top strip (up), bottom strip (down).
const TF_CARDS = [
  { id: "clerk", name: "Clerk", char: "cit", cost: { P: 1 }, str: 2, copies: 3, up: [{ gain: "S", n: 1 }], down: [{ gain: "P", n: 1 }] },
  { id: "magistrate", name: "Magistrate", char: "cit", cost: { P: 1 }, str: 2, copies: 3, up: [{ spend: { S: 1 }, get: { troop: "high", n: 1 } }], down: [{ gain: "P", n: 2 }] },
  { id: "physician", name: "Physician", char: "cit", cost: {}, heat: 3, str: 2, copies: 3, up: [{ gain: "T", n: 1 }], down: [{ gain: "T", n: 2 }] },
  { id: "spymaster", name: "Spymaster", char: "cit", cost: { S: 1 }, str: 3, copies: 3, up: [{ gain: "S", n: 1 }], down: [{ scheme: true }] },
  { id: "quartermaster", name: "Quartermaster", char: "cit", cost: { A: 1 }, str: 2, copies: 3, up: [{ gain: "A", n: 1 }], down: [{ gain: "A", n: 2 }] },
  { id: "benefactor", name: "Benefactor", char: "cit", cost: { P: 1 }, str: 2, copies: 2, up: [{ spend: { any: 2 }, get: { rise: "out", n: 1 } }], down: [{ gain: "S", n: 1 }] },
  { id: "orator", name: "Orator", char: "cit", cost: { S: 2, P: 1 }, str: 2, copies: 3, up: [{ troop: "high", n: 1 }], down: [{ gain: "S", n: 2 }, { choice: 1 }] },
  { id: "censor", name: "Censor", char: "cit", cost: { S: 1 }, str: "x2", copies: 3, up: [{ move: 2 }], down: [{ scheme: true }] },
  { id: "patron", name: "Patron", char: "cit", cost: { S: 1, P: 1 }, str: 2, copies: 3, up: [{ spend: { S: 1 }, get: { troop: "high", n: 2 } }], down: [{ spend: { S: 1 }, get: { troop: "low", n: 2 } }] },
  { id: "conspirator", name: "Conspirator", char: "cit", cost: {}, str: 2, copies: 3, up: [{ gain: "T", n: 1 }], down: [{ spend: { T: 1 }, get: { scheme: true } }] },

  { id: "lookout", name: "Lookout", char: "out", cost: {}, heat: 3, str: 2, copies: 3, up: [{ limit: 2 }], down: [{ gain: "P", n: 1 }] },
  { id: "runner", name: "Runner", char: "out", cost: {}, str: 2, copies: 3, up: [{ gain: "T", n: 1 }], down: [{ gain: "P", n: 1 }] },
  { id: "forger", name: "Forger", char: "out", cost: { P: 1 }, str: 2, copies: 3, up: [{ limit: 2 }], down: [{ spend: { P: 1 }, get: { troop: "low", n: 1 } }] },
  { id: "fence", name: "Fence", char: "out", cost: { T: 1 }, str: 2, copies: 3, up: [{ limit: 3 }], down: [{ spend: { any: 2 }, get: { troop: "low", n: 1 } }] },
  { id: "gunrunner", name: "Gunrunner", char: "out", cost: { T: 1 }, str: 2, copies: 3, up: [{ gain: "A", n: 1 }], down: [{ gain: "A", n: 2 }] },
  { id: "blackmailer", name: "Blackmailer", char: "out", cost: { S: 1 }, str: 3, copies: 3, up: [{ gain: "S", n: 1 }], down: [{ move: 2 }] },
  { id: "agitator", name: "Agitator", char: "out", cost: { A: 1 }, str: "x2", copies: 3, up: [{ limit: 2 }], down: [{ spend: { T: 1 }, get: { troop: "low", n: 2 } }] },
  { id: "fixer", name: "Fixer", char: "out", cost: { A: 1 }, str: 2, copies: 2, up: [{ gain: "T", n: 1 }], down: [{ spend: { any: 2 }, get: { rise: "out", n: 1 } }] },
  { id: "smuggler", name: "Smuggler", char: "out", cost: { T: 1, P: 1 }, str: 2, copies: 3, up: [{ limit: 3 }], down: [{ spend: { P: 1 }, get: { troop: "low", n: 2 } }] },
];

// One Uprising per round, fought at its locations. first / second: rewards for the strongest and second strongest.
const TF_UPRISINGS = [
  { name: "Dock Riot", at: ["docks"], first: [{ rise: "out", n: 2 }], second: [{ rise: "out", n: 1 }] },
  { name: "Show Trial", at: ["forum"], first: [{ rise: "out", n: 1 }, { rise: "cit", n: 2 }], second: [{ rise: "cit", n: 1 }] },
  { name: "Barricades", at: ["lift"], first: [{ rise: "out", n: 2 }, { gain: "A", n: 1 }], second: [{ gain: "A", n: 1 }] },
  { name: "General Strike", at: ["docks", "market"], first: [{ rise: "out", n: 2 }], second: [{ rise: "out", n: 1 }] },
  { name: "Market Raid", at: ["market"], first: [{ rise: "out", n: 1 }, { choice: 2 }], second: [{ choice: 1 }] },
  { name: "Burn the Archives", at: ["archives"], first: [{ rise: "out", n: 2 }, { gain: "S", n: 1 }], second: [{ gain: "S", n: 1 }] },
  { name: "Storm the Forum", at: ["forum", "archives"], first: [{ rise: "out", n: 2 }, { rise: "cit", n: 1 }], second: [{ rise: "out", n: 1 }] },
  { name: "Night of Knives", at: ["lift", "archives"], first: [{ rise: "out", n: 2 }], second: [{ rise: "out", n: 1 }] },
];

// Cost: goods to pay; each good you lack sinks your Citizen 1 instead.
const costSize = (c) => Object.values(c.cost).reduce((a, b) => a + b, 0);
const costHtml = (c) => Object.entries(c.cost).map(([g, k]) => icon(g, k)).join(" ");
// Street run heat, printed on every card: the card's own heat if set, else the number of goods in its cost, else freeHeat.
const heatOf = (c) => c.heat ?? (costSize(c) || TF_CONFIG.freeHeat);

// Icons: inline SVG chips (styles in aeropolis-icons.css), shared by the rules page and the playtest.
const ICON_PATHS = {
  P: '<path d="M6 2h9l4 4v16H6z" fill="currentColor"/><path d="M9 10h7M9 13.5h7M9 17h5" stroke="var(--chip)" stroke-width="1.6"/>',
  S: '<path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z" fill="currentColor"/><circle cx="12" cy="12" r="3.6" fill="var(--chip)"/>',
  A: '<path d="M12 1.5l2.4 12.5H9.6z" fill="currentColor"/><path d="M6.5 14.5h11v2h-11z" fill="currentColor"/><path d="M10.8 16.5h2.4v4.5h-2.4z" fill="currentColor"/>',
  T: '<g transform="rotate(45 12 12)"><rect x="7.5" y="1.5" width="9" height="21" rx="4.5" fill="currentColor"/><path d="M7.5 12h9" stroke="var(--chip)" stroke-width="1.8"/></g>',
  heat: '<path d="M12 1.5c1.5 4.5 7 6.5 7 13a7 7 0 0 1-14 0c0-3.5 2-5.8 3.3-7.6.6 2.2 1.9 3.6 3.2 3.9-.7-3.6.2-6.8.5-9.3z" fill="currentColor"/>',
  scheme: '<path d="M2 7c3-1 6.5-1.2 10 1 3.5-2.2 7-2 10-1-.3 5.5-3 9-6.5 9-2 0-3-1.5-3.5-3-.5 1.5-1.5 3-3.5 3C5 16 2.3 12.5 2 7z" fill="currentColor"/><ellipse cx="7.8" cy="10.3" rx="1.9" ry="1.3" fill="var(--chip)"/><ellipse cx="16.2" cy="10.3" rx="1.9" ry="1.3" fill="var(--chip)"/>',
  cit: '<path d="M12 3l8 9h-5v9H9v-9H4z" fill="currentColor"/>',
  out: '<path d="M12 3l8 9h-5v9H9v-9H4z" fill="currentColor"/>',
  sink: '<path d="M12 21l8-9h-5V3H9v9H4z" fill="currentColor"/>',
  any: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M12 7.5v9M7.5 12h9" stroke="currentColor" stroke-width="2.4"/>',
  low: '<circle cx="12" cy="6.5" r="4" fill="currentColor"/><path d="M4 21c0-5 3.5-8 8-8s8 3 8 8z" fill="currentColor"/>',
  high: '<circle cx="12" cy="6.5" r="4" fill="currentColor"/><path d="M4 21c0-5 3.5-8 8-8s8 3 8 8z" fill="currentColor"/>',
  move: '<path d="M3 9h13l-4-4M21 15H8l4 4" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
};
const ICON_NAMES = {
  heat: ["Heat", "Heat"],
  scheme: ["Scheme", "Schemes"],
  cit: ["Rise Citizen", "Rise Citizen"],
  out: ["Rise Outcast", "Rise Outcast"],
  sink: ["Sink Citizen", "Sink Citizen"],
  any: ["Any good", "goods of your choice"],
  low: ["Troop, lower city", "troops to the lower city"],
  high: ["Troop, upper city", "troops to the upper city"],
  move: ["Move a troop", "Move troops"],
};

// Icon glossary (goods use GOODS[g].use).
const ICON_HELP = {
  heat: "Street run: the heat printed on each drawn card adds up. 🔥 on a strip raises your limit for this run.",
  scheme: "Look at the top card of each deck; keep 1 face down for the Uprising.",
  cit: "Your Citizen climbs 1 on the Spire.",
  out: "Your Outcast climbs 1 on the Spire.",
  sink: "Your Citizen goes down 1: pays for each good of a card cost you lack.",
  low: "Place a troop at the Docks, Black Market or Cable Lift.",
  high: "Place a troop at the Cable Lift, Forum or Archives.",
  move: "Move one of your troops to any location (you may move fewer).",
  any: "A good of your choice.",
};
const glossaryHtml = () =>
  [...Object.keys(GOODS), ...Object.keys(ICON_HELP)]
    .map((k) => `<li>${icon(k)} <b>${iconLabel(k)}</b> ${GOODS[k] ? GOODS[k].use : ICON_HELP[k]}</li>`)
    .join("");

// Plain-text label, e.g. "2 Papers". Kept hidden next to each chip so a copied log still reads.
function iconLabel(key, n) {
  const [one, many] = GOODS[key] ? [GOODS[key].one, GOODS[key].name] : ICON_NAMES[key];
  return n == null ? one : `${n} ${n === 1 ? one : many}`;
}

// icon("P") → chip; icon("P", 2) → 2 chips. Above 3, or a non-number (e.g. "2/7"): the number + 1 chip.
function icon(key, n) {
  const text = `<span class="gt">${iconLabel(key, n)}</span>`;
  const chip = `<span class="gi gi-${key}" title="${iconLabel(key)}"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[key]}</svg></span>`;
  if (typeof n === "number" && n <= 3) return `<span class="gx">${text}${chip.repeat(n)}</span>`;
  return `<span class="gx">${text}${n != null ? `<b aria-hidden="true">${n}</b>` : ""}${chip}</span>`;
}

// AI activation order (players choose their own): every plain "+ goods" effect first (production), then the rest in order
// (strips newest to oldest, then the character's own strip). So a strip can spend goods produced by the same activation.
const activationOrder = (list) => [...list.filter((e) => e.gain), ...list.filter((e) => !e.gain)];

// Citizen start heights with their player counts, e.g. { 13: "2", 12: "3–4" }.
function citStarts() {
  const by = {};
  Object.entries(TF_CONFIG.citStart).forEach(([n, h]) => (by[h] = [...(by[h] || []), n]));
  return Object.fromEntries(Object.entries(by).map(([h, ns]) => [h, ns.length > 1 ? `${ns[0]}–${ns[ns.length - 1]}` : ns[0]]));
}

const LOC = Object.fromEntries(LOCATIONS.map((l) => [l.id, l]));
const locNames = (ids) => ids.map((id) => LOC[id].name).join(" + ");

// compact: counts as a number next to one icon ("3" + troop) instead of repeated icons.
function fxText(e, compact = false) {
  const ic = (key, n) => icon(key, compact && n > 1 ? `${n}` : n);
  if (e.gain) return ic(e.gain, e.n);
  if (e.spend) return `${Object.entries(e.spend).map(([g, n]) => ic(g, n)).join(" ")} → ${[].concat(e.get).map((g) => fxText(g, compact)).join(" ")}`;
  if (e.rise) return ic(e.rise, e.n);
  if (e.troop) return ic(e.troop, e.n);
  if (e.move) return ic("move", e.move);
  if (e.limit) return `<span class="gt">heat limit +</span>${icon("heat", e.limit)}`;
  if (e.scheme) return icon("scheme");
  if (e.run) return `<span class="gt">street run, heat limit</span>${icon("heat", e.run)}`;
  if (e.choice) return ic("any", e.choice);
  return "";
}
// Icons an effect shows when drawn as repeated chips.
const chipCount = (e) =>
  e.spend ? Object.values(e.spend).reduce((a, b) => a + b, 0) + [].concat(e.get).reduce((t, g) => t + chipCount(g), 0) : e.gain || e.rise || e.troop ? e.n : e.move || e.choice || 1;
const strText = (str) => `<span class="str">${str === "x2" ? "×2" : `+${str}`}</span>`;
// A strip of more than 3 icons shows counts as numbers, so it fits on one line of a card.
const fxList = (list) => {
  const compact = list.reduce((t, e) => t + chipCount(e), 0) > 3;
  return list.length ? list.map((e) => fxText(e, compact)).join(" ") : "—";
};
