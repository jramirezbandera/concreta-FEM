// esfuerzosGeometria: proyeccion PURA de los diagramas de esfuerzos (N/V/M) de TODAS
// las barras al espacio de ESCENA del viewport (estilo SAP2000/CYPE: el diagrama se
// dibuja sobre la propia barra). SIN React/R3F/three: testeable en Node.
//
// SIGNOS Y LADO (una sola convencion, vive en convencionEsfuerzos.ts): los valores
// crudos de PyNite se pasan a presentacion con SIGNO_UI (traccion +, vano +) y la
// ordenada de cada estacion es
//     c_k = base_k + ejeY·LADO_DIBUJO · (v_k^UI · escalaTotal)
// con ejeY el eje local y del member (ejesLocalesFEM, replica de Member3D.T()) ya
// multiplicado aqui por LADO_DIBUJO. Para el flector eso mantiene el dibujo del
// lado de las TRACCIONES (vano positivo hacia abajo, apoyos negativos hacia arriba)
// aunque el signo presentado sea el espanol. NO voltear signos en ningun otro punto.
//
// CRUCE POR CERO: se INSERTA el punto de corte interpolado (v=0) y el diagrama se
// parte en TRAMOS de signo homogeneo (partirEnTramosDeSigno). Asi la cinta rellena
// no se auto-interseca al cambiar de signo y el color por signo queda nitido.
//
// LIMITACION honesta (misma que PanelDiagramas): el contrato del solver solo trae
// shear_y/moment_z (plano local x-y); la flexion My/Vz de pilares es deuda del
// contrato, no de este overlay.
//
// La escala de ordenadas NO se aplica aqui: la geometria devuelve valores crudos
// (kN | kN·m) y vMaxAbs; los buffers aplican escalaTotal (m por kN) al construir.
import type { ModeloFEM } from "../../discretizador";
import type { ResultadosCalculo } from "../../solver";
import type { MagnitudEsfuerzo } from "../../estado";
import { femAEscena, dispFemAEscena, type Vec3Escena } from "../viewport/ejesEscena";
import { ejeLocalY } from "./ejesLocalesFEM";
import { SIGNO_UI, LADO_DIBUJO } from "./convencionEsfuerzos";

// Mapa magnitud de UI -> campo del contrato del solver (EstadoMiembroCombo).
// Exportado: lo reutiliza picosEsfuerzos (misma fuente para dibujo y rotulos).
export const CAMPO_POR_MAGNITUD = {
  axil: "axial",
  cortante: "shear_y",
  momento: "moment_z",
} as const satisfies Record<MagnitudEsfuerzo, "axial" | "shear_y" | "moment_z">;

// Unidad de presentacion por magnitud (los valores YA vienen en kN / kN·m del
// contrato; esto es solo el texto del rotulo/leyenda, sin conversion).
export const UNIDAD_POR_MAGNITUD: Record<MagnitudEsfuerzo, string> = {
  axil: "kN",
  cortante: "kN",
  momento: "kN·m",
};

// Umbral bajo el cual un diagrama se considera PLANO (cero numerico en kN): barras
// sin ese esfuerzo (p.ej. axil de una viga descargada axialmente) no dibujan cinta
// ni contorno (ruido invisible que solo costaria vertices).
const EPS_PLANO = 1e-12;

// Un tramo de signo homogeneo en coordenadas LOCALES del member (x desde i, m).
export interface TramoLocal {
  xs: number[];
  vs: number[];
  signo: 1 | -1;
}

// Un tramo ya proyectado a escena: puntos base sobre la barra + valores crudos.
export interface TramoSigno {
  bases: Vec3Escena[];
  valores: number[]; // kN | kN·m, alineado con `bases`
  signo: 1 | -1;
}

// El diagrama de UNA barra: eje de la ordenada (unitario, escena) + tramos.
export interface DiagramaMember {
  member: string; // nombre FEM (solo trazabilidad interna; la UI no lo rotula)
  ejeY: Vec3Escena;
  tramos: TramoSigno[];
}

export interface GeometriaEsfuerzos {
  diagramas: DiagramaMember[];
  // |v| maximo GLOBAL (kN | kN·m) sobre todas las barras del combo/magnitud:
  // alimenta la escala base de ordenadas y el "max |M|" de la leyenda.
  vMaxAbs: number;
}

// Parte un diagrama [xs, vs] en tramos de signo homogeneo, INSERTANDO el punto de
// corte (v=0, x interpolado linealmente) en cada cambio de signo. Tramos contiguos
// COMPARTEN el punto de corte (ultimo de uno = primero del siguiente). Los tramos
// totalmente planos (todo v=0) se descartan. Exportada para test.
export function partirEnTramosDeSigno(
  xs: readonly number[],
  vs: readonly number[],
): TramoLocal[] {
  const n = Math.min(xs.length, vs.length);
  if (n < 2) return [];

  const tramos: TramoLocal[] = [];
  let curXs: number[] = [xs[0]!];
  let curVs: number[] = [vs[0]!];
  let curSigno = Math.sign(vs[0]!); // -1 | 0 | 1 (0 = aun sin signo adoptado)

  const cerrar = (): void => {
    if (curSigno !== 0 && curXs.length >= 2) {
      tramos.push({ xs: curXs, vs: curVs, signo: curSigno as 1 | -1 });
    }
  };

  for (let k = 1; k < n; k++) {
    const x = xs[k]!;
    const v = vs[k]!;
    const s = Math.sign(v);
    if (s !== 0 && curSigno !== 0 && s !== curSigno) {
      // Cambio de signo entre k-1 y k: el corte es el ultimo punto si ya era 0, o
      // el interpolado lineal entre ambos valores si no.
      const xPrev = curXs[curXs.length - 1]!;
      const vPrev = curVs[curVs.length - 1]!;
      if (vPrev === 0) {
        cerrar();
        curXs = [xPrev];
        curVs = [0];
      } else {
        const f = Math.abs(vPrev) / (Math.abs(vPrev) + Math.abs(v));
        const xc = xPrev + (x - xPrev) * f;
        curXs.push(xc);
        curVs.push(0);
        cerrar();
        curXs = [xc];
        curVs = [0];
      }
      curSigno = s;
    } else if (curSigno === 0) {
      curSigno = s; // el tramo adopta el primer signo no nulo que aparece
    }
    curXs.push(x);
    curVs.push(v);
  }
  cerrar();
  return tramos;
}

// Construye la geometria de los diagramas de esfuerzos para una combinacion y
// magnitud. Maneja con gracia: resultados null, combo/diagrama inexistente, member
// con nodo ausente o degenerado (se omite). Nunca lanza.
export function esfuerzosGeometria(
  modeloFEM: ModeloFEM | null,
  resultados: ResultadosCalculo | null,
  combo: string | null,
  magnitud: MagnitudEsfuerzo,
): GeometriaEsfuerzos {
  const vacio: GeometriaEsfuerzos = { diagramas: [], vMaxAbs: 0 };
  if (!modeloFEM || !resultados || !combo) return vacio;

  const campo = CAMPO_POR_MAGNITUD[magnitud];
  // Map nombre de nodo -> posicion (FEM). Construido una vez (evita find O(N×M)).
  const nodoPorNombre = new Map(modeloFEM.nodes.map((n) => [n.name, n]));

  const diagramas: DiagramaMember[] = [];
  let vMaxAbs = 0;

  for (const member of modeloFEM.members) {
    const ni = nodoPorNombre.get(member.i);
    const nj = nodoPorNombre.get(member.j);
    if (!ni || !nj) continue; // referencia rota: se omite (no deberia ocurrir)

    const diagrama = resultados.barras[member.name]?.[combo]?.[campo];
    if (!diagrama) continue; // sin resultados para este combo: se omite
    const [xs, crudos] = diagrama;
    if (!xs || !crudos || xs.length < 2) continue;
    // Crudo PyNite -> signo de presentacion (traccion +, vano +), UNICO flip.
    // `v === 0 ? 0 : -v` evita el -0 de JS (ruido en datos y en asserts).
    const signoUI = SIGNO_UI[campo];
    const vs = signoUI === 1 ? crudos : crudos.map((v) => (v === 0 ? 0 : -v));

    // El maximo del member SIEMPRE alimenta el global (aunque el diagrama sea plano).
    let maxAbsMember = 0;
    for (const v of vs) {
      const a = Math.abs(v);
      if (a > maxAbsMember) maxAbsMember = a;
    }
    vMaxAbs = Math.max(vMaxAbs, maxAbsMember);
    if (maxAbsMember <= EPS_PLANO) continue; // plano: nada que dibujar

    const ejeYFem = ejeLocalY(ni, nj, member.rotation);
    if (!ejeYFem) continue; // barra degenerada (L≈0): se omite

    // Posicion base de cada estacion: interpolacion lineal i->j con t = x/L, donde L
    // es la ULTIMA x del diagrama (los *_array() muestrean 0..L; normalizar por ella
    // hace el dibujo robusto a discrepancias minimas con la L geometrica).
    const L = xs[xs.length - 1]!;
    const base = (x: number): Vec3Escena => {
      const t = L > 0 ? x / L : 0;
      return femAEscena(
        ni.x + t * (nj.x - ni.x),
        ni.y + t * (nj.y - ni.y),
        ni.z + t * (nj.z - ni.z),
      );
    };

    const tramos: TramoSigno[] = partirEnTramosDeSigno(xs, vs).map((t) => ({
      bases: t.xs.map(base),
      valores: t.vs,
      signo: t.signo,
    }));
    if (tramos.length === 0) continue;

    // El eje local y es un VECTOR (direccion): mismo intercambio Y<->Z que un
    // desplazamiento, sin cota base. LADO_DIBUJO mantiene el flector del lado de
    // las tracciones con el signo de presentacion volteado (convencionEsfuerzos).
    // El `+ 0` normaliza el -0 de JS (0 × -1) a +0.
    const lado = LADO_DIBUJO[magnitud];
    diagramas.push({
      member: member.name,
      ejeY: dispFemAEscena(
        ejeYFem[0] * lado + 0,
        ejeYFem[1] * lado + 0,
        ejeYFem[2] * lado + 0,
      ),
      tramos,
    });
  }

  return { diagramas, vMaxAbs };
}
