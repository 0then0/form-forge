(() => {
  const apply = (theme) => {
    const dark =
      theme === "dark" ||
      (theme === "system" &&
        matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  };

  try {
    const key = document.currentScript.dataset.storageKey;
    const value = localStorage.getItem(key);
    apply(
      value === "light" || value === "dark" || value === "system"
        ? value
        : "system",
    );
  } catch {
    apply("system");
  }
})();
