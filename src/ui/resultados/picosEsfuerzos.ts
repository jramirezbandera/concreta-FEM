// picosEsfuerzos: derivacion PURA de los rotulos de pico (max y min) del overlay de
// esfuerzos, agregados POR ELEMENTO DE OBRA via trazabilidad. SIN React/R3F/three:
// testeable en Node.
//
// POR QUE por elemento y no por member FEM: el acople paño<->portico (F3.2) trocea
// una viga en muchos members consecutivos; rotular el pico de cada member seria
// ruido y jerga FEM encubierta. Se agrega: VIGA = max/min sobre la concatenacion de
// sus members; PILAR = por pilar entero (el detalle por planta ya vive en
// PanelDiagramas, D20); PAÑO unidireccional = max/min entre TODAS sus viguetas (2
// rotulos por paño, no 2 por vigueta: anti-saturacion).
//
// Los escalares del contrato (max_moment_z...) NO bastan (falta el axil y el minimo
// de cortante): los picos se derivan de los ARRAYS en TS (20 estaciones/member,
// barato). Con n_points finito el pico real puede caer entre estaciones: mismo
// trade-off aceptado en PanelDiagramas. Los valores se rotulan en el convenio de
// PRESENTACION (convencionEsfuerzos: traccion +, vano +), igual que la cinta.
//
// ANTI-RUIDO: no se rotula un pico con |v| < UMBRAL_RELATIVO·vMaxAbs global
// (elementos casi descargados); si max y min del elemento coinciden en valor y
// posicion (diagrama constante), se emite UN solo rotulo.
import type { ModeloFEM, Trazabilidad } from "../../discretizador";
import type { ResultadosCalculo } from "../../solver";
import type { MagnitudEsfuerzo } from "../../estado";
import { femAEscena, dispFemAEscena, type Vec3Escena } from "../viewport/ejesEscena";
import { ejeLocalY } from "./ejesLocalesFEM";
import { CAMPO_POR_MAGNITUD, UNIDAD_POR_MAGNITUD } from "./esfuerzosGeometria";
import { SIGNO_UI, LADO_DIBUJO } from "./convencionEsfuerzos";

// Fraccion del |v| maximo global por debajo de la cual un pico no se rotula.
const UMBRAL_RELATIVO = 0.005;

// Un rotulo de pico listo para posicionar: el overlay lo coloca en
//   base + ejeY·(valor·escalaTotal) + ejeY·signo·margen
// (la posicion final depende de la escala, que cambia con el slider; por eso aqui
// viajan base/ejeY/valor y no una posicion cerrada: los picos NO se recalculan al
// mover el slider).
export interface PicoEsfuerzo {
  elementoId: string; // id de obra (viga/pilar/paño); solo trazabilidad interna
  texto: string; // "-42.3 kN·m" (valor + unidad, 1 decimal)
  valor: number; // crudo (kN | kN·m)
  signo: 1 | -1;
  base: Vec3Escena; // punto sobre la barra donde ocurre el pico (escena)
  ejeY: Vec3Escena; // eje de la ordenada del member del pico (escena, unitario)
}

// Formatea el valor de un pico (1 decimal + unidad). Los valores YA vienen en
// unidades finales del contrato (kN / kN·m): esto es formato, no conversion.
export function fmtPico(valor: number, magnitud: MagnitudEsfuerzo): string {
  return `${valor.toFixed(1)} ${UNIDAD_POR_MAGNITUD[magnitud]}`;
}

// Pico candidato interno: valor + donde (member y x local).
interface Candidato {
  v: number;
  member: string;
  x: number;
}

// Deriva los rotulos de pico para una combinacion y magnitud. Nunca lanza; [] ante
// entradas nulas o sin datos.
export function picosEsfuerzos(
  modeloFEM: ModeloFEM | null,
  resultados: ResultadosCalculo | null,
  trazabilidad: Trazabilidad | null,
  combo: string | null,
  magnitud: MagnitudEsfuerzo,
): PicoEsfuerzo[] {
  if (!modeloFEM || !resultados || !trazabilidad || !combo) return [];

  const campo = CAMPO_POR_MAGNITUD[magnitud];
  // Signo crudo->presentacion (traccion +, vano +): MISMO flip que la geometria
  // (convencionEsfuerzos). Los rotulos muestran el valor presentado.
  const signoUI = SIGNO_UI[campo];
  const memberPorNombre = new Map(modeloFEM.members.map((m) => [m.name, m]));
  const nodoPorNombre = new Map(modeloFEM.nodes.map((n) => [n.name, n]));

  // max/min de UN elemento sobre la concatenacion de sus members. null si ningun
  // member del elemento tiene resultados para el combo.
  const extremosDe = (
    members: readonly string[],
  ): { max: Candidato; min: Candidato } | null => {
    let max: Candidato | null = null;
    let min: Candidato | null = null;
    for (const nombre of members) {
      const diagrama = resultados.barras[nombre]?.[combo]?.[campo];
      if (!diagrama) continue;
      const [xs, vs] = diagrama;
      if (!xs || !vs) continue;
      for (let k = 0; k < vs.length; k++) {
        const v = vs[k]! * signoUI;
        const x = xs[k] ?? 0;
        if (max === null || v > max.v) max = { v, member: nombre, x };
        if (min === null || v < min.v) min = { v, member: nombre, x };
      }
    }
    return max && min ? { max, min } : null;
  };

  // Recorre los tres mapas de trazabilidad (viga, pilar, paño unidireccional).
  const porElemento: Array<{ id: string; extremos: { max: Candidato; min: Candidato } }> =
    [];
  const grupos: Array<Record<string, string[]>> = [
    trazabilidad.vigaAMembers,
    trazabilidad.pilarAMembers,
    trazabilidad.panoAMembers ?? {},
  ];
  let vMaxAbs = 0;
  for (const grupo of grupos) {
    for (const [id, members] of Object.entries(grupo)) {
      const extremos = extremosDe(members);
      if (!extremos) continue;
      vMaxAbs = Math.max(vMaxAbs, Math.abs(extremos.max.v), Math.abs(extremos.min.v));
      porElemento.push({ id, extremos });
    }
  }
  if (vMaxAbs <= 0) return [];
  const umbral = UMBRAL_RELATIVO * vMaxAbs;

  // Posicion base + eje de la ordenada del candidato. null si el member no se puede
  // resolver (referencia rota o barra degenerada): ese rotulo se omite. El eje va
  // multiplicado por LADO_DIBUJO (mismo eje que la cinta: el rotulo cae sobre ella).
  const lado = LADO_DIBUJO[magnitud];
  const situar = (c: Candidato): { base: Vec3Escena; ejeY: Vec3Escena } | null => {
    const member = memberPorNombre.get(c.member);
    if (!member) return null;
    const ni = nodoPorNombre.get(member.i);
    const nj = nodoPorNombre.get(member.j);
    if (!ni || !nj) return null;
    const eje = ejeLocalY(ni, nj, member.rotation);
    if (!eje) return null;
    // t = x/L con L = longitud geometrica (los *_array() muestrean 0..L).
    const L = Math.hypot(nj.x - ni.x, nj.y - ni.y, nj.z - ni.z);
    const t = L > 0 ? Math.min(1, Math.max(0, c.x / L)) : 0;
    return {
      base: femAEscena(
        ni.x + t * (nj.x - ni.x),
        ni.y + t * (nj.y - ni.y),
        ni.z + t * (nj.z - ni.z),
      ),
      // El `+ 0` normaliza el -0 de JS (0 × -1) a +0, como en esfuerzosGeometria.
      ejeY: dispFemAEscena(eje[0] * lado + 0, eje[1] * lado + 0, eje[2] * lado + 0),
    };
  };

  const picos: PicoEsfuerzo[] = [];
  const emite = (id: string, c: Candidato): void => {
    if (Math.abs(c.v) < umbral) return; // pico irrelevante: no se rotula
    const pos = situar(c);
    if (!pos) return;
    picos.push({
      elementoId: id,
      texto: fmtPico(c.v, magnitud),
      valor: c.v,
      signo: c.v >= 0 ? 1 : -1,
      base: pos.base,
      ejeY: pos.ejeY,
    });
  };

  for (const { id, extremos } of porElemento) {
    const { max, min } = extremos;
    emite(id, max);
    // Diagrama constante (max y min coinciden en valor y posicion): un solo rotulo.
    const duplicado = max.v === min.v && max.member === min.member && max.x === min.x;
    if (!duplicado) emite(id, min);
  }

  return picos;
}
