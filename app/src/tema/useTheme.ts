// Copiado de concreta-v2/src/lib/theme/useTheme.ts (© Javier Ramírez Bandera; V-a en docs/fem3d/visor.md).
import { useContext } from "react";
import { ThemeContext } from "./ThemeProvider";

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used inside <ThemeProvider>");
  }
  return ctx;
}
