import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { palettes } from "./src/palette.mjs";
import { GET, getStaticPaths } from "./src/pages/[favicon].svg.js";

function luminance(hex) {
  const rgb = hex.match(/[\da-f]{2}/gi).map(value => parseInt(value, 16) / 255);
  const linear = rgb.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

assert.equal(palettes.dark.logo, palettes.light.logo);
for (const palette of Object.values(palettes)) {
  assert.deepEqual(Object.keys(palette), ["background", "surface", "text", "muted", "border", "accent", "logo"]);
  assert.notEqual(palette.logo, palette.accent);
  for (const [color, minimum] of [[palette.text, 4.5], [palette.muted, 4.5], [palette.accent, 4.5], [palette.logo, 3]]) {
    const pair = [luminance(color), luminance(palette.background)].sort((a, b) => a - b);
    assert((pair[1] + 0.05) / (pair[0] + 0.05) >= minimum, `${color} must be readable on ${palette.background}`);
  }
}
const icons = getStaticPaths();
assert.deepEqual(icons.map(({ params }) => params.favicon), ["favicon", "favicon-light"]);
for (const { props } of icons) {
  const response = GET({ props });
  assert.equal(response.headers.get("Content-Type"), "image/svg+xml");
  const svg = await response.text();
  assert(svg.includes(`fill="${props.palette.background}"`));
  assert(svg.includes(`stroke="${props.palette.logo}"`));
}

const script = readFileSync(new URL("public/theme.js", import.meta.url), "utf8");

// Exercise saved preferences, both toggle directions, and blocked storage.
for (const saved of [null, "dark", "light", "invalid", "blocked"]) {
  let stored = saved;
  const favicon = { href: "/favicon.svg" };
  const buttons = Array.from({ length: 2 }, () => ({
    hidden: true,
    setAttribute(name, value) { this[name] = value; },
    addEventListener(event, listener) { this.click = listener; },
  }));
  const document = {
    documentElement: { dataset: {} },
    querySelector(selector) {
      assert.equal(selector, 'link[rel~="icon"]');
      return favicon;
    },
    querySelectorAll: () => buttons,
    addEventListener: (event, listener) => listener(),
  };
  runInNewContext(script, {
    document,
    localStorage: {
      getItem(key) {
        assert.equal(key, "libid-theme");
        if (saved === "blocked") throw new Error("Storage blocked");
        return stored;
      },
      setItem(key, value) {
        assert.equal(key, "libid-theme");
        if (saved === "blocked") throw new Error("Storage blocked");
        stored = value;
      },
    },
  });
  const initial = saved === "light" ? "light" : "dark";
  let activeButton = 0;
  for (const expected of [initial, initial === "light" ? "dark" : "light", initial]) {
    assert.equal(document.documentElement.dataset.theme, expected);
    assert.equal(favicon.href, expected === "light" ? "/favicon-light.svg" : "/favicon.svg");
    for (const button of buttons) {
      assert.equal(button.hidden, false);
      assert.equal(button["aria-pressed"], String(expected === "light"));
    }
    buttons[activeButton++ % buttons.length].click();
    if (saved !== "blocked") assert.equal(stored, document.documentElement.dataset.theme);
  }
}
console.log("Theme checks passed.");
