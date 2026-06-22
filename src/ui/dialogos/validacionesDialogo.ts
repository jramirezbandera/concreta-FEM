// Validaciones de UI del dialogo de Grupos y Plantas (feature-10, Tarea 1.3).
//
// PROPOSITO: validar EN EL MOMENTO de la edicion los datos que el usuario teclea
// en el dialogo (nombre, cota, altura) ANTES de aplicarlos al modelo. Es una capa
// de UX distinta de `validarModelo` (discretizador): aqui se atrapa el error campo
// a campo, con `campo` apuntando al input culpable, para mostrar el mensaje junto
// al control. Cada `mensaje` va en LENGUAJE DE OBRA: espanol con tildes, sin jerga
// FEM. El tono imita a `validaciones.ts` del discretizador.
//
// PURO: sin React, sin stores, sin IO. Recibe el `modelo` y los `datos` del
// formulario por parametro; devuelve la lista de errores (vacia = valido). Asi se
// puede testear en Node sin render. No muta el modelo.
import type { Modelo } from "../../dominio";
import { plantasDeGrupo } from "../../dominio";

// Error de un campo del formulario: `campo` identifica el input ("nombre", "cota",
// "altura") para resaltarlo; `mensaje` es texto de UI en espanol con tildes.
export type ErrorCampo = { campo: string; mensaje: string };

// Tolerancia (en metros) para considerar dos cotas "iguales". Los campos numericos
// se commitean via Number(string); comparar floats con === es fragil ante redondeos.
// Una micra es muy inferior a cualquier separacion real de plantas.
const EPS_COTA = 1e-6;

// Mensaje unico para un numero no finito (NaN tras Number("") o texto no numerico).
const MSG_NUMERO = "Introduce un número válido.";

// Helper de conveniencia: un formulario es valido si no acumulo ningun error.
export function esValido(errores: ErrorCampo[]): boolean {
  return errores.length === 0;
}

// Valida los datos de un grupo que se esta creando (grupoId === null) o editando
// (grupoId === id del grupo en edicion, que se EXCLUYE de la comprobacion de
// unicidad para no chocar consigo mismo).
export function validarGrupo(
  modelo: Modelo,
  grupoId: string | null,
  datos: { nombre: string; sobrecargaUso?: number; cargasMuertas?: number },
): ErrorCampo[] {
  const errores: ErrorCampo[] = [];

  // Nombre no vacio (tras quitar espacios): un grupo sin nombre no es identificable
  // en el arbol de obra.
  const nombre = datos.nombre.trim();
  if (nombre === "") {
    errores.push({ campo: "nombre", mensaje: "El grupo necesita un nombre." });
  } else {
    // Nombre unico entre grupos. Al editar, el propio grupo no cuenta como choque.
    const duplicado = modelo.grupos.some(
      (g) => g.id !== grupoId && g.nombre === nombre,
    );
    if (duplicado) {
      errores.push({
        campo: "nombre",
        mensaje: `Ya existe un grupo llamado "${nombre}". Usa un nombre distinto.`,
      });
    }
  }

  // Campos numericos (cuando se aportan): primero numero finito, luego no negativo.
  // Centralizar aqui la regla mantiene toda la validacion de campo en el modulo puro
  // y testeable, en vez de partirla con el componente. Una carga negativa carece de
  // sentido fisico (son cargas gravitatorias en kN/m²).
  if (datos.sobrecargaUso !== undefined) {
    if (!Number.isFinite(datos.sobrecargaUso)) {
      errores.push({ campo: "sobrecargaUso", mensaje: MSG_NUMERO });
    } else if (datos.sobrecargaUso < 0) {
      errores.push({
        campo: "sobrecargaUso",
        mensaje: "La sobrecarga de uso no puede ser negativa.",
      });
    }
  }
  if (datos.cargasMuertas !== undefined) {
    if (!Number.isFinite(datos.cargasMuertas)) {
      errores.push({ campo: "cargasMuertas", mensaje: MSG_NUMERO });
    } else if (datos.cargasMuertas < 0) {
      errores.push({
        campo: "cargasMuertas",
        mensaje: "Las cargas muertas no pueden ser negativas.",
      });
    }
  }

  return errores;
}

// Valida los datos de una planta que se esta creando (plantaId === null) o editando
// (plantaId === id de la planta en edicion, que se EXCLUYE de las comprobaciones de
// unicidad). La cota se valida unica DENTRO del mismo grupo: dos plantas del mismo
// grupo a la misma cota son ambiguas.
export function validarPlanta(
  modelo: Modelo,
  plantaId: string | null,
  datos: { nombre: string; cota: number; altura: number; grupoId: string },
): ErrorCampo[] {
  const errores: ErrorCampo[] = [];

  // Nombre no vacio.
  const nombre = datos.nombre.trim();
  if (nombre === "") {
    errores.push({ campo: "nombre", mensaje: "La planta necesita un nombre." });
  } else {
    // Nombre unico entre TODAS las plantas (global): el nombre identifica la planta
    // en el arbol de obra, donde se ven plantas de cualquier grupo.
    const duplicado = modelo.plantas.some(
      (p) => p.id !== plantaId && p.nombre === nombre,
    );
    if (duplicado) {
      errores.push({
        campo: "nombre",
        mensaje: `Ya existe una planta llamada "${nombre}". Usa un nombre distinto.`,
      });
    }
  }

  // La altura libre es una longitud fisica: primero numero finito, luego positiva.
  if (!Number.isFinite(datos.altura)) {
    errores.push({ campo: "altura", mensaje: MSG_NUMERO });
  } else if (datos.altura <= 0) {
    errores.push({
      campo: "altura",
      mensaje: "La altura de la planta debe ser mayor que cero.",
    });
  }

  // Cota: numero finito y unica dentro del MISMO grupo (excluyendo la propia planta
  // al editar). Dos plantas del grupo a la misma cota colocarian niveles solapados.
  // Comparacion con tolerancia (EPS_COTA), no === (floats commiteados via Number).
  if (!Number.isFinite(datos.cota)) {
    errores.push({ campo: "cota", mensaje: MSG_NUMERO });
  } else {
    const cotaRepetida = plantasDeGrupo(modelo, datos.grupoId).some(
      (p) => p.id !== plantaId && Math.abs(p.cota - datos.cota) < EPS_COTA,
    );
    if (cotaRepetida) {
      errores.push({
        campo: "cota",
        mensaje: `Ya hay una planta a la cota ${datos.cota} m en este grupo. Usa una cota distinta.`,
      });
    }
  }

  return errores;
}
