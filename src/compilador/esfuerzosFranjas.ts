/**
 * Esfuerzos de las franjas de armado (fase F, `docs/fem3d/franjas.md` §2.3–§2.4): en cada estación
 * de cada franja de una losa (`franjas.ts`), los momentos medios por metro de su ancho y Wood–Armer
 * por combinación.
 *
 * Ejes de la franja: x a lo largo (d), z vertical hacia arriba e y = z × x. mx es el momento que la
 * flecta, positivo con tracción abajo (de vano), como el My de un corte o de una viga; my y mxy, los
 * de los campos en esos ejes (cabecera de modelo.ts). Sólo cuenta la losa (F-g): ni las vigas ni lo
 * que transmiten los enlaces (cortes con `soloLaminas`), ni las láminas rígidas de una huella.
 *
 * Estaciones de una franja, por s = p·d creciente:
 * - **Caras** de los pilares (las rectas de `carasFranjas`, sembradas de lado a lado de la losa): por
 *   fuerzas nodales, del lado del vano (el de menor s en la cara de menor s de un pilar). Todas las
 *   franjas que cruzan la recta tienen esa estación, también las que no tocan el pilar.
 * - **Apoyos:** ejes de vigas y muros y apoyos lineales perpendiculares a d (ya son rectas de la
 *   malla), por fuerzas nodales y a cada lado, en las franjas que cubren al menos en la mitad del
 *   ancho que tienen en losa. Si su corte no sigue la malla (una viga que acaba dentro), no hay.
 * - **Paso:** cada PASO_ESTACIONES desde el comienzo de la losa en d, por campos.
 * Entre las dos caras de un pilar que toca la franja no hay estaciones: es el apoyo.
 *
 * Una recta corta todas las franjas de la losa a la vez:
 * - por fuerzas nodales, con lo que aporta cada lámina del lado tomado (`porLamina`), repartido entre
 *   las franjas por la parte de su lado sobre la recta que cae en cada una: los bordes de las franjas
 *   no siguen la malla, y así la suma de las franjas es el corte de toda la losa (exacto) y cada
 *   franja recibe lo de su ancho;
 * - por campos, con los tramos partidos en los bordes de las franjas (`quiebres`): la integral del
 *   campo SPR en el ancho de cada franja, con Gauss de 2 puntos por tramo (exacta en las láminas
 *   paralelogramo de la rejilla, donde el campo es cuadrático a lo largo de la recta).
 *
 * Momentos medios por caso: mx = ∫Mx/b con b el ancho de la franja que cae en losa (sin huecos,
 * huellas ni lo que se sale); my y mxy, medias del campo en ese ancho, en las caras y los apoyos a
 * DELTA_MUESTRAS del lado tomado.
 *
 * En la cara de un pilar que toca la franja, los medios no son los de la franja sino los de una
 * ventana del mismo ancho centrada en el pilar (F-h): el pico del momento está sobre el pilar, y con
 * el reparto fijo un pilar partido entre dos franjas daba en cada una hasta un 35 % menos que el
 * metro centrado (criterio 4). Así la demanda junto a un pilar no depende de dónde caen los bordes
 * de las franjas. En un reticular, el momento por nervio es mx·s (intereje), y
 * `fraccionAbaco` dice qué parte del ancho es maciza.
 *
 * Wood–Armer (H34, C5-c a): por combinación, con los momentos medios. Una franja de la dirección 1
 * da la armadura de esa dirección (m*x en sus ejes) y una de la 2, la de la suya.
 *
 * Todo es lineal en los casos salvo Wood–Armer: los medios de una combinación son la combinación de
 * los de sus casos.
 */
import { woodArmer } from "../dimensionado/woodArmer.ts";
import { CamposLaminas } from "../motor/campos.ts";
import { Cortes, type Corte, type ResultadoCorte } from "../motor/cortes.ts";
import { Diagnosticos, type Diagnostico } from "../motor/diagnosticos.ts";
import type { ModeloAnalitico, ResultadoCaso } from "../motor/modelo.ts";
import { combinar } from "./envolventes.ts";
import { ANCHO_FRANJA, type Vec2 } from "./fisico.ts";
import { anchoNominal, carasFranjas, ejesArmado, franjasLosa, PASO_ESTACIONES, pilaresSinCara, tramosRecta, type Franja } from "./franjas.ts";
import type { Mapeo } from "./mapeo.ts";
import type { Contexto, LosaCompilada } from "./validar.ts";

/** Distancia a una cara o a un apoyo de la recta de campos de sus my y mxy, m. */
export const DELTA_MUESTRAS = 1e-3;
/** Parte mínima del ancho en losa de una franja que tiene que cubrir una línea de apoyo para darle estación. */
export const COBERTURA_APOYO = 0.5;
/** Holgura de las comparaciones de coordenadas, m. */
const EPS = 1e-6;

export type TipoEstacionFranja = "cara" | "apoyo" | "paso";

export interface EstacionFranja {
  /** Coordenada a lo largo de la franja (s = p·d), m. */
  s: number;
  tipo: TipoEstacionFranja;
  /** Lado que se toma en una cara o un apoyo: −1 (s menores) o +1; 0 en una de paso. */
  lado: -1 | 0 | 1;
  /** Centro de la franja en la estación, en planta. */
  punto: Vec2;
  /** Ancho de la franja que cae en losa en la estación, m (el de los medios). */
  anchoEnLosa: number;
  /** [mx, my, mxy] medios por caso (3·nc), kN·m/m, en los ejes de la franja. */
  medios: Float64Array;
  metodo: "fuerzas-nodales" | "campos";
  /** Pilares de la cara que tocan la franja, o la pieza de la línea de apoyo. */
  piezas: string[];
  /**
   * En una cara de un pilar que toca la franja, la ventana transversal [t0, t1] de sus medios: el
   * ancho de la franja centrado en el pilar (F-h), no la franja.
   */
  ventana?: [number, number];
  /** En un reticular, la parte de `anchoEnLosa` en ábacos (macizos); null en una maciza. */
  fraccionAbaco: number | null;
  valido: boolean;
  diagnosticos: Diagnostico[];
}

export interface ResultadoFranja {
  franja: Franja;
  estaciones: EstacionFranja[];
  /** Los de la franja entera (un pilar que toca sin cara exacta). */
  diagnosticos: Diagnostico[];
}

/** Demanda de Wood–Armer en una estación: la mayor de las combinaciones, con la que la da (−1 si es 0 en todas). */
export interface EnvolventeEstacionFranja {
  /** Momento de dimensionado de la cara inferior (tracción abajo) y de la superior, ≥ 0, kN·m/m. */
  inferior: number;
  superior: number;
  combInferior: number;
  combSuperior: number;
  /** mx máximo y mínimo, con su combinación. */
  mxMax: number;
  mxMin: number;
  combMax: number;
  combMin: number;
}

/** Lo que una recta da a cada franja de un grupo: Σ peso·[Mx, My, Mxy] por caso, el peso (ancho) y el de los ábacos. */
interface PorFranja {
  m: Float64Array;
  w: number;
  wAbaco: number;
}

/** Un segmento de una línea de apoyo perpendicular a d. */
interface LineaApoyo {
  id: string;
  s: number;
  ta: number;
  tb: number;
}

export class EsfuerzosFranjas {
  readonly ctx: Contexto;
  readonly modelo: ModeloAnalitico;
  readonly mapeo: Mapeo;
  readonly casos: readonly ResultadoCaso[];
  readonly ancho: number;
  /** Sólo para medir la influencia de la posición de las franjas (`franjasLosa`). */
  readonly desfase: number;
  private readonly cortes: Cortes;
  private readonly campos: CamposLaminas;
  private readonly franjasDe = new Map<string, Franja[]>();
  /** Resultados por franja (se calculan por losa y dirección, la primera vez que se pide una). */
  private readonly hechas = new Map<string, ResultadoFranja>();

  /**
   * @param ctx el contexto del modelo físico que se compiló; `compilado`, su modelo analítico y su
   *   mapeo; `casos`, sus resultados (válidos).
   */
  constructor(ctx: Contexto, compilado: { modelo: ModeloAnalitico; mapeo: Mapeo }, casos: readonly ResultadoCaso[], opciones: { campos?: CamposLaminas; cortes?: Cortes; ancho?: number; desfase?: number } = {}) {
    this.ctx = ctx;
    this.modelo = compilado.modelo;
    this.mapeo = compilado.mapeo;
    this.casos = casos;
    this.ancho = opciones.ancho ?? ctx.op.anchoFranja ?? ANCHO_FRANJA;
    this.desfase = opciones.desfase ?? 0;
    this.cortes = opciones.cortes ?? new Cortes(this.modelo);
    this.campos = opciones.campos ?? new CamposLaminas(this.modelo);
  }

  /** Las franjas de una losa (las dos direcciones), o de todas; [] si la losa no existe. */
  franjas(losa?: string): Franja[] {
    if (losa === undefined) return this.ctx.losas.flatMap((l) => this.franjas(l.losa.id));
    let r = this.franjasDe.get(losa);
    if (!r) {
      const l = this.ctx.losaDe.get(losa);
      this.franjasDe.set(losa, (r = l ? franjasLosa(l.losa, this.ancho, this.desfase) : []));
    }
    return r;
  }

  /** La franja de un id, o null. */
  franja(id: string): Franja | null {
    const losa = id.slice(0, id.lastIndexOf(":"));
    return this.franjas(losa).find((f) => f.id === id) ?? null;
  }

  /** Estaciones de una franja con sus momentos medios por caso; null si no existe. */
  estaciones(id: string): ResultadoFranja | null {
    const f = this.franja(id);
    if (!f) return null;
    if (!this.hechas.has(id)) this.calcularGrupo(this.ctx.losaDe.get(f.losa)!, f.direccion);
    return this.hechas.get(id)!;
  }

  /**
   * Wood–Armer en cada estación de la franja para cada combinación (factores por caso) y su máximo:
   * la demanda inferior y superior de la armadura de su dirección (m*x en sus ejes), con la
   * combinación que la da. null si la franja no existe.
   */
  envolvente(id: string, combinaciones: readonly ArrayLike<number>[]): EnvolventeEstacionFranja[] | null {
    const r = this.estaciones(id);
    if (!r) return null;
    return r.estaciones.map((e) => {
      const v: EnvolventeEstacionFranja = { inferior: 0, superior: 0, combInferior: -1, combSuperior: -1, mxMax: -Infinity, mxMin: Infinity, combMax: -1, combMin: -1 };
      if (!e.valido) return { ...v, inferior: NaN, superior: NaN, mxMax: NaN, mxMin: NaN };
      combinaciones.forEach((f, c) => {
        const [mx, my, mxy] = combinar(e.medios, 3, f);
        const w = woodArmer(mx!, my!, mxy!);
        if (w.inferiorX > v.inferior) [v.inferior, v.combInferior] = [w.inferiorX, c];
        if (w.superiorX > v.superior) [v.superior, v.combSuperior] = [w.superiorX, c];
        if (mx! > v.mxMax) [v.mxMax, v.combMax] = [mx!, c];
        if (mx! < v.mxMin) [v.mxMin, v.combMin] = [mx!, c];
      });
      return v;
    });
  }

  /** Las estaciones de todas las franjas de una losa en una dirección. */
  private calcularGrupo(l: LosaCompilada, k: 1 | 2): void {
    const fr = this.franjas(l.losa.id).filter((f) => f.direccion === k);
    const { d, n } = ejesArmado(l.losa)[k];
    const nc = this.casos.length;
    const z = this.ctx.cotas[this.ctx.planta.get(l.losa.planta)!]!;
    const T0 = fr[0]!.t0;
    const T1 = fr[fr.length - 1]!.t1;
    const bordes = [T0, ...fr.map((f) => f.t1)];
    const est: EstacionFranja[][] = fr.map(() => []);
    const reticular = l.losa.reticular !== undefined;
    const lam = this.mapeo.laminas ?? [];
    const enLosa = (i: number) => lam[i]?.losa === l.losa.id && this.campos.region(i) >= 0;
    /** Franja de una coordenada t (−1 fuera). */
    const franjaDe = (t: number) => {
      if (t < T0 - EPS || t > T1 + EPS) return -1;
      let a = 0;
      let b = fr.length - 1;
      while (a < b) {
        const m = (a + b + 1) >> 1;
        if (bordes[m]! <= t) a = m;
        else b = m - 1;
      }
      return a;
    };
    const punto = (s: number, t: number): Vec2 => [s * d[0] + t * n[0], s * d[1] + t * n[1]];
    /** Corte por la recta s, con x = sx·d (el lado tomado es el de s menores con sx = +1), de t = ta a tb. */
    const corte = (s: number, sx: 1 | -1, ta: number, tb: number, extra: Partial<Corte>): { corte: Corte; sigma: number } => {
      // y = z × x; σ = n·y: la y del corte de un punto de coordenada t es σ·(t − ta)
      const y: Vec2 = [-sx * d[1], sx * d[0]];
      const sigma = Math.sign(n[0] * y[0] + n[1] * y[1]);
      const O = punto(s, ta);
      const yb = sigma * (tb - ta);
      return { corte: { id: `${l.losa.id}:${k}@${s.toFixed(3)}`, origen: [O[0], O[1], z], x: [sx * d[0], sx * d[1], 0], vz: [0, 0, 1], y: [Math.min(0, yb), Math.max(0, yb)], z: [0, 0], soloLaminas: true, ...extra }, sigma };
    };

    const vacio = (): PorFranja => ({ m: new Float64Array(3 * nc), w: 0, wAbaco: 0 });

    /**
     * Campos por la recta s, repartidos entre las franjas (`r`) y, si se dan, entre otras ventanas
     * transversales (`rv`: las de los pilares de una cara), con x = +d.
     */
    const porCampos = (s: number, ventanas: readonly (readonly [number, number])[] = []): { r: PorFranja[]; rv: PorFranja[]; diag: Diagnostico[]; valido: boolean } => {
      const { corte: c, sigma } = corte(s, 1, T0, T1, { metodo: "campos", cuadratura: 2 });
      c.quiebres = [...bordes.slice(1, -1), ...ventanas.flat()].map((t) => sigma * (t - T0));
      const res = this.cortes.cortar(c, this.casos, this.campos);
      const r = fr.map(vacio);
      const rv = ventanas.map(vacio);
      const sumar = (q: PorFranja, j: number, w: number) => {
        q.w += w;
        if (lam[ms!.laminas[j]!]!.abaco) q.wAbaco += w;
        for (let kc = 0; kc < nc; kc++) {
          const v = ms!.valores[kc]!;
          for (let a = 0; a < 3; a++) q.m[3 * kc + a]! += w * v[8 * j + 3 + a]!;
        }
      };
      const ms = res.muestras;
      if (res.valido && ms)
        for (let j = 0; j < ms.pesos.length; j++) {
          if (!enLosa(ms.laminas[j]!)) continue;
          const t = T0 + sigma * ms.yz[2 * j]!;
          const i = franjaDe(t);
          if (i >= 0) sumar(r[i]!, j, ms.pesos[j]!);
          ventanas.forEach(([a, b], v) => {
            if (t > a && t < b) sumar(rv[v]!, j, ms.pesos[j]!);
          });
        }
      return { r, rv, diag: res.diagnosticos, valido: res.valido };
    };

    /**
     * Fuerzas nodales por la recta s del lado `lado` (−1: s menores), de ta a tb, repartidas entre las
     * franjas por la parte del lado de cada lámina sobre la recta que cae en cada una. null si el corte
     * no sigue la malla.
     */
    const porNodales = (s: number, lado: -1 | 1, ta: number, tb: number, ventanas: readonly (readonly [number, number])[] = []): { r: PorFranja[]; rv: PorFranja[]; diag: Diagnostico[] } | null => {
      const sx = lado === -1 ? 1 : -1;
      const { corte: c, sigma } = corte(s, sx, ta, tb, { metodo: "fuerzas-nodales", porLamina: true });
      const res: ResultadoCorte = this.cortes.cortar(c, this.casos);
      if (!res.valido || !res.porLamina) return null;
      const r = fr.map(vacio);
      const rv = ventanas.map(vacio);
      for (const p of res.porLamina) {
        if (!enLosa(p.lamina)) continue;
        const [ya, yb] = [ta + sigma * p.y[0], ta + sigma * p.y[1]];
        const [a, b] = [Math.min(ya, yb), Math.max(ya, yb)];
        const largo = b - a;
        const abaco = lam[p.lamina]!.abaco === true;
        // Lo de su lado sobre la recta que cae en [lo, hi] (un lado de largo nulo, un nudo suelto, va entero a la que lo tiene)
        const sumar = (q: PorFranja, lo: number, hi: number, suyo: boolean) => {
          const ov = largo > EPS ? Math.max(0, Math.min(b, hi) - Math.max(a, lo)) : suyo ? 1 : 0;
          const f = largo > EPS ? ov / largo : ov;
          if (!(f > 0)) return;
          q.w += largo > EPS ? ov : 0;
          if (abaco) q.wAbaco += largo > EPS ? ov : 0;
          for (let kc = 0; kc < nc; kc++) q.m[3 * kc]! += f * p.esfuerzos[6 * kc + 4]!;
        };
        const im = franjaDe((a + b) / 2);
        for (let i = Math.max(0, franjaDe(a)); i < fr.length && bordes[i]! < b + EPS; i++) sumar(r[i]!, bordes[i]!, bordes[i + 1]!, i === im);
        ventanas.forEach(([lo, hi], v) => sumar(rv[v]!, lo, hi, (a + b) / 2 > lo && (a + b) / 2 < hi));
      }
      return { r, rv, diag: res.diagnosticos.filter((x) => x.codigo !== "corte/borde-no-sigue-malla" && x.codigo !== "corte/vacio") };
    };

    /** Estación a partir de lo que dan las rectas: mx de `principal` (nodales o campos), my y mxy de `muestras` (campos). */
    const estacion = (i: number, s: number, tipo: TipoEstacionFranja, lado: -1 | 0 | 1, principal: PorFranja, muestras: PorFranja, metodo: EstacionFranja["metodo"], piezas: string[], diag: Diagnostico[], ventana?: [number, number]): EstacionFranja => {
      const f = fr[i]!;
      const b = principal.w;
      const medios = new Float64Array(3 * nc);
      const valido = b > EPS && muestras.w > EPS;
      for (let kc = 0; kc < nc; kc++) {
        medios[3 * kc] = valido ? principal.m[3 * kc]! / b : NaN;
        medios[3 * kc + 1] = valido ? muestras.m[3 * kc + 1]! / muestras.w : NaN;
        medios[3 * kc + 2] = valido ? muestras.m[3 * kc + 2]! / muestras.w : NaN;
      }
      return { s, tipo, lado, punto: punto(s, (f.t0 + f.t1) / 2), anchoEnLosa: b, medios, metodo, piezas, ...(ventana ? { ventana } : {}), fraccionAbaco: reticular ? (b > EPS ? Math.min(1, principal.wAbaco / b) : NaN) : null, valido, diagnosticos: diag };
    };

    // Caras: una recta por cara, del lado de su vano; my y mxy a δ de ese lado
    const zonas: [number, number][][] = fr.map(() => []);
    const caras = carasFranjas(this.ctx, l).filter((c) => c.direccion === k);
    const porPilar = new Map<string, { sa: number; sb: number; t0: number; t1: number }>();
    for (const c of caras)
      for (const p of c.pilares) {
        const z0 = porPilar.get(p.id) ?? { sa: NaN, sb: NaN, t0: p.t0, t1: p.t1 };
        if (c.lado === -1) z0.sa = c.s;
        else z0.sb = c.s;
        porPilar.set(p.id, z0);
      }
    const toca = (i: number, t0: number, t1: number) => fr[i]!.t0 < t1 - EPS && fr[i]!.t1 > t0 + EPS;
    for (const z0 of porPilar.values()) for (let i = 0; i < fr.length; i++) if (toca(i, z0.t0, z0.t1)) zonas[i]!.push([z0.sa, z0.sb]);
    const exactas: number[][] = fr.map(() => []);
    // Ventana de cada pilar de la cara: el ancho nominal centrado en él (F-h)
    const bNominal = anchoNominal(l.losa, this.ancho);
    for (const c of caras) {
      const ventanas = c.pilares.map((p): [number, number] => [(p.t0 + p.t1) / 2 - bNominal / 2, (p.t0 + p.t1) / 2 + bNominal / 2]);
      const nod = porNodales(c.s, c.lado, T0, T1, ventanas);
      const cam = porCampos(c.s + c.lado * DELTA_MUESTRAS, ventanas);
      for (let i = 0; i < fr.length; i++) {
        if (!c.tramos.some(([a, b]) => toca(i, a, b))) continue;
        const tocan = c.pilares.map((p, v) => ({ p, v })).filter(({ p }) => toca(i, p.t0, p.t1));
        const piezas = tocan.map(({ p }) => p.id);
        // La franja que toca un pilar toma la ventana centrada en él (la del que más la ocupa)
        const v = tocan.sort((x, y) => Math.min(fr[i]!.t1, y.p.t1) - Math.max(fr[i]!.t0, y.p.t0) - (Math.min(fr[i]!.t1, x.p.t1) - Math.max(fr[i]!.t0, x.p.t0)))[0]?.v;
        const diag = [...(nod?.diag ?? []), ...(cam.valido ? [] : cam.diag)];
        const principal = nod ? (v !== undefined ? nod.rv[v]! : nod.r[i]!) : vacio();
        const muestras = v !== undefined ? cam.rv[v]! : cam.r[i]!;
        const dg = new Diagnosticos();
        if (!nod) dg.aviso("franja/cara-sin-corte", `La cara s = ${c.s.toFixed(3)} m de la franja ${fr[i]!.id} no sigue la malla: no tiene estación.`, [fr[i]!.id]);
        est[i]!.push(estacion(i, c.s, "cara", c.lado, principal, muestras, "fuerzas-nodales", piezas, [...diag, ...dg.lista], v !== undefined ? [...ventanas[v]!] : undefined));
        exactas[i]!.push(c.s);
      }
    }
    const enApoyo = (i: number, s: number) => zonas[i]!.some(([a, b]) => s > a + EPS && s < b - EPS);
    const cercaDeExacta = (i: number, s: number) => exactas[i]!.some((x) => Math.abs(x - s) <= EPS);

    // Líneas de apoyo perpendiculares a d: vigas de la planta, muros que llegan a ella y apoyos lineales
    const lineas: LineaApoyo[] = [];
    const kp = this.ctx.planta.get(l.losa.planta)!;
    const tramosDe = (id: string, pts: readonly Vec2[]) => {
      for (let j = 0; j + 1 < pts.length; j++) {
        const [A, B] = [pts[j]!, pts[j + 1]!];
        const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
        if (!(L > EPS) || Math.abs((B[0] - A[0]) * d[0] + (B[1] - A[1]) * d[1]) > 1e-9 * L) continue;
        const [ta, tb] = [A[0] * n[0] + A[1] * n[1], B[0] * n[0] + B[1] * n[1]];
        lineas.push({ id, s: (A[0] * d[0] + A[1] * d[1] + B[0] * d[0] + B[1] * d[1]) / 2, ta: Math.min(ta, tb), tb: Math.max(ta, tb) });
      }
    };
    for (const v of this.ctx.vigas) if (v.planta === l.losa.planta) tramosDe(v.id, v.puntos);
    for (const m of this.ctx.muros) if (kp >= m.kh && kp <= m.kb) tramosDe(m.muro.id, m.muro.puntos);
    for (const a of this.ctx.apoyosLineales) if (a.planta === l.losa.planta) tramosDe(a.id, a.puntos);
    lineas.sort((a, b) => a.s - b.s || a.ta - b.ta || (a.id < b.id ? -1 : 1));
    for (const ln of lineas) {
      const tramos = tramosRecta(l.region, d, n, ln.s);
      for (const lado of [-1, 1] as const) {
        const nod = porNodales(ln.s, lado, ln.ta, ln.tb);
        if (!nod) continue;
        const cam = porCampos(ln.s + lado * DELTA_MUESTRAS);
        for (let i = 0; i < fr.length; i++) {
          const f = fr[i]!;
          if (!(ln.s > f.s0 + EPS && ln.s < f.s1 - EPS) || enApoyo(i, ln.s) || cercaDeExacta(i, ln.s)) continue;
          // El ancho en losa de la franja en la recta, y lo que cubre la línea
          const enLosaF = tramos.reduce((a, [p, q]) => a + Math.max(0, Math.min(q, f.t1) - Math.max(p, f.t0)), 0);
          if (!(nod.r[i]!.w >= COBERTURA_APOYO * enLosaF - EPS) || !(nod.r[i]!.w > EPS)) continue;
          est[i]!.push(estacion(i, ln.s, "apoyo", lado, nod.r[i]!, cam.r[i]!, "fuerzas-nodales", [ln.id], [...nod.diag, ...(cam.valido ? [] : cam.diag)]));
        }
      }
      for (let i = 0; i < fr.length; i++) if (est[i]!.some((e) => e.tipo === "apoyo" && e.s === ln.s)) exactas[i]!.push(ln.s);
    }

    // Paso: una recta por campos cada PASO_ESTACIONES
    const S0 = Math.min(...fr.map((f) => f.s0));
    const S1 = Math.max(...fr.map((f) => f.s1));
    const nPasos = Math.floor((S1 - S0) / PASO_ESTACIONES - 1e-9);
    for (let j = 1; j <= nPasos; j++) {
      const s = S0 + j * PASO_ESTACIONES;
      const quien = fr.map((f, i) => s > f.s0 + EPS && s < f.s1 - EPS && !enApoyo(i, s) && !cercaDeExacta(i, s));
      if (!quien.some(Boolean)) continue;
      const cam = porCampos(s);
      fr.forEach((_, i) => {
        if (!quien[i] || !(cam.r[i]!.w > EPS)) return;
        est[i]!.push(estacion(i, s, "paso", 0, cam.r[i]!, cam.r[i]!, "campos", [], cam.valido ? [] : cam.diag));
      });
    }

    const sinCara = pilaresSinCara(this.ctx, l, k);
    fr.forEach((f, i) => {
      const e = est[i]!.sort((a, b) => a.s - b.s || a.lado - b.lado);
      const diag = new Diagnosticos();
      const ids = sinCara.filter((p) => toca(i, p.t0, p.t1)).map((p) => p.id);
      if (ids.length)
        diag.aviso(
          "franja/pilar-sin-cara",
          `La franja ${f.id} pasa por ${ids.length > 1 ? "los pilares" : "el pilar"} ${ids.join(", ")} sin cara en la malla (circular, girado respecto a los ejes de la losa o de borde): junto a ${ids.length > 1 ? "ellos" : "él"} sus momentos son por campos, que en la cara de un pilar se quedan cortos (C5-2). Revise ahí el armado.`,
          [f.id, ...ids],
        );
      this.hechas.set(f.id, { franja: f, estaciones: e, diagnosticos: diag.lista });
    });
  }
}
