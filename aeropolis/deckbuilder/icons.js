// Shared text-to-icon rendering for deck.html, board.html and play.html (styles
// in icons.css). Card and location text is written in plain words; this turns
// coin/cube/Draw/Rise/Sink/Plant/Intrigue/Refresh into their icons.

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Swap resource words for their icons, matching the existing card exporter.
// Any explicit count is folded into the coin icon itself (e.g. "1 coin" or
// "2 coin" → a coin showing that number); a bare, uncounted "coin" (a
// per-unit amount, e.g. "coin for each card...") stays a plain icon.
function withIcons(text) {
  return escapeHtml(text)
    .replace(
      /\b(?:(\d+)\s+)?coin(s?)\b/gi,
      (match, n, plural) =>
        n
          ? `<span class="coin" role="img" aria-label="${n} coin"><span class="coin-num">${n}</span></span>`
          : `<span class="coin" role="img" aria-label="coin"></span>${plural || ""}`
    )
    .replace(
      /\bcube(s?)\b/gi,
      (match, plural) => `<span class="cube-icon" role="img" aria-label="cube"></span>${plural || ""}`
    )
    .replace(
      // "Draw 1 card" becomes 1 card icon, text and all — same rule as
      // "Draw 1 card for each card in discard pile": the "1" there is a
      // per-unit rate, not a fixed amount, but reads the same either way.
      /\bDraw\s+(\d+)\s+cards?\b/gi,
      (match, n) =>
        `<span role="img" aria-label="Draw ${n} card${n > 1 ? "s" : ""}">${`<span class="card-icon" aria-hidden="true"></span>`.repeat(Number(n))}</span>`
    )
    .replace(
      // "Rise 1"/"Sink 2" becomes N icons and no text. A named subject
      // ("Rise Citizen 1", "Sinks Outcast 1" — write it bare, no "your"/
      // "their") drops its words too, but the icon is recoloured to
      // that subject's own colour instead of the card's — otherwise two
      // different subjects on one card (e.g. "Sink Citizen 1 → Rise
      // Outcast 1") would render as two same-coloured icons and lose
      // which character is which.
      /\b(Rise|Sink)(s?)\b(?:\s+(Citizen|Outcast))?\s*(\d+)?/g,
      (match, word, plural, subject, count) => {
        const cls = word === "Rise" ? "rise-icon" : "sink-icon";
        const n = count ? Number(count) : 1;
        const accent =
          subject === "Citizen" ? "var(--brass)" :
          subject === "Outcast" ? "var(--verdigris)" :
          null;
        const style = accent ? ` style="--accent:${accent}"` : "";
        const icon = `<span class="${cls}"${style} aria-hidden="true"></span>`;
        const label = subject ? `${word} ${subject} ${n}` : `${word} ${n}`;
        return `<span role="img" aria-label="${label}">${icon.repeat(n)}</span>`;
      }
    )
    .replace(
      // "Plant 1 in your Outcast line" (or Citizen): the cube, plus a
      // ground line over or under it — Outcast (underground) gets the
      // line above the cube, Citizen (above ground) gets it below.
      // Not an ordinary same-line Plant (see rules.html Glossary —
      // Plant / Other Line). Kept last in this chain: its output's own
      // class="cube-icon" text must not be re-matched by the plain
      // \bcube\b replace above.
      /\bPlant\s+(\d+)\s+in\s+your\s+(Citizen|Outcast)\s+line\b/gi,
      (match, n, targetLine) => {
        const modifier = /outcast/i.test(targetLine) ? "plant-other-outcast" : "plant-other-citizen";
        const step = `<span class="plant-other-icon ${modifier}" aria-hidden="true"><span class="cube-icon"></span></span>`;
        return `<span role="img" aria-label="Plant ${n} in your ${targetLine} line">${step.repeat(Number(n))}</span>`;
      }
    )
    .replace(
      // "Intrigue 1" → the same red circle as the card's own printed
      // Intrigue-value badge, just inline and smaller — for a socket
      // that grants Intrigue value directly, as text alongside it.
      /\bIntrigue\s+(\d+)\b/g,
      (match, n) =>
        `<span class="intrigue-icon" role="img" aria-label="Intrigue ${n}"><span class="intrigue-icon-num">${n}</span></span>`
    )
    .replace(
      // "Refresh 1" becomes N circular-arrow icons and no text, same
      // treatment as Rise/Sink/Draw (see rules.html Glossary — Refresh).
      /\bRefresh\s+(\d+)\b/g,
      (match, n) => {
        const icon = `<span class="refresh-icon" aria-hidden="true"></span>`;
        return `<span role="img" aria-label="Refresh ${n}">${icon.repeat(Number(n))}</span>`;
      }
    );
}
