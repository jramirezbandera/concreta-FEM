// Categoria de uso (CTE DB-SE-AE / Codigo Estructural). Aqui SOLO el enum y su
// forma; los valores numericos qk y los coeficientes psi viven en la biblioteca
// normativa (feature-3/feature-13), no en el dominio.
import { z } from "zod";

export const CategoriaUsoSchema = z.enum(["A", "B", "C", "D", "E", "F", "G"]);
export type CategoriaUso = z.infer<typeof CategoriaUsoSchema>;
