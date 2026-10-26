/**
 * La geometría de `aplanarDxf` frente a la de ezdxf (`validacion/v2c4/oraculo_dxf.py`), criterio 1
 * de V2c-4 (`docs/fem3d/dibujo.md` §10.4):
 * - segmentos rectos y puntos para enganchar, uno a uno (en cualquier orden y sentido) a ≤ tol;
 * - cada punto de las cuerdas de las curvas, sobre una cónica de ezdxf, o en una muestra de uno de
 *   sus splines; los splines, en los u de ezdxf;
 * - textos, por su texto, con el punto de inserción y el giro;
 * - lo que no se lee y las capas ocultas.
 *
 * La tolerancia es relativa al tamaño de las coordenadas: tol · máx(1, |x|, |y|).
 *
 * Puro: sin IO.
 */
import { puntoSpline, TIPOS_PUNTO_DXF, type DibujoDxf } from "./aplanar.ts";

export interface OraculoEzdxf {
  segmentos: number[][];
  puntos: [number, number, string][];
  conicas: number[][];
  splines: [number, number[], number[][], number[] | null, [number, number, number][]][];
  textos: [number, number, number, string][];
  ignoradas: Record<string, number>;
  capas: [string, boolean][];
}

export interface Comparacion {
  fallos: string[];
  segmentos: number;
  puntos: number;
  curvas: number;
  textos: number;
  /** La mayor diferencia de lo emparejado, relativa. */
  maximo: number;
}

/** Muestras por tramo de nudos (las de `aplanar.ts`). */
const MUESTRAS_TRAMO = 8;

export function compararConEzdxf(d: DibujoDxf, o: OraculoEzdxf, tol = 1e-9): Comparacion {
  const fallos: string[] = [];
  let maximo = 0;
  const escala = (...xs: number[]) => Math.max(1, ...xs.map(Math.abs));
  const fmt = (xs: readonly number[]) => xs.map((x) => (Number.isInteger(x) ? x : x.toFixed(6))).join(", ");

  /** Empareja cada elemento del oráculo con uno de los nuestros (sin repetir); los que sobran o faltan, a fallos. */
  const emparejar = <T>(nombre: string, oraculo: readonly T[], nuestros: readonly T[], dif: (a: T, b: T) => number, ver: (a: T) => string) => {
    const usados = new Uint8Array(nuestros.length);
    let faltan = 0;
    for (const a of oraculo) {
      let mejor = -1;
      let dm = Infinity;
      for (let j = 0; j < nuestros.length; j++) {
        if (usados[j]) continue;
        const dd = dif(a, nuestros[j]!);
        if (dd < dm) {
          dm = dd;
          mejor = j;
          if (dd === 0) break;
        }
      }
      if (mejor >= 0 && dm <= tol) {
        usados[mejor] = 1;
        maximo = Math.max(maximo, dm);
      } else if (faltan++ < 5) fallos.push(`${nombre}: falta ${ver(a)} (lo más cercano, a ${dm.toExponential(2)})`);
    }
    if (faltan > 5) fallos.push(`${nombre}: faltan ${faltan} en total`);
    const sobran = nuestros.filter((_, j) => !usados[j]);
    if (sobran.length) fallos.push(`${nombre}: sobran ${sobran.length}, como ${ver(sobran[0]!)}`);
  };

  // Segmentos rectos, en cualquier sentido
  const segs: number[][] = [];
  for (let i = 0; i < d.lineas.length; i += 4) segs.push([d.lineas[i]!, d.lineas[i + 1]!, d.lineas[i + 2]!, d.lineas[i + 3]!]);
  const difSeg = (a: number[], b: number[]) => {
    const s = escala(...a);
    const directo = Math.max(...a.map((x, k) => Math.abs(x - b[k]!)));
    const vuelta = Math.max(Math.abs(a[0]! - b[2]!), Math.abs(a[1]! - b[3]!), Math.abs(a[2]! - b[0]!), Math.abs(a[3]! - b[1]!));
    return Math.min(directo, vuelta) / s;
  };
  emparejar("segmentos", o.segmentos, segs, difSeg, (a) => `[${fmt(a)}]`);

  // Puntos para enganchar, con su tipo
  const pts: [number, number, string][] = [];
  for (let i = 0; i < d.tipoPuntos.length; i++) pts.push([d.puntos[2 * i]!, d.puntos[2 * i + 1]!, TIPOS_PUNTO_DXF[d.tipoPuntos[i]!]!]);
  const difPunto = (a: [number, number, string], b: [number, number, string]) => (a[2] !== b[2] ? Infinity : Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) / escala(a[0], a[1]));
  emparejar("puntos", o.puntos, pts, difPunto, (a) => `${a[2]} (${fmt([a[0], a[1]])})`);

  // Splines en los u de ezdxf
  for (const [grado, nudos, ctrl, pesos, muestras] of o.splines)
    for (const [u, x, y] of muestras) {
      const p = puntoSpline(grado, nudos, ctrl as [number, number, number][], pesos, u);
      const e = Math.max(Math.abs(p[0] - x), Math.abs(p[1] - y)) / escala(x, y);
      maximo = Math.max(maximo, e);
      if (e > tol) fallos.push(`spline en u = ${u}: (${fmt([p[0], p[1]])}) frente a (${fmt([x, y])})`);
    }

  // Los puntos de las curvas: en una cónica o en una muestra de un spline
  const muestrasSplines: [number, number][] = [];
  for (const [grado, nudos, ctrl, pesos] of o.splines) {
    const c = ctrl as [number, number, number][];
    for (let i = grado; i < c.length; i++) {
      const [u0, u1] = [nudos[i]!, nudos[i + 1]!];
      if (!(u1 > u0)) continue;
      for (let j = 0; j < MUESTRAS_TRAMO; j++) {
        const p = puntoSpline(grado, nudos, c, pesos, u0 + ((u1 - u0) * j) / MUESTRAS_TRAMO);
        muestrasSplines.push([p[0], p[1]]);
      }
    }
    const p = puntoSpline(grado, nudos, c, pesos, nudos[c.length]!);
    muestrasSplines.push([p[0], p[1]]);
  }
  const enConica = (x: number, y: number): number => {
    let mejor = Infinity;
    for (const [cx, cy, ux, uy, vx, vy] of o.conicas as [number, number, number, number, number, number][]) {
      const det = ux * vy - vx * uy;
      if (Math.abs(det) < 1e-14 * escala(ux, uy, vx, vy) ** 2) continue;
      const a = ((x - cx) * vy - vx * (y - cy)) / det;
      const b = (ux * (y - cy) - uy * (x - cx)) / det;
      mejor = Math.min(mejor, (Math.abs(Math.hypot(a, b) - 1) * Math.max(Math.hypot(ux, uy), Math.hypot(vx, vy))) / escala(x, y));
    }
    for (const [sx, sy] of muestrasSplines) mejor = Math.min(mejor, Math.max(Math.abs(sx - x), Math.abs(sy - y)) / escala(x, y));
    return mejor;
  };
  let curvas = 0;
  let fuera = 0;
  for (let i = 0; i < d.curvas.length; i += 2) {
    const e = enConica(d.curvas[i]!, d.curvas[i + 1]!);
    curvas++;
    if (e <= tol) maximo = Math.max(maximo, e);
    else if (fuera++ < 5) fallos.push(`curva: (${fmt([d.curvas[i]!, d.curvas[i + 1]!])}) no está en ninguna curva de ezdxf (a ${e.toExponential(2)})`);
  }
  if (fuera > 5) fallos.push(`curva: ${fuera} puntos fuera en total`);

  // Textos: por su texto, con el punto y el giro
  const txt = d.textos.map((t): [number, number, number, string] => [t.x, t.y, t.giro, t.texto]);
  const difAngulo = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const difTexto = (a: [number, number, number, string], b: [number, number, number, string]) =>
    a[3] !== b[3] ? Infinity : Math.max(Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) / escala(a[0], a[1]), difAngulo(a[2], b[2]));
  emparejar("textos", o.textos, txt, difTexto, (a) => `«${a[3]}» en (${fmt([a[0], a[1]])}) a ${((a[2] * 180) / Math.PI).toFixed(3)}°`);

  // Lo que no se lee y las capas
  const ig = (r: Record<string, number>) => JSON.stringify(Object.entries(r).sort());
  if (ig(d.ignoradas) !== ig(o.ignoradas)) fallos.push(`ignoradas: ${ig(d.ignoradas)} frente a ${ig(o.ignoradas)}`);
  for (const [nombre, oculta] of o.capas) {
    const c = d.capas.find((x) => x.nombre === nombre);
    if (c && c.oculta !== oculta) fallos.push(`capa ${nombre}: oculta ${c.oculta} frente a ${oculta}`);
  }

  return { fallos, segmentos: segs.length, puntos: pts.length, curvas, textos: txt.length, maximo };
}
