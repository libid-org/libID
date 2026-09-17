document.documentElement.dataset.theme = "dark";
try {
  if (localStorage.getItem("libid-theme") === "light") {
    document.documentElement.dataset.theme = "light";
  }
} catch {
  // Storage may be unavailable; the switch still works for this page.
}

document.addEventListener("DOMContentLoaded", () => {
  const buttons = document.querySelectorAll(".theme-toggle");
  const root = document.documentElement;
  const favicon = document.querySelector('link[rel~="icon"]');
  favicon.href = root.dataset.theme === "light" ? "/favicon-light.svg" : "/favicon.svg";
  buttons.forEach((button) => {
    button.hidden = false;
    button.setAttribute("aria-pressed", String(root.dataset.theme === "light"));
    button.addEventListener("click", () => {
      const light = root.dataset.theme !== "light";
      root.dataset.theme = light ? "light" : "dark";
      favicon.href = light ? "/favicon-light.svg" : "/favicon.svg";
      buttons.forEach((toggle) => toggle.setAttribute("aria-pressed", String(light)));
      try {
        localStorage.setItem("libid-theme", root.dataset.theme);
      } catch {
        // Keep the selected theme even when it cannot be saved.
      }
    });
  });
});
