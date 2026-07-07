// Validaciones de UI del paño (F3 corte 1, losa maciza).
//
// PROPOSITO: validar EN EL MOMENTO de la edicion los datos que el usuario teclea en el
// inspector/panel del paño (nombre, material, espesor, tamaño de malla, apoyo de borde)
// ANTES de aplicarlos al modelo. Misma capa de UX que `validacionesViga.ts`: error campo
// a campo, con `campo` apuntando al control culpable. Cada `mensaje` va en LENGUAJE DE
// OBRA: espanol con tildes, SIN jerga FEM (nada de "quad", "nodo", "support"). El tono
// imita a `validaciones.ts` del discretizador.
//
// UNIDADES (CLAUDE.md §14): los valores que llegan AQUI estan ya en METROS (sistema
// interno); la UI convierte mm<->m en el borde de sus campos. La validacion razona en m.
//
// PURO: sin React, sin stores, sin IO. Recibe el `modelo` y los `datos` por parametro;
// devuelve la lista de errores (vacia = valido). Testeable en Node/jsdom sin render.
import type { Modelo } from "../../dominio";
import { getMaterial } from "../../biblioteca";
import { type ErrorCampo, esValido } from "./validacionesDialogo";
export { type ErrorCampo, esValido };

// Datos del paño tal como los aporta el inspector/panel. El material llega como id (o
// null mientras no se asigna). El apoyo de borde es un enum (el Segmentado solo emite
// valores validos). El nombre forma parte del contrato (unicidad), aunque el inspector
// solo-propiedades no lo edite (espejo de DatosVigaUI).
//
// Corte "forjado unidireccional" (T4.1): los campos uni (direccion de viguetas,
// intereje, canto, ancho de nervio, peso propio) son OPCIONALES aqui y SOLO se validan
// cuando `tipo === "unidireccional"`. Esta validacion de UX (campo a campo, feedback en
// vivo) es la primera linea; el borde Zod del dominio (union discriminada por `tipo`) es la
// garantia dura de presencia/positividad. Un paño losa no los porta.
export interface DatosPanoUI {
  nombre: string;
  tipo?: "losa" | "unidireccional"; // ausente -> se trata como losa (retrocompat)
  materialId: string | null;
  espesor: number; // m
  tamMalla: number; // m
  bordeApoyo: "simple" | "empotrado" | "libre";
  // Campos del forjado UNIDIRECCIONAL (m; pesoPropio en kN/m²). Presencia + positividad
  // se exigen SOLO bajo tipo "unidireccional".
  direccionViguetas?: "x" | "y";
  intereje?: number; // m
  canto?: number; // m
  anchoNervio?: number; // m
  pesoPropio?: number; // kN/m²
}

// Mensaje unico para un numero no finito (NaN tras Number("") o texto no numerico).
const MSG_NUMERO = "Introduce un número válido.";

// Valida los datos de un paño que se esta creando (panoId === null) o editando
// (panoId === id del paño en edicion, que se EXCLUYE de la comprobacion de unicidad de
// nombre para no chocar consigo mismo).
export function validarPano(
  modelo: Modelo,
  panoId: string | null,
  datos: DatosPanoUI,
): ErrorCampo[] {
  const errores: ErrorCampo[] = [];

  // 1. Nombre no vacio (tras trim) y unico entre los demas paños.
  const nombre = datos.nombre.trim();
  if (nombre === "") {
    errores.push({ campo: "nombre", mensaje: "El paño necesita un nombre." });
  } else {
    const duplicado = modelo.panos.some(
      (p) => p.id !== panoId && p.nombre === nombre,
    );
    if (duplicado) {
      errores.push({
        campo: "nombre",
        mensaje: `Ya existe un paño llamado "${nombre}". Usa un nombre distinto.`,
      });
    }
  }

  // 2. Material: asignado (no null) y existente en el catalogo de la biblioteca.
  if (datos.materialId === null) {
    errores.push({ campo: "materialId", mensaje: "Asigna un material al paño." });
  } else if (getMaterial(datos.materialId) === undefined) {
    errores.push({
      campo: "materialId",
      mensaje: "El material asignado al paño no existe.",
    });
  }

  // 3. Espesor: numero finito y positivo (es un canto fisico de losa).
  if (!Number.isFinite(datos.espesor)) {
    errores.push({ campo: "espesor", mensaje: MSG_NUMERO });
  } else if (datos.espesor <= 0) {
    errores.push({
      campo: "espesor",
      mensaje: "El espesor del paño debe ser mayor que cero.",
    });
  }

  // 4. Tamaño de malla: numero finito y positivo. Un tamaño de elemento <= 0 no
  // produce rejilla; el cap de quads lo gobierna el discretizador (4A), no la UI.
  if (!Number.isFinite(datos.tamMalla)) {
    errores.push({ campo: "tamMalla", mensaje: MSG_NUMERO });
  } else if (datos.tamMalla <= 0) {
    errores.push({
      campo: "tamMalla",
      mensaje: "El tamaño de malla debe ser mayor que cero.",
    });
  }

  // El apoyo de borde (simple/empotrado/libre) es un enum: el Segmentado no emite
  // valores invalidos, asi que no se valida aqui.

  // 5. Campos del forjado UNIDIRECCIONAL: solo se validan cuando el paño es de ese
  // tipo (feedback de UX campo a campo; el borde Zod es la garantia dura de positividad).
  // La direccion es un enum (Segmentado): no se valida. Intereje/canto/anchoNervio
  // deben ser finitos y > 0 (dimensiones fisicas); pesoPropio finito y >= 0 (0 es
  // legitimo: un forjado sin peso tabulado). Cada mensaje va en lenguaje de obra.
  if (datos.tipo === "unidireccional") {
    validarPositivo(errores, datos.intereje, "intereje", "El intereje debe ser mayor que cero.");
    validarPositivo(errores, datos.canto, "canto", "El canto de la vigueta debe ser mayor que cero.");
    validarPositivo(
      errores,
      datos.anchoNervio,
      "anchoNervio",
      "El ancho de nervio debe ser mayor que cero.",
    );
    if (!Number.isFinite(datos.pesoPropio)) {
      errores.push({ campo: "pesoPropio", mensaje: MSG_NUMERO });
    } else if ((datos.pesoPropio as number) < 0) {
      errores.push({
        campo: "pesoPropio",
        mensaje: "El peso propio no puede ser negativo.",
      });
    }
  }

  return errores;
}

// Valida que un campo uni sea finito y > 0; empuja el error `msg` al campo `campo` si
// no lo es. `valor` puede ser undefined (campo ausente en un paño que aun no tiene los
// datos uni): undefined es NaN por Number.isFinite -> dispara el error, coherente con
// que un unidireccional los exige.
function validarPositivo(
  errores: ErrorCampo[],
  valor: number | undefined,
  campo: string,
  msg: string,
): void {
  if (!Number.isFinite(valor)) {
    errores.push({ campo, mensaje: MSG_NUMERO });
  } else if ((valor as number) <= 0) {
    errores.push({ campo, mensaje: msg });
  }
}
