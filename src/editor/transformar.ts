/**
 * Mover, copiar, girar y hacer la simetría de lo elegido, y mover un vértice suelto (pinzamientos):
 * V2c-3, `docs/fem3d/dibujo.md` §2.5 y §9.
 *
 * - **Qué se transforma:** pilares, vigas, muros, apoyos, apoyos lineales, losas, paños, bandas, ejes
 *   guardados y cargas. Lo demás (plantas, materiales, secciones, casos) no tiene geometría.
 * - **Con sus cargas:** las que van sobre lo elegido por su id (en barra sobre una viga o un pilar,
 *   empuje sobre un muro, superficie sobre una losa o un paño) lo acompañan siempre: al mover, giran
 *   con ello (sus componentes globales horizontales, la zona); al copiar, se copian con la copia. Las
 *   cargas sueltas (puntual, lineal, zona sin forjado) sólo si se eligen.
 * - **Vigas unidas a un pilar** (V2c-d, CT-d): al mover, girar o hacer la simetría sin conservar, el
 *   vértice de cada viga no elegida que está bit a bit en el punto fijo de un pilar que se transforma
 *   (en una planta del pilar) va a donde va el punto fijo; con `conVigas: false`, no. Una viga alineada
 *   a una cara (con un vértice en la huella fuera del punto) no lo sigue, y se avisa.
 * - **Lo que no es un punto:** al girar, el giro de los pilares, el `eje1` de las losas, la dirección
 *   de los paños, las componentes horizontales de las fuerzas en ejes globales y las coacciones de los
 *   apoyos (ux ↔ uy y rx ↔ ry a 90°; a otro ángulo, si son distintas, no se pueden girar y se avisa).
 *   En la simetría, además, el punto fijo de los pilares cambia de lado (superior ↔ inferior con el
 *   giro reflejado), la componente y de las cargas en ejes locales cambia de signo, los momentos (que
 *   son pseudovectores) cambian de signo tras reflejarse y el lado de los empujes se cambia. Un giro
 *   de pilar ≥ 180° en una sección simétrica respecto a su centro (todas salvo la T) se deja en
 *   [0, 180) con el punto fijo al otro lado: es la misma pieza.
 * - **Exacto:** al mover, una coordenada igual a la del punto base acaba en la del destino; las demás,
 *   en la suya más el desplazamiento sin el ruido de la suma (`limpio`). Los giros de 90°, 180° y 270°
 *   y la simetría por un eje paralelo a X o a Y (o a 45°) no usan senos: con los números de la tabla,
 *   mover y volver, girar cuatro veces 90° o hacer dos veces la misma simetría dejan los bytes.
 * - **Estaciones:** una transformación rígida no cambia las longitudes, así que los huecos de los muros
 *   y los tramos de las cargas de viga no cambian. Mover un vértice sí: se vuelven a medir en su tramo.
 *
 * Todo es un `lote` de `cambiar` o de `crear` (un paso de deshacer) que pasa por `aplicar`.
 *
 * Puro: sin IO, sin React ni DOM.
 */
import { huellaSeccion, PlantaFisica } from "../agente/render/modelo.ts";
import { direccionEjes, ejesDe, letraEje } from "../compilador/ejes.ts";
import type { ApoyoFisico, CargaFisica, ModeloFisico, Pilar, PuntoFijo, Vec2 } from "../compilador/fisico.ts";
import { distanciaABorde, puntoEnPoligono } from "../compilador/poligonos.ts";
import type { Seis, Vec3 } from "../motor/modelo.ts";
import { limpio } from "./dibujo/cotas.ts";
import { moverPilar } from "./estirar.ts";
import type { Operacion } from "./operaciones.ts";
import { conValor, indiceIds, lista, type Coleccion, type Objeto } from "./referencias.ts";
import { idNuevo } from "./tablas.ts";

export type Transformacion =
  /** El punto `de` va a `a`, y todo lo demás con él. */
  | { tipo: "mover"; de: Vec2; a: Vec2 }
  /** Un giro de `angulo` grados (antihorario) alrededor de `centro`. */
  | { tipo: "girar"; centro: Vec2; angulo: number }
  /** La simetría respecto a la recta que pasa por `a` y `b`. */
  | { tipo: "simetria"; a: Vec2; b: Vec2 };

export interface OpcionesTransformar {
  /** Copiar (lo original se queda) en vez de mover. */
  copiar?: boolean;
  /** Al copiar: las plantas de las copias de lo que es de una planta (por defecto, la suya). */
  plantas?: readonly string[];
  /** Al mover: las vigas no elegidas con un vértice en el punto fijo de un pilar que se transforma lo siguen (V2c-d). Por defecto, sí. */
  conVigas?: boolean;
}

export type ResultadoTransformar = { ok: true; operacion: Operacion; avisos: string[]; nuevos: string[] } | { ok: false; mensaje: string };

/** Lo que se transforma (lo demás no tiene geometría). */
const GEOMETRICAS: ReadonlySet<Coleccion> = new Set(["pilares", "vigas", "apoyos", "cargas", "losas", "apoyosLineales", "bandas", "muros", "panos", "ejes"]);

/** El prefijo del id de una copia, como en las tablas (los paños, «F», como Renumerar). */
const PREFIJO: Partial<Record<Coleccion, string>> = { pilares: "P", vigas: "V", apoyos: "A", cargas: "Q", losas: "L", apoyosLineales: "AL", bandas: "B", muros: "M", panos: "F", ejes: "E" };

const igual = (a: Vec2, b: Vec2) => a[0] === b[0] && a[1] === b[1];

/** Un ángulo en [0, periodo), sin el ruido de la suma. */
export function normalAngulo(g: number, periodo: number): number {
  let x = g % periodo;
  if (x < 0) x += periodo;
  x = limpio(x);
  return x >= periodo ? 0 : x + 0;
}

/** cos y sen de un ángulo en grados, exactos en los múltiplos de 90°. */
function cosSin(grados: number): [number, number] {
  const g = normalAngulo(grados, 360);
  if (g === 0) return [1, 0];
  if (g === 90) return [0, 1];
  if (g === 180) return [-1, 0];
  if (g === 270) return [0, -1];
  const r = (g * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r)];
}

/** El ángulo de una dirección, grados en [0, 360), exacto en los ejes y a 45°. */
export function anguloDe(d: Vec2): number {
  const [x, y] = d;
  if (y === 0) return x >= 0 ? 0 : 180;
  if (x === 0) return y > 0 ? 90 : 270;
  if (Math.abs(x) === Math.abs(y)) return x > 0 ? (y > 0 ? 45 : 315) : y > 0 ? 135 : 225;
  return normalAngulo((Math.atan2(y, x) * 180) / Math.PI, 360);
}

/** Lo que hace una transformación con un punto, una dirección o un vector. */
export class Transformador {
  readonly t: Transformacion;
  /** La parte lineal: [a, b; c, d]. */
  private readonly m: readonly [number, number, number, number];
  /** Una simetría (cambia la orientación). */
  readonly invierte: boolean;
  /** Cuánto gira una dirección (girar) o el doble del ángulo del eje (simetría), grados. */
  readonly giro: number;
  /** La transformación no hace nada. */
  readonly identidad: boolean;

  constructor(t: Transformacion) {
    this.t = t;
    if (t.tipo === "mover") {
      this.m = [1, 0, 0, 1];
      this.invierte = false;
      this.giro = 0;
      this.identidad = igual(t.de, t.a);
    } else if (t.tipo === "girar") {
      const [c, s] = cosSin(t.angulo);
      this.m = [c, -s, s, c];
      this.invierte = false;
      this.giro = normalAngulo(t.angulo, 360);
      this.identidad = this.giro === 0;
    } else {
      const fi = anguloDe([t.b[0] - t.a[0], t.b[1] - t.a[1]]);
      const [c, s] = cosSin(2 * fi);
      this.m = [c, s, s, -c];
      this.invierte = true;
      this.giro = normalAngulo(2 * fi, 360);
      this.identidad = false;
    }
  }

  /** El punto transformado (el mismo objeto si no cambia). */
  punto(p: Vec2): Vec2 {
    const t = this.t;
    let r: Vec2;
    if (t.tipo === "mover") {
      if (this.identidad) return p;
      const k = (i: 0 | 1) => (p[i] === t.de[i] ? t.a[i] : limpio(p[i] + (t.a[i] - t.de[i])));
      r = [k(0), k(1)];
    } else if (t.tipo === "girar") {
      if (this.identidad || igual(p, t.centro)) return p;
      const [u, v] = this.lineal([p[0] - t.centro[0], p[1] - t.centro[1]]);
      r = [limpio(t.centro[0] + u), limpio(t.centro[1] + v)];
    } else {
      const { a, b } = t;
      // Por un eje paralelo a Y o a X, la coordenada reflejada tal cual
      if (a[0] === b[0]) r = [p[0] === a[0] ? a[0] : limpio(2 * a[0] - p[0]), p[1]];
      else if (a[1] === b[1]) r = [p[0], p[1] === a[1] ? a[1] : limpio(2 * a[1] - p[1])];
      else {
        const [u, v] = this.lineal([p[0] - a[0], p[1] - a[1]]);
        r = [limpio(a[0] + u), limpio(a[1] + v)];
      }
    }
    return igual(r, p) ? p : r;
  }

  /** La parte lineal sobre un vector (sin −0). */
  lineal(v: Vec2): Vec2 {
    const [a, b, c, d] = this.m;
    return [a * v[0] + b * v[1] + 0, c * v[0] + d * v[1] + 0];
  }

  /** Una dirección en grados (sin normalizar). */
  direccion(g: number): number {
    return this.invierte ? this.giro - g : g + this.giro;
  }

  /**
   * Un vector (fuerza) con sus componentes horizontales transformadas. Con `limpiar` (lo del modelo),
   * sin el ruido de los senos (`limpio`: 1,5·cos 60° es 0,75); para comparar resultados, sin limpiar
   * (`limpio` haría 0 un desplazamiento de 1e-10 m).
   */
  vector3(v: Vec3, limpiar = true): Vec3 {
    const [x, y] = this.lineal([v[0], v[1]]);
    return limpiar ? [limpio(x), limpio(y), v[2]] : [x, y, v[2]];
  }

  /** Un pseudovector (momento): en la simetría, reflejado y con el signo cambiado. */
  momento(v: Vec3, limpiar = true): Vec3 {
    const [x, y, z] = this.vector3(v, limpiar);
    return this.invierte ? [-x + 0, -y + 0, -z + 0] : [x, y, z];
  }
}

// ─── Cada objeto ────────────────────────────────────────────────────────────────────────────────

const LADO_FIJO: Record<string, string> = { derecha: "izquierda", izquierda: "derecha", superior: "inferior", inferior: "superior" };

/** El punto fijo con los lados cambiados: `lr`, derecha ↔ izquierda; `ud`, superior ↔ inferior. */
function cambiarFijo(f: PuntoFijo, lr: boolean, ud: boolean): PuntoFijo {
  return f
    .split("-")
    .map((x) => ((lr && (x === "derecha" || x === "izquierda")) || (ud && (x === "superior" || x === "inferior")) ? LADO_FIJO[x]! : x))
    .join("-") as PuntoFijo;
}

/** El pilar transformado. */
function pilarTransformado(m: ModeloFisico, tr: Transformador, p: Pilar): Pilar {
  const q = tr.punto([p.x, p.y]);
  if (tr.t.tipo === "mover") return q[0] === p.x && q[1] === p.y ? p : { ...p, x: q[0], y: q[1] };
  let fijo: PuntoFijo = p.fijo ?? "centro";
  if (tr.invierte) fijo = cambiarFijo(fijo, false, true);
  let g = normalAngulo(tr.direccion(p.giro ?? 0), 360);
  // Una sección simétrica respecto a su centro, girada 180°, es la misma pieza con el punto fijo al otro lado
  const secciones = [p.seccion, ...(p.tramos ?? []).map((t) => t.seccion)].map((id) => m.secciones.find((s) => s.id === id));
  if (g >= 180 && secciones.every((s) => s && s.forma !== "T")) {
    g = normalAngulo(g - 180, 360);
    fijo = cambiarFijo(fijo, true, true);
  }
  // Lo de por defecto no se escribe, salvo si estaba escrito y no cambia (V2c2-3)
  const { giro: _g, fijo: _f, ...resto } = p;
  return { ...resto, x: q[0], y: q[1], ...(g || p.giro === 0 ? { giro: g } : {}), ...(fijo !== "centro" || p.fijo === "centro" ? { fijo } : {}) } as Pilar;
}

/** Las coacciones de un apoyo, giradas (ux ↔ uy y rx ↔ ry a 90°), o null si no se pueden girar. */
function coartadosGirados(tr: Transformador, c: Seis<boolean>): Seis<boolean> | null {
  const k = normalAngulo(tr.giro, 180);
  if (k === 0 || (c[0] === c[1] && c[3] === c[4])) return c;
  if (k === 90) return [c[1], c[0], c[2], c[4], c[3], c[5]];
  return null;
}

const vec3Igual = (a: Vec3 | undefined, b: Vec3 | undefined) => a === b || (!!a && !!b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2]);

/** La carga transformada (la misma si no cambia). `geometria`: también su punto, su línea o su zona. */
function cargaTransformada(tr: Transformador, c: CargaFisica, geometria = true): CargaFisica {
  const lineal = !tr.identidad && tr.t.tipo !== "mover";
  const v = (q: Vec3) => (lineal ? tr.vector3(q) : q);
  switch (c.tipo) {
    case "puntual": {
      const p = geometria ? tr.punto([c.x, c.y]) : ([c.x, c.y] as Vec2);
      const F = c.F && v(c.F);
      const M = c.M && (lineal ? tr.momento(c.M) : c.M);
      if (p[0] === c.x && p[1] === c.y && vec3Igual(F, c.F) && vec3Igual(M, c.M)) return c;
      return { ...c, x: p[0], y: p[1], ...(F ? { F } : {}), ...(M ? { M } : {}) };
    }
    case "lineal": {
      const puntos = geometria ? c.puntos.map((p) => tr.punto(p)) : c.puntos;
      const q = v(c.q);
      if (puntos.every((p, i) => p === c.puntos[i]) && vec3Igual(q, c.q)) return c;
      return { ...c, puntos, q };
    }
    case "superficie": {
      const zona = c.zona && geometria ? c.zona.map((p) => tr.punto(p)) : c.zona;
      const q = v(c.q);
      if ((zona === c.zona || zona!.every((p, i) => p === c.zona![i])) && vec3Igual(q, c.q)) return c;
      return { ...c, q, ...(zona ? { zona } : {}) };
    }
    case "viga":
    case "pilar": {
      if (!lineal) return c;
      // En ejes locales, la simetría cambia el sentido del eje y local; en globales, giran las horizontales
      const f = (q: Vec3): Vec3 => (c.ejes === "global" ? tr.vector3(q) : tr.invierte ? [q[0], -q[1] + 0, q[2]] : q);
      const q = f(c.q);
      const qb = c.qb && f(c.qb);
      if (vec3Igual(q, c.q) && vec3Igual(qb, c.qb)) return c;
      return { ...c, q, ...(qb ? { qb } : {}) } as CargaFisica;
    }
    case "empuje":
      return tr.invierte ? { ...c, lado: c.lado === "izquierdo" ? "derecho" : "izquierdo" } : c;
  }
}

/** Lo que va sobre otro objeto por su id: las cargas en barra, los empujes y las de superficie sobre una losa o un paño. */
function soporteDe(c: CargaFisica): string | null {
  switch (c.tipo) {
    case "viga":
      return c.viga;
    case "pilar":
      return c.pilar;
    case "empuje":
      return c.muro;
    case "superficie":
      return c.losa ?? c.pano ?? null;
    default:
      return null;
  }
}

/** El objeto `o` de la colección `c` transformado (el mismo si no cambia), con los avisos de lo que no se puede transformar. */
function transformado(m: ModeloFisico, tr: Transformador, c: Coleccion, o: Objeto, avisos: string[]): Objeto {
  const linea = (ps: readonly Vec2[]) => {
    const r = ps.map((p) => tr.punto(p));
    return r.every((p, i) => p === ps[i]) ? ps : r;
  };
  const anillos = (hs: readonly (readonly Vec2[])[] | undefined) => {
    if (!hs) return hs;
    const r = hs.map(linea);
    return r.every((h, i) => h === hs[i]) ? hs : r;
  };
  const gira = tr.t.tipo !== "mover" && !tr.identidad;
  /** Una dirección de ejes (eje 1 de la losa, la de las viguetas), en [0, 180). */
  const direccion = (g: number | undefined) => normalAngulo(tr.direccion(g ?? 0), 180);
  const coartados = (x: { id: string; coartados: Seis<boolean> }): Seis<boolean> => {
    if (!gira) return x.coartados;
    const r = coartadosGirados(tr, x.coartados);
    if (r) return r;
    avisos.push(`${x.id} coacciona ux y uy (o rx y ry) de forma distinta, en ejes globales: sus coacciones no se pueden girar ${tr.invierte ? "con la simetría" : `${tr.giro}°`} y se quedan como estaban.`);
    return x.coartados;
  };
  switch (c) {
    case "pilares":
      return pilarTransformado(m, tr, o as unknown as Pilar) as unknown as Objeto;
    case "apoyos": {
      const a = o as unknown as ApoyoFisico;
      const p = tr.punto([a.x, a.y]);
      return { ...o, x: p[0], y: p[1], coartados: coartados(a) };
    }
    case "vigas":
    case "muros":
      return { ...o, puntos: linea(o.puntos as Vec2[]) };
    case "apoyosLineales":
      return { ...o, puntos: linea(o.puntos as Vec2[]), coartados: coartados(o as unknown as { id: string; coartados: Seis<boolean> }) };
    case "losas": {
      const r: Record<string, unknown> = { ...o, contorno: linea(o.contorno as Vec2[]) };
      const huecos = anillos(o.huecos as Vec2[][] | undefined);
      if (huecos) r.huecos = huecos;
      const ret = o.reticular as { abacos?: Vec2[][] } | undefined;
      if (ret?.abacos) r.reticular = { ...ret, abacos: anillos(ret.abacos) };
      if (gira) {
        const e = direccion(o.eje1 as number | undefined);
        delete r.eje1;
        if (e || o.eje1 === 0) r.eje1 = e;
      }
      return r as Objeto;
    }
    case "panos": {
      const huecos = anillos(o.huecos as Vec2[][] | undefined);
      return { ...o, contorno: linea(o.contorno as Vec2[]), ...(huecos ? { huecos } : {}), ...(gira ? { direccion: direccion(o.direccion as number) } : {}) };
    }
    case "bandas":
    case "ejes":
      return { ...o, desde: tr.punto(o.desde as Vec2), hasta: tr.punto(o.hasta as Vec2) };
    case "cargas":
      return cargaTransformada(tr, o as unknown as CargaFisica) as unknown as Objeto;
    default:
      return o;
  }
}

/** ¿Cambia algo? (Comparación de lo que transforma `transformado`, que deja los mismos objetos donde no cambian.) */
const cambia = (a: Objeto, b: Objeto) => a !== b && JSON.stringify(a) !== JSON.stringify(b);

/** Las plantas de un objeto de una planta (null: pilares, muros, ejes y cargas sobre ellos). */
function plantaDe(c: Coleccion, o: Objeto): string | null {
  if (c === "cargas") {
    const t = (o as unknown as CargaFisica).tipo;
    return t === "puntual" || t === "lineal" || t === "superficie" ? (o.planta as string) : null;
  }
  return typeof o.planta === "string" ? o.planta : null;
}

/** El nombre de un eje copiado: la letra o el número siguiente, como al dibujarlo. */
function nombreEje(m: ModeloFisico, a: Vec2, b: Vec2, usados: Set<string>): string {
  const g = (direccionEjes(m) * Math.PI) / 180;
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const conLetra = l > 0 && Math.abs(((b[0] - a[0]) * Math.cos(g) + (b[1] - a[1]) * Math.sin(g)) / l) >= Math.SQRT1_2;
  for (let i = 0; ; i++) {
    const n = conLetra ? letraEje(i) : String(i + 1);
    if (!usados.has(n)) {
      usados.add(n);
      return n;
    }
  }
}

/** Un texto con los ids, «P1, P2 y 3 más». */
export function listaIds(ids: readonly string[], max = 4): string {
  if (ids.length <= max) return ids.length > 1 ? `${ids.slice(0, -1).join(", ")} y ${ids.at(-1)}` : (ids[0] ?? "");
  return `${ids.slice(0, max).join(", ")} y ${ids.length - max} más`;
}

/**
 * Lo elegido (`ids`), transformado con `t`: movido, o copiado con `copiar`. Falla si no hay nada que
 * transformar, si la transformación no hace nada o si una copia caería encima de lo copiado.
 */
export function transformar(m: ModeloFisico, ids: readonly string[], t: Transformacion, o: OpcionesTransformar = {}): ResultadoTransformar {
  const tr = new Transformador(t);
  const idx = indiceIds(m);
  const avisos: string[] = [];
  const elegidos: { c: Coleccion; o: Objeto }[] = [];
  const vistos = new Set<string>();
  for (const id of ids) {
    const x = idx.get(id);
    if (!x || !GEOMETRICAS.has(x.coleccion) || vistos.has(id)) continue;
    vistos.add(id);
    elegidos.push({ c: x.coleccion, o: lista(m, x.coleccion)[x.indice]! });
  }
  // Una carga sobre una pieza que no se elige va con su pieza: sola, no se mueve
  const sueltas = elegidos.filter((x) => x.c === "cargas" && soporteDe(x.o as unknown as CargaFisica) && !vistos.has(soporteDe(x.o as unknown as CargaFisica)!) && !(x.o as unknown as CargaFisica & { zona?: unknown }).zona);
  if (sueltas.length) {
    avisos.push(`${listaIds(sueltas.map((x) => x.o.id))} ${sueltas.length > 1 ? "van" : "va"} sobre una pieza que no está elegida: ${sueltas.length > 1 ? "se mueven" : "se mueve"} con ella.`);
    for (const s of sueltas) elegidos.splice(elegidos.indexOf(s), 1);
  }
  if (!elegidos.length) return { ok: false, mensaje: ids.length ? "Lo elegido no tiene geometría que mover (elija pilares, vigas, forjados, muros, apoyos, cargas o ejes)." : "No hay nada elegido." };
  const enElegidos = new Set(elegidos.map((x) => x.o.id));
  // Las cargas que van con lo elegido (y no están elegidas)
  const acompanan = (m.cargas ?? []).filter((c) => !enElegidos.has(c.id) && enElegidos.has(soporteDe(c) ?? "")) as unknown as Objeto[];
  const todas = [...elegidos, ...acompanan.map((x) => ({ c: "cargas" as Coleccion, o: x }))];

  return o.copiar ? copiar(m, tr, todas, enElegidos, o, avisos) : mover(m, tr, todas, o, avisos);
}

function mover(m: ModeloFisico, tr: Transformador, todas: { c: Coleccion; o: Objeto }[], o: OpcionesTransformar, avisos: string[]): ResultadoTransformar {
  if (tr.identidad) return { ok: false, mensaje: tr.t.tipo === "mover" ? "El destino es el punto base: no se mueve nada." : "Un giro de 0° no mueve nada." };
  const ops: Operacion[] = [];
  const movidos = new Set(todas.map((x) => x.o.id));
  for (const { c, o: x } of todas) {
    const n = transformado(m, tr, c, x, avisos);
    if (cambia(x, n)) ops.push({ op: "cambiar", coleccion: c, id: x.id, objeto: n });
  }
  // V2c-d: las vigas no elegidas que acaban en el punto fijo de un pilar que se mueve
  const pilares = todas.filter((x) => x.c === "pilares").map((x) => x.o as unknown as Pilar);
  if (pilares.length) {
    const nuevas = new Map<string, Vec2[]>();
    const quedan = new Set<string>();
    const cara = new Set<string>();
    for (const pl of m.plantas) {
      const planta = new PlantaFisica(m, pl.id);
      const aqui = planta.pilares().filter((r) => movidos.has(r.p.id));
      if (!aqui.length) continue;
      for (const v of planta.enPlanta(m.vigas)) {
        if (movidos.has(v.id)) continue;
        for (const { p, seccion } of aqui) {
          const fijo: Vec2 = [p.x, p.y];
          const i = v.puntos.findIndex((r) => igual(r, fijo));
          if (i >= 0) {
            if (o.conVigas === false) {
              quedan.add(v.id);
              continue;
            }
            const ps = nuevas.get(v.id) ?? [...v.puntos];
            v.puntos.forEach((r, k) => igual(r, fijo) && (ps[k] = tr.punto(fijo)));
            nuevas.set(v.id, ps);
          } else {
            const h = huellaSeccion(p, seccion);
            const dentro = (r: Vec2) => (h ? ("anillo" in h ? puntoEnPoligono(r, h.anillo) || distanciaABorde(r, h.anillo) <= 1e-9 : Math.hypot(r[0] - h.centro[0], r[1] - h.centro[1]) <= h.radio + 1e-9) : false);
            if (v.puntos.some(dentro)) cara.add(v.id);
          }
        }
      }
    }
    for (const [id, ps] of nuevas) {
      const v = m.vigas!.find((x) => x.id === id)!;
      ops.push({ op: "cambiar", coleccion: "vigas", id, objeto: { ...v, puntos: ps } as unknown as Objeto });
      cara.delete(id);
    }
    const plural = (ids: Set<string>, uno: string, varios: string) => (ids.size > 1 ? `Las vigas ${listaIds([...ids])} ${varios}` : `La viga ${[...ids][0]} ${uno}`);
    if (quedan.size) avisos.push(`${plural(quedan, "acaba en un pilar que se mueve y se queda donde estaba", "acaban en un pilar que se mueve y se quedan donde estaban")}.`);
    if (cara.size) avisos.push(`${plural(cara, "llega a un pilar que se mueve sin acabar en su punto fijo (alineada a una cara) y no lo sigue", "llegan a un pilar que se mueve sin acabar en su punto fijo (alineadas a una cara) y no lo siguen")}.`);
  }
  if (!ops.length) return { ok: false, mensaje: "La transformación no cambia nada." };
  return { ok: true, operacion: ops.length === 1 ? ops[0]! : { op: "lote", operaciones: ops }, avisos, nuevos: [] };
}

function copiar(m: ModeloFisico, tr: Transformador, todas: { c: Coleccion; o: Objeto }[], elegidos: ReadonlySet<string>, o: OpcionesTransformar, avisos: string[]): ResultadoTransformar {
  const plantas = new Set(m.plantas.map((p) => p.id));
  for (const p of o.plantas ?? []) if (!plantas.has(p)) return { ok: false, mensaje: `No hay ninguna planta «${p}».` };
  const destinos = o.plantas?.length ? o.plantas : null;
  const idx = indiceIds(m);
  const ocupados = new Set<string>();
  const nuevoId = (c: Coleccion) => {
    const id = idNuevo(m, PREFIJO[c] ?? "X", ocupados);
    ocupados.add(id);
    return id;
  };
  const nombresEjes = new Set(ejesDe(m).ejes.flatMap((e) => [e.id, e.nombre ?? e.id]));
  const ops: Operacion[] = [];
  const nuevos: string[] = [];
  const saltados: string[] = [];
  const cargas = todas.filter((x) => x.c === "cargas");
  const piezas = todas.filter((x) => x.c !== "cargas");
  /** Las copias de cada objeto, por planta (la de su copia, o "" sin planta). */
  const copias = new Map<string, Map<string, string>>();
  const crear = (c: Coleccion, x: Objeto, planta: string | null) => {
    let n = transformado(m, tr, c, x, avisos);
    // La copia en su sitio (desplazamiento nulo en su planta) caería encima
    if (tr.identidad && (planta === null || planta === plantaDe(c, x))) return saltados.push(x.id);
    let id: string;
    if (c === "ejes") {
      const nombre = nombreEje(m, n.desde as Vec2, n.hasta as Vec2, nombresEjes);
      id = !idx.has(nombre) && !ocupados.has(nombre) ? nombre : nuevoId(c);
      ocupados.add(id);
      const { nombre: _n, ...resto } = n;
      n = { ...resto, ...(id !== nombre ? { nombre } : {}) } as Objeto;
    } else id = nuevoId(c);
    n = { ...n, id, ...(planta !== null && "planta" in n ? { planta } : {}) };
    ops.push({ op: "crear", coleccion: c, objeto: n });
    nuevos.push(id);
    const k = copias.get(x.id) ?? new Map<string, string>();
    k.set(planta ?? "", id);
    copias.set(x.id, k);
  };
  for (const { c, o: x } of piezas) {
    const propia = plantaDe(c, x);
    if (propia === null) crear(c, x, null);
    else for (const p of destinos ?? [propia]) crear(c, x, p);
  }
  for (const { o: x } of cargas) {
    const carga = x as unknown as CargaFisica;
    const soporte = soporteDe(carga);
    const propia = plantaDe("cargas", x);
    if (soporte && copias.has(soporte)) {
      // Con su pieza: una copia por cada copia de la pieza, apuntando a ella
      for (const [planta, sid] of copias.get(soporte)!) {
        const campo = carga.tipo === "viga" ? "viga" : carga.tipo === "pilar" ? "pilar" : carga.tipo === "empuje" ? "muro" : carga.tipo === "superficie" && carga.losa ? "losa" : "pano";
        let n = transformado(m, tr, "cargas", x, avisos);
        const id = nuevoId("cargas");
        n = { ...n, id, [campo]: sid, ...(planta && "planta" in n ? { planta } : {}) };
        ops.push({ op: "crear", coleccion: "cargas", objeto: n });
        nuevos.push(id);
      }
    } else if (soporte && !elegidos.has(soporte)) {
      // Una zona de carga sobre un forjado que no se copia: sólo en su planta
      if (destinos && destinos.some((p) => p !== propia)) return { ok: false, mensaje: `${x.id} va sobre ${soporte}, que no se copia: no se puede llevar a otras plantas sin él (elíjalo también).` };
      crear("cargas", x, propia);
    } else if (!soporte) {
      if (propia === null) crear("cargas", x, null);
      else for (const p of destinos ?? [propia]) crear("cargas", x, p);
    }
  }
  if (saltados.length) avisos.push(`${listaIds(saltados)} no se ${saltados.length > 1 ? "copian" : "copia"}: la copia caería encima (destino en el punto base y en su planta).`);
  if (!ops.length) return { ok: false, mensaje: tr.identidad ? "El destino es el punto base: la copia caería encima de lo copiado." : "No hay nada que copiar." };
  return { ok: true, operacion: ops.length === 1 ? ops[0]! : { op: "lote", operaciones: ops }, avisos, nuevos };
}

// ─── Pinzamientos ───────────────────────────────────────────────────────────────────────────────

/** Un vértice de un objeto que se puede arrastrar: el objeto, dónde está en él y su punto. */
export interface Asa {
  id: string;
  coleccion: Coleccion;
  /** La ruta del punto en el objeto: ["x"] (pilar, apoyo, puntual), ["puntos", i], ["contorno", i], ["huecos", j, i], ["reticular", "abacos", j, i], ["zona", i], ["desde"], ["hasta"]. */
  ruta: readonly (string | number)[];
  p: Vec2;
}

/** Los vértices de lo elegido que están en la planta `planta`, para arrastrarlos. */
export function asas(m: ModeloFisico, ids: readonly string[], planta: string): Asa[] {
  const idx = indiceIds(m);
  const pf = new PlantaFisica(m, planta);
  const pilares = new Set(pf.pilares().map((r) => r.p.id));
  const muros = new Set(pf.muros().map((r) => r.m.id));
  const r: Asa[] = [];
  for (const id of ids) {
    const x = idx.get(id);
    if (!x) continue;
    const c = x.coleccion;
    const o = lista(m, c)[x.indice]!;
    const add = (ruta: (string | number)[], p: Vec2) => r.push({ id, coleccion: c, ruta, p });
    const linea = (campo: string, ps: readonly Vec2[], ...pre: (string | number)[]) => ps.forEach((p, i) => add([...pre, campo, i], p));
    const anillos = (campo: string, hs: readonly (readonly Vec2[])[] | undefined, ...pre: string[]) => hs?.forEach((h, j) => h.forEach((p, i) => add([...pre, campo, j, i], p)));
    const enPlanta = o.planta === planta;
    switch (c) {
      case "pilares":
        if (pilares.has(id)) add(["x"], [o.x as number, o.y as number]);
        break;
      case "apoyos":
        if (enPlanta) add(["x"], [o.x as number, o.y as number]);
        break;
      case "vigas":
      case "apoyosLineales":
        if (enPlanta) linea("puntos", o.puntos as Vec2[]);
        break;
      case "muros":
        if (muros.has(id)) {
          const ps = o.puntos as Vec2[];
          // Un muro cerrado repite el primero al final: un asa para los dos
          const cerrado = ps.length > 2 && igual(ps[0]!, ps.at(-1)!);
          linea("puntos", cerrado ? ps.slice(0, -1) : ps);
        }
        break;
      case "losas":
      case "panos":
        if (!enPlanta) break;
        linea("contorno", o.contorno as Vec2[]);
        anillos("huecos", o.huecos as Vec2[][] | undefined);
        anillos("abacos", (o.reticular as { abacos?: Vec2[][] } | undefined)?.abacos, "reticular");
        break;
      case "bandas":
        if (enPlanta) (["desde", "hasta"] as const).forEach((k) => add([k], o[k] as Vec2));
        break;
      case "ejes":
        (["desde", "hasta"] as const).forEach((k) => add([k], o[k] as Vec2));
        break;
      case "cargas": {
        const carga = o as unknown as CargaFisica;
        if (carga.tipo === "puntual" && enPlanta) add(["x"], [carga.x, carga.y]);
        else if (carga.tipo === "lineal" && enPlanta) linea("puntos", carga.puntos);
        else if (carga.tipo === "superficie" && enPlanta && carga.zona) linea("zona", carga.zona);
        break;
      }
    }
  }
  return r;
}

const longitudes = (ps: readonly Vec2[]): number[] => {
  const r = [0];
  for (let i = 1; i < ps.length; i++) r.push(r[i - 1]! + Math.hypot(ps[i]![0] - ps[i - 1]![0], ps[i]![1] - ps[i - 1]![1]));
  return r;
};

/** La estación s de la polilínea `ps`, medida otra vez sobre `qs` (los mismos vértices, alguno movido): en su tramo, a la misma fracción. */
function reestacionar(ps: readonly Vec2[], qs: readonly Vec2[], s: number): number {
  const [l0, l1] = [longitudes(ps), longitudes(qs)];
  let i = 0;
  while (i < ps.length - 2 && s > l0[i + 1]!) i++;
  const largo = l0[i + 1]! - l0[i]!;
  const lam = largo > 0 ? (s - l0[i]!) / largo : 0;
  const r = l1[i]! + lam * (l1[i + 1]! - l1[i]!);
  // Como las estaciones dibujadas (V2c2-1): a 1e-9 m
  return Math.min(Math.max(Math.round(r * 1e9) / 1e9, 0), l1.at(-1)!);
}

/**
 * El vértice `a` llevado a q. Un pilar se mueve con `moverPilar` (con sus vigas, salvo `conVigas:
 * false`); en un muro cerrado, el primer punto y el último van juntos. Los huecos del muro y los
 * tramos de las cargas de la viga se vuelven a medir en su tramo.
 */
export function moverAsa(m: ModeloFisico, a: Asa, q: Vec2, conVigas = true): ResultadoTransformar {
  if (!Number.isFinite(q[0]) || !Number.isFinite(q[1])) return { ok: false, mensaje: "La posición tiene que ser un número." };
  if (igual(a.p, q)) return { ok: false, mensaje: "El punto no se ha movido." };
  const x = indiceIds(m).get(a.id);
  if (!x || x.coleccion !== a.coleccion) return { ok: false, mensaje: `No hay ningún objeto ${a.id}.` };
  if (a.coleccion === "pilares") {
    const r = moverPilar(m, a.id, q, conVigas);
    return r.ok ? { ok: true, operacion: r.operacion, avisos: r.avisos, nuevos: [] } : r;
  }
  const o = lista(m, a.coleccion)[x.indice]!;
  if (a.ruta[0] === "x") return { ok: true, operacion: { op: "cambiar", coleccion: a.coleccion, id: a.id, objeto: { ...o, x: q[0], y: q[1] } }, avisos: [], nuevos: [] };
  if (a.ruta[0] === "desde" || a.ruta[0] === "hasta") {
    const otro = o[a.ruta[0] === "desde" ? "hasta" : "desde"] as Vec2;
    if (igual(otro, q)) return { ok: false, mensaje: "Los dos extremos quedarían en el mismo punto." };
    return { ok: true, operacion: { op: "cambiar", coleccion: a.coleccion, id: a.id, objeto: { ...o, [a.ruta[0]]: q } }, avisos: [], nuevos: [] };
  }
  // Un punto de una lista: la lista con el punto cambiado
  const ruta = a.ruta;
  const i = ruta.at(-1) as number;
  let actual: unknown = o;
  for (const k of ruta.slice(0, -1)) actual = (actual as Record<string | number, unknown>)[k];
  const ps = actual as readonly Vec2[];
  const qs = [...ps];
  qs[i] = q;
  const cerrado = a.coleccion === "muros" && ps.length > 2 && igual(ps[0]!, ps.at(-1)!);
  if (cerrado && i === 0) qs[qs.length - 1] = q;
  const anillo = ruta[0] !== "puntos" || cerrado;
  // Dos vértices seguidos en el mismo punto (en un anillo, cualquiera)
  const n = cerrado ? qs.length - 1 : qs.length;
  for (let k = 0; k < n; k++) {
    if (k === i) continue;
    const vecino = Math.abs(k - i) === 1 || (anillo && Math.abs(k - i) === n - 1);
    if (igual(qs[k]!, q) && (anillo || vecino)) return { ok: false, mensaje: `El punto cae encima de otro vértice de ${a.id}.` };
  }
  const objeto = conValor(o, ruta.slice(0, -1), qs);
  const ops: Operacion[] = [];
  const avisos: string[] = [];
  if (a.coleccion === "muros" && o.huecos) {
    const huecos = (o.huecos as { desde: number; hasta: number }[]).map((h) => ({ ...h, desde: reestacionar(ps, qs, h.desde), hasta: reestacionar(ps, qs, h.hasta) }));
    ops.push({ op: "cambiar", coleccion: "muros", id: a.id, objeto: { ...objeto, huecos } });
  } else ops.push({ op: "cambiar", coleccion: a.coleccion, id: a.id, objeto });
  if (a.coleccion === "vigas")
    for (const c of m.cargas ?? []) {
      if (c.tipo !== "viga" || c.viga !== a.id || (c.desde === undefined && c.hasta === undefined)) continue;
      ops.push({ op: "cambiar", coleccion: "cargas", id: c.id, objeto: { ...c, ...(c.desde !== undefined ? { desde: reestacionar(ps, qs, c.desde) } : {}), ...(c.hasta !== undefined ? { hasta: reestacionar(ps, qs, c.hasta) } : {}) } as unknown as Objeto });
    }
  return { ok: true, operacion: ops.length === 1 ? ops[0]! : { op: "lote", operaciones: ops }, avisos, nuevos: [] };
}
