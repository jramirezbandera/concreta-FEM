// LeyendaIsovalores: la RAMPA de color de los isovalores de la losa, anclada al lienzo
// (Slot mid-right) en glass, VERTICAL. [AUDITORIA D10] Antes esta rampa vivia DENTRO de
// PanelIsovalores (en el dock, horizontal), mientras la de la deformada vivia en glass junto
// al lienzo: dos leyendas de la MISMA rampa en sitios distintos y con orientaciones distintas
// (mismo color = cosas opuestas segun la pestana). Ahora AMBAS comparten ubicacion (mid-right)
// y orientacion (vertical, max arriba). PanelIsovalores conserva el selector de magnitud, los
// estados guia y el aviso de obsoleto; SOLO la rampa se muda aqui.
//
// Espejo de la lectura reactiva de PanelIsovalores (misma fuente pura: construirBuffers-
// Isovalores), pero renderiza solo la LeyendaRampa vertical. Se autooculta sin resultados de
// placa para la combinacion activa (un portico sin losa no pinta leyenda).
//
// LENGUAJE DE OBRA (CLAUDE.md §17) + UNIDADES en el borde (§14): la flecha (m interno) pasa a
// mm SOLO aqui (mToMm); Mx/My ya estan en kN·m/m (identidad).
import { useMemo, useSyncExternalStore } from "react";
import { resultadosStore, vistaStore } from "../../estado";
import type { MagnitudIsovalores } from "../../estado";
import type { ModeloFEM, Trazabilidad } from "../../discretizador";
import type { ResultadosCalculo } from "../../solver";
import { mToMm } from "../../unidades";
import { construirBuffersIsovalores } from "./isovaloresBuffers";
import { LeyendaRampa } from "./LeyendaRampa";
import { PanelFlotante } from "../primitivas";

// Etiqueta de unidad por magnitud (misma tabla que PanelIsovalores; lenguaje de obra).
const UNIDAD: Record<MagnitudIsovalores, string> = {
  flecha: "flecha (mm)",
  momentoX: "momento Mx (kN·m/m)",
  momentoY: "momento My (kN·m/m)",
};

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

export function LeyendaIsovalores() {
  const entradas = useEntradas();

  // Rango (min->max) de la magnitud activa. null si no hay resultados de placa (portico sin
  // losa): entonces no se pinta la leyenda (misma fuente pura que el overlay/panel).
  const rango = useMemo(() => {
    const b = construirBuffersIsovalores({
      modeloFEM: entradas.modeloFEM,
      trazabilidad: entradas.trazabilidad,
      resultados: entradas.resultados,
      combo: entradas.combo,
      magnitud: entradas.magnitud,
    });
    if (!b) return null;
    return { min: b.valorMin, max: b.valorMax };
  }, [entradas]);

  if (!rango) return null;

  // Conversion de presentacion SOLO en el borde: la flecha (m interno) -> mm; Mx/My ya estan
  // en kN·m/m (identidad).
  const esFlecha = entradas.magnitud === "flecha";
  const min = esFlecha ? mToMm(rango.min) : rango.min;
  const max = esFlecha ? mToMm(rango.max) : rango.max;

  return (
    <PanelFlotante
      className="cx-leyenda-iso"
      titulo="Isovalores"
      tag={entradas.vigente ? undefined : "obsoletos"}
      tagVariante={entradas.vigente ? "neutro" : "warning"}
    >
      <LeyendaRampa
        min={min}
        max={max}
        unidad={UNIDAD[entradas.magnitud]}
        decimales={esFlecha ? 1 : 2}
        // [D10] Vertical (max arriba), misma ubicacion/orientacion que la deformada.
        orientacion="vertical"
      />
    </PanelFlotante>
  );
}
