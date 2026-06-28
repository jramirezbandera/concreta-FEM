// ModoOverlay: dibuja la FORMA MODAL activa (Capa 2, ya calculada) como sceneOverlay
// del viewport, superpuesta a la obra, y la ANIMA. Espejo de DeformadaOverlay pero para
// el camino MODAL (F2b): lee del modalStore (NO del resultadosStore: la forma modal y la
// deformada son datos distintos), del modo activo y de los controles modales del vistaStore.
//
// RENDIMIENTO (reglas #11, igual que DeformadaOverlay):
//  - modos/modeloFEM NO entran como prop reactiva por frame: se leen con
//    getState()/subscribe (subscribeWithSelector) y la geometria se RECONSTRUYE solo al
//    cambiar modos, modeloFEM, modo activo o escala. Nunca por frame (useSyncExternalStore
//    -> useMemo).
//  - La ANIMACION no usa setState: muta el array de posiciones del BufferGeometry en
//    useFrame e invalida (frameloop="demand"). Cero render de React por frame.
//  - Un solo lineSegments con color por vertice.
//
// SIN jerga FEM en lo visible: no rotula nodos ni members; solo dibuja la forma de vibracion.
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { invalidate, useFrame } from "@react-three/fiber";
import { BufferGeometry, Float32BufferAttribute, type LineSegments } from "three";
import { modalStore, vistaStore } from "../../estado";
import type { ModoVista } from "../../estado";
import type { ModeloFEM } from "../../discretizador";
import type { ResultadosModales } from "../../solver";
import { construirBuffersModal } from "./modalBuffers";

// Velocidad de la oscilacion de la animacion (rad/s). El factor oscila como
// (1 - cos)/2 in [0,1] para arrancar y volver en reposo sin tirones. Igual que la
// deformada para que ambas animaciones tengan el mismo "ritmo".
const VELOCIDAD_ANIM = 2.2;

// Entradas que disparan la reconstruccion de la geometria (no por frame).
interface Entradas {
  modos: ResultadosModales | null;
  modeloFEM: ModeloFEM | null;
  modoActivo: number;
  escala: number;
  animando: boolean;
  // Modo de vista del viewport. La forma modal es conceptualmente 3D (igual que la
  // deformada): en planta/mosaico la forma del edificio entero se descuadraria sobre la
  // geometria filtrada por planta, asi que SOLO se dibuja en modo "3d".
  modoVista: ModoVista;
}

let snapCache: Entradas = leerEntradas();
function leerEntradas(): Entradas {
  const m = modalStore.getState();
  const v = vistaStore.getState();
  return {
    modos: m.modos,
    modeloFEM: m.modeloFEM,
    modoActivo: m.modoActivo,
    escala: v.modalEscala,
    animando: v.modalAnimando,
    modoVista: v.modoVista,
  };
}
function getSnapshot(): Entradas {
  const a = leerEntradas();
  const c = snapCache;
  if (
    a.modos === c.modos &&
    a.modeloFEM === c.modeloFEM &&
    a.modoActivo === c.modoActivo &&
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
  const offModos = modalStore.subscribe((s) => s.modos, cb);
  const offFem = modalStore.subscribe((s) => s.modeloFEM, cb);
  const offActivo = modalStore.subscribe((s) => s.modoActivo, cb);
  const offEsc = vistaStore.subscribe((s) => s.modalEscala, cb);
  const offAnim = vistaStore.subscribe((s) => s.modalAnimando, cb);
  const offModoVista = vistaStore.subscribe((s) => s.modoVista, cb);
  return () => {
    offModos();
    offFem();
    offActivo();
    offEsc();
    offAnim();
    offModoVista();
  };
}

function useEntradas(): Entradas {
  return useSyncExternalStore(suscribir, getSnapshot, getSnapshot);
}

export function ModoOverlay() {
  const entradas = useEntradas();
  const lineRef = useRef<LineSegments>(null);

  // Buffers reconstruidos SOLO al cambiar las entradas (no por frame). La derivacion
  // pura (base/delta/color) vive en modalBuffers.ts (testeable sin R3F).
  const buffers = useMemo(
    () =>
      construirBuffersModal({
        modeloFEM: entradas.modeloFEM,
        modos: entradas.modos,
        numeroModo: entradas.modoActivo,
      }),
    [entradas],
  );

  // BufferGeometry con position (mutable para la animacion) y color por vertice.
  const geom = useMemo(() => {
    if (!buffers) return null;
    const g = new BufferGeometry();
    // Posiciones iniciales = base + delta*escala (forma al factor actual, sin animar).
    const pos = new Float32Array(buffers.base.length);
    for (let i = 0; i < pos.length; i++) {
      pos[i] = buffers.base[i]! + buffers.delta[i]! * entradas.escala;
    }
    g.setAttribute("position", new Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new Float32BufferAttribute(buffers.color, 3));
    return g;
  }, [buffers, entradas.escala]);

  // Pinta un frame al reconstruir/cambiar el factor (frameloop="demand").
  useEffect(() => {
    if (geom) invalidate();
    return () => geom?.dispose();
  }, [geom]);

  // Animacion: muta las posiciones del BufferGeometry en cada frame (factor oscila
  // 0->escala->0) e invalida. Cero setState por frame (regla #11). Cuando no se anima,
  // useFrame no toca nada; la recolocacion al reposo la hace el useEffect de abajo.
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

  // Al ARRANCAR la animacion, reinicia la fase (evita saltar a mitad de onda). Al
  // PARARLA, RECOLOCA las posiciones a la amplitud estatica base + delta*escala: si no,
  // useFrame las dejo congeladas en el ultimo factor de oscilacion (una amplitud
  // intermedia arbitraria), de modo que el modo quedaba dibujado a una amplitud que no
  // se corresponde con la "×escala" indicada en el panel.
  useEffect(() => {
    if (!geom || !buffers) return;
    if (entradas.animando) {
      tRef.current = 0;
    } else {
      const attr = geom.getAttribute("position") as Float32BufferAttribute;
      const arr = attr.array as Float32Array;
      const { base, delta } = buffers;
      for (let i = 0; i < arr.length; i++) {
        arr[i] = base[i]! + delta[i]! * entradas.escala;
      }
      attr.needsUpdate = true;
    }
    invalidate();
  }, [entradas.animando, entradas.escala, geom, buffers]);

  // La forma modal solo se dibuja en modo 3D: en planta/mosaico la geometria base esta
  // filtrada por planta y la forma del edificio entero se descuadraria.
  if (!geom || entradas.modoVista !== "3d") return null;
  return (
    <lineSegments ref={lineRef} geometry={geom}>
      {/* vertexColors: el color va en el atributo `color` (rampa por magnitud). */}
      <lineBasicMaterial vertexColors toneMapped={false} />
    </lineSegments>
  );
}
