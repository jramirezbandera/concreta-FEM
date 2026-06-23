// GeometriaModelo: dibuja la obra (Capa 1) del grupo/planta activos en la escena.
// SOLO LECTURA del modelo; escribe unicamente en seleccionStore (hover/seleccion).
//
// RENDIMIENTO (reglas #11):
//  - Pilares como InstancedMesh DIRECTO (no <Instances> de drei: menos overhead
//    CPU, correccion de verificacion del spec). Un mapa instanceId->id de dominio
//    da el picking.
//  - Vigas como LineSegments con BufferGeometry (un par de vertices por viga);
//    para el picking, meshes finos invisibles envueltos en <Bvh> (las lineas no
//    raycastean bien con grosor). En F1 el volumen es bajo; si crece, migrar a
//    instancing de cilindros.
//  - Geometria reconstruida SOLO al cambiar modelo/grupo/planta (useGeometriaModelo
//    via useSyncExternalStore), nunca por frame.
//  - Hover/seleccion mutan refs (colores de instancia) sin setState por frame.
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { invalidate, type ThreeEvent } from "@react-three/fiber";
import { Bvh, Line } from "@react-three/drei";
import {
  Color,
  InstancedMesh,
  Matrix4,
  Euler,
  Quaternion,
  Vector3,
  BufferGeometry,
  Float32BufferAttribute,
} from "three";
import { seleccionStore, vistaStore } from "../../estado";
import { colorToken, hexToken } from "./colores";
import {
  useGeometriaModelo,
  type GeometriaModelo as GeoModelo,
} from "./hooks/useGeometriaModelo";
import { useResaltadoSeleccion, aplicarTinte } from "./hooks/usePickingRef";

// --- Picking helpers ---------------------------------------------------------

// Aplica seleccion al hacer clic: shift alterna, clic normal reemplaza.
function clicSeleccion(id: string, shift: boolean): void {
  const sel = seleccionStore.getState();
  if (shift) sel.alternar(id);
  else sel.seleccionar([id]);
  invalidate();
}

// Clic sobre un pilar: respeta la herramienta activa (feature-11/12). Se lee con
// getState() y NO como prop reactiva, para que cambiar de herramienta no
// reconstruya la geometria (regla #11: cero re-render del lienzo por estado de UI).
//  - herramienta "seleccion": seleccion unica (`seleccionar([id])`); shift
//    alterna para multiseleccion explicita. seleccion[0] alimenta el inspector.
//  - cualquier otra herramienta de introduccion ("pilar"/"viga"): la colocacion
//    tiene prioridad; NO seleccionamos (el clic lo gestiona la herramienta via el
//    plano Z=0). Gating por `!== "seleccion"` para que colocar vigas tampoco
//    dispare seleccion de pilares (feature-12, T3.1).
// Export usado por el test del gating por herramienta (no es un componente; el
// modulo no participa en Fast Refresh de forma significativa).
// eslint-disable-next-line react-refresh/only-export-components
export function clicSeleccionPilar(id: string, shift: boolean): void {
  if (vistaStore.getState().herramienta !== "seleccion") return;
  clicSeleccion(id, shift);
}

// Clic sobre una viga: espejo de `clicSeleccionPilar`. Solo selecciona en modo
// "seleccion"; durante la colocacion de pilares o vigas el clic NO selecciona.
// eslint-disable-next-line react-refresh/only-export-components
export function clicSeleccionViga(id: string, shift: boolean): void {
  if (vistaStore.getState().herramienta !== "seleccion") return;
  clicSeleccion(id, shift);
}

function entrarHover(id: string): void {
  if (seleccionStore.getState().hoverId !== id) {
    seleccionStore.getState().setHover(id);
    invalidate();
  }
}

function salirHover(id: string): void {
  if (seleccionStore.getState().hoverId === id) {
    seleccionStore.getState().setHover(null);
    invalidate();
  }
}

// --- Pilares (InstancedMesh) -------------------------------------------------

function PilaresInstanciados({ pilares }: { pilares: GeoModelo["pilares"] }) {
  const ref = useRef<InstancedMesh>(null);

  // Mapa instanceId -> id de dominio (estable por reconstruccion). Lo necesita el
  // picking (evento da instanceId) y el resaltado.
  const idPorInstancia = useMemo(() => pilares.map((p) => p.id), [pilares]);

  // Colores base/hover/seleccion derivados de tokens (Spec §1.3 / §6.2).
  const colBase = useMemo(() => colorToken("pilar"), []);
  const colHover = useMemo(() => colorToken("accentLine"), []);
  const colSel = useMemo(() => colorToken("accent"), []);

  // Coloca cada instancia (matriz de transformacion) cuando cambia la geometria.
  useEffect(() => {
    const malla = ref.current;
    if (!malla) return;
    const m = new Matrix4();
    const q = new Quaternion();
    const e = new Euler();
    const pos = new Vector3();
    const esc = new Vector3();
    const aux = new Color();
    pilares.forEach((p, i) => {
      // Caja con la base en planta (X,Y) y altura en Z = cota. La caja unitaria
      // se escala a (lado, lado, alto); giro `angulo` alrededor de Z.
      pos.set(p.cx, p.cy, p.cz);
      e.set(0, 0, (p.angulo * Math.PI) / 180);
      q.setFromEuler(e);
      esc.set(p.lado, p.lado, p.alto);
      m.compose(pos, q, esc);
      malla.setMatrixAt(i, m);
      malla.setColorAt(i, aux.copy(colBase));
    });
    malla.count = pilares.length;
    malla.instanceMatrix.needsUpdate = true;
    if (malla.instanceColor) malla.instanceColor.needsUpdate = true;
    malla.computeBoundingSphere();
    invalidate();
  }, [pilares, colBase]);

  // Resaltado hover/seleccion via mutacion de colores de instancia (sin setState).
  const aux = useMemo(() => new Color(), []);
  useResaltadoSeleccion(ref, idPorInstancia, {
    pintar: (i, modo) => {
      aplicarTinte(aux, colBase, colHover, colSel, modo);
      ref.current?.setColorAt(i, aux);
    },
  });

  if (pilares.length === 0) return null;
  return (
    <Bvh firstHitOnly>
      <instancedMesh
        ref={ref}
        // args[2] = capacidad inicial; usamos length actual (se recrea al cambiar).
        args={[undefined, undefined, Math.max(pilares.length, 1)]}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          const id = idPorInstancia[e.instanceId ?? -1];
          if (id) entrarHover(id);
        }}
        onPointerOut={(e: ThreeEvent<PointerEvent>) => {
          const id = idPorInstancia[e.instanceId ?? -1];
          if (id) salirHover(id);
        }}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          const id = idPorInstancia[e.instanceId ?? -1];
          if (id) clicSeleccionPilar(id, e.shiftKey);
        }}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
    </Bvh>
  );
}

// --- Halo de seleccion del pilar (Spec Diseno UI §6.2) -----------------------

// Margen del halo respecto al medio lado del pilar (m) y epsilon en Z para que el
// cuadrado punteado quede SOBRE la cara superior (visible en planta cenital, no
// ocluido por la caja). Patron de dash en metros.
const HALO_MARGEN = 0.08;
const HALO_Z_EPS = 0.03;
const HALO_DASH = 0.06;
const HALO_GAP = 0.05;

// Id del pilar seleccionado cuando hay EXACTAMENTE uno (si no, null). Suscripcion
// ligera: re-render solo al cambiar la seleccion (accion del usuario, no por frame).
function useSeleccionUnica(): string | null {
  return useSyncExternalStore(
    (cb) => seleccionStore.subscribe((s) => s.seleccion, cb),
    () => {
      const s = seleccionStore.getState().seleccion;
      return s.length === 1 ? s[0]! : null;
    },
    () => null,
  );
}

// Cuadrado punteado en acento alrededor del pilar seleccionado (Spec §6.2: "halo
// punteado"). Sigue la posicion/giro/tamaño del pilar; se oculta si no hay un unico
// pilar seleccionado. Cero coste por frame: solo se reconstruye al cambiar la
// seleccion o la geometria.
function HaloPilarSeleccionado({ pilares }: { pilares: GeoModelo["pilares"] }) {
  const selId = useSeleccionUnica();
  const color = useMemo(() => hexToken("accent"), []);
  const pilar = selId ? pilares.find((p) => p.id === selId) ?? null : null;
  // Pinta un frame al cambiar de seleccion/geometria (frameloop="demand").
  useEffect(() => {
    invalidate();
  }, [selId, pilares]);

  if (!pilar) return null;
  const m = pilar.lado / 2 + HALO_MARGEN;
  const z = pilar.cz + pilar.alto / 2 + HALO_Z_EPS;
  // Cuadrado cerrado centrado en el origen (lo posiciona/gira el group).
  const puntos: [number, number, number][] = [
    [-m, -m, 0],
    [m, -m, 0],
    [m, m, 0],
    [-m, m, 0],
    [-m, -m, 0],
  ];
  return (
    <group
      position={[pilar.cx, pilar.cy, z]}
      rotation={[0, 0, (pilar.angulo * Math.PI) / 180]}
    >
      <Line
        points={puntos}
        color={color}
        lineWidth={1.5}
        dashed
        dashSize={HALO_DASH}
        gapSize={HALO_GAP}
      />
    </group>
  );
}

// --- Vigas (lineas visibles + meshes finos de picking) -----------------------

function VigasLineas({ vigas }: { vigas: GeoModelo["vigas"] }) {
  const colBase = useMemo(() => colorToken("viga"), []);
  const colSel = useMemo(() => colorToken("accent"), []);
  const colHover = useMemo(() => colorToken("accentLine"), []);

  // Geometria de lineas: dos vertices por viga.
  const geom = useMemo(() => {
    const g = new BufferGeometry();
    const pos = new Float32Array(vigas.length * 2 * 3);
    vigas.forEach((v, i) => {
      const o = i * 6;
      pos[o] = v.ax;
      pos[o + 1] = v.ay;
      pos[o + 2] = v.z;
      pos[o + 3] = v.bx;
      pos[o + 4] = v.by;
      pos[o + 5] = v.z;
    });
    g.setAttribute("position", new Float32BufferAttribute(pos, 3));
    return g;
  }, [vigas]);

  useEffect(() => {
    invalidate();
    return () => geom.dispose();
  }, [geom]);

  // Nota de diseno: la linea base se deja en color de viga; el feedback fuerte de
  // hover/seleccion lo da el halo (cilindro transparente) sobre cada viga. El color
  // por-viga sobre la linea llegara con instancing de tubos en F11/14.

  if (vigas.length === 0) return null;
  return (
    <group>
      <lineSegments geometry={geom}>
        <lineBasicMaterial color={colBase} toneMapped={false} />
      </lineSegments>
      {/* Meshes finos invisibles para el picking robusto de cada viga (las lineas
          no raycastean con tolerancia). Envueltos en Bvh. */}
      <Bvh firstHitOnly>
        {vigas.map((v) => (
          <VigaPickable key={v.id} viga={v} hover={colHover} sel={colSel} />
        ))}
      </Bvh>
    </group>
  );
}

function VigaPickable({
  viga,
  hover,
  sel,
}: {
  viga: GeoModelo["vigas"][number];
  hover: Color;
  sel: Color;
}) {
  // Cilindro fino orientado del nudo I al J, a la cota de la planta. Transparente:
  // solo sirve de blanco de picking y de halo al seleccionar/hover.
  const ref = useRef<InstancedMesh>(null);
  const { pos, quat, largo } = useMemo(() => {
    const a = new Vector3(viga.ax, viga.ay, viga.z);
    const b = new Vector3(viga.bx, viga.by, viga.z);
    const dir = new Vector3().subVectors(b, a);
    const l = Math.max(dir.length(), 0.001);
    const centro = new Vector3().addVectors(a, b).multiplyScalar(0.5);
    // Cilindro por defecto a lo largo de Y; rotar Y -> dir.
    const q = new Quaternion().setFromUnitVectors(
      new Vector3(0, 1, 0),
      dir.clone().normalize(),
    );
    return { pos: centro, quat: q, largo: l };
  }, [viga]);

  // Opacidad del halo segun seleccion/hover (mutado por ref, sin setState/frame).
  const matRef = useRef<{ opacity: number; color: Color } | null>(null);
  useEffect(() => {
    const repintar = () => {
      const m = matRef.current;
      if (!m) return;
      const seleccionado = seleccionStore.getState().seleccion.includes(viga.id);
      const enHover = seleccionStore.getState().hoverId === viga.id;
      m.opacity = seleccionado ? 0.9 : enHover ? 0.5 : 0;
      m.color = seleccionado ? sel : hover;
      invalidate();
    };
    repintar();
    const offH = seleccionStore.subscribe((s) => s.hoverId, repintar);
    const offS = seleccionStore.subscribe((s) => s.seleccion, repintar);
    return () => {
      offH();
      offS();
    };
  }, [viga.id, hover, sel]);

  return (
    <mesh
      ref={ref as never}
      position={pos}
      quaternion={quat}
      onPointerMove={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        entrarHover(viga.id);
      }}
      onPointerOut={() => salirHover(viga.id)}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        clicSeleccionViga(viga.id, e.shiftKey);
      }}
    >
      {/* Radio generoso para facilitar el picking; el halo visible usa el material. */}
      <cylinderGeometry args={[0.08, 0.08, largo, 6]} />
      <meshBasicMaterial
        ref={(m) => {
          matRef.current = m as unknown as { opacity: number; color: Color };
        }}
        transparent
        opacity={0}
        toneMapped={false}
      />
    </mesh>
  );
}

// --- Raiz de geometria -------------------------------------------------------

export function GeometriaModelo() {
  const { pilares, vigas } = useGeometriaModelo();
  return (
    <group>
      <PilaresInstanciados pilares={pilares} />
      <HaloPilarSeleccionado pilares={pilares} />
      <VigasLineas vigas={vigas} />
    </group>
  );
}
