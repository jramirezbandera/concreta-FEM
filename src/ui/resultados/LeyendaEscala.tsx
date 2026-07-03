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
import type { ModoVista, OverlayResultados } from "../../estado";
import type { ModeloFEM } from "../../discretizador";
import type { ResultadosCalculo } from "../../solver";
import { mToMm } from "../../unidades";
import { deformadaGeometria } from "./deformadaGeometria";
import { LeyendaRampa } from "./LeyendaRampa";
import "./leyendaEscala.css";

// Rango del factor de amplificacion. El desplazamiento real es imperceptible (m sobre m),
// de ahi el factor: 1x..500x cubre desde "real" hasta deformadas muy visibles en
// estructuras rigidas.
const ESCALA_MIN = 1;
const ESCALA_MAX = 500;

// [AUDITORIA D6] Slider LOGARITMICO. Con un slider LINEAL [1..500] el rango util (×1..×20,
// donde vive casi toda la lectura) ocupaba el ~2% del recorrido: inservible. Se mapea la
// posicion lineal del <input> ([0..PASOS_SLIDER]) a la escala por una ley log, de modo que
// cada tramo del slider multiplica por un factor constante (mas resolucion en los factores
// bajos). El estado (deformadaEscala) sigue siendo el factor ×N real; solo el input usa la
// posicion. La etiqueta sigue siendo "Amplificación ×N".
const PASOS_SLIDER = 1000; // resolucion del recorrido (entero: 0..1000)
const LN_MIN = Math.log(ESCALA_MIN);
const LN_MAX = Math.log(ESCALA_MAX);

// Posicion del slider (0..PASOS_SLIDER) -> factor de escala (log). Acota a [MIN,MAX].
function posicionAEscala(pos: number): number {
  const t = Math.min(1, Math.max(0, pos / PASOS_SLIDER));
  return Math.exp(LN_MIN + t * (LN_MAX - LN_MIN));
}

// Factor de escala -> posicion del slider (0..PASOS_SLIDER), inverso de posicionAEscala.
// Para reflejar en el slider una escala fijada por otro camino (p. ej. la inicial de D6).
function escalaAPosicion(escala: number): number {
  const e = Math.min(ESCALA_MAX, Math.max(ESCALA_MIN, escala));
  const t = (Math.log(e) - LN_MIN) / (LN_MAX - LN_MIN);
  return Math.round(t * PASOS_SLIDER);
}

// --- Lectura reactiva (fuera del bucle de render) ----------------------------

interface EntradasLeyenda {
  resultados: ResultadosCalculo | null;
  modeloFEM: ModeloFEM | null;
  vigente: boolean;
  combo: string | null;
  modoVista: ModoVista;
  overlay: OverlayResultados;
}

let snapCache: EntradasLeyenda = leerEntradas();
function leerEntradas(): EntradasLeyenda {
  const r = resultadosStore.getState();
  const v = vistaStore.getState();
  return {
    resultados: r.resultados,
    modeloFEM: r.modeloFEM,
    vigente: r.vigente,
    combo: v.combinacionActiva,
    modoVista: v.modoVista,
    overlay: v.overlayResultados,
  };
}
function getSnapshot(): EntradasLeyenda {
  const a = leerEntradas();
  const c = snapCache;
  if (
    a.resultados === c.resultados &&
    a.modeloFEM === c.modeloFEM &&
    a.vigente === c.vigente &&
    a.combo === c.combo &&
    a.modoVista === c.modoVista &&
    a.overlay === c.overlay
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
  const offModo = vistaStore.subscribe((s) => s.modoVista, cb);
  const offOverlay = vistaStore.subscribe((s) => s.overlayResultados, cb);
  return () => {
    offR();
    offM();
    offV();
    offCombo();
    offModo();
    offOverlay();
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

  // [AUDITORIA D9] La LeyendaEscala es la leyenda de la DEFORMADA: solo se muestra cuando la
  // deformada es el overlay activo. Con la forma modal activa, la escena no dibuja la
  // deformada, asi que su leyenda no tiene nada que rotular (la vuelta se hace desde
  // PanelFrecuencias con "Ver deformada"). Exclusion mutua: nunca las dos leyendas/overlays.
  if (entradas.overlay !== "deformada") return null;

  // La deformada solo se dibuja en pleno (3D/mosaico); en planta el overlay no aparece
  // (DeformadaOverlay), asi que el slider y "Animar" no harian nada. Lo comunicamos y los
  // dejamos atenuados/inertes en vez de ofrecer controles muertos (UX-H1).
  const soloEnPlanta = entradas.modoVista === "planta";

  return (
    <PanelFlotante
      className="cx-leyenda"
      titulo="Deformada"
      tag={entradas.vigente ? undefined : "obsoleta"}
      tagVariante={entradas.vigente ? "neutro" : "warning"}
    >
      {/* Rampa de color con rotulos min/max del desplazamiento (mm). La rampa generica
          (color + min/max + unidad) la pinta LeyendaRampa; aqui se le pasan los limites
          YA en mm (conversion en el borde, fmtMm via mToMm). */}
      <LeyendaRampa
        min={mToMm(rango.min)}
        max={mToMm(rango.max)}
        unidad="desplazamiento (mm)"
        // [D10] Rampa VERTICAL (anclada a la derecha del lienzo, Slot mid-right): max arriba,
        // min abajo (Spec §4.2), misma ubicacion que la rampa de isovalores.
        orientacion="vertical"
        ariaLabel={`Desplazamiento de ${fmtMm(rango.min)} a ${fmtMm(rango.max)} milimetros`}
      />

      {/* Guia cuando estamos en planta: la deformada se ve en 3D; el slider y "Animar"
          quedan atenuados/inertes (UX-H1). */}
      {soloEnPlanta && (
        <p className="cx-leyenda__guia" role="note">
          La deformada se muestra en la vista 3D.
        </p>
      )}

      {/* Control del factor de amplificacion. Deshabilitado en planta (no hay deformada
          que amplificar en esa vista). */}
      <label
        className={
          soloEnPlanta ? "cx-leyenda__control cx-leyenda__control--off" : "cx-leyenda__control"
        }
      >
        <span className="cx-leyenda__etq">
          Amplificación <span className="mono tnum">×{Math.round(escala)}</span>
        </span>
        <input
          type="range"
          // Recorrido LINEAL del input [0..PASOS_SLIDER]; el valor se mapea a la escala por
          // ley LOG (D6). `value` refleja la escala actual convertida a posicion.
          min={0}
          max={PASOS_SLIDER}
          step={1}
          value={escalaAPosicion(escala)}
          disabled={soloEnPlanta}
          onChange={(e) =>
            vistaStore
              .getState()
              .setDeformadaEscala(Math.round(posicionAEscala(Number(e.target.value))))
          }
          aria-label="Factor de amplificación de la deformada"
        />
      </label>

      {/* Toggle de animacion. Deshabilitado en planta (no anima nada alli). */}
      <label
        className={
          soloEnPlanta ? "cx-leyenda__toggle cx-leyenda__toggle--off" : "cx-leyenda__toggle"
        }
      >
        <input
          type="checkbox"
          checked={animando}
          disabled={soloEnPlanta}
          onChange={(e) => vistaStore.getState().setAnimando(e.target.checked)}
        />
        <span>Animar deformada</span>
      </label>
    </PanelFlotante>
  );
}
