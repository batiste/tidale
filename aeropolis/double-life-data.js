// Double Life data shared by double-life.html (rules) and double-life-play.html (hot-seat game).

const DL_CONFIG = {
  rounds: 5,
  rowSize: 4,
  actionsPerPlayer: 3,
  reserve: 12,
  recruitCount: 2,
  spireMax: 30,
};

// side: C = Citizen district, O = Outcast district, S = shared. x/y: centre on the play board.
const DL_LOCATIONS = [
  { name: "High Forum", side: "C", residents: 3, x: 150, y: 140 },
  { name: "Counting House", side: "C", residents: 3, x: 380, y: 70 },
  { name: "Gaming Den", side: "C", residents: 3, x: 610, y: 140 },
  { name: "Rust Bar", side: "O", residents: 3, x: 610, y: 400 },
  { name: "Scrapyard", side: "O", residents: 3, x: 380, y: 470 },
  { name: "Cable Lift", side: "O", residents: 3, x: 150, y: 400 },
  { name: "Noodle Shop", side: "S", residents: 4, x: 380, y: 270 },
];

// Spire gain for controlling a location, by its side.
const DL_CONTROL = {
  C: { C: 2, O: 0 },
  O: { C: 0, O: 2 },
  S: { C: 1, O: 1 },
};

// Ring of six plus the Noodle Shop (index 6) adjacent to all.
const DL_ADJ = [
  [1, 5, 6],
  [0, 2, 6],
  [1, 3, 6],
  [2, 4, 6],
  [3, 5, 6],
  [4, 0, 6],
  [0, 1, 2, 3, 4, 5],
];

const DL_ACTIONS = [
  { id: "recruit", name: "Recruit", copies: 5, text: "At one location, return up to 2 residents to the supply. Place 1 of your cubes there for each." },
  { id: "move", name: "Move", copies: 4, text: "Move up to 2 of your cubes 1 step each." },
  { id: "agitate", name: "Agitate", copies: 3, text: "At a location where you have a cube, push 1 opponent cube to an adjacent location." },
  { id: "seize", name: "Seize", copies: 3, text: "At a location where you have more cubes than an opponent, return 1 of their cubes to their reserve." },
];

/* Parked for a later version — not used by the rules or the game.

Actions: Convert (switch a cube's side), Draw 2 (draw Schemes).

Schemes (shared hand deck, each card played as Citizen or Outcast):
  Patronage  — C: Recruit, into Citizen halves only.        O: Move 2 of your Outcast recruits 1 step each.
  Turncoat   — C/O: Replace 1 opponent recruit of the other side with yours, where you control that half.
  Curfew     — C: Nobody may Recruit or Move into a location until cleanup.  O: Agitate, ignoring its requirement.
  Riot       — C: Seize, ignoring its Citizen requirement.   O: Every Citizen recruit at one location moves out.
  Smuggling  — C: Convert 1 recruit, then Draw 1.            O: Place 1 recruit without returning a resident.
  Blackmail  — C: Take 1 random Scheme from an opponent.     O: Take another action right away.

Identities (1 Citizen + 1 Outcast per player):
  Guild Delegate — Citizen halves of Citizen districts you control score +1.
  Magistrate     — After you Seize: Citizen +1.
  Landlord       — Your recruits in the Noodle Shop count double for control.
  Street Fixer   — Recruit or Move into a location with an opponent: Outcast +1 (once per action).
  Smuggler       — Your Outcast recruits in Citizen districts count double for control.
  Agitator       — After you Agitate: Outcast +1.
*/
