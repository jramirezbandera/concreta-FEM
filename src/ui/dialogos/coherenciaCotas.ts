// Deteccion de INCOHERENCIAS de cotas/alturas entre plantas consecutivas de un
// grupo (auditoria UI/UX, D16). PURO: sin React, sin stores, sin IO. Recibe la lista
// de plantas de UN grupo y devuelve los avisos NO bloqueantes a mostrar. Se testea en
// Node/jsdom sin render.
//
// REGLA: dentro de un grupo, ordenadas por cota ascendente, la cabeza de una planta
// (cota_i + altura_i) DEBERIA coincidir con el arranque (cota) de la siguiente. Si no
// coincide hay un HUECO (la siguiente arranca mas arriba) o un SOLAPE (arranca mas
// abajo, dentro de la planta previa). No es un error: cotas y alturas son campos
// INDEPENDIENTES en el modelo (el usuario puede modelar retranqueos, dobles alturas o
// forjados intermedios a proposito). Por eso el aviso es informativo (--warning,
// role=status), no bloquea el calculo ni el commit.
//
// UNIDADES (CLAUDE.md §14): cotas y alturas ya estan en metros (interno = presentacion
// de geometria). Aqui no se convierte nada; solo se comparan y se formatean para el
// texto del aviso.

import type { Planta } from "../../dominio";

// Tolerancia de comparacion de cotas (m). Absorbe el ruido de coma flotante al sumar
// cota+altura (p. ej. 0.30 + 2.70 = 2.9999999999999996): por debajo de esto se
// consideran coincidentes y NO se avisa. 1 mm es muy inferior al error de modelado
// relevante en obra y muy superior al epsilon de doble precision.
const TOL_COTA_M = 1e-3;

// Un aviso de incoherencia entre dos plantas consecutivas. `plantaInferiorId` es la
// planta de menor cota del par (la que "termina"); se expone el id para que la UI
// pueda anclar el aviso si algun dia lo necesita (hoy se muestra agregado).
export interface AvisoCoherencia {
  plantaInferiorId: string;
  // Texto en lenguaje de obra, ya formateado, listo para pintar.
  mensaje: string;
}

// Formatea una cota en metros con signo explicito y 2 decimales, estilo "+3.00 m" /
// "-1.50 m". El signo `+` ayuda a leer las cotas relativas al origen (cota 0 = "+0.00").
// Punto decimal (no coma) para lectura tecnica de cotas, consistente con el gizmo/CAD.
function formatearCota(cotaM: number): string {
  const signo = cotaM < 0 ? "-" : "+";
  return `${signo}${Math.abs(cotaM).toFixed(2)} m`;
}

// Detecta las incoherencias de cotas/alturas de las plantas de UN grupo. Devuelve un
// aviso POR PAR consecutivo incoherente (ordenadas por cota ascendente): a lo sumo
// n-1 avisos para n plantas. Una sola planta (o cero) nunca produce aviso.
//
// Se comparan pares ADYACENTES en el orden de cota: la cabeza de la inferior
// (cota+altura) contra el arranque (cota) de la inmediata superior. Un salto de dos
// plantas (hueco grande) se refleja en el par que lo contiene, no se duplica.
export function detectarIncoherenciasCotas(plantas: Planta[]): AvisoCoherencia[] {
  // Ordena por cota ascendente (de abajo arriba). Copia: no muta la entrada.
  const ordenadas = [...plantas].sort((a, b) => a.cota - b.cota);
  const avisos: AvisoCoherencia[] = [];
  for (let i = 0; i < ordenadas.length - 1; i++) {
    const inferior = ordenadas[i];
    const superior = ordenadas[i + 1];
    const cabezaInferior = inferior.cota + inferior.altura;
    // Coincidencia dentro de tolerancia: sin aviso.
    if (Math.abs(cabezaInferior - superior.cota) <= TOL_COTA_M) continue;
    avisos.push({
      plantaInferiorId: inferior.id,
      mensaje:
        `La planta "${inferior.nombre}" termina a ${formatearCota(cabezaInferior)} ` +
        `pero "${superior.nombre}" arranca a ${formatearCota(superior.cota)}: ` +
        `revisa cotas y alturas.`,
    });
  }
  return avisos;
}
