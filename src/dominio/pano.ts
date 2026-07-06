// Pano (Capa 1): superficie horizontal de forjado. F3 corte 1 implementa la LOSA MACIZA
// (placa); `reticular`/`unidireccional` quedan RESERVADOS (el discretizador los rechaza con
// un error de obra hasta que se implementen). El paño pertenece a una planta y su contorno
// se define por nudos (corte 1: rectangulo de 4 nudos PROPIOS, sin compartir con el portico:
// el acoplamiento malla<->vigas es un corte posterior). El discretizador (F3) lo malla en
// quads (Capa 2) que consume PyNite.
//
// `bordeApoyo` es una propiedad de OBRA (no jerga FEM): como descansa el borde de la losa.
//   - "simple"    -> borde apoyado (impide la flecha vertical) = losa simplemente apoyada.
//   - "empotrado" -> borde empotrado (impide flecha y giro) = continuidad/encastre.
//   - "libre"     -> borde sin apoyo (voladizo / apoyado en otros bordes).
// El discretizador lo traduce a apoyos del perimetro + estabilizacion en el plano.
//
// UNIDADES (CLAUDE.md §14): espesor y tamMalla en METROS (sistema interno); la UI los
// muestra en mm y convierte SOLO en el borde de entrada/salida.
//
// F3 corte "unidireccional": se levanta el rechazo de `unidireccional`. Un forjado de
// viguetas en UNA direccion aporta 5 campos OPCIONALES a nivel Zod (para que un paño
// losa/reticular no los lleve y la migracion v4->v5 no reviente al no sembrarlos):
// `direccionViguetas`, `intereje`, `canto`, `anchoNervio`, `pesoPropio`. Solo tienen
// sentido bajo `tipo:"unidireccional"`; su PRESENCIA y positividad las exige
// `validaciones` SOLO en ese tipo (codigo PANO_UNI_CAMPOS) — no aqui, porque un paño
// losa no debe verse obligado a portarlos. Se dejan OPCIONALES y NO `.default`: un
// `.default` volveria la clave obligatoria en el tipo de salida y contaminaria los
// literales de losa/reticular (mismo argumento que `quads?` en contratoFEM.ts).
// DEUDA declarada (T-f3-pano-schema-union): `espesor` y `tamMalla` siguen obligatorios a
// nivel Zod (no se pueden hacer opcionales sin romper losa) pero se IGNORAN bajo
// unidireccional — el discretizador no los lee ahi. Partir `PanoSchema` en union
// discriminada por `tipo` seria mas limpio pero invasivo, fuera de este corte.
import { z } from "zod";
import { IdSchema, NombreSchema, NumeroFinitoSchema } from "./comunes";

export const TipoPanoSchema = z.enum(["losa", "reticular", "unidireccional"]);
export type TipoPano = z.infer<typeof TipoPanoSchema>;

export const BordeApoyoSchema = z.enum(["simple", "empotrado", "libre"]);
export type BordeApoyo = z.infer<typeof BordeApoyoSchema>;

// Direccion de las viguetas de un forjado unidireccional (en ejes de OBRA/planta).
export const TipoDireccionViguetasSchema = z.enum(["x", "y"]);
export type TipoDireccionViguetas = z.infer<typeof TipoDireccionViguetasSchema>;

export const PanoSchema = z.object({
  id: IdSchema,
  nombre: NombreSchema,
  tipo: TipoPanoSchema,
  plantaId: IdSchema,
  // Nudos del contorno por id (orden de recorrido). Corte 1: 4 nudos en rectangulo de ejes.
  // >=3 a nivel de schema (un poligono necesita 3); la geometria concreta (rectangular,
  // no degenerado) la valida el discretizador.
  perimetro: z.array(IdSchema).min(3),
  // [A-3] finito+positivo: .positive() solo NO basta (Infinity es positivo).
  espesor: NumeroFinitoSchema.positive(), // m
  materialId: IdSchema,
  tamMalla: NumeroFinitoSchema.positive(), // m, tamano objetivo de elemento de malla
  bordeApoyo: BordeApoyoSchema,
  // --- Campos del forjado UNIDIRECCIONAL (opcionales; solo aplican a tipo "unidireccional").
  // Direccion en que corren las viguetas: "x" -> paralelas al eje obra-X (apoyan en los
  // bordes x=xMin/xMax); "y" -> paralelas al eje obra-Y. La luz de la vigueta = dimension
  // del paño en esta direccion; el intereje se mide en la perpendicular.
  direccionViguetas: TipoDireccionViguetasSchema.optional(),
  // Separacion OBJETIVO entre viguetas (m). Es un objetivo, no exacto: el discretizador
  // reparte el ancho a partes iguales (s = B/n) igual que tamMalla -> tamMallaEfectivo.
  intereje: NumeroFinitoSchema.positive().optional(), // m
  // Canto del nervio de la vigueta (m). Gobierna la rigidez a flexion vertical (Iy catalogo,
  // que tras el intercambio Iy<->Iz gobierna la flexion FEM de la barra horizontal).
  canto: NumeroFinitoSchema.positive().optional(), // m
  // Ancho del nervio de la vigueta (m). La seccion de la vigueta es el rectangulo
  // anchoNervio x canto (sin rigidez T ni capa de compresion en este corte).
  anchoNervio: NumeroFinitoSchema.positive().optional(), // m
  // Peso propio TABULADO del forjado (kN/m^2, >=0). Se reparte a las viguetas como carga
  // gravitatoria; NO se añade rho*A del nervio como peso estatico (evita doble conteo).
  // Finito y >=0 aqui (0 es legitimo); validaciones exige >0 en los otros bajo unidireccional.
  pesoPropio: NumeroFinitoSchema.nonnegative().optional(), // kN/m^2
});
export type Pano = z.infer<typeof PanoSchema>;
