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

import type { Modelo, Viga, Carga, Hipotesis } from "../dominio";
import {
  plantaPorId,
  nudoPorId,
  vigasDePlanta,
} from "../dominio";
import { propiedadesDePilar, propiedadesDeViga } from "./propiedadesBarra";
import type { PropiedadesBarra } from "./propiedadesBarra";

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
// OMISION DELIBERADA — `Grupo.cargasMuertas` (kN/m²): NO se incluye. Sin paños (F3) no
// hay area tributaria con la que convertir kN/m² en peso, asi que no se puede ubicar
// ni ponderar. Cuando existan paños el CM las repartira por area. Ver TODO
// `T-cm-cargas-muertas`.
export function calcularCentroMasaPlanta(
  modelo: Modelo,
  plantaId: string,
): CentroMasaPlanta | null {
  const planta = plantaPorId(modelo, plantaId);
  if (planta === undefined) return null;

  const acc: Acumulador = { wx: 0, wy: 0, w: 0 };
  const hipById = new Map<string, Hipotesis>(modelo.hipotesis.map((h) => [h.id, h]));

  // --- 1a) Peso propio de PILARES (medio pilar a cada forjado que conecta) ---------
  for (const p of modelo.pilares) {
    const conectaInicial = p.plantaInicial === plantaId;
    const conectaFinal = p.plantaFinal === plantaId;
    if (!conectaInicial && !conectaFinal) continue;
    // Peso total del pilar (A·rho·L de todo el elemento, no de un tramo). El helper
    // resuelve seccion+material+longitud completa (arranque->cabeza). Si no resuelve
    // (seccion/material/planta colgando), se OMITE su contribucion (el CM no lanza).
    const props = propsSeguras(() => propiedadesDePilar(modelo, p));
    if (props === null) continue;
    const { A, rho, L } = props;
    const pesoTotalPilar = A * rho * L;
    // Medio a cada forjado conectado. Si arranca y termina en la MISMA planta
    // (degenerado), ambas mitades caen aqui => el pilar entero. El (x,y) del pilar es
    // su posicion en planta (vertical: constante en cota).
    let fraccion = 0;
    if (conectaInicial) fraccion += 0.5;
    if (conectaFinal) fraccion += 0.5;
    acumular(acc, pesoTotalPilar * fraccion, p.x, p.y);
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

// Centro geometrico de una viga en coordenadas de OBRA (punto medio de sus dos nudos
// en planta). Devuelve null si algun nudo no se resuelve (no deberia ocurrir tras las
// validaciones del discretizador, pero el CM no lanza: omite la contribucion).
function centroDeViga(modelo: Modelo, v: Viga): { x: number; y: number } | null {
  const ni = nudoPorId(modelo, v.nudoI);
  const nj = nudoPorId(modelo, v.nudoJ);
  if (ni === undefined || nj === undefined) return null;
  return { x: (ni.x + nj.x) / 2, y: (ni.y + nj.y) / 2 };
}
