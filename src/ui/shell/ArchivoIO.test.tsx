// Test del flujo de IMPORTACIÓN de ArchivoIO (D2). Project `jsdom`. Mockea `./importarObra`
// (la lógica que toca Dexie/store) para verificar la ORQUESTACIÓN de UI sin IndexedDB:
//   - fichero válido -> confirmación -> al Aceptar llama a aplicarImport + onImportado.
//   - fichero corrupto -> aviso de error (role=alert) SIN llamar a aplicarImport.
//   - cancelar la confirmación -> NO llama a aplicarImport (obra intacta).
// La secuencia real contra Dexie (crear proyecto + hidratar store) se prueba en el
// project `persistencia` (importarObra.integracion.test.ts): aquí no hay IndexedDB.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// --- Mock de la lógica de import (hoisted antes de importar el SUT) ---
const validarTextoImportMock = vi.fn();
const aplicarImportMock = vi.fn();

vi.mock("./importarObra", () => ({
  validarTextoImport: (texto: string) => validarTextoImportMock(texto),
  aplicarImport: (validado: unknown) => aplicarImportMock(validado),
}));

import { ArchivoIO } from "./ArchivoIO";
import { vistaStore } from "../../estado";

// Un File .json cuyo .text() devuelve el contenido dado. jsdom no implementa de forma
// fiable File.prototype.text(), así que lo definimos en la instancia (el componente lee
// el fichero con `await file.text()`).
function ficheroJson(contenido: string): File {
  const file = new File([contenido], "obra.json", { type: "application/json" });
  Object.defineProperty(file, "text", {
    value: () => Promise.resolve(contenido),
  });
  return file;
}

// Dispara la señal del menú (solicitarImport) y sube un fichero al input oculto.
async function elegirFichero(file: File): Promise<void> {
  const user = userEvent.setup();
  vistaStore.getState().solicitarImport();
  const input = (await screen.findByTestId(
    "archivo-import-input",
  )) as HTMLInputElement;
  await user.upload(input, file);
}

beforeEach(() => {
  validarTextoImportMock.mockReset();
  aplicarImportMock.mockReset();
  vistaStore.getState().resetImportarSolicitado();
});

describe("ArchivoIO · importación", () => {
  it("fichero válido: muestra confirmación y al Aceptar aplica el import y refresca el nombre", async () => {
    const onImportado = vi.fn();
    const modeloFalso = { schemaVersion: 3 };
    validarTextoImportMock.mockReturnValue({
      ok: true,
      modelo: modeloFalso,
      nombre: "Edificio importado",
      avisos: [],
    });
    aplicarImportMock.mockResolvedValue({
      proyectoId: "p-nuevo",
      nombre: "Edificio importado",
    });

    render(<ArchivoIO nombreObraActual="Obra vieja" onImportado={onImportado} />);
    await elegirFichero(ficheroJson("{...}"));

    // Confirmación explícita antes de sustituir la obra: nombra ambas obras.
    const dialogo = await screen.findByRole("dialog", { name: "Importar obra" });
    expect(dialogo).toHaveTextContent("Obra vieja");
    expect(dialogo).toHaveTextContent("Edificio importado");
    // Aún no se ha aplicado nada (solo se validó).
    expect(aplicarImportMock).not.toHaveBeenCalled();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Importar" }));

    await waitFor(() => expect(aplicarImportMock).toHaveBeenCalledTimes(1));
    expect(onImportado).toHaveBeenCalledTimes(1);
  });

  it("fichero corrupto: muestra el error en lenguaje de obra y NO aplica nada (obra intacta)", async () => {
    const onImportado = vi.fn();
    validarTextoImportMock.mockReturnValue({
      ok: false,
      errores: ["El archivo no es un JSON valido: puede estar danado."],
    });

    render(<ArchivoIO nombreObraActual="Obra vieja" onImportado={onImportado} />);
    await elegirFichero(ficheroJson("no-es-json"));

    // Aviso de error (role=alert) con el mensaje en lenguaje de obra.
    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("La obra actual no se ha modificado");
    expect(alerta).toHaveTextContent("El archivo no es un JSON valido");
    // NO se llamó a aplicarImport: la obra actual sobrevive intacta.
    expect(aplicarImportMock).not.toHaveBeenCalled();
    expect(onImportado).not.toHaveBeenCalled();
  });

  it("cancelar la confirmación no aplica el import (obra intacta)", async () => {
    const onImportado = vi.fn();
    validarTextoImportMock.mockReturnValue({
      ok: true,
      modelo: { schemaVersion: 3 },
      nombre: "Otra obra",
      avisos: [],
    });

    render(<ArchivoIO nombreObraActual="Obra vieja" onImportado={onImportado} />);
    await elegirFichero(ficheroJson("{...}"));

    await screen.findByRole("dialog", { name: "Importar obra" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(aplicarImportMock).not.toHaveBeenCalled();
    expect(onImportado).not.toHaveBeenCalled();
  });

  it("consume la señal del menú (importarSolicitado vuelve a false tras abrir el picker)", async () => {
    render(<ArchivoIO nombreObraActual="Obra" onImportado={vi.fn()} />);
    vistaStore.getState().solicitarImport();
    await waitFor(() =>
      expect(vistaStore.getState().importarSolicitado).toBe(false),
    );
  });
});
