/**
 * El área capaz de las vigas de un pórtico (CO6, `docs/fem3d/comprobaciones.md` §8.24): lo que resiste
 * cada sección a lo largo del pórtico con las barras del despiece que hay en ella, para dibujarlo con
 * la envolvente de ELU y ver que la solicitación nunca pasa de lo resistido (como el «área capaz» de
 * CYPECAD). Por esfuerzo:
 *
 *  - **My:** MRd con la tracción abajo (positivo) y con la tracción arriba (negativo, con su signo). El
 *    juez es el mismo que el de la comprobación: `solveAtULU` del módulo de vigas de Concreta
 *    (parábola-rectángulo y pivotes, con la armadura comprimida). En una sección con las barras de la
 *    zona del armado da el MRd de su fila «bending» bit a bit.
 *  - **Vz:** VRd de los cercos que hay en la sección (`calcRcShear` del módulo, política de viga: con
 *    cercos, min(VRd,s, VRd,max); sin ellos, VRd,c), el menor de las dos caras traccionadas.
 *  - **T:** TRd = min(TRd,s, TRd,max) de los cercos de la sección (CE A19 §6.3.2: TRd,s =
 *    2·Ak·(Asw/s)·fyd·cot θ, por rama exterior), torsión sola: la interacción con el cortante la mira
 *    la comprobación (`torsion.ts`).
 *
 * Qué armadura hay en cada x: la de las barras del despiece (`despieceVigas.ts`), que sólo cuenta entera
 * donde está anclada. Desde cada punta, crece lineal a lo largo de su anclaje básico `lb,rqd` (el del
 * despiece, por vano, diámetro y posición), o de 0,7·lb con una patilla, que ya cuenta lo que mide
 * (como coloca las barras el despiece: anclada a la cara del apoyo, o al fin de la zona más el
 * decalaje). Las de piel no cuentan a flexión (tampoco en la comprobación). Los cercos, los del tramo
 * de cercos del despiece en esa x (antes del primero, los del tramo más cercano).
 *
 * En los vanos (de cara a cara de sus apoyos), y en los de hormigón rectangular. Dentro de cada apoyo
 * (§8.26), sólo My y aparte (`MyApoyos`): el MRd de la sección de la viga con las barras que lo
 * atraviesan, para ver que la armadura de la cara sigue entera dentro de él. Allí no es una
 * comprobación: la viga se comprueba en la cara (CE A19 §5.3.2.2(3)) y la envolvente de dentro es la
 * del modelo de barras, con la reacción concentrada en el eje.
 *
 * Puro: lo que se comprueba no cambia; es otra forma de enseñarlo. Unidades: x en m del pórtico, kN y
 * kN·m.
 */
import { getConcrete, getFyd } from "./concreta/data/materials.ts";
import { getBarArea } from "./concreta/data/rebar.ts";
import { calcRcShear, type SectionInputs } from "./concreta/lib/calculations/rcBeams.ts";
import { solveAtULU } from "./concreta/lib/calculations/rcBeamsSection.ts";
import { ramasDe, type CercosViga } from "./armado.ts";
import { ANCLAJE_CON_PATILLA, type BarraDespiece, type DatosDespiece, type DespiecePortico } from "./despieceVigas.ts";
import type { Portico, VanoPortico } from "./porticos.ts";
import { torsionRC } from "./comprobar/torsion.ts";

/** Un punto del área capaz: la x del pórtico (m) y lo que resiste a cada lado del cero. */
export interface PuntoCapacidad {
  x: number;
  /** Positivo: MRd con la tracción abajo, VRd, TRd. */
  max: number;
  /** Negativo: −MRd con la tracción arriba, −VRd, −TRd. */
  min: number;
}

/**
 * El área capaz de un pórtico por esfuerzo: por vano, sus puntos de izquierda a derecha (un escalón,
 * dos puntos en la misma x). `MyApoyos`: el MRd dentro de cada apoyo con vigas armadas a algún lado,
 * de cara a cara.
 */
export interface CapacidadPortico {
  My: PuntoCapacidad[][];
  Vz: PuntoCapacidad[][];
  T: PuntoCapacidad[][];
  MyApoyos: PuntoCapacidad[][];
}

/** Las rampas de anclaje se parten en esto para dibujarlas (MRd no es del todo lineal en As). */
const PASOS_RAMPA = 4;
/** Un escalón: el valor justo antes y justo después de esta x, m. */
const EPS = 1e-6;

interface Seccion {
  /** mm² y el mayor Ø de cada cara (para su canto útil). */
  inf: number;
  sup: number;
  oInf: number;
  oSup: number;
  cercos: CercosViga | null;
}

/** La parte de una barra que cuenta en x: 0 fuera de ella; 1 donde está anclada; lineal en su anclaje desde cada punta. */
function parteBarra(b: BarraDespiece, x: number, lb: (x: number) => number): number {
  const [a, c] = b.x;
  if (x < a - 1e-9 || x > c + 1e-9) return 0;
  let f = 1;
  for (const [punta, patilla, dist] of [
    [a, b.patillas[0], x - a],
    [c, b.patillas[1], c - x],
  ] as const) {
    const L = lb(punta);
    if (!(L > 0)) continue;
    // Con patilla, el anclaje es 0,7·lb y la patilla ya cuenta lo que mide (como la coloca el despiece)
    const g = patilla > 0 ? (patilla + Math.max(dist, 0)) / (ANCLAJE_CON_PATILLA * L) : Math.max(dist, 0) / L;
    f = Math.min(f, g);
  }
  return Math.max(0, Math.min(1, f));
}

/** El área capaz de un pórtico con su despiece (el de `despiecePortico` con el armado que se dibuja). */
export function capacidadPortico(p: Portico, d: DespiecePortico, datos: DatosDespiece): CapacidadPortico {
  const r: CapacidadPortico = { My: [], Vz: [], T: [], MyApoyos: [] };
  const fyk = datos.fyk ?? 500;
  const fyd = getFyd(fyk);
  const vanoEn = (x: number): VanoPortico => p.vanos.reduce((m, v) => (dist(v, x) < dist(m, x) ? v : m), p.vanos[0]!);
  const dist = (v: VanoPortico, x: number) => (x < v.desde ? v.desde - x : x > v.hasta ? x - v.hasta : 0);
  const lbDe = (b: BarraDespiece) => (x: number) => {
    const t = datos.anclajes[vanoEn(x).clave]?.[b.diametro];
    const sup = b.cara !== "inferior";
    return t ? t[sup ? 1 : 0] : ((sup ? 60 : 40) * b.diametro) / 1000;
  };
  const barras = d.barras.filter((b) => b.cara !== "piel").map((b) => ({ b, lb: lbDe(b) }));

  const seccionEn = (x: number): Seccion => {
    const s: Seccion = { inf: 0, sup: 0, oInf: 0, oSup: 0, cercos: null };
    for (const { b, lb } of barras) {
      const f = parteBarra(b, x, lb);
      if (!(f > 0)) continue;
      const A = f * b.n * getBarArea(b.diametro);
      if (b.cara === "inferior") [s.inf, s.oInf] = [s.inf + A, Math.max(s.oInf, b.diametro)];
      else [s.sup, s.oSup] = [s.sup + A, Math.max(s.oSup, b.diametro)];
    }
    // Los cercos del tramo que la cubre; si ninguno (antes del primer cerco), los del más cercano
    let mejor: { c: CercosViga; e: number } | null = null;
    for (const c of d.cercos) {
      const e = x < c.x[0] ? c.x[0] - x : x > c.x[1] ? x - c.x[1] : 0;
      if (!mejor || e < mejor.e - 1e-12) mejor = { c: c.cercos, e };
    }
    s.cercos = mejor && mejor.e < 0.5 ? mejor.c : null;
    return s;
  };

  /** El área capaz entre `desde` y `hasta` con la sección del vano `v` (un vano entero, o el ancho de un apoyo). */
  const tramo = (v: VanoPortico, desde: number, hasta: number): Record<"My" | "Vz" | "T", PuntoCapacidad[]> | null => {
    const g = v.geometria;
    if (!g || !(hasta > desde)) return null;
    const mat = getConcrete(g.fck);
    // Las x donde algo cambia: las puntas y los fines de anclaje de las barras, los tramos de cercos y los bordes del tramo
    const xs = new Set<number>([desde, hasta]);
    const escalones = new Set<number>();
    const dentro = (x: number) => x > desde + EPS && x < hasta - EPS;
    for (const { b, lb } of barras) {
      const [a, c] = b.x;
      if (c < desde || a > hasta) continue;
      for (const [punta, patilla, sentido] of [
        [a, b.patillas[0], 1],
        [c, b.patillas[1], -1],
      ] as const) {
        const L = lb(punta);
        const largo = patilla > 0 ? Math.max(ANCLAJE_CON_PATILLA * L - patilla, 0) : L;
        const fin = punta + sentido * Math.min(largo, (c - a) / 2);
        for (let k = 0; k <= PASOS_RAMPA; k++) {
          const x = punta + ((fin - punta) * k) / PASOS_RAMPA;
          if (dentro(x)) xs.add(x);
        }
        // Una barra con patilla ya cuenta algo en su punta: escalón
        if (patilla > 0 && dentro(punta)) escalones.add(punta);
      }
    }
    // Entre dos tramos de cercos, el cambio va a mitad del hueco (donde cambia el más cercano, `seccionEn`)
    const tramos = [...d.cercos].sort((a, b) => a.x[0] - b.x[0]);
    for (let i = 0; i + 1 < tramos.length; i++) {
      const x = (tramos[i]!.x[1] + tramos[i + 1]!.x[0]) / 2;
      if (dentro(x)) escalones.add(x);
    }
    const orden = [...xs, ...escalones].sort((a, b) => a - b);
    const puntos: number[] = [];
    for (const x of orden) {
      if (puntos.length && Math.abs(x - puntos[puntos.length - 1]!) < 1e-9) continue;
      if (escalones.has(x)) puntos.push(x - EPS, x + EPS);
      else puntos.push(x);
    }

    const M: PuntoCapacidad[] = [];
    const V: PuntoCapacidad[] = [];
    const T: PuntoCapacidad[] = [];
    for (const x of puntos) {
      const s = seccionEn(Math.min(Math.max(x, desde), hasta));
      const c = s.cercos;
      const oc = c?.diametro ?? 8;
      const mrd = (As: number, o: number, Ac: number, oc2: number) => {
        if (!(As > 0)) return 0;
        const inp: SectionInputs = {
          b: g.b,
          h: g.h,
          cover: datos.recubrimiento,
          stirrupDiam: oc,
          stirrupLegs: c ? ramasDe(c) : 2,
          fck: g.fck,
          fyk,
          exposureClass: "XC2",
          Md: 0,
          VEd: 0,
          Ms: 0,
          nBars: As / getBarArea(o),
          barDiam: o,
          nBarsComp: Ac > 0 ? Ac / getBarArea(oc2) : 0,
          barDiamComp: oc2 || o,
          stirrupSpacing: c?.separacion ?? 0,
          bondClass: "good",
        };
        const m = solveAtULU(inp, mat).M_kNm;
        return Number.isFinite(m) && m > 0 ? m : 0;
      };
      M.push({ x, max: mrd(s.inf, s.oInf || 12, s.sup, s.oSup), min: -mrd(s.sup, s.oSup || 12, s.inf, s.oInf) });
      // Cortante: el menor de las dos caras traccionadas (cambia ρl y el canto útil)
      const Asw = c && c.separacion > 0 ? (ramasDe(c) * getBarArea(c.diametro)) / c.separacion : 0;
      const vrd = (As: number, o: number) => calcRcShear({ b: g.b, d: g.h - datos.recubrimiento - oc - (o || 12) / 2, fck: g.fck, fcd: mat.fcd, fyd, As, Asw, hasStirrups: Asw > 0, sigmaCp: 0 }).VRd;
      const VRd = Math.max(0, Math.min(vrd(s.inf, s.oInf), vrd(s.sup, s.oSup)));
      V.push({ x, max: VRd, min: -VRd });
      const t = torsionRC({ b: g.b, h: g.h, fck: g.fck, fyk, cPrima: datos.recubrimiento + oc + Math.max(s.oInf, s.oSup, 12) / 2 });
      const TRds = t && c && c.separacion > 0 ? (2 * t.Ak * (getBarArea(c.diametro) / c.separacion) * t.fyd * t.cotTheta) / 1e6 : 0;
      const TRd = t ? Math.min(TRds, t.TRdMax) : 0;
      T.push({ x, max: TRd, min: -TRd });
    }
    return { My: M, Vz: V, T };
  };

  for (const v of p.vanos) {
    const t = tramo(v, v.desde, v.hasta);
    if (!t) continue;
    r.My.push(t.My);
    r.Vz.push(t.Vz);
    r.T.push(t.T);
  }
  // Dentro de cada apoyo, con la sección del vano de un lado (el de la izquierda, si lo hay)
  p.apoyos.forEach((a, i) => {
    const v = p.vanos.find((x) => x.apoyos[1] === i && x.geometria) ?? p.vanos.find((x) => x.apoyos[0] === i && x.geometria);
    const t = v && tramo(v, a.caras[0], a.caras[1]);
    if (t) r.MyApoyos.push(t.My);
  });
  return r;
}

/** Lo que resiste una curva del área capaz en x (interpolado; en un escalón, el menor de los dos lados); null fuera de ella. */
export function capacidadEn(ts: readonly (readonly PuntoCapacidad[])[], x: number): { max: number; min: number } | null {
  let r: { max: number; min: number } | null = null;
  for (const t of ts) {
    for (let i = 0; i + 1 < t.length; i++) {
      const [a, b] = [t[i]!, t[i + 1]!];
      if (x < a.x - 1e-9 || x > b.x + 1e-9) continue;
      const f = b.x - a.x > 1e-12 ? Math.min(Math.max((x - a.x) / (b.x - a.x), 0), 1) : 0;
      const q = { max: a.max + f * (b.max - a.max), min: a.min + f * (b.min - a.min) };
      r = r ? { max: Math.min(r.max, q.max), min: Math.max(r.min, q.min) } : q;
    }
  }
  return r;
}
