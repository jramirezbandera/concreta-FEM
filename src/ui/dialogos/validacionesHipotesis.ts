// Validaciones de UI de la hipotesis (feature-13, Tarea 2.2).
//
// PROPOSITO: validar EN EL MOMENTO de la edicion los datos que el usuario teclea
// al crear/editar una hipotesis (nombre, tipo) ANTES de aplicarlos al modelo. Es
// la misma capa de UX que `validacionesViga.ts` / `validacionesDialogo.ts`: error
// campo a campo, con `campo` apuntando al control culpable, para mostrar el mensaje
// junto al input. Cada `mensaje` va en LENGUAJE DE OBRA: espanol con tildes, SIN
// jerga FEM (nada de "case", "load combination"). El tono imita a `validaciones.ts`
// del discretizador.
//
// PURO: sin React, sin stores, sin IO. Recibe el `modelo` y los `datos` del
// formulario por parametro; devuelve la lista de errores (vacia = valido). Asi se
// testea en Node/jsdom sin render. No muta el modelo.
import type { Modelo } from "../../dominio";
// Se reutiliza el contrato de error del dialogo de Grupos/Plantas: mismo `ErrorCampo`
// y mismo helper `esValido`, igual que hacen `validacionesPilar`/`validacionesViga`.
// NO se redefinen aqui: se re-exportan para que la UI consuma una sola forma de error.
import { type ErrorCampo, esValido } from "./validacionesDialogo";
export { type ErrorCampo, esValido };

// Datos de la hipotesis tal como los aporta el dialogo. El `tipo` lo emite un
// segmentado/select acotado al enum, asi que en condiciones normales ya es valido;
// se comprueba de forma defensiva (regla 8 del CLAUDE.md: todo dato que entra se
// valida) para blindar la frontera ante datos importados o cambios futuros de UI.
export interface DatosHipotesisUI {
  nombre: string;
  tipo: "permanente" | "variable";
}

// Conjunto de tipos validos de hipotesis, para la comprobacion defensiva.
const TIPOS_HIPOTESIS: ReadonlySet<string> = new Set(["permanente", "variable"]);

// Valida los datos de una hipotesis que se esta creando (hipotesisId === null) o
// editando (hipotesisId === id de la hipotesis en edicion, que se EXCLUYE de la
// comprobacion de unicidad de nombre para no chocar consigo misma).
export function validarHipotesis(
  modelo: Modelo,
  hipotesisId: string | null,
  datos: DatosHipotesisUI,
): ErrorCampo[] {
  const errores: ErrorCampo[] = [];

  // 1. Nombre no vacio (tras trim) y unico entre las demas hipotesis. Una hipotesis
  // sin nombre o con nombre repetido no es identificable al asignar cargas ni al
  // leer las combinaciones.
  const nombre = datos.nombre.trim();
  if (nombre === "") {
    errores.push({ campo: "nombre", mensaje: "La hipótesis necesita un nombre." });
  } else {
    const duplicado = modelo.hipotesis.some(
      (h) => h.id !== hipotesisId && h.nombre === nombre,
    );
    if (duplicado) {
      errores.push({
        campo: "nombre",
        mensaje: `Ya existe una hipótesis llamada "${nombre}". Usa un nombre distinto.`,
      });
    }
  }

  // 2. Tipo dentro del enum (defensivo). En F1 una hipotesis es permanente (peso
  // propio/cargas muertas) o variable (sobrecarga de uso); ningun otro valor tiene
  // sentido para las combinaciones.
  if (!TIPOS_HIPOTESIS.has(datos.tipo)) {
    errores.push({
      campo: "tipo",
      mensaje: "El tipo de la hipótesis debe ser permanente o variable.",
    });
  }

  return errores;
}
