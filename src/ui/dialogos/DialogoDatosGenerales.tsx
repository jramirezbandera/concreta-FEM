import { useEffect, useState } from "react";
import { Dialogo } from "./Dialogo";
import { Campo, Boton } from "../primitivas";
import { vistaStore } from "../../estado";
import {
  cargarProyecto,
  reanclarBaselineAutosave,
  renombrarProyecto,
} from "../../persistencia";
import "./datosGenerales.css";

// DialogoDatosGenerales (D13): datos generales de la obra. En F1 el único dato editable
// es el NOMBRE del proyecto. Auto-gateado por vistaStore.dialogoActivo === "datosGenerales"
// (montado una vez en App). Al Aceptar renombra el proyecto activo y refresca el Brandbar.
//
// EL NOMBRE ES METADATO DE PERSISTENCIA (condición del guardián): NO es Capa 1, NO entra en
// el undo, NO invalida resultados. Por eso NO pasa por modeloStore.ejecutar ni por un
// comando: se escribe directo en el repositorio (renombrarProyecto, la función que ya
// existe — no se duplica) y se relee para el Brandbar via `onRenombrado`.
//
// BASELINE OPTIMISTA (D13b): renombrarProyecto refresca `actualizadoEn` del registro sin
// pasar por el autosave del Modelo; si no se reancla la baseline conocida por el autosave,
// el PRÓXIMO guardado del modelo vería un falso conflicto (edición no persistida). Tras
// renombrar se relee `actualizadoEn` y se llama a reanclarBaselineAutosave(id, ...).
//
// VOCABULARIO DE OBRA (CLAUDE.md §9/§17): "Nombre de la obra"; cero jerga FEM.

export interface DialogoDatosGeneralesProps {
  /** Id del proyecto activo, o null si no hay persistencia (sin IndexedDB). */
  proyectoActivoId: string | null;
  /** Nombre actual de la obra (para prellenar el campo). */
  nombreActual: string;
  /** Llamado tras renombrar con éxito, para que el Brandbar relea el nombre. */
  onRenombrado: () => void;
}

export function DialogoDatosGenerales({
  proyectoActivoId,
  nombreActual,
  onRenombrado,
}: DialogoDatosGeneralesProps) {
  const dialogoActivo = vistaStore((s) => s.dialogoActivo);
  const cerrarDialogo = vistaStore((s) => s.cerrarDialogo);
  const open = dialogoActivo === "datosGenerales";

  // Campo controlado, sembrado con el nombre actual cada vez que el diálogo se abre (así
  // no arrastra una edición abortada de una apertura anterior).
  const [nombre, setNombre] = useState(nombreActual);
  useEffect(() => {
    if (open) setNombre(nombreActual);
  }, [open, nombreActual]);

  // Sin persistencia (proyectoActivoId null) no se puede renombrar de forma permanente:
  // el campo se muestra pero el guardado se avisa como no disponible.
  const persistenciaDisponible = proyectoActivoId !== null;
  const nombreLimpio = nombre.trim();
  const puedeAceptar = persistenciaDisponible && nombreLimpio.length > 0;

  const aceptar = async (): Promise<void> => {
    if (proyectoActivoId === null || nombreLimpio.length === 0) return;
    await renombrarProyecto(proyectoActivoId, nombreLimpio);
    // Reancla la baseline optimista con el nuevo `actualizadoEn` (D13b): evita un falso
    // conflicto en el siguiente guardado del modelo. Se relee del registro para no
    // depender de un timestamp calculado en la UI.
    const registro = await cargarProyecto(proyectoActivoId);
    if (registro !== undefined) {
      reanclarBaselineAutosave(proyectoActivoId, registro.actualizadoEn);
    }
    onRenombrado();
    cerrarDialogo();
  };

  const pie = (
    <>
      <Boton variante="ghost" onClick={cerrarDialogo}>
        Cancelar
      </Boton>
      <Boton
        variante="primary"
        disabled={!puedeAceptar}
        onClick={() => void aceptar()}
      >
        Aceptar
      </Boton>
    </>
  );

  return (
    <Dialogo
      open={open}
      onOpenChange={(o) => {
        if (!o) cerrarDialogo();
      }}
      titulo="Datos generales"
      pie={pie}
    >
      <div className="cx-datos">
        <Campo
          etiqueta="Nombre de la obra"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          // Enter confirma (si es válido), como en el resto de formularios.
          onKeyDown={(e) => {
            if (e.key === "Enter" && puedeAceptar) void aceptar();
          }}
          autoFocus
        />
        {!persistenciaDisponible && (
          <p className="cx-note" role="note">
            El nombre no se puede guardar: el almacenamiento del navegador no está
            disponible.
          </p>
        )}
      </div>
    </Dialogo>
  );
}
