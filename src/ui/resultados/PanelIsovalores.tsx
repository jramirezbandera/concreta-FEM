// PanelIsovalores: panel de DATOS (dock) de la pestana Isovalores (F3). Ofrece el SELECTOR
// de magnitud (Flecha / Mx / My), los estados guia y el aviso de obsoleto. [AUDITORIA D10]
// La RAMPA de color ya NO vive aqui: se mudo a `LeyendaIsovalores` (glass junto al lienzo,
// vertical, Slot mid-right), misma ubicacion/orientacion que la leyenda de la deformada. Asi
// las dos leyendas de la misma rampa dejan de vivir en sitios distintos.
//
// Se autooculta (estado vacio guia) si no hay resultados de placa para la combinacion activa
// (un portico sin losa). El panel conserva su gate en la misma fuente pura (construirBuffers-
// Isovalores) para decidir vacio-vs-selector, pero no dibuja la rampa.
//
// ESTADO HONESTO (F3, unidireccional): si la obra calculada tiene forjados unidireccionales
// (trazabilidad.panoAMembers no vacio) pero NINGUNA losa que colorear, el estado vacio lo
// explica en lenguaje de obra en vez de sugerir "introduce un paño" (que ya existe): los
// isovalores son de losas macizas; el forjado unidireccional se lee por reacciones/deformada.
//
// LENGUAJE DE OBRA (CLAUDE.md §17): "Flecha", "Momento Mx", "Momento My"; nunca "quad" ni
// "nodo".
import { useMemo, useSyncExternalStore } from "react";
import { PanelFlotante, Segmentado } from "../primitivas";
import { resultadosStore, vistaStore } from "../../estado";
import type { MagnitudIsovalores } from "../../estado";
import type { ModeloFEM, Trazabilidad } from "../../discretizador";
import type { ResultadosCalculo } from "../../solver";
import { construirBuffersIsovalores } from "./isovaloresBuffers";
import "./panelIsovalores.css";

// Opciones del selector de magnitud (lenguaje de obra). El identificador interno
// (flecha/momentoX/momentoY) va en vistaStore; aqui solo la etiqueta visible.
const OPCIONES: ReadonlyArray<{
  valor: MagnitudIsovalores;
  etiqueta: string;
  titulo: string;
}> = [
  { valor: "flecha", etiqueta: "Flecha", titulo: "Flecha (desplazamiento vertical)" },
  { valor: "momentoX", etiqueta: "Mx", titulo: "Momento Mx por unidad de ancho" },
  { valor: "momentoY", etiqueta: "My", titulo: "Momento My por unidad de ancho" },
];

// --- Lectura reactiva (fuera del bucle de render) ----------------------------

interface Entradas {
  modeloFEM: ModeloFEM | null;
  trazabilidad: Trazabilidad | null;
  resultados: ResultadosCalculo | null;
  vigente: boolean;
  combo: string | null;
  magnitud: MagnitudIsovalores;
}

let snapCache: Entradas = leerEntradas();
function leerEntradas(): Entradas {
  const r = resultadosStore.getState();
  const v = vistaStore.getState();
  return {
    modeloFEM: r.modeloFEM,
    trazabilidad: r.trazabilidad,
    resultados: r.resultados,
    vigente: r.vigente,
    combo: v.combinacionActiva,
    magnitud: v.magnitudIsovalores,
  };
}
function getSnapshot(): Entradas {
  const a = leerEntradas();
  const c = snapCache;
  if (
    a.modeloFEM === c.modeloFEM &&
    a.trazabilidad === c.trazabilidad &&
    a.resultados === c.resultados &&
    a.vigente === c.vigente &&
    a.combo === c.combo &&
    a.magnitud === c.magnitud
  ) {
    return c;
  }
  snapCache = a;
  return a;
}
function suscribir(cb: () => void): () => void {
  const offM = resultadosStore.subscribe((s) => s.modeloFEM, cb);
  const offT = resultadosStore.subscribe((s) => s.trazabilidad, cb);
  const offR = resultadosStore.subscribe((s) => s.resultados, cb);
  const offV = resultadosStore.subscribe((s) => s.vigente, cb);
  const offCombo = vistaStore.subscribe((s) => s.combinacionActiva, cb);
  const offMag = vistaStore.subscribe((s) => s.magnitudIsovalores, cb);
  return () => {
    offM();
    offT();
    offR();
    offV();
    offCombo();
    offMag();
  };
}
function useEntradas(): Entradas {
  return useSyncExternalStore(suscribir, getSnapshot, getSnapshot);
}

export function PanelIsovalores() {
  const entradas = useEntradas();
  const setMagnitud = vistaStore.getState().setMagnitudIsovalores;

  // ¿Hay resultados de placa para colorear? Reusa la derivacion pura (misma fuente que el
  // overlay/leyenda): null si no hay quads/resultados. Solo se usa como GATE (vacio-vs-
  // selector); el rango numerico lo consume ahora LeyendaIsovalores, no este panel.
  const hayPlaca = useMemo(
    () =>
      construirBuffersIsovalores({
        modeloFEM: entradas.modeloFEM,
        trazabilidad: entradas.trazabilidad,
        resultados: entradas.resultados,
        combo: entradas.combo,
        magnitud: entradas.magnitud,
      }) !== null,
    [entradas],
  );

  // ¿La obra calculada tiene forjados UNIDIRECCIONALES? El discretizador registra sus
  // viguetas en `trazabilidad.panoAMembers` (espejo de panoAQuads para la losa); si hay
  // alguna entrada, hubo al menos un forjado unidireccional en el ultimo calculo. Los
  // isovalores muestran resultados de LOSA (placa); un forjado unidireccional no genera
  // mapa de color, se consulta por reacciones y deformada. Se comunica en lenguaje de obra.
  const hayForjadoUnidireccional = useMemo(() => {
    const porPano = entradas.trazabilidad?.panoAMembers ?? {};
    return Object.values(porPano).some((viguetas) => viguetas.length > 0);
  }, [entradas.trazabilidad]);

  // Sin resultados de placa: ESTADO VACIO GUIA (UX-I1). Antes se ocultaba el panel entero
  // (return null), dejando la pestana Isovalores sin explicar por que esta en blanco.
  // Ahora la seccion se muestra y guia al usuario. Si el modelo tiene forjados
  // unidireccionales (sin placa que colorear), el mensaje es HONESTO: los isovalores son
  // para losas; el forjado unidireccional se lee por reacciones y deformada.
  if (!hayPlaca) {
    return (
      <PanelFlotante className="cx-isovalores" titulo="Isovalores" tag="losa">
        {hayForjadoUnidireccional ? (
          <p className="cx-isovalores__vacio">
            Los isovalores muestran resultados de losas macizas. Los forjados
            unidireccionales se consultan por sus reacciones y su deformada.
          </p>
        ) : (
          <p className="cx-isovalores__vacio">
            No hay losas calculadas. Introduce un paño (Entrada de vigas → Paños) y calcula
            la obra.
          </p>
        )}
      </PanelFlotante>
    );
  }

  return (
    <PanelFlotante
      className="cx-isovalores"
      titulo="Isovalores"
      // Espejo de la deformada/reacciones: cuando la obra cambio tras calcular, el mapa ya
      // no corresponde al modelo (el overlay se agrisa). El tag lo comunica en --warning.
      tag={entradas.vigente ? "losa" : "obsoletos"}
      tagVariante={entradas.vigente ? "neutro" : "warning"}
    >
      {!entradas.vigente && (
        <p className="cx-isovalores__aviso" role="status">
          Resultados obsoletos: la obra cambió desde el último cálculo.
        </p>
      )}

      <div className="cx-isovalores__selector">
        <span className="cx-campo__label">Magnitud</span>
        <Segmentado<MagnitudIsovalores>
          opciones={OPCIONES}
          valor={entradas.magnitud}
          onValor={setMagnitud}
          aria-label="Magnitud de isovalores"
        />
      </div>
      {/* [D10] La rampa de color se muestra en `LeyendaIsovalores` (glass junto al lienzo,
          vertical), no aqui: el panel conserva selector + estados + aviso de obsoleto. */}
    </PanelFlotante>
  );
}
