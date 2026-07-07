// EsfuerzosOverlay: dibuja los diagramas de esfuerzos (N/V/M, una magnitud a la
// vez) sobre TODAS las barras de la escena, estilo SAP2000/CYPE: cinta rellena +
// contorno levantados en el eje local y de cada barra, color por signo, y rotulos
// de pico (max/min) por ELEMENTO DE OBRA. sceneOverlay del viewport (lo monta
// App.tsx en la pestana Resultados).
//
// RENDIMIENTO (reglas #11, igual que DeformadaOverlay):
//  - Stores leidos con useSyncExternalStore + snapshot cacheado; la geometria/buffers
//    se RECONSTRUYEN solo al cambiar las entradas (useMemo), nunca por frame.
//  - Sin animacion: no hay useFrame propio; se invalida un frame al reconstruir.
//  - Todo el relleno va en UN Mesh y todo el contorno en UN LineSegments (2 draw
//    calls); los rotulos son drei <Text> (troika) dentro de <Billboard> (se orientan
//    a camara en los frames que OrbitControls ya invalida).
//  - onSync de cada Text invalida un frame: troika sincroniza el SDF en asincrono y
//    con frameloop="demand" el rotulo apareceria en blanco hasta el frame siguiente.
//
// SIN jerga FEM en lo visible: los rotulos son valores con unidad ("-42.3 kN·m"),
// nunca nombres de member/nodo.
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { invalidate } from "@react-three/fiber";
import { Billboard, Text } from "@react-three/drei";
import { BufferGeometry, DoubleSide, Float32BufferAttribute } from "three";
import { resultadosStore, vistaStore } from "../../estado";
import type { MagnitudEsfuerzo, ModoVista, OverlayResultados } from "../../estado";
import type { ModeloFEM, Trazabilidad } from "../../discretizador";
import type { ResultadosCalculo } from "../../solver";
import { hexToken } from "../viewport/colores";
import { COLOR_OBSOLETO } from "./deformadaBuffers";
import { esfuerzosGeometria } from "./esfuerzosGeometria";
import { escalaBaseEsfuerzos } from "./esfuerzosEscala";
import { construirBuffersEsfuerzos } from "./esfuerzosBuffers";
import { picosEsfuerzos } from "./picosEsfuerzos";

// Tamano del texto de pico en metros de MUNDO (mismo criterio que RotulosElemento:
// escala con el zoom como el resto del dibujo, comportamiento CAD esperado).
const TAM_TEXTO_M = 0.24;
// Separacion del rotulo respecto de la curva del diagrama (m de mundo), en la
// direccion de la ordenada y hacia el lado del signo (no pisa la cinta).
const MARGEN_PICO_M = 0.3;
// Opacidad de la cinta: translucida para que la obra siga leyendose debajo.
const OPACIDAD_CINTA = 0.35;

// Entradas que disparan la reconstruccion (no por frame).
interface Entradas {
  resultados: ResultadosCalculo | null;
  modeloFEM: ModeloFEM | null;
  trazabilidad: Trazabilidad | null;
  vigente: boolean;
  combo: string | null;
  magnitud: MagnitudEsfuerzo;
  // Multiplicador RELATIVO del usuario sobre la escala base (vistaStore).
  multiplicador: number;
  // La escena de esfuerzos es 3D (como la deformada): en planta la geometria esta
  // filtrada por planta y los diagramas del edificio entero se descuadrarian.
  modoVista: ModoVista;
  // [D9] Exclusion mutua: solo se dibuja si el overlay activo es "esfuerzos".
  overlay: OverlayResultados;
}

let snapCache: Entradas = leerEntradas();
function leerEntradas(): Entradas {
  const r = resultadosStore.getState();
  const v = vistaStore.getState();
  return {
    resultados: r.resultados,
    modeloFEM: r.modeloFEM,
    trazabilidad: r.trazabilidad,
    vigente: r.vigente,
    combo: v.combinacionActiva,
    magnitud: v.magnitudEsfuerzo,
    multiplicador: v.esfuerzosEscala,
    modoVista: v.modoVista,
    overlay: v.overlayResultados,
  };
}
function getSnapshot(): Entradas {
  const a = leerEntradas();
  const c = snapCache;
  if (
    a.resultados === c.resultados &&
    a.modeloFEM === c.modeloFEM &&
    a.trazabilidad === c.trazabilidad &&
    a.vigente === c.vigente &&
    a.combo === c.combo &&
    a.magnitud === c.magnitud &&
    a.multiplicador === c.multiplicador &&
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
  const offT = resultadosStore.subscribe((s) => s.trazabilidad, cb);
  const offV = resultadosStore.subscribe((s) => s.vigente, cb);
  const offCombo = vistaStore.subscribe((s) => s.combinacionActiva, cb);
  const offMag = vistaStore.subscribe((s) => s.magnitudEsfuerzo, cb);
  const offEsc = vistaStore.subscribe((s) => s.esfuerzosEscala, cb);
  const offModo = vistaStore.subscribe((s) => s.modoVista, cb);
  const offOverlay = vistaStore.subscribe((s) => s.overlayResultados, cb);
  return () => {
    offR();
    offM();
    offT();
    offV();
    offCombo();
    offMag();
    offEsc();
    offModo();
    offOverlay();
  };
}
function useEntradas(): Entradas {
  return useSyncExternalStore(suscribir, getSnapshot, getSnapshot);
}

export function EsfuerzosOverlay() {
  const entradas = useEntradas();

  // Geometria pura (valores crudos, sin escala): cambia con resultados/combo/magnitud
  // pero NO con el slider (el multiplicador solo entra en los buffers).
  const geometria = useMemo(
    () =>
      esfuerzosGeometria(
        entradas.modeloFEM,
        entradas.resultados,
        entradas.combo,
        entradas.magnitud,
      ),
    [entradas.modeloFEM, entradas.resultados, entradas.combo, entradas.magnitud],
  );

  // Escala total de ordenadas: base automatica (~7% del bbox para el |v| maximo)
  // × multiplicador del usuario. DERIVADA aqui (no vive en el store): cambiar de
  // magnitud/combo reescala sola sin escrituras imperativas.
  const escalaTotal =
    escalaBaseEsfuerzos(entradas.modeloFEM, geometria.vMaxAbs) * entradas.multiplicador;

  const buffers = useMemo(
    () =>
      construirBuffersEsfuerzos({
        geometria,
        escalaTotal,
        vigente: entradas.vigente,
      }),
    [geometria, escalaTotal, entradas.vigente],
  );

  // BufferGeometries del relleno y el contorno (atributos position + color).
  const geoms = useMemo(() => {
    if (!buffers) return null;
    const relleno = new BufferGeometry();
    relleno.setAttribute("position", new Float32BufferAttribute(buffers.relleno.position, 3));
    relleno.setAttribute("color", new Float32BufferAttribute(buffers.relleno.color, 3));
    const contorno = new BufferGeometry();
    contorno.setAttribute(
      "position",
      new Float32BufferAttribute(buffers.contorno.position, 3),
    );
    contorno.setAttribute("color", new Float32BufferAttribute(buffers.contorno.color, 3));
    return { relleno, contorno };
  }, [buffers]);

  // Rotulos de pico por elemento de obra. Independientes de la escala (viajan con
  // base/ejeY/valor): mover el slider NO los recalcula, solo los reposiciona abajo.
  const picos = useMemo(
    () =>
      picosEsfuerzos(
        entradas.modeloFEM,
        entradas.resultados,
        entradas.trazabilidad,
        entradas.combo,
        entradas.magnitud,
      ),
    [
      entradas.modeloFEM,
      entradas.resultados,
      entradas.trazabilidad,
      entradas.combo,
      entradas.magnitud,
    ],
  );

  // Pinta un frame al reconstruir (frameloop="demand") y libera las geometrias.
  useEffect(() => {
    if (geoms) invalidate();
    return () => {
      geoms?.relleno.dispose();
      geoms?.contorno.dispose();
    };
  }, [geoms]);

  // Mismo gate que la deformada: cualquier vista plena (3D/alzados/mosaico), nunca
  // planta. [D9] Exclusion mutua con deformada/forma modal.
  if (!geoms || entradas.modoVista === "planta" || entradas.overlay !== "esfuerzos")
    return null;

  const colorPico = (signo: 1 | -1): string =>
    entradas.vigente
      ? hexToken(signo > 0 ? "esfuerzoPos" : "esfuerzoNeg")
      : `#${COLOR_OBSOLETO.getHexString()}`;

  return (
    <group>
      {/* Cinta rellena: translucida, sin escribir depth (no oculta la obra ni
          z-fightea con ella) y a doble cara (legible desde ambos lados). */}
      <mesh geometry={geoms.relleno} renderOrder={2}>
        <meshBasicMaterial
          vertexColors
          transparent
          opacity={OPACIDAD_CINTA}
          depthWrite={false}
          side={DoubleSide}
          toneMapped={false}
        />
      </mesh>
      <lineSegments geometry={geoms.contorno}>
        <lineBasicMaterial vertexColors toneMapped={false} />
      </lineSegments>
      {picos.map((p, i) => {
        // Posicion: la curva del diagrama en el pico + un margen hacia su lado.
        const h = p.valor * escalaTotal + p.signo * MARGEN_PICO_M;
        const pos: [number, number, number] = [
          p.base[0] + p.ejeY[0] * h,
          p.base[1] + p.ejeY[1] * h,
          p.base[2] + p.ejeY[2] * h,
        ];
        return (
          <Billboard key={`${p.elementoId}:${i}`} position={pos}>
            <Text
              fontSize={TAM_TEXTO_M}
              color={colorPico(p.signo)}
              anchorX="center"
              anchorY="middle"
              // No captura el puntero: el picking de la obra debe atravesarlo.
              raycast={() => null}
              // troika sincroniza en asincrono: sin esto el texto aparece en blanco
              // hasta el siguiente frame invalidado (frameloop="demand").
              onSync={() => invalidate()}
            >
              {p.texto}
            </Text>
          </Billboard>
        );
      })}
    </group>
  );
}
