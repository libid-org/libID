import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const script = readFileSync(new URL("public/theme.js", import.meta.url), "utf8");

// Exercise saved preferences, both toggle directions, and blocked storage.
for (const saved of [null, "dark", "light", "invalid", "blocked"]) {
  let stored = saved;
  let click;
  const button = {
    hidden: true,
    setAttribute(name, value) { this[name] = value; },
    addEventListener(event, listener) { click = listener; },
  };
  const document = {
    documentElement: { dataset: { theme: "dark" } },
    querySelector: () => button,
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
  assert.equal(button.hidden, false);
  for (const expected of [initial, initial === "light" ? "dark" : "light", initial]) {
    assert.equal(document.documentElement.dataset.theme, expected);
    assert.equal(button["aria-pressed"], String(expected === "light"));
    click();
    if (saved !== "blocked") assert.equal(stored, document.documentElement.dataset.theme);
  }
}
console.log("Theme checks passed.");
