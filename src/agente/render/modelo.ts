/**
 * Vistas del modelo físico de una planta (A4): `modelo`, `cargas` y `diagnosticos`. Sólo necesitan
 * el modelo físico, así que se dibujan también si no compila: toda búsqueda (planta, sección,
 * losa…) es defensiva, y lo que no se puede situar va a las notas.
 *
 * Qué hay en una planta:
 * - sus losas, paños, vigas, apoyos, apoyos lineales y bandas (`planta` = la planta);
 * - los pilares y muros que llegan a ella desde abajo (un tramo con la cabeza en ella), rellenos, y
 *   los que sólo arrancan de ella hacia arriba (su base), en contorno.
 *
 * Puro: sin IO.
 */
import { cotasPlantas } from "../../compilador/cotas.ts";
import type { CargaFisica, Losa, ModeloFisico, Muro, PanoUnidireccional, Pilar, Seccion, Vec2 } from "../../compilador/fisico.ts";
import type { Diagnostico } from "../../motor/diagnosticos.ts";
import { capaEjes } from "./ejes.ts";
import { bandaPolilinea, cajaDe, longitud, puntoEnPolilinea, puntoInterior, puntosDe, rayado, rotulo, type EntradaLeyenda, type Escena, type Estilo, type Primitiva } from "./escena.ts";

export const VISTAS_MODELO = ["modelo", "cargas", "diagnosticos"] as const;

/** Por id: el orden de dibujo (y con él el SVG y qué rótulo gana un solape) no depende del de las listas. */
export const porId = <T extends { id: string }>(xs: readonly T[]): T[] => [...xs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** Lo que una vista necesita de la planta: qué hay en ella y dónde, por id. */
export class PlantaFisica {
  readonly f: ModeloFisico;
  readonly id: string;
  readonly k: number;
  readonly cota: number | null;
  private readonly indice = new Map<string, number>();
  private readonly cotas: (number | null)[];

  constructor(f: ModeloFisico, planta: string) {
    this.f = f;
    this.id = planta;
    (f.plantas ?? []).forEach((p, i) => this.indice.set(p.id, i));
    this.k = this.indice.get(planta) ?? -1;
    this.cotas = cotasPlantas(f.plantas ?? []);
    this.cota = this.cotas[this.k] ?? null;
  }

  /** ¿Llega a la planta desde abajo (cabeza de un tramo en ella)? ¿Arranca de ella hacia arriba? Las plantas van de arriba abajo. */
  vertical(x: { desde: string; hasta: string }): { llega: boolean; arranca: boolean } {
    const a = this.indice.get(x.desde);
    const b = this.indice.get(x.hasta);
    if (a === undefined || b === undefined) return { llega: false, arranca: false };
    return { llega: b <= this.k && this.k < a, arranca: this.k === a && b < a };
  }

  /** Cota de una planta por su id. */
  cotaDe(id: string): number | null {
    const i = this.indice.get(id);
    return i === undefined ? null : (this.cotas[i] ?? null);
  }

  /** Cota de la planta de debajo de esta (null si es la más baja). */
  get cotaDebajo(): number | null {
    return this.cotas[this.k + 1] ?? null;
  }

  pilares(): { p: Pilar; llega: boolean; seccion: Seccion | undefined }[] {
    const r: { p: Pilar; llega: boolean; seccion: Seccion | undefined }[] = [];
    for (const p of porId(this.f.pilares ?? [])) {
      const { llega, arranca } = this.vertical(p);
      if (!llega && !arranca) continue;
      // La sección del tramo con la cabeza aquí (si llega) o en la planta de encima (si arranca)
      const cabeza = llega ? this.id : this.f.plantas[this.k - 1]?.id;
      const sid = p.tramos?.find((t) => t.planta === cabeza)?.seccion ?? p.seccion;
      r.push({ p, llega, seccion: this.f.secciones?.find((s) => s.id === sid) });
    }
    return r;
  }

  muros(): { m: Muro; llega: boolean }[] {
    const r: { m: Muro; llega: boolean }[] = [];
    for (const m of porId(this.f.muros ?? [])) {
      const { llega, arranca } = this.vertical(m);
      if (llega || arranca) r.push({ m, llega });
    }
    return r;
  }

  enPlanta<T extends { planta: string; id: string }>(xs: readonly T[] | undefined): T[] {
    return porId((xs ?? []).filter((x) => x.planta === this.id));
  }
}

/** Huella en planta de la sección de un pilar (null si no se conoce): anillo o círculo. */
export function huellaSeccion(p: Pilar, s: Seccion | undefined): { anillo: Vec2[] } | { centro: Vec2; radio: number } | null {
  if (!s) return null;
  if (s.forma === "circular") return { centro: [p.x, p.y], radio: s.D / 2 };
  const [b, h] =
    s.forma === "rectangular" ? [s.b, s.h] : s.forma === "T" ? [s.bf, s.h] : s.forma === "I" ? [s.perfil.b * 1e-3, s.perfil.h * 1e-3] : s.b !== undefined && s.h !== undefined ? [s.b, s.h] : [0, 0];
  if (!(b > 0 && h > 0)) return null;
  // Canto h según ez (giro desde +X), ancho b según ey = (s, −c) (cabecera de fisico.ts)
  const g = (((p.giro ?? 0) % 360) + 360) % 360;
  const q = g / 90;
  const [c, sn] = Number.isInteger(q) ? ([[1, 0], [0, 1], [-1, 0], [0, -1]][q] as [number, number]) : [Math.cos((g * Math.PI) / 180), Math.sin((g * Math.PI) / 180)];
  const ez: Vec2 = [c, sn];
  const ey: Vec2 = [sn, -c];
  const esquina = (u: number, v: number): Vec2 => [p.x + (u * h * ez[0]) / 2 + (v * b * ey[0]) / 2, p.y + (u * h * ez[1]) / 2 + (v * b * ey[1]) / 2];
  return { anillo: [esquina(-1, -1), esquina(1, -1), esquina(1, 1), esquina(-1, 1)] };
}

/** Ancho en planta de la sección de una viga (0 si no se conoce). */
export function anchoViga(s: Seccion | undefined): number {
  if (!s) return 0;
  switch (s.forma) {
    case "rectangular":
      return s.b;
    case "T":
      return s.bw;
    case "circular":
      return s.D;
    case "I":
      return s.perfil.b * 1e-3;
    case "general":
      return s.b ?? 0;
  }
}

/**
 * Rótulo junto a una pieza de ancho `ancho` (m): a lo largo de ella, por encima de su borde (en los
 * ejes del texto) y, si no cabe, por debajo.
 */
function alLado(p: Vec2, d: Vec2, ancho: number): { p: Vec2; opciones: Partial<Extract<Primitiva, { tipo: "texto" }>> } {
  const g = giroTexto(d);
  const n: Vec2 = [-Math.sin((g * Math.PI) / 180), Math.cos((g * Math.PI) / 180)];
  const m = ancho / 2;
  return {
    p: [p[0] + n[0] * m, p[1] + n[1] * m],
    opciones: { giro: g, ancla: "medio", dy: -3, fondo: true, alternativas: [{ p: [p[0] - n[0] * m, p[1] - n[1] * m], dy: 12, ancla: "medio" }] },
  };
}

/** Ángulo de un texto a lo largo de una dirección, en (−90°, 90°]. */
export function giroTexto(d: Vec2): number {
  let a = (Math.atan2(d[1], d[0]) * 180) / Math.PI;
  if (a > 90) a -= 180;
  if (a <= -90) a += 180;
  return Math.round(a * 1000) / 1000;
}

/**
 * Sección y dirección del canto de un pilar rectangular no cuadrado, para su rótulo: a la escala de
 * un edificio entero la huella mide unos pocos px y no se ve hacia dónde va el canto h.
 */
function orientacion(p: Pilar, s: Seccion | undefined): string {
  const h = huellaSeccion(p, s);
  if (!h || !("anillo" in h) || !s) return "";
  const [a0, a1, a2] = h.anillo as [Vec2, Vec2, Vec2];
  if (Math.abs(Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) - Math.hypot(a2[0] - a1[0], a2[1] - a1[1])) < 1e-9) return "";
  const g = ((((p.giro ?? 0) % 180) + 180) % 180);
  return ` ${SECCION(s)} ${g === 0 ? "hX" : g === 90 ? "hY" : `h${rotulo(g)}°`}`;
}

const SECCION = (s: Seccion | undefined): string => {
  if (!s) return "";
  switch (s.forma) {
    case "rectangular":
      return `${rotulo(s.b * 100)}×${rotulo(s.h * 100)}`;
    case "circular":
      return `Ø${rotulo(s.D * 100)}`;
    case "T":
      return `T ${rotulo(s.bf * 100)}×${rotulo(s.h * 100)}`;
    default:
      return s.id;
  }
};

// ─── Fondo: el modelo de la planta ──────────────────────────────────────────────────────────────

interface OpcionesFondo {
  /** Todo en gris, sin rótulos (el fondo de las cargas y los diagnósticos). Los ejes de replanteo no cambian. */
  atenuado: boolean;
  /** Las cadenas de cotas entre ejes (sólo en la vista `modelo`). */
  cotas?: boolean;
}

/** Las primitivas del modelo de la planta y las entradas de su leyenda. */
export function fondoModelo(pl: PlantaFisica, o: OpcionesFondo): { primitivas: Primitiva[]; leyenda: EntradaLeyenda[]; notas: string[] } {
  const f = pl.f;
  const P: Primitiva[] = [];
  const usados = new Set<Estilo>();
  const est = (e: Estilo): Estilo => {
    const r = o.atenuado ? (["pano-viguetas", "vigueta", "apoyo-lineal", "banda", "hueco-aspa"].includes(e) ? "atenuado-linea" : "atenuado") : e;
    usados.add(r);
    return r;
  };
  const texto = (p: Vec2, t: string, prioridad: number, extra: Partial<Extract<Primitiva, { tipo: "texto" }>> = {}) => {
    if (!o.atenuado) P.push({ tipo: "texto", p, texto: t, tamano: 12, prioridad, clase: "id", ...extra });
  };
  const notas: string[] = [];

  // Losas y paños
  for (const l of pl.enPlanta(f.losas)) {
    const anillos = [l.contorno as Vec2[], ...((l.huecos ?? []) as Vec2[][])];
    P.push({ tipo: "poligono", anillos, estilo: est(l.reticular ? "losa-reticular" : "losa"), objeto: l.id });
    for (const a of l.reticular?.abacos ?? []) P.push({ tipo: "poligono", anillos: [a as Vec2[]], estilo: est("abaco"), objeto: l.id });
    // Los huecos, con aspa (los de cuatro vértices: sus diagonales)
    for (const h of l.huecos ?? []) if (h.length === 4) for (const [a, b] of [[0, 2], [1, 3]] as const) P.push({ tipo: "linea", puntos: [h[a]!, h[b]!], estilo: est("hueco-aspa") });
    texto(puntoInterior(anillos), etiquetaLosa(l), 60, { negrita: true, ancla: "medio", fondo: true, tamano: 13 });
  }
  for (const p of pl.enPlanta(f.panos)) {
    const anillos = [p.contorno as Vec2[], ...((p.huecos ?? []) as Vec2[][])];
    P.push({ tipo: "poligono", anillos, estilo: est("pano"), objeto: p.id });
    // Unas rectas en la dirección de las viguetas, separadas lo bastante para verse (≥ 1/12 del paño)
    const d: Vec2 = [Math.cos((p.direccion * Math.PI) / 180), Math.sin((p.direccion * Math.PI) / 180)];
    const [x0, y0, x1, y1] = cajaDe(p.contorno);
    const paso = Math.max(p.intereje, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 12 / p.intereje) * p.intereje);
    for (const [a, b] of rayado(anillos, d, paso)) P.push({ tipo: "linea", puntos: [a, b], estilo: est("pano-viguetas"), objeto: p.id });
    texto(puntoInterior(anillos), etiquetaPano(p), 60, { negrita: true, ancla: "medio", fondo: true, tamano: 13 });
  }

  // Vigas, con su ancho
  for (const v of pl.enPlanta(f.vigas)) {
    const s = f.secciones?.find((x) => x.id === v.seccion);
    const b = anchoViga(s);
    if (b > 0) for (const q of bandaPolilinea(v.puntos, b)) P.push({ tipo: "poligono", anillos: [q], estilo: est("viga"), objeto: v.id });
    else P.push({ tipo: "linea", puntos: v.puntos as Vec2[], estilo: est("vigueta"), objeto: v.id });
    // El rótulo, en el tramo más largo
    let mejor = 0;
    let sm = 0;
    let acum = 0;
    for (let i = 1; i < v.puntos.length; i++) {
      const l = Math.hypot(v.puntos[i]![0] - v.puntos[i - 1]![0], v.puntos[i]![1] - v.puntos[i - 1]![1]);
      if (l > mejor) [mejor, sm] = [l, acum + l / 2];
      acum += l;
    }
    const { p, d } = puntoEnPolilinea(v.puntos, sm);
    const al = alLado(p, d, b);
    texto(al.p, `${v.id} ${SECCION(s)}`, 30, { ...al.opciones, tamano: 11 });
  }

  // Muros: los que llegan, rellenos; los que arrancan, en contorno; los huecos del piso de debajo
  for (const { m, llega } of pl.muros()) {
    for (const q of bandaPolilinea(m.puntos, m.espesor)) P.push({ tipo: "poligono", anillos: [q], estilo: est(llega ? "muro-llega" : "muro-arranca"), objeto: m.id });
    if (llega) for (const h of huecosEnPiso(pl, m)) for (const q of bandaPolilinea(h, m.espesor)) P.push({ tipo: "poligono", anillos: [q], estilo: est("muro-hueco"), objeto: m.id });
    const { p, d } = puntoEnPolilinea(m.puntos, longitud(m.puntos) / 2);
    const al = alLado(p, d, m.espesor);
    texto(al.p, m.id, 40, al.opciones);
  }

  // Pilares
  for (const { p, llega, seccion } of pl.pilares()) {
    const h = huellaSeccion(p, seccion);
    const e = est(llega ? "pilar-llega" : "pilar-arranca");
    if (!h) P.push({ tipo: "marca", p: [p.x, p.y], forma: "cuadrado", radio: 4, estilo: e, objeto: p.id });
    else if ("anillo" in h) P.push({ tipo: "poligono", anillos: [h.anillo], estilo: e, objeto: p.id });
    else P.push({ tipo: "poligono", anillos: [circulo(h.centro, h.radio)], estilo: e, objeto: p.id });
    // El rótulo, junto a una esquina de la huella; si no cabe, en otra
    const r = h ? ("anillo" in h ? Math.max(...h.anillo.map((q) => Math.max(Math.abs(q[0] - p.x), Math.abs(q[1] - p.y)))) : h.radio) : 0;
    texto([p.x + r, p.y + r], `${p.id}${orientacion(p, seccion)}`, 50, {
      dx: 3,
      dy: -3,
      negrita: true,
      alternativas: [
        { p: [p.x - r, p.y + r], dx: -3, dy: -3, ancla: "fin" },
        { p: [p.x + r, p.y - r], dx: 3, dy: 13 },
        { p: [p.x - r, p.y - r], dx: -3, dy: 13, ancla: "fin" },
      ],
    });
  }

  // Apoyos, apoyos lineales y bandas
  for (const a of pl.enPlanta(f.apoyos)) {
    P.push({ tipo: "marca", p: [a.x, a.y], forma: "triangulo", radio: 7, estilo: est("apoyo"), objeto: a.id });
    texto([a.x, a.y], a.id, 20, { dx: 9, dy: 14 });
  }
  for (const a of pl.enPlanta(f.apoyosLineales)) {
    P.push({ tipo: "linea", puntos: a.puntos as Vec2[], estilo: est("apoyo-lineal"), objeto: a.id });
    texto(puntoEnPolilinea(a.puntos, longitud(a.puntos) / 2).p, a.id, 20, { dy: -8, ancla: "medio" });
  }
  for (const b of pl.enPlanta(f.bandas)) {
    const L = Math.hypot(b.hasta[0] - b.desde[0], b.hasta[1] - b.desde[1]);
    if (L === 0) continue;
    for (const q of bandaPolilinea([b.desde, b.hasta], b.ancho)) P.push({ tipo: "linea", puntos: [...q, q[0]!], estilo: est("banda"), objeto: b.id });
    texto(b.desde, b.id, 10, { dx: 4, dy: -4, color: "#6d28d9" });
  }

  // Los ejes de replanteo, encima del modelo
  const ejes = capaEjes(f, { cotas: !!o.cotas });
  P.push(...ejes.primitivas);
  notas.push(...ejes.notas);

  const leyenda: EntradaLeyenda[] = [];
  const entrada = (e: Estilo, t: string) => {
    if (usados.has(e)) leyenda.push({ estilo: e, texto: t });
  };
  entrada("losa", "Losa maciza (id y espesor)");
  entrada("losa-reticular", "Forjado reticular (zona aligerada)");
  entrada("abaco", "Ábaco macizo");
  entrada("hueco-aspa", "Hueco de losa (con aspa)");
  entrada("pano", "Paño unidireccional; las rayas, en la dirección de sus viguetas");
  entrada("viga", "Viga, con su ancho y su sección (cm)");
  entrada("vigueta", "Viga sin ancho conocido");
  entrada("pilar-llega", "Pilar que llega desde la planta de abajo, con su sección orientada. Si es rectangular, su rótulo da b×h (cm) y hacia dónde va el canto h: hX según X, hY según Y");
  entrada("pilar-arranca", "Pilar que arranca aquí hacia arriba");
  entrada("muro-llega", "Muro que llega desde abajo");
  entrada("muro-arranca", "Muro que arranca aquí hacia arriba");
  entrada("muro-hueco", "Hueco del muro en el piso de debajo");
  entrada("apoyo", "Apoyo");
  entrada("apoyo-lineal", "Apoyo lineal");
  entrada("banda", "Banda de dimensionado");
  leyenda.push(...ejes.leyenda);
  return { primitivas: P, leyenda: o.atenuado ? [] : leyenda, notas };
}

const circulo = (c: Vec2, r: number, n = 32): Vec2[] => Array.from({ length: n }, (_, i) => [c[0] + r * Math.cos((2 * Math.PI * i) / n), c[1] + r * Math.sin((2 * Math.PI * i) / n)] as Vec2);

function etiquetaLosa(l: Losa): string {
  const e = `${rotulo(l.espesor * 100)} cm`;
  if (l.reticular) return `${l.id} · reticular ${e}, nervios a ${rotulo(l.reticular.intereje * 100)} cm`;
  return `${l.id} · ${e}${l.pp !== undefined ? `, pp ${rotulo(l.pp)} kN/m²` : ""}`;
}

function etiquetaPano(p: PanoUnidireccional): string {
  return `${p.id} · viguetas a ${rotulo(p.intereje * 100)} cm, ${rotulo(p.direccion)}°, pp ${rotulo(p.pp)} kN/m²`;
}

/** Tramos del eje de un muro (en planta) que ocupan sus huecos en el piso de debajo de la planta. */
function huecosEnPiso(pl: PlantaFisica, m: Muro): Vec2[][] {
  const zb = pl.cotaDe(m.desde);
  const [z0, z1] = [pl.cotaDebajo, pl.cota];
  if (zb === null || z0 === null || z1 === null) return [];
  const r: Vec2[][] = [];
  for (const h of m.huecos ?? []) {
    if (!(zb + h.z1 > z0 + 1e-9 && zb + h.z0 < z1 - 1e-9)) continue;
    const n = 8;
    r.push(Array.from({ length: n + 1 }, (_, i) => puntoEnPolilinea(m.puntos, h.desde + ((h.hasta - h.desde) * i) / n).p));
  }
  return r;
}

const titulo = (nombre: string | undefined) => nombre ?? "Proyecto";

export function cabeceraPlanta(pl: PlantaFisica): string {
  const p = pl.f.plantas[pl.k];
  return `Planta ${pl.id}${p?.nombre ? ` (${p.nombre})` : ""}${pl.cota !== null ? `, cota ${pl.cota >= 0 ? "+" : ""}${rotulo(pl.cota, 4)} m` : ""}`;
}

/** Caja de la planta: la de todo lo dibujado del modelo, para que todas sus vistas encuadren igual. */
export function cajaPlanta(prims: readonly Primitiva[]): [number, number, number, number] {
  return cajaDe(prims.filter((p) => p.tipo !== "texto").flatMap(puntosDe));
}

export interface DatosVista {
  nombre?: string;
  huella: string;
}

// ─── Vista «modelo» ─────────────────────────────────────────────────────────────────────────────

export function vistaModelo(f: ModeloFisico, planta: string, d: DatosVista): Escena {
  const pl = new PlantaFisica(f, planta);
  const fondo = fondoModelo(pl, { atenuado: false, cotas: true });
  return {
    titulo: titulo(d.nombre),
    cabecera: [cabeceraPlanta(pl), "Vista: modelo", `Huella ${d.huella.slice(0, 12)}`],
    primitivas: fondo.primitivas,
    leyenda: fondo.leyenda,
    notas: ["Ejes globales; m. Las vigas, muros y pilares, con su ancho y su sección; las vigas, por su eje.", ...fondo.notas],
    extremos: [],
    caja: cajaPlanta(fondo.primitivas),
  };
}

// ─── Vista «cargas» ─────────────────────────────────────────────────────────────────────────────

const vector = (q: readonly number[]) => (q[0] === 0 && q[1] === 0 ? rotulo(q[2]!) : `(${q.map((x) => rotulo(x)).join("; ")})`);

/** Cargas de un caso en la planta, dibujadas sobre el modelo atenuado. */
export function vistaCargas(f: ModeloFisico, planta: string, caso: string, d: DatosVista): Escena {
  const pl = new PlantaFisica(f, planta);
  const fondo = fondoModelo(pl, { atenuado: true });
  const P: Primitiva[] = [...fondo.primitivas];
  const notas: string[] = [];
  const usados = new Set<Estilo>();
  const c = f.casos.find((x) => x.id === caso);
  const poner = (p: Primitiva) => {
    if (p.tipo !== "texto") usados.add(p.estilo);
    P.push(p);
  };
  const rot = (p: Vec2, t: string, extra: Partial<Extract<Primitiva, { tipo: "texto" }>> = {}) => poner({ tipo: "texto", p, texto: t, tamano: 12, prioridad: 70, fondo: true, clase: "dato", ...extra });
  const vigas = new Map((f.vigas ?? []).map((v) => [v.id, v]));
  const losas = new Map((f.losas ?? []).map((l) => [l.id, l]));
  const panos = new Map((f.panos ?? []).map((p) => [p.id, p]));
  const pilares = new Map(pl.pilares().map((x) => [x.p.id, x]));
  const muros = new Map(pl.muros().map((x) => [x.m.id, x]));
  let n = 0;
  for (const g of porId((f.cargas ?? []).filter((x) => x.caso === caso))) {
    const antes = P.length;
    dibujarCarga(g);
    if (P.length > antes) n++;
  }
  function dibujarCarga(g: CargaFisica): void {
    switch (g.tipo) {
      case "superficie": {
        if (g.planta !== planta) return;
        const sobre = g.losa ? losas.get(g.losa) : g.pano ? panos.get(g.pano) : undefined;
        const anillos: Vec2[][] | null = g.zona ? [g.zona as Vec2[]] : sobre ? [sobre.contorno as Vec2[], ...((sobre.huecos ?? []) as Vec2[][])] : null;
        if (!anillos) {
          notas.push(`${g.id}: carga de superficie sin zona, losa ni paño que se pueda dibujar.`);
          return;
        }
        poner({ tipo: "poligono", anillos, estilo: "carga-superficie", objeto: g.id });
        const sufijo = g.zona && (g.losa || g.pano) ? ` (sólo en ${g.losa ?? g.pano})` : "";
        rot(puntoInterior(anillos), `${g.id}: ${vector(g.q)} kN/m²${sufijo}`, { ancla: "medio" });
        return;
      }
      case "lineal": {
        if (g.planta !== planta) return;
        poner({ tipo: "linea", puntos: g.puntos as Vec2[], estilo: "carga-lineal", objeto: g.id });
        const { p, d: dir } = puntoEnPolilinea(g.puntos, longitud(g.puntos) / 2);
        rot(p, `${g.id}: ${vector(g.q)} kN/m`, { giro: giroTexto(dir), ancla: "medio", dy: -8 });
        return;
      }
      case "puntual": {
        if (g.planta !== planta) return;
        const F = g.F ?? [0, 0, 0];
        const h = Math.hypot(F[0], F[1]);
        poner({ tipo: "flecha", p: [g.x, g.y], d: h > 0 ? [F[0], F[1]] : null, abajo: F[2] <= 0, estilo: "carga-puntual", objeto: g.id });
        rot([g.x, g.y], `${g.id}: F ${vector(F)} kN${g.M ? `, M ${vector(g.M)} kN·m` : ""}`, { dx: 10, dy: 18 });
        return;
      }
      case "viga": {
        const v = vigas.get(g.viga);
        if (!v || v.planta !== planta) return;
        const L = longitud(v.puntos);
        const [s0, s1] = [g.desde ?? 0, g.hasta ?? L];
        const tramo = Array.from({ length: 17 }, (_, i) => puntoEnPolilinea(v.puntos, s0 + ((s1 - s0) * i) / 16).p);
        poner({ tipo: "linea", puntos: tramo, estilo: "carga-pieza", objeto: g.id });
        const { p, d: dir } = puntoEnPolilinea(v.puntos, (s0 + s1) / 2);
        rot(p, `${g.id}: ${vector(g.q)}${g.qb ? ` a ${vector(g.qb)}` : ""} kN/m ${g.ejes}`, { giro: giroTexto(dir), ancla: "medio", dy: -9 });
        return;
      }
      case "pilar": {
        const x = pilares.get(g.pilar);
        if (!x || !x.llega) return;
        const p = x.p;
        const horizontal = g.ejes === "global" ? Math.hypot(g.q[0], g.q[1]) > 0 : true;
        poner({ tipo: "flecha", p: [p.x, p.y], d: g.ejes === "global" && horizontal ? [g.q[0], g.q[1]] : null, abajo: true, estilo: "carga-pieza", objeto: g.id });
        rot([p.x, p.y], `${g.id}: ${vector(g.q)}${g.qb ? ` a ${vector(g.qb)}` : ""} kN/m ${g.ejes}`, { dx: 10, dy: 20 });
        return;
      }
      case "empuje": {
        const x = muros.get(g.muro);
        if (!x || !x.llega) return;
        poner({ tipo: "linea", puntos: x.m.puntos as Vec2[], estilo: "carga-pieza", objeto: g.id });
        const { p, d: dir } = puntoEnPolilinea(x.m.puntos, longitud(x.m.puntos) / 2);
        rot(p, `${g.id}: empuje por el lado ${g.lado}, ${rotulo(g.p0)} a ${rotulo(g.p1)} kN/m²`, { giro: giroTexto(dir), ancla: "medio", dy: 18 });
        return;
      }
    }
  }
  const leyenda: EntradaLeyenda[] = [];
  const entrada = (e: Estilo, t: string) => {
    if (usados.has(e)) leyenda.push({ estilo: e, texto: t });
  };
  entrada("carga-superficie", "Carga de superficie (kN/m²), sobre su zona, su losa o su paño. Las que se solapan se suman");
  entrada("carga-lineal", "Carga lineal (kN/m)");
  entrada("carga-puntual", "Carga puntual (kN): círculo con punto si va hacia abajo, con aspa si va hacia arriba, flecha si es horizontal");
  entrada("carga-pieza", "Carga en una viga, un pilar que llega a la planta o un muro (kN/m o kN/m²)");
  if (!c) notas.push(`El caso «${caso}» no existe.`);
  else if (c.pesoPropio) notas.push("Este caso lleva además el peso propio de la estructura, que calcula el programa y no se dibuja.");
  notas.push("Componentes en ejes globales salvo que diga «local»; un valor solo es la componente Z (negativa, hacia abajo).");
  if (!n) notas.push("El caso no tiene cargas en esta planta.");
  return {
    titulo: titulo(d.nombre),
    cabecera: [cabeceraPlanta(pl), `Vista: cargas del caso ${caso}${c?.nombre ? ` (${c.nombre})` : ""}${c?.accion ? `, acción ${c.accion.tipo}` : ""}`, `Huella ${d.huella.slice(0, 12)}`],
    primitivas: P,
    leyenda,
    notas: [...notas, ...fondo.notas],
    extremos: [],
    caja: cajaPlanta(fondo.primitivas.length ? fondo.primitivas : P),
  };
}

// ─── Vista «diagnosticos» ───────────────────────────────────────────────────────────────────────

/** Dónde se sitúa un objeto en la planta (null si no está en ella o no tiene sitio en planta). */
export function situar(pl: PlantaFisica, id: string): Vec2 | null {
  const f = pl.f;
  const p = pl.pilares().find((x) => x.p.id === id);
  if (p) return [p.p.x, p.p.y];
  const m = pl.muros().find((x) => x.m.id === id);
  if (m) return puntoEnPolilinea(m.m.puntos, longitud(m.m.puntos) / 2).p;
  const v = pl.enPlanta(f.vigas).find((x) => x.id === id);
  if (v) return puntoEnPolilinea(v.puntos, longitud(v.puntos) / 2).p;
  const l = [...pl.enPlanta(f.losas), ...pl.enPlanta(f.panos)].find((x) => x.id === id);
  if (l) return puntoInterior([l.contorno as Vec2[], ...((l.huecos ?? []) as Vec2[][])]);
  const a = pl.enPlanta(f.apoyos).find((x) => x.id === id);
  if (a) return [a.x, a.y];
  const al = pl.enPlanta(f.apoyosLineales).find((x) => x.id === id);
  if (al) return puntoEnPolilinea(al.puntos, longitud(al.puntos) / 2).p;
  const b = pl.enPlanta(f.bandas).find((x) => x.id === id);
  if (b) return [(b.desde[0] + b.hasta[0]) / 2, (b.desde[1] + b.hasta[1]) / 2];
  const g = (f.cargas ?? []).find((x) => x.id === id);
  if (g) {
    switch (g.tipo) {
      case "superficie":
        if (g.planta !== pl.id) return null;
        if (g.zona) return puntoInterior([g.zona as Vec2[]]);
        return situar(pl, g.losa ?? g.pano ?? "");
      case "lineal":
        return g.planta === pl.id ? puntoEnPolilinea(g.puntos, longitud(g.puntos) / 2).p : null;
      case "puntual":
        return g.planta === pl.id ? [g.x, g.y] : null;
      case "viga":
        return situar(pl, g.viga);
      case "pilar":
        return situar(pl, g.pilar);
      case "empuje":
        return situar(pl, g.muro);
    }
  }
  return null;
}

/** Objetos físicos que nombra un diagnóstico: sus `ids` y los ids del modelo que cita su mensaje. */
function objetosDe(dg: Diagnostico, ids: ReadonlySet<string>): string[] {
  const r = new Set<string>((dg.ids ?? []).filter((x) => ids.has(x)));
  for (const m of dg.mensaje.matchAll(/«([^»]+)»/g)) if (ids.has(m[1]!)) r.add(m[1]!);
  return [...r];
}

/** Ids de todos los objetos del modelo. */
function idsModelo(f: ModeloFisico): Set<string> {
  const r = new Set<string>();
  for (const k of ["plantas", "pilares", "vigas", "apoyos", "losas", "apoyosLineales", "bandas", "muros", "panos", "cargas", "casos", "secciones", "materiales"] as const) for (const x of (f[k] ?? []) as readonly { id: string }[]) r.add(x.id);
  return r;
}

/** Máximo de diagnósticos que se numeran en una planta. */
export const MAX_DIAGNOSTICOS_VISTA = 40;

/**
 * Diagnósticos sobre el modelo atenuado: una marca numerada en cada objeto de la planta que nombra
 * un error o un aviso; la lista, en la leyenda. Los que no nombran nada de la planta, sólo en la
 * lista si no se sitúan en ninguna planta (los del modelo entero).
 */
export function vistaDiagnosticos(f: ModeloFisico, planta: string, diagnosticos: readonly Diagnostico[], d: DatosVista): Escena {
  const pl = new PlantaFisica(f, planta);
  const fondo = fondoModelo(pl, { atenuado: true });
  const P: Primitiva[] = [...fondo.primitivas];
  const ids = idsModelo(f);
  const otras = (f.plantas ?? []).filter((p) => p.id !== planta).map((p) => new PlantaFisica(f, p.id));
  const plantaIds = new Set((f.plantas ?? []).map((p) => p.id));
  const lista: { n: number; dg: Diagnostico; aqui: boolean }[] = [];
  const marcas = new Map<string, { p: Vec2; ns: number[]; error: boolean }>();
  // En un orden que no depende del de las listas del modelo
  const clave = (x: Diagnostico) => `${x.codigo}|${x.mensaje}|${(x.ids ?? []).join(",")}`;
  const ordenados = [...diagnosticos].sort((a, b) => (clave(a) < clave(b) ? -1 : clave(a) > clave(b) ? 1 : 0));
  const errores = ordenados.filter((x) => x.severidad === "error");
  const avisos = ordenados.filter((x) => x.severidad === "aviso");
  for (const dg of [...errores, ...avisos]) {
    const objs = objetosDe(dg, ids);
    const aqui = objs.map((o) => [o, situar(pl, o)] as const).filter((x): x is readonly [string, Vec2] => x[1] !== null);
    if (!aqui.length) {
      // De otra planta (la nombra, o nombra algo que está en otra), no se lista aquí
      const plantas = objs.filter((o) => plantaIds.has(o));
      if (plantas.length && !plantas.includes(planta)) continue;
      if (!plantas.includes(planta) && objs.some((o) => otras.some((q) => situar(q, o) !== null))) continue;
    }
    if (lista.length >= MAX_DIAGNOSTICOS_VISTA) {
      lista.push({ n: 0, dg, aqui: false });
      continue;
    }
    const n = lista.filter((x) => x.n > 0).length + 1;
    lista.push({ n, dg, aqui: aqui.length > 0 });
    for (const [o, p] of aqui) {
      const m = marcas.get(o) ?? { p, ns: [], error: false };
      m.ns.push(n);
      m.error ||= dg.severidad === "error";
      marcas.set(o, m);
    }
  }
  for (const [o, m] of marcas) {
    P.push({ tipo: "marca", p: m.p, forma: "circulo", radio: 9, estilo: m.error ? "diagnostico-error" : "diagnostico-aviso", objeto: o });
    P.push({ tipo: "texto", p: m.p, texto: m.ns.join(","), tamano: 12, negrita: true, ancla: "medio", dy: 4, color: "#ffffff", prioridad: 100, objeto: o });
    P.push({ tipo: "texto", p: m.p, texto: o, tamano: 12, dx: 12, dy: -8, prioridad: 90, fondo: true, objeto: o });
  }
  const numerados = lista.filter((x) => x.n > 0);
  const leyenda: EntradaLeyenda[] = numerados.map((x) => ({
    estilo: x.dg.severidad === "error" ? "diagnostico-error" : "diagnostico-aviso",
    texto: `${x.n}. ${x.dg.codigo}${x.aqui ? "" : " (sin sitio en planta)"}: ${recortar(x.dg.mensaje, 150)}`,
  }));
  const resto = lista.length - numerados.length;
  const notas = [
    `${errores.length} errores y ${avisos.length} avisos en el modelo; aquí, los que nombran objetos de esta planta o de ninguna.`,
    ...(resto ? [`Otros ${resto} no se numeran: «fem validar» los da todos.`] : []),
    ...(numerados.length ? [] : ["Ningún error ni aviso en esta planta."]),
  ];
  return {
    titulo: titulo(d.nombre),
    cabecera: [cabeceraPlanta(pl), "Vista: diagnósticos (compilación y sensatez previa)", `Huella ${d.huella.slice(0, 12)}`],
    primitivas: P,
    leyenda,
    notas,
    extremos: [],
    caja: cajaPlanta(fondo.primitivas.length ? fondo.primitivas : P),
  };
}

const recortar = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
