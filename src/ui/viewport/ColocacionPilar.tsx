// ColocacionPilar: introduccion grafica de pilares por clic en planta (feature-11,
// Tarea 2.1). Objeto R3F que se inyecta DENTRO de la escena via `sceneOverlays` del
// Viewport (el montaje real lo hace la Fase 4; aqui solo se crea y exporta).
//
// COMPORTAMIENTO (Spec §4, decisiones de producto F11):
//  - Activo SOLO cuando vistaStore.herramienta === "pilar". Fuera de ese modo no
//    monta plano ni marcador ni listeners (no estorba al picking de seleccion).
//  - Plano invisible en Z=0 (gemelo de PlanoCoords) que capta onPointerMove (mover
//    el marcador fantasma) y onClick (colocar). Usa e.point.x / e.point.y; si
//    snapActivo, los pasa por snapARejilla.
//  - Marcador fantasma: cuadrado translucido + cruz en la posicion (snap) del
//    cursor, color token "pilar". Se mueve por MUTACION del ref del grupo, nunca
//    por setState (regla #11). frameloop="demand" -> invalidate() tras cada cambio.
//  - Clic coloca un pilar con defaultsPilar + coords + plantas del grupo activo y
//    despacha crearPilar. La herramienta permanece activa (colocar varios).
//  - Esc sale de la herramienta -> setHerramienta("seleccion").
//
// RENDIMIENTO (memoria feature-9): el modelo se lee con getState() JUSTO antes de
// construir el comando (invariante del `base`); nada de useFrame; cero setState por
// frame (el marcador se mueve mutando refs). El unico re-render React ocurre al
// cambiar de herramienta (raro), no por frame.
import { useEffect, useMemo, useRef, useSyncExternalStore, type RefObject } from "react";
import { invalidate, type ThreeEvent } from "@react-three/fiber";
import { BufferGeometry, Float32BufferAttribute, Group, Mesh } from "three";
import {
  modeloStore,
  vistaStore,
  seleccionStore,
  crearPilar,
  type DatosPilar,
} from "../../estado";
import { colorToken } from "./colores";
import { snapARejilla } from "./snap";
import { puntosSnapDePlantillas, engancharAPuntoExtra } from "./dxf/snapDxf";
import type { Plantilla, PuntoXY } from "./dxf/tiposDxf";
import { RADIO_IMAN_M } from "./imanViga";
import { tramoColocable } from "./tramoPilar";

// Semibrazo de la cruz y medio lado del cuadrado del marcador (m). Z ligeramente
// sobre el suelo para no z-fightear con la rejilla.
const MARCA_R = 0.18;
const MARCA_Z = 0.02;

// --- Suscripcion al modo de herramienta (fuera del bucle de render) -----------

// True solo en modo "pilar". useSyncExternalStore + subscribeWithSelector: re-render
// SOLO cuando cambia este campo (cambio de herramienta), nunca por frame.
function useHerramientaPilar(): boolean {
  return useSyncExternalStore(
    (cb) => vistaStore.subscribe((s) => s.herramienta, cb),
    () => vistaStore.getState().herramienta === "pilar",
    () => vistaStore.getState().herramienta === "pilar",
  );
}

// --- Derivacion de plantas del tramo del pilar --------------------------------

// Tramo del pilar a partir del ambito activo. Delega en el helper PURO `tramoColocable`
// (fuente unica de verdad, compartida con la guia de la barra de estado en App).
function tramoDelGrupoActivo(): { plantaInicial: string; plantaFinal: string } | null {
  const modelo = modeloStore.getState().getModelo();
  const { grupoActivoId, plantaActivaId } = vistaStore.getState();
  return tramoColocable(modelo, grupoActivoId, plantaActivaId);
}

// --- Marcador fantasma --------------------------------------------------------

// Geometria de la cruz (dos segmentos cruzados), creada una vez.
function crearGeoCruz(): BufferGeometry {
  const g = new BufferGeometry();
  const v = new Float32Array([
    -MARCA_R, 0, 0, MARCA_R, 0, 0, // horizontal
    0, -MARCA_R, 0, 0, MARCA_R, 0, // vertical
  ]);
  g.setAttribute("position", new Float32BufferAttribute(v, 3));
  return g;
}

// Cuadrado translucido + cruz en el plano XY. Color token "pilar". El grupo se
// reposiciona por mutacion de ref (no por props reactivas) en onPointerMove.
function MarcadorFantasma({ refGrupo }: { refGrupo: RefObject<Group | null> }) {
  const color = useMemo(() => colorToken("pilar"), []);
  const geoCruz = useMemo(() => crearGeoCruz(), []);
  // Liberar la geometria de la cruz al desmontar la herramienta.
  useEffect(() => () => geoCruz.dispose(), [geoCruz]);

  return (
    <group ref={refGrupo} renderOrder={10}>
      <mesh position={[0, 0, MARCA_Z]}>
        <planeGeometry args={[MARCA_R * 2, MARCA_R * 2]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.25}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <lineSegments position={[0, 0, MARCA_Z]} geometry={geoCruz}>
        <lineBasicMaterial
          color={color}
          transparent
          opacity={0.9}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>
    </group>
  );
}

// --- Componente activo (montado solo en modo "pilar") -------------------------

function ColocacionActiva() {
  const refPlano = useRef<Mesh>(null);
  const refMarcador = useRef<Group>(null);

  // Cache de los puntos de snap del calco DXF (feature-15, T6). Mismo patron que
  // ColocacionViga: `puntosSnapDePlantillas` transforma TODAS las entidades de TODAS
  // las plantillas visibles; con un DXF grande, invocarlo en CADA pointermove pone el
  // cursor a tirones. `plantillas`/`plantaActivaId` (vistaStore) son referencias
  // estables entre ediciones: solo cambian al editar una plantilla, lo que rompe el
  // === y fuerza recalculo (la memoizacion vive aqui; snapDxf sigue puro).
  const cacheSnap = useRef<{
    plantillas: readonly Plantilla[];
    plantaActivaId: string | null;
    puntos: PuntoXY[];
  } | null>(null);
  function puntosSnapMemo(
    plantillas: readonly Plantilla[],
    plantaActivaId: string | null,
  ): PuntoXY[] {
    const c = cacheSnap.current;
    if (
      c !== null &&
      c.plantillas === plantillas &&
      c.plantaActivaId === plantaActivaId
    ) {
      return c.puntos;
    }
    const puntos = puntosSnapDePlantillas(plantillas, plantaActivaId);
    cacheSnap.current = { plantillas, plantaActivaId, puntos };
    return puntos;
  }

  // Coloca el marcador en la posicion (snap) del cursor mutando el ref del grupo.
  function moverMarcador(x: number, y: number): void {
    const g = refMarcador.current;
    if (!g) return;
    g.position.set(x, y, 0);
    invalidate();
  }

  // Resuelve la posicion de colocacion con prioridad DXF > rejilla (los pilares no
  // enganchan a otra obra: se colocan libres). Si el snap esta off, no engancha a
  // nada (ni calco ni rejilla): coords crudas. El iman al calco usa el mismo radio
  // que el de vigas (RADIO_IMAN_M) para una sensacion consistente.
  function aplicarSnap(px: number, py: number): { x: number; y: number } {
    const { snapActivo, plantillas, plantaActivaId } = vistaStore.getState();
    if (!snapActivo) return { x: px, y: py };

    // (1) DXF: punto notable del calco visible de la planta activa dentro del radio.
    const puntosDxf = puntosSnapMemo(plantillas, plantaActivaId);
    const p = engancharAPuntoExtra(px, py, puntosDxf, RADIO_IMAN_M);
    if (p !== null) return { x: p.x, y: p.y };

    // (2) Rejilla.
    return snapARejilla(px, py);
  }

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const { x, y } = aplicarSnap(e.point.x, e.point.y);
    moverMarcador(x, y);
  };

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const { x, y } = aplicarSnap(e.point.x, e.point.y);

    const { defaultsPilar } = vistaStore.getState();
    // Sin seccion/material no se puede crear un pilar valido: no colocar (la Fase 4
    // garantiza que la herramienta fije defaults antes de habilitar el clic).
    if (!defaultsPilar.seccionId || !defaultsPilar.materialId) {
      if (import.meta.env.DEV) {
        console.warn(
          "[ColocacionPilar] sin seccion/material por defecto: clic ignorado.",
        );
      }
      return;
    }

    const tramo = tramoDelGrupoActivo();
    if (!tramo) {
      if (import.meta.env.DEV) {
        console.warn(
          "[ColocacionPilar] sin grupo/planta activos: no hay tramo para el pilar.",
        );
      }
      return;
    }

    const datos: DatosPilar = {
      x,
      y,
      plantaInicial: tramo.plantaInicial,
      plantaFinal: tramo.plantaFinal,
      seccionId: defaultsPilar.seccionId,
      materialId: defaultsPilar.materialId,
      angulo: defaultsPilar.angulo,
      vinculacionExterior: defaultsPilar.vinculacionExterior,
      arranque: defaultsPilar.arranque,
    };

    // Leer el modelo JUSTO antes de construir el comando (invariante del `base`:
    // el comando debe nacer contra el modelo actual del store).
    const base = modeloStore.getState().getModelo();
    const comando = crearPilar(base, datos);
    modeloStore.getState().ejecutar(comando);
    invalidate();
  };

  // Al entrar en la herramienta, limpia la seleccion: el InspectorPilar (que se
  // muestra al haber un pilar seleccionado) NO debe convivir con el panel de
  // creacion. Mientras colocas, no hay panel de edicion abierto (endurecimiento del
  // review de ingenieria). Se ejecuta una vez al montar (= al entrar en modo pilar).
  useEffect(() => {
    seleccionStore.getState().limpiar();
  }, []);

  // Esc termina la herramienta. Listener vivo solo mientras el modo esta activo.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        vistaStore.getState().setHerramienta("seleccion");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <group>
      {/* Plano de captura propio: gemelo de PlanoCoords, dedicado a la herramienta.
          No detiene la propagacion en move (deja que coordsBus siga emitiendo desde
          PlanoCoords). En click si detiene para no caer en seleccion de fondo. */}
      <mesh ref={refPlano} position={[0, 0, 0]} onPointerMove={onMove} onClick={onClick} renderOrder={5}>
        <planeGeometry args={[1000, 1000]} />
        <meshBasicMaterial visible={false} transparent opacity={0} depthWrite={false} />
      </mesh>
      <MarcadorFantasma refGrupo={refMarcador} />
    </group>
  );
}

// Raiz: monta la interaccion solo en modo "pilar". El cambio de herramienta es el
// unico disparador de (des)montaje; nunca se re-renderiza por frame.
export function ColocacionPilar() {
  const activo = useHerramientaPilar();
  if (!activo) return null;
  return <ColocacionActiva />;
}
