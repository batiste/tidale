#!/usr/bin/env node
/*
 * Exports the decks and the board as JPEGs for screentop.gg.
 *
 *   node export-screentop.js            # every target
 *   node export-screentop.js board      # just one (or several)
 *
 * Each deck lands as one gapless grid image — screentop slices it back into
 * cards, so give it the "grid" (cols x rows) this script prints. The pages
 * render themselves: deck.html?sheet=<name> and board.html?export (see their
 * export CSS). No npm dependencies — it drives the installed Chrome over the
 * DevTools protocol.
 */

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT_DIR = path.join(__dirname, "export");
const QUALITY = 92;

const TARGETS = {
  "base-deck": { page: "deck.html?sheet=base", selector: ".deck" },
  "conflict-deck": { page: "deck.html?sheet=conflict", selector: ".deck" },
  "shop-deck": { page: "deck.html?sheet=shop", selector: ".deck" },
  // Board width is viewport-driven; this is the widest the 3-column layout
  // holds before board.css's 900px breakpoint would ever matter.
  board: { page: "board.html?export", selector: ".board", width: 1200, height: 1400 },
  character: { page: "deck.html?sheet=character", selector: ".deck" },
};

const SHEET_VIEWPORT = { width: 3000, height: 2000 };

/* ---------- DevTools protocol client ---------- */

async function launchChrome(port, profileDir) {
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--force-color-profile=srgb",
      "--allow-file-access-from-files",
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return { chrome, wsUrl: page.webSocketDebuggerUrl };
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  chrome.kill();
  throw new Error("Chrome did not start");
}

function connect(wsUrl) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  const waiters = new Map();
  let nextId = 0;

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined) {
      const { resolve, reject } = pending.get(message.id) ?? {};
      pending.delete(message.id);
      if (message.error) reject?.(new Error(message.error.message));
      else resolve?.(message.result);
    } else if (waiters.has(message.method)) {
      waiters.get(message.method)();
      waiters.delete(message.method);
    }
  });

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  return {
    ready,
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    once(method) {
      return new Promise((resolve) => waiters.set(method, resolve));
    },
    close: () => socket.close(),
  };
}

/* ---------- export ---------- */

async function exportTarget(cdp, name, target) {
  const { width, height } = target.width ? target : SHEET_VIEWPORT;
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const loaded = cdp.once("Page.loadEventFired");
  await cdp.send("Page.navigate", {
    url: `file://${path.join(__dirname, target.page)}`,
  });
  await loaded;

  // Web fonts and the board's canvas both settle a frame or two after load.
  await cdp.send("Runtime.evaluate", {
    expression: `document.fonts.ready.then(() => new Promise((done) =>
      requestAnimationFrame(() => requestAnimationFrame(done))))`,
    awaitPromise: true,
  });

  const { result } = await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const box = document.querySelector(${JSON.stringify(target.selector)}).getBoundingClientRect();
      const cards = document.querySelectorAll(".card").length;
      const cols = Math.round(box.width / (document.querySelector(".card")?.getBoundingClientRect().width || box.width));
      return { x: box.x + scrollX, y: box.y + scrollY, width: box.width, height: box.height, cards, cols };
    })()`,
    returnByValue: true,
  });
  const box = result.value;

  const shot = await cdp.send("Page.captureScreenshot", {
    format: "jpeg",
    quality: QUALITY,
    captureBeyondViewport: true,
    clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 },
  });

  const file = path.join(OUT_DIR, `${name}.jpg`);
  fs.writeFileSync(file, Buffer.from(shot.data, "base64"));

  const grid =
    name === "board" ? "" : ` — ${box.cards} cards, grid ${box.cols} x ${box.cards / box.cols}`;
  console.log(
    `${path.relative(process.cwd(), file)}  ${Math.round(box.width)} x ${Math.round(box.height)}px` +
      `  ${(fs.statSync(file).size / 1024).toFixed(0)} KB${grid}`
  );
}

async function main() {
  const asked = process.argv.slice(2);
  const unknown = asked.filter((name) => !TARGETS[name]);
  if (unknown.length) {
    console.error(`Unknown target(s): ${unknown.join(", ")}`);
    console.error(`Available: ${Object.keys(TARGETS).join(", ")}`);
    process.exit(1);
  }
  const names = asked.length
    ? asked
    : Object.keys(TARGETS).filter((name) => TARGETS[name].default !== false);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "aeropolis-export-"));
  const { chrome, wsUrl } = await launchChrome(9333 + (process.pid % 500), profileDir);
  const cdp = connect(wsUrl);

  try {
    await cdp.ready;
    await cdp.send("Page.enable");
    for (const name of names) await exportTarget(cdp, name, TARGETS[name]);
  } finally {
    cdp.close();
    chrome.kill();
    fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
