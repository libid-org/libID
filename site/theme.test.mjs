import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const script = readFileSync(new URL("public/theme.js", import.meta.url), "utf8");

// Exercise saved preferences, both toggle directions, and blocked storage.
for (const saved of [null, "dark", "light", "invalid", "blocked"]) {
  let stored = saved;
  const buttons = Array.from({ length: 2 }, () => ({
    hidden: true,
    setAttribute(name, value) { this[name] = value; },
    addEventListener(event, listener) { this.click = listener; },
  }));
  const document = {
    documentElement: { dataset: {} },
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
    for (const button of buttons) {
      assert.equal(button.hidden, false);
      assert.equal(button["aria-pressed"], String(expected === "light"));
    }
    buttons[activeButton++ % buttons.length].click();
    if (saved !== "blocked") assert.equal(stored, document.documentElement.dataset.theme);
  }
}
console.log("Theme checks passed.");
