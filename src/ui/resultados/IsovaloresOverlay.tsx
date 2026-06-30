// IsovaloresOverlay: dibuja el mapa de ISOVALORES de la losa (Capa 2, ya calculada) como
// sceneOverlay del viewport, sobre la huella del paño. Una mesh de triangulos con color
// por vertice (rampa) segun la magnitud elegida (Flecha / Mx / My). Espejo de
// DeformadaOverlay pero SIN animacion: los isovalores son un mapa estatico de color (no
// se amplifica ni oscila).
//
// RENDIMIENTO (reglas #11, igual que DeformadaOverlay):
//  - Los resultados/modeloFEM/trazabilidad NO entran como prop reactiva por frame: se leen
//    con getState()/subscribe (subscribeWithSelector) y la geometria se RECONSTRUYE solo
//    cuando cambian resultados, modeloFEM, trazabilidad, combinacion o magnitud. Nunca por
//    frame (useSyncExternalStore -> useMemo).
//  - Una sola mesh con color por vertice; cero setState por frame.
//
// SIN jerga FEM en lo visible: este overlay no rotula nudos ni quads; solo dibuja.
//
// El overlay SOLO se muestra si hay resultados de placa (quads) para la combinacion
// activa: construirBuffersIsovalores devuelve null sin malla/resultados, y entonces no se
// renderiza nada (un portico sin losa no pinta isovalores).
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { invalidate } from "@react-three/fiber";
import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute } from "three";
import { resultadosStore, vistaStore } from "../../estado";
import type { ModeloFEM, Trazabilidad } from "../../discretizador";
import type { ResultadosCalculo } from "../../solver";
import type { MagnitudIsovalores, ModoVista } from "../../estado";
import { construirBuffersIsovalores } from "./isovaloresBuffers";

interface Entradas {
  modeloFEM: ModeloFEM | null;
  trazabilidad: Trazabilidad | null;
  resultados: ResultadosCalculo | null;
  combo: string | null;
  magnitud: MagnitudIsovalores;
  // La losa se introduce en planta, pero la malla coloreada se aprecia mejor en planta
  // cenital (la pestana Isovalores arranca en planta). Se dibuja en planta y en 3D (el
  // color por vertice no depende del modo); en mosaico se cae a 3D (Viewport). No se
  // filtra por planta porque la malla esta a su cota y se ve bien desde arriba.
  modoVista: ModoVista;
}

let snapCache: Entradas = leerEntradas();
function leerEntradas(): Entradas {
  const r = resultadosStore.getState();
  const v = vistaStore.getState();
  return {
    modeloFEM: r.modeloFEM,
    trazabilidad: r.trazabilidad,
    resultados: r.resultados,
    combo: v.combinacionActiva,
    magnitud: v.magnitudIsovalores,
    modoVista: v.modoVista,
  };
}
function getSnapshot(): Entradas {
  const a = leerEntradas();
  const c = snapCache;
  if (
    a.modeloFEM === c.modeloFEM &&
    a.trazabilidad === c.trazabilidad &&
    a.resultados === c.resultados &&
    a.combo === c.combo &&
    a.magnitud === c.magnitud &&
    a.modoVista === c.modoVista
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
  const offCombo = vistaStore.subscribe((s) => s.combinacionActiva, cb);
  const offMag = vistaStore.subscribe((s) => s.magnitudIsovalores, cb);
  const offModo = vistaStore.subscribe((s) => s.modoVista, cb);
  return () => {
    offM();
    offT();
    offR();
    offCombo();
    offMag();
    offModo();
  };
}
function useEntradas(): Entradas {
  return useSyncExternalStore(suscribir, getSnapshot, getSnapshot);
}

export function IsovaloresOverlay() {
  const entradas = useEntradas();

  // Buffers reconstruidos SOLO al cambiar las entradas (no por frame). La derivacion pura
  // vive en isovaloresBuffers.ts (testeable sin R3F).
  const buffers = useMemo(
    () =>
      construirBuffersIsovalores({
        modeloFEM: entradas.modeloFEM,
        trazabilidad: entradas.trazabilidad,
        resultados: entradas.resultados,
        combo: entradas.combo,
        magnitud: entradas.magnitud,
      }),
    [entradas],
  );

  const geom = useMemo(() => {
    if (!buffers) return null;
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(buffers.posiciones, 3));
    g.setAttribute("color", new Float32BufferAttribute(buffers.color, 3));
    g.setIndex(new Uint32BufferAttribute(buffers.indices, 1));
    g.computeVertexNormals();
    return g;
  }, [buffers]);

  useEffect(() => {
    if (geom) invalidate();
    return () => geom?.dispose();
  }, [geom]);

  if (!geom) return null;
  return (
    <mesh geometry={geom}>
      {/* vertexColors: el color va en el atributo `color` (rampa). doubleSide: la malla
          se ve igual desde arriba o desde abajo (planta cenital o 3D). */}
      <meshBasicMaterial vertexColors toneMapped={false} side={2} />
    </mesh>
  );
}
