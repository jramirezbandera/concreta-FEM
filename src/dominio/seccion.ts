// Seccion (Capa 1). Union discriminada por `tipo`: cada variante lleva SOLO los
// datos que el discretizador (feature-4) necesita para resolver las propiedades de
// calculo (A, Iy, Iz, J) sin parsear el `id`. El discretizador alimenta esos datos
// a la biblioteca (`src/biblioteca`): `perfilId` -> entrada de PERFILES; b/h ->
// seccionRectangular(b,h); d -> seccionCircular(d); o usa las propiedades directas.
//
// UNIDADES: las dimensiones geometricas (b, h, d) se guardan en METROS (sistema
// interno kN-m, CLAUDE.md §14). La conversion mm (UI) -> m vive EXCLUSIVAMENTE en
// `src/unidades`, en los bordes; aqui jamas se convierte. (Las funciones de
// `biblioteca/hormigon.ts` reciben mm; el borde de UI hara m -> mm al invocarlas, o
// se adaptaran segun la convencion de feature-3; el dominio solo persiste m.)
import { z } from "zod";
import { IdSchema, NombreSchema } from "./comunes";

// Campos comunes a toda seccion (identidad + etiqueta de UI).
const baseSeccion = {
  id: IdSchema,
  nombre: NombreSchema,
};

// Perfil metalico laminado: referencia a una entrada del catalogo PERFILES
// (IPE/HEB) por su id ASCII (p.ej. "IPE300"). Sus propiedades estan tabuladas.
export const SeccionPerfilMetalicoSchema = z.object({
  ...baseSeccion,
  tipo: z.literal("perfilMetalico"),
  perfilId: IdSchema, // -> entrada de PERFILES (src/biblioteca/perfiles.ts)
});

// Hormigon rectangular: ancho `b` y canto `h` en METROS (interno). El
// discretizador deriva A/Iy/Iz/J via seccionRectangular(b, h).
export const SeccionHormigonRectangularSchema = z.object({
  ...baseSeccion,
  tipo: z.literal("hormigonRectangular"),
  b: z.number().positive(), // ancho, m (interno); conversion mm->m en src/unidades
  h: z.number().positive(), // canto, m (interno); conversion mm->m en src/unidades
});

// Hormigon circular: diametro `d` en METROS (interno). El discretizador deriva
// A/Iy/Iz/J via seccionCircular(d).
export const SeccionHormigonCircularSchema = z.object({
  ...baseSeccion,
  tipo: z.literal("hormigonCircular"),
  d: z.number().positive(), // diametro, m (interno); conversion mm->m en src/unidades
});

// Generico: propiedades de calculo directas (m², m⁴), sin biblioteca. Util para
// secciones a medida o importadas. Mapea 1:1 a add_section de PyNite.
export const SeccionGenericoSchema = z.object({
  ...baseSeccion,
  tipo: z.literal("generico"),
  A: z.number().positive(), // area, m²
  Iy: z.number().positive(), // inercia eje local y, m⁴
  Iz: z.number().positive(), // inercia eje local z, m⁴
  J: z.number().positive(), // constante de torsion (St. Venant, NO polar), m⁴
});

// Seccion del dominio: discriminada por `tipo` (mismo patron que EntradaMaterial
// en src/biblioteca/tipos.ts). El compilador exige los campos especificos de cada
// variante y prohibe mezclas invalidas.
export const SeccionSchema = z.discriminatedUnion("tipo", [
  SeccionPerfilMetalicoSchema,
  SeccionHormigonRectangularSchema,
  SeccionHormigonCircularSchema,
  SeccionGenericoSchema,
]);
export type Seccion = z.infer<typeof SeccionSchema>;
