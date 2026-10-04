/**
 * Propiedades de las secciones físicas para el compilador: la `SeccionBarra` del motor (con
 * `seccion3D()`), el peso por metro, el canto y la huella en planta de un pilar.
 */
import type { SeccionBarra } from "../elementos/barra.ts";
import { acero, circular, hormigon, perfilI, rectangular, seccionT, type Material as MaterialElastico } from "../secciones/seccion3D.ts";
import type { Material, Seccion } from "./fisico.ts";

/** Huella del pilar en sus ejes locales (b según y, h según z) o círculo de diámetro D. */
export type FormaHuella = { tipo: "rectangulo"; b: number; h: number } | { tipo: "circulo"; D: number };

export interface SeccionCompilada {
  barra: SeccionBarra;
  /** Peso por metro, kN/m (γ·A). */
  peso: number;
  /** Canto h (según z local), m; 0 si no se conoce. */
  canto: number;
  /** Huella en planta si es la sección de un pilar; null si no se conoce. */
  huella: FormaHuella | null;
  /** Tipo de material (para los modificadores por material, D4). */
  material: Material["tipo"];
}

export function materialElastico(m: Material): { elastico: MaterialElastico; peso: number } {
  switch (m.tipo) {
    case "hormigon":
      return { elastico: hormigon(m.fck, m.nu ?? 0.2), peso: m.peso ?? 25 };
    case "acero":
      return { elastico: acero(m.E ?? 210000), peso: m.peso ?? 78.5 };
    case "general":
      return { elastico: { E: m.E, G: m.G }, peso: m.peso };
  }
}

/** Propiedades de una sección ya validada. Sin `cortante`, quita las áreas de cortante. */
export function compilarSeccion(s: Seccion, m: Material, cortante: boolean): SeccionCompilada {
  const { elastico, peso } = materialElastico(m);
  let barra: SeccionBarra;
  let canto = 0;
  let huella: FormaHuella | null = null;
  switch (s.forma) {
    case "rectangular":
      barra = rectangular(s.b, s.h, elastico);
      canto = s.h;
      huella = { tipo: "rectangulo", b: s.b, h: s.h };
      break;
    case "circular":
      barra = circular(s.D, elastico);
      canto = s.D;
      huella = { tipo: "circulo", D: s.D };
      break;
    case "I":
      barra = perfilI(s.perfil, elastico);
      canto = s.perfil.h * 1e-3;
      huella = { tipo: "rectangulo", b: s.perfil.b * 1e-3, h: canto };
      break;
    case "T":
      barra = seccionT(s.bf, s.hf, s.bw, s.h, elastico).seccion;
      canto = s.h;
      huella = { tipo: "rectangulo", b: s.bf, h: s.h };
      break;
    case "general":
      barra = { E: elastico.E, G: elastico.G, A: s.A, Iy: s.Iy, Iz: s.Iz, J: s.J };
      if (s.Avy !== undefined) barra.Avy = s.Avy;
      if (s.Avz !== undefined) barra.Avz = s.Avz;
      canto = s.h ?? 0;
      huella = s.b !== undefined && s.h !== undefined ? { tipo: "rectangulo", b: s.b, h: s.h } : null;
      break;
  }
  if (!cortante) {
    delete barra.Avy;
    delete barra.Avz;
  }
  return { barra, peso: peso * barra.A, canto, huella, material: m.tipo };
}
