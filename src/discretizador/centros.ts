// Centro de masas (CM) por planta (F2.1, F2a Fase 2). Calculo PURO: sin React, sin
// IO, sin Pyodide; ejecutable y testeable en Node. Lo consume la UI de F2.4 (overlay
// + panel de "Centro de masas"); el discretizador NO depende de este modulo.
//
// "Centro de masas" es el termino CYPECAD; en realidad se computa con PESOS (kN). Como
// `rho` es PESO especifico (kN/m³), el centroide ponderado por peso coincide con el
// ponderado por masa (peso/peso = masa/masa: invariante a la gravedad g). `pesoTotal`
// se reporta en kN (peso permanente total de la planta).
//
// Es PURO y consume el helper unico de propiedades de barra (`propiedadesBarra.ts`,
// A-dry): NO reimplementa A·rho ni resuelve secciones/materiales por su cuenta, de
// modo que el peso propio del CM y el peso propio del analisis (discretizador) salen
// de la misma fuente de verdad y no divergen.
//
// COORDENADAS: el CM se devuelve en el sistema de OBRA (replanteo), el (x,y) en planta
// que el arquitecto dibuja, NO en coordenadas FEM. Un centroide por planta vive en el
// plano horizontal del forjado, asi que la cota (Y FEM) es irrelevante aqui: pilares
// (verticales) aportan en su (x,y), vigas/cargas en sus (x,y) de planta. Esto evita
// arrastrar la convencion de ejes #18 (que es del solver) hasta la UI.

import type { Modelo, Viga, Carga, Hipotesis, Pano } from "../dominio";
import {
  plantaPorId,
  nudoPorId,
  vigasDePlanta,
} from "../dominio";
import { getMaterial } from "../biblioteca";
import { propiedadesDePilar, propiedadesDeViga } from "./propiedadesBarra";
import type { PropiedadesBarra } from "./propiedadesBarra";
// Paños (F3.2, cierra T-cm-cargas-muertas): bbox del rectangulo por la FUENTE UNICA
// del mallado, y cargas de planta por la MISMA fuente que el discretizador [2A].
import { limitesRectangulo, type PuntoPlano } from "./mallado";
import { CASE_CM_PLANTA, cargasPlantaDePano } from "./cargasPlanta";

// El CM corre sobre el modelo VIVO (sin la pasada de validaciones que precede al
// discretizador). Si una barra tiene seccion/material/planta no resolubles
// (p.ej. se borro una seccion en uso, o la planta de un pilar), `propiedadesDePilar`/
// `propiedadesDeViga` LANZAN (su contrato: bug interno tras validar). Aqui se OMITE
// su contribucion (contrato del modulo: "el CM no lanza") en vez de romper el render.
function propsSeguras(fn: () => PropiedadesBarra): PropiedadesBarra | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

// Resultado del CM de UNA planta. Coordenadas en sistema de obra (m); peso en kN.
export interface CentroMasaPlanta {
  plantaId: string;
  x: number; // m, sistema de obra (coordenadas de replanteo)
  y: number; // m
  pesoTotal: number; // kN (peso permanente total de la planta)
}

// Acumulador del centroide ponderado por peso: sum(w·x), sum(w·y), sum(w).
interface Acumulador {
  wx: number;
  wy: number;
  w: number;
}

// Anade una contribucion (peso `w` en kN ubicado en (x,y) de planta) al acumulador.
// Pesos no positivos (w<=0) no se acumulan: no aportan ni a numerador ni a peso total
// (defensa frente a secciones/cargas degeneradas; el caso normal siempre es w>0).
function acumular(acc: Acumulador, w: number, x: number, y: number): void {
  if (w <= 0) return;
  acc.wx += w * x;
  acc.wy += w * y;
  acc.w += w;
}

// ¿Es permanente la carga? "Permanente" = su hipotesis es de tipo permanente. El peso
// propio del CM se calcula del helper A·rho·L (no de las cargas FEM generadas, que ni
// siquiera viven en `modelo.cargas`), de modo que NO hay doble computo: una `Carga` de
// usuario nunca apunta a la hipotesis automatica de peso propio (invariante de dominio).
function esPermanente(carga: Carga, hipById: Map<string, Hipotesis>): boolean {
  const hip = hipById.get(carga.hipotesisId);
  return hip !== undefined && hip.tipo === "permanente";
}

// Planta a la que se atribuye un nudo, replicando la regla DOCUMENTADA del
// discretizador (`localizarNodoDeNudo` en discretizar.ts): un Nudo de Capa 1 no porta
// planta/cota (solo x,y en planta), y puede ser usado por vigas en plantas DISTINTAS;
// una carga sobre `ambito=nudoId` no porta planta (input ambiguo). Se resuelve de forma
// DETERMINISTA por la PRIMERA viga (orden canonico por id) que usa el nudo: su planta
// fija el nudo. Mismo desempate que el discretizador, para que el CM cuente la carga
// nodal en la misma planta que el solver le asignaria su nodo FEM.
function plantaDeNudo(modelo: Modelo, nudoId: string): string | undefined {
  // Orden total por id (no orden de insercion): determinismo byte a byte (CLAUDE.md §7).
  const vigasOrdenadas = [...modelo.vigas].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  for (const v of vigasOrdenadas) {
    if (v.nudoI === nudoId || v.nudoJ === nudoId) return v.plantaId;
  }
  return undefined;
}

// Centro de masas (CM) de UNA planta, en coordenadas de obra. Devuelve `null` cuando
// la planta no tiene masa permanente (sin pilares/vigas/cargas que contribuyan): asi
// el llamante distingue "sin masa" de un CM en el origen, y NUNCA se divide por cero.
//
// Terminos del centroide (todos ponderados por PESO, kN):
//  1) PESO PROPIO de pilares y vigas de la planta (A·rho·L via el helper), ubicado en
//     el centroide geometrico de la barra. SIEMPRE se incluye, independientemente del
//     flag `analisis.incluirPesoPropio`: la masa es FISICA; no desaparece porque se
//     elija no APLICARLA como carga en el analisis. (E5; cubierto por test.)
//  2) CARGAS LINEALES PERMANENTES sobre vigas de la planta: peso = q·L, en el centro
//     de la viga.
//  3) CARGAS NODALES PERMANENTES en nudos atribuidos a la planta (regla primera-viga):
//     peso = |valor|, en el (x,y) del nudo.
//
// Reparto de PILARES a plantas: un pilar conecta dos plantas (plantaInicial,
// plantaFinal). Su peso total (A·rho·L de TODO el pilar) se reparte a partes IGUALES
// entre los dos forjados que conecta: MEDIO pilar a cada forjado (criterio del plan).
// Si plantaInicial===plantaFinal (pilar degenerado de una planta), el pilar entero
// (las dos mitades) cae en esa planta. El (x,y) del pilar es constante en planta.
//
//  4) PAÑOS LOSA de la planta (F3.2, cierra T-cm-cargas-muertas): peso propio de la
//     losa (rho·t·A) + cargas muertas de la PLANTA (kN/m²·A, misma fuente unica que el
//     discretizador, solo el case permanente) + cargas superficiales PERMANENTES de
//     usuario (|q|·A), todo en el CENTROIDE del rectangulo del paño. La sobrecarga
//     de uso NO entra (el CM cuenta solo permanentes, como el resto de terminos).
export function calcularCentroMasaPlanta(
  modelo: Modelo,
  plantaId: string,
): CentroMasaPlanta | null {
  const planta = plantaPorId(modelo, plantaId);
  if (planta === undefined) return null;

  const acc: Acumulador = { wx: 0, wy: 0, w: 0 };
  const hipById = new Map<string, Hipotesis>(modelo.hipotesis.map((h) => [h.id, h]));

  // --- 1a) Peso propio de PILARES: masa TRIBUTARIA por planta -----------------------
  // [AUDITORIA M-7] Un pilar PASANTE (3+ plantas) se trocea por cada planta intermedia
  // que atraviesa (mismo criterio que `cotasDePilar` del discretizador): cada planta
  // que el pilar toca recibe LA MITAD DE CADA TRAMO ADYACENTE (masa tributaria). El
  // reparto anterior (medio pilar ENTERO a plantaInicial y medio a plantaFinal) daba
  // CERO a las intermedias y sobrepesaba los extremos: CM por planta (y excentricidad
  // CM<->CR) distorsionados. Para un pilar de UNA planta el resultado es identico al
  // anterior (un tramo: mitad a cada extremo). La suma por plantas conserva A·rho·L.
  // El (x,y) del pilar es su posicion en planta (vertical: constante en cota).
  for (const p of modelo.pilares) {
    // Si seccion/material/planta no resuelven, se OMITE su contribucion (el CM no lanza).
    const props = propsSeguras(() => propiedadesDePilar(modelo, p));
    if (props === null) continue;
    const { A, rho } = props;
    const longitudTributaria = tributariaDePilarEnPlanta(modelo, p, planta);
    if (longitudTributaria <= 0) continue;
    acumular(acc, A * rho * longitudTributaria, p.x, p.y);
  }

  // --- 1b) Peso propio de VIGAS de la planta --------------------------------------
  const vigas: Viga[] = vigasDePlanta(modelo, plantaId);
  for (const v of vigas) {
    // Si seccion/material/planta no resuelven, se OMITE (el CM no lanza).
    const props = propsSeguras(() => propiedadesDeViga(modelo, v));
    if (props === null) continue;
    const { A, rho, L } = props;
    const pesoViga = A * rho * L;
    const centro = centroDeViga(modelo, v);
    if (centro === null) continue; // nudos no resolubles (no deberia tras validar)
    acumular(acc, pesoViga, centro.x, centro.y);
  }

  // --- 2) Cargas lineales PERMANENTES sobre vigas de la planta --------------------
  // Indexa por id de viga de ESTA planta para atribuir la carga al centro de la viga.
  const vigaPorId = new Map<string, Viga>(vigas.map((v) => [v.id, v]));
  for (const c of modelo.cargas) {
    if (c.tipo !== "lineal") continue;
    if (!esPermanente(c, hipById)) continue;
    const v = vigaPorId.get(c.ambito);
    if (v === undefined) continue; // la viga no es de esta planta (o no es viga)
    const centro = centroDeViga(modelo, v);
    if (centro === null) continue;
    // Si la viga no resuelve seccion/material/planta, no podemos obtener su L: se
    // OMITE la contribucion de la carga (el CM no lanza).
    const props = propsSeguras(() => propiedadesDeViga(modelo, v));
    if (props === null) continue;
    const { L } = props;
    // Peso de la carga lineal = q·L (q en kN/m, magnitud; el signo de gravedad lo
    // decide el discretizador para el analisis, aqui solo importa la magnitud del peso).
    acumular(acc, Math.abs(c.valor) * L, centro.x, centro.y);
  }

  // --- 3) Cargas NODALES PERMANENTES (puntuales sobre nudo) ------------------------
  for (const c of modelo.cargas) {
    if (c.tipo !== "puntual") continue;
    if (!esPermanente(c, hipById)) continue;
    const nudo = nudoPorId(modelo, c.ambito);
    if (nudo === undefined) continue; // puntual sobre barra (no nodal) o ambito invalido
    // Atribuir a planta por la regla primera-viga (igual que el discretizador).
    if (plantaDeNudo(modelo, c.ambito) !== plantaId) continue;
    acumular(acc, Math.abs(c.valor), nudo.x, nudo.y);
  }

  // --- 4) PAÑOS LOSA de la planta (F3.2, cierra T-cm-cargas-muertas) ---------------
  // La masa de la losa existe de verdad en el calculo desde el acople: peso propio
  // SIEMPRE (como las barras: la masa es fisica, E5, independiente del flag), cargas
  // muertas de la planta por la fuente unica [2A] (solo el case PERMANENTE: la
  // sobrecarga de uso es variable y el CM cuenta permanentes) y superficiales
  // permanentes de usuario. Ubicado en el centroide del rectangulo (fuente unica
  // limitesRectangulo). Geometria/material no resolubles => se OMITE (el CM no lanza).
  for (const pano of modelo.panos) {
    if (pano.tipo !== "losa" || pano.plantaId !== plantaId) continue;
    const geo = geometriaDePano(modelo, pano);
    if (geo === null) continue;
    const material = getMaterial(pano.materialId);
    if (material !== undefined) {
      acumular(acc, material.peso * pano.espesor * geo.area, geo.cx, geo.cy);
    }
    for (const cg of cargasPlantaDePano(modelo, pano)) {
      if (cg.case !== CASE_CM_PLANTA) continue; // solo permanentes (uso = variable)
      acumular(acc, cg.presion * geo.area, geo.cx, geo.cy);
    }
    for (const c of modelo.cargas) {
      if (c.tipo !== "superficial" || c.ambito !== pano.id) continue;
      if (!esPermanente(c, hipById)) continue;
      acumular(acc, Math.abs(c.valor) * geo.area, geo.cx, geo.cy);
    }
  }

  // --- 5) PAÑOS UNIDIRECCIONALES de la planta (F3, corte "unidireccional") ----------
  // Espejo del termino losa (el de losa NO cambia): peso propio TABULADO (pano.pesoPropio,
  // DP2 — NO rho·t: no hay losa maciza) + cargas muertas de la PLANTA (case permanente,
  // fuente unica [2A]) + superficiales permanentes de usuario, todo en el CENTROIDE del
  // rectangulo. La sobrecarga de uso NO entra (el CM cuenta permanentes). `pesoPropio`
  // ausente (paño a medio definir; el CM corre sobre el modelo VIVO sin validar) => 0,
  // no aporta (coherente con DP2 y con `acumular` que ignora w<=0).
  for (const pano of modelo.panos) {
    if (pano.tipo !== "unidireccional" || pano.plantaId !== plantaId) continue;
    const geo = geometriaDePano(modelo, pano);
    if (geo === null) continue;
    if (pano.pesoPropio !== undefined && Number.isFinite(pano.pesoPropio)) {
      acumular(acc, pano.pesoPropio * geo.area, geo.cx, geo.cy);
    }
    for (const cg of cargasPlantaDePano(modelo, pano)) {
      if (cg.case !== CASE_CM_PLANTA) continue; // solo permanentes (uso = variable)
      acumular(acc, cg.presion * geo.area, geo.cx, geo.cy);
    }
    for (const c of modelo.cargas) {
      if (c.tipo !== "superficial" || c.ambito !== pano.id) continue;
      if (!esPermanente(c, hipById)) continue;
      acumular(acc, Math.abs(c.valor) * geo.area, geo.cx, geo.cy);
    }
  }

  // --- 6) MUROS/pantallas que tocan la planta (F3, muros) --------------------------
  // Espejo del termino de PILARES (1a): masa tributaria por planta = rho·t·L por la
  // ALTURA tributaria (mitad de cada tramo adyacente a la cota; mismo troceo por
  // plantas y mismo desempate min-id que tributariaDePilarEnPlanta — el helper es
  // COMPARTIDO: un muro es un "elemento vertical entre dos plantas" como el pilar).
  // Ubicada en el punto MEDIO del segmento del eje. Sin esto, la excentricidad
  // CM<->CR de un edificio con pantallas — el punto del corte — saldria falsa.
  // Material/geometria no resolubles => se OMITE (el CM no lanza).
  for (const muro of modelo.muros) {
    const material = getMaterial(muro.materialId);
    if (material === undefined) continue;
    const largo = Math.hypot(muro.x2 - muro.x1, muro.y2 - muro.y1);
    if (!(largo > 0)) continue;
    const alturaTributaria = tributariaDePilarEnPlanta(modelo, muro, planta);
    if (alturaTributaria <= 0) continue;
    acumular(
      acc,
      material.peso * muro.espesor * largo * alturaTributaria,
      (muro.x1 + muro.x2) / 2,
      (muro.y1 + muro.y2) / 2,
    );
  }

  // Sin masa permanente en la planta => null (sin division por cero). El llamante
  // (panel de UI) lo presenta como "Sin masa en esta planta".
  if (acc.w <= 0) return null;

  return {
    plantaId,
    x: acc.wx / acc.w,
    y: acc.wy / acc.w,
    pesoTotal: acc.w,
  };
}

// Area y centroide del rectangulo de un paño en coordenadas de OBRA, por la FUENTE
// UNICA del criterio geometrico (limitesRectangulo del mallado). null si el perimetro
// no resuelve o la geometria no es un rectangulo valido: el CM omite la contribucion
// (no lanza), igual que con una barra de seccion irresoluble.
function geometriaDePano(
  modelo: Modelo,
  pano: Pano,
): { area: number; cx: number; cy: number } | null {
  if (pano.perimetro.length !== 4) return null;
  const puntos: PuntoPlano[] = [];
  for (const nudoId of pano.perimetro) {
    const n = nudoPorId(modelo, nudoId);
    if (n === undefined) return null;
    puntos.push({ x: n.x, y: n.y });
  }
  const l = limitesRectangulo(puntos);
  if ("codigo" in l) return null;
  return {
    area: (l.xMax - l.xMin) * (l.yMax - l.yMin),
    cx: (l.xMin + l.xMax) / 2,
    cy: (l.yMin + l.yMax) / 2,
  };
}

// Centro geometrico de una viga en coordenadas de OBRA (punto medio de sus dos nudos
// en planta). Devuelve null si algun nudo no se resuelve (no deberia ocurrir tras las
// validaciones del discretizador, pero el CM no lanza: omite la contribucion).
function centroDeViga(modelo: Modelo, v: Viga): { x: number; y: number } | null {
  const ni = nudoPorId(modelo, v.nudoI);
  const nj = nudoPorId(modelo, v.nudoJ);
  if (ni === undefined || nj === undefined) return null;
  return { x: (ni.x + nj.x) / 2, y: (ni.y + nj.y) / 2 };
}

// --- [AUDITORIA M-7] Altura tributaria de un ELEMENTO VERTICAL en una planta -------
// Longitud vertical del elemento `p` (pilar O muro: cualquier cosa con
// plantaInicial/plantaFinal) que tributa a `planta`: la mitad de cada TRAMO adyacente
// a la cota de la planta. Los tramos son los del troceo del discretizador (una cota
// por cada planta cuya cota cae dentro de [cMin, cMax], espejo de `cotasDePilar` en
// discretizar.ts — y de las filas mandatorias del mallado de muro): asi el CM reparte
// la masa por los MISMOS tramos que el solver usa.
//
// DESEMPATE de cotas compartidas (dos plantas a la MISMA cota): la tributaria de una
// cota se atribuye a UNA sola planta — la misma que elegiria `plantaDeCotaPilar` del
// discretizador (min por id; en v4 ya no hay preferencia por grupo) — para no
// contarla dos veces y para que el CM atribuya como `nodoFEMAPlanta`. Devuelve 0 si
// `planta` no toca el elemento o pierde el desempate.
function tributariaDePilarEnPlanta(
  modelo: Modelo,
  p: { plantaInicial: string; plantaFinal: string },
  planta: { id: string; cota: number },
): number {
  const pi = plantaPorId(modelo, p.plantaInicial);
  const pf = plantaPorId(modelo, p.plantaFinal);
  if (pi === undefined || pf === undefined) return 0;
  const cMin = Math.min(pi.cota, pf.cota);
  const cMax = Math.max(pi.cota, pf.cota);
  const c = planta.cota;
  if (c < cMin || c > cMax) return 0;

  // Cotas del troceo (espejo de cotasDePilar): extremos + intermedias, ascendentes.
  const cotasSet = new Set<number>([cMin, cMax]);
  for (const pl of modelo.plantas) {
    if (pl.cota > cMin && pl.cota < cMax) cotasSet.add(pl.cota);
  }
  const cotas = [...cotasSet].sort((a, b) => a - b);
  const idx = cotas.indexOf(c);
  if (idx === -1) return 0; // la planta no aporta cota al troceo de este pilar

  // Desempate: entre las plantas a la cota `c`, gana la de menor id (mismo criterio
  // que plantaDeCotaPilar; en v4 sin preferencia por grupo).
  const enCota = modelo.plantas.filter((pl) => pl.cota === c);
  const ganadora = enCota.reduce(
    (min, pl) => (pl.id < min ? pl.id : min),
    enCota[0]?.id ?? planta.id,
  );
  if (ganadora !== planta.id) return 0;

  // Mitad del tramo inferior + mitad del superior (si existen).
  const abajo = idx > 0 ? (c - cotas[idx - 1]) / 2 : 0;
  const arriba = idx < cotas.length - 1 ? (cotas[idx + 1] - c) / 2 : 0;
  return abajo + arriba;
}
