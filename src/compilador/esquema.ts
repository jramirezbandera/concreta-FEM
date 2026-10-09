/**
 * Validador de los esquemas de `proyecto.json` (A0) y del modelo físico (A-1, `campos.ts`): el
 * subconjunto de JSON Schema 2020-12 que genera `scripts/generar-esquema.ts` (`$ref` a `$defs`, `type`, `const`, `enum`, `properties`,
 * `required`, `additionalProperties`, `items`, `prefixItems`, `minItems`, `maxItems` y `anyOf`).
 * Una palabra clave fuera de él es un error del programa, no del proyecto.
 *
 * Los diagnósticos van en español y nombran la ruta del dato (`modelo.pilares[3].seccion`), el
 * tipo del objeto (Pilar) y su `id`, que también va en `ids`, como los del compilador. Un campo
 * desconocido propone el más parecido: casi siempre es una errata.
 *
 * Las uniones de objetos con un discriminante (`tipo`, `forma`: un `const` en cada variante) se
 * validan contra la variante que dice su valor, para no mezclar los errores de todas.
 */
import type { Diagnostico } from "../motor/diagnosticos.ts";

export interface Esquema {
  $ref?: string;
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  properties?: Record<string, Esquema>;
  required?: string[];
  additionalProperties?: boolean | Esquema;
  items?: boolean | Esquema;
  prefixItems?: Esquema[];
  minItems?: number;
  maxItems?: number;
  anyOf?: Esquema[];
  description?: string;
}

export interface EsquemaRaiz extends Esquema {
  $defs?: Record<string, Esquema>;
  $schema?: string;
  $id?: string;
  title?: string;
}

/** Máximo de diagnósticos de esquema: a partir de ahí, uno que dice cuántos más hay. */
export const MAX_DIAGNOSTICOS_ESQUEMA = 50;

const CLAVES = new Set(["$schema", "$id", "title", "$defs", "$ref", "type", "const", "enum", "properties", "required", "additionalProperties", "items", "prefixItems", "minItems", "maxItems", "anyOf", "description"]);

interface Lugar {
  ruta: string;
  /** Tipo con nombre ($defs) del objeto más cercano. */
  tipo?: string;
  /** Su id o, si no tiene, el del objeto con id que lo contiene (`heredado`). */
  id?: string;
  heredado?: boolean;
}

type Error_ = { codigo: string; mensaje: string; lugar: Lugar };

const tipoJson = (v: unknown): string => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "number" ? "number" : typeof v);

const NOMBRE_TIPO: Record<string, string> = { string: "un texto", number: "un número", boolean: "true o false", null: "null", array: "una lista", object: "un objeto" };

const mostrar = (v: unknown): string => {
  const t = JSON.stringify(v);
  return t === undefined ? String(v) : t.length > 60 ? `${t.slice(0, 57)}…` : t;
};

function distancia(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length]![b.length]!;
}

/** El campo válido más parecido a uno desconocido (distancia ≤ 2, o que sólo cambie en mayúsculas). */
function parecido(campo: string, validos: string[]): string | null {
  let mejor: string | null = null;
  let dm = 3;
  for (const v of validos) {
    const d = v.toLowerCase() === campo.toLowerCase() ? 0 : distancia(campo, v);
    if (d < dm) [mejor, dm] = [v, d];
  }
  return mejor;
}

export function validarEsquema(raiz: EsquemaRaiz, dato: unknown): Diagnostico[] {
  const defs = raiz.$defs ?? {};
  const resolver = (e: Esquema): [Esquema, string | undefined] => {
    let nombre: string | undefined;
    let r = e;
    while (r.$ref) {
      const m = /^#\/\$defs\/(.+)$/.exec(r.$ref);
      if (!m || !defs[m[1]!]) throw new Error(`Esquema: referencia ${r.$ref} sin definición`);
      nombre = m[1]!;
      r = defs[nombre]!;
    }
    return [r, nombre];
  };

  function validar(e0: Esquema, v: unknown, lugar: Lugar, errores: Error_[]): void {
    for (const k of Object.keys(e0)) if (!CLAVES.has(k)) throw new Error(`Esquema: palabra clave ${k} fuera del subconjunto del validador`);
    const [e, nombre] = resolver(e0);
    for (const k of Object.keys(e)) if (!CLAVES.has(k)) throw new Error(`Esquema: palabra clave ${k} fuera del subconjunto del validador`);
    // Un tipo con nombre sólo cambia el objeto del mensaje si el dato es un objeto (Reticular, Pilar);
    // en uno que no lo es (TipoPlanta, Vec2), el error es del objeto que lo contiene. El id es el
    // del propio objeto o, si no lo tiene, el del que lo contiene
    let aqui = lugar;
    if (nombre && tipoJson(v) === "object") {
      const id = (v as Record<string, unknown>).id;
      aqui = typeof id === "string" ? { ruta: lugar.ruta, tipo: nombre, id } : { ruta: lugar.ruta, tipo: nombre, id: lugar.id, heredado: lugar.id !== undefined };
    }
    if (e.anyOf) return variantes(e.anyOf, v, aqui, errores);
    if (e.type !== undefined) {
      const tipos = Array.isArray(e.type) ? e.type : [e.type];
      const t = tipoJson(v);
      if (!tipos.includes(t)) {
        errores.push({ codigo: "esquema/tipo", mensaje: `tiene que ser ${tipos.map((x) => NOMBRE_TIPO[x] ?? x).join(" o ")} y es ${NOMBRE_TIPO[t] ?? t} (${mostrar(v)})`, lugar: aqui });
        return;
      }
      if (t === "number" && !Number.isFinite(v)) {
        errores.push({ codigo: "esquema/tipo", mensaje: `tiene que ser un número finito y es ${String(v)}`, lugar: aqui });
        return;
      }
    }
    if ("const" in e && v !== e.const) {
      errores.push({ codigo: "esquema/valor", mensaje: `tiene que valer ${mostrar(e.const)} y vale ${mostrar(v)}`, lugar: aqui });
      return;
    }
    if (e.enum && !e.enum.includes(v as never)) {
      errores.push({ codigo: "esquema/valor", mensaje: `vale ${mostrar(v)}, que no es ninguno de los admitidos: ${e.enum.map(mostrar).join(", ")}`, lugar: aqui });
      return;
    }
    if (Array.isArray(v)) {
      if (e.minItems !== undefined && v.length < e.minItems) errores.push({ codigo: "esquema/longitud", mensaje: `tiene ${v.length} elementos y necesita ${e.minItems === e.maxItems ? "" : "al menos "}${e.minItems}`, lugar: aqui });
      else if (e.maxItems !== undefined && v.length > e.maxItems) errores.push({ codigo: "esquema/longitud", mensaje: `tiene ${v.length} elementos y admite ${e.minItems === e.maxItems ? "" : "como mucho "}${e.maxItems}`, lugar: aqui });
      v.forEach((x, i) => {
        const ei = e.prefixItems && i < e.prefixItems.length ? e.prefixItems[i]! : e.items;
        if (ei === undefined || ei === true) return;
        if (ei === false) return; // ya contado por maxItems
        validar(ei, x, { ...aqui, ruta: `${aqui.ruta}[${i}]` }, errores);
      });
      return;
    }
    if (tipoJson(v) === "object" && (e.properties || e.additionalProperties !== undefined)) {
      const o = v as Record<string, unknown>;
      const props = e.properties ?? {};
      for (const r of e.required ?? []) if (!(r in o) || o[r] === undefined) errores.push({ codigo: "esquema/falta", mensaje: `falta el campo obligatorio "${r}"`, lugar: aqui });
      for (const [k, x] of Object.entries(o)) {
        if (x === undefined) continue;
        const ruta = aqui.ruta ? `${aqui.ruta}.${k}` : k;
        const ek = props[k];
        if (ek) validar(ek, x, { ...aqui, ruta }, errores);
        else if (e.additionalProperties === false) {
          const p = parecido(k, Object.keys(props));
          errores.push({
            codigo: "esquema/campo-desconocido",
            mensaje: `"${k}" no es un campo ${aqui.tipo ? `de ${aqui.tipo}` : "admitido"}${p ? `; ¿quería decir "${p}"?` : `; los admitidos son: ${Object.keys(props).join(", ")}`}`,
            lugar: aqui,
          });
        } else if (typeof e.additionalProperties === "object") validar(e.additionalProperties, x, { ...aqui, ruta }, errores);
      }
    }
  }

  /** anyOf: por discriminante si lo hay; si no, la variante que valida o, si ninguna, la de menos errores. */
  function variantes(ramas: Esquema[], v: unknown, lugar: Lugar, errores: Error_[]): void {
    const resueltas = ramas.map((r) => resolver(r)[0]);
    if (tipoJson(v) === "object") {
      const o = v as Record<string, unknown>;
      const objetos = resueltas.filter((r) => r.properties);
      const candidatos = objetos.length ? Object.keys(objetos[0]!.properties!).filter((k) => objetos.every((r) => r.properties![k] && "const" in resolver(r.properties![k]!)[0])) : [];
      const disc = candidatos[0];
      if (disc && objetos.length === resueltas.filter((r) => r.type === "object" || r.properties).length) {
        const valores = objetos.map((r) => resolver(r.properties![disc]!)[0].const);
        const k = valores.findIndex((x) => x === o[disc]);
        if (k < 0) {
          const ruta = lugar.ruta ? `${lugar.ruta}.${disc}` : disc;
          errores.push({
            codigo: o[disc] === undefined ? "esquema/falta" : "esquema/valor",
            mensaje: o[disc] === undefined ? `falta el campo obligatorio "${disc}" (${valores.map(mostrar).join(", ")})` : `vale ${mostrar(o[disc])}, que no es ninguno de los admitidos: ${valores.map(mostrar).join(", ")}`,
            lugar: o[disc] === undefined ? lugar : { ...lugar, ruta },
          });
          return;
        }
        const rama = ramas[resueltas.indexOf(objetos[k]!)]!;
        return validar(rama, v, lugar, errores);
      }
    }
    // Antes que una variante que no admite el tipo del dato, una que sí (un nombre mal escrito en
    // `Psi | "uso-A" | …` es un valor que no está en la lista, no un objeto que falta)
    const coste = (e: Error_[]) => e.length + (e.every((x) => x.codigo === "esquema/tipo" && x.lugar.ruta === lugar.ruta) ? 1000 : 0);
    let mejor: Error_[] | null = null;
    for (const r of ramas) {
      const e: Error_[] = [];
      validar(r, v, lugar, e);
      if (!e.length) return;
      if (!mejor || coste(e) < coste(mejor)) mejor = e;
    }
    // Si ninguna variante admite el tipo del dato, un solo error con los tipos admitidos
    const tipos = resueltas.flatMap((r) => (r.type === undefined ? (r.anyOf ? ["varios"] : []) : Array.isArray(r.type) ? r.type : [r.type]));
    if (mejor!.every((x) => x.codigo === "esquema/tipo" && x.lugar.ruta === lugar.ruta) && !tipos.includes("varios"))
      errores.push({ codigo: "esquema/tipo", mensaje: `tiene que ser ${[...new Set(tipos)].map((x) => NOMBRE_TIPO[x] ?? x).join(" o ")} y es ${NOMBRE_TIPO[tipoJson(v)] ?? tipoJson(v)} (${mostrar(v)})`, lugar });
    else errores.push(...mejor!);
  }

  const errores: Error_[] = [];
  validar(raiz, dato, { ruta: "" }, errores);
  const diags: Diagnostico[] = errores.slice(0, MAX_DIAGNOSTICOS_ESQUEMA).map(({ codigo, mensaje, lugar }) => {
    const donde = lugar.ruta ? `En ${lugar.ruta}` : "En el proyecto";
    const objeto = lugar.tipo ? ` (${lugar.tipo}${lugar.id !== undefined ? `${lugar.heredado ? " de" : ""} ${lugar.id}` : ""})` : "";
    return {
      codigo,
      severidad: "error",
      mensaje: `${donde}${objeto}: ${mensaje}.`,
      ...(lugar.id !== undefined ? { ids: [lugar.id] } : {}),
      detalles: { ruta: lugar.ruta },
    };
  });
  if (errores.length > MAX_DIAGNOSTICOS_ESQUEMA)
    diags.push({ codigo: "esquema/demasiados", severidad: "error", mensaje: `Hay ${errores.length - MAX_DIAGNOSTICOS_ESQUEMA} errores de esquema más; se muestran los ${MAX_DIAGNOSTICOS_ESQUEMA} primeros.` });
  return diags;
}
