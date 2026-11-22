/**
 * Fase CO6 (`docs/fem3d/comprobaciones.md` §8.13): los pórticos, para el despiece de las vigas. Un
 * pórtico es una alineación de vigas de una planta: las que se siguen una a otra por un extremo, con
 * la misma dirección. Se da con sus apoyos y sus vanos en una sola coordenada x a lo largo de él (m),
 * de izquierda a derecha en planta (o de abajo arriba, si va según Y).
 *
 * Sólo ordena lo que ya dicen el modelo y `Consultas.viga` (los apoyos de cada viga con sus caras y
 * sus vanos entre ellas): no hay ningún número de cálculo. Lo usan el despiece
 * (`despieceVigas.ts`) y el dibujo del pórtico de Resultados · Comprobación.
 */
import type { ApoyoPieza, Consultas } from "../compilador/consultas.ts";
import type { Vec2 } from "../compilador/fisico.ts";
import { DATOS_ARMADO, DIAMETROS, type DatosArmado } from "./armado.ts";
import { COT_THETA_CORTANTE } from "./concreta/data/factors.ts";
import { getFyd } from "./concreta/data/materials.ts";
import { computeAnchorage, fctmAdherencia } from "./concreta/lib/calculations/rcSlabs.ts";
import type { DatosDespiece } from "./despieceVigas.ts";

/** Dos extremos de viga son el mismo punto a menos de esto, m. */
export const EXTREMOS_JUNTOS = 0.05;
/** Dos vigas se siguen si su dirección cambia menos que esto en la unión, grados. */
export const GIRO_MAXIMO_PORTICO = 10;
/** Unidas por el mismo pilar sin acabar en el mismo punto (enrasadas a caras distintas): lo que pueden estar desplazadas de lado, m. */
export const DESPLAZAMIENTO_MAXIMO = 0.6;

export interface ApoyoPortico {
  /** El pilar, el muro, el apoyo o la viga en que se apoya. */
  objeto: string;
  tipo: ApoyoPieza["tipo"];
  /** Su eje y sus caras a lo largo del pórtico, m. */
  eje: number;
  caras: [number, number];
}

export interface VanoPortico {
  /** «V3/0»: la clave de su comprobación. */
  clave: string;
  viga: string;
  /** Su índice en los vanos de su viga. */
  vano: number;
  /** La viga se dibujó en sentido contrario al del pórtico: su inicio queda a la derecha. */
  invertida: boolean;
  /** Las caras de sus apoyos (o el extremo libre de un voladizo), m. */
  desde: number;
  hasta: number;
  /** El apoyo de cada lado (su índice en `apoyos`); null, un extremo libre. */
  apoyos: [number | null, number | null];
  seccion: string;
  /** Si es de hormigón y rectangular (lo que se arma): b y h, mm, y fck, MPa. */
  geometria?: { b: number; h: number; fck: number };
}

export interface Portico {
  /** Los ids de sus vigas, en su orden, unidos con «+». */
  id: string;
  planta: string;
  /** «P1 – P2 – P3»: sus apoyos. */
  nombre: string;
  vigas: { id: string; invertida: boolean; x: [number, number] }[];
  apoyos: ApoyoPortico[];
  vanos: VanoPortico[];
  /** De la cara de fuera de su primer apoyo (o su extremo) a la del último, m. */
  x: [number, number];
  /** Donde una viga en polilínea cambia de dirección (se dibuja estirada), m. */
  quiebros: number[];
}

interface Extremo {
  viga: number;
  /** 0, el primer punto; 1, el último. */
  lado: 0 | 1;
  p: Vec2;
  /** La dirección con que la viga sale por ese extremo. */
  u: Vec2;
  apoyo: string | null;
}

const resta = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const punto = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
const cruz = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
const unitario = (a: Vec2): Vec2 => {
  const n = Math.hypot(a[0], a[1]);
  return n > 0 ? [a[0] / n, a[1] / n] : [1, 0];
};

const CACHE = new WeakMap<Consultas, Portico[]>();

/** Todos los pórticos del modelo: cada viga está en uno y sólo en uno. En el orden de la primera viga de cada uno. */
export function porticosDe(q: Consultas): Portico[] {
  const ya = CACHE.get(q);
  if (ya) return ya;
  const f = q.fisico;
  const datos = (f.vigas ?? []).flatMap((v) => {
    const r = q.viga(v.id);
    if (!r.valido) return [];
    // Sin los puntos repetidos: no tienen dirección
    const pts = v.puntos.filter((p, i) => i === 0 || Math.hypot(p[0] - v.puntos[i - 1]![0], p[1] - v.puntos[i - 1]![1]) > 1e-9);
    if (pts.length < 2) return [];
    const acumulado = [0];
    for (let i = 1; i < pts.length; i++) acumulado.push(acumulado[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
    const s = f.secciones.find((x) => x.id === v.seccion);
    const m = s && f.materiales.find((x) => x.id === s.material);
    const geometria = s && m && m.tipo === "hormigon" && s.forma === "rectangular" ? { b: 1000 * s.b, h: 1000 * s.h, fck: m.fck } : undefined;
    return [{ v, pts, acumulado, L: acumulado[acumulado.length - 1]!, apoyos: r.valor.apoyos, vanos: r.valor.vanos, geometria }];
  });

  // ─── Qué extremo sigue a cuál ────────────────────────────────────────────────────────────────
  const extremos: Extremo[] = datos.flatMap((d, viga): Extremo[] => {
    const n = d.pts.length;
    const en = (s: number) => d.apoyos.find((a) => Math.abs(a.s - s) <= EXTREMOS_JUNTOS && a.tipo !== "viga")?.objeto ?? null;
    return [
      { viga, lado: 0, p: d.pts[0]!, u: unitario(resta(d.pts[0]!, d.pts[1]!)), apoyo: en(0) },
      { viga, lado: 1, p: d.pts[n - 1]!, u: unitario(resta(d.pts[n - 1]!, d.pts[n - 2]!)), apoyo: en(d.L) },
    ];
  });
  const coseno = Math.cos((GIRO_MAXIMO_PORTICO * Math.PI) / 180);
  const candidatos: { a: number; b: number; giro: number; d: number }[] = [];
  for (let a = 0; a < extremos.length; a++)
    for (let b = a + 1; b < extremos.length; b++) {
      const [ea, eb] = [extremos[a]!, extremos[b]!];
      if (ea.viga === eb.viga || datos[ea.viga]!.v.planta !== datos[eb.viga]!.v.planta) continue;
      // La otra sigue en la dirección con que ésta sale: sus salientes, opuestos
      const c = -punto(ea.u, eb.u);
      if (c < coseno) continue;
      const sep = resta(eb.p, ea.p);
      const d = Math.hypot(sep[0], sep[1]);
      const juntos = d <= EXTREMOS_JUNTOS;
      const mismoApoyo = ea.apoyo !== null && ea.apoyo === eb.apoyo && Math.abs(cruz(sep, ea.u)) <= DESPLAZAMIENTO_MAXIMO && Math.abs(punto(sep, ea.u)) <= DESPLAZAMIENTO_MAXIMO;
      if (juntos || mismoApoyo) candidatos.push({ a, b, giro: 1 - c, d });
    }
  // Los más alineados, primero; a igual giro, los más juntos (y, si no, por su orden: no depende de nada más)
  candidatos.sort((x, y) => x.giro - y.giro || x.d - y.d || x.a - y.a || x.b - y.b);
  const sigue = new Map<number, number>();
  for (const c of candidatos) {
    if (sigue.has(c.a) || sigue.has(c.b)) continue;
    sigue.set(c.a, c.b);
    sigue.set(c.b, c.a);
  }

  // ─── Las cadenas ─────────────────────────────────────────────────────────────────────────────
  const usada = new Set<number>();
  /** Recorre desde la viga `i` entrando por su lado `entrada`: [viga, invertida][]. */
  const recorrer = (i: number, entrada: 0 | 1): [number, boolean][] => {
    const r: [number, boolean][] = [];
    let [viga, lado] = [i, entrada];
    while (!usada.has(viga)) {
      usada.add(viga);
      r.push([viga, lado === 1]);
      const otro = sigue.get(2 * viga + (1 - lado));
      if (otro === undefined) break;
      [viga, lado] = [extremos[otro]!.viga, extremos[otro]!.lado];
    }
    return r;
  };
  const cadenas: [number, boolean][][] = [];
  // Primero, las que empiezan en un extremo suelto; lo que quede son anillos
  for (let i = 0; i < datos.length; i++) {
    if (usada.has(i)) continue;
    const sueltos = ([0, 1] as const).filter((l) => !sigue.has(2 * i + l));
    if (sueltos.length) cadenas.push(recorrer(i, sueltos[0]!));
  }
  for (let i = 0; i < datos.length; i++) if (!usada.has(i)) cadenas.push(recorrer(i, 0));

  const porticos = cadenas.map((cadena): Portico => {
    // De izquierda a derecha (o de abajo arriba): si el recorrido va al revés, se le da la vuelta
    const ini = (c: [number, boolean]) => datos[c[0]]!.pts[c[1] ? datos[c[0]]!.pts.length - 1 : 0]!;
    const fin = (c: [number, boolean]) => datos[c[0]]!.pts[c[1] ? 0 : datos[c[0]]!.pts.length - 1]!;
    const total = resta(fin(cadena[cadena.length - 1]!), ini(cadena[0]!));
    if (Math.abs(total[0]) >= Math.abs(total[1]) ? total[0] < -1e-9 : total[1] < -1e-9) cadena = cadena.map(([v, inv]): [number, boolean] => [v, !inv]).reverse();

    const apoyos: ApoyoPortico[] = [];
    const vanos: VanoPortico[] = [];
    const vigas: Portico["vigas"] = [];
    const quiebros: number[] = [];
    let x0 = 0;
    cadena.forEach((c, k) => {
      const d = datos[c[0]]!;
      const inv = c[1];
      if (k > 0) {
        // Si no acaban en el mismo punto (el mismo pilar, por caras distintas), lo que hay entre los dos a lo largo
        const previa = cadena[k - 1]!;
        const u = unitario(resta(fin(previa), datos[previa[0]]!.pts[previa[1] ? 1 : datos[previa[0]]!.pts.length - 2]!));
        x0 += punto(resta(ini(c), fin(previa)), u);
      }
      const X = (s: number) => x0 + (inv ? d.L - s : s);
      vigas.push({ id: d.v.id, invertida: inv, x: [x0, x0 + d.L] });
      for (let i = 1; i < d.pts.length - 1; i++) {
        const [a, b] = [unitario(resta(d.pts[i]!, d.pts[i - 1]!)), unitario(resta(d.pts[i + 1]!, d.pts[i]!))];
        if (punto(a, b) < coseno) quiebros.push(X(d.acumulado[i]!));
      }
      // Los apoyos: el del extremo compartido con la viga anterior es el mismo
      const indice = new Map<ApoyoPieza, number>();
      const suyosApoyos = inv ? [...d.apoyos].reverse() : d.apoyos;
      for (const a of suyosApoyos) {
        const caras = [X(a.caras[0]), X(a.caras[1])].sort((p, q2) => p - q2) as [number, number];
        const eje = X(a.s);
        const ultimo = apoyos[apoyos.length - 1];
        if (k > 0 && a === suyosApoyos[0] && ultimo && ultimo.objeto === a.objeto && Math.abs(ultimo.eje - eje) <= DESPLAZAMIENTO_MAXIMO) {
          ultimo.caras = [Math.min(ultimo.caras[0], caras[0]), Math.max(ultimo.caras[1], caras[1])];
          indice.set(a, apoyos.length - 1);
        } else {
          apoyos.push({ objeto: a.objeto, tipo: a.tipo, eje, caras });
          indice.set(a, apoyos.length - 1);
        }
      }
      const de = (a: ApoyoPieza | null) => (a ? (indice.get(a) ?? indice.get(d.apoyos.find((y) => y.objeto === a.objeto && y.s === a.s)!) ?? null) : null);
      const suyos = d.vanos.map((va, vano): VanoPortico => {
        const [a, b] = inv ? [X(va.hasta), X(va.desde)] : [X(va.desde), X(va.hasta)];
        const [ai, af] = inv ? [va.apoyoFin, va.apoyoInicio] : [va.apoyoInicio, va.apoyoFin];
        return { clave: `${d.v.id}/${vano}`, viga: d.v.id, vano, invertida: inv, desde: a, hasta: b, apoyos: [de(ai), de(af)], seccion: d.v.seccion, ...(d.geometria ? { geometria: d.geometria } : {}) };
      });
      vanos.push(...(inv ? suyos.reverse() : suyos));
      x0 += d.L;
    });
    const xs = [...apoyos.flatMap((a) => a.caras), ...vigas.flatMap((v) => v.x)];
    const nombres = apoyos.map((a) => a.objeto).filter((o, i, t) => i === 0 || o !== t[i - 1]);
    return {
      id: vigas.map((v) => v.id).join("+"),
      planta: datos[cadena[0]![0]]!.v.planta,
      nombre: nombres.length ? nombres.join(" – ") : vigas.map((v) => v.id).join(" + "),
      vigas,
      apoyos,
      vanos,
      x: [Math.min(...xs), Math.max(...xs)],
      quiebros,
    };
  });
  CACHE.set(q, porticos);
  return porticos;
}

/**
 * Lo que el despiece de un pórtico necesita además del armado: el recubrimiento, cot θ y el anclaje
 * básico de cada diámetro en cada vano (`lb,rqd` a fyd, CE A19 §8.4.3, con `computeAnchorage` del
 * módulo de forjados: en buena adherencia y en la cara superior, que con más de 25 cm de canto es
 * de adherencia deficiente).
 */
export function datosDespiece(p: Portico, d?: DatosArmado): DatosDespiece {
  const fyd = getFyd(d?.fyk ?? DATOS_ARMADO.fyk);
  const anclajes: Record<string, Record<number, [number, number]>> = {};
  for (const v of p.vanos) {
    if (!v.geometria) continue;
    const fctm = fctmAdherencia(v.geometria.fck);
    const t: Record<number, [number, number]> = {};
    for (const o of DIAMETROS) t[o] = [computeAnchorage(o, fctm, fyd, "inf", v.geometria.h).lb_rqd / 1000, computeAnchorage(o, fctm, fyd, "sup", v.geometria.h).lb_rqd / 1000];
    anclajes[v.clave] = t;
  }
  return { recubrimiento: d?.recubrimiento ?? DATOS_ARMADO.recubrimiento, cotTheta: COT_THETA_CORTANTE, anclajes };
}

/** El pórtico de una viga; null si la viga no existe. */
export function porticoDe(q: Consultas, viga: string): Portico | null {
  return porticosDe(q).find((p) => p.vigas.some((v) => v.id === viga)) ?? null;
}
