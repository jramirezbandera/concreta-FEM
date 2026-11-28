/**
 * VC4 (`docs/fem3d/coherencia-vistas.md`, CV-5): los pilares y los muros de Resultados en el alzado,
 * con lo mismo que el 3D y la planta.
 *
 * - Pilares (`vistaAlzadoPilares`): cada tramo de un pilar del plano, de su base a su cabeza y con el
 *   ancho que se ve de su huella, del color de la banda de su N o su ν. Los valores, las bandas, los
 *   colores y la leyenda son los de `pilares3D` (el 3D de Pilares y el cuadro, bit a bit), con todos
 *   los tramos del edificio: el alzado y el 3D se leen igual. Cada tramo, rotulado con su valor.
 * - Muros (`vistaAlzadoMuros`): el mapa de un campo en las láminas de los muros paralelos al plano y
 *   a menos de su profundidad, en (u, z). Los valores, de `valoresCampo` o `envolventeCampo` (los del
 *   3D de Losas con «muros»); la combinación, la del mayor |valor| en lo que se ve (la regla de una
 *   planta), los límites, la paleta y lo de fuera de la escala, como `vistaCampo`.
 *
 * Las dos van sobre el alzado del modelo en gris (`atenuado`). Puro: sin IO.
 */
import type { ConjuntoCombinaciones } from "../agente/combinaciones.ts";
import { PROFUNDIDAD_ALZADO, SENO_PARALELO, vistaAlzado, type OpcionesAlzado, type PlanoAlzado } from "../agente/render/alzado.ts";
import { cajaDe, numeroFijo, rayado, rotulo, type EntradaLeyenda, type Escena, type ExtremoRotulado, type Primitiva } from "../agente/render/escena.ts";
import { AVISO_PICOS, bandas, CAMPO_NULO, COLOR_NULO, coloresBandas, FRACCION_PICOS, isolineas, LIMITES_NULO, limitesMapa, rangoSinPicos, triangulosCuadrilatero, type EscalaMapa, type LimitesMapa, type Triangulo } from "../agente/render/isovalores.ts";
import { huellaSeccion, type DatosVista } from "../agente/render/modelo.ts";
import { envolventeCampo, extremosMapa, NOMBRES_CAMPO, UNIDADES_CAMPO, valoresCampo, type Campo, type Envolvente, type ResultadosRender } from "../agente/render/resultados.ts";
import { cotasPlantas } from "../compilador/cotas.ts";
import type { ModeloFisico, Vec2 } from "../compilador/fisico.ts";
import { pilares3D, SIN_BANDA, type MagnitudPilares } from "./pilares3d.ts";

const rect = (u0: number, u1: number, z0: number, z1: number): Vec2[] => [
  [u0, z0],
  [u1, z0],
  [u1, z1],
  [u0, z1],
];

/** Los ejes del plano: u a lo largo, w normal. */
function ejesPlano(plano: PlanoAlzado) {
  const L = Math.hypot(plano.hasta[0] - plano.desde[0], plano.hasta[1] - plano.desde[1]);
  const dir: Vec2 = L > 0 ? [(plano.hasta[0] - plano.desde[0]) / L, (plano.hasta[1] - plano.desde[1]) / L] : [1, 0];
  const nor: Vec2 = [-dir[1], dir[0]];
  const uu = (q: readonly number[]) => (q[0]! - plano.desde[0]) * dir[0] + (q[1]! - plano.desde[1]) * dir[1];
  const ww = (q: readonly number[]) => (q[0]! - plano.desde[0]) * nor[0] + (q[1]! - plano.desde[1]) * nor[1];
  return { dir, nor, uu, ww, prof: plano.profundidad ?? PROFUNDIDAD_ALZADO };
}

/**
 * El ancho que el plano ve (en u) de la huella del tramo de un pilar que llega a `cabeza`, o null si
 * el pilar no está a menos de la profundidad del plano.
 */
export function anchoPilarEnPlano(f: ModeloFisico, plano: PlanoAlzado, id: string, cabeza: string): [number, number] | null {
  const { uu, ww, prof } = ejesPlano(plano);
  const p = f.pilares?.find((x) => x.id === id);
  if (!p || Math.abs(ww([p.x, p.y])) > prof) return null;
  const sid = p.tramos?.find((t) => t.planta === cabeza)?.seccion ?? p.seccion;
  const h = huellaSeccion(p, f.secciones?.find((x) => x.id === sid));
  if (!h) return null;
  if ("radio" in h) return [uu(h.centro) - h.radio, uu(h.centro) + h.radio];
  const us = h.anillo.map(uu);
  return [Math.min(...us), Math.max(...us)];
}

/** Lo que el alzado añade a su base (en gris): sus primitivas, encima; su leyenda, delante. */
function sobreBase(base: Escena, o: { cabecera: string; primitivas: Primitiva[]; leyenda: EntradaLeyenda[]; tituloLeyenda: string; notas: string[]; extremos: ExtremoRotulado[]; puntos: Vec2[]; mapa?: Escena["mapa"] }): Escena {
  const c = base.caja;
  return {
    ...base,
    cabecera: [...base.cabecera, o.cabecera],
    primitivas: [...base.primitivas, ...o.primitivas],
    leyenda: [...o.leyenda, ...base.leyenda],
    tituloLeyenda: o.tituloLeyenda,
    notas: [...o.notas, ...base.notas],
    extremos: o.extremos,
    caja: o.puntos.length ? cajaDe([...o.puntos, [c[0], c[1]], [c[2], c[3]]]) : c,
    ...(o.mapa ? { mapa: o.mapa } : {}),
  };
}

// ─── Pilares ────────────────────────────────────────────────────────────────────────────────────

/** Los tramos de los pilares del plano por colores: los de `pilares3D` de todo el edificio. */
export function vistaAlzadoPilares(r: ResultadosRender, plano: PlanoAlzado, magnitud: MagnitudPilares, conjunto: ConjuntoCombinaciones, d: DatosVista, o: Pick<OpcionesAlzado, "modo" | "analitico"> = {}): Escena {
  const f = r.q.fisico;
  const base = vistaAlzado(f, plano, d, { ...o, atenuado: true });
  const todo = pilares3D(r, [0, 0, 0], magnitud, conjunto, null);
  const cotas = cotasPlantas(f.plantas);
  const indice = new Map(f.plantas.map((p, i) => [p.id, i]));
  const P: Primitiva[] = [];
  const textos: Primitiva[] = [];
  const puntos: Vec2[] = [];
  const vistos: { t: (typeof todo.tramos)[number]; donde: Vec2 }[] = [];
  todo.tramos.forEach((t, i) => {
    const ancho = anchoPilarEnPlano(f, plano, t.pilar, t.planta);
    const k = indice.get(t.planta);
    const [z1, z0] = k === undefined ? [null, null] : [cotas[k], cotas[k + 1]];
    if (!ancho || z1 === null || z1 === undefined || z0 === null || z0 === undefined) return;
    const b = todo.banda[i]!;
    const a = rect(ancho[0], ancho[1], z0, z1);
    P.push({ tipo: "poligono", anillos: [a], estilo: "contorno", relleno: b === SIN_BANDA ? "#9ca3af" : todo.colores[b]!, objeto: t.pilar });
    puntos.push(...a);
    const donde: Vec2 = [(ancho[0] + ancho[1]) / 2, (z0 + z1) / 2];
    const v = t.valor === null ? "—" : magnitud === "N" ? numeroFijo(t.valor, 0) : numeroFijo(t.valor, 2);
    textos.push({ tipo: "texto", p: donde, texto: `${t.pilar} ${v}`, tamano: 11, ancla: "medio", dy: 4, fondo: true, prioridad: 50, objeto: t.pilar });
    vistos.push({ t, donde });
  });
  // Los extremos de lo que se ve: la mayor compresión o la mayor ν, y lo que pasa el límite
  const extremos: ExtremoRotulado[] = [];
  const unidad = todo.unidad;
  const conValor = vistos.filter((x) => x.t.valor !== null && x.t.comb !== null);
  if (conValor.length) {
    if (magnitud === "N") {
      const m = conValor.reduce((x, y) => (y.t.valor! < x.t.valor! ? y : x));
      if (m.t.valor! < 0) extremos.push({ que: `mayor compresión (${m.t.pilar}, tramo bajo ${m.t.planta})`, valor: m.t.valor!, unidad, objeto: m.t.pilar, punto: m.donde, comb: m.t.comb! });
    } else {
      const m = conValor.reduce((x, y) => (y.t.valor! > x.t.valor! ? y : x));
      extremos.push({ que: `mayor ν (${m.t.pilar}, tramo bajo ${m.t.planta})`, valor: m.t.valor!, unidad, objeto: m.t.pilar, punto: m.donde, comb: m.t.comb! });
      for (const x of conValor) if (x !== m && todo.limite !== undefined && x.t.valor! > todo.limite) extremos.push({ que: `pasa el límite (${x.t.pilar}, tramo bajo ${x.t.planta})`, valor: x.t.valor!, unidad, objeto: x.t.pilar, punto: x.donde, comb: x.t.comb! });
    }
  }
  return sobreBase(base, {
    cabecera: magnitud === "N" ? "Pilares: la mayor compresión de cada tramo (kN)" : "Pilares: el axil reducido ν de cada tramo",
    primitivas: [...P, ...textos],
    leyenda: todo.leyenda,
    tituloLeyenda: magnitud === "N" ? "N · kN" : "ν",
    notas: [
      "Cada tramo del plano, de su base a su cabeza, con la escala de todo el edificio (la del 3D).",
      ...todo.notas.filter((n) => !n.startsWith("Todos los tramos")),
      ...(!vistos.length ? ["El plano no ve ningún pilar."] : []),
    ],
    extremos,
    puntos,
  });
}

// ─── Muros ──────────────────────────────────────────────────────────────────────────────────────

export interface OpcionesMurosAlzado extends Pick<OpcionesAlzado, "modo" | "analitico"> {
  escala?: EscalaMapa;
  envolvente?: Envolvente;
}

/** El mapa de un campo en los muros del plano. */
export function vistaAlzadoMuros(r: ResultadosRender, plano: PlanoAlzado, campo: Campo, conjunto: ConjuntoCombinaciones, d: DatosVista, o: OpcionesMurosAlzado = {}): Escena {
  const f = r.q.fisico;
  const c = r.c;
  const base = vistaAlzado(f, plano, d, { ...(o.modo ? { modo: o.modo } : {}), ...(o.analitico !== undefined ? { analitico: o.analitico } : {}), atenuado: true });
  const { nor, uu, ww, prof } = ejesPlano(plano);
  const u = UNIDADES_CAMPO[campo];
  const notas: string[] = [];
  const cabeceraVista = `Mapa de ${NOMBRES_CAMPO[campo]} en los muros del plano (${u})`;
  if (campo === "sigma") {
    notas.push("σ del terreno sólo la tienen las losas de cimentación: en el alzado no hay mapa (en la planta de cimentación, sí).");
    return sobreBase(base, { cabecera: cabeceraVista, primitivas: [], leyenda: [], tituloLeyenda: `${NOMBRES_CAMPO[campo]} · ${u}`, notas, extremos: [], puntos: [] });
  }
  // Las láminas de muro paralelas al plano y a menos de su profundidad, por planta
  const enPlano = (l: number) => {
    const lam = c.modelo.laminas![l]!;
    if (lam.eje1 && Math.abs(lam.eje1[0] * nor[0] + lam.eje1[1] * nor[1]) >= SENO_PARALELO) return false;
    return lam.nudos.every((n) => Math.abs(ww([c.modelo.nudos[n]!.x, c.modelo.nudos[n]!.y])) <= prof);
  };
  const plantas = f.plantas.map((p) => p.id).filter((p) => r.laminas(p, "muros").laminas.some(enPlano));
  const env = o.envolvente && conjunto.factores.length > 1 ? o.envolvente : null;
  const filtra = (x: { laminas: number[]; v: Float64Array; comb?: Int32Array }) => {
    const sel: number[] = [];
    x.laminas.forEach((l, i) => {
      if (enPlano(l)) sel.push(i);
    });
    return sel.map((i) => ({ l: x.laminas[i]!, v: [0, 1, 2, 3].map((a) => x.v[4 * i + a]!), comb: x.comb ? [0, 1, 2, 3].map((a) => x.comb![4 * i + a]!) : null }));
  };
  type Lam = ReturnType<typeof filtra>[number];
  let lams: Lam[] = [];
  let k0 = 0;
  if (env) lams = plantas.flatMap((p) => filtra(envolventeCampo(r, p, campo, conjunto, env, "muros")));
  else {
    let m0 = -1;
    conjunto.factores.forEach((fa, k) => {
      const x = plantas.flatMap((p) => filtra(valoresCampo(r, p, campo, fa, "muros")));
      let m = 0;
      for (const y of x) for (const z of y.v) if (Math.abs(z) > m) m = Math.abs(z);
      if (m > m0) [m0, lams, k0] = [m, x, k];
    });
  }
  const comb = env ? "" : (conjunto.nombres[k0] ?? "");
  const P: Primitiva[] = [];
  const leyenda: EntradaLeyenda[] = [];
  const extremos: ExtremoRotulado[] = [];
  const puntos: Vec2[] = [];
  const tris: Triangulo[] = [];
  const valoresNudos: number[] = [];
  const pesos: number[] = [];
  let [vmin, vmax] = [Infinity, -Infinity];
  let emin: { p: Vec2; o: string; comb: string } | null = null;
  let emax: { p: Vec2; o: string; comb: string } | null = null;
  let sinMapa = 0;
  for (const x of lams) {
    const pts = c.modelo.laminas![x.l]!.nudos.map((n): Vec2 => [uu([c.modelo.nudos[n]!.x, c.modelo.nudos[n]!.y]), c.modelo.nudos[n]!.z]) as [Vec2, Vec2, Vec2, Vec2];
    puntos.push(...pts);
    if (x.v.some(Number.isNaN)) {
      P.push({ tipo: "poligono", anillos: [pts], estilo: "sin-mapa" });
      sinMapa++;
      continue;
    }
    const muro = c.mapeo.laminas![x.l]!.muro ?? "";
    x.v.forEach((y, a) => {
      const cb = x.comb ? (conjunto.nombres[x.comb[a]!] ?? "") : comb;
      if (y < vmin) [vmin, emin] = [y, { p: pts[a]!, o: muro, comb: cb }];
      if (y > vmax) [vmax, emax] = [y, { p: pts[a]!, o: muro, comb: cb }];
    });
    tris.push(...triangulosCuadrilatero(pts, x.v));
    const a = Math.abs((pts[2][0] - pts[0][0]) * (pts[3][1] - pts[1][1]) - (pts[3][0] - pts[1][0]) * (pts[2][1] - pts[0][1])) / 8;
    for (const y of x.v) {
      valoresNudos.push(y);
      pesos.push(a);
    }
  }
  let mapa: Escena["mapa"];
  const nulo = tris.length > 0 && Math.max(Math.abs(vmin), Math.abs(vmax)) < CAMPO_NULO;
  if (nulo) {
    for (const b of bandas(tris, LIMITES_NULO)) P.push({ tipo: "region", anillos: b.anillos, estilo: "isobanda", relleno: COLOR_NULO, banda: 0 });
    leyenda.push({ relleno: COLOR_NULO, texto: `0: campo nulo (|valor| < ${CAMPO_NULO})` });
    notas.push(`El campo es nulo en los muros del plano: su mayor |valor| es ${Math.max(Math.abs(vmin), Math.abs(vmax)).toExponential(1)} ${u}, ruido de redondeo.`);
    mapa = { limites: [...LIMITES_NULO], paso: 2 * CAMPO_NULO, fueraAbajo: false, fueraArriba: false, picos: false, minimo: vmin, maximo: vmax, nulo: true, ...(env ? { envolvente: env } : { combinacion: comb }) };
  } else if (tris.length) {
    const robusto = rangoSinPicos(valoresNudos, pesos);
    let lm = limitesMapa(vmin, vmax, o.escala ?? {}, robusto);
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
      if ((fueraAbajo && b.banda === 0) || (fueraArriba && b.banda === nb - 1)) for (const [p, q] of rayado(b.anillos, [Math.SQRT1_2, Math.SQRT1_2], pasoRayado)) P.push({ tipo: "linea", puntos: [p, q], estilo: "fuera-escala" });
    }
    let cero = false;
    for (const iso of isolineas(tris, L)) {
      const estilo = iso.valor === 0 ? "isolinea-cero" : "isolinea";
      cero ||= iso.valor === 0;
      for (const ps of iso.lineas) P.push({ tipo: "linea", puntos: ps, estilo, rotulo: rotulo(iso.valor, 4) });
    }
    for (let b = nb - 1; b >= 0; b--) {
      const texto = fueraArriba && b === nb - 1 ? `más de ${rotulo(L[b]!, 4)} (fuera de la escala, rayado)` : fueraAbajo && b === 0 ? `menos de ${rotulo(L[1]!, 4)} (fuera de la escala, rayado)` : `${rotulo(L[b]!, 4)} a ${rotulo(L[b + 1]!, 4)}`;
      leyenda.push({ relleno: colores[b]!, texto });
    }
    leyenda.push({ estilo: "isolinea", texto: "Isolínea en cada límite, con su valor" });
    if (cero) leyenda.push({ estilo: "isolinea-cero", texto: "Isolínea de valor 0" });
    const dentro = L.slice(fueraAbajo ? 1 : 0, fueraArriba ? nb : nb + 1);
    if (fueraAbajo || fueraArriba) notas.push(`Escala de ${rotulo(dentro[0]!, 4)} a ${rotulo(dentro[dentro.length - 1]!, 4)} ${u}${o.escala?.modo === "sin-picos" ? `, sin picos (sin el ${rotulo(FRACCION_PICOS * 100)} % del área por cada lado)` : ""}: lo de fuera, rayado. Los extremos rotulados son los reales.`);
    const picos = !!robusto && !(fueraAbajo || fueraArriba) && Math.max(Math.abs(vmin), Math.abs(vmax)) > AVISO_PICOS * Math.max(Math.abs(robusto[0]), Math.abs(robusto[1]));
    if (picos) notas.push(`La escala la marcan picos en menos del ${rotulo(2 * FRACCION_PICOS * 100)} % del área; sin ellos, el campo va de ${rotulo(robusto![0])} a ${rotulo(robusto![1])} ${u} (escala «sin picos»).`);
    mapa = { limites: dentro, paso: lm.paso, fueraAbajo, fueraArriba, picos, minimo: vmin, maximo: vmax, ...(robusto ? { sinPicos: robusto } : {}), ...(env ? { envolvente: env } : { combinacion: comb }) };
    for (const ex of extremosMapa(campo, vmin, vmax, env)) {
      const [x, e] = (ex.cual === "max" ? [vmax, emax] : [vmin, emin]) as [number, { p: Vec2; o: string; comb: string } | null];
      if (!e) continue;
      const [estilo, dy] = ex.cual === "max" ? (["extremo-maximo", -10] as const) : (["extremo-minimo", 20] as const);
      P.push({ tipo: "marca", p: e.p, forma: "circulo", radio: 6, estilo, objeto: e.o });
      P.push({ tipo: "texto", p: e.p, texto: env ? `${ex.texto} (${e.comb})` : ex.texto, tamano: 13, negrita: true, dx: 9, dy, fondo: true, prioridad: 100, alternativas: [{ dx: -9, dy, ancla: "fin" }], objeto: e.o });
      extremos.push({ que: ex.que, valor: x, unidad: u, objeto: e.o, punto: e.p, comb: e.comb });
    }
  }
  if (!lams.length) notas.push("El plano no ve ningún muro paralelo a él: en el alzado, el mapa es el de los muros del plano (el de las losas, en la planta o en el 3D).");
  else {
    if (sinMapa) notas.push(`${sinMapa} láminas sin mapa (gris).`);
    notas.push(campo === "uz" ? "uz de los nudos de las láminas de los muros (mm), negativo hacia abajo, interpolado en cada una." : campo.startsWith("f") ? "Fuerzas de membrana (SPR) en los ejes de cada muro: 1 a lo largo de su eje desde su primer punto, 2 hacia arriba." : "Campos suavizados (SPR) en los nudos de cada lámina, en los ejes de su muro (1 a lo largo de su eje desde su primer punto, 2 hacia arriba, 3 a su derecha).");
    if (env) notas.push(`Envolvente ${env === "max" ? "máxima" : "mínima"} de las ${conjunto.factores.length} combinaciones de ${conjunto.descripcion}: en cada nudo, la de ${env === "max" ? "mayor" : "menor"} valor.`);
    else if (conjunto.factores.length > 1) notas.push(`Combinación ${comb}: la del mayor |valor| en los muros del plano de las ${conjunto.factores.length} de ${conjunto.descripcion}.`);
  }
  return sobreBase(base, {
    cabecera: `${cabeceraVista}; ${env ? `envolvente ${env === "max" ? "máxima" : "mínima"} de ${conjunto.descripcion} (${conjunto.factores.length})` : `combinación ${conjunto.etiquetas[k0] ?? comb}`}`,
    primitivas: P,
    leyenda,
    tituloLeyenda: `${NOMBRES_CAMPO[campo]} · ${u}`,
    notas,
    extremos,
    puntos,
    ...(mapa ? { mapa } : {}),
  });
}
