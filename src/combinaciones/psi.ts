/**
 * Coeficientes de simultaneidad ψ0, ψ1, ψ2 del CTE DB SE, tabla 4.2 (copiados del texto del DB SE,
 * no de Concreta: `src/lib/calculations/loadGen.ts` da a la categoría E los valores de almacén
 * del Eurocódigo, 1,0/0,9/0,8, y el CTE dice 0,7/0,7/0,6).
 */

export interface Psi {
  psi0: number;
  psi1: number;
  psi2: number;
}

/** Categorías de uso del DB SE-AE (tabla 3.1). F (cubiertas transitables) toma la del uso desde el que se accede. */
export type CategoriaUso = "A" | "B" | "C" | "D" | "E" | "G";

const USO: Record<CategoriaUso, Psi> = {
  A: { psi0: 0.7, psi1: 0.5, psi2: 0.3 }, // zonas residenciales
  B: { psi0: 0.7, psi1: 0.5, psi2: 0.3 }, // zonas administrativas
  C: { psi0: 0.7, psi1: 0.7, psi2: 0.6 }, // zonas destinadas al público
  D: { psi0: 0.7, psi1: 0.7, psi2: 0.6 }, // zonas comerciales
  E: { psi0: 0.7, psi1: 0.7, psi2: 0.6 }, // tráfico y aparcamiento de vehículos ligeros (< 30 kN)
  G: { psi0: 0, psi1: 0, psi2: 0 }, // cubiertas accesibles sólo para mantenimiento
};

export function psiUso(categoria: CategoriaUso): Psi {
  return { ...USO[categoria] };
}

/** Nieve: depende de la altitud del emplazamiento. */
export function psiNieve(altitudMayorDe1000m: boolean): Psi {
  return altitudMayorDe1000m ? { psi0: 0.7, psi1: 0.5, psi2: 0.2 } : { psi0: 0.5, psi1: 0.2, psi2: 0 };
}

export const PSI_VIENTO: Readonly<Psi> = { psi0: 0.6, psi1: 0.5, psi2: 0 };
export const PSI_TEMPERATURA: Readonly<Psi> = { psi0: 0.6, psi1: 0.5, psi2: 0 };
export const PSI_TERRENO: Readonly<Psi> = { psi0: 0.7, psi1: 0.7, psi2: 0.7 };
