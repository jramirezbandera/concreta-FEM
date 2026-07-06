import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { Dialogo } from "../dialogos/Dialogo";
import { Boton } from "../primitivas";
import { vistaStore } from "../../estado";
import {
  validarTextoImport,
  aplicarImport,
  type ResultadoValidacionImport,
} from "./importarObra";
import "./archivoIO.css";

// ArchivoIO (D2): dueño de la UI de Importar del menú Archivo. Monta un <input type=file>
// programático (oculto), la CONFIRMACIÓN antes de sobrescribir la obra y el AVISO de error
// en lenguaje de obra. Se monta una vez en App (como los diálogos), auto-gateado por la
// señal transitoria `vistaStore.importarSolicitado`: el menú la enciende; este componente
// abre el file picker y la apaga.
//
// EXPORTAR no necesita UI (sin diálogo, descarga directa): lo dispara el DISPATCH del menú
// (archivoIO.exportarObraActual). IMPORTAR sí: hay que elegir fichero, avisar si no valida
// (SIN tocar la obra) y confirmar antes de sustituir la obra actual.
//
// FLUJO: elegir fichero -> leer texto -> validarTextoImport (frontera Zod) ->
//   - si NO valida: aviso de error (role=alert), obra intacta.
//   - si valida: confirmación "Importar sustituirá la obra actual «X». ¿Continuar?"
//       -> al aceptar: aplicarImport (proyecto nuevo + hidratar store, resetea undo y
//          descarta resultados) + refrescar el nombre del Brandbar.
//       -> al cancelar: obra intacta.

export interface ArchivoIOProps {
  /** Nombre de la obra ACTUAL (para el texto de la confirmación de sustitución). */
  nombreObraActual: string;
  /** Refresca el nombre del Brandbar tras importar (relee el proyecto activo). */
  onImportado: () => void;
}

// Estado de la UI de importación. `null` en reposo (solo el file input, oculto).
type EstadoImport =
  | { fase: "confirmar"; validado: Extract<ResultadoValidacionImport, { ok: true }> }
  | { fase: "error"; errores: string[] };

export function ArchivoIO({ nombreObraActual, onImportado }: ArchivoIOProps) {
  const importarSolicitado = vistaStore((s) => s.importarSolicitado);
  const resetImportarSolicitado = vistaStore((s) => s.resetImportarSolicitado);
  const inputRef = useRef<HTMLInputElement>(null);
  const [estado, setEstado] = useState<EstadoImport | null>(null);

  // Cuando el menú enciende la señal, abre el selector de fichero y apaga la señal
  // (es un disparo puntual, no un modo persistente). El <input> real vive oculto.
  useEffect(() => {
    if (importarSolicitado) {
      resetImportarSolicitado();
      inputRef.current?.click();
    }
  }, [importarSolicitado, resetImportarSolicitado]);

  // Al elegir un fichero: leerlo, validarlo por la frontera Zod y decidir confirmación
  // o aviso de error. NUNCA toca la obra en este paso (solo valida).
  const onFichero = useCallback(
    async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
      const file = e.target.files?.[0];
      // Resetea el input para que elegir el MISMO fichero otra vez vuelva a disparar
      // el change (si no, el navegador no emite change al repetir selección).
      e.target.value = "";
      if (!file) return;
      let texto: string;
      try {
        texto = await file.text();
      } catch {
        setEstado({
          fase: "error",
          errores: [
            "No se pudo leer el archivo seleccionado. Inténtalo de nuevo.",
          ],
        });
        return;
      }
      const validado = validarTextoImport(texto);
      if (!validado.ok) {
        // Obra intacta: solo mostramos el error en lenguaje de obra.
        setEstado({ fase: "error", errores: validado.errores });
        return;
      }
      // Válido: pide confirmación explícita antes de sustituir la obra actual.
      setEstado({ fase: "confirmar", validado });
    },
    [],
  );

  const cerrar = useCallback(() => setEstado(null), []);

  const confirmarImport = useCallback(async (): Promise<void> => {
    if (estado?.fase !== "confirmar") return;
    await aplicarImport(estado.validado);
    // [D14/UX-3.1 · guardián M-1] Cambiar de obra por IMPORT tambien resetea el estado
    // de UI transitorio (dock + capas de visibilidad): la obra importada arranca con el
    // dock abierto y todo visible, igual que la carga del arranque.
    vistaStore.getState().resetDockUI();
    vistaStore.getState().resetCapas();
    // Refresca el nombre del Brandbar (el proyecto activo cambió al importado).
    onImportado();
    setEstado(null);
  }, [estado, onImportado]);

  // Nombre propuesto de la obra importada (para el texto de confirmación). Vacío -> genérico.
  const nombreImportado =
    estado?.fase === "confirmar" && estado.validado.nombre.trim().length > 0
      ? estado.validado.nombre.trim()
      : "obra importada";

  return (
    <>
      {/* Input de fichero oculto, disparado programáticamente por la señal del menú. */}
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        className="cx-sr-only"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => void onFichero(e)}
        data-testid="archivo-import-input"
      />

      {/* Confirmación de sustitución (patrón de los inspectores: Dialogo de Radix). */}
      <Dialogo
        open={estado?.fase === "confirmar"}
        onOpenChange={(o) => {
          if (!o) cerrar();
        }}
        titulo="Importar obra"
        pie={
          <>
            <Boton variante="ghost" onClick={cerrar}>
              Cancelar
            </Boton>
            <Boton variante="primary" onClick={() => void confirmarImport()}>
              Importar
            </Boton>
          </>
        }
      >
        <p className="cx-archivo-io__texto">
          Importar sustituirá la obra actual «{nombreObraActual}» por «{nombreImportado}».
          La obra actual se conservará como un proyecto aparte. ¿Continuar?
        </p>
      </Dialogo>

      {/* Aviso de error de importación (fichero corrupto/ajeno/versión futura). La obra
          actual NO se ha tocado. role="alert" para que lo anuncien los lectores. */}
      <Dialogo
        open={estado?.fase === "error"}
        onOpenChange={(o) => {
          if (!o) cerrar();
        }}
        titulo="No se pudo importar"
        pie={
          <Boton variante="ghost" onClick={cerrar}>
            Cerrar
          </Boton>
        }
      >
        <div className="cx-archivo-io__error" role="alert">
          <p>No se pudo importar el archivo. La obra actual no se ha modificado.</p>
          <ul className="cx-archivo-io__errores">
            {estado?.fase === "error" &&
              estado.errores.map((err, i) => <li key={i}>{err}</li>)}
          </ul>
        </div>
      </Dialogo>
    </>
  );
}
