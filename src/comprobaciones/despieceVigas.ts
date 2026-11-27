/**
 * Fase CO6 (`docs/fem3d/comprobaciones.md` §8.13): el despiece de las vigas de un pórtico. Del armado
 * de cada vano (el dato del proyecto: una armadura por cara y por zona, y los cercos por zona) salen
 * las barras una a una, con dónde empieza y acaba cada una, sus patillas y su largo, y los cercos de
 * cada zona contados.
 *
 * Puro y sin números de cálculo: no cambia lo que se comprueba. Coloca lo que dice el armado con
 * estas reglas de obra (CO6-h), que sólo alargan las barras más allá de donde la comprobación cuenta
 * con ellas:
 *
 *  - **Inferior** (y la de piel): de cara a cara de los apoyos del vano, más su anclaje en cada uno.
 *  - **Superior corrida** (CO6-h, decidida el 2026-11-26: §8.27): pasa de un vano al siguiente sobre
 *    el apoyo si los dos llevan la misma (n y Ø). Si de una pieza pasa de 12 m, se empalma en el
 *    centro de un vano (donde la cara superior no está traccionada, o lo está poco), nunca sobre un
 *    apoyo: cada pieza llega lo más lejos que puede sin pasar de 12 m, y las dos se cruzan la
 *    longitud de solape, `SOLAPE`·lb (todas las barras solapadas en la misma sección), centrada en
 *    el centro del vano. En un voladizo no se empalma. Donde la corrida cambia de un vano a otro
 *    (otro n u otro Ø) no queda más remedio que empalmar sobre el apoyo: cada una se ancla más
 *    allá de la cara de enfrente y, además, las dos se cruzan al menos la longitud de solape (la
 *    del mayor anclaje de las dos), centrada en el eje del apoyo. Lo mismo las de la zona de un
 *    apoyo cuando a cada lado son de otro diámetro y nada pasa sobre él. Donde la zona de un apoyo lleva
 *    otro diámetro, la corrida es sólo el montaje del centro: empieza una longitud de anclaje antes
 *    del fin de esa zona (se cruza con la del apoyo esa longitud, el decalaje y el anclaje de
 *    ella: más que la de solape).
 *  - **Superior de un apoyo:** lo que la zona (el cuarto de la luz junto al apoyo) tiene de más sobre
 *    la corrida, o toda la de la zona si es de otro diámetro. Cubre la zona y sigue el decalaje
 *    (z·cot θ / 2, con z = 0,9·d) más su anclaje. Sobre un apoyo con vano a los dos lados, lo común
 *    a los dos pasa de uno a otro, y lo que un lado tiene de más se ancla más allá de su cara.
 *  - **El anclaje**, el básico de la barra a fyd (`lb,rqd`, CE A19 §8.4.3; lo da quien llama, por
 *    vano, diámetro y posición), al alza a 5 cm. En un apoyo extremo, recto si cabe hasta el
 *    recubrimiento de su cara de fuera; si no, hasta ahí y una patilla: la mayor de 0,7·lb menos lo
 *    recto y 10 Ø.
 *  - **Los cercos**, donde los pone `alzadoVano` (el primero a 5 cm de la cara, y los de cada zona a
 *    su separación), contados por tramos del mismo cerco.
 */
import type { ArmadoVanoViga, BarrasCara, CercosViga } from "./armado.ts";
import { ramasDe } from "./armado.ts";
import { alzadoVano, barrasValidas, cercosValidos } from "./dibujoArmado.ts";
import type { Portico, VanoPortico } from "./porticos.ts";

/** Los largos (anclajes, patillas, puntas libres), al alza a esto, m. */
export const MODULO_BARRA = 0.05;
/** Una barra comercial, m: de más, se solapa en obra. */
export const BARRA_MAXIMA = 12;
/** La patilla, al menos esto por su diámetro. */
export const PATILLA_MINIMA = 10;
/** Con patilla, el anclaje es esta parte del recto (CE A19 tabla 8.2, α1). */
export const ANCLAJE_CON_PATILLA = 0.7;
/** El solape de unas barras traccionadas que se solapan todas en la misma sección, sobre su anclaje (CE A19 §8.7.3, α6). */
export const SOLAPE = 1.5;
/** Dos barras de un apoyo iguales que se pisan o quedan a menos de esto son una, m. */
export const UNION_BARRAS = 0.1;

export interface DatosDespiece {
  /** Hasta el cerco, mm. */
  recubrimiento: number;
  /** cot θ de las bielas del cortante, para el decalaje. */
  cotTheta: number;
  /** El acero de las barras, MPa (para el área capaz, `capacidadVigas.ts`; sin él, B500). */
  fyk?: number;
  /** El anclaje básico de cada vano (por su clave), m: por diámetro, [en buena adherencia, en la cara superior]. */
  anclajes: Readonly<Record<string, Readonly<Record<number, readonly [number, number]>>>>;
}

/** De qué campo del armado de qué vano sale una barra (para resaltarla con el formulario). */
export interface OrigenBarra {
  clave: string;
  /** «inferior», «superior», «superiorInicio», «cercosFin»… */
  ruta: string;
}

export interface BarraDespiece {
  /** Su posición en el despiece, desde 1. */
  marca: number;
  cara: "inferior" | "superior" | "piel";
  /** `vano`: la inferior de un vano; `corrida`: la superior de montaje; `apoyo`: la superior de la zona de un apoyo. */
  papel: "vano" | "corrida" | "apoyo" | "piel";
  n: number;
  diametro: number;
  /** Su tramo recto a lo largo del pórtico, m. */
  x: [number, number];
  /** La patilla de cada punta, m (0, recta). */
  patillas: [number, number];
  /** El largo de una barra, m: lo recto más las patillas, al cm. */
  largo: number;
  /** Los ejes de los apoyos que quedan dentro de su tramo recto, m: para acotarla respecto a ellos. */
  ejes: number[];
  origen: OrigenBarra[];
}

export interface CercosDespiece {
  /** Del primer cerco al último, m. */
  x: [number, number];
  /** Cuántos. */
  n: number;
  cercos: CercosViga;
  /** El desarrollo de un cerco con sus ramas y sus ganchos, m (estimado). */
  largo: number;
  origen: OrigenBarra[];
}

export interface FilaMedicion {
  /** La marca de la barra, o «c» + n de los cercos. */
  marca: string;
  que: string;
  n: number;
  diametro: number;
  /** m */
  largo: number;
  /** m */
  total: number;
  kg: number;
}

export interface DespiecePortico {
  barras: BarraDespiece[];
  cercos: CercosDespiece[];
  medicion: FilaMedicion[];
  /** kg por diámetro, de menor a mayor, y el total. */
  acero: { porDiametro: { diametro: number; kg: number }[]; total: number };
  avisos: string[];
}

const alModulo = (x: number) => Math.ceil(x / MODULO_BARRA - 1e-9) * MODULO_BARRA;
/** kg/m de una barra de Ø mm (7 850 kg/m³). */
export const pesoBarra = (diametro: number) => (7850 * Math.PI * diametro * diametro) / 4e6;
const cm = (x: number) => Math.round(x * 100) / 100;

/** El armado de un vano mirado en el sentido del pórtico: lo de su inicio, a la izquierda si la viga no va invertida. */
interface Orientado {
  inferior: BarrasCara | undefined;
  superior: BarrasCara | undefined;
  /** La superior propia de la zona de cada lado, con el campo del que sale. */
  zonas: [{ barras: BarrasCara; ruta: string } | undefined, { barras: BarrasCara; ruta: string } | undefined];
  piel: BarrasCara | undefined;
}

function orientar(a: Partial<ArmadoVanoViga> | null | undefined, invertida: boolean): Orientado {
  const zona = (ruta: "superiorInicio" | "superiorFin") => (barrasValidas(a?.[ruta]) ? { barras: a![ruta]!, ruta } : undefined);
  const [ini, fin] = [zona("superiorInicio"), zona("superiorFin")];
  return {
    inferior: barrasValidas(a?.inferior) ? a!.inferior : undefined,
    superior: barrasValidas(a?.superior) ? a!.superior : undefined,
    zonas: invertida ? [fin, ini] : [ini, fin],
    piel: barrasValidas(a?.piel) ? a!.piel : undefined,
  };
}

/** El desarrollo de un cerco de una viga b × h (mm) con sus ramas, m: el cerco de fuera, otro por cada par de ramas de más y una horquilla por la impar, cada uno con dos ganchos. */
export function desarrolloCerco(g: { b: number; h: number }, c: CercosViga, recubrimiento: number): number {
  const o = c.diametro;
  const [bw, hw] = [Math.max(g.b - 2 * recubrimiento - o, 0), Math.max(g.h - 2 * recubrimiento - o, 0)];
  const ganchos = 2 * Math.max(10 * o, 70);
  const de = ramasDe(c) - 2;
  const dentro = Math.floor(de / 2) * (2 * (bw / 3 + hw) + ganchos) + (de % 2) * (hw + ganchos);
  return (2 * (bw + hw) + ganchos + dentro) / 1000;
}

/**
 * El despiece de un pórtico con el armado de cada vano (por su clave; el que falta o no vale, sin
 * barras). `armados` es el dato del proyecto, en el sentido de cada viga.
 */
export function despiecePortico(p: Portico, armados: Readonly<Record<string, Partial<ArmadoVanoViga> | null | undefined>>, datos: DatosDespiece): DespiecePortico {
  const rec = datos.recubrimiento / 1000;
  const avisos: string[] = [];
  const vs = p.vanos.map((v) => ({ v, a: orientar(armados[v.clave], v.invertida), L: v.hasta - v.desde }));
  type Vano = (typeof vs)[number];

  const lb = (v: VanoPortico, diametro: number, cara: "inferior" | "superior"): number => {
    const t = datos.anclajes[v.clave]?.[diametro];
    // Sin el dato (un vano sin sección que armar): 40 Ø y 60 Ø, lo de un HA-25 con B500
    return t ? t[cara === "inferior" ? 0 : 1] : ((cara === "inferior" ? 40 : 60) * diametro) / 1000;
  };
  /** El decalaje de la ley de momentos de un vano, m. */
  const decalaje = (v: VanoPortico, diametro: number): number => {
    const d = Math.max((v.geometria?.h ?? 300) - datos.recubrimiento - 8 - diametro / 2, 0) / 1000;
    return (0.9 * d * datos.cotTheta) / 2;
  };
  /** La punta de una barra del vano `x` que entra en el apoyo de su lado (0, el de la izquierda). */
  const anclar = (x: Vano, diametro: number, cara: "inferior" | "superior", lado: 0 | 1): { x: number; patilla: number } => {
    const v = x.v;
    const [borde, sentido] = lado ? [v.hasta, 1] : [v.desde, -1];
    const ap = v.apoyos[lado];
    // Un extremo libre: hasta el recubrimiento de la punta
    if (ap === null) return { x: borde - sentido * rec, patilla: 0 };
    const L = lb(v, diametro, cara);
    // Con otro vano al otro lado del apoyo, recta: lo atraviesa
    if (p.vanos.some((w) => w !== v && w.apoyos[1 - lado] === ap)) return { x: borde + sentido * alModulo(L), patilla: 0 };
    const apoyo = p.apoyos[ap]!;
    const disponible = Math.max((lado ? apoyo.caras[1] - borde : borde - apoyo.caras[0]) - rec, 0);
    if (L <= disponible + 1e-9) return { x: borde + sentido * Math.min(alModulo(L), disponible), patilla: 0 };
    const patilla = alModulo(Math.max(ANCLAJE_CON_PATILLA * L - disponible, (PATILLA_MINIMA * diametro) / 1000));
    const cabe = ((v.geometria?.h ?? Infinity) - 2 * datos.recubrimiento) / 1000;
    if (patilla > cabe + 1e-9) avisos.push(`El anclaje de las barras Ø${diametro} de ${v.clave} no cabe en ${apoyo.objeto}: pide una patilla de ${Math.round(patilla * 100)} cm.`);
    return { x: borde + sentido * disponible, patilla };
  };

  type Suelta = Omit<BarraDespiece, "marca" | "largo" | "ejes">;
  const sueltas: Suelta[] = [];

  // ─── La inferior y la de piel: una por vano ──────────────────────────────────────────────────
  for (const x of vs) {
    for (const [cara, b, n] of [["inferior", x.a.inferior, x.a.inferior?.n], ["piel", x.a.piel, 2 * (x.a.piel?.n ?? 0)]] as const) {
      if (!b || !n) continue;
      const [i, f] = [anclar(x, b.diametro, cara === "piel" ? "superior" : "inferior", 0), anclar(x, b.diametro, cara === "piel" ? "superior" : "inferior", 1)];
      sueltas.push({ cara, papel: cara === "piel" ? "piel" : "vano", n, diametro: b.diametro, x: [i.x, f.x], patillas: [i.patilla, f.patilla], origen: [{ clave: x.v.clave, ruta: cara }] });
    }
  }

  // ─── La superior: lo que pasa de la corrida y lo que cada zona de apoyo tiene de más ─────────
  interface Extra {
    x: Vano;
    lado: 0 | 1;
    n: number;
    diametro: number;
    ruta: string;
  }
  const extras: Extra[] = [];
  /** La corrida de cada vano llega al apoyo de ese lado (no hay allí una zona de otro diámetro). */
  const pasa = vs.map((x): [boolean, boolean] => {
    const c = x.a.superior;
    return ([0, 1] as const).map((lado) => {
      const z = x.a.zonas[lado];
      if (!z) return !!c;
      const igual = !!c && c.diametro === z.barras.diametro;
      const n = igual ? z.barras.n - c!.n : z.barras.n;
      if (n > 0) extras.push({ x, lado, n, diametro: z.barras.diametro, ruta: z.ruta });
      return igual;
    }) as [boolean, boolean];
  });

  /** Medio solape (a 5 cm) de unas barras de la cara superior con este anclaje, m. */
  const medioSolape = (anclaje: number) => alModulo((SOLAPE * anclaje) / 2);
  /**
   * Los apoyos sobre los que la armadura superior se empalma: hay barras a los dos lados y ninguna
   * pasa de un vano a otro (ni la corrida, que cambia o no llega, ni una de apoyo común a los dos:
   * la de un lado es de otro diámetro). Allí toda la tracción pasa de las de un lado a las del otro,
   * así que se cruzan al menos la longitud de solape, centrada en el eje: por apoyo, su eje y el
   * medio solape, con el mayor anclaje de las que acaban en él. Donde algo pasa, lo que un lado tiene
   * de más sólo se corta: basta su anclaje más allá de la cara.
   */
  const empalmes = new Map<number, { eje: number; medio: number }>();
  for (let j = 0; j + 1 < vs.length; j++) {
    const [x, y] = [vs[j]!, vs[j + 1]!];
    const ap = x.v.apoyos[1];
    if (ap === null || y.v.apoyos[0] !== ap) continue;
    const [cx, cy] = [pasa[j]![1] ? x.a.superior : undefined, pasa[j + 1]![0] ? y.a.superior : undefined];
    const [ex, ey] = [extras.find((e) => e.x === x && e.lado === 1), extras.find((e) => e.x === y && e.lado === 0)];
    const pasaLaCorrida = !!cx && !!cy && cx.n === cy.n && cx.diametro === cy.diametro;
    const pasaLaDeApoyo = !!ex && !!ey && ex.diametro === ey.diametro;
    const anclajes = (v: VanoPortico, ds: (number | undefined)[]) => ds.filter((d): d is number => d !== undefined).map((d) => lb(v, d, "superior"));
    const [lx, ly] = [anclajes(x.v, [cx?.diametro, ex?.diametro]), anclajes(y.v, [cy?.diametro, ey?.diametro])];
    if (pasaLaCorrida || pasaLaDeApoyo || !lx.length || !ly.length) continue;
    empalmes.set(ap, { eje: p.apoyos[ap]!.eje, medio: medioSolape(Math.max(...lx, ...ly)) });
  }
  /** La punta de una barra superior del vano `x` en el apoyo de su lado: su anclaje y, si allí se empalma, el solape. */
  const anclarSuperior = (x: Vano, diametro: number, lado: 0 | 1): { x: number; patilla: number } => {
    const a = anclar(x, diametro, "superior", lado);
    const ap = x.v.apoyos[lado];
    const e = ap === null ? undefined : empalmes.get(ap);
    return e ? { x: lado ? Math.max(a.x, e.eje + e.medio) : Math.min(a.x, e.eje - e.medio), patilla: a.patilla } : a;
  };
  /** Las corridas, cada una de una pieza con los vanos por los que pasa: se parten después (12 m). */
  const corridas: { barra: Suelta; vanos: number[] }[] = [];
  let abierta: { barra: Suelta; i: number; vanos: number[] } | null = null;
  const cerrar = () => {
    if (!abierta) return;
    const f = anclarSuperior(vs[abierta.i]!, abierta.barra.diametro, 1);
    abierta.barra.x[1] = f.x;
    abierta.barra.patillas[1] = f.patilla;
    corridas.push({ barra: abierta.barra, vanos: abierta.vanos });
    abierta = null;
  };
  vs.forEach((x, i) => {
    const c = x.a.superior;
    if (!c) return cerrar();
    const origen: OrigenBarra = { clave: x.v.clave, ruta: "superior" };
    const anclajeC = alModulo(lb(x.v, c.diametro, "superior"));
    const ab: { barra: Suelta; i: number; vanos: number[] } | null = abierta;
    // Sigue la del vano anterior, sobre el apoyo, si es la misma (lo que pase de 12 m se parte después, en el centro de un vano)
    const sigue = !!ab && pasa[i]![0] && ab.i === i - 1 && x.v.apoyos[0] !== null && vs[i - 1]!.v.apoyos[1] === x.v.apoyos[0] && ab.barra.n === c.n && ab.barra.diametro === c.diametro;
    if (sigue) {
      ab!.barra.origen.push(origen);
      ab!.i = i;
      ab!.vanos.push(i);
    } else {
      cerrar();
      const ini = pasa[i]![0] ? anclarSuperior(x, c.diametro, 0) : { x: Math.max(x.v.desde + x.L / 4 - anclajeC, x.v.desde), patilla: 0 };
      abierta = { barra: { cara: "superior", papel: "corrida", n: c.n, diametro: c.diametro, x: [ini.x, x.v.hasta], patillas: [ini.patilla, 0], origen: [origen] }, i, vanos: [i] };
    }
    if (!pasa[i]![1]) {
      // Acaba en el centro: una longitud de anclaje más allá de donde empieza la zona del apoyo
      const b = abierta!.barra;
      b.x[1] = Math.min(x.v.hasta - x.L / 4 + anclajeC, x.v.hasta);
      corridas.push({ barra: b, vanos: abierta!.vanos });
      abierta = null;
    }
  });
  cerrar();

  // Una corrida de más de 12 m se empalma en el centro de un vano entre dos apoyos: cada pieza, hasta
  // el centro más lejano al que llega sin pasar de una barra comercial
  for (const c of corridas) {
    const b = c.barra;
    const pieza = (x0: number, x1: number, patillas: [number, number]): Suelta => {
      const suyos = b.origen.filter((o) => {
        const v = p.vanos.find((y) => y.clave === o.clave);
        return !v || (v.hasta > x0 + 1e-9 && v.desde < x1 - 1e-9);
      });
      return { ...b, x: [x0, x1], patillas, origen: suyos.length ? suyos : b.origen };
    };
    const centros = c.vanos
      .map((j) => vs[j]!)
      .filter((x) => x.v.apoyos[0] !== null && x.v.apoyos[1] !== null)
      .map((x) => ({ m: (x.v.desde + x.v.hasta) / 2, medio: medioSolape(lb(x.v, b.diametro, "superior")) }))
      .filter((y) => y.m - y.medio > b.x[0] + 1e-9 && y.m + y.medio < b.x[1] - 1e-9);
    let [ini, patilla] = [b.x[0], b.patillas[0]];
    while (b.x[1] + b.patillas[1] - ini + patilla > BARRA_MAXIMA + 1e-9) {
      const quedan = centros.filter((y) => y.m - y.medio > ini + 1e-9);
      if (!quedan.length) break;
      const caben = quedan.filter((y) => y.m + y.medio - ini + patilla <= BARRA_MAXIMA + 1e-9);
      // Si ni el primero cabe (un vano de más de 12 m), hasta él: la barra se avisa
      const corte = caben.length ? caben[caben.length - 1]! : quedan[0]!;
      sueltas.push(pieza(ini, corte.m + corte.medio, [patilla, 0]));
      [ini, patilla] = [corte.m - corte.medio, 0];
    }
    sueltas.push(pieza(ini, b.x[1], [patilla, b.patillas[1]]));
  }

  // Hasta dónde llega hacia el centro del vano la barra de la zona de un apoyo
  const haciaElVano = (e: Extra): number => {
    const v = e.x.v;
    const de = alModulo(decalaje(v, e.diametro) + lb(v, e.diametro, "superior"));
    return e.lado ? Math.max(v.hasta - e.x.L / 4 - de, v.desde) : Math.min(v.desde + e.x.L / 4 + de, v.hasta);
  };
  const deApoyo = (e: Extra, n: number): Suelta => {
    const a = anclarSuperior(e.x, e.diametro, e.lado);
    const m = haciaElVano(e);
    return { cara: "superior", papel: "apoyo", n, diametro: e.diametro, x: e.lado ? [m, a.x] : [a.x, m], patillas: e.lado ? [0, a.patilla] : [a.patilla, 0], origen: [{ clave: e.x.v.clave, ruta: e.ruta }] };
  };
  const hechas = new Set<Extra>();
  const deApoyos: Suelta[] = [];
  for (const izq of extras) {
    if (hechas.has(izq) || izq.lado !== 1) continue;
    const ap = izq.x.v.apoyos[1];
    const der = ap === null ? undefined : extras.find((e) => e.lado === 0 && e.x.v.apoyos[0] === ap && !hechas.has(e));
    if (!der || der.diametro !== izq.diametro) continue;
    // Lo común a los dos lados pasa sobre el apoyo; lo que uno tiene de más, anclado más allá de su cara
    hechas.add(izq).add(der);
    const comun = Math.min(izq.n, der.n);
    deApoyos.push({ cara: "superior", papel: "apoyo", n: comun, diametro: izq.diametro, x: [haciaElVano(izq), haciaElVano(der)], patillas: [0, 0], origen: [{ clave: izq.x.v.clave, ruta: izq.ruta }, { clave: der.x.v.clave, ruta: der.ruta }] });
    if (izq.n > comun) deApoyos.push(deApoyo(izq, izq.n - comun));
    if (der.n > comun) deApoyos.push(deApoyo(der, der.n - comun));
  }
  for (const e of extras) if (!hechas.has(e)) deApoyos.push(deApoyo(e, e.n));
  // Dos iguales de zonas distintas que se pisan (las de los dos apoyos de un vano corto), una: cada
  // zona sigue teniendo las suyas. Las de una misma zona (lo común y lo de más) hacen falta las dos
  deApoyos.sort((a, b) => a.x[0] - b.x[0] || b.x[1] - a.x[1]);
  const unidas: Suelta[] = [];
  const comparten = (a: Suelta, b: Suelta) => a.origen.some((o) => b.origen.some((y) => y.clave === o.clave && y.ruta === o.ruta));
  for (const b of deApoyos) {
    const a = unidas.find((y) => y.n === b.n && y.diametro === b.diametro && !comparten(y, b) && y.patillas[1] === 0 && b.patillas[0] === 0 && b.x[0] <= y.x[1] + UNION_BARRAS && Math.max(y.x[1], b.x[1]) - y.x[0] + y.patillas[0] + b.patillas[1] <= BARRA_MAXIMA);
    if (a) {
      if (b.x[1] >= a.x[1]) [a.x[1], a.patillas[1]] = [b.x[1], b.patillas[1]];
      for (const o of b.origen) if (!a.origen.some((y) => y.clave === o.clave && y.ruta === o.ruta)) a.origen.push(o);
    } else unidas.push(b);
  }
  sueltas.push(...unidas);

  // ─── Las marcas: la inferior, la superior (la corrida y las de los apoyos) y la de piel, de izquierda a derecha ─
  const orden: Record<BarraDespiece["papel"], number> = { vano: 0, corrida: 1, apoyo: 2, piel: 3 };
  sueltas.sort((a, b) => orden[a.papel] - orden[b.papel] || a.x[0] - b.x[0] || b.x[1] - a.x[1]);
  const barras = sueltas.map((b, i): BarraDespiece => ({ ...b, marca: i + 1, largo: cm(b.x[1] - b.x[0] + b.patillas[0] + b.patillas[1]), ejes: p.apoyos.map((a) => a.eje).filter((e) => e > b.x[0] + 1e-9 && e < b.x[1] - 1e-9) }));
  for (const b of barras) if (b.largo > BARRA_MAXIMA + 1e-9) avisos.push(`La barra ${b.marca} (${b.n}Ø${b.diametro}) mide ${b.largo.toFixed(2).replace(".", ",")} m: más de ${BARRA_MAXIMA} m, se solapa en obra.`);

  // ─── Los cercos: por tramos del mismo cerco ──────────────────────────────────────────────────
  const cercos: CercosDespiece[] = [];
  for (const x of vs) {
    const a = armados[x.v.clave];
    if (!a || !(x.L > 0)) continue;
    const al = alzadoVano(x.L, a);
    let ultimo: CercosDespiece | null = null;
    // En el sentido del pórtico: de una viga invertida, sus zonas al revés
    for (const z of x.v.invertida ? [...al.zonas].reverse() : al.zonas) {
      if (!z.cercos || !cercosValidos(z.cercos) || !z.posiciones.length) {
        ultimo = null;
        continue;
      }
      const xs = z.posiciones.map((s) => (x.v.invertida ? x.v.hasta - s : x.v.desde + s));
      const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
      const ruta = z.cercosPropios ? (z.zona === "inicio" ? "cercosInicio" : "cercosFin") : "cercos";
      const c = z.cercos;
      if (ultimo && ultimo.cercos.diametro === c.diametro && ultimo.cercos.separacion === c.separacion && ramasDe(ultimo.cercos) === ramasDe(c)) {
        ultimo.x = [Math.min(ultimo.x[0], x0), Math.max(ultimo.x[1], x1)];
        ultimo.n += xs.length;
        if (!ultimo.origen.some((o) => o.ruta === ruta)) ultimo.origen.push({ clave: x.v.clave, ruta });
      } else {
        ultimo = { x: [x0, x1], n: xs.length, cercos: c, largo: x.v.geometria ? cm(desarrolloCerco(x.v.geometria, c, datos.recubrimiento)) : 0, origen: [{ clave: x.v.clave, ruta }] };
        cercos.push(ultimo);
      }
    }
  }

  // ─── La medición ─────────────────────────────────────────────────────────────────────────────
  const NOMBRE: Record<BarraDespiece["papel"], string> = { vano: "inferior", corrida: "superior corrida", apoyo: "superior de apoyo", piel: "de piel" };
  const medicion: FilaMedicion[] = [
    ...barras.map((b) => ({ marca: String(b.marca), que: NOMBRE[b.papel], n: b.n, diametro: b.diametro, largo: b.largo, total: cm(b.n * b.largo), kg: b.n * b.largo * pesoBarra(b.diametro) })),
    ...cercos.map((c, i) => ({ marca: `c${i + 1}`, que: `cercos cada ${c.cercos.separacion} mm${ramasDe(c.cercos) !== 2 ? `, ${ramasDe(c.cercos)} ramas` : ""}`, n: c.n, diametro: c.cercos.diametro, largo: c.largo, total: cm(c.n * c.largo), kg: c.n * c.largo * pesoBarra(c.cercos.diametro) })),
  ];
  const por = new Map<number, number>();
  for (const f of medicion) por.set(f.diametro, (por.get(f.diametro) ?? 0) + f.kg);
  const porDiametro = [...por].sort((a, b) => a[0] - b[0]).map(([diametro, kg]) => ({ diametro, kg }));
  return { barras, cercos, medicion, acero: { porDiametro, total: porDiametro.reduce((t, x) => t + x.kg, 0) }, avisos: [...new Set(avisos)] };
}

/**
 * La fila en que se dibuja cada barra de una cara, para que ninguna pise a otra (ni a su rótulo:
 * cada una ocupa al menos `ancho` m, centrado en ella): la 0, la más cercana a la viga. Las corridas,
 * primero; después, de izquierda a derecha.
 */
export function filasBarras(barras: readonly BarraDespiece[], ancho = 0): Map<number, number> {
  const filas = new Map<number, number>();
  const ocupa = (b: BarraDespiece): [number, number] => {
    const m = (b.x[0] + b.x[1]) / 2;
    const medio = Math.max((b.x[1] - b.x[0]) / 2, ancho / 2);
    return [m - medio, m + medio];
  };
  for (const cara of ["inferior", "superior", "piel"] as const) {
    const hechas: [number, number][][] = [];
    const suyas = barras.filter((b) => b.cara === cara).sort((a, b) => Number(b.papel === "corrida") - Number(a.papel === "corrida") || a.x[0] - b.x[0] || a.marca - b.marca);
    for (const b of suyas) {
      const o = ocupa(b);
      let f = hechas.findIndex((fila) => fila.every((y) => o[1] <= y[0] + 1e-9 || o[0] >= y[1] - 1e-9));
      if (f < 0) f = hechas.push([]) - 1;
      hechas[f]!.push(o);
      filas.set(b.marca, f);
    }
  }
  return filas;
}
