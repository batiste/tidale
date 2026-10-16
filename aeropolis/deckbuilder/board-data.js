// Board data shared by board.html and play.html. Array order is board order
// (rules.html — Replenish).

const LOCATIONS = [
  {
    name: "The High Forum",
    side: "citizen",
    accent: "var(--forum)",
    glyph: "⏢",
    flavour: "Where the council sells what it pretends to protect.",
    reward: "Rise Citizen 1.",
    rail: true,
  },
  {
    name: "The Counting House",
    side: "citizen",
    accent: "var(--counting)",
    glyph: "⏣",
    flavour: "Ledgers thick enough to hide a city in.",
    reward: "1 coin.",
  },
  {
    name: "Gaming Den",
    side: "citizen",
    accent: "var(--den)",
    glyph: "⚂",
    flavour: "Bet your standing. The house always collects.",
    reward: "Sink Citizen 1 → 2 coin.",
    unlock: { track: "citizen", level: 14 },
  },
  {
    name: "The Rust Bar",
    side: "outcast",
    accent: "var(--bar)",
    glyph: "⟁",
    flavour: "Every rumour in Aeropolis passes this counter.",
    reward: "Draw 1 card.",
    rail: true,
  },
  {
    name: "The Scrapyard",
    side: "outcast",
    accent: "var(--scrap)",
    glyph: "⌬",
    flavour: "Bring what you no longer need. Leave it.",
    reward: "Trash 1 card from your hand or discard.",
    rail: true,
  },
  {
    name: "Noodle Shop",
    side: "shared",
    accent: "var(--market)",
    glyph: "◈",
    flavour: "Shoulder to shoulder, the place to hire agents.",
    reward: "Buy 1 card, paying its coin cost.",
    marketSlots: 5,
    slots: 3,
    rail: true,
  },
  {
    name: "The Cable Lift",
    side: "outcast",
    accent: "var(--lift)",
    glyph: "⌖",
    flavour: "The only way up that does not ask your name.",
    reward: "Rise Outcast 1.",
  },
];

// 16 spaces: the Citizen starts on 16 and the Outcast on 1, so the gap is 15 —
// that is the total number of closing moves the whole game allows. Sized so a
// dedicated Rise/Sink rush can plausibly close it by round 5-6 (playtest target).
const SPIRE_SPACES = 16;

// Payout curve for the meeting space: every space is worth a different amount,
// starting at 1 VP at the bottom, and the jump to the next space up is never
// more than 3 — small gaps low down, capped (not accelerating past 3) near the top.
const SPIRE_VALUES = [1];
for (let pos = 2; pos <= SPIRE_SPACES; pos++) {
  const gap = Math.min(3, Math.ceil(pos / 5));
  SPIRE_VALUES.push(SPIRE_VALUES[pos - 2] + gap);
}
function spireVp(space) {
  return SPIRE_VALUES[space - 1];
}
