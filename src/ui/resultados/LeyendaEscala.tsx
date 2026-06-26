// LeyendaEscala: panel HUD (HTML) de la deformada. Muestra la rampa de color con
// los rotulos min->max del desplazamiento (en mm, conversion en el borde) y ofrece
// el control del factor de amplificacion y el toggle de animacion. Estilo glass
// coherente con el resto del HUD (PanelFlotante + tokens CSS).
//
// LENGUAJE DE OBRA (CLAUDE.md §17): habla de "deformada" y "desplazamiento", nunca
// de nodos/members. SIN conversion de unidades fuera de /src/unidades: el modelo da
// metros y mToMm los pasa a mm SOLO aqui, en el borde de presentacion (CLAUDE.md §14).
import { useMemo, useSyncExternalStore } from "react";
import { PanelFlotante } from "../primitivas";
import { resultadosStore, vistaStore } from "../../estado";
import type { ModeloFEM } from "../../discretizador";
import type { ResultadosCalculo } from "../../solver";
import { mToMm } from "../../unidades";
import { deformadaGeometria } from "./deformadaGeometria";
import "./leyendaEscala.css";

// Rampa de la leyenda como gradiente CSS sobre las mismas 5 paradas de tokens.css
// (--ramp-0..4): una sola fuente de verdad del color (no se duplica hex aqui).
const GRADIENTE_RAMPA =
  "linear-gradient(90deg, var(--ramp-0), var(--ramp-1), var(--ramp-2), var(--ramp-3), var(--ramp-4))";

// Rango del slider de amplificacion. El desplazamiento real es imperceptible (m
// sobre m), de ahi el factor: 1x..500x cubre desde "real" hasta deformadas muy
// visibles en estructuras rigidas. Paso fino al inicio.
const ESCALA_MIN = 1;
const ESCALA_MAX = 500;

// --- Lectura reactiva (fuera del bucle de render) ----------------------------

interface EntradasLeyenda {
  resultados: ResultadosCalculo | null;
  modeloFEM: ModeloFEM | null;
  vigente: boolean;
  combo: string | null;
}

let snapCache: EntradasLeyenda = leerEntradas();
function leerEntradas(): EntradasLeyenda {
  const r = resultadosStore.getState();
  return {
    resultados: r.resultados,
    modeloFEM: r.modeloFEM,
    vigente: r.vigente,
    combo: vistaStore.getState().combinacionActiva,
  };
}
function getSnapshot(): EntradasLeyenda {
  const a = leerEntradas();
  const c = snapCache;
  if (
    a.resultados === c.resultados &&
    a.modeloFEM === c.modeloFEM &&
    a.vigente === c.vigente &&
    a.combo === c.combo
  ) {
    return c;
  }
  snapCache = a;
  return a;
}
function suscribir(cb: () => void): () => void {
  const offR = resultadosStore.subscribe((s) => s.resultados, cb);
  const offM = resultadosStore.subscribe((s) => s.modeloFEM, cb);
  const offV = resultadosStore.subscribe((s) => s.vigente, cb);
  const offCombo = vistaStore.subscribe((s) => s.combinacionActiva, cb);
  return () => {
    offR();
    offM();
    offV();
    offCombo();
  };
}
function useEntradasLeyenda(): EntradasLeyenda {
  return useSyncExternalStore(suscribir, getSnapshot, getSnapshot);
}

// Factor de escala (reactivo): la leyenda lo muestra y lo controla via el slider.
function useEscala(): number {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.deformadaEscala, cb),
    () => vistaStore.getState().deformadaEscala,
    () => vistaStore.getState().deformadaEscala,
  );
}

function useAnimando(): boolean {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.animando, cb),
    () => vistaStore.getState().animando,
    () => vistaStore.getState().animando,
  );
}

// Formatea un desplazamiento (m, interno) a mm con un decimal para la leyenda.
function fmtMm(m: number): string {
  return mToMm(m).toFixed(1);
}

export function LeyendaEscala() {
  const entradas = useEntradasLeyenda();
  const escala = useEscala();
  const animando = useAnimando();

  // Rango de magnitud (min->max desplazamiento) de la combinacion activa. Se calcula
  // solo al cambiar las entradas (no por frame). El factor de escala NO afecta al
  // rango fisico (magnitud real en m), por eso no entra en las dependencias.
  const rango = useMemo(() => {
    const geo = deformadaGeometria(
      entradas.modeloFEM,
      entradas.resultados,
      entradas.combo,
      1,
    );
    return { min: geo.magMin, max: geo.magMax, hay: geo.polilineas.length > 0 };
  }, [entradas]);

  // Sin resultados para la combinacion activa: no mostramos la leyenda (el dock de
  // resultados ya guia al usuario a calcular). Evita una leyenda vacia.
  if (!rango.hay) return null;

  return (
    <PanelFlotante
      className="cx-leyenda"
      titulo="Deformada"
      tag={entradas.vigente ? undefined : "obsoleta"}
    >
      {/* Rampa de color con rotulos min/max del desplazamiento (mm). */}
      <div className="cx-leyenda__rampa-fila">
        <span className="cx-leyenda__lim mono tnum">{fmtMm(rango.min)}</span>
        <div
          className="cx-leyenda__rampa"
          style={{ background: GRADIENTE_RAMPA }}
          role="img"
          aria-label={`Desplazamiento de ${fmtMm(rango.min)} a ${fmtMm(rango.max)} milimetros`}
        />
        <span className="cx-leyenda__lim mono tnum">{fmtMm(rango.max)}</span>
      </div>
      <p className="cx-leyenda__unidad caps">desplazamiento (mm)</p>

      {/* Control del factor de amplificacion. */}
      <label className="cx-leyenda__control">
        <span className="cx-leyenda__etq">
          Amplificación <span className="mono tnum">×{Math.round(escala)}</span>
        </span>
        <input
          type="range"
          min={ESCALA_MIN}
          max={ESCALA_MAX}
          step={1}
          value={escala}
          onChange={(e) =>
            vistaStore.getState().setDeformadaEscala(Number(e.target.value))
          }
          aria-label="Factor de amplificación de la deformada"
        />
      </label>

      {/* Toggle de animacion. */}
      <label className="cx-leyenda__toggle">
        <input
          type="checkbox"
          checked={animando}
          onChange={(e) => vistaStore.getState().setAnimando(e.target.checked)}
        />
        <span>Animar deformada</span>
      </label>
    </PanelFlotante>
  );
}
