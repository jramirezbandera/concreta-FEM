// Generador PURO de VIGUETAS de un forjado UNIDIRECCIONAL (F3 corte "unidireccional").
// Traduce la geometria de un paño `tipo:"unidireccional"` (Capa 1) a la geometria de
// sus viguetas: members sinteticos de Capa 2 (1 por vigueta, biapoyada, sin subdividir),
// su seccion sintetica, el reparto de ancho tributario y la informacion que el Paso 6d
// de `discretizar` (T2.2) necesita para clavar/remapear extremos, apoyos y cargas.
//
// Las viguetas son members SINTETICOS de Capa 2, NUNCA Capa 1 (DP1 del contrato): se
// derivan del paño, no se persisten. Se modelan como rectangulo `anchoNervio × canto`
// biapoyado (DP3), sin rigidez en T ni continuidad multivano (deuda T-f3-uni-seccion-T).
//
// MODULO HOJA: importa solo ../dominio (tipos + helpers de lectura), ../biblioteca
// (`seccionRectangular`), ./geometria (mapeo de ejes + clave de celda) y ./mallado
// (`limitesRectangulo`/`PuntoPlano`, FUENTE UNICA del bbox del paño). NO importa
// discretizar.ts ni validaciones.ts (son sus consumidores): sin ciclos. Espejo
// estructural de acople.ts / mallado.ts. PURO: sin React, sin IO, sin Pyodide;
// ejecutable y testeable en Node.
//
// --- Geometria y convencion de ejes (contrato §1) ----------------------------
// Las viguetas CORREN en `direccionViguetas` y APOYAN en los dos bordes PERPENDICULARES
// a esa direccion (los "bordes de apoyo"). La luz de cada vigueta = dimension del paño en
// `direccionViguetas`. El eje de REPARTO (donde se separan por el intereje) es el
// perpendicular. `direccionViguetas:"x"` -> viguetas paralelas al eje obra-X, reparto en Y;
// `"y"` -> paralelas a obra-Y, reparto en X. La cota (vertical FEM Y, #18) la aporta la
// planta del paño (igual que mallarPano): aqui la geometria de reparto es en planta (x,y).
//
// --- Reparto (contrato §2) ----------------------------------------------------
//   B = ancho del paño en el eje de reparto (perpendicular a direccionViguetas).
//   n = max(1, round(B / intereje))   (>=1 SIEMPRE: un paño estrecho no pierde su vigueta).
//   s = B / n                          (separacion EFECTIVA; el intereje del campo es OBJETIVO,
//                                       espejo de tamMalla -> tamMallaEfectivo del mallado).
//   vigueta k centrada en la perpendicular  p_k = min + s·(k + ½),  k = 0..n-1.
//   tributario de CADA vigueta = s (todas iguales) ⇒ Σ = n·s = B EXACTO (invariante I1).
//
// --- Determinismo -------------------------------------------------------------
// DETERMINISTA byte a byte: dada la misma entrada produce exactamente las mismas viguetas,
// en orden de indice `k` ascendente, sin azar (sin Date/random). La numeracion de nombres
// (PV<idxPano>) es local al paño con prefijo por indice, disjunta de N../M../PQ.. La
// estabilidad a reordenaciones de `modelo.panos` la garantiza el discretizador (paños por
// id -> indicePano posicional); este modulo es funcion pura del par (modelo, pano).

import type { Modelo, Pano, TipoDireccionViguetas } from "../dominio";
import { plantaPorId, nudoPorId } from "../dominio";
import { seccionRectangular } from "../biblioteca";
import { mToMm } from "../unidades";
import { TOL_NODO, clavePosicion, mapearEjes } from "./geometria";
import {
  limitesRectangulo,
  type LimitesRectangulo,
  type PuntoPlano,
} from "./mallado";
import type { SeccionFEM } from "./contratoFEM";

// --- Releases canonicos de la vigueta biapoyada (#8, DP3) ---------------------
// Vigueta BIAPOYADA (biarticulada): se liberan los giros de flexion Ry,Rz de AMBOS
// extremos, y NUNCA Rx (torsion). Es EXACTAMENTE el resultado de
// `releasesDeExtremo("articulado","articulado", false)` de discretizar.ts, en el orden
// de def_releases: [Dxi,Dyi,Dzi,Rxi,Ryi,Rzi, Dxj,Dyj,Dzj,Rxj,Ryj,Rzj].
//
// SE COPIA COMO CONSTANTE DOCUMENTADA (no se importa): un modulo HOJA no puede importar
// discretizar.ts (que es su consumidor) sin crear un ciclo. FUENTE UNICA futura: si el
// contrato de releases cambiara, `releasesDeExtremo` es la referencia; el golden I6 (indices
// 3 y 9 == false) blinda que estos flags no deriven a un mecanismo torsional. Indices 3
// (Rxi) y 9 (Rxj) SON false por construccion; 4,5 (Ryi,Rzi) y 10,11 (Ryj,Rzj) son true.
export const RELEASES_VIGUETA_BIAPOYADA: readonly boolean[] = [
  false, false, false, false, true, true, // i: libera solo Ryi,Rzi (nunca Rxi)
  false, false, false, false, true, true, // j: libera solo Ryj,Rzj (nunca Rxj)
];

// --- Patron de apoyo nodal de la vigueta AISLADA ([SPIKE T0.2], contrato §4-E) --
// Cuando NINGUN extremo de la vigueta remapea a un N* del portico (borde de apoyo SIN
// viga de contorno), la vigueta apoyada solo con {DY} en dos nudos propios deja libres
// los 3 modos rigidos del plano X-Z, la torsion RX (con J=0 no hay rigidez torsional) y
// los giros de flexion RY/RZ liberados por los releases: la matriz es singular. El spike
// T0.2 (medido contra PyNite 2.0.2, error 0.0000 % vs analitica qL²/8 y 5qL⁴/384EI) fija
// el patron minimo que la estabiliza SIN empotrar la flexion (la rotula vive en el
// def_releases del member, no en el nudo):
//   extremo i (arranque):  { DX, DY, DZ, RX, RY, RZ }  (restringe TODO)
//   extremo j (final):     {     DY, DZ, RX, RY, RZ }  (TODO menos DX)
// Es decir, cada extremo restringe todo salvo DX; DX se ancla solo en `i` (un biarticulado
// con carga transversal no tiene axil: un unico DX fija el eje sin reaccion espuria).
// Ver src/solver/spikes/vigueta_spike.md (tabla "escalon (d) RECOMENDADO").
export type ApoyoViguetaAislada = {
  DX: boolean;
  DY: boolean;
  DZ: boolean;
  RX: boolean;
  RY: boolean;
  RZ: boolean;
};

export const APOYO_VIGUETA_AISLADA_I: ApoyoViguetaAislada = {
  DX: true, DY: true, DZ: true, RX: true, RY: true, RZ: true,
};
export const APOYO_VIGUETA_AISLADA_J: ApoyoViguetaAislada = {
  DX: false, DY: true, DZ: true, RX: true, RY: true, RZ: true,
};

// --- Tipos de salida ----------------------------------------------------------

// Una vigueta generada: geometria de obra (planta) + tributario. La cota la aporta la
// planta del paño (igual que mallarPano). Coincide con el contrato §2.1.
export type Vigueta = {
  // k, 0..n-1. Fija el sufijo del nombre del member (PV<idx>-V<k>); determinista.
  indice: number;
  // Extremos en coordenadas de OBRA (x,y en planta). `a` = extremo del borde de apoyo de
  // coordenada MENOR a lo largo de la luz; `b` el de coordenada mayor (i->j = luz creciente).
  a: PuntoPlano;
  b: PuntoPlano;
  // Ancho tributario s (m). Igual para todas ⇒ Σ = B (invariante I1).
  tributario: number;
};

// Resultado de generar la geometria de viguetas de UN paño unidireccional. PURO y
// determinista. Sin nombres FEM (esos los compone el Paso 6d con el indicePano): este
// tipo es geometria, espejo de `MallaPano` para la losa.
export type MallaViguetas = {
  // n viguetas, en orden de indice ascendente.
  viguetas: Vigueta[];
  // Separacion EFECTIVA s = B/n (intereje REAL emitido; el del campo es objetivo).
  interejeEfectivo: number;
  // Nº de viguetas (n >= 1).
  n: number;
  // Luz = dimension del paño en direccionViguetas (distancia entre los dos bordes de apoyo).
  luz: number;
  // Direccion en que corren las viguetas (ejes de obra).
  direccion: TipoDireccionViguetas;
  // Ancho del paño en el eje de reparto (perpendicular a direccion). Σ tributarios == B.
  ancho: number;
  // Limites del rectangulo del paño (FUENTE UNICA: limitesRectangulo). Reutil para T2.2.
  limites: LimitesRectangulo;
};

// --- generarViguetas: geometria pura (firma del contrato §2.1) ---------------

// Genera la geometria de viguetas de UN paño unidireccional. Devuelve `undefined` si:
//   - el paño no es `tipo:"unidireccional"` (union discriminada: solo esa variante porta
//     los campos de vigueta),
//   - direccionViguetas ausente o intereje no finito/<=0 (defensa en profundidad: el borde
//     Zod ya lo garantiza > 0, pero un dato corrupto que lo evada no fabrica geometria),
//   - su perimetro no resuelve (refs rotas / nº de nudos != 4),
//   - el bbox no es rectangular/degenerado (mismos filtros que mallarPano).
// NUNCA lanza (espejo de calcularAcoples: un paño no resoluble se salta en silencio y lo
// reporta validaciones). La presencia y positividad de los campos de vigueta la garantiza
// el esquema (tras T-f3-pano-schema-union, ya NO un chequeo PANO_UNI_CAMPOS en validaciones).
export function generarViguetas(modelo: Modelo, pano: Pano): MallaViguetas | undefined {
  // Estrecha a la variante unidireccional: solo ella porta direccionViguetas/intereje/etc.
  // (union discriminada por `tipo`). El schema ya los exige presentes y > 0, pero se mantiene
  // la defensa en profundidad (nunca fabricar geometria inventada si un dato corrupto evadiera
  // el borde Zod): direccion ausente o intereje no finito/<=0 -> undefined, no throw.
  if (pano.tipo !== "unidireccional") return undefined;

  const direccion = pano.direccionViguetas;
  const intereje = pano.intereje;
  if (direccion === undefined) return undefined;
  if (!(typeof intereje === "number" && Number.isFinite(intereje) && intereje > 0)) {
    return undefined;
  }

  // Bbox del paño (FUENTE UNICA: limitesRectangulo del mallado). No rectangular/degenerado
  // -> undefined (el error de obra lo emite validaciones con su propio codigo).
  const puntos = puntosPerimetro(modelo, pano);
  if (puntos === undefined) return undefined;
  const limites = limitesRectangulo(puntos);
  if ("codigo" in limites) return undefined;

  const { xMin, xMax, yMin, yMax } = limites;

  // Eje de reparto = perpendicular a direccionViguetas. "x": reparto en Y (ancho B = alto
  // del paño), luz = ancho del paño en X. "y": simetrico.
  const esX = direccion === "x";
  const ancho = esX ? yMax - yMin : xMax - xMin; // B, en el eje de reparto
  const luz = esX ? xMax - xMin : yMax - yMin; // dimension en direccionViguetas
  const repartoMin = esX ? yMin : xMin; // min del eje de reparto

  // n = max(1, round(B/intereje)) (contrato §2.2-3): un paño mas estrecho que el intereje
  // (round -> 0) o intereje enorme SIEMPRE tiene >=1 vigueta (no pierde carga en silencio).
  const n = Math.max(1, Math.round(ancho / intereje));
  const s = ancho / n; // separacion efectiva (intereje real). Σ = n·s = B exacto.

  const viguetas: Vigueta[] = [];
  for (let k = 0; k < n; k++) {
    // Posicion transversal (interior estricto por construccion: k+½ nunca cae en 0 ni en n).
    const p = repartoMin + s * (k + 0.5);
    // Extremos en obra: a = borde de apoyo de coordenada MENOR a lo largo de la luz, b el mayor.
    const a: PuntoPlano = esX ? { x: xMin, y: p } : { x: p, y: yMin };
    const b: PuntoPlano = esX ? { x: xMax, y: p } : { x: p, y: yMax };
    viguetas.push({ indice: k, a, b, tributario: s });
  }

  return {
    viguetas,
    interejeEfectivo: s,
    n,
    luz,
    direccion,
    ancho,
    limites,
  };
}

// --- Seccion sintetica de vigueta (contrato §3.3) -----------------------------

// Nombre de la seccion sintetica de un paño (una por paño; todas las viguetas del paño
// comparten anchoNervio×canto×material). Prefijo `VIG-` disjunto de los ids de catalogo
// (IPE300, HR-300x500) y de obra.
export function nombreSeccionVigueta(indicePano: number): string {
  return `VIG-${indicePano}`;
}

// Construye la SeccionFEM sintetica de las viguetas de un paño, con las propiedades A/Iy/Iz/J
// del rectangulo `anchoNervio × canto`. CONVENIO Iy/Iz DEL DOMINIO (NO de PyNite):
//   - Iy = eje FUERTE (canto gobierna, b·h³/12) — el que emite `seccionRectangular`.
//   - Iz = eje debil (ancho gobierna, h·b³/12).
// El intercambio Iy<->Iz al convenio PyNite (donde el campo Iz gobierna la flexion vertical
// de la barra horizontal) lo hace el EMISOR (T2.2, via `seccionFEMParaPyNite` en el Paso 1
// de discretizar), IGUAL que toda seccion de viga [C-1]. Aqui se emite en convenio dominio;
// asi el canto gobierna la flexion vertical tras el swap (invariante I7). Si se emitiera sin
// swap la vigueta se calcularia "acostada" (flecha (canto/ancho)² mayor).
//
// Reutiliza la formula cerrada de biblioteca/hormigon.ts (`seccionRectangular`, que espera
// mm): PRECEDENTE de import biblioteca<-discretizador ya existente (propiedadesBarra.ts
// importa seccionRectangular/seccionCircular), asi que no rompe la jerarquia ni la pureza.
// Conversion de borde m->mm con `mToMm` (canto/anchoNervio se persisten en m), IGUAL que
// resolverSeccion en propiedadesBarra.ts. Devuelve undefined si el paño no es unidireccional
// (solo esa variante porta canto/anchoNervio en la union discriminada por `tipo`).
export function seccionFEMDeVigueta(
  pano: Pano,
  indicePano: number,
): SeccionFEM | undefined {
  if (pano.tipo !== "unidireccional") return undefined;
  const canto = pano.canto;
  const anchoNervio = pano.anchoNervio;
  // Defensa en profundidad (el schema ya exige > 0; se blinda ante datos que evadan Zod).
  if (!(typeof canto === "number" && Number.isFinite(canto) && canto > 0)) return undefined;
  if (!(typeof anchoNervio === "number" && Number.isFinite(anchoNervio) && anchoNervio > 0)) {
    return undefined;
  }
  // Borde m->mm: la biblioteca recibe mm y convierte a m internamente (fuente unica de la
  // formula del rectangulo). b = anchoNervio, h = canto (canto gobierna Iy = eje fuerte).
  const e = seccionRectangular(mToMm(anchoNervio), mToMm(canto));
  return {
    name: nombreSeccionVigueta(indicePano),
    A: e.A,
    Iy: e.Iy, // eje fuerte (canto) en convenio DOMINIO; el swap a PyNite lo hace T2.2
    Iz: e.Iz, // eje debil (ancho)
    J: e.J, // 0 (decision F1): rectangular sin torsion de St. Venant (ver hormigon.ts)
  };
}

// --- Nombres de members y nudos de extremo (contrato §3.1/§3.2) --------------

// Nombre del member de la vigueta `k` del paño de indice `idx`: `PV<idx>-V<k>`. Contador
// PROPIO por indice de paño (NO el M global de la base FEM, cerrado en construirBaseFEM):
// espejo del prefijo `PQ<idx>-Q<n>` de los quads. Disjunto de N.., M.., PQ..
export function nombreMemberVigueta(indicePano: number, k: number): string {
  return `PV${indicePano}-V${k}`;
}

// Nombre de un nudo PROPIO de extremo de vigueta (borde de apoyo SIN viga de contorno):
// `PV<idx>-N<sufijo>` (espejo de los nudos de malla `PQ<idx>-N<...>`). El sufijo lo compone
// T2.2 de forma determinista (p.ej. por vigueta + extremo). Prefijo PV disjunto.
export function nombreNudoVigueta(indicePano: number, sufijo: string | number): string {
  return `PV${indicePano}-N${sufijo}`;
}

// --- Extremos de vigueta con clave de celda (contrato §4-B, para T2.2) --------

// Un extremo de vigueta resuelto a coordenadas FEM + su CLAVE DE CELDA 2D. La clave usa el
// MISMO criterio del snapping y del remap 6c (`clavePosicion(mapearEjes(x,y,cota), TOL_NODO)`,
// geometria.ts): T2.2 la busca en `base.nombrePorClave` para casar el extremo contra un N*
// del portico (viga de contorno subdividida o esquina sobre pilar). NUNCA |Δ|<TOL_NODO (que
// diverge en la frontera de celda, [AUDITORIA M-4]).
export type ExtremoVigueta = {
  // "a" (coord menor a lo largo de la luz) o "b" (mayor). Fija que apoyo aislado aplicar:
  // el extremo `a` es el `i` del member (arranque) y `b` el `j` (final).
  cual: "a" | "b";
  // Coordenadas de OBRA (planta) del extremo. La cota la aporta la planta del paño.
  punto: PuntoPlano;
  // Coordenadas FEM globales (mapearEjes ya aplicado): [X, Y=cota, Z].
  coordFEM: [number, number, number];
  // Clave de celda 2D (mismo criterio del remap 6c). T2.2 la casa contra base.nombrePorClave.
  clave: string;
  // ¿Sobre que borde de apoyo cae? "xMin"/"xMax" para direccion "y"; "yMin"/"yMax" para "x".
  // Deriva el GDL de la muleta torsional minima cuando el extremo remapea a N* (contrato
  // §6-a): un borde de apoyo que CORRE en obra-X necesita coartar la torsion RX del nudo;
  // uno que corre en obra-Y, la torsion RZ (mapearEjes: obra-y -> FEM Z). Ver `bordeDeApoyo`.
  borde: BordeDeApoyo;
};

// Un borde de apoyo, con el eje de obra en que CORRE (la direccion a lo largo del borde) y
// el GDL de torsion del nudo a coartar si el extremo remapea a un N* del portico (§6-a).
// Un borde que corre en obra-X -> torsion RX; en obra-Y -> torsion RZ (obra-y = FEM Z).
export type BordeDeApoyo = {
  // Identificador del borde: la coordenada perpendicular fija del rectangulo que la vigueta cruza.
  lado: "xMin" | "xMax" | "yMin" | "yMax";
  // Eje de obra en que corre el borde ("x" -> horizontal en planta; "y" -> vertical en planta).
  corre: "x" | "y";
  // GDL de TORSION del nudo a coartar como muleta minima cuando el extremo remapea a N* (§6-a).
  // Borde que corre en obra-X -> RX; en obra-Y -> RZ (mapearEjes: obra-y -> FEM Z).
  torsion: "RX" | "RZ";
};

// Resuelve los dos extremos (a, b) de una vigueta a coordenadas FEM + clave de celda + borde
// de apoyo. La cota la aporta la planta del paño. Determinista. Lo consume T2.2 (Paso 6d)
// para: (a) buscar N* por clave y remapear, (b) derivar la muleta torsional o el nudo propio,
// (c) emitir el member entre los dos nombres de nudo resueltos. Devuelve undefined si la
// planta del paño no resuelve (bug del llamante: validaciones ya lo garantiza).
export function extremosDeVigueta(
  modelo: Modelo,
  pano: Pano,
  vigueta: Vigueta,
): [ExtremoVigueta, ExtremoVigueta] | undefined {
  // Solo la variante unidireccional porta direccionViguetas (union discriminada por `tipo`).
  if (pano.tipo !== "unidireccional") return undefined;
  const planta = plantaPorId(modelo, pano.plantaId);
  if (planta === undefined) return undefined;
  const direccion = pano.direccionViguetas;

  const cota = planta.cota;
  const esX = direccion === "x";
  // "x": la vigueta corre en X y apoya en los bordes x=xMin (extremo a) / x=xMax (extremo b);
  // esos bordes CORREN en obra-Y -> torsion RZ. "y": apoya en y=yMin/yMax, que corren en
  // obra-X -> torsion RX.
  const bordeA: BordeDeApoyo = esX
    ? { lado: "xMin", corre: "y", torsion: "RZ" }
    : { lado: "yMin", corre: "x", torsion: "RX" };
  const bordeB: BordeDeApoyo = esX
    ? { lado: "xMax", corre: "y", torsion: "RZ" }
    : { lado: "yMax", corre: "x", torsion: "RX" };

  const extremo = (cual: "a" | "b", punto: PuntoPlano, borde: BordeDeApoyo): ExtremoVigueta => {
    const coordFEM = mapearEjes(punto.x, punto.y, cota);
    return {
      cual,
      punto,
      coordFEM,
      clave: clavePosicion(coordFEM, TOL_NODO),
      borde,
    };
  };

  return [
    extremo("a", vigueta.a, bordeA),
    extremo("b", vigueta.b, bordeB),
  ];
}

// --- Ancho tributario y puntos de subdivision (contrato §2.5 / §8-3) ----------

// Anchos tributarios por vigueta (m), en orden de indice. TODOS iguales a `s`; Σ == B
// (invariante I1: `s = B/n` reparte B a partes iguales, sin residuo). Lo consume T2.2 para
// la carga de cada vigueta (w_k = -(presion·s), FY-) y el CM. Fuente unica del tributario.
export function anchosTributarios(malla: MallaViguetas): number[] {
  return malla.viguetas.map((v) => v.tributario);
}

// Puntos de subdivision candidatos por BORDE DE APOYO, en coordenadas de OBRA. Cada borde de
// apoyo (los dos que las viguetas cruzan) recibe un punto por cada vigueta (la interseccion
// vigueta-borde). T2.2 los aporta a `subdivisionesViga` (via la rama unidireccional de
// calcularAcoples, contrato §4-F): si hay una viga de contorno colineal con el borde, la viga
// se subdivide en cada punto y el extremo de vigueta remapea al N* clavado ahi. Ordenados por
// coordenada a lo largo del borde (determinismo). Espejo del contrato de subdivisionesViga.
export type SubdivisionesPorBorde = {
  // Extremos "a" (borde de coordenada menor a lo largo de la luz) de todas las viguetas.
  bordeA: { borde: BordeDeApoyo; puntos: PuntoPlano[] };
  // Extremos "b" (borde de coordenada mayor).
  bordeB: { borde: BordeDeApoyo; puntos: PuntoPlano[] };
};

// Deriva los puntos de subdivision candidatos de los dos bordes de apoyo de un paño. Los
// puntos son EXACTAMENTE las coordenadas de obra de los extremos de vigueta (misma celda que
// el nudo -> la clave case con el N* clavado por la subdivision). Devuelve undefined si algun
// extremo no resuelve (planta ausente: bug del llamante). Determinista (viguetas por indice).
export function subdivisionesDeBordes(
  modelo: Modelo,
  pano: Pano,
  malla: MallaViguetas,
): SubdivisionesPorBorde | undefined {
  // Solo la variante unidireccional porta direccionViguetas (union discriminada por `tipo`).
  if (pano.tipo !== "unidireccional") return undefined;
  const esX = pano.direccionViguetas === "x";
  const bordeA: BordeDeApoyo = esX
    ? { lado: "xMin", corre: "y", torsion: "RZ" }
    : { lado: "yMin", corre: "x", torsion: "RX" };
  const bordeB: BordeDeApoyo = esX
    ? { lado: "xMax", corre: "y", torsion: "RZ" }
    : { lado: "yMax", corre: "x", torsion: "RX" };

  const puntosA: PuntoPlano[] = [];
  const puntosB: PuntoPlano[] = [];
  for (const v of malla.viguetas) {
    const ext = extremosDeVigueta(modelo, pano, v);
    if (ext === undefined) return undefined;
    puntosA.push(ext[0].punto);
    puntosB.push(ext[1].punto);
  }
  // Orden a lo largo del borde (perpendicular a la luz): por la coordenada del eje de reparto.
  // "x" (viguetas en X, bordes verticales x=const): ordenar por y. "y": ordenar por x.
  const along = (p: PuntoPlano): number => (esX ? p.y : p.x);
  puntosA.sort((p, q) => along(p) - along(q));
  puntosB.sort((p, q) => along(p) - along(q));

  return {
    bordeA: { borde: bordeA, puntos: puntosA },
    bordeB: { borde: bordeB, puntos: puntosB },
  };
}

// --- Helper interno: perimetro del paño a 4 puntos de obra --------------------

// Resuelve el perimetro de un paño a 4 puntos de obra, o undefined si no es resoluble
// (referencias rotas / nº de nudos distinto de 4). Copia del helper homonimo (privado) de
// acople.ts: no se importa porque acople.ts no lo exporta; ambos consumen la misma FUENTE
// UNICA del bbox (limitesRectangulo) sobre estos puntos, asi que el criterio no diverge.
function puntosPerimetro(
  modelo: Modelo,
  pano: Pano,
): [PuntoPlano, PuntoPlano, PuntoPlano, PuntoPlano] | undefined {
  if (pano.perimetro.length !== 4) return undefined;
  const puntos: PuntoPlano[] = [];
  for (const nudoId of pano.perimetro) {
    const n = nudoPorId(modelo, nudoId);
    if (n === undefined) return undefined;
    puntos.push({ x: n.x, y: n.y });
  }
  return puntos as [PuntoPlano, PuntoPlano, PuntoPlano, PuntoPlano];
}
