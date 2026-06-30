// GeometriaModelo: dibuja la obra (Capa 1) del grupo/planta activos en la escena.
// SOLO LECTURA del modelo; escribe unicamente en seleccionStore (hover/seleccion).
//
// RENDIMIENTO (reglas #11):
//  - Pilares como InstancedMesh DIRECTO (no <Instances> de drei: menos overhead
//    CPU, correccion de verificacion del spec). Un mapa instanceId->id de dominio
//    da el picking.
//  - Vigas como InstancedMesh de cajas (ancho x largo x canto) orientadas nudo I->J,
//    igual que los pilares: volumen 3D real (no una linea) y el mismo mesh sirve de
//    blanco de picking. instanceColor da hover/seleccion (una sola pareja de subs).
//  - Geometria reconstruida SOLO al cambiar modelo/grupo/planta (useGeometriaModelo
//    via useSyncExternalStore), nunca por frame.
//  - Hover/seleccion mutan refs (colores de instancia) sin setState por frame.
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { invalidate, type ThreeEvent } from "@react-three/fiber";
import { Bvh, Line } from "@react-three/drei";
import {
  Color,
  InstancedMesh,
  Mesh,
  Matrix4,
  Euler,
  Quaternion,
  Vector3,
  Shape,
  ShapeGeometry,
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

// Durante la introduccion (herramienta "pilar"/"viga") la geometria NO debe capturar
// el puntero: el evento debe ATRAVESAR hasta el plano de colocacion (snap/iman en
// ColocacionPilar/ColocacionViga, un plano en Z=0). Si la geometria hace
// stopPropagation() PRIMERO, el clic sobre una cabeza de pilar -justo donde el iman
// quiere enganchar- nunca llega al plano y la viga no se crea: ese es el bug del snap
// que falla y del "segundo clic" perdido (el 2.o clic tambien cae sobre otro pilar).
// Por eso cada manejador comprueba ESTO antes de stopPropagation(). Se lee con
// getState() (no prop reactiva) para no reconstruir el lienzo al cambiar de herramienta
// (regla #11).
function modoSeleccionActivo(): boolean {
  return vistaStore.getState().herramienta === "seleccion";
}

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

// Clic sobre la huella de un paño (F3): espejo de `clicSeleccionViga`. Solo selecciona
// en modo "seleccion"; durante cualquier colocacion el clic NO selecciona. El paño se
// introduce/edita en la pestana de vigas (donde vive el menu "Paños"), asi que el
// auto-switch de contexto 3D apunta a "entradaVigas".
// eslint-disable-next-line react-refresh/only-export-components
export function clicSeleccionPano(id: string, shift: boolean): void {
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
          if (!modoSeleccionActivo()) return; // deja pasar el evento a la colocacion
          e.stopPropagation();
          const id = idPorInstancia[e.instanceId ?? -1];
          if (id) entrarHover(id);
        }}
        onPointerOut={(e: ThreeEvent<PointerEvent>) => {
          const id = idPorInstancia[e.instanceId ?? -1];
          if (id) salirHover(id);
        }}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          if (!modoSeleccionActivo()) return; // el clic debe llegar al plano (snap/iman)
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

// --- Vigas (InstancedMesh de cajas, igual que los pilares) -------------------
//
// RENDIMIENTO (T-vigas-1, F2c; volumen 3D anadido despues): UN solo InstancedMesh de
// cajas para TODAS las vigas, con instanceColor para hover/seleccion mutado por
// `useResaltadoSeleccion` (una sola pareja de suscripciones, como los pilares). Antes
// la viga era una linea fina + un cilindro de picking invisible: en 3D se veia como un
// hilo, no como una barra. Ahora cada viga es una caja (ancho x largo x canto) orientada
// del nudo I al J: se lee como volumen igual que un pilar y el mismo mesh sirve de
// blanco de picking (sin cilindro aparte). Coste O(1) en mallas/suscripciones.

function VigasInstanciadas({ vigas }: { vigas: GeoModelo["vigas"] }) {
  const ref = useRef<InstancedMesh>(null);

  // Mapa instanceId -> id de dominio (estable por reconstruccion): picking y resaltado.
  const idPorInstancia = useMemo(() => vigas.map((v) => v.id), [vigas]);

  const colBase = useMemo(() => colorToken("viga"), []);
  const colHover = useMemo(() => colorToken("accentLine"), []);
  const colSel = useMemo(() => colorToken("accent"), []);

  // Coloca cada instancia (matriz de transformacion) cuando cambia la geometria. La caja
  // unitaria se escala a (ancho, largo, canto) y se orienta con el eje local Y a lo largo
  // de la viga (nudo I->J); para vigas horizontales esa rotacion es pura sobre Z, asi el
  // eje local Z queda vertical y el canto es la altura. Se baja media altura
  // (pos.z -= canto/2) para que la barra cuelgue BAJO la cota de la planta y no atraviese
  // el forjado.
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
    const aux = new Color();
    vigas.forEach((v, i) => {
      a.set(v.ax, v.ay, v.z);
      b.set(v.bx, v.by, v.z);
      dir.subVectors(b, a);
      const largo = Math.max(dir.length(), 0.001);
      pos.addVectors(a, b).multiplyScalar(0.5);
      pos.z -= v.canto / 2; // la viga cuelga bajo la cota de la planta
      q.setFromUnitVectors(yUp, dir.normalize()); // dir ya capturado en `largo`
      esc.set(v.ancho, largo, v.canto); // caja: ancho (X) x largo (Y->dir) x canto (Z)
      m.compose(pos, q, esc);
      malla.setMatrixAt(i, m);
      malla.setColorAt(i, aux.copy(colBase));
    });
    malla.count = vigas.length;
    malla.instanceMatrix.needsUpdate = true;
    if (malla.instanceColor) malla.instanceColor.needsUpdate = true;
    malla.computeBoundingSphere();
    invalidate();
  }, [vigas, colBase]);

  // Resaltado hover/seleccion via mutacion de colores de instancia (sin setState),
  // identico a los pilares: una sola pareja de suscripciones para todas las vigas.
  const aux = useMemo(() => new Color(), []);
  useResaltadoSeleccion(ref, idPorInstancia, {
    pintar: (i, modo) => {
      aplicarTinte(aux, colBase, colHover, colSel, modo);
      ref.current?.setColorAt(i, aux);
    },
  });

  if (vigas.length === 0) return null;
  return (
    <Bvh firstHitOnly>
      <instancedMesh
        ref={ref}
        args={[undefined, undefined, Math.max(vigas.length, 1)]}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => {
          if (!modoSeleccionActivo()) return; // deja pasar el evento a la colocacion
          e.stopPropagation();
          const id = idPorInstancia[e.instanceId ?? -1];
          if (id) entrarHover(id);
        }}
        onPointerOut={(e: ThreeEvent<PointerEvent>) => {
          const id = idPorInstancia[e.instanceId ?? -1];
          if (id) salirHover(id);
        }}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          if (!modoSeleccionActivo()) return; // el clic debe llegar al plano (snap/iman)
          e.stopPropagation();
          const id = idPorInstancia[e.instanceId ?? -1];
          if (id) clicSeleccionViga(id, e.shiftKey);
        }}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
    </Bvh>
  );
}

// --- Paños (huella de losa: poligono relleno semitransparente) ---------------
//
// RENDIMIENTO (regla #11): cada paño es una mesh con geometria propia (ShapeGeometry del
// contorno), reconstruida SOLO al cambiar la geometria. El hover/seleccion mutan el color
// del MATERIAL por ref en respuesta a transient updates de seleccionStore (subscribe), sin
// setState por frame. El numero de paños por planta es bajo (no necesita instancing); el
// blanco de picking es la propia huella. El relleno es semitransparente (la rejilla y la
// obra se ven a traves) y `depthWrite={false}` evita que tape lo que hay debajo.

// Elevacion de la huella sobre la cota (anti z-fight con la rejilla; bajo el forjado real
// pero sobre el plano de coords).
const PANO_Z_EPS = 0.01;

function PanoHuella({ pano }: { pano: GeoModelo["panos"][number] }) {
  const ref = useRef<Mesh>(null);
  const colBase = useMemo(() => colorToken("pilar"), []);
  const colHover = useMemo(() => colorToken("accentLine"), []);
  const colSel = useMemo(() => colorToken("accent"), []);

  // Geometria del poligono relleno (Shape en el plano XY). Se posiciona luego a z=cota.
  const geom = useMemo(() => {
    const shape = new Shape();
    const c = pano.contorno;
    shape.moveTo(c[0]!.x, c[0]!.y);
    for (let i = 1; i < c.length; i++) shape.lineTo(c[i]!.x, c[i]!.y);
    shape.closePath();
    return new ShapeGeometry(shape);
  }, [pano.contorno]);
  useEffect(() => () => geom.dispose(), [geom]);

  // Color del relleno via mutacion del material (hover/seleccion), sin setState por frame.
  const aux = useMemo(() => new Color(), []);
  useEffect(() => {
    const aplicar = () => {
      const m = ref.current;
      if (!m) return;
      const { seleccion, hoverId } = seleccionStore.getState();
      const sel = seleccion.includes(pano.id);
      const hov = hoverId === pano.id;
      aplicarTinte(aux, colBase, colHover, colSel, sel ? "seleccion" : hov ? "hover" : "base");
      const mat = m.material as { color?: Color };
      if (mat.color) mat.color.copy(aux);
      invalidate();
    };
    aplicar();
    const offHover = seleccionStore.subscribe((s) => s.hoverId, aplicar);
    const offSel = seleccionStore.subscribe((s) => s.seleccion, aplicar);
    return () => {
      offHover();
      offSel();
    };
  }, [pano.id, aux, colBase, colHover, colSel]);

  return (
    <Bvh firstHitOnly>
      <mesh
        ref={ref}
        geometry={geom}
        position={[0, 0, pano.z + PANO_Z_EPS]}
        onPointerMove={(e: ThreeEvent<PointerEvent>) => {
          if (!modoSeleccionActivo()) return; // deja pasar el evento a la colocacion
          e.stopPropagation();
          entrarHover(pano.id);
        }}
        onPointerOut={() => salirHover(pano.id)}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          if (!modoSeleccionActivo()) return; // el clic debe llegar al plano (colocacion)
          e.stopPropagation();
          clicSeleccionPano(pano.id, e.shiftKey);
        }}
      >
        <meshBasicMaterial
          transparent
          opacity={0.3}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </Bvh>
  );
}

function PanosHuella({ panos }: { panos: GeoModelo["panos"] }) {
  useEffect(() => {
    invalidate();
  }, [panos]);
  if (panos.length === 0) return null;
  return (
    <group>
      {panos.map((p) => (
        <PanoHuella key={p.id} pano={p} />
      ))}
    </group>
  );
}

// --- Raiz de geometria -------------------------------------------------------

// La obra solida (pilares/vigas) se OCULTA cuando el usuario pide ver SOLO el modelo de
// calculo (3D + "Ver modelo de calculo" + "Ocultar la obra"): asi el modelo de calculo
// (overlay de Capa 2) no queda tapado por la obra solida. Suscripcion ligera (3 flags de
// vista), nunca por frame. Fuera de ese caso, la obra se ve normal.
function useObraOculta(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const offModo = vistaStore.subscribe((s) => s.modoVista, cb);
      const offMostrar = vistaStore.subscribe((s) => s.mostrarModeloCalculo, cb);
      const offSolo = vistaStore.subscribe((s) => s.soloModeloCalculo, cb);
      return () => {
        offModo();
        offMostrar();
        offSolo();
      };
    },
    () => {
      const s = vistaStore.getState();
      return s.modoVista !== "planta" && s.mostrarModeloCalculo && s.soloModeloCalculo;
    },
    () => false,
  );
}

export function GeometriaModelo() {
  const { pilares, vigas, panos } = useGeometriaModelo();
  const obraOculta = useObraOculta();
  // Repinta al ocultar/mostrar la obra (frameloop="demand": montar/desmontar la
  // geometria no programa frame por si solo).
  useEffect(() => {
    invalidate();
  }, [obraOculta]);
  if (obraOculta) return null;
  return (
    <group>
      <PanosHuella panos={panos} />
      <PilaresInstanciados pilares={pilares} />
      <HaloPilarSeleccionado pilares={pilares} />
      <VigasInstanciadas vigas={vigas} />
    </group>
  );
}
