/**
 * Campos desconocidos del modelo físico y de las opciones (A-1, `docs/fem3d/fase-a0-a2.md`): un
 * campo opcional mal escrito («insercon», «diafragm», «Nu») no se ignora, porque el modelo se
 * calcularía en silencio con el valor por defecto (regla de oro 1). Es un error del compilador,
 * también para quien lo llame sin pasar por el esquema de `proyecto.json` (Concreta).
 *
 * Usa el esquema estructural que se genera de los tipos de `fisico.ts` (`fisico.schema.json`,
 * `scripts/generar-esquema.ts`) y sólo se queda con los campos desconocidos: los tipos y los valores
 * los comprueba `validar.ts` con sus propios códigos. Si el modelo tiene más de
 * `MAX_DIAGNOSTICOS_ESQUEMA` errores de esquema, sólo se miran los primeros.
 */
import type { Diagnosticos } from "../motor/diagnosticos.ts";
import { validarEsquema, type EsquemaRaiz } from "./esquema.ts";
import esquema from "./fisico.schema.json" with { type: "json" };

const FISICO = esquema as unknown as EsquemaRaiz;
const OPCIONES: EsquemaRaiz = { $ref: "#/$defs/OpcionesCompilacion", $defs: FISICO.$defs! };

/** Errores `fisico/campo-desconocido` y `opciones/campo-desconocido`, con el campo más parecido. */
export function camposDesconocidos(fisico: unknown, opciones: unknown, diag: Diagnosticos): void {
  for (const [dato, raiz, codigo, donde] of [
    [fisico, FISICO, "fisico/campo-desconocido", "el modelo"],
    [opciones ?? {}, OPCIONES, "opciones/campo-desconocido", "las opciones"],
  ] as const)
    for (const d of validarEsquema(raiz, dato))
      if (d.codigo === "esquema/campo-desconocido") diag.error(codigo, d.mensaje.replace(/^En el proyecto/, `En ${donde}`), d.ids, d.detalles);
}
