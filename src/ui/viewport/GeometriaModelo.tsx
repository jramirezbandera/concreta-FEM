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
import { modeloStore, seleccionStore, vistaStore } from "../../estado";
import type { Pestana } from "../../estado";
import { colorToken, hexToken } from "./colores";
import {
  useGeometriaModelo,
  type GeometriaModelo as GeoModelo,
} from "./hooks/useGeometriaModelo";
import { resolverContextoElemento } from "./hooks/resolverContextoElemento";
import { useResaltadoSeleccion, aplicarTinte } from "./hooks/usePickingRef";

// --- Picking helpers ---------------------------------------------------------

// Aplica seleccion al hacer clic: shift alterna, clic normal reemplaza.
function clicSeleccion(id: string, shift: boolean): void {
  const sel = seleccionStore.getState();
  if (shift) sel.alternar(id);
  else sel.seleccionar([id]);
  invalidate();
}

// SINCRONIZAR CONTEXTO al pickear en 3D pleno (F2c). En cualquier vista que NO sea
// "planta", la geometria muestra todo el edificio; pickear un elemento de otra planta
// debe mover el contexto activo (grupo/planta) al suyo para que sidebar, inspector,
// GroupRibbon y plantillas queden coherentes (T-3dpleno-ux). Ademas se cambia a la
// PESTANA del tipo (pilar->entradaPilares, viga->entradaVigas) para que el inspector
// correcto este montado (Issue 5-C) -- pero SOLO si ya estamos en una pestana de
// entrada (en Resultados/Isovalores la seleccion alimenta diagramas; no saltamos).
// En "planta" el contexto lo gobierna el sidebar; no se toca. En shift-multiseleccion
// no se mueve nada (Issue 6-A): no tiene sentido saltar de planta/pestana acumulando.
function sincronizarContexto3D(id: string, shift: boolean, pestanaTipo: Pestana): void {
  if (shift) return;
  const v = vistaStore.getState();
  if (v.modoVista === "planta") return;
  const ctx = resolverContextoElemento(modeloStore.getState().modelo, id);
  if (!ctx) return;
  v.setGrupoActivo(ctx.grupoActivoId);
  v.setPlantaActiva(ctx.plantaActivaId);
  if (v.pestanaActiva === "entradaPilares" || v.pestanaActiva === "entradaVigas") {
    v.setPestanaActiva(pestanaTipo);
  }
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
  sincronizarContexto3D(id, shift, "entradaPilares");
}

// Clic sobre una viga: espejo de `clicSeleccionPilar`. Solo selecciona en modo
// "seleccion"; durante la colocacion de pilares o vigas el clic NO selecciona.
// eslint-disable-next-line react-refresh/only-export-components
export function clicSeleccionViga(id: string, shift: boolean): void {
  if (vistaStore.getState().herramienta !== "seleccion") return;
  clicSeleccion(id, shift);
  sincronizarContexto3D(id, shift, "entradaVigas");
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

// --- Vigas (linea visible con color por-barra + InstancedMesh de picking) -----
//
// RENDIMIENTO (T-vigas-1, resuelto en F2c): antes cada viga era un <mesh> cilindro +
// DOS suscripciones a seleccionStore. En 3D pleno (todas las plantas a la vez) eso es
// O(N) mallas + 2N suscripciones, y cada hover dispara las 2N. Ahora:
//  - La linea visible es UN lineSegments con atributo de COLOR por vertice; hover y
//    seleccion recolorean la barra MUTANDO ese buffer (sin setState), con UNA sola
//    pareja de suscripciones para TODAS las vigas (como los pilares mutan instanceColor).
//  - El picking es UN InstancedMesh de cilindros finos transparentes (raycast robusto:
//    las lineas no raycastean con tolerancia), con un mapa instanceId->id de dominio.
// Coste O(1) en mallas/suscripciones, igual que los pilares.

const VIGA_PICK_RADIO = 0.08; // radio del cilindro de picking (m)

function Vigas({ vigas }: { vigas: GeoModelo["vigas"] }) {
  const colBase = useMemo(() => colorToken("viga"), []);
  const colSel = useMemo(() => colorToken("accent"), []);
  const colHover = useMemo(() => colorToken("accentLine"), []);

  // Mapa indice -> id de dominio (estable por reconstruccion): picking y recoloreado.
  const idPorIndice = useMemo(() => vigas.map((v) => v.id), [vigas]);

  // Geometria de lineas: 2 vertices por viga (position) + color por vertice (init base).
  const geom = useMemo(() => {
    const g = new BufferGeometry();
    const pos = new Float32Array(vigas.length * 2 * 3);
    const col = new Float32Array(vigas.length * 2 * 3);
    vigas.forEach((v, i) => {
      const o = i * 6;
      pos[o] = v.ax;
      pos[o + 1] = v.ay;
      pos[o + 2] = v.z;
      pos[o + 3] = v.bx;
      pos[o + 4] = v.by;
      pos[o + 5] = v.z;
      for (let k = 0; k < 6; k += 3) {
        col[o + k] = colBase.r;
        col[o + k + 1] = colBase.g;
        col[o + k + 2] = colBase.b;
      }
    });
    g.setAttribute("position", new Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new Float32BufferAttribute(col, 3));
    return g;
  }, [vigas, colBase]);

  useEffect(() => {
    invalidate();
    return () => geom.dispose();
  }, [geom]);

  // Recoloreado hover/seleccion mutando el atributo de color (sin setState/frame). UNA
  // sola pareja de suscripciones para todas las vigas. Repinta todas segun el estado.
  useEffect(() => {
    const colorAttr = geom.getAttribute("color") as Float32BufferAttribute;
    const aplicar = () => {
      const { seleccion, hoverId } = seleccionStore.getState();
      idPorIndice.forEach((id, i) => {
        const c = seleccion.includes(id)
          ? colSel
          : id === hoverId && hoverId !== null
            ? colHover
            : colBase;
        colorAttr.setXYZ(2 * i, c.r, c.g, c.b);
        colorAttr.setXYZ(2 * i + 1, c.r, c.g, c.b);
      });
      colorAttr.needsUpdate = true;
      invalidate();
    };
    aplicar();
    const offH = seleccionStore.subscribe((s) => s.hoverId, aplicar);
    const offS = seleccionStore.subscribe((s) => s.seleccion, aplicar);
    return () => {
      offH();
      offS();
    };
  }, [geom, idPorIndice, colBase, colHover, colSel]);

  if (vigas.length === 0) return null;
  return (
    <group>
      <lineSegments geometry={geom}>
        <lineBasicMaterial vertexColors toneMapped={false} />
      </lineSegments>
      <VigasPicking vigas={vigas} idPorIndice={idPorIndice} />
    </group>
  );
}

// InstancedMesh UNICO de cilindros finos transparentes: blanco de picking de TODAS las
// vigas (sin suscripciones; el resaltado lo da la linea). Un cilindro unitario en Y,
// escalado a la longitud de la viga y orientado del nudo I al J.
function VigasPicking({
  vigas,
  idPorIndice,
}: {
  vigas: GeoModelo["vigas"];
  idPorIndice: readonly string[];
}) {
  const ref = useRef<InstancedMesh>(null);

  useEffect(() => {
    const malla = ref.current;
    if (!malla) return;
    const m = new Matrix4();
    const q = new Quaternion();
    const pos = new Vector3();
    const esc = new Vector3();
    const a = new Vector3();
    const b = new Vector3();
    const dir = new Vector3();
    const yUp = new Vector3(0, 1, 0);
    vigas.forEach((v, i) => {
      a.set(v.ax, v.ay, v.z);
      b.set(v.bx, v.by, v.z);
      dir.subVectors(b, a);
      const largo = Math.max(dir.length(), 0.001);
      pos.addVectors(a, b).multiplyScalar(0.5);
      q.setFromUnitVectors(yUp, dir.normalize()); // dir ya capturado en `largo`
      esc.set(1, largo, 1); // cilindro unitario en Y -> largo de la viga
      m.compose(pos, q, esc);
      malla.setMatrixAt(i, m);
    });
    malla.count = vigas.length;
    malla.instanceMatrix.needsUpdate = true;
    malla.computeBoundingSphere();
    invalidate();
  }, [vigas]);

  if (vigas.length === 0) return null;
  return (
    <Bvh firstHitOnly>
      <instancedMesh
        ref={ref}
        args={[undefined, undefined, Math.max(vigas.length, 1)]}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          const id = idPorIndice[e.instanceId ?? -1];
          if (id) entrarHover(id);
        }}
        onPointerOut={(e: ThreeEvent<PointerEvent>) => {
          const id = idPorIndice[e.instanceId ?? -1];
          if (id) salirHover(id);
        }}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          const id = idPorIndice[e.instanceId ?? -1];
          if (id) clicSeleccionViga(id, e.shiftKey);
        }}
      >
        <cylinderGeometry args={[VIGA_PICK_RADIO, VIGA_PICK_RADIO, 1, 6]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} toneMapped={false} />
      </instancedMesh>
    </Bvh>
  );
}

// --- Raiz de geometria -------------------------------------------------------

export function GeometriaModelo() {
  const { pilares, vigas } = useGeometriaModelo();
  return (
    <group>
      <PilaresInstanciados pilares={pilares} />
      <HaloPilarSeleccionado pilares={pilares} />
      <Vigas vigas={vigas} />
    </group>
  );
}
