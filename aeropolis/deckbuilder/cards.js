const CARD_SIZE_MM = {
  width: 57,
  height: 89,
};

const cardList = document.getElementById("card-list");
const statusEl = document.getElementById("status");
const reloadBtn = document.getElementById("reload-btn");
const downloadAllBtn = document.getElementById("download-all-btn");

const imageDataCache = new Map();

const EFFECT_ICON_SOURCES = {
  coin: "./coin.png",
  cog: "./cog.png",
  cred: "./cred.png",
};

const EXPORT_STYLESHEET_URL = new URL("./styles.css", window.location.href).href;

const FALLBACK_IMAGE_DATA_URI =
  "data:image/svg+xml;charset=UTF-8," +
  encodeURIComponent(`
<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 80'>
  <defs>
    <linearGradient id='g' x1='0' x2='1' y1='0' y2='1'>
      <stop offset='0%' stop-color='#d9d9d9'/>
      <stop offset='100%' stop-color='#b6b6b6'/>
    </linearGradient>
  </defs>
  <rect width='120' height='80' fill='url(#g)'/>
  <path d='M0 0L120 80M120 0L0 80' stroke='#909090' stroke-width='2'/>
</svg>
`);

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function mmToPx(mm) {
  return (mm * 96) / 25.4;
}

function formatEffectHtml(effectText, iconSources = EFFECT_ICON_SOURCES) {
  const escapedText = escapeHtml(effectText || "");
  return escapedText.replace(/\b(coin|cog|cred)(s?)\b/gi, (match, token, plural) => {
    const normalizedToken = token.toLowerCase();
    const source = iconSources[normalizedToken];
    if (!source) {
      return match;
    }

    return `<span class="inline-icon-wrap"><img class="inline-icon" src="${source}" alt="${normalizedToken}" /></span>${plural || ""}`;
  });
}

function cardFileName(card) {
  const source = card.id || card.title || "card";
  return source
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function setStatus(message) {
  statusEl.textContent = message;
}

async function fetchCards() {
  const response = await fetch("./cards.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load cards.json (${response.status})`);
  }
  const payload = await response.json();
  return Array.isArray(payload) ? payload : payload.cards;
}

function renderCards(cards) {
  cardList.innerHTML = "";

  cards.forEach((card) => {
    const item = document.createElement("li");
    item.className = "card-item";

    const cardEl = document.createElement("article");
    cardEl.className = "card";
    cardEl.dataset.cardId = card.id || "";
    cardEl.dataset.title = card.title || "";
    cardEl.dataset.image = card.image || "";
    cardEl.dataset.faceUpEffect = card.faceUpEffect || "";
    cardEl.dataset.faceDownEffect = card.faceDownEffect || "";

    const safeTitle = escapeHtml(card.title || "Untitled");
    const renderedFaceUp = formatEffectHtml(card.faceUpEffect || "");
    const renderedFaceDown = formatEffectHtml(card.faceDownEffect || "");
    const imageSrc = card.image || FALLBACK_IMAGE_DATA_URI;

    cardEl.innerHTML = `
      <section class="card-top">
        <h2 class="card-title">${safeTitle}</h2>
        <div class="card-image-wrap">
          <img class="card-image" src="${imageSrc}" alt="${safeTitle} art" />
        </div>
      </section>
      <section class="card-middle">
        <p class="effect-text">${renderedFaceUp}</p>
      </section>
      <section class="card-bottom">
        <p class="effect-text">${renderedFaceDown}</p>
      </section>
    `;

    cardEl.querySelector(".card-image")?.addEventListener("error", (event) => {
      event.currentTarget.src = FALLBACK_IMAGE_DATA_URI;
    });

    const actions = document.createElement("div");
    actions.className = "card-actions";

    const downloadBtn = document.createElement("button");
    downloadBtn.type = "button";
    downloadBtn.textContent = "Download PNG";
    downloadBtn.addEventListener("click", async () => {
      downloadBtn.disabled = true;
      setStatus(`Exporting ${card.title || "card"}...`);
      try {
        await exportCard(cardEl);
        setStatus(`Downloaded ${card.title || "card"}.`);
      } catch (error) {
        console.error(error);
        setStatus(`Failed to export ${card.title || "card"}.`);
      } finally {
        downloadBtn.disabled = false;
      }
    });

    actions.append(downloadBtn);
    item.append(cardEl, actions);
    cardList.append(item);
  });
}

function buildExportMarkup(cardHtml) {
  return `
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <link rel="stylesheet" href="${EXPORT_STYLESHEET_URL}" />
  </head>
  <body>
    ${cardHtml}
  </body>
</html>
`;
}

function buildExportCardHtml(cardEl, imageSource, faceUpHtml, faceDownHtml) {
  // Clone the rendered card so export stays in sync with the on-page HTML structure.
  const exportCardEl = cardEl.cloneNode(true);

  const exportImageEl = exportCardEl.querySelector(".card-image");
  if (exportImageEl) {
    exportImageEl.src = imageSource;
    exportImageEl.alt = "";
  }

  const [faceUpEl, faceDownEl] = exportCardEl.querySelectorAll(".effect-text");
  if (faceUpEl) {
    faceUpEl.innerHTML = faceUpHtml;
  }
  if (faceDownEl) {
    faceDownEl.innerHTML = faceDownHtml;
  }

  return exportCardEl.outerHTML;
}

async function resolveEffectIconSourcesForExport() {
  const pairs = await Promise.all(
    Object.entries(EFFECT_ICON_SOURCES).map(async ([token, sourcePath]) => [
      token,
      await resolveImage(sourcePath),
    ])
  );

  return Object.fromEntries(pairs);
}

async function resolveImage(imagePath) {
  if (!imagePath) {
    return FALLBACK_IMAGE_DATA_URI;
  }

  if (imageDataCache.has(imagePath)) {
    return imageDataCache.get(imagePath);
  }

  try {
    const response = await fetch(imagePath);
    if (!response.ok) {
      throw new Error(`Image fetch failed: ${response.status}`);
    }

    const blob = await response.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    imageDataCache.set(imagePath, dataUrl);
    return dataUrl;
  } catch {
    imageDataCache.set(imagePath, FALLBACK_IMAGE_DATA_URI);
    return FALLBACK_IMAGE_DATA_URI;
  }
}

function downloadBlob(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(objectUrl);
}

async function exportCard(cardEl) {
  if (!window.rasterizeHTML || typeof window.rasterizeHTML.drawHTML !== "function") {
    throw new Error("rasterizeHTML is not loaded. Add rasterizeHTML.allinone.js next to index.html.");
  }

  const cardData = {
    id: cardEl.dataset.cardId,
    title: cardEl.dataset.title,
    image: cardEl.dataset.image,
    faceUpEffect: cardEl.dataset.faceUpEffect,
    faceDownEffect: cardEl.dataset.faceDownEffect,
  };

  const imageSource = await resolveImage(cardData.image);
  const exportEffectIcons = await resolveEffectIconSourcesForExport();
  const faceUpHtml = formatEffectHtml(cardData.faceUpEffect, exportEffectIcons);
  const faceDownHtml = formatEffectHtml(cardData.faceDownEffect, exportEffectIcons);
  const cardHtml = buildExportCardHtml(cardEl, imageSource, faceUpHtml, faceDownHtml);
  const html = buildExportMarkup(cardHtml);

  const canvas = document.createElement("canvas");
  const widthPx = Math.round(mmToPx(CARD_SIZE_MM.width));
  const heightPx = Math.round(mmToPx(CARD_SIZE_MM.height));
  const scale = 3;

  canvas.width = widthPx * scale;
  canvas.height = heightPx * scale;

  await rasterizeHTML.drawHTML(html, canvas, {
    width: widthPx,
    height: heightPx,
    zoom: scale,
  });

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/png", 1)
  );

  if (!blob) {
    throw new Error("Canvas export did not produce a blob");
  }

  downloadBlob(blob, `${cardFileName(cardData)}.png`);
}

async function exportAllCards() {
  const cards = [...document.querySelectorAll(".card")];
  if (!cards.length) {
    setStatus("No cards to export.");
    return;
  }

  downloadAllBtn.disabled = true;
  try {
    for (let index = 0; index < cards.length; index += 1) {
      const cardEl = cards[index];
      const title = cardEl.dataset.title || cardEl.dataset.cardId || `card-${index + 1}`;
      setStatus(`Exporting ${index + 1}/${cards.length}: ${title}`);
      // Serial export avoids memory spikes with many high-resolution canvases.
      await exportCard(cardEl);
    }
    setStatus(`Exported ${cards.length} cards.`);
  } catch (error) {
    console.error(error);
    setStatus("Failed while exporting all cards.");
  } finally {
    downloadAllBtn.disabled = false;
  }
}

async function loadAndRenderCards() {
  setStatus("Loading cards...");
  try {
    const cards = await fetchCards();
    if (!Array.isArray(cards)) {
      throw new Error("cards.json must contain an array of card definitions.");
    }
    renderCards(cards);
    setStatus(`Loaded ${cards.length} cards.`);
  } catch (error) {
    console.error(error);
    cardList.innerHTML = "";
    setStatus(error.message || "Could not load cards.");
  }
}

reloadBtn.addEventListener("click", () => {
  loadAndRenderCards();
});

downloadAllBtn.addEventListener("click", () => {
  exportAllCards();
});

loadAndRenderCards();
