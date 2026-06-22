// Tipos de las ENTRADAS DE CATALOGO de la biblioteca externa (Opcion A, feature-3).
//
// La biblioteca es un catalogo fijo e inmutable que NO se persiste con el Modelo
// (Capa 1). Los `materialId`/`seccionId` del dominio apuntan a entradas de aqui.
// Este fichero define SOLO la forma de los datos; el cableado de valores reales
// (hormigon.ts, aceros.ts, perfiles.ts) llega despues, en fases posteriores.
//
// UNIDADES: todo en sistema interno kN-m (CLAUDE.md §14). Es decir:
//   - E, G, fck, fy, Ecm: kN/m² (NO MPa).
//   - peso: kN/m³.
//   - A: m²;  Iy, Iz, J: m⁴.
// La conversion desde unidades de UI (mm, MPa) vive EXCLUSIVAMENTE en
// `src/unidades` y ocurre en los bordes, nunca aqui ni en la logica de calculo.
//
// MAPEO A PYNITE (Capa 2, lo hara el discretizador en feature-4):
//   add_material(name, E, G, nu, rho, fy=None)
//     name <- id ;  E <- E ;  G <- G ;  nu <- nu ;  rho <- peso ;  fy <- fy
//   add_section(name, A, Iy, Iz, J)
//     name <- id ;  A <- A ;  Iy <- Iy ;  Iz <- Iz ;  J <- J
// Por eso los campos aqui replican exactamente lo que PyNite espera: el
// discretizador es un mapeo directo, sin reinterpretar magnitudes.

// --- Materiales ---------------------------------------------------------------

// Propiedades comunes a cualquier material elastico isotropo del catalogo.
// Se modela como union discriminada por `tipo` para que el compilador exija
// los campos especificos (fck/Ecm en hormigon, fy en acero) sin permitir
// mezclas invalidas.
export interface EntradaMaterialBase {
  id: string; // referenciado por `materialId` en el dominio (ASCII, p.ej. "HA-25")
  denominacion: string; // etiqueta para UI (p.ej. "HA-25", "S275")
  E: number; // modulo de elasticidad, kN/m² (interno) -> PyNite E
  G: number; // modulo de cortante,    kN/m² (interno) -> PyNite G
  nu: number; // coef. de Poisson (adimensional)        -> PyNite nu
  peso: number; // peso especifico, kN/m³ (interno)     -> PyNite rho
}

// Hormigon: ademas resistencia caracteristica `fck` y modulo secante `Ecm`.
// `Ecm` se derivara con la formula del Codigo Estructural / EC2
// (Ecm = 22000·(fcm/10)^0,3 con fcm = fck + 8), no la formula EHE-08 derogada.
export interface EntradaMaterialHormigon extends EntradaMaterialBase {
  tipo: "hormigon";
  fck: number; // resistencia caracteristica a compresion, kN/m² (interno)
  Ecm: number; // modulo secante derivado de fck, kN/m² (interno)
}

// Acero estructural: ademas limite elastico `fy` (mapea a PyNite fy, opcional alli).
export interface EntradaMaterialAcero extends EntradaMaterialBase {
  tipo: "acero";
  fy: number; // limite elastico, kN/m² (interno) -> PyNite fy
}

// Entrada de material del catalogo (discriminada por `tipo`).
export type EntradaMaterial = EntradaMaterialHormigon | EntradaMaterialAcero;

// --- Secciones ----------------------------------------------------------------

// Tipos de geometria del catalogo, alineados con el enum del dominio
// (`src/dominio/seccion.ts`). Solo los tres tipos con propiedades calculables
// en F1; `generico` del dominio no es una entrada de catalogo.
export type TipoSeccionCatalogo =
  | "perfilMetalico"
  | "hormigonRectangular"
  | "hormigonCircular";

// Entrada de seccion del catalogo: propiedades geometricas/mecanicas para el FEM.
// Sin armado ni comprobacion normativa (eso es F4). Mapea directo a add_section.
// IMPORTANTE: `J` es la constante de torsion (tabulada / por coef. β en perfiles,
// formula cerrada en hormigon), NUNCA el momento polar.
export interface EntradaSeccion {
  id: string; // referenciado por `seccionId` en el dominio (ASCII, p.ej. "IPE300")
  nombre: string; // etiqueta para UI (p.ej. "IPE 300", "30x50")
  tipo: TipoSeccionCatalogo;
  A: number; // area,                 m²  (interno) -> PyNite A
  Iy: number; // inercia eje local y,  m⁴  (interno) -> PyNite Iy
  Iz: number; // inercia eje local z,  m⁴  (interno) -> PyNite Iz
  J: number; // constante de torsion, m⁴  (interno) -> PyNite J
}
