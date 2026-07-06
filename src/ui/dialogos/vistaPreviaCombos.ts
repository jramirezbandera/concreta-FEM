// Vista previa de las COMBINACIONES que se generaran para la obra (auditoria UI/UX,
// D18). PURO: sin React, sin stores, sin IO. Deriva el texto legible a partir de los
// combos REALES de `generarCombos` (src/discretizador/combinaciones.ts), de modo que
// una correccion de coeficientes en la biblioteca se refleje aqui sin tocar copy.
//
// Los coeficientes NO se escriben a mano: salen de `combo.factors` (mapa
// hipotesisId -> coeficiente). El SIMBOLO de cada termino (G para permanentes, Q para
// variables) sale del TIPO de la hipotesis en el modelo, no de un literal. Asi el
// texto "1,35·G + 1,50·Q" es un reflejo de los datos, no una afirmacion independiente
// que pueda divergir del calculo.
//
// UNIDADES (CLAUDE.md §14): no aplica; los factores gamma son adimensionales.

import type { Modelo } from "../../dominio";
// Import directo al modulo puro (no al barrel del discretizador, que arrastra el resto
// de la Capa 2): solo necesitamos generarCombos, que es puro y ligero.
import { generarCombos } from "../../discretizador/combinaciones";
// Cases SINTETICOS de las cargas de planta (F3.4; antes de grupo, F3.2 D-1): no son
// Hipotesis del modelo, asi que se les inyecta su tipo aqui para que la formula los
// recoja (sin esto, formularCombo los ignoraria y la vista previa MENTIRIA por omision).
import { CASE_CM_PLANTA, CASE_USO_PLANTA } from "../../discretizador/cargasPlanta";

// Una linea de la vista previa: nombre largo legible + formula ya formateada.
export interface LineaCombo {
  // Nombre del combo del solver ("ELU"/"ELS"): key de React estable.
  nombre: string;
  // Etiqueta larga en lenguaje de obra ("E.L.U. (resistencia)").
  etiqueta: string;
  // Formula ponderada ("1,35·G + 1,50·Q") o "—" si el combo no tiene terminos (modelo
  // sin hipotesis con cargas).
  formula: string;
}

// Etiqueta larga de un combo por su nombre. Para combos conocidos del MVP se enriquece
// a lenguaje de obra; cualquier otro nombre futuro se muestra tal cual (sin inventar).
function etiquetaCombo(nombre: string): string {
  switch (nombre) {
    case "ELU":
      return "E.L.U. (resistencia)";
    case "ELS":
      return "E.L.S. (servicio)";
    default:
      return nombre;
  }
}

// Simbolo de una hipotesis segun su tipo: permanente -> "G", variable -> "Q" (notacion
// CTE DB-SE). El peso propio automatico es permanente, asi que cae en "G" (correcto).
function simboloTipo(tipo: "permanente" | "variable"): "G" | "Q" {
  return tipo === "permanente" ? "G" : "Q";
}

// Coeficiente gamma con coma decimal y 2 decimales fijos ("1,35", "1,50", "1,00").
function formatearFactor(factor: number): string {
  return factor.toLocaleString("es-ES", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Construye la formula ponderada de UN combo a partir de sus `factors` (mapa
// hipotesisId -> coeficiente) y de los tipos de las hipotesis del modelo. Agrupa los
// terminos con el MISMO (coeficiente, simbolo) para no repetir "1,35·G + 1,35·G": en
// F1 todas las permanentes comparten gamma_G y todas las variables gamma_Q, asi que la
// formula colapsa a "1,35·G + 1,50·Q". El orden de terminos es G antes que Q (lectura
// habitual de la combinacion) y, dentro de cada simbolo, por coeficiente ascendente.
function formularCombo(
  factors: Record<string, number>,
  tipoPorHipotesis: Map<string, "permanente" | "variable">,
): string {
  // Conjunto de terminos unicos (simbolo, coeficiente). La clave evita duplicados.
  const terminos = new Map<string, { simbolo: "G" | "Q"; factor: number }>();
  for (const [hipotesisId, factor] of Object.entries(factors)) {
    const tipo = tipoPorHipotesis.get(hipotesisId);
    // Un factor sobre una hipotesis inexistente en el modelo no deberia ocurrir
    // (generarCombos parte de modelo.hipotesis); si ocurriera, se ignora ese termino.
    if (tipo === undefined) continue;
    const simbolo = simboloTipo(tipo);
    terminos.set(`${simbolo}|${factor}`, { simbolo, factor });
  }
  if (terminos.size === 0) return "—";
  const ordenados = [...terminos.values()].sort((a, b) => {
    // G antes que Q.
    if (a.simbolo !== b.simbolo) return a.simbolo === "G" ? -1 : 1;
    return a.factor - b.factor;
  });
  return ordenados
    .map((t) => `${formatearFactor(t.factor)}·${t.simbolo}`)
    .join(" + ");
}

// Vista previa de los combos del modelo: una linea por combo real de generarCombos, con
// su etiqueta larga y su formula derivada de los factores. Refleja las hipotesis reales
// (tipos y presencia del peso propio segun `incluirPesoPropio`, que generarCombos ya
// respeta).
export function vistaPreviaCombos(modelo: Modelo): LineaCombo[] {
  const tipoPorHipotesis = new Map<string, "permanente" | "variable">(
    modelo.hipotesis.map((h) => [h.id, h.tipo]),
  );
  // Cases sinteticos de planta (F3.4; antes de grupo): cargasMuertas = G,
  // sobrecargaUso = Q. Solo aparecen en `factors` cuando algun paño los consume
  // (generarCombos); aqui basta con saber su tipo. Se colapsan con el resto de
  // terminos del mismo (simbolo, factor): la formula sigue leyendo "1,35·G + 1,50·Q".
  tipoPorHipotesis.set(CASE_CM_PLANTA, "permanente");
  tipoPorHipotesis.set(CASE_USO_PLANTA, "variable");
  return generarCombos(modelo).map((combo) => ({
    nombre: combo.name,
    etiqueta: etiquetaCombo(combo.name),
    formula: formularCombo(combo.factors, tipoPorHipotesis),
  }));
}
