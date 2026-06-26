import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("No se encontro el elemento #root");
}
// Capturado en una const no-nullable: dentro del closure async de arrancar() el
// estrechamiento por control-flow de `rootEl` no se conserva, asi que fijamos aqui el
// valor ya verificado para que createRoot lo reciba sin cast.
const root = rootEl;

// Arranque de la app. Bajo VITE_E2E (y solo entonces) monta la costura de test
// `window.__concreta` ANTES del render: asi instala el mock del solver (si
// addInitScript fijo __E2E_MOCK) antes de que App dispare usePrecargaMotor, ganando
// la carrera con el worker real (D2). En produccion VITE_E2E no esta definida, la
// rama es dead code y Vite hace tree-shake del import dinamico: el harness (y el
// mockSolver que arrastra) no entran en el bundle (D8).
async function arrancar(): Promise<void> {
  if (import.meta.env.VITE_E2E) {
    const bridge = await import("./test-harness/e2eBridge");
    bridge.montar();
  }
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void arrancar();
