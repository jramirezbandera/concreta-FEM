// modeloCalculoGeometria: proyeccion PURA del ModeloFEM (Capa 2) al espacio de ESCENA
// para el overlay "Ver modelo de calculo" (F2c). SIN React/three: testeable en Node.
// Estatica (no hay animacion: el modelo de calculo no vibra). Usa el helper de ejes
// compartido (femAEscena): FEM Y-up -> escena Z-up.
//
// VISTA SIMPLIFICADA (decision F2c, Issue 7-B): los apoyos se clasifican en empotrado /
// articulado / otro (combinaciones atipicas de 6 GDL caen en "otro"); los releases se
// marcan en el extremo liberado. La fidelidad 6-GDL completa queda como TODO
// (T-modelo-calculo-6dof); el panel rotula "vista simplificada" para no enganar.
import type { ModeloFEM, NodoFEM } from "../../discretizador";
import { femAEscena, type Vec3Escena } from "./ejesEscena";

// Tipo de apoyo por sus GDL restringidos (para elegir el GLIFO, no solo el color).
export type TipoApoyo = "empotrado" | "articulado" | "otro";

export interface SegmentoCalc {
  i: Vec3Escena;
  j: Vec3Escena;
  conRelease: boolean; // la barra tiene algun extremo liberado (color distinto)
}

export interface ApoyoCalc {
  p: Vec3Escena;
  tipo: TipoApoyo;
}

export interface GeometriaModeloCalculo {
  barras: SegmentoCalc[];
  nudos: Vec3Escena[];
  apoyos: ApoyoCalc[];
  releases: Vec3Escena[]; // posicion de cada extremo liberado
  conteos: { nudos: number; barras: number; apoyos: number };
}

const VACIO: GeometriaModeloCalculo = {
  barras: [],
  nudos: [],
  apoyos: [],
  releases: [],
  conteos: { nudos: 0, barras: 0, apoyos: 0 },
};

// Clasifica un apoyo por sus 6 GDL: empotrado (todo restringido), articulado
// (traslaciones restringidas, giros libres) u "otro" (cualquier combinacion atipica:
// rodillo, empotramiento parcial...). La vista es simplificada (Issue 7-B).
function clasificarApoyo(s: {
  DX: boolean;
  DY: boolean;
  DZ: boolean;
  RX: boolean;
  RY: boolean;
  RZ: boolean;
}): TipoApoyo {
  const trans = s.DX && s.DY && s.DZ;
  const giros = s.RX && s.RY && s.RZ;
  const sinGiros = !s.RX && !s.RY && !s.RZ;
  if (trans && giros) return "empotrado";
  if (trans && sinGiros) return "articulado";
  return "otro";
}

function aEscena(n: NodoFEM): Vec3Escena {
  return femAEscena(n.x, n.y, n.z);
}

export function modeloCalculoGeometria(
  modeloFEM: ModeloFEM | null,
): GeometriaModeloCalculo {
  if (!modeloFEM) return VACIO;

  const nodoPorNombre = new Map(modeloFEM.nodes.map((n) => [n.name, n]));

  const nudos: Vec3Escena[] = modeloFEM.nodes.map(aEscena);

  const barras: SegmentoCalc[] = [];
  const releases: Vec3Escena[] = [];
  for (const m of modeloFEM.members) {
    const ni = nodoPorNombre.get(m.i);
    const nj = nodoPorNombre.get(m.j);
    if (!ni || !nj) continue; // referencia rota: se omite (no deberia ocurrir)
    const conRelease = m.releases !== null;
    barras.push({ i: aEscena(ni), j: aEscena(nj), conRelease });
    if (m.releases) {
      // releases = [Dxi..Rzi (0-5), Dxj..Rzj (6-11)]: si algun flag del extremo esta
      // liberado, marcamos ese extremo.
      const iLiberado = m.releases.slice(0, 6).some(Boolean);
      const jLiberado = m.releases.slice(6, 12).some(Boolean);
      if (iLiberado) releases.push(aEscena(ni));
      if (jLiberado) releases.push(aEscena(nj));
    }
  }

  const apoyos: ApoyoCalc[] = [];
  for (const s of modeloFEM.supports) {
    const n = nodoPorNombre.get(s.node);
    if (!n) continue;
    apoyos.push({ p: aEscena(n), tipo: clasificarApoyo(s) });
  }

  return {
    barras,
    nudos,
    apoyos,
    releases,
    conteos: { nudos: nudos.length, barras: barras.length, apoyos: apoyos.length },
  };
}
