// CargasDibujadas: dibuja las CARGAS de la obra en la vista PLANTA (D7b, token --load).
// Las cargas eran invisibles (una viga cargada se veia igual que una descargada). Aqui:
//   - carga LINEAL sobre una viga -> hilera de flechitas a lo largo del tramo + etiqueta
//     "10 kN/m" en el centro (--load, mono).
//   - carga LINEAL sobre un pilar -> una flecha en su huella (el pilar es un punto en
//     planta; una hilera no aplica) + etiqueta.
//   - carga SUPERFICIAL de un paño -> hatch a 45° sutil sobre la huella + etiqueta central
//     "5 kN/m²".
//
// AGREGACION (Σ, decision D7b): si varias cargas caen sobre el MISMO elemento se SUMAN sus
// valores en una sola hilera/hatch y la etiqueta lleva "Σ" (lo simple: una representacion
// por elemento). Se suma SIN filtrar por hipotesis: el lienzo muestra "cuanta carga hay
// aqui" de un vistazo; el desglose por hipotesis vive en el inspector.
//
// RENDIMIENTO (regla #11): geometria de flechas/hatch DERIVADA junto al modelo (useMemo
// sobre geometria + cargas), NUNCA por frame. Solo en planta (autooculta en 3D). Nada es
// raycasteable (raycast={null}): no estorba al picking ni a la colocacion.
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { invalidate } from "@react-three/fiber";
import {
  BufferGeometry,
  Float32BufferAttribute,
  type LineSegments as LineSegmentsT,
} from "three";
import { Text } from "@react-three/drei";
import { modeloStore, vistaStore } from "../../estado";
import type { Carga } from "../../dominio";
import { hexToken } from "./colores";
import { useGeometriaModelo, type GeometriaModelo } from "./hooks/useGeometriaModelo";
import {
  flechasCargaLineal,
  hatchCargaSuperficial,
  type FlechasCarga,
} from "./cargasDibujo";
import { etiquetaCargaLineal, etiquetaCargaSuperficial } from "./formateo";

// Tamaño del texto de la etiqueta de carga (m de mundo), un pelin menor que el rotulo de
// elemento (0.24) para jerarquizar: el nombre manda, la carga es dato secundario.
const TAM_TEXTO_M = 0.2;
// Elevacion de las flechas/hatch/etiqueta sobre la cota (m): sobre el forjado, bajo el
// rotulo de elemento, para leerse en cenital sin z-fight.
const CARGA_Z_EPS = 0.03;

interface EtiquetaCarga {
  id: string;
  texto: string;
  x: number;
  y: number;
  z: number;
}

// Suma de valores de carga por ambito (id de elemento), filtrando por tipo. Devuelve
// {suma, varias} para decidir el prefijo "Σ".
function sumarPorAmbito(
  cargas: readonly Carga[],
  tipo: Carga["tipo"],
): Map<string, { suma: number; varias: boolean }> {
  const acc = new Map<string, { suma: number; varias: boolean }>();
  for (const c of cargas) {
    if (c.tipo !== tipo) continue;
    const prev = acc.get(c.ambito);
    if (prev) {
      prev.suma += c.valor;
      prev.varias = true;
    } else {
      acc.set(c.ambito, { suma: c.valor, varias: false });
    }
  }
  return acc;
}

// True solo en vista planta (las cargas se dibujan solo ahi, como la introduccion grafica).
function useEnPlanta(): boolean {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.modoVista, cb),
    () => vistaStore.getState().modoVista === "planta",
    () => vistaStore.getState().modoVista === "planta",
  );
}

// Deriva flechas + hatch + etiquetas de las cargas visibles. PURO respecto a stores:
// recibe geometria (ya filtrada por grupo/planta) y el array de cargas del modelo. Las
// cargas se cruzan con la geometria por id de ambito; una carga cuyo elemento no esta
// visible en esta planta no produce nada.
function derivarCargas(
  geo: GeometriaModelo,
  cargas: readonly Carga[],
): { vertices: number[]; etiquetas: EtiquetaCarga[] } {
  const lineales = sumarPorAmbito(cargas, "lineal");
  const superficiales = sumarPorAmbito(cargas, "superficial");
  const vertices: number[] = [];
  const etiquetas: EtiquetaCarga[] = [];

  // Cargas lineales sobre VIGAS: hilera de flechas a lo largo del tramo.
  for (const v of geo.vigas) {
    const carga = lineales.get(v.id);
    if (!carga) continue;
    const z = v.z + CARGA_Z_EPS;
    const f: FlechasCarga = flechasCargaLineal(v.ax, v.ay, v.bx, v.by, z);
    vertices.push(...f.vertices);
    etiquetas.push({
      id: `cl-${v.id}`,
      texto: etiquetaCargaLineal(carga.suma, carga.varias),
      x: f.etiqueta.x,
      y: f.etiqueta.y,
      z: f.etiqueta.z,
    });
  }

  // Cargas lineales sobre PILARES: una flecha en la huella (el pilar es un punto en planta).
  // Se dibuja un tramo minimo centrado en (cx,cy) para reutilizar flechasCargaLineal con una
  // sola flecha; el glifo indica "carga sobre este pilar".
  for (const p of geo.pilares) {
    const carga = lineales.get(p.id);
    if (!carga) continue;
    const z = p.cz + p.alto / 2 + CARGA_Z_EPS;
    // Segmento minimo horizontal para una unica flecha (numeroFlechas acota a >=2, asi que
    // el tramo corto da 2 flechas muy juntas: legible como marca sobre el pilar).
    const f = flechasCargaLineal(p.cx - 0.2, p.cy, p.cx + 0.2, p.cy, z);
    vertices.push(...f.vertices);
    etiquetas.push({
      id: `cl-${p.id}`,
      texto: etiquetaCargaLineal(carga.suma, carga.varias),
      x: f.etiqueta.x,
      y: f.etiqueta.y,
      z: f.etiqueta.z,
    });
  }

  // Cargas superficiales sobre PAÑOS: hatch a 45° sobre la huella.
  for (const pano of geo.panos) {
    const carga = superficiales.get(pano.id);
    if (!carga) continue;
    const z = pano.z + CARGA_Z_EPS;
    const h = hatchCargaSuperficial(pano.contorno, z);
    vertices.push(...h.vertices);
    etiquetas.push({
      id: `cs-${pano.id}`,
      texto: etiquetaCargaSuperficial(carga.suma, carga.varias),
      x: h.etiqueta.x,
      y: h.etiqueta.y,
      z: h.etiqueta.z,
    });
  }

  return { vertices, etiquetas };
}

export function CargasDibujadas() {
  const enPlanta = useEnPlanta();
  const geo = useGeometriaModelo();

  // Deriva junto al modelo (no por frame). Se lee cargas con getState(); su referencia
  // cambia con la geometria (misma suscripcion a `s.modelo` en useGeometriaModelo), asi que
  // recomputar al cambiar `geo` cubre tambien el alta/baja/edicion de cargas.
  const { vertices, etiquetas } = useMemo(
    () => derivarCargas(geo, modeloStore.getState().modelo.cargas),
    [geo],
  );

  // Geometria de las lineas (flechas + hatch) en un unico BufferGeometry reconstruido al
  // cambiar `vertices`. lineSegments dibuja pares consecutivos de vertices.
  const geoLineas = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(new Float32Array(vertices), 3));
    return g;
  }, [vertices]);
  useEffect(() => () => geoLineas.dispose(), [geoLineas]);

  const colorLinea = useMemo(() => hexToken("load"), []);

  // Pinta un frame al cambiar cargas/visibilidad (frameloop="demand").
  useEffect(() => {
    invalidate();
  }, [geoLineas, etiquetas, enPlanta]);

  if (!enPlanta || vertices.length === 0) return null;

  return (
    <group>
      {/* Flechas + hatch: un solo lineSegments, no raycasteable. */}
      <CargaLineas geometria={geoLineas} color={colorLinea} />
      {etiquetas.map((e) => (
        <Text
          key={e.id}
          position={[e.x, e.y, e.z]}
          fontSize={TAM_TEXTO_M}
          color={colorLinea}
          anchorX="center"
          anchorY="middle"
          raycast={() => null}
        >
          {e.texto}
        </Text>
      ))}
    </group>
  );
}

// lineSegments no raycasteable (raycast={null}) con el material --load. Aislado en su
// componente para fijar el raycast sin cargar el JSX de arriba.
function CargaLineas({
  geometria,
  color,
}: {
  geometria: BufferGeometry;
  color: string;
}) {
  const ref = (ls: LineSegmentsT | null) => {
    if (ls) ls.raycast = () => null;
  };
  return (
    <lineSegments ref={ref} geometry={geometria} renderOrder={8}>
      <lineBasicMaterial color={color} transparent opacity={0.85} depthWrite={false} toneMapped={false} />
    </lineSegments>
  );
}
