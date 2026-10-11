/**
 * Formato canónico del `proyecto.json` que escribe el editor (V2a, `docs/fem3d/visor.md` §6.1):
 * JSON con 2 espacios, las claves de cada objeto en el orden de los tipos (el de `properties` en el
 * esquema, que se genera de ellos) y las listas de números (puntos, vectores, liberaciones) en una
 * línea. Un proyecto escrito a mano o por el agente cambia de formato la primera vez que se guarda,
 * pero no de contenido ni de huella (criterio 1 de V2a), y guardar otra vez da los mismos bytes.
 *
 * Los números se escriben como `JSON.stringify` (el más corto que vuelve al mismo double).
 *
 * Puro: sin IO.
 */
import { esquema, type Proyecto } from "../agente/proyecto.ts";
import type { Esquema, EsquemaRaiz } from "../compilador/esquema.ts";

/** Ancho máximo de una lista en una línea (con su sangría); si no cabe, un elemento por línea. */
const ANCHO = 120;

function resolver(raiz: EsquemaRaiz, e: Esquema | undefined): Esquema | undefined {
  let x = e;
  for (let i = 0; x?.$ref && i < 32; i++) x = raiz.$defs?.[x.$ref.replace("#/$defs/", "")];
  return x;
}

/** La variante de una unión que corresponde a un objeto: la que tiene todas sus claves y cumple sus `const`. */
function variante(raiz: EsquemaRaiz, e: Esquema, v: Record<string, unknown>): Esquema | undefined {
  const r = resolver(raiz, e);
  if (!r?.anyOf) return r;
  const objetos = r.anyOf.map((x) => resolver(raiz, x)).filter((x): x is Esquema => !!x?.properties);
  const casa = (x: Esquema) =>
    Object.keys(v).every((k) => k in x.properties!) &&
    Object.entries(x.properties!).every(([k, p]) => {
      const q = resolver(raiz, p);
      return q?.const === undefined || v[k] === undefined || v[k] === q.const;
    });
  return objetos.find(casa) ?? objetos[0];
}

/** Copia de `v` con las claves de cada objeto en el orden del esquema (las que no están en él, al final por orden alfabético). */
export function ordenarClaves(v: unknown, e: Esquema | undefined, raiz: EsquemaRaiz = esquema()): unknown {
  if (Array.isArray(v)) {
    const r = resolver(raiz, e);
    return v.map((x, i) => ordenarClaves(x, r?.prefixItems?.[i] ?? (typeof r?.items === "object" ? r.items : undefined), raiz));
  }
  if (v === null || typeof v !== "object") return v;
  const o = v as Record<string, unknown>;
  const s = variante(raiz, e ?? {}, o);
  const props = s?.properties ?? {};
  const claves = [...Object.keys(props).filter((k) => k in o), ...Object.keys(o).filter((k) => !(k in props)).sort()];
  const r: Record<string, unknown> = {};
  for (const k of claves) if (o[k] !== undefined) r[k] = ordenarClaves(o[k], props[k] ?? (typeof s?.additionalProperties === "object" ? s.additionalProperties : undefined), raiz);
  return r;
}

const primitivo = (v: unknown) => v === null || typeof v !== "object";
const plano = (v: unknown): boolean => Array.isArray(v) && v.every((x) => primitivo(x) || (Array.isArray(x) && x.every(primitivo)));

function escribir(v: unknown, sangria: string): string {
  if (primitivo(v)) return JSON.stringify(v) ?? "null";
  const dentro = sangria + "  ";
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    if (plano(v)) {
      const linea = `[${v.map((x) => (Array.isArray(x) ? `[${x.map((y) => JSON.stringify(y)).join(", ")}]` : JSON.stringify(x))).join(", ")}]`;
      if (sangria.length + linea.length <= ANCHO || v.every(primitivo)) return linea;
    }
    return `[\n${v.map((x) => dentro + escribir(x, dentro)).join(",\n")}\n${sangria}]`;
  }
  const o = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
  if (o.length === 0) return "{}";
  return `{\n${o.map(([k, x]) => `${dentro}${JSON.stringify(k)}: ${escribir(x, dentro)}`).join(",\n")}\n${sangria}}`;
}

/** El texto canónico de un proyecto, con salto de línea al final. */
export function serializar(p: Proyecto): string {
  const raiz = esquema();
  return escribir(ordenarClaves(p, raiz, raiz), "") + "\n";
}
