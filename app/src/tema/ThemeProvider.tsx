// Copiado de concreta-v2/src/lib/theme/ThemeProvider.tsx (© Javier Ramírez Bandera; V-a en docs/fem3d/visor.md), con leerClave/escribirClave en línea.
import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Theme } from "./types";

// Lo que hacía concreta-v2/src/lib/storage/seguro: localStorage sin lanzar
// (navegación privada, almacenamiento bloqueado).
function leerClave(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function escribirClave(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* sin almacenamiento: el tema dura lo que la pestaña */
  }
}

const STORAGE_KEY = "concreta-theme";

// Page-background per theme, kept in sync with --color-bg-primary in index.css.
// Drives <meta name="theme-color"> (mobile browser chrome).
const META_COLOR: Record<Theme, string> = {
  light: "#ffffff",
  dark: "#0c0c0e",
};

function isTheme(v: unknown): v is Theme {
  return v === "light" || v === "dark";
}

function storedTheme(): Theme | null {
  if (typeof window === "undefined") return null;
  const raw = leerClave(STORAGE_KEY);
  return isTheme(raw) ? raw : null;
}

function osPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Source of truth on mount: the data-theme attribute the pre-paint script in
 * index.html already set (avoids a flash / a React-vs-script mismatch). Falls
 * back to stored pref, then OS, then light — the same order the script uses.
 */
function readInitialTheme(): Theme {
  if (typeof document !== "undefined") {
    const attr = document.documentElement.dataset.theme;
    if (isTheme(attr)) return attr;
  }
  return storedTheme() ?? (osPrefersDark() ? "dark" : "light");
}

function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  // Suppress transitions for the duration of the flip so light↔dark changes
  // atomically (see html.theme-switching in index.css) instead of tearing.
  root.classList.add("theme-switching");
  root.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", META_COLOR[theme]);
  // Re-enable transitions once the new palette has painted (double rAF: a
  // single frame can race the paint and still tear). Guard for jsdom/SSR.
  if (typeof window !== "undefined" && window.requestAnimationFrame) {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => root.classList.remove("theme-switching"));
    });
  } else {
    root.classList.remove("theme-switching");
  }
}

export type ThemeContextValue = {
  theme: Theme;
  setTheme: (next: Theme) => void;
  toggleTheme: () => void;
};

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme);

  // Keep the <html> attribute + meta tag in sync with state.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Cross-tab sync: another tab toggled → follow it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      if (isTheme(e.newValue)) setThemeState(e.newValue);
      else if (e.newValue === null) setThemeState(osPrefersDark() ? "dark" : "light");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Follow the OS while the user has NOT picked a theme. After a manual choice
  // (stored pref present) the persisted value wins and we ignore OS changes.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => {
      if (storedTheme() === null) setThemeState(e.matches ? "dark" : "light");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    if (typeof window !== "undefined") escribirClave(STORAGE_KEY, next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      if (typeof window !== "undefined") escribirClave(STORAGE_KEY, next);
      return next;
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
