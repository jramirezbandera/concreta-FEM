// Validaciones de UI de la viga (feature-12, Tarea 1.3).
//
// PROPOSITO: validar EN EL MOMENTO de la edicion los datos que el usuario teclea
// en el inspector de la viga (nombre, seccion, material, extremos, tirante) ANTES
// de aplicarlos al modelo. Es la misma capa de UX que `validacionesPilar.ts`:
// error campo a campo, con `campo` apuntando al control culpable, para mostrar el
// mensaje junto al input. Cada `mensaje` va en LENGUAJE DE OBRA: espanol con
// tildes, SIN jerga FEM (nada de "release", "nodo", "member"). El tono imita a
// `validaciones.ts` del discretizador.
//
// A diferencia del pilar, el inspector de viga es SOLO-PROPIEDADES: no edita
// geometria (los nudos I/J los fija la introduccion grafica en planta, no este
// formulario), por lo que `DatosVigaUI` no lleva coordenadas.
//
// PURO: sin React, sin stores, sin IO. Recibe el `modelo` y los `datos` del
// formulario por parametro; devuelve la lista de errores (vacia = valido). Asi se
// testea en Node sin render. No muta el modelo.
import type { Modelo } from "../../dominio";
import { seccionPorId } from "../../dominio";
import { getMaterial, getSeccion } from "../../biblioteca";
// Se reutiliza el contrato de error del dialogo de Grupos/Plantas: mismo `ErrorCampo`
// y mismo helper `esValido`, igual que hace `validacionesPilar`. NO se redefinen
// aqui: se re-exportan para que la UI consuma una sola forma de error.
import { type ErrorCampo, esValido } from "./validacionesDialogo";
export { type ErrorCampo, esValido };

// Datos de la viga tal como los aporta el inspector. La seccion/material llegan
// como id (o null mientras el usuario no los ha asignado). Los extremos y el
// tirante no requieren validacion: el `Segmentado`/checkbox solo emite valores
// validos del enum/boolean, asi que se aceptan tal cual.
export interface DatosVigaUI {
  nombre: string;
  seccionId: string | null;
  materialId: string | null;
  extremoI: "empotrado" | "articulado";
  extremoJ: "empotrado" | "articulado";
  tirante: boolean;
}

// Resuelve si la seccion referenciada existe: o es un perfil del catalogo de la
// biblioteca (`getSeccion`) o una seccion parametrica de la obra
// (`modelo.secciones` via `seccionPorId`). Cualquiera de las dos basta. Mismo
// criterio que el pilar.
function seccionExiste(modelo: Modelo, seccionId: string): boolean {
  return getSeccion(seccionId) !== undefined || seccionPorId(modelo, seccionId) !== undefined;
}

// Valida los datos de una viga que se esta creando (vigaId === null) o editando
// (vigaId === id de la viga en edicion, que se EXCLUYE de la comprobacion de
// unicidad de nombre para no chocar consigo misma).
export function validarViga(
  modelo: Modelo,
  vigaId: string | null,
  datos: DatosVigaUI,
): ErrorCampo[] {
  const errores: ErrorCampo[] = [];

  // 1. Nombre no vacio (tras trim) y unico entre las demas vigas. Una viga sin
  // nombre o con nombre repetido no es identificable en el arbol de obra.
  const nombre = datos.nombre.trim();
  if (nombre === "") {
    errores.push({ campo: "nombre", mensaje: "La viga necesita un nombre." });
  } else {
    const duplicado = modelo.vigas.some(
      (v) => v.id !== vigaId && v.nombre === nombre,
    );
    if (duplicado) {
      errores.push({
        campo: "nombre",
        mensaje: `Ya existe una viga llamada "${nombre}". Usa un nombre distinto.`,
      });
    }
  }

  // 2. Seccion: asignada (no null) y existente (catalogo u obra).
  if (datos.seccionId === null) {
    errores.push({ campo: "seccionId", mensaje: "Asigna una sección a la viga." });
  } else if (!seccionExiste(modelo, datos.seccionId)) {
    errores.push({
      campo: "seccionId",
      mensaje: "La sección asignada a la viga no existe.",
    });
  }

  // 3. Material: asignado (no null) y existente en el catalogo de la biblioteca.
  if (datos.materialId === null) {
    errores.push({ campo: "materialId", mensaje: "Asigna un material a la viga." });
  } else if (getMaterial(datos.materialId) === undefined) {
    errores.push({
      campo: "materialId",
      mensaje: "El material asignado a la viga no existe.",
    });
  }

  // Los extremos (empotrado/articulado) y el tirante son enum/boolean: no admiten
  // valores invalidos desde la UI, por lo que no se validan aqui.

  return errores;
}
