import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, expect, it } from "vitest";

import { THEME_STORAGE_KEY } from "./theme";

const source = readFileSync("public/theme-initializer.js", "utf8");

afterEach(() => {
  document.documentElement.classList.remove("dark");
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = "";
});

it.each([
  ["dark", false, true],
  ["light", true, false],
  ["system", true, true],
  [null, false, false],
  ["invalid", true, true],
] as const)(
  "initializes %s before hydration",
  (stored, systemDark, expectedDark) => {
    runInNewContext(source, {
      document: {
        currentScript: { dataset: { storageKey: THEME_STORAGE_KEY } },
        documentElement: document.documentElement,
      },
      localStorage: {
        getItem(key: string) {
          expect(key).toBe(THEME_STORAGE_KEY);
          return stored;
        },
      },
      matchMedia: () => ({ matches: systemDark }),
    });
    expect(document.documentElement.classList.contains("dark")).toBe(
      expectedDark,
    );
    expect(document.documentElement.style.colorScheme).toBe(
      expectedDark ? "dark" : "light",
    );
  },
);

it("uses the system theme when local storage is blocked", () => {
  runInNewContext(source, {
    document: {
      currentScript: { dataset: { storageKey: THEME_STORAGE_KEY } },
      documentElement: document.documentElement,
    },
    localStorage: {
      getItem() {
        throw new Error("Storage blocked");
      },
    },
    matchMedia: () => ({ matches: true }),
  });
  expect(document.documentElement).toHaveClass("dark");
  expect(document.documentElement.dataset.theme).toBe("system");
});
