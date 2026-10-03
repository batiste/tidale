// Aeropolis: Undercity data shared by undercity.html (rules) and undercity-play.html (hot-seat game).

const UC_CONFIG = {
  spireTop: 12, // Citizen starts here and can never rise above it; Outcast starts on 0.
  cubes: 12, // per player; the rest wait in stock until the Counting House brings them in.
  reserve: 5,
  marketSize: 5,
  minCards: 2, // Scrapyard cannot thin a player below this many cards.
};

// Each location has one effect. side: C = Citizen district, O = Outcast district (Spire for the
// controller at Regroup); S = service location, whose bonus is a Regroup step for anyone with a cube there.
const UC_LOCATIONS = [
  { name: "High Forum", side: "C", x: 150, y: 140 },
  { name: "Counting House", side: "S", bonus: "reserve", x: 380, y: 70 },
  { name: "Gaming Den", side: "C", x: 610, y: 140 },
  { name: "Rust Bar", side: "O", x: 610, y: 400 },
  { name: "Scrapyard", side: "S", bonus: "trash", x: 380, y: 470 },
  { name: "Cable Lift", side: "O", x: 150, y: 400 },
  { name: "Noodle Shop", side: "S", bonus: "buy", x: 380, y: 270 },
];

// Ring of six plus the Noodle Shop (index 6) in the centre. The Counting House and the
// Scrapyard are cut off from the Noodle Shop: reachable only along the ring.
const UC_ADJ = [
  [1, 5, 6],
  [0, 2],
  [1, 3, 6],
  [2, 4, 6],
  [3, 5],
  [4, 0, 6],
  [0, 2, 3, 5],
];

// Every card: id, name, text, and (market only) cost in reputation and copies.
const UC_STARTER = [
  { id: "recruit", name: "Recruit", text: "Place up to 2 cubes from your reserve at one location." },
  { id: "move", name: "Move", text: "Move up to 2 of your cubes 1 step each." },
  { id: "agitate", name: "Agitate", text: "Place 1 cube from your reserve at any location. Then move 1 cube (any player's) from that location to an adjacent one." },
];

const UC_MARKET = [
  { id: "mass-recruit", name: "Mass Recruit", cost: 2, copies: 2, text: "Place up to 3 cubes from your reserve at one location." },
  { id: "rally", name: "Rally", cost: 1, copies: 2, text: "Place 1 cube from your reserve at any location, then move 1 of your cubes 1 step." },
  { id: "procession", name: "Procession", cost: 1, copies: 2, text: "Move up to 4 of your cubes 1 step each." },
  { id: "smuggle", name: "Smuggler's Route", cost: 1, copies: 2, text: "Move 1 of your cubes to any location." },
  { id: "seize", name: "Seize", cost: 2, copies: 2, text: "At a location where you have more cubes than an opponent, return 1 of their cubes to their reserve." },
  { id: "bribe", name: "Bribe", cost: 2, copies: 2, text: "At a location where you have a cube, replace 1 opponent cube with 1 of yours from your reserve." },
  { id: "riot", name: "Riot", cost: 3, copies: 2, text: "At a location where you have a cube, push every opponent cube there to adjacent locations." },
  { id: "patron", name: "Patron", cost: 2, copies: 2, text: "Outcast +1 for each Outcast district you control." },
  { id: "safehouse", name: "Safehouse", cost: 2, copies: 2, text: "Regroup now." },
  { id: "guild-assembly", name: "Guild Assembly", cost: 1, copies: 1, text: "Regroup now, but only Citizen districts score." },
  { id: "street-summons", name: "Street Summons", cost: 1, copies: 1, text: "Regroup now, but only Outcast districts score." },
];
