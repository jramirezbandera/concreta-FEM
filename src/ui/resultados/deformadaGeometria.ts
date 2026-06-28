// deformadaGeometria: proyeccion PURA de la deformada (una POLILINEA flectada por
// member) al espacio de ESCENA del viewport. SIN React/R3F/three: testeable en Node.
//
// CONVENCION DE EJES (critica para que la deformada se superponga a la obra): FEM es
// Y-up y la escena Z-up; la transformacion FEM->escena (intercambio Y<->Z, en posicion
// y en desplazamiento) vive centralizada en ../viewport/ejesEscena (helper compartido).
//
// FLECHA DEL VANO (feature-14 Fase 2): el motor devuelve, por barra y combo, el
// desplazamiento GLOBAL en N estaciones uniformes (`deformada_global`, ejes FEM,
// mismo sistema que nodos[].disp). Dibujamos esa POLILINEA: cada estacion k se ancla
// a su posicion BASE (interpolacion lineal entre nudo i y nudo j de la barra recta) y
// se desplaza por su disp. Asi una viga que flecta se ve curvada, no recta. Si
// faltara `deformada_global` (no deberia tras Fase 1), caemos al segmento de 2
// extremos usando nodos[i]/[j].disp.
//
// NO reimplementa FEM: solo dibuja lo que el motor devolvio (posicion base + su
// desplazamiento escalado). El color por magnitud lo decide la UI a partir de `mags`
// (modulo del desplazamiento por estacion, en m).
import type { ModeloFEM } from "../../discretizador";
import type { ResultadosCalculo } from "../../solver";
import { puntoFemDesplazadoAEscena } from "../viewport/ejesEscena";

// Un punto en coordenadas de ESCENA (Z-up), listo para three.js.
export type PuntoEscena = [number, number, number];

// La deformada de UNA barra como polilinea: N puntos ya desplazados (escena) y la
// magnitud del desplazamiento (m) en cada punto, para colorear con la rampa.
export interface PolilineaDeformada {
  puntos: PuntoEscena[];
  mags: number[]; // |disp| por estacion (m), alineado con `puntos`
}

export interface GeometriaDeformada {
  polilineas: PolilineaDeformada[];
  // Rango de magnitud (m) sobre TODAS las estaciones producidas: alimenta la leyenda
  // y la normalizacion del color. Si no hay polilineas, ambos son 0.
  magMin: number;
  magMax: number;
}

// Lleva un punto base FEM (con su desplazamiento) al espacio de escena aplicando el
// factor de amplificacion. Devuelve el punto y el modulo del desplazamiento REAL (sin
// escalar: la magnitud fisica que se rotula en la leyenda).
function puntoDesplazado(
  baseX: number,
  baseY: number,
  baseZ: number,
  dx: number,
  dy: number,
  dz: number,
  escala: number,
): { p: PuntoEscena; mag: number } {
  // Magnitud fisica del desplazamiento (m), independiente del factor de dibujo.
  const mag = Math.hypot(dx, dy, dz);
  // FEM (Y-up) -> escena (Z-up): intercambio Y<->Z, tanto en posicion como en disp.
  const p = puntoFemDesplazadoAEscena(baseX, baseY, baseZ, dx, dy, dz, escala);
  return { p, mag };
}

// Construye la geometria de la deformada para una combinacion y factor de escala.
// Maneja con gracia: resultados null, combo inexistente, member que referencia un
// nodo ausente (salta ese member). Nunca lanza.
export function deformadaGeometria(
  modeloFEM: ModeloFEM | null,
  resultados: ResultadosCalculo | null,
  combo: string | null,
  escala: number,
): GeometriaDeformada {
  const vacio: GeometriaDeformada = { polilineas: [], magMin: 0, magMax: 0 };
  if (!modeloFEM || !resultados || !combo) return vacio;

  // Map nombre de nodo -> posicion base (FEM). Construido una vez (evita find O(N×M)).
  const nodoPorNombre = new Map(modeloFEM.nodes.map((n) => [n.name, n]));

  const polilineas: PolilineaDeformada[] = [];
  let magMin = Infinity;
  let magMax = 0;

  // Acumula un punto desplazado en la polilinea en curso y refresca el rango global.
  const empuja = (
    puntos: PuntoEscena[],
    mags: number[],
    base: { x: number; y: number; z: number },
    dx: number,
    dy: number,
    dz: number,
  ): void => {
    const { p, mag } = puntoDesplazado(base.x, base.y, base.z, dx, dy, dz, escala);
    puntos.push(p);
    mags.push(mag);
    magMin = Math.min(magMin, mag);
    magMax = Math.max(magMax, mag);
  };

  for (const member of modeloFEM.members) {
    const ni = nodoPorNombre.get(member.i);
    const nj = nodoPorNombre.get(member.j);
    if (!ni || !nj) continue; // referencia rota: se omite (no deberia ocurrir)

    const puntos: PuntoEscena[] = [];
    const mags: number[] = [];

    // Ruta principal (Fase 2): polilinea flectada desde la deformada global de la
    // barra. La posicion BASE de cada estacion es la interpolacion lineal a lo largo
    // de la barra recta i->j; el disp lo da el motor por estacion.
    const def = resultados.barras[member.name]?.[combo]?.deformada_global;
    if (def && def[0] && def[1] && def[2] && def[0].length >= 2) {
      const [dxs, dys, dzs] = def as [number[], number[], number[]];
      const n = dxs.length;
      for (let k = 0; k < n; k++) {
        const t = n > 1 ? k / (n - 1) : 0; // parametro [0,1] a lo largo de la barra
        const baseK = {
          x: ni.x + t * (nj.x - ni.x),
          y: ni.y + t * (nj.y - ni.y),
          z: ni.z + t * (nj.z - ni.z),
        };
        empuja(puntos, mags, baseK, dxs[k] ?? 0, dys[k] ?? 0, dzs[k] ?? 0);
      }
    } else {
      // FALLBACK seguro: sin deformada_global, polilinea de 2 puntos con el disp de
      // los nudos extremo (comportamiento previo a Fase 1). No lanza.
      const resI = resultados.nodos[member.i]?.[combo];
      const resJ = resultados.nodos[member.j]?.[combo];
      if (!resI || !resJ) continue; // sin resultados para este combo: se omite
      const [dxi, dyi, dzi] = resI.disp;
      const [dxj, dyj, dzj] = resJ.disp;
      empuja(puntos, mags, ni, dxi ?? 0, dyi ?? 0, dzi ?? 0);
      empuja(puntos, mags, nj, dxj ?? 0, dyj ?? 0, dzj ?? 0);
    }

    if (puntos.length >= 2) polilineas.push({ puntos, mags });
  }

  if (polilineas.length === 0) return vacio;
  return { polilineas, magMin: magMin === Infinity ? 0 : magMin, magMax };
}
