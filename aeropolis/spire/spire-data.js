// Aeropolis: Spire data shared by spire.html (rules) and spire-play.html (hot-seat game).

const SP_CONFIG = {
  widths: [4, 3, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9], // hexes per row, top to bottom. Height = rows − row (top 16, base 1).
  topZone: 2, // top rows: any number of pawns, no push or swap, no named hex.
  cost: { street: 1, top: 2, named: 1 }, // entry cost: street, or top zone; named hexes add `named`.
  startCoins: 0,
  marketSize: 5,
  minCards: 3, // Scrap cannot thin a player below this many cards.
};

// Hex effects, triggered when a pawn ends its move there.
const SP_EFFECTS = {
  patron: "Your Outcast climbs 1.",
  blackmail: "Your Citizen climbs 1.",
  buy: "Buy 1 market card.",
  scrap: "Remove 1 card (hand or used) from the game.",
  regroup: "Regroup.",
};

// Named hexes, keyed "row,index" (row 0 = top). None in the top zone or on the base row.
// Upper hexes (reached by Citizens) lift the Outcast; middle ones (reached by Outcasts) lift the Citizen back.
const SP_HEXES = {
  "2,0": { name: "Council", effect: "patron" },
  "3,2": { name: "Counting House", effect: "buy" },
  "4,1": { name: "Salon", effect: "regroup" },
  "5,3": { name: "High Forum", effect: "patron" },
  "6,0": { name: "Gaming Den", effect: "scrap" },
  "7,4": { name: "Noodle Shop", effect: "buy" },
  "8,2": { name: "Cable Lift", effect: "regroup" },
  "9,5": { name: "Rust Bar", effect: "blackmail" },
  "10,1": { name: "Whisper Alley", effect: "blackmail" },
  "11,5": { name: "Black Market", effect: "buy" },
  "12,3": { name: "Safehouse", effect: "regroup" },
  "13,1": { name: "Rag Market", effect: "buy" },
  "13,6": { name: "Scrapyard", effect: "scrap" },
};

// Every card: id, name, coin value (when cashed), action text, copies; market cards add cost in coin.
// A card without text is only worth its coin.
const SP_STARTER = [
  { id: "porter", name: "Porter", value: 2, copies: 2, text: "" },
  { id: "patron", name: "Patron", value: 1, copies: 1, text: "Your Outcast climbs 1." },
  { id: "sellout", name: "Sell Out", value: 1, copies: 1, text: "Your Citizen moves down 2: +2 coin." },
  { id: "clerk", name: "Clerk", value: 1, copies: 1, text: "Your Citizen climbs 1." },
  { id: "informer", name: "Informer", value: 1, copies: 1, text: "Activate the hex under one of your pawns." },
];

// Market cards are clearly stronger than starters: higher coin value, or bigger actions.
const SP_MARKET = [
  { id: "courier", name: "Courier", value: 2, cost: 2, copies: 2, text: "Regroup." },
  { id: "thug", name: "Thug", value: 3, cost: 2, copies: 2, text: "Push 1 rival pawn next to one of yours 1 step down." },
  { id: "socialite", name: "Socialite", value: 3, cost: 2, copies: 2, text: "Swap one of your pawns with a rival pawn next to it." },
  { id: "organizer", name: "Organizer", value: 2, cost: 3, copies: 2, text: "Your Outcast climbs 2." },
  { id: "banker", name: "Banker", value: 3, cost: 3, copies: 2, text: "Your Citizen climbs 2." },
  { id: "smuggler", name: "Smuggler", value: 2, cost: 3, copies: 2, text: "+3 coin, then move your Outcast." },
  { id: "fence", name: "Fence", value: 2, cost: 3, copies: 2, text: "Buy 1 market card, anywhere." },
  { id: "fixer", name: "Fixer", value: 3, cost: 3, copies: 2, text: "Activate the hex under one of your pawns twice." },
  { id: "enforcer", name: "Enforcer", value: 3, cost: 3, copies: 2, text: "Push 1 rival pawn next to one of yours 2 steps down." },
  { id: "agitator", name: "Agitator", value: 3, cost: 3, copies: 2, text: "Push every rival pawn next to your Outcast 1 step down." },
  { id: "broker", name: "Broker", value: 5, cost: 4, copies: 2, text: "" },
];
