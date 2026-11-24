// Measures the WCAG contrast of every colour role in src/app/globals.css
// against --paper and --paper-sunk, in the light and the dark theme.
//
//   npm run check:contrast
//
// Text roles need 4.5:1 (--ink-3, the quietest text, needs 5:1). Fills that
// draw a status mark or a chart line need 3:1, the WCAG minimum for graphics.
// Exits with 1 when any role is below its minimum.
import { readFileSync } from "node:fs";

const CSS_PATH = new URL("../src/app/globals.css", import.meta.url);
const GROUNDS = ["--paper", "--paper-sunk"];

const TEXT_ROLES = [
  "--ink",
  "--ink-2",
  "--ink-3",
  "--attention",
  "--st-accepted-text",
  "--st-queued-text",
  "--st-submitted-text",
  "--st-delivered-text",
  "--st-undelivered-text",
  "--st-expired-text",
  "--st-failed-text",
];

const GRAPHIC_ROLES = [
  "--st-accepted",
  "--st-queued",
  "--st-submitted",
  "--st-delivered",
  "--st-undelivered",
  "--st-expired",
  "--st-failed",
  "--focus",
  "--control-edge",
  "--chart-submitted",
  "--chart-receipts",
  "--chart-limit",
];

const minimumFor = (role) => (role === "--ink-3" ? 5 : TEXT_ROLES.includes(role) ? 4.5 : 3);

/** The custom properties declared in the first block that starts with `selector {`. */
function readBlock(css, selector) {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`No "${selector} {" block in globals.css`);
  const end = css.indexOf("\n}", start);
  const body = css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, "");
  const values = {};
  for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    values[name] = value.trim();
  }
  return values;
}

function resolve(name, values, seen = new Set()) {
  const raw = values[name];
  if (raw === undefined) throw new Error(`${name} is not defined`);
  if (seen.has(name)) throw new Error(`${name} refers to itself`);
  seen.add(name);
  const reference = /^var\((--[\w-]+)\)$/.exec(raw);
  return reference ? resolve(reference[1], values, seen) : raw;
}

function luminance(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`Expected a #rrggbb colour, got "${hex}"`);
  const channels = [0, 2, 4].map((i) => parseInt(match[1].slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const css = readFileSync(CSS_PATH, "utf8");
const light = readBlock(css, ":root");
const themes = {
  light,
  dark: { ...light, ...readBlock(css, ':root[data-theme="dark"]') },
};

let failures = 0;
for (const [theme, values] of Object.entries(themes)) {
  console.log(`\n${theme}`);
  console.log(`${"role".padEnd(24)}${GROUNDS.map((g) => g.padStart(14)).join("")}   min`);
  for (const role of [...TEXT_ROLES, ...GRAPHIC_ROLES]) {
    const colour = resolve(role, values);
    const minimum = minimumFor(role);
    const cells = GROUNDS.map((ground) => {
      const ratio = contrast(colour, resolve(ground, values));
      const ok = ratio >= minimum;
      if (!ok) failures += 1;
      return `${ratio.toFixed(2)}${ok ? " " : "!"}`.padStart(14);
    });
    console.log(`${role.padEnd(24)}${cells.join("")}   ${minimum.toFixed(1)}`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} pair(s) below the minimum (marked !).`);
  process.exit(1);
}
console.log("\nEvery role meets its minimum in both themes.");
