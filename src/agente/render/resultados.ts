/**
 * Vistas de la malla y de los resultados de una planta (A4): `malla`, isovalores (`uz`, `m11`,
 * `m22`, `m12`, `v13`, `v23`), diagramas de vigas (`vigas-my`, `vigas-vz`) y axiles de pilares
 * (`pilares-n`). Necesitan el modelo compilado y, salvo la malla, calculado.
 *
 * De dónde sale cada número (criterio 1 de A4):
 * - uz, de los desplazamientos de los nudos de las láminas de la planta (los de `Consultas.flechas`);
 * - m11…v23 y f11…f12 (las fuerzas de membrana, I4), de los campos SPR (`CamposLaminas`, E5) en los
 *   nudos de cada lámina, en sus ejes (los de su losa: 1 = `eje1`, X por defecto; en un muro, 1 a lo
 *   largo de su eje, 2 hacia arriba). Son lineales en los casos: se evalúan por caso y se combinan;
 * - los diagramas, de `diagramaCombinado` (A1) en las estaciones de cada tramo flexible; sus extremos
 *   rotulados, de `Consultas.vano` en cada combinación;
 * - los axiles, de `Consultas.pilar`.
 *
 * Un mapa es de una combinación: con varias, la que da el mayor |valor| en la planta o, con
 * `envolvente` (UI-1), su envolvente en cada nudo de cada lámina (el máximo o el mínimo, cada nudo con
 * su combinación). Los diagramas y los axiles son envolventes sobre todas las combinaciones del
 * conjunto. En uz, los extremos se rotulan como se leen (UI-14): la flecha máxima hacia abajo y, si lo
 * hay, el levantamiento.
 *
 * Puro: sin IO.
 */
import type { ResultadoCompilacion } from "../../compilador/compilar.ts";
import type { Consultas } from "../../compilador/consultas.ts";
import { cotasPlantas } from "../../compilador/cotas.ts";
import { EsfuerzosPiezas, type TramoFlexible } from "../../compilador/resultados.ts";
import { CamposLaminas, type EvaluadorCampos } from "../../motor/campos.ts";
import type { ConjuntoCombinaciones } from "../combinaciones.ts";
import { esfuerzoProyectado, type DiagramaLeible } from "../../motor/diagramaCompuesto.ts";
import type { CasoEspectral, PartesCombinacion } from "../../motor/espectral.ts";
import { area, cajaDe, numeroFijo, rayado, rotulo, type EntradaLeyenda, type Escena, type ExtremoRotulado, type Primitiva, type Vec2 } from "./escena.ts";
import { AVISO_PICOS, bandas, CAMPO_NULO, COLOR_NULO, coloresBandas, FRACCION_PICOS, isolineas, LIMITES_NULO, limitesMapa, rangoSinPicos, triangulosCuadrilatero, type EscalaMapa, type LimitesMapa, type Triangulo } from "./isovalores.ts";
import { capaEjes } from "./ejes.ts";
import { capaApoyos, ejeSeccion, fondoModelo, huellaMuro, huellaSeccion, huellasVigasPlanta, PlantaFisica, type DatosVista } from "./modelo.ts";

export const CAMPOS = ["uz", "m11", "m22", "m12", "v13", "v23", "f11", "f22", "f12"] as const;
export type Campo = (typeof CAMPOS)[number];
/** `reacciones` (I4) está en `reacciones.ts`. */
export const VISTAS_RESULTADOS = ["malla", ...CAMPOS, "vigas-my", "vigas-vz", "pilares-n", "reacciones", "bandas"] as const;

/** Componente de los campos SPR ([Nx, Ny, Nxy, Mx, My, Mxy, Qx, Qy]) de cada campo de láminas. */
const COMPONENTE: Record<Exclude<Campo, "uz">, number> = { f11: 0, f22: 1, f12: 2, m11: 3, m22: 4, m12: 5, v13: 6, v23: 7 };
const UNIDAD: Record<Campo, string> = { uz: "mm", m11: "kN·m/m", m22: "kN·m/m", m12: "kN·m/m", v13: "kN/m", v23: "kN/m", f11: "kN/m", f22: "kN/m", f12: "kN/m" };
/** R-21: los decimales con que se rotula cada campo (el extremo del dibujo, y en la app el panel, la sonda y el clic). */
export const DECIMALES_CAMPO: Record<Campo, number> = { uz: 2, m11: 1, m22: 1, m12: 1, v13: 1, v23: 1, f11: 1, f22: 1, f12: 1 };
const NOMBRE: Record<Campo, string> = {
  uz: "uz, desplazamiento vertical (mm; negativo hacia abajo)",
  m11: "M11 (kN·m/m), flexión según el eje 1 de la losa; positivo tracciona la cara inferior",
  m22: "M22 (kN·m/m), flexión según el eje 2 de la losa; positivo tracciona la cara inferior",
  m12: "M12 (kN·m/m), momento torsor de la losa",
  v13: "V13 (kN/m), cortante en las caras normales al eje 1 (por equilibrio, del SPR)",
  v23: "V23 (kN/m), cortante en las caras normales al eje 2 (por equilibrio, del SPR)",
  f11: "F11 (kN/m), fuerza de membrana según el eje 1; positiva de tracción",
  f22: "F22 (kN/m), fuerza de membrana según el eje 2; positiva de tracción",
  f12: "F12 (kN/m), fuerza de membrana tangencial",
};

/** Las láminas de un mapa: las de las losas de una planta o las de los muros (las que van de la planta de debajo a ella). */
export type SuperficieMapa = "losas" | "muros";
/** Lo que hay que saber de las fuerzas de membrana de las losas. */
export const NOTA_MEMBRANA = "Fuerzas de membrana recuperadas por SPR (E5) en los ejes de cada losa. En una planta con diafragma rígido salen nulas en las losas: el atado lo lleva el diafragma (C1-d).";
/** Ordenada máxima de un diagrama, como fracción de la diagonal de la planta. */
const ORDENADA = 0.035;
/** Divisiones de cada tramo flexible que se añaden a sus estaciones para dibujar el diagrama. */
const DIVISIONES = 12;

type Compilado = Extract<ResultadoCompilacion, { valido: true }>;

/** Lo que comparten las vistas de resultados de un cálculo: lo que cuesta se calcula una vez. */
export class ResultadosRender {
  readonly q: Consultas;
  readonly c: Compilado;
  private camposC?: CamposLaminas;
  private epC?: EsfuerzosPiezas;
  /** Por planta: láminas y, por caso, los 8 campos en sus 4 nudos (32 por lámina). */
  private readonly porPlanta = new Map<string, { laminas: number[]; region: boolean[]; valores?: Float64Array[]; hechas?: Set<"flexion" | "membrana"> }>();

  constructor(q: Consultas, c: Compilado) {
    this.q = q;
    this.c = c;
  }

  get campos(): CamposLaminas {
    // Los de las consultas: los cortes de las bandas y los mapas comparten lo recuperado
    return (this.camposC ??= this.q.compilado === this.c.modelo ? this.q.campos : new CamposLaminas(this.c.modelo));
  }

  get ep(): EsfuerzosPiezas {
    // Los de las consultas, como los campos: los diagramas se preparan una vez para las vistas y las consultas
    // (con el sismo del programa, el modelo de las consultas lleva además los casos de los modos: siempre los suyos)
    return (this.epC ??= (this.q.compilado === this.c.modelo && this.q.mapeo === this.c.mapeo) || this.q.modelo.casos.length !== this.c.modelo.casos.length ? this.q.esfuerzosPiezas : new EsfuerzosPiezas(this.c.modelo, this.c.mapeo, this.q.casos));
  }

  /**
   * Láminas de las losas de la planta o, con «muros», las de los muros entre ella y la planta de
   * debajo (por la cota de su centro), en el orden del modelo.
   */
  laminas(planta: string, de: SuperficieMapa = "losas"): { laminas: number[]; region: boolean[]; valores?: Float64Array[]; hechas?: Set<"flexion" | "membrana"> } {
    const clave = de === "losas" ? planta : `muros
${planta}`;
    let x = this.porPlanta.get(clave);
    if (!x) {
      const laminas: number[] = [];
      if (de === "losas") {
        const losas = new Set((this.q.fisico.losas ?? []).filter((l) => l.planta === planta).map((l) => l.id));
        (this.c.mapeo.laminas ?? []).forEach((m, i) => {
          if (m.losa && losas.has(m.losa)) laminas.push(i);
        });
      } else {
        const plantas = this.q.fisico.plantas;
        const k = plantas.findIndex((p) => p.id === planta);
        const cotas = cotasPlantas(plantas);
        const [z0, z1] = [cotas[k + 1], cotas[k]];
        if (k >= 0 && z0 !== null && z0 !== undefined && z1 !== null && z1 !== undefined)
          (this.c.mapeo.laminas ?? []).forEach((m, i) => {
            if (!m.muro) return;
            const zc = this.c.modelo.laminas![i]!.nudos.reduce((s, n) => s + this.c.modelo.nudos[n]!.z, 0) / 4;
            if (zc > z0 && zc <= z1) laminas.push(i);
          });
      }
      x = { laminas, region: [] };
      this.porPlanta.set(clave, x);
    }
    return x;
  }

  /**
   * Campos SPR por caso en los nudos de las láminas de la planta (o de sus muros). Con `parte`, sólo
   * se asegura la de esa partición (N, o M y Q): lo de la otra puede estar aún a 0.
   */
  valores(planta: string, de: SuperficieMapa = "losas", parte?: "flexion" | "membrana"): { laminas: number[]; region: boolean[]; valores: Float64Array[] } {
    const x = this.laminas(planta, de);
    if (!x.valores) {
      x.region = x.laminas.map((l) => this.campos.region(l) >= 0);
      x.valores = this.q.casos.map(() => new Float64Array(32 * x!.laminas.length));
      x.hechas = new Set();
    }
    for (const p of parte ? [parte] : (["flexion", "membrana"] as const)) {
      if (x.hechas!.has(p)) continue;
      const ls = x.laminas;
      const XI = [-1, 1, 1, -1];
      const ETA = [-1, -1, 1, 1];
      const o = p === "flexion" ? 3 : 0;
      const evs: EvaluadorCampos[] = this.q.casos.map((r) => this.campos.evaluadorCompartido(r.u));
      // Lámina a lámina y, en cada una, todos los casos: el operador de resultantes de una lámina y de
      // sus vecinas se calcula una vez, no una por caso (cada evaluador da lo mismo en otro orden)
      ls.forEach((l, i) => {
        if (!x!.region[i]) return;
        evs.forEach((ev, k) => {
          for (let a = 0; a < 4; a++) x!.valores![k]!.set(ev.enParte(l, XI[a]!, ETA[a]!, p), 32 * i + 8 * a + o);
        });
      });
      x.hechas!.add(p);
    }
    return x as { laminas: number[]; region: boolean[]; valores: Float64Array[] };
  }
}

/** Huella de un pilar circular, como polígono (la de `fondoModelo`). */
const circuloPilar = (c: Vec2, r: number, n = 32): Vec2[] => Array.from({ length: n }, (_, i) => [c[0] + r * Math.cos((2 * Math.PI * i) / n), c[1] + r * Math.sin((2 * Math.PI * i) / n)] as Vec2);

const punto = (c: Compilado, n: number): Vec2 => [c.modelo.nudos[n]!.x, c.modelo.nudos[n]!.y];

/** Contornos del modelo sobre un mapa: losas, paños, vigas y muros en línea; pilares rellenos. */
export function trazoModelo(pl: PlantaFisica): Primitiva[] {
  const P: Primitiva[] = [];
  const f = pl.f;
  for (const l of [...pl.enPlanta(f.losas), ...pl.enPlanta(f.panos)]) for (const a of [l.contorno, ...(l.huecos ?? [])]) P.push({ tipo: "linea", puntos: [...a, a[0]!] as Vec2[], estilo: "contorno", objeto: l.id });
  for (const [id, hs] of huellasVigasPlanta(pl)) for (const q of hs) P.push({ tipo: "linea", puntos: [...q, q[0]!], estilo: "contorno", objeto: id });
  for (const { m } of pl.muros()) for (const q of huellaMuro(m.puntos, m.espesor)) P.push({ tipo: "poligono", anillos: [q], estilo: "muro-llega", objeto: m.id });
  for (const { p, llega, seccion } of pl.pilares()) {
    const h = huellaSeccion(p, seccion);
    if (h && "anillo" in h) P.push({ tipo: "poligono", anillos: [h.anillo], estilo: llega ? "pilar-llega" : "pilar-arranca", objeto: p.id });
    else P.push({ tipo: "marca", p: ejeSeccion(p, seccion), forma: h ? "circulo" : "cuadrado", radio: 4, estilo: llega ? "pilar-llega" : "pilar-arranca", objeto: p.id });
  }
  return P;
}

export const cabecera = (pl: PlantaFisica, vista: string, d: DatosVista): string[] => {
  const p = pl.f.plantas[pl.k];
  return [`Planta ${pl.id}${p?.nombre ? ` (${p.nombre})` : ""}${pl.cota !== null ? `, cota ${pl.cota >= 0 ? "+" : ""}${rotulo(pl.cota, 4)} m` : ""}`, vista, `Huella ${d.huella.slice(0, 12)}`];
};

export function caja(pl: PlantaFisica): [number, number, number, number] {
  return cajaDe(
    fondoModelo(pl, { atenuado: true })
      .primitivas.filter((p) => p.tipo === "poligono" || p.tipo === "linea")
      .flatMap((p) => (p.tipo === "poligono" ? p.anillos.flat() : p.tipo === "linea" ? p.puntos : [])),
  );
}

// ─── Malla ──────────────────────────────────────────────────────────────────────────────────────

export function vistaMalla(r: ResultadosRender, planta: string, d: DatosVista): Escena {
  const pl = new PlantaFisica(r.q.fisico, planta);
  const c = r.c;
  const P: Primitiva[] = [];
  // Láminas rígidas: sus 4 nudos en un mismo enlace rígido (las huellas de los pilares, C2-d)
  const enlace = new Map<number, number>();
  (c.modelo.restricciones ?? []).forEach((x, k) => {
    if (x.tipo === "enlace-rigido") for (const n of [x.maestro, ...x.esclavos]) enlace.set(n, k);
  });
  const { laminas } = r.laminas(planta);
  let [rigidas, abacos] = [0, 0];
  for (const l of laminas) {
    const ns = c.modelo.laminas![l]!.nudos;
    const e = enlace.get(ns[0]);
    const rigida = e !== undefined && ns.every((n) => enlace.get(n) === e);
    const abaco = c.mapeo.laminas![l]!.abaco;
    rigidas += rigida ? 1 : 0;
    abacos += abaco ? 1 : 0;
    P.push({ tipo: "poligono", anillos: [ns.map((n) => punto(c, n))], estilo: rigida ? "malla-rigida" : abaco ? "malla-abaco" : "malla", objeto: c.mapeo.laminas![l]!.losa });
  }
  // Barras de las vigas y viguetas de la planta
  const piezas = new Set([...pl.enPlanta(pl.f.vigas).map((v) => v.id), ...pl.enPlanta(pl.f.panos).flatMap((p) => c.mapeo.panos?.[p.id] ?? [])]);
  let barras = 0;
  c.mapeo.barras.forEach((m, b) => {
    if (m.tipo === "pilar" || !piezas.has(m.pieza)) return;
    const [i, j] = c.modelo.barras![b]!.nudos;
    P.push({ tipo: "linea", puntos: [punto(c, i), punto(c, j)], estilo: "malla-barra", objeto: m.pieza });
    barras++;
  });
  const nudos = new Set<number>();
  for (const l of laminas) for (const n of c.modelo.laminas![l]!.nudos) nudos.add(n);
  for (const { p } of pl.pilares()) {
    const n = c.mapeo.nudosPilar[`${p.id}@${planta}`];
    if (n !== undefined) P.push({ tipo: "marca", p: punto(c, n), forma: "cuadrado", radio: 3, estilo: "pilar-llega", objeto: p.id });
  }
  const leyenda: EntradaLeyenda[] = [
    { estilo: "malla", texto: "Lámina de losa" },
    ...(abacos ? [{ estilo: "malla-abaco" as const, texto: "Lámina de ábaco" }] : []),
    ...(rigidas ? [{ estilo: "malla-rigida" as const, texto: "Lámina rígida (huella de pilar)" }] : []),
    ...(barras ? [{ estilo: "malla-barra" as const, texto: "Barra de viga o vigueta" }] : []),
    { estilo: "pilar-llega", texto: "Nudo de pilar" },
  ];
  const ejes = capaEjes(pl.f, { cotas: false });
  P.push(...ejes.primitivas);
  const apoyos = capaApoyos(pl, { rotulos: false });
  P.push(...apoyos.primitivas);
  leyenda.push(...apoyos.leyenda, ...ejes.leyenda);
  return {
    titulo: d.nombre ?? "Proyecto",
    cabecera: cabecera(pl, "Vista: malla", d),
    primitivas: P,
    leyenda,
    notas: [`${laminas.length} láminas (${rigidas} rígidas, ${abacos} de ábaco), ${barras} barras de vigas y viguetas y ${nudos.size} nudos de láminas en la planta.`, ...ejes.notas],
    extremos: [],
    caja: caja(pl),
  };
}

/**
 * La malla de una planta para dibujarla encima de un resultado (los diagramas, un mapa, el armado):
 * las aristas de sus láminas, una vez cada una, y los nudos de las barras de sus vigas y viguetas,
 * que es donde la losa les pasa sus fuerzas. Sin objeto: no se elige.
 */
export function capaMalla(r: ResultadosRender, planta: string): { primitivas: Primitiva[]; leyenda: EntradaLeyenda[]; notas: string[] } {
  const pl = new PlantaFisica(r.q.fisico, planta);
  const c = r.c;
  const P: Primitiva[] = [];
  const { laminas } = r.laminas(planta);
  const aristas = new Set<string>();
  for (const l of laminas) {
    const ns = c.modelo.laminas![l]!.nudos;
    for (let k = 0; k < ns.length; k++) {
      const [a, b] = [ns[k]!, ns[(k + 1) % ns.length]!];
      const clave = a < b ? `${a},${b}` : `${b},${a}`;
      if (aristas.has(clave)) continue;
      aristas.add(clave);
      P.push({ tipo: "linea", puntos: [punto(c, a), punto(c, b)], estilo: "malla-encima" });
    }
  }
  const piezas = new Set([...pl.enPlanta(pl.f.vigas).map((v) => v.id), ...pl.enPlanta(pl.f.panos).flatMap((p) => c.mapeo.panos?.[p.id] ?? [])]);
  const nudos = new Set<number>();
  c.mapeo.barras.forEach((m, b) => {
    if (m.tipo !== "pilar" && piezas.has(m.pieza)) for (const n of c.modelo.barras![b]!.nudos) nudos.add(n);
  });
  for (const n of [...nudos].sort((a, b) => a - b)) P.push({ tipo: "marca", p: punto(c, n), forma: "circulo", radio: 1.5, estilo: "malla-nudo-barra" });
  return {
    primitivas: P,
    leyenda: [
      ...(aristas.size ? [{ estilo: "malla-encima" as const, texto: "Malla de las losas" }] : []),
      ...(nudos.size ? [{ estilo: "malla-nudo-barra" as const, texto: "Nudo de viga o vigueta" }] : []),
    ],
    notas: [`Malla: ${laminas.length} láminas y ${nudos.size} nudos de vigas y viguetas en la planta.`],
  };
}

// ─── Isovalores ─────────────────────────────────────────────────────────────────────────────────

/** Un caso base suelto, en lugar de los factores de una combinación (VS3: para lo que es lineal y se combina después). */
export interface CasoBase {
  readonly base: number;
}
const esCasoBase = (f: ArrayLike<number> | CasoBase): f is CasoBase => typeof (f as CasoBase).base === "number";

/**
 * Un campo en los nudos de las láminas de una planta (4 por lámina), para una o muchas combinaciones.
 *
 * El valor de una combinación es su parte estática (Σ factor·valor de sus casos estáticos) más, por
 * cada caso del sismo, su factor por el valor del caso, que es la combinación de los modos en cada
 * nudo (VS3). Ni la parte estática ni el valor de un caso del sismo dependen de los demás factores,
 * así que se guardan (VS4): las 64 combinaciones de la situación sísmica son 2 partes estáticas (con
 * las variables o sin ellas) y 4 casos del sismo con su ± y su 30 %, y antes cada una volvía a
 * combinar los modos en cada nudo. Las cuentas son las mismas y en el mismo orden: los mismos números.
 */
class CampoPlanta {
  readonly laminas: number[];
  /** Valores por combinación: 4 por lámina. */
  readonly N: number;
  private readonly r: ResultadosRender;
  private readonly uz: boolean;
  private readonly comp: number;
  /** uz: el nudo de cada valor. Los demás: los campos de cada caso base (32 por lámina) y si la lámina tiene. */
  private readonly nudos: Int32Array | null = null;
  private readonly valores: readonly Float64Array[] | null = null;
  private readonly region: ArrayLike<unknown> | null = null;
  private readonly estaticas = new Map<string, Float64Array>();
  private readonly espectrales = new Map<CasoEspectral, Float64Array>();
  private readonly uzBase = new Map<number, Float64Array>();

  constructor(r: ResultadosRender, planta: string, campo: Campo, de: SuperficieMapa) {
    this.r = r;
    this.uz = campo === "uz";
    this.comp = campo === "uz" ? 0 : COMPONENTE[campo];
    if (this.uz) {
      const { laminas } = r.laminas(planta, de);
      this.laminas = laminas;
      this.nudos = new Int32Array(4 * laminas.length);
      laminas.forEach((l, i) => r.c.modelo.laminas![l]!.nudos.forEach((n, a) => (this.nudos![4 * i + a] = n)));
    } else {
      const { laminas, region, valores } = r.valores(planta, de, this.comp < 3 ? "membrana" : "flexion");
      this.laminas = laminas;
      this.region = region;
      this.valores = valores;
    }
    this.N = 4 * this.laminas.length;
  }

  /** La parte estática: Σ factor·valor de los casos base con factor (NaN donde la lámina no tiene campo). */
  private estatica(fl: Float64Array): Float64Array {
    const clave = fl.join(",");
    let v = this.estaticas.get(clave);
    if (v) return v;
    v = new Float64Array(this.N);
    if (this.nudos) {
      const casos = this.r.q.casos;
      for (let j = 0; j < this.N; j++) {
        const n = this.nudos[j]!;
        let s = 0;
        for (let k = 0; k < fl.length; k++) if (fl[k]) s += fl[k]! * casos[k]!.u[6 * n + 2]!;
        v[j] = s;
      }
    } else {
      const valores = this.valores!;
      const comp = this.comp;
      for (let j = 0; j < this.N; j++) {
        if (!this.region![j >> 2]) {
          v[j] = Number.NaN;
          continue;
        }
        let s = 0;
        for (let k = 0; k < fl.length; k++) if (fl[k]) s += fl[k]! * valores[k]![8 * j + comp]!;
        v[j] = s;
      }
    }
    this.estaticas.set(clave, v);
    return v;
  }

  /** El valor de un caso del sismo en cada nudo, sin su factor (uz, por μ). */
  private espectral(caso: CasoEspectral): Float64Array {
    let v = this.espectrales.get(caso);
    if (v) return v;
    const sup = this.r.q.sup;
    if (this.nudos) {
      // uz de cada modo en los nudos de las láminas, seguidos
      const nudos = this.nudos;
      const base = (k: number) => {
        let g = this.uzBase.get(k);
        if (!g) {
          const u = this.r.q.casos[k]!.u;
          g = new Float64Array(this.N);
          for (let j = 0; j < this.N; j++) g[j] = u[6 * nudos[j]! + 2]!;
          this.uzBase.set(k, g);
        }
        return g;
      };
      v = sup.espectralVector(caso, base, this.N, true);
    } else v = sup.espectralVector(caso, (k) => this.valores![k]!, this.N, false, this.comp, 8);
    this.espectrales.set(caso, v);
    return v;
  }

  /** Los valores de una combinación partida (`Superposicion.partes`), en `v` (N valores; uz, en mm). */
  de(partes: PartesCombinacion, v: Float64Array): void {
    const N = this.N;
    v.set(this.estatica(partes.lineal));
    if (partes.espectrales.length) {
      // Lo de los casos del sismo, sumado aparte y después a la parte estática (como siempre)
      const sismo = new Float64Array(N);
      for (const { factor, caso } of partes.espectrales) {
        const e = this.espectral(caso);
        for (let j = 0; j < N; j++) sismo[j]! += factor * e[j]!;
      }
      for (let j = 0; j < N; j++) v[j]! += sismo[j]!;
    }
    if (this.uz) for (let j = 0; j < N; j++) v[j] = v[j]! * 1000;
  }
}

/**
 * Valores del campo en los nudos de cada lámina (4 por lámina; NaN si no tiene) en una combinación
 * (los factores de los casos lógicos) o en un caso base. El visor interpola con ellos el valor de un punto.
 */
export function valoresCampo(r: ResultadosRender, planta: string, campo: Campo, f: ArrayLike<number> | CasoBase, de: SuperficieMapa = "losas"): { laminas: number[]; v: Float64Array } {
  // VS3: los factores son los de los casos lógicos; la parte lineal, como siempre, y la de los casos del sismo, combinada en cada nudo
  let partes: PartesCombinacion;
  if (esCasoBase(f)) {
    partes = { lineal: new Float64Array(r.q.nb), espectrales: [] };
    partes.lineal[f.base] = 1;
  } else partes = r.q.sup.partes(f);
  const c = new CampoPlanta(r, planta, campo, de);
  const v = new Float64Array(c.N);
  c.de(partes, v);
  return { laminas: c.laminas, v };
}

/** UI-1: con varias combinaciones, el mapa de su envolvente: en cada nudo de cada lámina, el mayor o el menor valor. */
export type Envolvente = "max" | "min";

/**
 * La envolvente de un campo en los nudos de las láminas de una planta (4 por lámina; NaN si no
 * tiene): en cada nudo, el máximo o el mínimo de las combinaciones del conjunto y la que lo da (la
 * primera, si empatan). Entre los nudos, el mapa la interpola: en una lámina queda por encima del
 * máximo de cada combinación (por debajo del mínimo), del lado de la seguridad.
 *
 * VS4: las combinaciones se recorren, pero sin rehacer en cada una lo que comparten (`CampoPlanta`):
 * cada una son unas sumas por nudo.
 */
export function envolventeCampo(r: ResultadosRender, planta: string, campo: Campo, conjunto: ConjuntoCombinaciones, cual: Envolvente, de: SuperficieMapa = "losas"): { laminas: number[]; v: Float64Array; comb: Int32Array } {
  const c = new CampoPlanta(r, planta, campo, de);
  const v = new Float64Array(c.N);
  const comb = new Int32Array(c.N);
  const x = new Float64Array(c.N);
  conjunto.factores.forEach((f, k) => {
    if (k === 0) return c.de(r.q.sup.partes(f), v);
    c.de(r.q.sup.partes(f), x);
    for (let j = 0; j < v.length; j++)
      if (cual === "max" ? x[j]! > v[j]! : x[j]! < v[j]!) {
        v[j] = x[j]!;
        comb[j] = k;
      }
  });
  return { laminas: c.laminas, v, comb };
}

/**
 * Qué extremos de un mapa se rotulan y cómo (UI-14): en uz, la flecha máxima (el mínimo, si baja) y
 * el levantamiento (el máximo, si sube), en positivo y con su flecha; en los demás, el máximo y el
 * mínimo. Con una envolvente, sólo el suyo.
 */
export function extremosMapa(campo: Campo, vmin: number, vmax: number, envolvente: Envolvente | null): { cual: "max" | "min"; que: string; texto: string }[] {
  const u = UNIDAD[campo];
  // R-21: decimales fijos, los de la app (con cifras significativas, «0,0985» en el dibujo y «0,10» en el panel)
  const d = DECIMALES_CAMPO[campo];
  const r: { cual: "max" | "min"; que: string; texto: string }[] = [];
  if (campo === "uz") {
    if (vmin < 0 && envolvente !== "max") r.push({ cual: "min", que: "flecha máxima", texto: `flecha máxima ${numeroFijo(-vmin, d)} mm ↓` });
    if (vmax > 0 && envolvente !== "min") r.push({ cual: "max", que: "levantamiento máximo", texto: `levantamiento máximo ${numeroFijo(vmax, d)} mm ↑` });
    return r;
  }
  if (envolvente !== "min") r.push({ cual: "max", que: `${campo} máximo`, texto: `máximo ${numeroFijo(vmax, d)} ${u}` });
  if (envolvente !== "max") r.push({ cual: "min", que: `${campo} mínimo`, texto: `mínimo ${numeroFijo(vmin, d)} ${u}` });
  return r;
}

/**
 * Mapa de isovalores de un campo en una planta. `escala` (`EscalaMapa`): la completa por defecto;
 * una no válida se cambia por la completa y se dice en las notas. Con varias combinaciones, la que da
 * el mayor |valor| en la planta o, con `envolvente`, la envolvente en cada nudo (UI-1).
 */
export function vistaCampo(r: ResultadosRender, planta: string, campo: Campo, conjunto: ConjuntoCombinaciones, d: DatosVista, escala: EscalaMapa = {}, envolvente?: Envolvente): Escena {
  const pl = new PlantaFisica(r.q.fisico, planta);
  const c = r.c;
  const env = envolvente && conjunto.factores.length > 1 ? envolvente : null;
  let laminas: number[];
  let v: Float64Array;
  // La combinación de cada nudo: la de la envolvente o, sin ella, la que gobierna en la planta
  let combNudo: Int32Array | null = null;
  let k0 = 0;
  if (env) ({ laminas, v, comb: combNudo } = envolventeCampo(r, planta, campo, conjunto, env));
  else {
    // La que gobierna en la planta: la del mayor |valor|
    let mejor: { k: number; m: number; laminas: number[]; v: Float64Array } = { k: 0, m: -1, laminas: [], v: new Float64Array() };
    conjunto.factores.forEach((f, k) => {
      const x = valoresCampo(r, planta, campo, f);
      let m = 0;
      for (const y of x.v) if (Math.abs(y) > m) m = Math.abs(y);
      if (m > mejor.m) mejor = { k, m, ...x };
    });
    ({ laminas, v, k: k0 } = mejor);
  }
  const comb = env ? "" : (conjunto.nombres[k0] ?? "");
  const combDe = (j: number) => (combNudo ? (conjunto.nombres[combNudo[j]!] ?? "") : comb);
  const P: Primitiva[] = [];
  const notas: string[] = [];
  // Triángulos y extremos
  const tris: Triangulo[] = [];
  let [vmin, vmax] = [Infinity, -Infinity];
  let [pmin, pmax]: [Vec2 | null, Vec2 | null] = [null, null];
  let [omin, omax] = ["", ""];
  let [jmin, jmax] = [0, 0];
  let sinMapa = 0;
  // Valores y pesos (un cuarto del área de la lámina por nudo), para la escala sin picos
  const valoresNudos: number[] = [];
  const pesos: number[] = [];
  laminas.forEach((l, i) => {
    const ns = c.modelo.laminas![l]!.nudos;
    const pts = ns.map((n) => punto(c, n)) as [Vec2, Vec2, Vec2, Vec2];
    const w = [0, 1, 2, 3].map((a) => v[4 * i + a]!);
    if (w.some(Number.isNaN)) {
      P.push({ tipo: "poligono", anillos: [pts], estilo: "sin-mapa" });
      sinMapa++;
      return;
    }
    const losa = c.mapeo.laminas![l]!.losa ?? "";
    w.forEach((x, a) => {
      if (x < vmin) [vmin, pmin, omin, jmin] = [x, pts[a]!, losa, 4 * i + a];
      if (x > vmax) [vmax, pmax, omax, jmax] = [x, pts[a]!, losa, 4 * i + a];
    });
    tris.push(...triangulosCuadrilatero(pts, w));
    const a4 = Math.abs(area(pts)) / 4;
    for (const x of w) {
      valoresNudos.push(x);
      pesos.push(a4);
    }
  });
  const leyenda: EntradaLeyenda[] = [];
  let mapa: Escena["mapa"];
  const u = UNIDAD[campo];
  const nulo = tris.length > 0 && Math.max(Math.abs(vmin), Math.abs(vmax)) < CAMPO_NULO;
  if (nulo) {
    for (const b of bandas(tris, LIMITES_NULO)) P.push({ tipo: "region", anillos: b.anillos, estilo: "isobanda", relleno: COLOR_NULO, banda: 0 });
    leyenda.push({ relleno: COLOR_NULO, texto: `0: campo nulo (|valor| < ${CAMPO_NULO})` });
    notas.push(`El campo es nulo en la planta: su mayor |valor| es ${Math.max(Math.abs(vmin), Math.abs(vmax)).toExponential(1)} ${u}, ruido de redondeo. No se rotulan extremos.`);
    mapa = { limites: [...LIMITES_NULO], paso: 2 * CAMPO_NULO, fueraAbajo: false, fueraArriba: false, picos: false, minimo: vmin, maximo: vmax, nulo: true, ...(env ? { envolvente: env } : { combinacion: comb }) };
    [pmax, pmin] = [null, null];
  } else if (tris.length) {
    const robusto = rangoSinPicos(valoresNudos, pesos);
    let lm = limitesMapa(vmin, vmax, escala, robusto);
    if ("error" in lm) {
      notas.push(`Escala no válida (${lm.error}): se dibuja la completa.`);
      lm = limitesMapa(vmin, vmax) as LimitesMapa;
    }
    const { L, fueraAbajo, fueraArriba } = lm;
    const colores = coloresBandas(L, { abajo: fueraAbajo, arriba: fueraArriba });
    const nb = L.length - 1;
    const [x0, y0, x1, y1] = cajaDe(tris.flatMap((t) => t.p));
    const pasoRayado = Math.max(x1 - x0, y1 - y0) / 120;
    for (const b of bandas(tris, L)) {
      P.push({ tipo: "region", anillos: b.anillos, estilo: "isobanda", relleno: colores[b.banda]!, banda: b.banda });
      // Las de fuera de la escala, rayadas
      if ((fueraAbajo && b.banda === 0) || (fueraArriba && b.banda === nb - 1)) for (const [p, q] of rayado(b.anillos, [Math.SQRT1_2, Math.SQRT1_2], pasoRayado)) P.push({ tipo: "linea", puntos: [p, q], estilo: "fuera-escala" });
    }
    // Las isolíneas de los límites, rotuladas con su valor; la del 0, más gruesa
    let cero = false;
    for (const iso of isolineas(tris, L)) {
      const estilo = iso.valor === 0 ? "isolinea-cero" : "isolinea";
      cero ||= iso.valor === 0;
      for (const puntos of iso.lineas) P.push({ tipo: "linea", puntos, estilo, rotulo: rotulo(iso.valor, 4) });
    }
    for (let b = nb - 1; b >= 0; b--) {
      const texto = fueraArriba && b === nb - 1 ? `más de ${rotulo(L[b]!, 4)} (fuera de la escala, rayado)` : fueraAbajo && b === 0 ? `menos de ${rotulo(L[1]!, 4)} (fuera de la escala, rayado)` : `${rotulo(L[b]!, 4)} a ${rotulo(L[b + 1]!, 4)}`;
      leyenda.push({ relleno: colores[b]!, texto });
    }
    leyenda.push({ estilo: "isolinea", texto: "Isolínea en cada límite, con su valor" });
    if (cero) leyenda.push({ estilo: "isolinea-cero", texto: "Isolínea de valor 0" });
    const dentro = L.slice(fueraAbajo ? 1 : 0, fueraArriba ? nb : nb + 1);
    if (fueraAbajo || fueraArriba) notas.push(`Escala de ${rotulo(dentro[0]!, 4)} a ${rotulo(dentro[dentro.length - 1]!, 4)} ${u}${escala.modo === "sin-picos" ? `, sin picos (sin el ${rotulo(FRACCION_PICOS * 100)} % del área por cada lado)` : ""}: lo de fuera, rayado. Los extremos rotulados son los reales.`);
    // Picos: con la escala completa, si unos pocos puntos marcan la escala, se dice
    const picos = !!robusto && !(fueraAbajo || fueraArriba) && Math.max(Math.abs(vmin), Math.abs(vmax)) > AVISO_PICOS * Math.max(Math.abs(robusto[0]), Math.abs(robusto[1]));
    if (picos) notas.push(`La escala la marcan picos en menos del ${rotulo(2 * FRACCION_PICOS * 100)} % del área (hasta ${rotulo(Math.abs(vmin) > Math.abs(vmax) ? vmin : vmax)} ${u}); sin ellos, el campo va de ${rotulo(robusto![0])} a ${rotulo(robusto![1])} ${u} (escala «sin picos»).`);
    mapa = { limites: dentro, paso: lm.paso, fueraAbajo, fueraArriba, picos, minimo: vmin, maximo: vmax, ...(robusto ? { sinPicos: robusto } : {}), ...(env ? { envolvente: env } : { combinacion: comb }) };
  }
  P.push(...trazoModelo(pl));
  const ejes = capaEjes(pl.f, { cotas: false });
  P.push(...ejes.primitivas);
  notas.push(...ejes.notas);
  const apoyos = capaApoyos(pl, { rotulos: false });
  P.push(...apoyos.primitivas);
  leyenda.push(...apoyos.leyenda);
  const extremos: ExtremoRotulado[] = [];
  if (pmax && pmin) {
    for (const ex of extremosMapa(campo, vmin, vmax, env)) {
      const [x, p, o, j] = ex.cual === "max" ? [vmax, pmax, omax, jmax] : [vmin, pmin, omin, jmin];
      const [estilo, dy] = ex.cual === "max" ? (["extremo-maximo", -10] as const) : (["extremo-minimo", 20] as const);
      P.push({ tipo: "marca", p, forma: "circulo", radio: 6, estilo, objeto: o });
      P.push({ tipo: "texto", p, texto: env ? `${ex.texto} (${combDe(j)})` : ex.texto, tamano: 13, negrita: true, dx: 9, dy, fondo: true, prioridad: 100, alternativas: [{ dx: -9, dy, ancla: "fin" }], objeto: o });
      extremos.push({ que: ex.que, valor: x, unidad: u, objeto: o, punto: p, comb: combDe(j) });
    }
  }
  const paños = pl.enPlanta(pl.f.panos);
  if (paños.length) notas.push(`Los paños (${paños.map((p) => p.id).join(", ")}) no tienen láminas: sus viguetas, con «fem consultar pieza».`);
  if (sinMapa) notas.push(`${sinMapa} láminas sin mapa (gris): las rígidas de las huellas de los pilares, que no se deforman.`);
  if (!laminas.length) notas.push("La planta no tiene losas.");
  if (campo === "uz") notas.push("Valores en los nudos de las láminas, interpolados en cada una como en un cuadrilátero bilineal; negativos hacia abajo (la flecha). La flecha relativa de cada recuadro, con «fem consultar flechas».");
  else if (campo.startsWith("f")) notas.push(NOTA_MEMBRANA);
  else notas.push("Campos suavizados (SPR) en los nudos de cada lámina, en los ejes de su losa (eje 1 = su eje1, X por defecto), interpolados en cada una como en un cuadrilátero bilineal. Para dimensionar, las franjas de armado (modo Armado).");
  if (env && laminas.length) notas.push(`Envolvente ${env === "max" ? "máxima" : "mínima"} de las ${conjunto.factores.length} combinaciones de ${conjunto.descripcion}: en cada nudo de cada lámina, la de ${env === "max" ? "mayor" : "menor"} valor, interpolada en la lámina (entre los nudos queda del lado de la seguridad). El extremo rotulado, con la suya.`);
  else if (conjunto.factores.length > 1) notas.push(`Combinación ${comb}: la del mayor |valor| en la planta de las ${conjunto.factores.length} de ${conjunto.descripcion}.`);
  return {
    titulo: d.nombre ?? "Proyecto",
    cabecera: cabecera(pl, `Vista: ${NOMBRE[campo]}`, d).map((x, i) => (i === 1 ? `${x}; ${env ? `envolvente ${env === "max" ? "máxima" : "mínima"} de ${conjunto.descripcion} (${conjunto.factores.length})` : `combinación ${conjunto.etiquetas[k0] ?? comb}`}` : x)),
    primitivas: P,
    leyenda,
    notas,
    extremos,
    caja: caja(pl),
    ...(mapa ? { mapa } : {}),
  };
}

// ─── Diagramas de vigas ─────────────────────────────────────────────────────────────────────────

/**
 * Punto y dirección en planta de la estación s de una pieza, por sus barras (vigas y viguetas): sobre
 * la recta del tramo flexible de cada barra (i', j'), también en sus zonas rígidas. Los nudos de la
 * barra pueden no estar en el eje (un pilar o un muro unidos por un offset).
 */
function geometriaPieza(r: ResultadosRender, pieza: string): (s: number) => { p: Vec2; d: Vec2 } {
  const c = r.c;
  const tramos = (c.mapeo.piezas[pieza] ?? []).map((b) => {
    const s = c.mapeo.barras[b]!.s;
    const { ip, jp } = r.ep.diagramas.barra(b);
    return { s3: s[3], s1: s[1], s2: s[2], a: [ip[0]!, ip[1]!] as Vec2, b: [jp[0]!, jp[1]!] as Vec2 };
  });
  return (s) => {
    const t = tramos.find((x) => s <= x.s3 + 1e-9) ?? tramos[tramos.length - 1]!;
    const l = Math.hypot(t.b[0] - t.a[0], t.b[1] - t.a[1]) || 1;
    const d: Vec2 = [(t.b[0] - t.a[0]) / l, (t.b[1] - t.a[1]) / l];
    const u = t.s2 > t.s1 ? (s - t.s1) / (t.s2 - t.s1) : 0;
    return { p: [t.a[0] + u * (t.b[0] - t.a[0]), t.a[1] + u * (t.b[1] - t.a[1])], d };
  };
}

/** Un punto de la envolvente de un esfuerzo a lo largo de una pieza (en un salto, uno por cada lado). */
export interface PuntoEnvolvente {
  s: number;
  max: number;
  min: number;
}

/**
 * Envolvente de la componente `comp` de [N, Vy, Vz, T, My, Mz] a lo largo de una pieza, por tramos
 * flexibles: en las estaciones de su diagrama en cada combinación (las de `Consultas.diagrama`) y en
 * DIVISIONES partes iguales, por los dos lados de cada estación.
 */
export function envolventePieza(r: ResultadosRender, id: string, conjunto: ConjuntoCombinaciones, comp: number): PuntoEnvolvente[] {
  const curva: PuntoEnvolvente[] = [];
  for (const t of r.ep.tramos(id))
    for (const e of envolventeTramo(r, t, conjunto, comp)) {
      const prev = curva[curva.length - 1];
      if (prev && prev.s === e.s && prev.max === e.max && prev.min === e.min) continue;
      curva.push(e);
    }
  return curva;
}

/**
 * La envolvente de un tramo flexible (la parte de `envolventePieza` de ese tramo, con las mismas
 * estaciones). `comp`: una componente de [N, Vy, Vz, T, My, Mz] o una combinación lineal de ellas,
 * [componente, coeficiente]… (el momento en el plano de un alzado, que combina My, Mz y T).
 */
export function envolventeTramo(r: ResultadosRender, t: TramoFlexible, conjunto: ConjuntoCombinaciones, comp: number | readonly (readonly [number, number])[]): PuntoEnvolvente[] {
  const curva: PuntoEnvolvente[] = [];
  const D = conjunto.factores.map((f) => r.q.diagramaBarra(t.barra, f));
  const L = t.s1 - t.s0;
  const xs = [...new Set([...D.flatMap((x) => x.estaciones()), ...Array.from({ length: DIVISIONES + 1 }, (_, i) => (L * i) / DIVISIONES)])].filter((x) => x >= 0 && x <= L).sort((a, b) => a - b);
  // Con varias componentes ([c, k]…), su combinación lineal: en una combinación con casos del sismo, la de cada modo, combinada
  const valor = typeof comp === "number" ? (dg: DiagramaLeible, x: number, lado: -1 | 1) => dg.esfuerzosEn(x, lado)[comp]! : (dg: DiagramaLeible, x: number, lado: -1 | 1) => esfuerzoProyectado(dg, x, lado, comp);
  for (const x of xs)
    for (const lado of [-1, 1] as const) {
      if ((x === 0 && lado < 0) || (x === L && lado > 0)) continue;
      const vs = D.map((dg) => valor(dg, x, lado));
      const e = { s: t.s0 + x, max: Math.max(...vs), min: Math.min(...vs) };
      const prev = curva[curva.length - 1];
      if (prev && prev.s === e.s && prev.max === e.max && prev.min === e.min) continue;
      curva.push(e);
    }
  return curva;
}

export function vistaDiagramas(r: ResultadosRender, planta: string, esfuerzo: "My" | "Vz", conjunto: ConjuntoCombinaciones, d: DatosVista): Escena {
  const pl = new PlantaFisica(r.q.fisico, planta);
  const c = r.c;
  const q = r.q;
  const comp = esfuerzo === "My" ? 4 : 2;
  const fondo = fondoModelo(pl, { atenuado: true });
  const P: Primitiva[] = [...fondo.primitivas];
  const piezas = [...pl.enPlanta(pl.f.vigas).map((v) => v.id), ...pl.enPlanta(pl.f.panos).flatMap((p) => c.mapeo.panos?.[p.id] ?? [])];
  const curvas = piezas.map((id) => ({ pieza: id, curva: envolventePieza(r, id, conjunto, comp) }));
  const maxAbs = Math.max(0, ...curvas.flatMap((x) => x.curva.map((e) => Math.max(Math.abs(e.max), Math.abs(e.min)))));
  const [x0, y0, x1, y1] = caja(pl);
  const k = maxAbs > 0 ? (ORDENADA * Math.hypot(x1 - x0, y1 - y0)) / maxAbs : 0;
  const geo = new Map<string, ReturnType<typeof geometriaPieza>>();
  const g = (id: string) => geo.get(id) ?? geo.set(id, geometriaPieza(r, id)).get(id)!;
  // Lado de los positivos, como en el alzado: con la pieza leída en X creciente (o en Y creciente si
  // va más en Y), My > 0 a su derecha (abajo en las vigas en X) y Vz > 0 a su izquierda (arriba).
  const lados = new Map<string, number>();
  const lado = (id: string): number => {
    let l = lados.get(id);
    if (l === undefined) {
      const ts = r.ep.tramos(id);
      let [dx, dy] = [0, 0];
      if (ts.length) {
        const [a, b] = [g(id)(ts[0]!.s0).p, g(id)(ts[ts.length - 1]!.s1).p];
        [dx, dy] = [b[0] - a[0], b[1] - a[1]];
        if (Math.hypot(dx, dy) < 1e-9) [dx, dy] = g(id)(ts[0]!.s0).d;
      }
      const directa = Math.abs(dx) >= Math.abs(dy) ? dx > 0 : dy > 0;
      l = (directa ? 1 : -1) * (esfuerzo === "My" ? -1 : 1);
      lados.set(id, l);
    }
    return l;
  };
  /** La ordenada v en planta: a la izquierda de la barra si `lado` y v tienen el mismo signo. */
  const ordenada = (id: string, s: number, v: number): Vec2 => {
    const { p, d: dir } = g(id)(s);
    const f = lado(id) * v * k;
    return [p[0] - dir[1] * f, p[1] + dir[0] * f];
  };
  // Lo que dimensiona: el máximo donde es positivo y el mínimo donde es negativo (si no, las dos
  // áreas se pisan donde tienen el mismo signo). Con el punto donde cruzan el cero, para no quebrar el borde.
  const recortada = (curva: PuntoEnvolvente[], cual: "max" | "min"): { s: number; v: number }[] => {
    const lado = (v: number) => (cual === "max" ? Math.max(v, 0) : Math.min(v, 0));
    const r: { s: number; v: number }[] = [];
    curva.forEach((e, k) => {
      const a = curva[k - 1];
      if (a && a[cual] !== 0 && e[cual] !== 0 && Math.sign(a[cual]) !== Math.sign(e[cual]) && e.s > a.s) r.push({ s: a.s + ((e.s - a.s) * a[cual]) / (a[cual] - e[cual]), v: 0 });
      r.push({ s: e.s, v: lado(e[cual]) });
    });
    return r;
  };
  for (const { pieza, curva } of curvas) {
    if (curva.length < 2) continue;
    const eje = [g(pieza)(curva[0]!.s).p, g(pieza)(curva[curva.length - 1]!.s).p];
    for (const [cual, estilo] of [
      ["max", "diagrama-positivo"],
      ["min", "diagrama-negativo"],
    ] as const) {
      const r = recortada(curva, cual);
      if (r.every((e) => e.v === 0)) continue;
      const pts = r.map((e) => ordenada(pieza, e.s, e.v));
      P.push({ tipo: "poligono", anillos: [[eje[0]!, ...pts, eje[1]!]], estilo, objeto: pieza });
    }
    P.push({ tipo: "linea", puntos: eje as Vec2[], estilo: "diagrama-eje", objeto: pieza });
  }
  // Extremos de cada vano, de Consultas.vano en cada combinación
  const extremos: ExtremoRotulado[] = [];
  const unidad = esfuerzo === "My" ? "kN·m" : "kN";
  for (const id of piezas) {
    const v = q.viga(id);
    if (!v.valido) continue;
    v.valor.vanos.forEach((_, i) => {
      let mx: { v: number; s: number; comb: string } | null = null;
      let mn: { v: number; s: number; comb: string } | null = null;
      conjunto.factores.forEach((f, kc) => {
        const e = q.vano(id, i, f);
        if (!e.valido) return;
        const [a, b] = esfuerzo === "My" ? [e.valor.maxMy, e.valor.minMy] : [e.valor.maxVz, e.valor.minVz];
        if (!mx || a.valor > mx.v) mx = { v: a.valor, s: a.s, comb: conjunto.nombres[kc]! };
        if (!mn || b.valor < mn.v) mn = { v: b.valor, s: b.s, comb: conjunto.nombres[kc]! };
      });
      for (const [que, e, color] of [
        ["máximo", mx, "#b91c1c"],
        ["mínimo", mn, "#1d4ed8"],
      ] as const) {
        const x = e as { v: number; s: number; comb: string } | null;
        if (!x || x.v === 0 || (que === "máximo" && x.v < 0) || (que === "mínimo" && x.v > 0)) continue;
        const p = ordenada(id, x.s, x.v);
        const arriba = p[1] >= g(id)(x.s).p[1];
        P.push({ tipo: "texto", p, texto: rotulo(x.v), tamano: 11, color, fondo: true, ancla: "medio", dy: arriba ? -3 : 12, prioridad: Math.abs(x.v) / (maxAbs || 1) * 50 + 10, objeto: id });
        extremos.push({ que: `${esfuerzo} ${que} del vano ${i + 1}`, valor: x.v, unidad, objeto: id, punto: g(id)(x.s).p, comb: x.comb });
      }
    });
  }
  const ordenados = [...extremos].sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
  return {
    titulo: d.nombre ?? "Proyecto",
    cabecera: cabecera(pl, `Vista: ${esfuerzo} de vigas y viguetas (${unidad}), envolvente de ${conjunto.descripcion}`, d),
    primitivas: P,
    leyenda: [
      { estilo: "diagrama-positivo", texto: `Envolvente máxima de ${esfuerzo} donde es positiva: ${esfuerzo === "My" ? "abajo en las piezas en X y a la derecha en las piezas en Y" : "arriba en las piezas en X y a la izquierda en las piezas en Y"}` },
      { estilo: "diagrama-negativo", texto: `Envolvente mínima de ${esfuerzo} donde es negativa, al otro lado (como en el alzado); las dos curvas enteras, en el alzado y en la tabla de la pieza` },
    ],
    notas: [
      esfuerzo === "My" ? "My > 0 tracciona la cara inferior (momento de vano)." : "Vz: cortante vertical de la pieza, con el convenio de las barras.",
      `Escala: ${rotulo(maxAbs)} ${unidad} = ${rotulo(k * maxAbs)} m. Rotulados, el máximo y el mínimo de cada vano (de «fem consultar pieza»).`,
      ...(ordenados.length ? [`Mayor |${esfuerzo}| de la planta: ${rotulo(ordenados[0]!.valor)} ${unidad} en ${ordenados[0]!.objeto}.`] : ["La planta no tiene vigas ni viguetas."]),
    ],
    extremos: ordenados,
    caja: caja(pl),
  };
}

// ─── Axiles de pilares ──────────────────────────────────────────────────────────────────────────

export function vistaAxiles(r: ResultadosRender, planta: string, conjunto: ConjuntoCombinaciones, d: DatosVista): Escena {
  const pl = new PlantaFisica(r.q.fisico, planta);
  const q = r.q;
  const fondo = fondoModelo(pl, { atenuado: true });
  const P: Primitiva[] = [...fondo.primitivas];
  const datos: { id: string; p: Vec2; huella: ReturnType<typeof huellaSeccion>; min: { v: number; comb: string }; max: { v: number; comb: string } }[] = [];
  for (const { p, llega, seccion } of pl.pilares()) {
    if (!llega) continue;
    const t = q.pilar(p.id);
    if (!t.valido) continue;
    const tramo = t.valor.find((x) => x.planta === planta);
    if (!tramo) continue;
    let min = { v: Infinity, comb: "" };
    let max = { v: -Infinity, comb: "" };
    conjunto.factores.forEach((f, kc) => {
      for (const e of [tramo.base.esfuerzos, tramo.cabeza.esfuerzos]) {
        const n = q.combinar(e, 6, f)[0]!;
        if (n < min.v) min = { v: n, comb: conjunto.nombres[kc]! };
        if (n > max.v) max = { v: n, comb: conjunto.nombres[kc]! };
      }
    });
    datos.push({ id: p.id, p: ejeSeccion(p, seccion), huella: huellaSeccion(p, seccion), min, max });
  }
  const extremos: ExtremoRotulado[] = [];
  for (const x of datos) {
    // La huella del pilar a escala, del color del signo del mayor |N|; el rótulo, junto a una esquina
    const n = Math.abs(x.min.v) >= Math.abs(x.max.v) ? x.min.v : x.max.v;
    const estilo = n < 0 ? "diagrama-negativo" : "diagrama-positivo";
    const h = x.huella;
    if (!h) P.push({ tipo: "marca", p: x.p, forma: "cuadrado", radio: 4, estilo, objeto: x.id });
    else P.push({ tipo: "poligono", anillos: ["anillo" in h ? h.anillo : circuloPilar(h.centro, h.radio)], estilo, objeto: x.id });
    const [px, py] = x.p;
    const r = h ? ("anillo" in h ? Math.max(...h.anillo.map((q) => Math.max(Math.abs(q[0] - px), Math.abs(q[1] - py)))) : h.radio) : 0;
    P.push({
      tipo: "texto",
      p: [px + r, py + r],
      // R-21: N en kN con un decimal, como el cuadro de pilares de la app
      texto: `${x.id} ${numeroFijo(n, 1)}`,
      tamano: 11,
      dx: 3,
      dy: -3,
      fondo: true,
      prioridad: 50,
      alternativas: [
        { p: [px - r, py + r], dx: -3, dy: -3, ancla: "fin" },
        { p: [px + r, py - r], dx: 3, dy: 13 },
        { p: [px - r, py - r], dx: -3, dy: 13, ancla: "fin" },
      ],
      objeto: x.id,
    });
    extremos.push({ que: "N mínimo del tramo", valor: x.min.v, unidad: "kN", objeto: x.id, punto: x.p, comb: x.min.comb });
    extremos.push({ que: "N máximo del tramo", valor: x.max.v, unidad: "kN", objeto: x.id, punto: x.p, comb: x.max.comb });
  }
  return {
    titulo: d.nombre ?? "Proyecto",
    cabecera: cabecera(pl, `Vista: axil de los tramos de pilar que llegan a la planta (kN), envolvente de ${conjunto.descripcion}`, d),
    primitivas: P,
    leyenda: [
      { estilo: "diagrama-negativo", texto: "Compresión (N < 0)" },
      { estilo: "diagrama-positivo", texto: "Tracción (N > 0)" },
    ],
    notas: [`Rótulo: pilar y su mayor |N| del tramo (en su base y su cabeza, sobre todas las combinaciones). N > 0 es tracción. El mínimo y el máximo de cada tramo, en el cuadro de la planta.`, ...(datos.length ? [] : ["Ningún pilar llega a esta planta."])],
    extremos: extremos.sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor)),
    caja: caja(pl),
  };
}

export { NOMBRE as NOMBRES_CAMPO, UNIDAD as UNIDADES_CAMPO };
