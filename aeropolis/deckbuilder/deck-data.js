const CHARACTERS = [
  {
    title: "Councillor Vane",
    line: "citizen",
    glyph: "⏢",
    sockets: 3,
    // Cost to play the 1st, 2nd, 3rd, 4th card into this line, in coin.
    // Identical on both characters for now; a lever for asymmetry later.
    playCosts: [0, 1, 2, 3],
    ability: "Play 3 cards on this line → Rise 1.",
    reward: "Rise 1 3 coin.",
  },
  {
    title: "The Ferryman",
    line: "outcast",
    glyph: "⌭",
    sockets: 3,
    playCosts: [0, 1, 2, 3],
    ability: "Once per round, 1 coin → Rise 1.",
    reward: "Rise 2.",
  },
  {
    title: "The Assessor",
    line: "citizen",
    glyph: "⌗",
    sockets: 2,
    playCosts: [0, 1, 2, 2],
    ability: "Once per round, Sink 1 → 2 coin.",
    reward: "2 coin.",
  },
  {
    title: "The Scavenger",
    line: "outcast",
    glyph: "⚙",
    sockets: 2,
    playCosts: [0, 1, 2, 2],
    ability: "Once per round, discard 1 card → Rise 1.",
    reward: "Rise 1 or Trash a card.",
  },
];

const DECK = [
  {
    title: "Fixer",
    line: "any",
    glyph: "⎔",
    slots: [{ text: "" }],
    conflictValue: 1,
    discardEffect: "1 coin",
  },
  {
    title: "Snitch",
    line: "outcast",
    glyph: "⚉",
    slots: [{ text: "cube" }],
    conflictValue: 1,
    discardEffect: "1 coin",
  },
  {
    title: "Smuggler",
    line: "outcast",
    glyph: "⟁",
    slots: [{ text: "Rise Outcast " }],
    conflictValue: 1,
    discardEffect: "1 coin",
  },
  {
    title: "Embezzler",
    line: "outcast",
    glyph: "⏣",
    // Playtest probe: a direct card-count interaction (see rules.html
    // Glossary — Other Line).
    slots: [{ text: "For each card in your other line: 1 coin" }],
    conflictValue: 2,
    discardEffect: "1 coin",
  },
  {
    title: "Shady Deals",
    line: "outcast",
    glyph: "⌖",
    slots: [{ text: "Sink Outcast 1 → 1 coin" }],
    conflictValue: 1,
    discardEffect: "1 coin",
  },
  {
    title: "Whisper",
    line: "outcast",
    glyph: "✧",
    slots: [{ text: "Refresh 1" }],
    conflictValue: 1,
    discardEffect: "1 coin",
  },
  {
    title: "Agitator",
    line: "citizen",
    glyph: "⌬",
    // Playtest probe: a direct card-count interaction, same pattern as
    // Embezzler (see rules.html Glossary — Other Line).
    slots: [
      { text: "Sink Citizen 1 → Rise Outcast 1." },
      // { text: "Sink Citizen 1 coin → For each card in your other line : Rise Outcast " },
    ],
    conflictValue: 2,
    discardEffect: "1 coin",
  },
];

// Same slotted-card template as DECK — still slots a cube — but also
// charges coin up front. Priced on ~1 coin per Rise-step of effect on
// top of the cube, so the four samples trace a cheap-to-priced curve.
const MARKET = [
  {
    title: "Tipster",
    line: "any",
    glyph: "☍",
    slots: [{ text: "1 coin → Draw 1 card cube Refresh 1" }],
    cost: 2,
    conflictValue: 2,
    discardEffect: "1 coin",
  },
  {
    title: "Stevedore",
    line: "outcast",
    glyph: "⚓",
    slots: [{ text: "Rise Outcast 2" }],
    cost: 2,
    conflictValue: 2,
    discardEffect: "1 coin",
  },
  {
    title: "Bribe",
    line: "outcast",
    glyph: "⬢",
    // Moved here from the starter deck (see deck-data.js's DECK — Snitch):
    // a stateful "remember this for next play" effect is worth paying for,
    // not something every starting hand should carry.
    slots: [{ text: "Your next card played into this line costs nothing." }],
    cost: 2,
    conflictValue: 2,
    discardEffect: "1 coin",
  },
  {
    title: "Under the table",
    line: "citizen",
    glyph: "⚖",
    slots: [{ text: "Sink Citizen 2 → 4 coin" }],
    cost: 3,
    conflictValue: 1,
    discardEffect: "Rise 1",
  },
  {
    title: "Powerbroker",
    line: "any",
    glyph: "⚜",
    slots: [
      { text: "Rise Citizen 1 Rise Outcast 1 1 coin" },
      { text: "1 coin Intrigue 1" },
    ],
    cost: 5,
    conflictValue: 2,
    discardEffect: "2 coin",
  },
  {
    title: "The Solicitor",
    line: "citizen",
    glyph: "⎊",
    slots: [{ text: "Rise Citizen 1 Draw 1 card" }],
    cost: 3,
    conflictValue: 1,
    discardEffect: "1 coin",
  },
  {
    title: "The Cutthroat",
    line: "outcast",
    glyph: "⚒",
    slots: [{ text: "Discard 1 card → Rise Outcast 2 1 coin" }],
    cost: 3,
    conflictValue: 2,
    discardEffect: "1 coin",
  },
  {
    title: "The Middleman",
    line: "any",
    glyph: "⚗",
    slots: [{ text: "cube Rise Outcast" }, { text: "1 coin Refresh 1" }],
    cost: 4,
    conflictValue: 1,
    discardEffect: "1 coin",
  },
  // ---------- playtest probes: direct card-count/repeat interactions for
  // the Other Line rule (see rules.html Glossary — Other Line). Priced
  // above the rest of the Noodle Shop, not below it — each scales with
  // board state instead of paying a flat amount, so it's the ceiling case
  // that sets the price, not the average one.
  {
    title: "Revolutionary Organizer",
    line: "outcast",
    glyph: "⚑",
    // Same pattern as Embezzler; unlike Embezzler's flat 1 coin per card,
    // this scales a Rise, so its late-game ceiling (a long Citizen line)
    // is priced above Embezzler and the rest of the Noodle Shop.
    slots: [{ text: "cube, for each card in your other line: Rise Outcast" }],
    conflictValue: 2,
    cost: 4,
    discardEffect: "1 coin",
  },
  {
    title: "Echo",
    line: "any",
    glyph: "⟲",
    // Deliberately strong probe: repeats every card's normal socket/recruit
    // effect in the other line, not their Intrigue/discard effects, and
    // never moves cubes (see rules.html Glossary's Echo ruling). Priced
    // highest in the Noodle Shop: a full other line to repeat is an
    // exponential-feeling spike, not just a strong rate.
    slots: [{ text: "Repeat the effect of every slotted card in your other line." }],
    conflictValue: 2,
    cost: 5,
    discardEffect: "1 coin",
  },
];

// Not part of a player's hand: one Citizen and one Outcast card are revealed from this
// deck at the start of each round to set that round's stakes for the two conflicts.
// `refillStart` names the board location where this round's Replenish placement
// begins (rules.html — Replenish); `refill` is this card's X in the Replenish
// formula: 2 × player count + X cubes added this round, capped 0–2.
const CONFLICTS = [
  {
    title: "Show Trial",
    line: "citizen",
    glyph: "⚔",
    reward: "Rise Citizen 2 cube",
    // Overrides the default tiebreak (rules.html Conflict: nearer the top
    // wins) instead of restating it — the point of a per-card condition.
    condition: "The player with the longest line Intrigue 1",
    refillStart: "The High Forum",
    refill: 1,
  },
  {
    title: "Underground Vote",
    line: "outcast",
    glyph: "⛓",
    reward: "Rise Outcast 2 1 coin",
    condition: "Each losing player 1 coin.",
    refillStart: "The Scrapyard",
    refill: 2,
  },
  {
    title: "Public Inquiry",
    line: "citizen",
    glyph: "⛨",
    reward: "4 coin",
    condition: "The player with the lowest Citizen may not commit an Intrigue.",
    refillStart: "Noodle Shop",
    refill: 2,
  },
  {
    title: "The Informant's Price",
    line: "outcast",
    glyph: "⚚",
    reward: "Rise Outcast 1 2 coin",
    condition: "Each player Sink Outcast 1.",
    refillStart: "The Cable Lift",
    refill: 2,
  },
  {
    title: "Closed Session",
    line: "citizen",
    glyph: "⌾",
    reward: "4 coin",
    condition: "Player(s) with the highest Citizen: Intrigue 1",
    refillStart: "Gaming Den",
    refill: 1,
  },
];

// Replaces the Conflict pile once the Revolution begins (rules: "a pile of 3 random
// Revolution Conflict cards"). Same Reward/Condition/refill shape, raised stakes.
const REVOLUTION_CONFLICTS = [
  {
    title: "The Tribunal",
    line: "citizen",
    glyph: "⚡",
    reward: "Rise Citizen 3 2 coin",
    condition: "Every losing player Sink Citizen 1.",
    refillStart: "The Rust Bar",
    refill: 2,
  },
  {
    title: "Blood In The Streets",
    line: "outcast",
    glyph: "☠",
    reward: "Rise Outcast 3",
    // Hands are already empty by resolution time (Round Structure — Action
    // runs "until every player has discarded"), so a discard-the-hand
    // punishment can never actually happen. Sink is always resolvable.
    condition: "Each losing player Sink Outcast 1.",
    refillStart: "The Counting House",
    refill: 0,
  },
  {
    title: "The Purge",
    line: "outcast",
    glyph: "⛃",
    reward: "Rise Outcast 3 cube",
    // Same cost-on-the-winner shape as The Informant's Price, raised to
    // Revolution stakes.
    condition: "Each player Refresh 1.",
    refillStart: "The High Forum",
    refill: 2,
  },
];
