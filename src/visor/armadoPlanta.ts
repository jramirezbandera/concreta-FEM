/**
 * Fase CO6 (`docs/fem3d/comprobaciones.md` §8.11): el armado en barras, dibujado en la planta. La
 * escena de la vista `comprobacion` con `dibujo: "armado"`:
 *
 * - **Losas:** cada refuerzo con su barra (a lo largo de las suyas, de punta a punta de su zona), su
 *   línea de reparto (lo que cubre en transversal) y su rótulo («Ø12/200 · 2,40 m»), los inferiores en
 *   azul y los superiores en rojo; los cercos de los nervios, un punto por cerco sobre el eje de cada
 *   nervio de su zona (su contorno, a trazos), rotulados con sus ramas; la armadura base, en la leyenda. Todo recortado con la losa. Cada refuerzo y cada zona de
 *   cercos se elige por su id (`<losa>/R<n>`, `<losa>/C<n>`: `idElemento` del editor).
 *   Cada refuerzo va acotado a lo largo de sus barras (§8.12, `cotasRefuerzo`) respecto a los pilares
 *   de su ancho y a los ejes de las vigas que lo cruzan: lo que sale a cada lado del eje que tiene
 *   dentro o, si no tiene ninguno, lo que le falta a cada punta hasta el más cercano.
 * - **Pilares:** la sección del tramo que llega a la planta, con sus barras y su cerco a escala en su
 *   huella (con el zoom se ven), y su armado rotulado.
 * - **Vigas:** el armado de cada vano rotulado a lo largo de él: la superior a un lado y la inferior
 *   y los cercos al otro, y lo propio de las zonas de apoyo, en su cuarto de la luz.
 * - **Punzonamiento:** el perímetro crítico de cada unión (a 2·d) y los perímetros de cercos, cortados
 *   en el borde de las losas.
 *
 * El color de cada pieza sigue siendo el de su aprovechamiento. Dónde va cada barra lo dice
 * `comprobaciones/dibujoArmado.ts`; los números (aprovechamientos) son los de las fichas.
 */
import type { ArmadoProyecto } from "../agente/armaduraBase.ts";
import { recorteTramos, regionesLosas, trozosEnLosa } from "../agente/render/armado.ts";
import { bandaPolilinea, numeroFijo, type EntradaLeyenda, type Escena, type Estilo, type ExtremoRotulado, type Primitiva } from "../agente/render/escena.ts";
import { anchoViga, fondoModelo, giroTexto, huellaSeccion, PlantaFisica, type DatosVista } from "../agente/render/modelo.ts";
import { cabecera, caja, circuloPilar } from "../agente/render/resultados.ts";
import { nerviosLosa } from "../compilador/abacos.ts";
import type { Vec2 } from "../compilador/fisico.ts";
import { puntoEnRegion, type Region } from "../compilador/poligonos.ts";
import { ARMADURAS_FORJADO, textoBarrasForjado, type ArmadoForjado, type ArmadoTramoPilar, type ArmadoVanoViga, type BarrasCara, type CercosViga } from "../comprobaciones/armado.ts";
import { alzadoVano, cercosDibujados, cotasRefuerzo, puntosCercos, refuerzosDibujados, seccionPilarArmada, type RefuerzoDibujado } from "../comprobaciones/dibujoArmado.ts";
import type { Diagnostico } from "../motor/diagnosticos.ts";
import { alDia, claseAprovechamiento, COLOR_APROVECHAMIENTO, TEXTO_CLASE, trozo, type ClaseAprovechamiento, type FichaComprobacion, type TipoComprobacion } from "./comprobaciones.ts";
import type { Sesion } from "./sesion.ts";

type Resultado<T> = { valido: true; valor: T } | { valido: false; diagnosticos: Diagnostico[] };

/** Qué se dibuja del armado de las losas: todo, los refuerzos de una cara (sin los cercos) o sólo los cercos de los nervios. */
export type CaraDibujada = "inferior" | "superior" | "cercos" | "todas";

/** Los colores de los rótulos de cada cara (los de sus estilos). */
const COLOR_CARA = { inferior: "#1d4ed8", superior: "#dc2626" } as const;
const COLOR_CERCOS = "#0f766e";

const barras = (b: BarrasCara) => `${b.n}Ø${b.diametro}`;
const cercos = (c: CercosViga) => `cØ${c.diametro}/${c.separacion}${c.ramas !== undefined && c.ramas !== 2 ? ` (${c.ramas}R)` : ""}`;
const metros = (x: number) => numeroFijo(x, 2);
const medio = (p: readonly Vec2[]): Vec2 => [p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length];

/** El contorno a una distancia r de un rectángulo (centro c, semilados a según ez y b según ey), con las esquinas en arco. */
function contornoA(c: Vec2, ez: Vec2, ey: Vec2, a: number, b: number, r: number): Vec2[] {
  const P: Vec2[] = [];
  const N = 8;
  for (const [k, sx, sy] of [[0, 1, 1], [1, -1, 1], [2, -1, -1], [3, 1, -1]] as const)
    for (let i = 0; i <= N; i++) {
      const t = ((k + i / N) * Math.PI) / 2;
      const [u, v] = [sx * a + r * Math.cos(t), sy * b + r * Math.sin(t)];
      P.push([c[0] + u * ez[0] + v * ey[0], c[1] + u * ez[1] + v * ey[1]]);
    }
  return P;
}

/** Un anillo cerrado, en los trozos que caen dentro de alguna región (a tramos de 5 cm como mucho). */
function dentroDe(anillo: readonly Vec2[], regiones: readonly Region[]): Vec2[][] {
  const en = (q: Vec2) => regiones.some((r) => puntoEnRegion(q, r));
  const r: Vec2[][] = [];
  let actual: Vec2[] | null = null;
  const n = anillo.length;
  for (let i = 0; i < n; i++) {
    const [a, b] = [anillo[i]!, anillo[(i + 1) % n]!];
    const pasos = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.05));
    for (let k = 0; k < pasos; k++) {
      const [p, q]: [Vec2, Vec2] = [
        [a[0] + ((b[0] - a[0]) * k) / pasos, a[1] + ((b[1] - a[1]) * k) / pasos],
        [a[0] + ((b[0] - a[0]) * (k + 1)) / pasos, a[1] + ((b[1] - a[1]) * (k + 1)) / pasos],
      ];
      if (en([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2])) {
        if (!actual) r.push((actual = [p]));
        actual.push(q);
      } else actual = null;
    }
  }
  return r;
}

/** Holgura en transversal con la que un pilar es referencia de un refuerzo (su punto, junto a su ancho), m. */
const HOLGURA_PILAR = 0.3;

/**
 * Las referencias para acotar un refuerzo, en su s: los pilares de la planta que caen en su ancho (con
 * una holgura) y los ejes de las vigas que lo cruzan (a menos de 20° de la perpendicular a sus barras).
 */
export function referenciasRefuerzo(x: Pick<RefuerzoDibujado, "d" | "n" | "t">, pilares: readonly Vec2[], vigas: readonly (readonly Vec2[])[]): number[] {
  const st = (p: Vec2): [number, number] => [p[0] * x.d[0] + p[1] * x.d[1], p[0] * x.n[0] + p[1] * x.n[1]];
  const refs: number[] = [];
  for (const p of pilares) {
    const [s, t] = st(p);
    if (t >= x.t[0] - HOLGURA_PILAR && t <= x.t[1] + HOLGURA_PILAR) refs.push(s);
  }
  const tm = (x.t[0] + x.t[1]) / 2;
  for (const puntos of vigas)
    for (let i = 0; i + 1 < puntos.length; i++) {
      const [[sa, ta], [sb, tb]] = [st(puntos[i]!), st(puntos[i + 1]!)];
      const largo = Math.hypot(sb - sa, tb - ta);
      // Que cruce las barras (casi perpendicular) y pase por el ancho del refuerzo
      if (largo < 1e-9 || Math.abs(sb - sa) > 0.342 * largo || Math.max(ta, tb) < x.t[0] + 1e-6 || Math.min(ta, tb) > x.t[1] - 1e-6) continue;
      const t = Math.min(Math.max(tm, Math.min(ta, tb)), Math.max(ta, tb));
      refs.push(sa + ((t - ta) / (tb - ta)) * (sb - sa));
    }
  return refs;
}

const NOMBRE_VISTA: Record<TipoComprobacion, string> = { pilares: "los tramos de pilar que llegan a la planta", vigas: "los vanos de las vigas de la planta", losas: "las losas de la planta", punzonamiento: "el punzonamiento de las losas de la planta" };
const NOMBRE_ARMADURA = { "x-inf": "X inferior", "x-sup": "X superior", "y-inf": "Y inferior", "y-sup": "Y superior" } as const;

/** La planta con el armado en barras dibujado: la escena de la vista `comprobacion` con `dibujo: "armado"`. */
export function vistaArmadoBarras(s: Sesion, planta: string, tipo: TipoComprobacion, armado: ArmadoProyecto | undefined, d: DatosVista, cara: CaraDibujada = "todas"): Resultado<Escena> {
  const r = alDia(s, tipo, armado);
  if (!r.valido) return r;
  const pl = new PlantaFisica(s.proyecto.modelo, planta);
  const P: Primitiva[] = [...fondoModelo(pl, { atenuado: true }).primitivas];
  const textos: Primitiva[] = [];
  const extremos: ExtremoRotulado[] = [];
  const leyenda: EntradaLeyenda[] = [];
  const notas: string[] = [];
  const usadas = new Set<ClaseAprovechamiento>();
  const valor = (p: FichaComprobacion) => (p.aprovechamiento === null ? "—" : numeroFijo(p.aprovechamiento, 2));
  const anotar = (p: FichaComprobacion, punto: Vec2) => {
    usadas.add(claseAprovechamiento(p));
    if (p.aprovechamiento !== null) extremos.push({ que: `aprovechamiento de ${p.clave}${p.manda ? ` (${p.manda.descripcion})` : ""}`, valor: p.aprovechamiento, unidad: "", objeto: p.pieza, punto, ...(p.manda?.comb ? { comb: p.manda.comb } : {}) });
  };
  const relleno = (p: FichaComprobacion) => COLOR_APROVECHAMIENTO[claseAprovechamiento(p)];
  const fichas = r.valor.fichas;
  let dibujadas = 0;

  if (tipo === "pilares" || tipo === "punzonamiento") {
    const pilares = new Map(pl.pilares().map((x) => [x.p.id, x]));
    const regiones = [...regionesLosas(pl.enPlanta(pl.f.losas)).values()];
    let conCercos = false;
    for (const p of fichas) {
      if (p.planta !== planta) continue;
      const x = pilares.get(p.pieza);
      const h = x && huellaSeccion(x.p, x.seccion);
      if (!x || !h) continue;
      dibujadas++;
      const anillo = "anillo" in h ? h.anillo : circuloPilar(h.centro, h.radio);
      const c = "anillo" in h ? medio(h.anillo) : h.centro;
      const lado = Math.max(...anillo.map((q) => Math.hypot(q[0] - c[0], q[1] - c[1])));
      // Los ejes de la sección en planta: el canto h según ez (el giro del pilar) y el ancho b según ey
      const g = ((x.p.giro ?? 0) * Math.PI) / 180;
      const ez: Vec2 = [Math.cos(g), Math.sin(g)];
      const ey: Vec2 = [Math.sin(g), -Math.cos(g)];
      const en = (u: number, v: number): Vec2 => [c[0] + (u * ez[0] + v * ey[0]) / 1000, c[1] + (u * ez[1] + v * ey[1]) / 1000];
      P.push({ tipo: "poligono", anillos: [anillo], estilo: "contorno", relleno: relleno(p), objeto: p.pieza });
      anotar(p, [c[0], c[1] + lado]);
      if (tipo === "pilares") {
        const sc = p.geometria.tipo === "pilares" ? p.geometria.seccion : undefined;
        const a = p.armado.tipo === "pilares" ? p.armado.armado : undefined;
        if (sc && a) {
          const sec = seccionPilarArmada(sc, a as ArmadoTramoPilar, p.recubrimiento);
          if (sec.cerco) {
            const [w, t] = [sec.cerco.ancho / 2, sec.cerco.alto / 2];
            P.push({ tipo: "linea", puntos: sec.forma === "circular" ? [...circuloPilar(c, w / 1000), circuloPilar(c, w / 1000)[0]!] : [en(-w, -t), en(w, -t), en(w, t), en(-w, t), en(-w, -t)], estilo: "armado-cerco", objeto: p.pieza });
          }
          for (const b of sec.barras) {
            // A escala (se ve con el zoom) y, encima, una marca de tamaño fijo (se ve siempre)
            P.push({ tipo: "poligono", anillos: [circuloPilar(en(b.x, b.y), b.diametro / 2000, 12)], estilo: "armado-barra", objeto: p.pieza });
            P.push({ tipo: "marca", p: en(b.x, b.y), forma: "circulo", radio: 1.6, estilo: "armado-barra", objeto: p.pieza });
          }
        }
        textos.push({ tipo: "texto", p: [c[0], c[1] + lado], texto: `${p.pieza} · ${p.texto ?? "sin armado"}`, tamano: 11, ancla: "medio", dy: -4, fondo: true, prioridad: claseAprovechamiento(p) === "no-cumple" ? 60 : 50, objeto: p.pieza });
        textos.push({ tipo: "texto", p: [c[0], c[1] - lado], texto: valor(p), tamano: 11, ancla: "medio", dy: 13, prioridad: 40, clase: "id", objeto: p.pieza });
      } else {
        const gm = p.geometria.tipo === "punzonamiento" ? p.geometria : undefined;
        const sc = gm?.seccion;
        if (gm?.d && sc) {
          const [a, b] = "D" in sc ? [0, 0] : [sc.h / 2000, sc.b / 2000];
          const r0 = "D" in sc ? sc.D / 2000 : 0;
          const a2d = (2 * gm.d) / 1000;
          for (const t of dentroDe(contornoA(c, ez, ey, a, b, r0 + a2d), regiones)) P.push({ tipo: "linea", puntos: t, estilo: "armado-critico", objeto: p.pieza });
          const arm = p.armado.tipo === "punzonamiento" ? p.armado.armado : undefined;
          const n = gm.perimetros ?? 0;
          if (arm && n && gm.alcance) {
            conCercos = true;
            for (let i = 0; i < n; i++) {
              const ri = (gm.alcance - (n - 1 - i) * arm.separacion) / 1000;
              if (ri > 0) for (const t of dentroDe(contornoA(c, ez, ey, a, b, r0 + ri), regiones)) P.push({ tipo: "linea", puntos: t, estilo: "armado-cerco", objeto: p.pieza });
            }
          }
        }
        textos.push({ tipo: "texto", p: [c[0], c[1] + lado], texto: `${p.pieza} · ${p.texto ?? "sin armadura"} · ${valor(p)}`, tamano: 11, ancla: "medio", dy: -4, fondo: true, prioridad: claseAprovechamiento(p) === "no-cumple" ? 60 : 50, objeto: p.pieza });
      }
    }
    if (tipo === "pilares") {
      leyenda.push({ estilo: "armado-barra", texto: "Barras del tramo que llega a la planta, a escala en su huella" }, { estilo: "armado-cerco", texto: "Cerco" });
      notas.push("Rótulo: el pilar y el armado de su tramo; debajo, el aprovechamiento de la comprobación que manda. Las barras se ven al acercarse.");
    } else {
      leyenda.push({ estilo: "armado-critico", texto: "Perímetro crítico, a 2·d de la cara del pilar" });
      if (conCercos) leyenda.push({ estilo: "armado-cerco", texto: "Perímetros de cercos" });
      notas.push("Rótulo: el pilar, su armadura de punzonamiento y el aprovechamiento de la comprobación que manda. Los perímetros se cortan en el borde de las losas.");
    }
  } else if (tipo === "vigas") {
    const vigas = new Map(pl.enPlanta(pl.f.vigas).map((v) => [v.id, v]));
    for (const p of fichas) {
      const v = vigas.get(p.pieza);
      if (!v || !p.tramo) continue;
      const linea = trozo(v.puntos, p.tramo[0], p.tramo[1]);
      if (linea.length < 2) continue;
      dibujadas++;
      const b = Math.max(anchoViga(pl.f.secciones?.find((x) => x.id === v.seccion)), 0.1);
      for (const a of bandaPolilinea(linea, b)) P.push({ tipo: "poligono", anillos: [a], estilo: "contorno", relleno: relleno(p), objeto: p.pieza });
      /** El punto y la dirección de la viga a una fracción del vano. */
      const en = (f: number): { p: Vec2; giro: number; n: Vec2 } => {
        const sm = p.tramo![0] + f * (p.tramo![1] - p.tramo![0]);
        const t = trozo(v.puntos, sm - 1e-6, sm + 1e-6);
        const q = t[0] ?? linea[0]!;
        const dir: Vec2 = t.length > 1 ? [t[1]![0] - t[0]![0], t[1]![1] - t[0]![1]] : [linea[1]![0] - linea[0]![0], linea[1]![1] - linea[0]![1]];
        const L = Math.hypot(dir[0], dir[1]) || 1;
        return { p: q, giro: giroTexto(dir), n: [-dir[1] / L, dir[0] / L] };
      };
      const m = en(0.5);
      anotar(p, m.p);
      const a = p.armado.tipo === "vigas" ? (p.armado.armado as ArmadoVanoViga | undefined) : undefined;
      const al = alzadoVano(p.tramo[1] - p.tramo[0], a);
      const rot = (f: number, texto: string, arriba: boolean, color: string, prioridad: number) => {
        const q = en(f);
        textos.push({ tipo: "texto", p: q.p, texto, tamano: 11, ancla: "medio", dy: arriba ? -7 : 16, giro: q.giro, color, prioridad, fondo: true, objeto: p.pieza });
      };
      if (!a) rot(0.5, `sin armado`, true, "#6b7280", 45);
      else {
        const [ini, cen, fin] = al.zonas;
        if (cen.superior) rot(0.5, `sup ${barras(cen.superior)}`, true, COLOR_CARA.superior, 55);
        rot(0.5, [al.inferior ? `inf ${barras(al.inferior)}` : "", cen.cercos ? cercos(cen.cercos) : ""].filter(Boolean).join(" · "), false, COLOR_CARA.inferior, 54);
        for (const [z, f] of [[ini, 0.125], [fin, 0.875]] as const) {
          if (z.superiorPropia && z.superior) rot(f, barras(z.superior), true, COLOR_CARA.superior, 48);
          if (z.cercosPropios && z.cercos) rot(f, cercos(z.cercos), false, COLOR_CERCOS, 47);
        }
        // Las zonas de apoyo, si llevan lo suyo: una raya a través de la viga en cada cuarto de la luz
        if (al.zonas.some((z) => z.superiorPropia || z.cercosPropios))
          for (const f of [0.25, 0.75]) {
            const q = en(f);
            P.push({ tipo: "linea", puntos: [[q.p[0] - q.n[0] * b * 0.8, q.p[1] - q.n[1] * b * 0.8], [q.p[0] + q.n[0] * b * 0.8, q.p[1] + q.n[1] * b * 0.8]], estilo: "armado-cerco", objeto: p.pieza });
          }
      }
    }
    notas.push("A lo largo de cada vano: a un lado, la armadura superior; al otro, la inferior y los cercos. En los cuartos de la luz junto a los apoyos, lo que esa zona lleva distinto.");
  } else {
    const losas = new Map(pl.enPlanta(pl.f.losas).map((l) => [l.id, l]));
    const regiones = regionesLosas(pl.enPlanta(pl.f.losas));
    const caras = new Set<"inferior" | "superior">();
    let hayCercos = false;
    let hayCotas = false;
    const puntosPilares = pl.pilares().map((x): Vec2 => [x.p.x, x.p.y]);
    const ejesVigas = pl.enPlanta(pl.f.vigas).map((v) => v.puntos);
    for (const p of fichas) {
      const l = losas.get(p.pieza);
      if (!l) continue;
      dibujadas++;
      const region = regiones.get(l.id);
      const a = p.armado.tipo === "losas" ? (p.armado.armado as ArmadoForjado | undefined) : undefined;
      const c = medio(l.contorno);
      anotar(p, c);
      // El contorno de la losa, del color de su aprovechamiento
      P.push({ tipo: "linea", puntos: [...l.contorno.map((q) => [q[0], q[1]] as Vec2), [l.contorno[0]![0], l.contorno[0]![1]]], estilo: "contorno", objeto: p.pieza });
      // Los cercos de los nervios: el contorno de su zona, a trazos, y un punto por cerco sobre el eje de cada nervio
      const zonasCercos = cara === "todas" || cara === "cercos" ? cercosDibujados(l.eje1, a) : [];
      const nervios = zonasCercos.length ? nerviosLosa(l) : [];
      for (const z of zonasCercos) {
        const anillos = recorteTramos(region, z.zona);
        if (!anillos.length) continue;
        hayCercos = true;
        for (const an of anillos) P.push({ tipo: "linea", puntos: [...an, an[0]!], estilo: "armado-cercos", objeto: `${p.pieza}/C${z.indice + 1}` });
        for (const q of puntosCercos(z, nervios)) if (!region || puntoEnRegion(q, region)) P.push({ tipo: "marca", p: q, forma: "circulo", radio: 1.7, estilo: "armado-cercos-punto", objeto: `${p.pieza}/C${z.indice + 1}` });
        textos.push({ tipo: "texto", p: z.centro, texto: z.texto, tamano: 11, ancla: "medio", dy: 4, giro: giroTexto(z.d), color: COLOR_CERCOS, fondo: true, prioridad: 30, objeto: `${p.pieza}/C${z.indice + 1}` });
      }
      // Los refuerzos: la zona, la barra, la línea de reparto y el rótulo
      for (const x of refuerzosDibujados(l.eje1, a)) {
        if (cara !== "todas" && x.cara !== cara) continue;
        caras.add(x.cara);
        const [grueso, fino, zona]: [Estilo, Estilo, Estilo] = x.cara === "inferior" ? ["armado-inferior", "armado-inferior-fino", "armado-inferior-zona"] : ["armado-superior", "armado-superior-fino", "armado-superior-zona"];
        for (let i = 0; i < 4; i++) for (const t of trozosEnLosa(region, x.zona[i]!, x.zona[(i + 1) % 4]!)) P.push({ tipo: "linea", puntos: t, estilo: zona, objeto: `${p.pieza}/R${x.indice + 1}` });
        for (const t of trozosEnLosa(region, x.barra[0], x.barra[1])) P.push({ tipo: "linea", puntos: t, estilo: grueso, objeto: `${p.pieza}/R${x.indice + 1}` });
        for (const t of trozosEnLosa(region, x.reparto[0], x.reparto[1])) P.push({ tipo: "linea", puntos: t, estilo: fino, objeto: `${p.pieza}/R${x.indice + 1}` });
        // Los topes de la línea de reparto: una raya corta según la barra en cada punta
        const dir: Vec2 = [(x.barra[1][0] - x.barra[0][0]) / x.largo, (x.barra[1][1] - x.barra[0][1]) / x.largo];
        for (const q of x.reparto) if (!region || puntoEnRegion(q, region)) P.push({ tipo: "linea", puntos: [[q[0] - dir[0] * 0.08, q[1] - dir[1] * 0.08], [q[0] + dir[0] * 0.08, q[1] + dir[1] * 0.08]], estilo: fino, objeto: `${p.pieza}/R${x.indice + 1}` });
        P.push({ tipo: "marca", p: x.centro, forma: "circulo", radio: 2.4, estilo: grueso, objeto: `${p.pieza}/R${x.indice + 1}` });
        textos.push({ tipo: "texto", p: x.centro, texto: `${x.texto} · ${metros(x.largo)} m`, tamano: 11, ancla: "medio", dy: -5, giro: giroTexto(dir), color: COLOR_CARA[x.cara], fondo: true, prioridad: 40 + Math.min(9, x.largo), objeto: `${p.pieza}/R${x.indice + 1}` });
        // Las cotas a lo largo de la barra: desde el eje que tiene dentro, o de cada punta al más cercano
        const tm = (x.t[0] + x.t[1]) / 2;
        const en = (s: number, dt = 0): Vec2 => [s * x.d[0] + (tm + dt) * x.n[0], s * x.d[1] + (tm + dt) * x.n[1]];
        const raya = (s: number) => (!region || puntoEnRegion(en(s), region)) && P.push({ tipo: "linea", puntos: [en(s, -0.12), en(s, 0.12)], estilo: fino, objeto: `${p.pieza}/R${x.indice + 1}` });
        const cota = (a: number, b: number) => textos.push({ tipo: "texto", p: en((a + b) / 2), texto: metros(b - a), tamano: 10, ancla: "medio", dy: 11, giro: giroTexto(dir), color: COLOR_CARA[x.cara], fondo: true, prioridad: 34, objeto: `${p.pieza}/R${x.indice + 1}` });
        const ct = cotasRefuerzo(x.s, referenciasRefuerzo(x, puntosPilares, ejesVigas));
        if (ct.dentro.length) {
          hayCotas = true;
          const cortes = [x.s[0], ...ct.dentro, x.s[1]];
          for (const s of ct.dentro) raya(s);
          for (let i = 0; i + 1 < cortes.length; i++) cota(cortes[i]!, cortes[i + 1]!);
        }
        for (const [k, ref] of ct.fuera.entries()) {
          if (ref === null) continue;
          hayCotas = true;
          const [a, b] = k === 0 ? [ref, x.s[0]] : [x.s[1], ref];
          P.push({ tipo: "linea", puntos: [en(a), en(b)], estilo: zona, objeto: `${p.pieza}/R${x.indice + 1}` });
          raya(ref);
          raya(x.s[k]);
          cota(a, b);
        }
      }
      textos.push({ tipo: "texto", p: c, texto: `${p.pieza} ${valor(p)}`, tamano: 11, ancla: "medio", fondo: true, prioridad: 60, objeto: p.pieza });
      // La armadura base, en palabras: es de toda la losa
      if (a?.base) {
        const cuatro = (b: ArmadoForjado["base"]) => ARMADURAS_FORJADO.map((k) => `${NOMBRE_ARMADURA[k]} ${b[k] ? textoBarrasForjado(b[k]) : "—"}`).join(" · ");
        notas.push(`${p.pieza}, armadura base${p.armado.tipo === "losas" && p.armado.reticular ? " (barras por nervio)" : ""}: ${cuatro(a.base)}.${a.abacos ? ` Ábacos: ${cuatro(a.abacos)}.` : ""}`);
      } else notas.push(`${p.pieza}: sin armado.`);
    }
    if (caras.has("inferior")) leyenda.push({ estilo: "armado-inferior", texto: "Refuerzo inferior: la barra y lo que cubre" });
    if (caras.has("superior")) leyenda.push({ estilo: "armado-superior", texto: "Refuerzo superior: la barra y lo que cubre" });
    if (hayCercos) leyenda.push({ estilo: "armado-cercos-punto", texto: "Cercos de los nervios: un punto por cerco, con sus ramas (R)" });
    notas.push("Cada refuerzo: su barra, de punta a punta, y la línea de reparto, que cruza lo que cubre; se suma a la armadura base. Rótulo: las barras y su largo.");
    if (hayCotas) notas.push("Bajo cada barra, sus cotas en metros: lo que sale a cada lado del eje del pilar o de la viga que cruza o, si no cruza ninguno, lo que falta de cada punta hasta el más cercano.");
  }
  if (tipo !== "losas") for (const x of ["no-cumple", "alto", "cumple", "sin-armado"] as const) if (usadas.has(x)) leyenda.push({ relleno: COLOR_APROVECHAMIENTO[x], texto: TEXTO_CLASE[x] });
  if (!dibujadas) notas.push(tipo === "pilares" ? "Ningún tramo de pilar tiene la cabeza en esta planta." : tipo === "vigas" ? "No hay vigas en esta planta." : tipo === "losas" ? "No hay losas macizas ni reticulares en esta planta." : "Ninguna losa de esta planta pasa carga a un pilar por su huella.");
  return {
    valido: true,
    valor: {
      titulo: d.nombre ?? "Proyecto",
      cabecera: cabecera(pl, `Vista: armado de ${NOMBRE_VISTA[tipo]}`, d),
      primitivas: [...P, ...textos],
      leyenda,
      tituloLeyenda: "Armado en barras",
      notas,
      extremos: extremos.sort((a, b) => b.valor - a.valor),
      caja: caja(pl),
    },
  };
}
