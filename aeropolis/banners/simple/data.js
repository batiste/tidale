// Banners: Simple — data. Factions, banner drawing and location names come from ../banners-data.js.

const SB = {
  spire: 16, // Spire heights 1 (base) to 16 (top). Citizens start on 16, Outcasts on 1.
  influence: 20, // influence cubes per player
  cost: { cit: 2, out: 1 }, // time spent by a move (Spire steps)
  place: { cit: 2, out: 1 }, // influence placed by "Place"
  control: 3, // a location you control under one of your banners: +3 to that banner
};
