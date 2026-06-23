// Validaciones de UI de la carga (feature-13, Tarea 2.2).
//
// PROPOSITO: validar EN EL MOMENTO de la edicion los datos que el usuario teclea
// al crear/editar una carga (tipo, ambito, valor, hipotesis) ANTES de aplicarlos al
// modelo. Misma capa de UX que `validacionesViga.ts`: error campo a campo, con
// `campo` apuntando al control culpable. Cada `mensaje` va en LENGUAJE DE OBRA:
// espanol con tildes, SIN jerga FEM (nada de "case", "load", "member"). El tono
// imita a `validaciones.ts` del discretizador (mismo mensaje de REF_AMBITO).
//
// PURO: sin React, sin stores, sin IO. Recibe el `modelo` y los `datos` del
// formulario por parametro; devuelve la lista de errores (vacia = valido). Asi se
// testea en Node/jsdom sin render. No muta el modelo.
import type { Modelo } from "../../dominio";
// Se reutiliza el contrato de error del dialogo de Grupos/Plantas: mismo `ErrorCampo`
// y mismo helper `esValido`, igual que hace `validacionesViga`. NO se redefinen aqui:
// se re-exportan para que la UI consuma una sola forma de error.
import { type ErrorCampo, esValido } from "./validacionesDialogo";
export { type ErrorCampo, esValido };

// Datos de la carga tal como los aporta el dialogo/inspector. `ambito` e
// `hipotesisId` llegan como id del elemento/hipotesis; `valor` ya commiteado a
// number (via Number(string)) por el campo numerico.
export interface DatosCargaUI {
  tipo: "puntual" | "lineal" | "superficial";
  ambito: string;
  valor: number;
  hipotesisId: string;
}

// Conjunto de ids de elementos sobre los que puede actuar una carga en F1: viga,
// pilar o nudo. Mismo criterio que el discretizador (validarRefsCarga), salvo paños
// (F3): una carga superficial sobre paño se atrapa aparte con `avisoSuperficial`,
// porque en F1 aun no se calcula (el discretizador la bloquea con PANO_NO_SOPORTADO).
function ambitoExiste(modelo: Modelo, ambito: string): boolean {
  return (
    modelo.vigas.some((v) => v.id === ambito) ||
    modelo.pilares.some((p) => p.id === ambito) ||
    modelo.nudos.some((n) => n.id === ambito)
  );
}

// Valida los datos de una carga que se esta creando (cargaId === null) o editando
// (cargaId === id de la carga en edicion). `cargaId` no participa en ninguna
// comprobacion de unicidad (las cargas no llevan nombre unico), pero se mantiene en
// la firma para homogeneidad con validarViga/validarHipotesis y para futuras reglas.
export function validarCarga(
  modelo: Modelo,
  _cargaId: string | null,
  datos: DatosCargaUI,
): ErrorCampo[] {
  const errores: ErrorCampo[] = [];

  // 1. Valor: numero finito y ESTRICTAMENTE POSITIVO. En F1 solo se modela la
  // gravedad: el discretizador emite la carga como signo*Math.abs(valor), de modo
  // que un valor negativo (p.ej. -5) se MOSTRARIA como -5 pero se CALCULARIA hacia
  // abajo igual que +5 (dato mostrado != dato calculado). Para que la entrada sea
  // siempre coherente con el calculo, se exige valor > 0; el sentido (gravedad) lo
  // fija el discretizador, no el signo que teclea el usuario.
  if (!Number.isFinite(datos.valor) || datos.valor <= 0) {
    errores.push({
      campo: "valor",
      mensaje: "El valor de la carga debe ser mayor que cero.",
    });
  }

  // 2. Hipotesis: debe referenciar una hipotesis existente del modelo. Una carga
  // huerfana de hipotesis no entra en ninguna combinacion.
  if (!modelo.hipotesis.some((h) => h.id === datos.hipotesisId)) {
    errores.push({
      campo: "hipotesisId",
      mensaje: "La hipótesis a la que se asigna la carga no existe.",
    });
  }

  // 3. Ambito: debe referenciar un elemento existente (viga/pilar/nudo). Mismo
  // mensaje que el discretizador (REF_AMBITO), en lenguaje de obra.
  if (!ambitoExiste(modelo, datos.ambito)) {
    errores.push({
      campo: "ambito",
      mensaje: "La carga está aplicada sobre un elemento que ya no existe en la obra.",
    });
  }

  return errores;
}

// DECISION (aviso de carga superficial): NO se modela como un ErrorCampo dentro de
// `validarCarga`, porque `esValido` trata cualquier ErrorCampo como bloqueante y el
// aviso de superficial NO debe impedir editar/guardar la carga (solo advertir de que
// no se calculara en F1). Se expone aparte, como un ErrorCampo informativo opcional,
// replicando la separacion del discretizador entre `errores` (bloqueantes) y `avisos`
// (no bloqueantes). La UI lo muestra como nota junto al campo "tipo" sin deshabilitar
// el guardado; al calcular, el discretizador es quien bloquea (PANO_NO_SOPORTADO).
export function avisoSuperficial(datos: DatosCargaUI): ErrorCampo | null {
  if (datos.tipo !== "superficial") return null;
  return {
    campo: "tipo",
    mensaje: "Las cargas de superficie (paños) aún no se calculan en esta fase.",
  };
}
