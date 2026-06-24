// OverlayPlantillas: dibuja las plantillas DXF (calco/fondo) de la planta activa
// dentro de la escena R3F (feature-15, T2.2). Es AYUDA DE DIBUJO, no Capa 1: solo
// LEE vistaStore; no escribe estado ni participa en el modelo/discretizador.
//
// RENDIMIENTO (reglas #11, igual que VigasLineas):
//  - Geometria reconstruida SOLO al cambiar `plantillas`/`plantaActivaId`
//    (useSyncExternalStore con selector ligero), nunca por frame.
//  - Una BufferGeometry de lineas + una de puntos COMPARTIDA POR PLANTILLA (no por
//    entidad): asi cada plantilla respeta su `opacidad` individual con un material
//    propio, sin pagar un objeto three por entidad.
//  - invalidate() al (re)construir, porque frameloop="demand".
//
// NO INTERACTIVO: raycast desactivado en todas las mallas para no capturar el raton
// ni estorbar al picking de pilares/vigas. renderOrder bajo y z de fondo para que
// el modelo (Capa 1) quede siempre por encima.
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { invalidate } from "@react-three/fiber";
import { BufferGeometry, Float32BufferAttribute } from "three";
import { vistaStore } from "../../estado";
import { hexToken } from "./colores";
import { transformarEntidad } from "./dxf/transformar";
import { verticesArco } from "./dxf/teselar";
import type { EntidadDxf, Plantilla } from "./dxf/tiposDxf";

// z de fondo: ligeramente por debajo del suelo (Z=0) para que rejilla y modelo
// queden por encima. renderOrder negativo refuerza el orden de pintado.
const Z_FONDO = -0.01;
const RENDER_ORDER = -10;

// Segmentos para teselar un circulo completo (2π). El arco usa una fraccion
// proporcional a su barrido. Barato y suficiente para un calco de fondo.
const SEGMENTOS_CIRCULO = 48;
// Tamano del marcador de los POINT (en px de pantalla, pointsMaterial sizeAttenuation
// off por simplicidad: punto pequeno y constante).
const TAM_PUNTO = 4;

// raycast no-op compartido: las plantillas nunca capturan el raton.
const sinRaycast = () => null;

// --- Suscripcion ligera al store (sin re-render por frame) -------------------
// Devolvemos referencias CRUDAS (el array `plantillas` y el id) como snapshot: son
// estables entre sets, asi useSyncExternalStore no entra en bucle. El filtrado y la
// construccion de geometria ocurren en useMemo aguas abajo.
function usePlantillas(): Plantilla[] {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.plantillas, cb),
    () => vistaStore.getState().plantillas,
    () => vistaStore.getState().plantillas,
  );
}

function usePlantaActivaId(): string | null {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.plantaActivaId, cb),
    () => vistaStore.getState().plantaActivaId,
    () => vistaStore.getState().plantaActivaId,
  );
}

// --- Teselado de circulo/arco ------------------------------------------------
// Aproxima el arco a segmentos y los acumula en `out` (lineSegments 3D). Delega la
// matematica en `verticesArco` (modulo puro testeado): este normaliza el barrido a
// CCW [0,2π) segun la convencion DXF (350->10 grados = +20, no -340), corrigiendo el
// bug del arco que cruza 0. verticesArco devuelve pares (x,y) sin Z; aqui insertamos
// Z_FONDO en cada vertice.
function teselarArco(
  cx: number,
  cy: number,
  r: number,
  anguloInicio: number,
  anguloFin: number,
  out: number[],
): void {
  const planos = verticesArco(
    cx,
    cy,
    r,
    anguloInicio,
    anguloFin,
    SEGMENTOS_CIRCULO,
  );
  for (let i = 0; i < planos.length; i += 2) {
    out.push(planos[i]!, planos[i + 1]!, Z_FONDO);
  }
}

// --- Construccion de geometrias por plantilla --------------------------------
interface GeomPlantilla {
  id: string;
  opacidad: number;
  // BufferGeometry de lineas (lineSegments) o null si la plantilla no tiene lineas.
  lineas: BufferGeometry | null;
  // BufferGeometry de puntos (points) o null si no hay entidades POINT.
  puntos: BufferGeometry | null;
}

// Construye las geometrias (lineas + puntos) de UNA plantilla aplicando su
// transform a cada entidad. Acumula en arrays planos y crea como mucho dos
// BufferGeometry compartidas.
function construirGeomPlantilla(plantilla: Plantilla): GeomPlantilla {
  const vertLineas: number[] = [];
  const vertPuntos: number[] = [];

  for (const e0 of plantilla.entidades) {
    const e: EntidadDxf = transformarEntidad(e0, plantilla);
    switch (e.tipo) {
      case "linea":
        vertLineas.push(e.x1, e.y1, Z_FONDO, e.x2, e.y2, Z_FONDO);
        break;
      case "polilinea": {
        const pts = e.puntos;
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i]!;
          const b = pts[i + 1]!;
          vertLineas.push(a.x, a.y, Z_FONDO, b.x, b.y, Z_FONDO);
        }
        // Cierre del ultimo->primero si la polilinea es cerrada.
        if (e.cerrada && pts.length > 1) {
          const a = pts[pts.length - 1]!;
          const b = pts[0]!;
          vertLineas.push(a.x, a.y, Z_FONDO, b.x, b.y, Z_FONDO);
        }
        break;
      }
      case "punto":
        vertPuntos.push(e.x, e.y, Z_FONDO);
        break;
      case "circulo":
        // Circulo completo = arco 0..2π.
        teselarArco(e.cx, e.cy, e.r, 0, Math.PI * 2, vertLineas);
        break;
      case "arco":
        teselarArco(e.cx, e.cy, e.r, e.anguloInicio, e.anguloFin, vertLineas);
        break;
    }
  }

  let lineas: BufferGeometry | null = null;
  if (vertLineas.length > 0) {
    lineas = new BufferGeometry();
    lineas.setAttribute("position", new Float32BufferAttribute(vertLineas, 3));
  }
  let puntos: BufferGeometry | null = null;
  if (vertPuntos.length > 0) {
    puntos = new BufferGeometry();
    puntos.setAttribute("position", new Float32BufferAttribute(vertPuntos, 3));
  }

  return { id: plantilla.id, opacidad: plantilla.transform.opacidad, lineas, puntos };
}

// --- Componente --------------------------------------------------------------
export function OverlayPlantillas() {
  const plantillas = usePlantillas();
  const plantaActivaId = usePlantaActivaId();
  const color = useMemo(() => hexToken("canvasGrid2"), []);

  // Geometrias reconstruidas SOLO al cambiar las plantillas o la planta activa
  // (regla #11: nunca por frame). Filtra por visible + planta activa (NO por
  // plantillaActivaId, que solo marca cual se edita en el panel).
  const geoms = useMemo<GeomPlantilla[]>(() => {
    if (!plantaActivaId) return [];
    return plantillas
      .filter((p) => p.visible && p.plantaId === plantaActivaId)
      .map(construirGeomPlantilla);
  }, [plantillas, plantaActivaId]);

  // Pinta un frame al (re)construir y libera las BufferGeometry al sustituirlas
  // o desmontar (evita fugas de memoria en GPU).
  useEffect(() => {
    invalidate();
    return () => {
      for (const g of geoms) {
        g.lineas?.dispose();
        g.puntos?.dispose();
      }
    };
  }, [geoms]);

  if (geoms.length === 0) return null;

  return (
    <group>
      {geoms.map((g) => (
        <group key={g.id}>
          {g.lineas && (
            <lineSegments geometry={g.lineas} renderOrder={RENDER_ORDER} raycast={sinRaycast}>
              <lineBasicMaterial
                color={color}
                transparent
                opacity={g.opacidad}
                depthWrite={false}
                toneMapped={false}
              />
            </lineSegments>
          )}
          {g.puntos && (
            <points geometry={g.puntos} renderOrder={RENDER_ORDER} raycast={sinRaycast}>
              <pointsMaterial
                color={color}
                size={TAM_PUNTO}
                sizeAttenuation={false}
                transparent
                opacity={g.opacidad}
                depthWrite={false}
                toneMapped={false}
              />
            </points>
          )}
        </group>
      ))}
    </group>
  );
}
