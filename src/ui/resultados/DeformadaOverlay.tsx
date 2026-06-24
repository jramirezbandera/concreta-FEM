// DeformadaOverlay: dibuja la deformada (Capa 2, ya calculada) como sceneOverlay
// del viewport, superpuesta a la obra. Colorea por magnitud de desplazamiento con
// la rampa de isovalores y anima el factor de amplificacion.
//
// RENDIMIENTO (reglas #11, igual que GeometriaModelo):
//  - Los resultados/modeloFEM NO entran como prop reactiva por frame: se leen con
//    getState()/subscribe (subscribeWithSelector) y la geometria se RECONSTRUYE solo
//    cuando cambian resultados, modeloFEM, vigente, combinacion o escala. Nunca por
//    frame (useSyncExternalStore -> useMemo).
//  - La ANIMACION no usa setState: muta el array de posiciones del BufferGeometry en
//    useFrame e invalida (frameloop="demand"). Cero render de React por frame.
//  - Un solo lineSegments con color por vertice (la linea base de la obra ya da el
//    contexto; aqui el feedback es el color por magnitud).
//
// SIN jerga FEM en lo visible: este overlay no rotula nodos ni members; solo dibuja.
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { invalidate, useFrame } from "@react-three/fiber";
import { BufferGeometry, Float32BufferAttribute, type LineSegments } from "three";
import { resultadosStore, vistaStore } from "../../estado";
import type { ModoVista } from "../../estado";
import type { ModeloFEM } from "../../discretizador";
import type { ResultadosCalculo } from "../../solver";
import { construirBuffers } from "./deformadaBuffers";

// Velocidad de la oscilacion de la animacion (rad/s). El factor de amplificacion
// oscila como (1 - cos)/2 in [0,1] para arrancar y volver en reposo sin tirones.
const VELOCIDAD_ANIM = 2.2;

// Entradas que disparan la reconstruccion de la geometria (no por frame).
interface Entradas {
  resultados: ResultadosCalculo | null;
  modeloFEM: ModeloFEM | null;
  vigente: boolean;
  combo: string | null;
  escala: number;
  animando: boolean;
  // Modo de vista del viewport. La deformada es conceptualmente 3D (spec §6,
  // "Deformada 3D"): en planta/mosaico la deformada del edificio entero se
  // superpondria descuadrada a la geometria filtrada por planta, asi que SOLO se
  // dibuja en modo "3d". (eng-review D1.)
  modoVista: ModoVista;
}

// Snapshot estable de las entradas: tupla cacheada para useSyncExternalStore.
let snapCache: Entradas = leerEntradas();
function leerEntradas(): Entradas {
  const r = resultadosStore.getState();
  const v = vistaStore.getState();
  return {
    resultados: r.resultados,
    modeloFEM: r.modeloFEM,
    vigente: r.vigente,
    combo: v.combinacionActiva,
    escala: v.deformadaEscala,
    animando: v.animando,
    modoVista: v.modoVista,
  };
}
function getSnapshot(): Entradas {
  const a = leerEntradas();
  const c = snapCache;
  if (
    a.resultados === c.resultados &&
    a.modeloFEM === c.modeloFEM &&
    a.vigente === c.vigente &&
    a.combo === c.combo &&
    a.escala === c.escala &&
    a.animando === c.animando &&
    a.modoVista === c.modoVista
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
  const offEsc = vistaStore.subscribe((s) => s.deformadaEscala, cb);
  const offAnim = vistaStore.subscribe((s) => s.animando, cb);
  const offModo = vistaStore.subscribe((s) => s.modoVista, cb);
  return () => {
    offR();
    offM();
    offV();
    offCombo();
    offEsc();
    offAnim();
    offModo();
  };
}

function useEntradas(): Entradas {
  return useSyncExternalStore(suscribir, getSnapshot, getSnapshot);
}

export function DeformadaOverlay() {
  const entradas = useEntradas();
  const lineRef = useRef<LineSegments>(null);

  // Buffers reconstruidos SOLO al cambiar las entradas (no por frame). La derivacion
  // pura (base/delta/color) vive en deformadaBuffers.ts (testeable sin R3F).
  const buffers = useMemo(
    () =>
      construirBuffers({
        modeloFEM: entradas.modeloFEM,
        resultados: entradas.resultados,
        combo: entradas.combo,
        vigente: entradas.vigente,
      }),
    [entradas],
  );

  // BufferGeometry con position (mutable para la animacion) y color por vertice.
  const geom = useMemo(() => {
    if (!buffers) return null;
    const g = new BufferGeometry();
    // Posiciones iniciales = base + delta*escala (estado en reposo al factor actual).
    const pos = new Float32Array(buffers.base.length);
    for (let i = 0; i < pos.length; i++) {
      pos[i] = buffers.base[i]! + buffers.delta[i]! * entradas.escala;
    }
    g.setAttribute("position", new Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new Float32BufferAttribute(buffers.color, 3));
    return g;
    // `entradas.escala` se incluye: al cambiar el factor (sin animar) reposicionamos.
  }, [buffers, entradas.escala]);

  // Pinta un frame al reconstruir/cambiar el factor (frameloop="demand").
  useEffect(() => {
    if (geom) invalidate();
    return () => geom?.dispose();
  }, [geom]);

  // Animacion: muta las posiciones del BufferGeometry en cada frame (factor oscila
  // 0->escala->0) e invalida. Cero setState por frame (regla #11). Cuando no se
  // anima, useFrame no toca nada (las posiciones quedan al factor `escala` del memo).
  const tRef = useRef(0);
  useFrame((_state, dt) => {
    if (!entradas.animando || !buffers || !geom) return;
    tRef.current += dt * VELOCIDAD_ANIM;
    // Factor in [0, escala] con arranque/retorno suave: (1 - cos)/2.
    const factor = ((1 - Math.cos(tRef.current)) / 2) * entradas.escala;
    const attr = geom.getAttribute("position") as Float32BufferAttribute;
    const arr = attr.array as Float32Array;
    const { base, delta } = buffers;
    for (let i = 0; i < arr.length; i++) {
      arr[i] = base[i]! + delta[i]! * factor;
    }
    attr.needsUpdate = true;
    invalidate(); // mantiene vivo el bucle bajo demanda mientras se anima
  });

  // Reinicia la fase de la animacion al arrancarla (evita saltar a mitad de onda).
  useEffect(() => {
    if (entradas.animando) tRef.current = 0;
    invalidate();
  }, [entradas.animando]);

  // La deformada solo se dibuja en modo 3D (D1): en planta/mosaico la geometria base
  // esta filtrada por planta y la deformada del edificio entero se descuadraria.
  if (!geom || entradas.modoVista !== "3d") return null;
  return (
    <lineSegments ref={lineRef} geometry={geom}>
      {/* vertexColors: el color va en el atributo `color` (rampa o gris). */}
      <lineBasicMaterial vertexColors toneMapped={false} />
    </lineSegments>
  );
}
