/**
 * El DWG frente al DXF del mismo dibujo (fase DW, `docs/fem3d/dwg.md` §5, criterios 1 y 3).
 *
 * Lo que cuenta es lo que dibuja `aplanar.ts`, así que la comparación es la de lo aplanado: el
 * dibujo entero y, para encontrar dónde está una diferencia, cada entidad sola (por su handle, el
 * código 5 que los dos guardan) con los bloques de su fichero. Así no importa que AutoCAD escriba o
 * no un código con su valor por defecto. Además: las capas, `$INSUNITS`, el orden del espacio modelo
 * y de cada bloque, y la base de cada bloque.
 *
 * Lo usan la prueba con las muestras de AutoCAD (`dwg.test.ts`) y la comparación con los DWG del
 * usuario (`validacion/dwg/`). Puro.
 */

import { aplanarDxf, type DibujoDxf } from "../dxf/aplanar.ts";
import { type Dxf, type Entidad, texto } from "../dxf/lector.ts";

export interface ComparacionDwg {
  /** Entidades emparejadas por handle (las del espacio modelo y las de los bloques). */
  emparejadas: number;
  /** El mayor error de lo aplanado, en unidades del dibujo, y dónde. */
  errorMaximo: number;
  donde: string;
  /** La tolerancia usada: `tol` por el tamaño del dibujo. */
  tolerancia: number;
  /** Bloques que AutoCAD regeneró al escribir el DXF (otros handles): se emparejan por posición. */
  regenerados: string[];
  /** Bloques anónimos del DWG que nada usa y que AutoCAD no escribe en el DXF (DW3-8). */
  huerfanos: string[];
  fallos: string[];
}

/** Quita de un dibujo las entidades con esos handles (en el espacio modelo y en los bloques). */
function sin(d: Dxf, handles: ReadonlySet<string>): Dxf {
  if (handles.size === 0) return d;
  const f = (l: Entidad[]) => l.filter((e) => !handles.has(texto(e, 5)));
  return { ...d, entidades: f(d.entidades), bloques: new Map([...d.bloques].map(([n, b]) => [n, { ...b, entidades: f(b.entidades) }])) };
}

/** Las diferencias entre dos dibujos aplanados, con la tolerancia t en las coordenadas. */
export function diferenciasDibujo(a: DibujoDxf, b: DibujoDxf, t: number, tAng = 1e-9): { fallos: string[]; error: number } {
  const fallos: string[] = [];
  let error = 0;
  const numeros = (nombre: string, x: ArrayLike<number>, y: ArrayLike<number>, tol: number) => {
    if (x.length !== y.length) {
      fallos.push(`${nombre}: ${x.length} frente a ${y.length}`);
      return;
    }
    for (let i = 0; i < x.length; i++) {
      const e = Math.abs(x[i]! - y[i]!);
      if (tol === t && e > error) error = e;
      if (!(e <= tol)) {
        fallos.push(`${nombre}[${i}]: ${x[i]} frente a ${y[i]}`);
        return;
      }
    }
  };
  const iguales = (nombre: string, x: ArrayLike<number>, y: ArrayLike<number>) => numeros(nombre, x, y, 0);
  numeros("líneas", a.lineas, b.lineas, t);
  iguales("grupo de las líneas", a.grupoLineas, b.grupoLineas);
  numeros("curvas", a.curvas, b.curvas, t);
  iguales("grupo de las curvas", a.grupoCurvas, b.grupoCurvas);
  numeros("puntos", a.puntos, b.puntos, t);
  iguales("tipo de los puntos", a.tipoPuntos, b.tipoPuntos);
  iguales("grupo de los puntos", a.grupoPuntos, b.grupoPuntos);
  iguales("grupos", a.grupos, b.grupos);
  if (a.textos.length !== b.textos.length) fallos.push(`textos: ${a.textos.length} frente a ${b.textos.length}`);
  else
    a.textos.forEach((x, i) => {
      const y = b.textos[i]!;
      if (x.texto !== y.texto || x.h !== y.h || x.v !== y.v || x.grupo !== y.grupo) fallos.push(`texto ${i}: «${x.texto}» (${x.h}, ${x.v}) frente a «${y.texto}» (${y.h}, ${y.v})`);
      numeros(`texto ${i} «${x.texto}»`, [x.x, x.y, x.altura], [y.x, y.y, y.altura], t);
      const dg = Math.abs(Math.atan2(Math.sin(x.giro - y.giro), Math.cos(x.giro - y.giro)));
      if (!(dg <= tAng)) fallos.push(`texto ${i} «${x.texto}»: giro ${x.giro} frente a ${y.giro}`);
    });
  const ig = (d: DibujoDxf) => JSON.stringify(Object.entries(d.ignoradas).sort());
  if (ig(a) !== ig(b)) fallos.push(`no leídas: ${ig(a)} frente a ${ig(b)}`);
  if (a.avisos.join("|") !== b.avisos.join("|")) fallos.push(`avisos: [${a.avisos.join("; ")}] frente a [${b.avisos.join("; ")}]`);
  return { fallos, error };
}

/**
 * `excluir`: handles que no se comparan, con su motivo (las diferencias conocidas, que se dicen en
 * los hallazgos). Se quitan de los dos lados antes de nada.
 */
export function compararDwgConDxf(dwg0: Dxf, dxf0: Dxf, tol = 1e-9, excluir: ReadonlyMap<string, string> = new Map()): ComparacionDwg {
  const fuera = new Set(excluir.keys());
  const dwg = sin(dwg0, fuera);
  const dxf = sin(dxf0, fuera);
  const fallos: string[] = [];
  const regenerados: string[] = [];
  const huerfanos: string[] = [];
  const fallo = (s: string) => {
    if (fallos.length < 60) fallos.push(s);
  };

  if (dwg.insunits !== dxf.insunits) fallo(`$INSUNITS: DWG ${dwg.insunits}, DXF ${dxf.insunits}`);
  const capas = (d: Dxf) => d.capas.map((c) => `${c.nombre}${c.apagada ? " apagada" : ""}${c.congelada ? " congelada" : ""}`);
  if (capas(dwg).join("|") !== capas(dxf).join("|")) fallo(`capas: DWG [${capas(dwg).join(", ")}], DXF [${capas(dxf).join(", ")}]`);

  // El dibujo entero, y su tamaño para la tolerancia
  const todoW = aplanarDxf(dwg);
  const todoX = aplanarDxf(dxf);
  const ext = todoX.extension ?? [0, 0, 1, 1];
  const tamano = Math.max(1, Math.abs(ext[0]), Math.abs(ext[1]), Math.abs(ext[2]), Math.abs(ext[3]));
  const t = tol * tamano;
  let errorMaximo = 0;
  let donde = "";
  let emparejadas = 0;

  /** Las entidades de una lista, por handle: tipo, capa, hijos, orden y lo que dibuja cada una. */
  const listas = (dondeEsta: string, lw: Entidad[], lx: Entidad[], base: (ents: Entidad[], de: Dxf) => Dxf) => {
    const antes = fallos.length;
    const hw = lw.map((e) => texto(e, 5));
    const hx = lx.map((e) => texto(e, 5));
    const sx = new Set(hx);
    const sw = new Set(hw);
    for (const h of hw) if (!sx.has(h)) fallo(`${dondeEsta}: ${h} está en el DWG y no en el DXF`);
    for (const h of hx) if (!sw.has(h)) fallo(`${dondeEsta}: ${h} (${lx.find((e) => texto(e, 5) === h)!.tipo}) está en el DXF y no en el DWG`);
    const ow = hw.filter((h) => sx.has(h));
    const ox = hx.filter((h) => sw.has(h));
    const k = ow.findIndex((h, i) => h !== ox[i]);
    if (k >= 0) fallo(`${dondeEsta}: la ${k + 1}.ª entidad es ${ow[k]} en el DWG y ${ox[k]} en el DXF`);
    // Sin ningún handle en común y con los mismos tipos en el mismo orden: AutoCAD lo regeneró al escribir el DXF
    const regenerado = lw.length > 0 && ow.length === 0 && lw.length === lx.length && lw.every((e, i) => e.tipo === lx[i]!.tipo);
    if (regenerado) {
      regenerados.push(dondeEsta);
      fallos.splice(antes);
    }
    const porX = new Map(lx.map((e) => [texto(e, 5), e]));
    for (const [i, w] of lw.entries()) {
      const x = regenerado ? lx[i] : porX.get(texto(w, 5));
      if (!x) continue;
      emparejadas++;
      const id = `${dondeEsta}: ${w.tipo} ${texto(w, 5)}`;
      if (w.tipo !== x.tipo) fallo(`${id}: tipo DXF ${x.tipo}`);
      if (w.capa !== x.capa) fallo(`${id}: capa DWG «${w.capa}», DXF «${x.capa}»`);
      if ((w.hijos?.length ?? 0) !== (x.hijos?.length ?? 0)) fallo(`${id}: ${w.hijos?.length ?? 0} hijos en el DWG y ${x.hijos?.length ?? 0} en el DXF`);
      const r = diferenciasDibujo(aplanarDxf(base([w], dwg)), aplanarDxf(base([x], dxf)), t);
      for (const f of r.fallos.slice(0, 3)) fallo(`${id}: ${f}`);
      if (r.error > errorMaximo) {
        errorMaximo = r.error;
        donde = id;
      }
    }
  };

  listas("modelo", dwg.entidades, dxf.entidades, (ents, de) => ({ ...de, entidades: ents }));

  // Los bloques: los mismos, con la misma base y las mismas entidades en el mismo orden
  // Un anónimo que ninguna inserción ni cota usa, AutoCAD no lo escribe en el DXF: no cuenta
  const usados = new Set<string>();
  const usar = (l: Entidad[]) => l.forEach((e) => (e.tipo === "INSERT" || e.tipo === "DIMENSION") && usados.add(texto(e, 2)));
  usar(dwg.entidades);
  for (const b of dwg.bloques.values()) usar(b.entidades);
  for (const n of dwg.bloques.keys()) if (!dxf.bloques.has(n) && n.startsWith("*") && !usados.has(n) && !/^\*(model|paper)_space/i.test(n)) huerfanos.push(n);
  const nw = [...dwg.bloques.keys()].filter((n) => !huerfanos.includes(n)).sort();
  const nx = [...dxf.bloques.keys()].sort();
  if (nw.join("|") !== nx.join("|")) {
    const sx = new Set(nx);
    const sw = new Set(nw);
    fallo(`bloques: sólo en el DWG [${nw.filter((n) => !sx.has(n)).join(", ")}], sólo en el DXF [${nx.filter((n) => !sw.has(n)).join(", ")}]`);
  }
  for (const [nombre, bw] of dwg.bloques) {
    const bx = dxf.bloques.get(nombre);
    if (!bx) continue;
    if (bw.base.some((c, i) => !(Math.abs(c - bx.base[i]!) <= t))) fallo(`bloque «${nombre}»: base ${bw.base} frente a ${bx.base}`);
    // Cada entidad del bloque, dibujada sola en el espacio modelo
    listas(`bloque «${nombre}»`, bw.entidades, bx.entidades, (ents, de) => ({ ...de, entidades: ents }));
  }

  const r = diferenciasDibujo(todoW, todoX, t);
  for (const f of r.fallos.slice(0, 10)) fallo(`dibujo entero: ${f}`);
  if (r.error > errorMaximo) {
    errorMaximo = r.error;
    donde = "dibujo entero";
  }

  return { emparejadas, errorMaximo, donde, tolerancia: t, regenerados, huerfanos, fallos };
}
