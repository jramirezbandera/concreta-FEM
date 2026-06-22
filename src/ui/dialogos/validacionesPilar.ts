// Validaciones de UI del pilar (feature-11, Tarea 1.2).
//
// PROPOSITO: validar EN EL MOMENTO de la edicion los datos que el usuario teclea
// en el panel flotante del pilar (nombre, x/y, rango de plantas, seccion, material,
// angulo) ANTES de aplicarlos al modelo. Es la misma capa de UX que
// `validacionesDialogo.ts`: error campo a campo, con `campo` apuntando al input
// culpable, para mostrar el mensaje junto al control. Cada `mensaje` va en LENGUAJE
// DE OBRA: espanol con tildes, SIN jerga FEM (nada de "release", "nodo", "member").
// El tono imita a `validaciones.ts` del discretizador.
//
// PURO: sin React, sin stores, sin IO. Recibe el `modelo` y los `datos` del
// formulario por parametro; devuelve la lista de errores (vacia = valido). Asi se
// testea en Node sin render. No muta el modelo.
import type { Modelo } from "../../dominio";
import { plantaPorId, seccionPorId } from "../../dominio";
import { getMaterial, getSeccion } from "../../biblioteca";
// Se reutiliza el contrato de error del dialogo de Grupos/Plantas: mismo `ErrorCampo`
// y mismo helper `esValido`, para que la UI consuma una sola forma de error. NO se
// redefinen aqui: se re-exportan.
import { type ErrorCampo, esValido } from "./validacionesDialogo";
export { type ErrorCampo, esValido };

// Tolerancia (en metros) para comparar cotas de plantas. Igual criterio que
// `EPS_COTA` del dialogo: comparar floats commiteados via Number con === es fragil.
const EPS_COTA = 1e-6;

// Mensaje unico para un numero no finito (NaN tras Number("") o texto no numerico).
const MSG_NUMERO = "Introduce un número válido.";

// Datos del pilar tal como los aporta el panel flotante. Las plantas y los
// recursos (seccion/material) llegan como id (o null mientras el usuario no los ha
// asignado). vinculacionExterior/arranque no requieren validacion numerica: el
// `Segmentado` solo emite valores validos del enum, asi que no se incluyen.
export interface DatosPilarUI {
  nombre: string;
  x: number;
  y: number;
  plantaInicial: string;
  plantaFinal: string;
  seccionId: string | null;
  materialId: string | null;
  angulo: number;
}

// Resuelve si la seccion referenciada existe: o es un perfil del catalogo de la
// biblioteca (`getSeccion`) o una seccion parametrica de la obra
// (`modelo.secciones` via `seccionPorId`). Cualquiera de las dos basta.
function seccionExiste(modelo: Modelo, seccionId: string): boolean {
  return getSeccion(seccionId) !== undefined || seccionPorId(modelo, seccionId) !== undefined;
}

// Valida los datos de un pilar que se esta creando (pilarId === null) o editando
// (pilarId === id del pilar en edicion, que se EXCLUYE de la comprobacion de
// unicidad de nombre para no chocar consigo mismo).
export function validarPilar(
  modelo: Modelo,
  pilarId: string | null,
  datos: DatosPilarUI,
): ErrorCampo[] {
  const errores: ErrorCampo[] = [];

  // 1. Nombre no vacio (tras trim) y unico entre los demas pilares. Un pilar sin
  // nombre o con nombre repetido no es identificable en el arbol de obra.
  const nombre = datos.nombre.trim();
  if (nombre === "") {
    errores.push({ campo: "nombre", mensaje: "El pilar necesita un nombre." });
  } else {
    const duplicado = modelo.pilares.some(
      (p) => p.id !== pilarId && p.nombre === nombre,
    );
    if (duplicado) {
      errores.push({
        campo: "nombre",
        mensaje: `Ya existe un pilar llamado "${nombre}". Usa un nombre distinto.`,
      });
    }
  }

  // 2. Coordenadas en planta: numeros finitos (NaN/Infinity invalidos).
  if (!Number.isFinite(datos.x)) {
    errores.push({ campo: "x", mensaje: MSG_NUMERO });
  }
  if (!Number.isFinite(datos.y)) {
    errores.push({ campo: "y", mensaje: MSG_NUMERO });
  }

  // 3. Rango de plantas: ambas deben existir en el modelo y la inicial estar a cota
  // <= la final (o ser la misma). Se comparan por COTA (no por orden del array),
  // resolviendo con `plantaPorId`. Mensajes apuntan al campo de planta inicial.
  const plantaIni = plantaPorId(modelo, datos.plantaInicial);
  const plantaFin = plantaPorId(modelo, datos.plantaFinal);
  if (plantaIni === undefined) {
    errores.push({
      campo: "plantaInicial",
      mensaje: "El pilar debe arrancar en una planta existente.",
    });
  }
  if (plantaFin === undefined) {
    errores.push({
      campo: "plantaFinal",
      mensaje: "El pilar debe llegar a una planta existente.",
    });
  }
  // Solo se compara el orden si ambas plantas se resolvieron (con tolerancia).
  if (
    plantaIni !== undefined &&
    plantaFin !== undefined &&
    plantaIni.cota - plantaFin.cota > EPS_COTA
  ) {
    errores.push({
      campo: "plantaInicial",
      mensaje: "La planta inicial debe estar por debajo o ser la final.",
    });
  }

  // 4. Seccion: asignada (no null) y existente (catalogo u obra).
  if (datos.seccionId === null) {
    errores.push({ campo: "seccionId", mensaje: "Asigna una sección al pilar." });
  } else if (!seccionExiste(modelo, datos.seccionId)) {
    errores.push({
      campo: "seccionId",
      mensaje: "La sección asignada al pilar no existe.",
    });
  }

  // 5. Material: asignado (no null) y existente en el catalogo de la biblioteca.
  if (datos.materialId === null) {
    errores.push({ campo: "materialId", mensaje: "Asigna un material al pilar." });
  } else if (getMaterial(datos.materialId) === undefined) {
    errores.push({
      campo: "materialId",
      mensaje: "El material asignado al pilar no existe.",
    });
  }

  // 6. Angulo de giro: numero finito.
  if (!Number.isFinite(datos.angulo)) {
    errores.push({ campo: "angulo", mensaje: MSG_NUMERO });
  }

  return errores;
}
