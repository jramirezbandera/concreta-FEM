// enfasisPestana: que tipos de elemento se dibujan a pleno color y cuales atenuados
// segun la pestana activa (patron CYPECAD: cada pestana resalta lo suyo y deja el
// resto como contexto gris). PURO (sin React/three): decidible y testeable en Node.
//
// El atenuado es SOLO visual y de picking (el elemento atenuado deja de ser blanco
// del raton); el iman de las herramientas lee el Modelo, no la malla, asi que seguir
// enganchando a pilares atenuados al colocar vigas es deliberado.
import type { ModoVista, Pestana } from "../../estado";

export type NivelEnfasis = "pleno" | "atenuado";

export interface EnfasisPestana {
  pilares: NivelEnfasis;
  vigas: NivelEnfasis;
  panos: NivelEnfasis;
}

// Constantes congeladas y REUTILIZADAS: enfasisDePestana sirve de snapshot de
// useSyncExternalStore, que exige referencia estable mientras el valor no cambie
// (devolver un objeto nuevo por llamada = bucle de render, gotcha F9).
export const ENFASIS_PLENO: EnfasisPestana = Object.freeze({
  pilares: "pleno",
  vigas: "pleno",
  panos: "pleno",
});
const ENFASIS_ENTRADA_PILARES: EnfasisPestana = Object.freeze({
  pilares: "pleno",
  vigas: "atenuado",
  panos: "atenuado",
});
const ENFASIS_ENTRADA_VIGAS: EnfasisPestana = Object.freeze({
  pilares: "atenuado",
  vigas: "pleno",
  panos: "pleno",
});

export function enfasisDePestana(
  pestana: Pestana,
  modoVista: ModoVista,
): EnfasisPestana {
  // Fuera de planta (3D/mosaico) la vista es de inspeccion global del edificio:
  // todo pleno. El enfasis es una ayuda de INTRODUCCION, y se introduce en planta.
  if (modoVista !== "planta") return ENFASIS_PLENO;
  switch (pestana) {
    case "entradaPilares":
      return ENFASIS_ENTRADA_PILARES;
    case "entradaVigas":
      return ENFASIS_ENTRADA_VIGAS;
    // Resultados/Isovalores leen la obra completa: nada atenuado.
    default:
      return ENFASIS_PLENO;
  }
}
