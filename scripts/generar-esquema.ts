/**
 * Genera el JSON Schema de `proyecto.json` (A0) desde el tipo `Proyecto` de `src/agente/proyecto.ts`
 * con la API del compilador de TypeScript: los tipos son la única fuente, y sus comentarios, las
 * descripciones. La del modelo físico es la cabecera de `fisico.ts`, con sus convenios.
 *
 * Reglas de la traducción:
 * - interfaces y alias no genéricos con nombre → `$defs`; lo demás (tipos anónimos, `Omit<…>`,
 *   `Seis<…>`), en línea;
 * - objetos con `additionalProperties: false` (un campo mal escrito es un error, no un dato que se
 *   ignora) y `required` con los campos no opcionales;
 * - tuplas → `prefixItems` con su longitud fija; uniones de literales → `enum`; las demás uniones →
 *   `anyOf` (el validador elige la variante por su discriminante, `tipo` o `forma`).
 *
 * Escribe también el esquema estructural del modelo físico (`src/compilador/fisico.schema.json`):
 * las definiciones del modelo y de las opciones, sin descripciones, con las que `compilar` rechaza
 * los campos desconocidos (A-1, `src/compilador/campos.ts`).
 *
 * Uso: bun scripts/generar-esquema.ts → src/agente/proyecto.schema.json y
 * src/compilador/fisico.schema.json (el test `src/agente/esquema.test.ts` comprueba que los
 * versionados son los que salen de los tipos).
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const RAIZ = join(import.meta.dirname, "..");
export const RUTA_ESQUEMA = join(RAIZ, "src", "agente", "proyecto.schema.json");
export const RUTA_ESQUEMA_FISICO = join(RAIZ, "src", "compilador", "fisico.schema.json");

type Esquema = Record<string, unknown>;

/** Texto de un comentario /** … *\/ sin sus marcas. */
function textoJsDoc(c: string): string {
  return c
    .replace(/^\/\*\*\s?/, "")
    .replace(/\s*\*\/$/, "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*\* ?/, ""))
    .join("\n")
    .trim();
}

/**
 * El comentario JSDoc que precede a un nodo, también a un miembro de una unión (que no tiene
 * símbolo, y cuyo comentario va antes de su `|`).
 */
function jsDocPrevio(nodo: ts.Node): string | undefined {
  const texto = nodo.getSourceFile().text;
  let i = nodo.getStart() - 1;
  while (i >= 0 && /[\s|]/.test(texto[i]!)) i--;
  if (i < 1 || texto.slice(i - 1, i + 1) !== "*/") return undefined;
  const ini = texto.lastIndexOf("/**", i);
  return ini < 0 ? undefined : textoJsDoc(texto.slice(ini, i + 1));
}

export function generarEsquema(): Esquema {
  const fichero = join(RAIZ, "src", "agente", "proyecto.ts");
  const programa = ts.createProgram([fichero], {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    resolveJsonModule: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  });
  const tc = programa.getTypeChecker();
  const sf = programa.getSourceFile(fichero)!;
  const decl = sf.statements.find((s): s is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(s) && s.name.text === "Proyecto");
  if (!decl) throw new Error("No encuentro la interfaz Proyecto");

  const defs: Record<string, Esquema> = {};
  const origen = new Map<string, ts.Declaration>();
  const enCurso = new Set<string>();

  const documentacion = (s: ts.Symbol): string | undefined => {
    const t = ts.displayPartsToString(s.getDocumentationComment(tc)).trim();
    return t || undefined;
  };

  /** Nombre de $defs de un tipo, si lo tiene: interfaz o alias no genérico del proyecto. */
  const nombreDe = (t: ts.Type): { nombre: string; simbolo: ts.Symbol } | null => {
    const alias = t.aliasSymbol;
    if (alias) {
      if (t.aliasTypeArguments?.length) return null;
      return { nombre: alias.name, simbolo: alias };
    }
    const s = t.getSymbol();
    if (s && s.flags & ts.SymbolFlags.Interface) return { nombre: s.name, simbolo: s };
    return null;
  };

  const delProyecto = (s: ts.Symbol) => (s.declarations ?? []).some((d) => !d.getSourceFile().fileName.includes("node_modules"));

  const conDescripcion = (e: Esquema, d: string | undefined): Esquema => (d ? { ...e, description: d } : e);

  function aEsquema(t: ts.Type): Esquema {
    const n = nombreDe(t);
    if (n && delProyecto(n.simbolo)) {
      const d0 = n.simbolo.declarations![0]!;
      const previo = origen.get(n.nombre);
      if (previo && previo !== d0) throw new Error(`Dos tipos distintos se llaman ${n.nombre}`);
      if (!previo) {
        origen.set(n.nombre, d0);
        enCurso.add(n.nombre);
        defs[n.nombre] = {};
        const e = cuerpo(t);
        const desc = n.nombre === "ModeloFisico" ? cabeceraFisico() : documentacion(n.simbolo);
        defs[n.nombre] = conDescripcion(e, desc);
        enCurso.delete(n.nombre);
      }
      return { $ref: `#/$defs/${n.nombre}` };
    }
    return cuerpo(t);
  }

  function cabeceraFisico(): string {
    const f = programa.getSourceFiles().find((s) => s.fileName.endsWith("compilador/fisico.ts"))!;
    const r = ts.getLeadingCommentRanges(f.text, 0)![0]!;
    return textoJsDoc(f.text.slice(r.pos, r.end));
  }

  function literal(t: ts.Type): string | number | boolean | null | undefined {
    if (t.isStringLiteral()) return t.value;
    if (t.isNumberLiteral()) return t.value;
    if (t.flags & ts.TypeFlags.BooleanLiteral) return (t as unknown as { intrinsicName: string }).intrinsicName === "true";
    if (t.flags & ts.TypeFlags.Null) return null;
    return undefined;
  }

  function cuerpo(t: ts.Type): Esquema {
    if (t.flags & ts.TypeFlags.String) return { type: "string" };
    if (t.flags & ts.TypeFlags.Number) return { type: "number" };
    if (t.flags & ts.TypeFlags.Boolean) return { type: "boolean" };
    if (t.flags & ts.TypeFlags.Null) return { type: "null" };
    const lit = literal(t);
    if (lit !== undefined) return { const: lit };
    if (t.isUnion()) {
      let ramas = t.types.filter((u) => !(u.flags & ts.TypeFlags.Undefined));
      // true | false → boolean
      const booleanos = ramas.filter((u) => u.flags & ts.TypeFlags.BooleanLiteral);
      const conBoolean = booleanos.length === 2;
      if (conBoolean) ramas = ramas.filter((u) => !(u.flags & ts.TypeFlags.BooleanLiteral));
      if (!conBoolean && ramas.length === 1) return aEsquema(ramas[0]!);
      // En orden alfabético: el de las uniones del compilador de TypeScript depende de su versión
      if (ramas.every((u) => literal(u) !== undefined && literal(u) !== null) && !conBoolean) return { enum: ramas.map(literal).sort((a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0)) };
      const primitivos = ramas.every((u) => u.flags & (ts.TypeFlags.String | ts.TypeFlags.Number | ts.TypeFlags.Null));
      const ORDEN = ["string", "number", "boolean", "null"];
      if (primitivos)
        return { type: [...ramas.map((u) => (u.flags & ts.TypeFlags.String ? "string" : u.flags & ts.TypeFlags.Number ? "number" : "null")), ...(conBoolean ? ["boolean"] : [])].sort((a, b) => ORDEN.indexOf(a) - ORDEN.indexOf(b)) };
      const variantes = ramas.map((u) => {
        const e = aEsquema(u);
        const s = u.getSymbol();
        const d = s && s.name === "__type" && s.declarations?.[0] ? jsDocPrevio(s.declarations[0]) : undefined;
        return conDescripcion(e, d);
      });
      if (conBoolean) variantes.push({ type: "boolean" });
      return { anyOf: variantes };
    }
    if (tc.isTupleType(t)) {
      const ref = t as ts.TypeReference;
      const args = tc.getTypeArguments(ref);
      const objetivo = ref.target as ts.TupleType;
      if (objetivo.hasRestElement || objetivo.minLength !== args.length) throw new Error(`Tupla de longitud variable: ${tc.typeToString(t)}`);
      return { type: "array", prefixItems: args.map((a) => aEsquema(a)), items: false, minItems: args.length, maxItems: args.length };
    }
    if (tc.isArrayType(t)) {
      const [el] = tc.getTypeArguments(t as ts.TypeReference);
      return { type: "array", items: aEsquema(el!) };
    }
    if (t.flags & ts.TypeFlags.Object) {
      const propiedades: Record<string, Esquema> = {};
      const obligatorias: string[] = [];
      for (const p of tc.getPropertiesOfType(t)) {
        const opcional = (p.flags & ts.SymbolFlags.Optional) !== 0;
        // Desde el nodo del tipo, para conservar el nombre del alias (`tipo?: TipoPlanta`); sin él
        // (propiedades de un tipo mapeado), el del símbolo, con el undefined de la opcional
        const d = p.declarations?.[0];
        const tp = d && ts.isPropertySignature(d) && d.type ? tc.getTypeFromTypeNode(d.type) : tc.getTypeOfSymbol(p);
        propiedades[p.name] = conDescripcion(aEsquema(tp), documentacion(p));
        if (!opcional) obligatorias.push(p.name);
      }
      const indice = tc.getIndexInfosOfType(t);
      if (indice.length) {
        if (Object.keys(propiedades).length || indice.length > 1) throw new Error(`Objeto con índice y propiedades: ${tc.typeToString(t)}`);
        return { type: "object", additionalProperties: aEsquema(indice[0]!.type) };
      }
      return { type: "object", properties: propiedades, ...(obligatorias.length ? { required: obligatorias } : {}), additionalProperties: false };
    }
    throw new Error(`Tipo sin traducción al esquema: ${tc.typeToString(t)}`);
  }

  const tipo = tc.getDeclaredTypeOfSymbol(tc.getSymbolAtLocation(decl.name)!);
  const raiz = cuerpo(tipo);
  const ordenados: Record<string, Esquema> = {};
  for (const k of Object.keys(defs).sort()) ordenados[k] = defs[k]!;
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:concreta-fem:proyecto@1",
    title: "Proyecto de Concreta FEM 3D",
    description: documentacion(tc.getSymbolAtLocation(decl.name)!),
    ...raiz,
    $defs: ordenados,
  };
}

/** El texto del esquema, tal como se versiona. */
export function textoEsquema(): string {
  return `${JSON.stringify(generarEsquema(), null, 2)}\n`;
}

/**
 * El esquema estructural del modelo físico: la raíz es `ModeloFisico`, y en `$defs` van las
 * definiciones que alcanzan el modelo y las opciones (`OpcionesCompilacion`), sin descripciones.
 */
export function esquemaFisico(proyecto: Esquema = generarEsquema()): Esquema {
  const defs = proyecto.$defs as Record<string, Esquema>;
  const sinDescripcion = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sinDescripcion) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== "description").map(([k, x]) => [k, sinDescripcion(x)])) : v;
  const usadas = new Set<string>();
  const visitar = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(visitar);
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) {
        if (k === "$ref" && typeof x === "string") {
          const n = x.replace("#/$defs/", "");
          if (!usadas.has(n)) {
            usadas.add(n);
            visitar(defs[n]);
          }
        } else visitar(x);
      }
  };
  visitar([{ $ref: "#/$defs/ModeloFisico" }, { $ref: "#/$defs/OpcionesCompilacion" }]);
  const ordenados: Record<string, unknown> = {};
  for (const k of [...usadas].sort()) ordenados[k] = sinDescripcion(defs[k]);
  return { $schema: "https://json-schema.org/draft/2020-12/schema", $id: "urn:concreta-fem:fisico@1", title: "Modelo físico de Concreta FEM 3D (estructura)", $ref: "#/$defs/ModeloFisico", $defs: ordenados };
}

export function textoEsquemaFisico(proyecto?: Esquema): string {
  return `${JSON.stringify(esquemaFisico(proyecto), null, 2)}\n`;
}

if (import.meta.main) {
  const e = generarEsquema();
  writeFileSync(RUTA_ESQUEMA, `${JSON.stringify(e, null, 2)}\n`);
  writeFileSync(RUTA_ESQUEMA_FISICO, textoEsquemaFisico(e));
  console.log(`Esquemas escritos en ${RUTA_ESQUEMA} y ${RUTA_ESQUEMA_FISICO}`);
}
