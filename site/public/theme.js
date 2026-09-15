try {
  if (localStorage.getItem("libid-theme") === "light") {
    document.documentElement.dataset.theme = "light";
  }
} catch {
  // Storage may be unavailable; the switch still works for this page.
}

document.addEventListener("DOMContentLoaded", () => {
  const button = document.querySelector(".theme-toggle");
  const root = document.documentElement;
  button.hidden = false;
  button.setAttribute("aria-pressed", String(root.dataset.theme === "light"));
  button.addEventListener("click", () => {
    const light = root.dataset.theme !== "light";
    root.dataset.theme = light ? "light" : "dark";
    button.setAttribute("aria-pressed", String(light));
    try {
      localStorage.setItem("libid-theme", root.dataset.theme);
    } catch {
      // Keep the selected theme even when it cannot be saved.
    }
  });
});
