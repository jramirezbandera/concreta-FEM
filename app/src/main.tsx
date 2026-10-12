import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App.tsx";
import { AvisoVersion } from "./armazon/AvisoVersion.tsx";
import { ThemeProvider } from "./tema/ThemeProvider.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
      <AvisoVersion />
    </ThemeProvider>
  </StrictMode>,
);
