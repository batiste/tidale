// Aeropolis: Banners — data for index.html (rules), cards.html, play.html and sim.js.

const BN_CONFIG = {
  spire: 20, // Spire heights 1 (base) to 20 (top). Citizens start on 20, Outcasts on 1.
  influence: 20, // influence cubes per player
  end: { rule: "out", squeeze: 2, freeze: true }, // how the game ends: see endTurn in engine.js (the rules page describes "out" + freeze)
  score: { influence: 1, control: 3 }, // per influence under one of your banners; per location you control (any banner)
  bannerCopies: 3, // banner tokens per faction: 8 hang in the city, the rest form the reserve
};

// glyph: shown on the banner (U+FE0E keeps symbols as text, not emoji). field / ink: banner colours.
const FACTIONS = [
  { id: "crown", name: "Crown", glyph: "♛", field: "#4e3479", ink: "#e9c477", motto: "Nothing above us." },
  { id: "church", name: "Church", glyph: "✠", field: "#e6dcc4", ink: "#8b1e2d", motto: "All is forgiven, for a price." },
  { id: "guilds", name: "Guilds", glyph: "⚖︎", field: "#2f5d86", ink: "#e9c477", motto: "Every scale tips." },
  { id: "commune", name: "Commune", glyph: "⚒︎", field: "#a8322a", ink: "#f3ede0", motto: "From below, as one." },
  { id: "underworld", name: "Underworld", glyph: "☾", field: "#17171c", ink: "#9fd8a8", motto: "We were here first." },
];
const FACTION = Object.fromEntries(FACTIONS.map((f) => [f.id, f]));

// The city: 4 columns, a High City location above a Low City one.
// cost: time, in Spire steps. tandem: bonus when your two characters stand in this column.
const COLUMNS = [
  {
    high: { name: "Palace", cost: 3, action: "Decree", text: "return 1 of your influence from the Palace to your supply, then replace the banner of any location." },
    tandem: { name: "Coup", text: "remove up to 2 influence of another player from the Palace." },
    low: { name: "Sewers", cost: 1, action: "Slip", text: "move 1 of your influence to any location." },
  },
  {
    high: { name: "Cathedral", cost: 2, action: "Sermon", text: "place 2 influence at one High City location." },
    tandem: { name: "Last Rites", text: "remove 1 influence of another player from this column." },
    low: { name: "Catacombs", cost: 1, action: "Relic", text: "replace the banner of the Catacombs or the Cathedral." },
  },
  {
    high: { name: "Exchange", cost: 2, action: "Buy-out", text: "replace 1 influence of another player, at any location, with 1 of yours." },
    tandem: { name: "Smuggling", text: "move 1 of your influence from one location to another." },
    low: { name: "Docks", cost: 1, action: "Recruit", text: "place 1 influence at any Low City location." },
  },
  {
    high: { name: "Barracks", cost: 2, action: "Purge", text: "remove 1 influence of another player from any location." },
    tandem: { name: "Blackmail", text: "sink another player's Citizen 1 (it counts as their time)." },
    low: { name: "Slums", cost: 1, action: "Riot", text: "remove 1 influence of another player from the Slums or the Barracks." },
  },
];

// One Citizen and one Outcast per faction. The character's banner is public.
const CHARACTERS = [
  { name: "Regent", char: "cit", faction: "crown", text: "Your Decree costs 2." },
  { name: "Abbess", char: "cit", faction: "church", text: "Your influence under a ✠ banner cannot be removed or replaced." },
  { name: "Guildmaster", char: "cit", faction: "guilds", text: "Your Buy-out replaces up to 2." },
  { name: "Tribune", char: "cit", faction: "commune", text: "Your tandem also works when your characters stand in neighbouring columns (take either column's bonus)." },
  { name: "Spymaster", char: "cit", faction: "underworld", text: "Your Citizen may stay where it is." },
  { name: "Pretender", char: "out", faction: "crown", text: "You win control ties." },
  { name: "Mendicant", char: "out", faction: "church", text: "Your influence in the Low City cannot be removed or replaced." },
  { name: "Smuggler", char: "out", faction: "guilds", text: "Your Slip moves up to 2 influence." },
  { name: "Agitator", char: "out", faction: "commune", text: "Your Riot removes up to 2." },
  { name: "Cutpurse", char: "out", faction: "underworld", text: "You also get a column's tandem when your Outcast stands directly below another player's Citizen." },
];

// Rendering helpers.
const CHAR_NAME = { cit: "Citizen", out: "Outcast" };
function banner(id, size = "") {
  const f = FACTION[id];
  return `<span class="bn ${size}" style="--f:${f.field};--g:${f.ink}" title="${f.name}"><span>${f.glyph}</span></span>`;
}
const time = (n) => `<span class="time">⧗${n}</span>`;
