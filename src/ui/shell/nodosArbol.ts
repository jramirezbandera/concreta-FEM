// arbolObra: derivacion PURA del arbol de obra del Sidebar (UX-3.2, spec §3.3
// "Arbol de obra: jerarquia plantas -> elementos"). Sin React ni stores: recibe el
// Modelo y devuelve nodos listos para pintar; testeable en Node.
//
// Un pilar PASANTE (tramo que abarca varias plantas) aparece bajo CADA planta de su
// tramo (igual que lo dibuja la geometria); dentro de una planta cada id aparece
// una sola vez (pilaresDePlanta ya lo garantiza). Plantas de mayor a menor cota
// (orden CYPECAD descendente, como el resto del Sidebar).
import type { Modelo } from "../../dominio";
import { panosDePlanta, pilaresDePlanta, vigasDePlanta } from "../../dominio";

export interface NodoElemento {
  id: string;
  tipo: "pilar" | "viga" | "pano";
  nombre: string;
}

export interface NodoPlanta {
  id: string;
  nombre: string;
  cota: number;
  elementos: NodoElemento[];
}

export function derivarArbol(modelo: Modelo): NodoPlanta[] {
  return modelo.plantas
    .slice()
    .sort((a, b) => b.cota - a.cota)
    .map((planta) => ({
      id: planta.id,
      nombre: planta.nombre,
      cota: planta.cota,
      // Orden estable por tipo (pilares, vigas, paños), como las capas del lienzo.
      elementos: [
        ...pilaresDePlanta(modelo, planta.id).map((p) => ({
          id: p.id,
          tipo: "pilar" as const,
          nombre: p.nombre,
        })),
        ...vigasDePlanta(modelo, planta.id).map((v) => ({
          id: v.id,
          tipo: "viga" as const,
          nombre: v.nombre,
        })),
        ...panosDePlanta(modelo, planta.id).map((f) => ({
          id: f.id,
          tipo: "pano" as const,
          nombre: f.nombre,
        })),
      ],
    }));
}
