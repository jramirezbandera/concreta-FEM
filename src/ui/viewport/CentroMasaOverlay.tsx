// CentroMasaOverlay: marcador del Centro de Masas (CM) de la planta activa como
// sceneOverlay del viewport (F2.4, D-diseño-1/5). Marcador CRUZ-EN-CIRCULO (⊕):
// un circulo + una cruz, en color del token --centro-masa (cerise, hue distinto del
// mapa semantico de elementos). Legible POR FORMA (no solo color: colorblind-safe);
// la etiqueta mono con coords/peso vive en el PanelCentroMasa (HUD HTML) asociado.
//
// VISIBILIDAD (D-diseño-1): solo cuando el toggle del CM esta encendido Y la vista es
// planta (useCentroMasaVisible). En 3D/mosaico no se dibuja (el CM es ayuda de planta).
// Si la planta no tiene masa (cm===null), no se pinta marcador (el panel muestra
// "Sin masa en esta planta").
//
// COORDENADAS (Z-up): el CM viene en sistema de obra (x,y). Se situa en [x, y, cota]
// igual que la geometria de obra en GeometriaModelo (pilares/vigas en [cx,cy,cota]).
// NO se usa mapearEjes (que va planta->FEM): aqui la escena lee directo el (x,y) de
// obra como (X,Y) y la cota como Z. Un epsilon en Z lo deja SOBRE el forjado para que
// no quede ocluido en vista cenital.
//
// RENDIMIENTO (regla #11): el CM se memoiza en useCentroMasa (recompute solo al editar
// la obra / cambiar de planta, nunca por frame). Aqui no hay useFrame: el marcador es
// estatico; invalidate() pinta un frame al cambiar (frameloop="demand").
import { useEffect, useMemo } from "react";
import { invalidate } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import { hexToken } from "./colores";
import { useCentroMasa, useCentroMasaVisible } from "./useCentroMasa";

// Radio del circulo (m) y semibrazo de la cruz (un poco mayor que el radio para que
// los brazos sobresalgan, reforzando la forma ⊕). Epsilon en Z sobre el forjado.
const RADIO = 0.35;
const BRAZO = 0.5;
const Z_EPS = 0.05;
// Nº de segmentos del circulo (poligono regular cerrado).
const SEGMENTOS = 48;

// Puntos de un circulo cerrado en el plano XY centrado en el origen (lo posiciona el
// group). Cerrado = primer punto repetido al final.
function puntosCirculo(radio: number): [number, number, number][] {
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= SEGMENTOS; i++) {
    const a = (i / SEGMENTOS) * Math.PI * 2;
    pts.push([Math.cos(a) * radio, Math.sin(a) * radio, 0]);
  }
  return pts;
}

export function CentroMasaOverlay() {
  const visible = useCentroMasaVisible();
  const { cm, cota } = useCentroMasa();
  const color = useMemo(() => hexToken("centroMasa"), []);
  const circulo = useMemo(() => puntosCirculo(RADIO), []);
  // Cruz: dos segmentos (horizontal y vertical) que sobresalen del circulo.
  const cruzH = useMemo<[number, number, number][]>(
    () => [
      [-BRAZO, 0, 0],
      [BRAZO, 0, 0],
    ],
    [],
  );
  const cruzV = useMemo<[number, number, number][]>(
    () => [
      [0, -BRAZO, 0],
      [0, BRAZO, 0],
    ],
    [],
  );

  // Pinta un frame al cambiar visibilidad/posicion (frameloop="demand").
  useEffect(() => {
    invalidate();
  }, [visible, cm, cota]);

  // Oculto si: el toggle/vista no lo permiten, no hay planta con cota, o la planta no
  // tiene masa (cm===null). El panel HUD se encarga del estado "Sin masa".
  if (!visible || cm === null || cota === null) return null;

  return (
    <group position={[cm.x, cm.y, cota + Z_EPS]}>
      <Line points={circulo} color={color} lineWidth={2} />
      <Line points={cruzH} color={color} lineWidth={2} />
      <Line points={cruzV} color={color} lineWidth={2} />
    </group>
  );
}
