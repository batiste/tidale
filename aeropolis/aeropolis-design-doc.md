# Aeropolis — Design Reference

Status: early playtest draft, everything below is subject to change. This file
merges the concept pitch, the full rules, and every card/location currently in
the prototype, for discussing the design with an LLM.

---

## Concept

From the decadent high council to the ruthless underworld, no one in Aeropolis
is clean. Here, power sprouts from greed and blackmail, driving the city
toward revolution. Play both sides from the shadows, engineer a silent coup to
eliminate your rivals and seize absolute control.

**The Dynamic.** Each player begins with two distinct characters: a Citizen
and an Outcast. These characters anchor the left ends of two separate lines
("tableaus"), and cards are played into one line or the other. There are 5
Citizen characters and 5 Outcast characters designed (4 of each exist in the
current prototype), giving many possible starting pairings.

**Spire Track.** A vertical track runs up the middle of the board. Each
player's Citizen token starts at the top, their Outcast token at the bottom.
The Citizen loses status by moving down; the Outcast gains status by moving
up. A player's Revolution begins the moment their own Citizen and Outcast
tokens meet on the track.

*Track regress as a currency:* players can spend status by moving a character
down the track to generate resources or trigger effects, and can move back up
later. Moving down may cost you at the final meeting score, or access to
certain locations.

**Deckbuilding.** Tight construction: starting decks are small and meant to
cycle rapidly — aiming for 7–8 reshuffles across a game.

---

## Rules

### Setup

1. Each player drafts one Citizen character card and one Outcast character card.
2. Each player places their Citizen token at the top of the Spire and their Outcast token at the bottom.
3. Give each player the current example starter deck of 7 cards.
4. Give each player 2 coins.
5. Create a deck of 6 random Conflict cards.
6. Place 1 cube on each board location.

The character pool, player count, and exact starting setup are still playtest parameters.

### Round Structure

1. **Draw** — each player draws 4 cards from their deck.
2. **Action** — in turn order, each player takes one turn (Play, Discard, or Intrigue — see Taking An Action) until every player has discarded their whole hand and has no committed face-down card left to resolve.
3. **Replenish** — add cubes equal to 2 × the number of players, plus this round's Conflict card's Refill Bonus. Starting at the Conflict card's named location, place them one at a time around the locations in board order, looping back and skipping any location already at its cap, until every cube is placed. Then empty every line: discard every card in it (face-up or face-down) and return their cubes to the supply.

### Taking An Action

Each turn is one of three actions. Each player must act until they have nothing left to do.

**Play.** Play 1 card into a line (cards align left). Pay that position's play cost (set by the line's character), then **Recruit** 1 cube from an eligible location. Recruiting resolves that location's reward; depending on whether the card was played face up or face down, a second effect also resolves — the player chooses which of the two effects resolves first:

- *Face up:* slot the recruited cube in the card's normal socket and resolve the socket's effect.
- *Face down (Intrigue):* Sink that line's character 1 as a cost, and place the cube on top of the card instead (see Conflict).

A card marked **Broker** may be played into either line. A Citizen card belongs in the Citizen line; an Outcast card belongs in the Outcast line.

**Discard.** If you hold any cards, you may spend your turn discarding your remaining hand to resolve each card's Discard effect.

**Intrigue.** When you have no cards left in hand, if you have committed face-down cards, spend 1 turn resolving one of them: choose the rightmost face-down card in your line, flip it face up, and choose where to socket its cube — the card's normal socket, or the intrigue socket.

### Locations and Access

Each location holds up to a set number of cubes — 2 for most locations, 3 for the Noodle Shop. A location is available only while it holds at least 1 cube. Citizen locations are eligible when playing into the Citizen line; Outcast locations when playing into the Outcast line; shared locations (including the Noodle Shop) are eligible for either line.

If no eligible location has a cube, you usually cannot play the card. Recruiting takes the cube from the location and resolves that location's reward; slotting places the recruit in the card's normal socket and resolves the socket's effect — the player chooses which of the two to resolve first.

### Conflict

Each new round, a new Conflict card is revealed and placed on the board. It sets that round's Reward, Condition, and Refill Bonus (a named board location where this round's Replenish starts, plus 0–2 extra cubes).

A player typically commits to the conflict with a face-down card play (see Taking An Action).

Once everybody has passed, the conflict resolves: a player's total is the sum of the Intrigue values of their committed cards. The highest total wins and claims the reward. Ties break first by Citizen position, then Outcast position; if still tied, the reward is discarded.

### The Revolution

The Revolution begins immediately when either condition is met:

- A player's Citizen and Outcast meet on the Spire — that player then raises both their Citizen and Outcast by 2.
- The Conflict deck is exhausted.

Replace the Conflict pile with 3 random Revolution Conflict cards (playtest: replace the current conflict) — stronger versions of normal Conflict cards, same Reward/Condition/Refill Bonus shape.

### Glossary

- **Recruit** — take 1 grey cube from an eligible location and place it in your card's socket. Resolve the location's reward and the card's socket effect, in either order.
- **Plant** — take a cube from the supply and place it in any empty slot in this line: another card's socket, or the character anchoring it. Some cards name a different line to plant into instead (see Other Line).
- **Rise** — move the named character 1 space up the Spire track.
- **Sink** — move the named character 1 space down the Spire track.
- **Other Line** — the line opposite the one a card is played into: the Outcast line for a Citizen card, the Citizen line for an Outcast card. For a Broker card, whichever line it wasn't played into.
- **Refresh** — discard 1 card on offer in the Noodle Shop and replace it with a new one from the market deck.

### End Of The Game

The game ends after 3 Revolution rounds have been resolved. Players score Victory Points from their lowest position on the Spire, plus any other scoring effects.

If a player manages to have their Citizen and Outcast meet at the *top* of the Spire, they win immediately and the game ends on the spot.

---

## Board & Locations

Locations sit in three columns: Citizen-only, shared ("open to both"), and
Outcast-only. Each holds 2 cubes by default (3 for the Noodle Shop). A
location tagged "rail" is a stop on an unused/parked train sub-mechanic (see
Open Design Questions).

| Location | Side | Cubes | Reward on Recruit | Notes |
|---|---|---|---|---|
| The High Forum | Citizen | 2 | Rise Citizen 1 | |
| The Counting House | Citizen | 2 | 1 coin | |
| Gaming Den | Citizen | 2 | Sink Citizen 1 → 2 coin | Locked until Citizen reaches Spire space 14 |
| The Rust Bar | Outcast | 2 | Draw 1 card | |
| The Scrapyard | Outcast | 2 | Trash 1 card from hand or discard | |
| The Cable Lift | Outcast | 2 | Rise Outcast 1 | |
| Noodle Shop | Shared | 3 | Buy 1 card, paying its coin cost | Also holds 5 cards on offer for purchase |

**The Spire track** — 16 spaces. Citizen starts on space 16 (top), Outcast on
space 1 (bottom); a player's Revolution triggers when their own two tokens
meet. Each space scores a different VP value at game end (from a player's
*lowest* token position): starting at 1 VP on space 1 and rising to 33 VP on
space 16, with the gap between adjacent spaces capped at 3.

---

## Cards

Icon shorthand used below: "cube" = an empty socket that takes a Recruit's
cube to fire; "→" separates a cost from its payoff; "coin"/"Rise"/"Sink" are
defined in the Glossary above.

### Characters (one Citizen + one Outcast drafted per player)

| Name | Line | Sockets | Play cost (1st/2nd/3rd/4th card into this line) | Ability | Reward on filling all sockets ("Recruits") |
|---|---|---|---|---|---|
| Councillor Vane | Citizen | 3 | Free / 1 / 2 / 3 coin | Play 3 cards on this line → Rise 1. | Rise 1, 3 coin |
| The Ferryman | Outcast | 3 | Free / 1 / 2 / 3 coin | Once per round, 1 coin → Rise 1. | Rise 2 |
| The Assessor | Citizen | 2 | Free / 1 / 2 / 2 coin | Once per round, Sink 1 → 2 coin. | 2 coin |
| The Scavenger | Outcast | 2 | Free / 1 / 2 / 2 coin | Once per round, discard 1 card → Rise 1. | Rise 1, or Trash a card |

### Starter Deck — 7 cards (identical for every player)

| Name | Line | Play effect (cube socket) | Conflict value | Discard effect |
|---|---|---|---|---|
| Fixer | Broker | *(bare socket, no listed effect — looks like a placeholder)* | 1 | 1 coin |
| Snitch | Outcast | *(bare socket, no listed effect — looks like a placeholder)* | 1 | 1 coin |
| Smuggler | Outcast | Rise Outcast 1 | 1 | 1 coin |
| Embezzler | Outcast | For each card in your other line: 1 coin | 2 | 1 coin |
| Shady Deals | Outcast | Sink Outcast 1 → 1 coin | 1 | 1 coin |
| Whisper | Outcast | Refresh 1 | 1 | 1 coin |
| Agitator | Citizen | Sink Citizen 1 → Rise Outcast 1 | 2 | 1 coin |

Note: Fixer and Snitch currently have no card text beyond the socket itself
(Snitch's data literally holds the word "cube," which just renders as the
socket icon again) — flagging in case that's an unfinished edit rather than
intentional.

### Noodle Shop — 10 cards, bought with coin before joining your hand

Cost is paid up front at the Noodle Shop location; after purchase these cards
follow the same play process as the starter deck (still recruit and socket a
cube). Revolutionary Organizer and Echo are playtest probes for the Other
Line rule, priced above the rest of the shop since their effect scales with
board state instead of paying a flat amount.

| Name | Line | Play effect (cube socket) | Cost | Conflict value | Discard effect |
|---|---|---|---|---|---|
| Tipster | Broker | 1 coin → Draw 1 card, cube → Refresh 1 | 2 | 2 | 1 coin |
| Stevedore | Outcast | cube → Rise Outcast 2 | 2 | 2 | 1 coin |
| Bribe | Outcast | Your next card played into this line costs nothing | 2 | 2 | 1 coin |
| Under the table | Citizen | Sink Citizen 2 → 4 coin | 3 | 1 | Rise 1 |
| Powerbroker | Broker | (2 sockets) Rise Citizen 1, Rise Outcast 1, 1 coin / 1 coin, Intrigue 1 | 5 | 2 | 2 coin |
| The Solicitor | Citizen | Rise Citizen 1, Draw 1 card | 3 | 1 | 1 coin |
| The Cutthroat | Outcast | Discard 1 card → Rise Outcast 2, 1 coin | 3 | 2 | 1 coin |
| The Middleman | Broker | (2 sockets) cube → Rise Outcast / 1 coin → Refresh 1 | 4 | 1 | 1 coin |
| Revolutionary Organizer | Outcast | cube, for each card in your other line: Rise Outcast | 4 (probe) | 2 | 1 coin |
| Echo | Broker | Repeat the effect of every slotted card in your other line | 5 (probe) | 2 | 1 coin |

### Conflict Cards — 5 in the base pile (6 drawn randomly at setup, per Setup step 5)

Refill Bonus = extra cubes added on top of the 2×player-count base (see Round Structure — Replenish); Refill Start = where that round's Replenish begins placing cubes.

| Name | Line | Reward | Condition | Refill Start | Refill Bonus |
|---|---|---|---|---|---|
| Show Trial | Citizen | Rise Citizen 2, cube | The player with the longest line: Intrigue 1 | The High Forum | +1 |
| Underground Vote | Outcast | Rise Outcast 2, 1 coin | Each losing player: 1 coin | The Scrapyard | +2 |
| Public Inquiry | Citizen | 4 coin | The player with the lowest Citizen may not commit an Intrigue | Noodle Shop | +2 |
| The Informant's Price | Outcast | Rise Outcast 1, 2 coin | Each player: Sink Outcast 1 | The Cable Lift | +2 |
| Closed Session | Citizen | 4 coin | Player(s) with the highest Citizen: Intrigue 1 | Gaming Den | +1 |

### Revolution Conflict Cards — 3 shuffled in once the Revolution begins

Same shape as Conflict cards, raised stakes.

| Name | Line | Reward | Condition | Refill Start | Refill Bonus |
|---|---|---|---|---|---|
| The Tribunal | Citizen | Rise Citizen 3, 2 coin | Every losing player: Sink Citizen 1 | The Rust Bar | +2 |
| Blood In The Streets | Outcast | Rise Outcast 3 | Each losing player: Sink Outcast 1 | The Counting House | +0 |
| The Purge | Outcast | Rise Outcast 3, cube | Each player: Refresh 1 | The High Forum | +2 |

---

## Open Design Questions (unresolved, current playtest focus)

- **Abundance problem.** A card play currently stacks a location's Recruit reward *and* the card's own socket effect "for free," and cube supply usually exceeds what a 4-card hand can spend. Coin income (mostly 1-coin discard effects) also outpaces the escalating play-cost curve. Net effect: a full hand can usually all be played, so turns read as bookkeeping rather than real tradeoffs.
- **Where interaction currently lives:** Conflict bidding (real, scarce, zero-sum) and shared cube/market contention (real but softened by oversupply). The Spire race is real but only bites at the Revolution trigger and endgame scoring.
- **Two characters vs. one.** The Citizen/Outcast split is the concept's core hook (playing both sides, meeting in the middle). Leaning toward keeping it and fixing scarcity instead of cutting to a single line/character.
- **Proposal under consideration: Dune Imperium-style exclusive agent placement.** Replace "any card recruits from any location with a spare cube" with a small, fixed number of agents per player per round (2–3), each claiming one location exclusively for that round (locations become occupied/free rather than holding a multi-cube pool). This would: cap plays per round regardless of hand size (forcing genuine Play-vs-Discard choices), make locations directly contested between players, and simplify/replace the current Replenish cube-placement subroutine. Open sub-questions: exact agent count, whether a location can ever hold 2 agents instead of a strict 1, and whether a character's "once per round" ability should cost an agent or stay free.
