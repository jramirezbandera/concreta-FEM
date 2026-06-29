// CentroRigidezOverlay: marcador del CENTRO DE RIGIDEZ (CR) de la planta activa como
// sceneOverlay del viewport (F2). Marcador ROMBO (◇) en color del token --centro-rigidez
// (teal), GLIFO DISTINTO del ⊕ del centro de masas: la forma (no solo el color) los
// diferencia (colorblind-safe), y la etiqueta mono con X/Y/excentricidad vive en el panel
// HUD (CentroRigidez) asociado.
//
// VALOR VISUAL DE LA FEATURE: si existen CM y CR de la planta, se dibuja ademas un
// SEGMENTO CM<->CR (la excentricidad estructural). Es lo que el arquitecto interpreta:
// cuanto se separa el centro de giro del centro de masas (base de la torsion).
//
// VISIBILIDAD: solo cuando el toggle del CR esta encendido Y la vista es planta
// (useCentroRigidezVisible). En 3D/mosaico no se dibuja (el CR es ayuda de planta). Si el
// CR de la planta activa es no determinable (x/y null) o no se ha calculado (cr===null),
// no se pinta marcador (el panel HUD se encarga del estado "no determinable" / "no calculado").
//
// COORDENADAS (Z-up): el CR viene en coords de OBRA (x,y). Se situa en [x, y, cota+eps]
// igual que el CM (CentroMasaOverlay) y la geometria de obra. NO se usa mapearEjes (que va
// planta->FEM): la escena lee directo el (x,y) de obra como (X,Y) y la cota como Z. Un
// epsilon en Z lo deja SOBRE el forjado para que no quede ocluido en vista cenital.
//
// RENDIMIENTO (regla #11): el CR se memoiza en useCentroRigidez (recompute solo al cambiar
// el CR calculado / la obra / la planta, nunca por frame). Aqui no hay useFrame: el
// marcador es estatico; invalidate() pinta un frame al cambiar (frameloop="demand").
import { useEffect, useMemo } from "react";
import { invalidate } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import { hexToken } from "./colores";
import { useCentroRigidez, useCentroRigidezVisible } from "./useCentroRigidez";

// Semidiagonal del rombo (m) y epsilon en Z sobre el forjado. El rombo es un cuadrado
// girado 45º: cuatro vertices sobre los ejes a distancia RADIO del centro.
const RADIO = 0.45;
const Z_EPS = 0.05;
// Opacidad del marcador cuando el CR esta OBSOLETO (vigente=false: la obra cambio tras el
// ultimo calculo). Se atenua (como la deformada gris) para no leer un CR viejo como actual.
const OPACIDAD_OBSOLETO = 0.3;

// Puntos de un rombo cerrado en el plano XY centrado en el origen (lo posiciona el
// group). Cerrado = primer vertice repetido al final.
function puntosRombo(radio: number): [number, number, number][] {
  return [
    [radio, 0, 0],
    [0, radio, 0],
    [-radio, 0, 0],
    [0, -radio, 0],
    [radio, 0, 0],
  ];
}

export function CentroRigidezOverlay() {
  const visible = useCentroRigidezVisible();
  const { cr, cota, vigente } = useCentroRigidez();
  const color = useMemo(() => hexToken("centroRigidez"), []);
  const rombo = useMemo(() => puntosRombo(RADIO), []);

  // Determinable: hay CR calculado para la planta Y no es "no determinable" (x/y no null).
  const determinable = cr !== null && cr.x !== null && cr.y !== null;

  // Segmento CM<->CR (excentricidad). Usa el CM "horneado" en el momento del calculo:
  // ex = CM.x - CR.x => CM = CR + (ex,ey). Reconstruirlo asi (en vez de un CM vivo) hace que
  // el segmento DIBUJADO coincida SIEMPRE con los ex/ey que muestra el panel, tambien con el
  // CR obsoleto tras editar la obra. Sin excentricidad (ex/ey null = sin masa) => sin segmento.
  const segmento = useMemo<[number, number, number][] | null>(() => {
    if (!determinable || cota === null || cr.ex === null || cr.ey === null) return null;
    const crx = cr.x as number;
    const cry = cr.y as number;
    return [
      [crx + cr.ex, cry + cr.ey, cota + Z_EPS],
      [crx, cry, cota + Z_EPS],
    ];
  }, [determinable, cr, cota]);

  // Pinta un frame al cambiar visibilidad/posicion/vigencia (frameloop="demand").
  useEffect(() => {
    invalidate();
  }, [visible, cr, cota, vigente]);

  // Oculto si: el toggle/vista no lo permiten, no hay planta con cota, o el CR de la
  // planta no es determinable. El panel HUD se encarga de los estados textuales.
  if (!visible || !determinable || cota === null) return null;

  // CR obsoleto -> marcador atenuado (no se lee un CR viejo como actual; el panel lo
  // etiqueta "(obsoleto)"). Vigente -> opaco.
  const opacidad = vigente ? 1 : OPACIDAD_OBSOLETO;

  return (
    <>
      {/* Segmento de excentricidad CM<->CR (si hay masa). Linea fina, mismo color. */}
      {segmento && (
        <Line
          points={segmento}
          color={color}
          lineWidth={1}
          transparent
          opacity={opacidad}
        />
      )}
      {/* Marcador rombo del CR, centrado en (cr.x, cr.y) a la cota de la planta. */}
      <group position={[cr.x as number, cr.y as number, cota + Z_EPS]}>
        <Line points={rombo} color={color} lineWidth={2} transparent opacity={opacidad} />
      </group>
    </>
  );
}
