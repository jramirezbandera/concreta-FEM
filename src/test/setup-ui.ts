// Setup del project `jsdom` de Vitest (tests de componente / RTL).
//   1. Matchers de @testing-library/jest-dom (toBeInTheDocument, toBeDisabled, ...).
//   2. Cleanup de RTL tras cada test: desmonta los arboles renderizados. RTL solo
//      registra cleanup automatico cuando Vitest expone `afterEach` como global
//      (test.globals=true). Aqui NO usamos globals (los tests importan describe/it/
//      expect explicitamente, como el resto del repo), asi que lo registramos a mano
//      para aislar cada test (los stores Zustand son singletons; ver beforeEach en
//      cada suite). Sin esto, los nodos de un test fugan al siguiente.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
