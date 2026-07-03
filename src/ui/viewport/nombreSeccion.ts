// nombreSeccion: resuelve el NOMBRE LEGIBLE de una seccion a partir de su id, para
// rotular elementos en el lienzo (D7a). Una seccion puede venir de DOS familias (igual
// que SelectSeccion): el catalogo FIJO de la biblioteca (perfiles IPE/HEB) o las
// secciones PARAMETRICAS de la obra (hormigon, Capa 1, en modelo.secciones).
//
// PURO: recibe el array de secciones de obra ya leido (modelo.secciones) y el id; no
// toca stores ni React. El catalogo de biblioteca es inmutable (getSeccion).
//
// UNIDADES: las dimensiones de dominio estan en METROS (interno, §14); en la etiqueta
// se muestran en cm (mas legible que mm para secciones de hormigon en un rotulo de
// lienzo: "HA 30×30" en vez de "300×300"). Este es un BORDE de presentacion (la UI no
// convierte en mitad de la logica; aqui es la salida hacia la etiqueta).
import type { Seccion } from "../../dominio";
import { getSeccion } from "../../biblioteca";

// m -> cm, redondeado a entero (las secciones de obra son multiplos de cm). Evita
// "30.000000004" por coma flotante.
function aCm(m: number): number {
  return Math.round(m * 100);
}

// Nombre legible de una seccion de OBRA (Capa 1). Si el usuario le puso `nombre`, gana.
// Si no, se deriva por tipo en cm (hormigon) o por el perfil (metalico). Espejo de
// etiquetaSeccionObra (SelectSeccion) pero en cm y prefijo "HA" para el hormigon, que es
// lo que un arquitecto espera leer en el plano.
function nombreSeccionObra(s: Seccion): string {
  if (s.nombre.trim() !== "") return s.nombre;
  switch (s.tipo) {
    case "hormigonRectangular":
      return `HA ${aCm(s.b)}×${aCm(s.h)}`;
    case "hormigonCircular":
      return `HA Ø${aCm(s.d)}`;
    case "perfilMetalico":
      return s.perfilId;
    case "generico":
      // Sin nombre de usuario (ya filtrado arriba) no hay etiqueta natural: el id sirve
      // de ultimo recurso (una seccion generica sin nombre es rara en F1).
      return s.id;
  }
}

// Resuelve el nombre legible de la seccion `seccionId`. Busca primero en las secciones de
// obra (parametricas), luego en el catalogo de biblioteca (perfiles). Si no la encuentra
// (referencia rota: la valida feature-4), devuelve "" para que la etiqueta rotule solo el
// nombre del elemento sin un separador colgando.
export function nombreSeccion(
  seccionId: string,
  seccionesObra: readonly Seccion[],
): string {
  const obra = seccionesObra.find((s) => s.id === seccionId);
  if (obra) return nombreSeccionObra(obra);
  const cat = getSeccion(seccionId);
  return cat ? cat.nombre : "";
}
