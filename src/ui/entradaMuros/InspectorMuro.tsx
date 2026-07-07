// InspectorMuro (F3, muros): panel flotante que edita el muro SELECCIONADO con COMMIT
// EN VIVO. Espejo de InspectorPano, SOLO-PROPIEDADES: la geometría del eje la fija la
// introducción gráfica en planta, NO este formulario. Visible solo con EXACTAMENTE un
// muro seleccionado. Vocabulario de obra (Muro, Material, Espesor, Tamaño de malla,
// Anclado al terreno); cero jerga FEM.
//
// INVARIANTE DEL `base` (CLAUDE.md §10): los comandos se construyen contra el modelo
// ACTUAL leído justo antes de ejecutar. UNIDADES (§14): espesor/malla en mm (conversión
// en el borde vía CampoLongitudMm); el material por id.
import { useState } from "react";
import { PanelFlotante, Boton, SelectMaterial } from "../primitivas";
import { CampoLongitudMm, CampoVinculacionMuro } from "./camposMuro";
import { Dialogo } from "../dialogos/Dialogo";
import {
  modeloStore,
  seleccionStore,
  editarMuro,
  eliminarMuro,
} from "../../estado";
import { cargasDeAmbito } from "../../dominio";
import "./inspectorMuro.css";

function leerModelo() {
  return modeloStore.getState().getModelo();
}

// Longitud del eje del muro en planta (m), para el bloque solo-lectura de geometría.
function largoMuro(m: { x1: number; y1: number; x2: number; y2: number }): number {
  return Math.hypot(m.x2 - m.x1, m.y2 - m.y1);
}

export function InspectorMuro() {
  const seleccion = seleccionStore((s) => s.seleccion);
  const muros = modeloStore((s) => s.modelo.muros);

  const [confirmacion, setConfirmacion] = useState<{
    titulo: string;
    mensaje: string;
    onConfirmar: () => void;
  } | null>(null);

  const muroId = seleccion.length === 1 ? seleccion[0] : null;
  const muro = muroId ? muros.find((m) => m.id === muroId) ?? null : null;

  // Sin un muro aplicable (0, multiselección o id no-muro): el inspector no edita
  // nada (en la pestaña de vigas el editor principal es la viga/paño).
  if (!muro) return null;

  // Commit genérico de un campo: lee el modelo actual, aplica el parche si el valor
  // es válido (>0 para longitudes) y despacha. No-op si no cambia.
  const commit = (parche: Partial<Parameters<typeof editarMuro>[2]>) => {
    const m = leerModelo();
    const actual = m.muros.find((x) => x.id === muro.id);
    if (!actual) return;
    const sinCambio = (Object.keys(parche) as (keyof typeof parche)[]).every(
      (k) => actual[k as keyof typeof actual] === parche[k],
    );
    if (sinCambio) return;
    modeloStore.getState().ejecutar(editarMuro(m, muro.id, parche));
  };

  const ejecutarBorrar = () => {
    modeloStore.getState().ejecutar(eliminarMuro(leerModelo(), muro.id));
    seleccionStore.getState().limpiar();
  };

  const pedirBorrar = () => {
    const n = cargasDeAmbito(leerModelo(), muro.id).length;
    if (n === 0) {
      ejecutarBorrar();
      return;
    }
    setConfirmacion({
      titulo: `Eliminar ${muro.nombre}`,
      mensaje: `El muro tiene ${n} carga${n === 1 ? "" : "s"} asociada${n === 1 ? "" : "s"} que también se eliminará${n === 1 ? "" : "n"}.`,
      onConfirmar: () => {
        ejecutarBorrar();
        setConfirmacion(null);
      },
    });
  };

  const largo = largoMuro(muro);

  return (
    <>
      <PanelFlotante
        className="cx-inspector-muro"
        titulo={muro.nombre}
        tag="muro"
        data-testid="inspector-muro"
      >
        {/* Geometría solo-lectura: el eje se traza en planta, no se edita aquí. */}
        <div className="cx-inspector-muro__geo">
          <span className="cx-campo__label">Longitud</span>
          <span className="cx-mono">{largo.toFixed(2)} m</span>
        </div>

        <SelectMaterial
          etiqueta="Material"
          valor={muro.materialId}
          onCambio={(id) => commit({ materialId: id })}
        />
        <CampoLongitudMm
          etiqueta="Espesor"
          valorM={muro.espesor}
          onValorM={(m) => {
            if (Number.isFinite(m) && m > 0) commit({ espesor: m });
          }}
        />
        <CampoLongitudMm
          etiqueta="Tamaño de malla"
          valorM={muro.tamMalla}
          onValorM={(m) => {
            if (Number.isFinite(m) && m > 0) commit({ tamMalla: m });
          }}
        />
        <CampoVinculacionMuro
          className="cx-inspector-muro__campo"
          valor={muro.vinculacionExterior}
          onValor={(v) => commit({ vinculacionExterior: v })}
        />

        {/* Nota de honestidad del corte (F3, muros): rigidez lateral sí; cargas
            laterales y descarga directa de la losa, no (llega por viga de coronación). */}
        <p className="cx-note">
          El muro aporta rigidez frente a acciones horizontales (mueve el centro de
          rigidez del edificio) y recibe el forjado a través de una viga de coronación
          sobre su eje. En esta fase no admite empujes de viento ni de tierras.
        </p>

        <div className="cx-inspector-muro__acciones">
          <Boton variante="ghost" onClick={pedirBorrar}>
            Eliminar
          </Boton>
        </div>
      </PanelFlotante>

      <Dialogo
        open={confirmacion !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmacion(null);
        }}
        titulo={confirmacion?.titulo ?? ""}
        pie={
          <>
            <Boton variante="ghost" onClick={() => setConfirmacion(null)}>
              Cancelar
            </Boton>
            <Boton variante="danger" onClick={() => confirmacion?.onConfirmar()}>
              Eliminar
            </Boton>
          </>
        }
      >
        <p>{confirmacion?.mensaje}</p>
      </Dialogo>
    </>
  );
}
