"use client";

import { cn } from "@form-forge/ui";
import { Laptop, Moon, Sun, type LucideIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

import { THEME_STORAGE_KEY } from "@/lib/theme";

type Theme = "system" | "light" | "dark";
const THEME_CHANGE_EVENT = "form-forge-theme-change";

const themes: Array<{ icon: LucideIcon; label: string; value: Theme }> = [
  { icon: Laptop, label: "System theme", value: "system" },
  { icon: Sun, label: "Light theme", value: "light" },
  { icon: Moon, label: "Dark theme", value: "dark" },
];

const isTheme = (value: string | null): value is Theme =>
  value === "system" || value === "light" || value === "dark";

const storedTheme = (): Theme => {
  if (document.documentElement.dataset.themeVolatile === "true") {
    const value = document.documentElement.dataset.theme ?? null;
    return isTheme(value) ? value : "system";
  }
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : "system";
  } catch {
    const value = document.documentElement.dataset.theme ?? null;
    return isTheme(value) ? value : "system";
  }
};

const applyTheme = (theme: Theme) => {
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
};

const persistTheme = (theme: Theme) => {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    delete document.documentElement.dataset.themeVolatile;
  } catch {
    document.documentElement.dataset.themeVolatile = "true";
  }
};

const subscribeTheme = (onStoreChange: () => void) => {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const handleChange = () => {
    applyTheme(storedTheme());
    onStoreChange();
  };
  window.addEventListener("storage", handleChange);
  window.addEventListener(THEME_CHANGE_EVENT, handleChange);
  media.addEventListener("change", handleChange);
  return () => {
    window.removeEventListener("storage", handleChange);
    window.removeEventListener(THEME_CHANGE_EVENT, handleChange);
    media.removeEventListener("change", handleChange);
  };
};

export const ThemeToggle = ({ className }: { className?: string }) => {
  const theme = useSyncExternalStore(
    subscribeTheme,
    storedTheme,
    () => "system" as const,
  );

  const selectTheme = (nextTheme: Theme) => {
    persistTheme(nextTheme);
    applyTheme(nextTheme);
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  };

  return (
    <div
      aria-label="Color theme"
      className={cn(
        "inline-flex items-center rounded-lg border border-slate-200 bg-white p-1 shadow-sm",
        className,
      )}
      role="group"
    >
      {themes.map((option) => {
        const selected = theme === option.value;
        return (
          <button
            key={option.value}
            aria-label={option.label}
            aria-pressed={selected}
            className={cn(
              "inline-flex size-7 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:outline-none",
              selected
                ? "bg-slate-950 text-white"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-950",
            )}
            title={option.label}
            type="button"
            onClick={() => selectTheme(option.value)}
          >
            <option.icon className="size-3.5" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
};
