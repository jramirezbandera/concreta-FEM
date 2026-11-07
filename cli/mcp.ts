#!/usr/bin/env bun
/**
 * Servidor MCP de Concreta FEM 3D (`docs/fem3d/agente.md` §13.3): la CLI `fem` como herramientas,
 * para usarla sin terminal desde Claude Desktop (o cualquier cliente MCP). `bun run instalar` lo
 * registra en Claude Desktop; a mano: `bun "<repo>/cli/mcp.ts"` por stdio.
 *
 * - **Protocolo:** JSON-RPC 2.0 por stdio, un mensaje por línea (el transporte stdio de MCP). Se
 *   escribe a mano, sin el SDK: sólo `initialize`, `ping`, `tools/*`, `resources/*` y `prompts/list`.
 *   Por la salida estándar no sale nada más (los errores, a la de errores).
 * - **Las órdenes** (`validar`, `calcular`, `consultar`, `render`, `revisar`, `importar_dxf`,
 *   `seleccion`…) son `ejecutar` de `cli/ordenes.ts` con los mismos argumentos: la misma salida JSON.
 *   Van de una en una, con la carpeta del proyecto como carpeta de trabajo (las rutas de la salida,
 *   relativas a ella; `carpetaProyecto` dice cuál es). `render` devuelve además las PNG.
 * - **El fichero**, para clientes que no tienen herramientas de ficheros: `leer_proyecto` (el texto
 *   y su sello), `editar` (las operaciones del editor de la app, que nunca dejan una referencia rota)
 *   y `escribir_proyecto` (el texto entero, con el sello de la lectura: si el fichero cambió desde
 *   entonces, no se escribe). Los dos escriben en la forma canónica y dejan la copia `.bak`, como la
 *   app.
 * - **La guía:** la skill `fem`, en las instrucciones del servidor, en el recurso `fem://skill` y en la
 *   herramienta `guia` (no todos los clientes leen las instrucciones).
 * - **`visor`** abre la app sobre el proyecto (el servidor local de `fem visor`) y la abre en el
 *   navegador; se cierra con el servidor MCP.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { leerProyecto, type Proyecto } from "../src/agente/proyecto.ts";
import { CONSULTAS } from "../src/agente/consultas.ts";
import { VISTAS } from "../src/agente/render/index.ts";
import { SITUACIONES } from "../src/combinaciones/generador.ts";
import { aplicar, type Operacion } from "../src/editor/operaciones.ts";
import { serializar } from "../src/editor/serializar.ts";
import { ejecutar, RAIZ, RUTA_ESQUEMA, textoSalida } from "./ordenes.ts";

export const VERSIONES_PROTOCOLO = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const NOMBRE = "concreta-fem";
/** Imágenes de `render` que se devuelven como mucho (las demás, sólo en la lista). */
const MAX_IMAGENES = 12;

// ─── La guía ────────────────────────────────────────────────────────────────────────────────────

const RUTA_SKILL = join(RAIZ, ".claude", "skills", "fem", "SKILL.md");
const RUTA_EJEMPLO = join(RAIZ, ".claude", "skills", "fem", "ejemplo.json");

const PREAMBULO = `Concreta FEM 3D por MCP. Aquí no hay terminal: cada orden «fem X …» de la guía es la herramienta X de este servidor (fem validar → validar, fem importar-dxf → importar_dxf…), con los mismos datos. Las rutas, absolutas (la carpeta de la obra del ingeniero). Si no tienes herramientas de ficheros, lee el proyecto con leer_proyecto y cámbialo con editar (operaciones) o escribir_proyecto (el texto entero, con el sello de la lectura). Las figuras de render llegan como imágenes. La app se abre con visor.

`;

export function guia(): string {
  const t = readFileSync(RUTA_SKILL, "utf8");
  return PREAMBULO + t.replace(/^---[\s\S]*?---\s*/, "");
}

// ─── Herramientas ───────────────────────────────────────────────────────────────────────────────

type Esquema = Record<string, unknown>;
interface Herramienta {
  name: string;
  description: string;
  inputSchema: Esquema;
}

const ruta = (d: string): Esquema => ({ type: "string", description: d });
const PROYECTO = ruta("Ruta absoluta del proyecto.json.");
const COMBINACIONES: Record<string, Esquema> = {
  casos: { type: "boolean", description: "Los casos sueltos, sin combinar." },
  situacion: { type: "array", items: { type: "string", enum: [...SITUACIONES] }, description: "Situaciones de proyecto (CTE/NCSE)." },
  combinacion: { type: "array", items: { type: "string" }, description: "Combinaciones dadas, como «1.35*G+1.5*Q»." },
  caso: { type: "array", items: { type: "string" }, description: "Casos sueltos por su id." },
};
const obj = (properties: Record<string, Esquema>, required: string[] = []): Esquema => ({ type: "object", properties, required, additionalProperties: false });

export const HERRAMIENTAS: Herramienta[] = [
  { name: "guia", description: "La guía de trabajo con Concreta FEM (la skill fem): reglas, flujo, la lista de datos del encargo, los convenios del fichero y las consultas. Léela antes de empezar.", inputSchema: obj({}) },
  { name: "esquema", description: "El JSON Schema del proyecto.json (sus descripciones son los convenios). Sin «tipo», la lista de tipos y la raíz; con «tipo» (Losa, Pilar, CargaFisica…), su definición.", inputSchema: obj({ tipo: { type: "string" } }) },
  { name: "leer_proyecto", description: "El texto del proyecto.json y su sello (para escribir_proyecto). Léelo justo antes de cambiarlo: el ingeniero puede haberlo guardado desde la app.", inputSchema: obj({ proyecto: PROYECTO }, ["proyecto"]) },
  {
    name: "escribir_proyecto",
    description: "Escribe el proyecto.json entero (en su forma canónica, con la copia .bak del anterior). Para un fichero que ya existe hace falta el sello de leer_proyecto: si cambió desde entonces, no se escribe. Sin sello, sólo crea un fichero nuevo. Tiene que cumplir el esquema.",
    inputSchema: obj({ proyecto: PROYECTO, texto: { type: "string", description: "El JSON del proyecto." }, sello: { type: "string" } }, ["proyecto", "texto"]),
  },
  {
    name: "editar",
    description:
      'Cambia el proyecto.json con operaciones del editor de la app, que nunca dejan una referencia rota: {"op":"crear","coleccion":"pilares","objeto":{…}}, {"op":"cambiar","coleccion":"vigas","id":"V1","objeto":{…el objeto entero…}}, {"op":"borrar","ids":["P3"],"dependientes":"borrar"}, {"op":"renumerar"}, {"op":"datos","nombre":"…"}. Colecciones: plantas, materiales, secciones, pilares, vigas, barras, apoyos, casos, cargas, losas, apoyosLineales, bandas, muros, panos, ejes. Van todas o ninguna, y se escriben en la forma canónica (con .bak).',
    inputSchema: obj({ proyecto: PROYECTO, operaciones: { type: "array", items: { type: "object" } }, sello: { type: "string", description: "Opcional: el de leer_proyecto, para no cambiar un fichero que cambió después." } }, ["proyecto", "operaciones"]),
  },
  { name: "validar", description: "Esquema y compilación, con los avisos de sensatez que no necesitan el cálculo. Corrige hasta ok: true.", inputSchema: obj({ proyecto: PROYECTO }, ["proyecto"]) },
  { name: "compilar", description: "Compila: estadísticas e hipótesis del modelo analítico.", inputSchema: obj({ proyecto: PROYECTO }, ["proyecto"]) },
  { name: "resumen", description: "Plantas, piezas y la carga de cada planta y caso (con el peso propio): compruébalo antes de calcular.", inputSchema: obj({ proyecto: PROYECTO }, ["proyecto"]) },
  { name: "calcular", description: "Calcula (o reutiliza los resultados de la misma huella en .fem/).", inputSchema: obj({ proyecto: PROYECTO, recalcular: { type: "boolean" } }, ["proyecto"]) },
  {
    name: "consultar",
    description: "Resultados acotados: envolventes, flechas, deriva, reacciones, pieza <id>, franjas, franja <id>, refuerzos, banda <id>, combinaciones.",
    inputSchema: obj(
      {
        proyecto: PROYECTO,
        consulta: { type: "string", enum: [...CONSULTAS] },
        id: { type: "string", description: "El de pieza, franja o banda." },
        planta: { type: "string" },
        tipo: { type: "string", enum: ["pilar", "viga", "vigueta", "barra"] },
        objeto: { type: "string" },
        losa: { type: "string" },
        armadura: { type: "string", enum: ["x-inf", "x-sup", "y-inf", "y-sup"] },
        top: { type: "integer", minimum: 1 },
        todos: { type: "boolean" },
        estaciones: { type: "boolean" },
        exacto: { type: "boolean", description: "Todos los decimales (por defecto, 6 cifras significativas)." },
        ...COMBINACIONES,
      },
      ["proyecto", "consulta"],
    ),
  },
  {
    name: "render",
    description: "Dibuja las plantas (PNG y SVG en .fem/<huella>/render/) y devuelve las PNG para mirarlas. Un número nunca se lee de una imagen: sale del JSON (extremos) o de una consulta.",
    inputSchema: obj(
      {
        proyecto: PROYECTO,
        vista: { type: "array", items: { type: "string", enum: [...VISTAS] } },
        planta: { type: "array", items: { type: "string" } },
        escala: { type: "string" },
        envolvente: { type: "string", enum: ["max", "min"] },
        imagenes: { type: "integer", minimum: 0, maximum: MAX_IMAGENES, description: `Cuántas PNG devolver (por defecto, 4; como mucho, ${MAX_IMAGENES}).` },
        ...COMBINACIONES,
      },
      ["proyecto"],
    ),
  },
  { name: "revisar", description: "Sensatez e informe de revisión (Markdown y HTML) de esta huella. Ningún resultado se da por bueno sin él.", inputSchema: obj({ proyecto: PROYECTO, recalcular: { type: "boolean" } }, ["proyecto"]) },
  { name: "seleccion", description: "Lo que el ingeniero tiene elegido en la app (planta, espacio y objetos, tal como están en el fichero): para «esta viga» o «lo que tengo elegido».", inputSchema: obj({ proyecto: PROYECTO }, ["proyecto"]) },
  {
    name: "emplazamiento",
    description:
      "El municipio de la obra para el sismo y el viento: su código INE (el «ine» de acciones.emplazamiento, común al viento y al sismo), ab y K del Anejo 1 de la NCSE-02 y la zona eólica de la capital de su provincia, con el aviso si la provincia tiene más de una. Estos datos salen de aquí, nunca de memoria. Un municipio que no figura no se da por exento.",
    inputSchema: obj({ municipio: { type: "string", description: "El nombre del municipio (o parte), su código INE de 5 cifras, o una provincia." }, top: { type: "integer", minimum: 1, description: "Cuántos municipios dar (por defecto, 20)." } }, ["municipio"]),
  },
  {
    name: "importar_dxf",
    description: "Lee un plano DXF o DWG (de R14 a 2018) y propone el proyecto (plantas, pilares, contornos de losa, ejes). Sin «salida», sólo dice lo que ve y las capas; con ella, escribe el proyecto (nunca encima de otro).",
    inputSchema: obj(
      {
        plano: ruta("Ruta absoluta del .dxf o el .dwg."),
        salida: ruta("Ruta absoluta del proyecto.json que se escribe."),
        capa_pilares: { type: "array", items: { type: "string" } },
        capa_losas: { type: "array", items: { type: "string" } },
        capa_ejes: { type: "array", items: { type: "string" } },
        plantas: { type: "array", items: obj({ id: { type: "string" }, cota: { type: "number" } }, ["id", "cota"]), description: "Las plantas con su cota (la de la cara superior del forjado), m." },
        planta_losas: { type: "string" },
        material: { type: "string" },
        espesor: { type: "number" },
        unidades: { type: "string", enum: ["m", "cm", "mm", "in", "ft"] },
        nombre: { type: "string" },
      },
      ["plano"],
    ),
  },
  { name: "visor", description: "Abre la app sobre el proyecto, para el ingeniero (en el navegador, con un servidor local). Con «nuevo», crea antes el proyecto con la plantilla.", inputSchema: obj({ proyecto: PROYECTO, nuevo: { type: "boolean" }, abrir: { type: "boolean", description: "Abrir el navegador (por defecto, sí)." } }, ["proyecto"]) },
];

// ─── Resultado de una herramienta ───────────────────────────────────────────────────────────────

type Contenido = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
export interface ResultadoHerramienta {
  content: Contenido[];
  isError?: boolean;
}

const texto = (x: unknown, cifras: number | null = 6): Contenido => ({ type: "text", text: textoSalida(x, cifras) });
const fallo = (mensaje: string): ResultadoHerramienta => ({ content: [texto({ ok: false, diagnosticos: [{ codigo: "mcp/argumentos", severidad: "error", mensaje }] })], isError: true });

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

function absoluta(x: unknown, que: string): string | { error: string } {
  if (typeof x !== "string" || !x) return { error: `Falta «${que}».` };
  if (!isAbsolute(x)) return { error: `«${que}» tiene que ser una ruta absoluta (${x}).` };
  return resolve(x);
}

/** Escribe el texto canónico con su `.bak`, por un temporal (nunca queda medio escrito). */
function escribirCanonico(f: string, p: Proyecto): string {
  const t = serializar(p);
  if (existsSync(f)) writeFileSync(`${f}.bak`, readFileSync(f));
  const tmp = join(dirname(f), `.${basename(f)}.${process.pid}.tmp`);
  writeFileSync(tmp, t, "utf8");
  renameSync(tmp, f);
  return t;
}

/** Los argumentos de la CLI a partir de los de una herramienta. */
function argv(orden: string, a: Record<string, unknown>, posicionales: string[]): string[] {
  const r = [orden, ...posicionales];
  const bandera = (n: string, v: unknown) => {
    if (v === undefined || v === null || v === false) return;
    if (v === true) r.push(`--${n}`);
    else if (Array.isArray(v)) for (const x of v) r.push(`--${n}`, String(x));
    else r.push(`--${n}`, String(v));
  };
  for (const [k, v] of Object.entries(a)) {
    if (["proyecto", "plano", "consulta", "id", "imagenes", "abrir", "nuevo", "plantas"].includes(k)) continue;
    bandera(k.replace(/_/g, "-"), v);
  }
  return r;
}

/** Las órdenes, de una en una (cambian de carpeta de trabajo). */
let cola: Promise<unknown> = Promise.resolve();
const enCola = <T>(f: () => Promise<T>): Promise<T> => {
  const p = cola.then(f, f);
  cola = p.catch(() => {});
  return p;
};

async function orden(argumentos: string[], carpeta: string): Promise<{ codigo: number; json: Record<string, unknown> }> {
  return enCola(async () => {
    const antes = process.cwd();
    process.chdir(carpeta);
    try {
      const s = await ejecutar(argumentos);
      return { codigo: s.codigo, json: { ...s.json, carpetaProyecto: carpeta } };
    } finally {
      process.chdir(antes);
    }
  });
}

const visores = new Map<string, { proceso: ChildProcess; url: string }>();

function abrirNavegador(url: string): void {
  const [c, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  spawn(c, args as string[], { stdio: "ignore", detached: true }).unref();
}

async function visor(f: string, nuevo: boolean, abrir: boolean): Promise<ResultadoHerramienta> {
  const ya = visores.get(f);
  if (ya && ya.proceso.exitCode === null) {
    if (abrir) abrirNavegador(ya.url);
    return { content: [texto({ ok: true, url: ya.url, yaAbierto: true })] };
  }
  const p = spawn(process.execPath, [join(RAIZ, "app", "visor.ts"), f, ...(nuevo ? ["--nuevo"] : [])], { cwd: dirname(f), stdio: ["ignore", "pipe", "pipe"] });
  const url = await new Promise<string | { error: string }>((res) => {
    let salida = "";
    const t = setTimeout(() => res({ error: `El visor no arrancó en 60 s: ${salida.slice(-500)}` }), 60_000);
    const leer = (d: Buffer) => {
      salida += d.toString();
      const m = /(http:\/\/127\.0\.0\.1:\d+\/\S*)/.exec(salida);
      if (m) {
        clearTimeout(t);
        res(m[1]!);
      }
    };
    p.stdout!.on("data", leer);
    p.stderr!.on("data", (d: Buffer) => (salida += d.toString()));
    p.on("exit", (c) => {
      clearTimeout(t);
      res({ error: `El visor se cerró (código ${c}): ${salida.slice(-500)}` });
    });
  });
  if (typeof url !== "string") return { content: [texto({ ok: false, diagnosticos: [{ codigo: "mcp/visor", severidad: "error", mensaje: url.error }] })], isError: true };
  visores.set(f, { proceso: p, url });
  if (abrir) abrirNavegador(url);
  return { content: [texto({ ok: true, url, nota: "La app vigila el fichero: lo que cambies se ve allí solo. Se cierra con este servidor." })] };
}

export async function llamar(nombre: string, a: Record<string, unknown> = {}): Promise<ResultadoHerramienta> {
  switch (nombre) {
    case "guia":
      return { content: [{ type: "text", text: guia() }] };
    case "esquema": {
      const e = JSON.parse(readFileSync(RUTA_ESQUEMA, "utf8")) as { $defs: Record<string, unknown>; properties: unknown };
      if (typeof a.tipo === "string" && a.tipo) {
        const d = e.$defs[a.tipo];
        return d ? { content: [texto({ ok: true, tipo: a.tipo, definicion: d }, null)] } : fallo(`No hay ningún tipo «${a.tipo}»: ${Object.keys(e.$defs).join(", ")}.`);
      }
      return { content: [texto({ ok: true, ruta: RUTA_ESQUEMA, raiz: e.properties, tipos: Object.keys(e.$defs) }, null)] };
    }
    case "leer_proyecto": {
      const f = absoluta(a.proyecto, "proyecto");
      if (typeof f !== "string") return fallo(f.error);
      if (!existsSync(f)) return fallo(`No existe ${f}.`);
      const t = readFileSync(f, "utf8");
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, sello: sha(t), bytes: statSync(f).size }) }, { type: "text", text: t }] };
    }
    case "escribir_proyecto":
    case "editar": {
      const f = absoluta(a.proyecto, "proyecto");
      if (typeof f !== "string") return fallo(f.error);
      const actual = existsSync(f) ? readFileSync(f, "utf8") : null;
      if (typeof a.sello === "string" && actual !== null && a.sello !== sha(actual)) return fallo("El fichero cambió desde que lo leíste (el ingeniero lo guardó desde la app, o lo cambió otro): léelo otra vez con leer_proyecto y rehaz el cambio sobre lo que hay.");
      let p: Proyecto;
      if (nombre === "escribir_proyecto") {
        if (actual !== null && typeof a.sello !== "string") return fallo("Para escribir encima de un proyecto que ya existe hace falta el sello de leer_proyecto.");
        if (typeof a.texto !== "string") return fallo("Falta «texto».");
        const l = leerProyecto(a.texto);
        if (!l.valido) return { content: [texto({ ok: false, diagnosticos: l.diagnosticos })], isError: true };
        if (!existsSync(dirname(f))) return fallo(`No existe la carpeta ${dirname(f)}.`);
        p = l.proyecto;
      } else {
        if (actual === null) return fallo(`No existe ${f}: créalo con escribir_proyecto o importar_dxf.`);
        const l = leerProyecto(actual);
        if (!l.valido) return { content: [texto({ ok: false, diagnosticos: l.diagnosticos })], isError: true };
        if (!Array.isArray(a.operaciones) || !a.operaciones.length) return fallo("«operaciones» tiene que ser una lista de operaciones.");
        const r = aplicar(l.proyecto, { op: "lote", operaciones: a.operaciones as Operacion[] });
        if (!r.ok) return { content: [texto({ ok: false, diagnosticos: r.errores, ...(r.usos ? { usos: r.usos } : {}) })], isError: true };
        p = r.proyecto;
      }
      const t = escribirCanonico(f, p);
      return { content: [texto({ ok: true, sello: sha(t), nota: "Escrito. Ahora, validar." })] };
    }
    case "validar":
    case "compilar":
    case "resumen":
    case "calcular":
    case "revisar":
    case "seleccion":
    case "consultar":
    case "render": {
      const f = absoluta(a.proyecto, "proyecto");
      if (typeof f !== "string") return fallo(f.error);
      const pos = [f, ...(nombre === "consultar" ? [String(a.consulta ?? ""), ...(typeof a.id === "string" ? [a.id] : [])] : [])];
      const exacto = a.exacto === true;
      const r = await orden(argv(nombre, { ...a, exacto: false }, pos), dirname(f));
      const content: Contenido[] = [texto(r.json, exacto ? null : 6)];
      if (nombre === "render" && Array.isArray(r.json.figuras)) {
        const n = Math.min(MAX_IMAGENES, Math.max(0, typeof a.imagenes === "number" ? a.imagenes : 4));
        for (const fig of (r.json.figuras as { png: string }[]).slice(0, n)) {
          const png = join(dirname(f), String(r.json.carpeta), fig.png);
          if (existsSync(png)) content.push({ type: "image", data: readFileSync(png).toString("base64"), mimeType: "image/png" });
        }
      }
      return { content, ...(r.codigo !== 0 ? { isError: true } : {}) };
    }
    case "emplazamiento": {
      if (typeof a.municipio !== "string" || !a.municipio.trim()) return fallo("Falta «municipio».");
      if (a.municipio.trim().startsWith("--")) return fallo(`«${a.municipio}» no es un municipio.`);
      const r = await ejecutar(["emplazamiento", a.municipio, ...(a.top !== undefined ? ["--top", String(a.top)] : [])]);
      return { content: [texto(r.json)], ...(r.codigo !== 0 ? { isError: true } : {}) };
    }
    case "importar_dxf": {
      const f = absoluta(a.plano, "plano");
      if (typeof f !== "string") return fallo(f.error);
      if (a.salida !== undefined) {
        const s = absoluta(a.salida, "salida");
        if (typeof s !== "string") return fallo(s.error);
      }
      const plantas = Array.isArray(a.plantas) ? (a.plantas as { id: string; cota: number }[]).map((p) => `${p.id}:${p.cota}`) : [];
      const args = argv("importar-dxf", { ...a, ...(plantas.length ? { planta: plantas } : {}) }, [f]);
      const r = await orden(args, dirname(f));
      return { content: [texto(r.json)], ...(r.codigo !== 0 ? { isError: true } : {}) };
    }
    case "visor": {
      const f = absoluta(a.proyecto, "proyecto");
      if (typeof f !== "string") return fallo(f.error);
      if (!a.nuevo && !existsSync(f)) return fallo(`No existe ${f}. Con «nuevo», se crea con la plantilla.`);
      return visor(f, a.nuevo === true, a.abrir !== false);
    }
    default:
      return fallo(`No hay ninguna herramienta «${nombre}».`);
  }
}

// ─── JSON-RPC ───────────────────────────────────────────────────────────────────────────────────

interface Peticion {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

const RECURSOS = [
  { uri: "fem://skill", name: "Guía de Concreta FEM (skill fem)", mimeType: "text/markdown" },
  { uri: "fem://ejemplo", name: "Proyecto de ejemplo válido", mimeType: "application/json" },
  { uri: "fem://esquema", name: "JSON Schema del proyecto.json", mimeType: "application/schema+json" },
];

/** La respuesta a un mensaje, o null si es una notificación. */
export async function atender(m: Peticion): Promise<Record<string, unknown> | null> {
  const responder = (result: unknown) => ({ jsonrpc: "2.0", id: m.id ?? null, result });
  const error = (code: number, message: string) => ({ jsonrpc: "2.0", id: m.id ?? null, error: { code, message } });
  if (m.id === undefined || m.id === null) return null; // notificaciones (initialized, cancelled…)
  try {
    switch (m.method) {
      case "initialize": {
        const pedida = String(m.params?.protocolVersion ?? "");
        const version = (VERSIONES_PROTOCOLO as readonly string[]).includes(pedida) ? pedida : VERSIONES_PROTOCOLO[0];
        const paquete = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8")) as { version?: string };
        return responder({ protocolVersion: version, capabilities: { tools: { listChanged: false }, resources: { listChanged: false }, prompts: { listChanged: false } }, serverInfo: { name: NOMBRE, title: "Concreta FEM 3D", version: paquete.version ?? "0.0.0" }, instructions: guia() });
      }
      case "ping":
        return responder({});
      case "tools/list":
        return responder({ tools: HERRAMIENTAS });
      case "tools/call": {
        const nombre = String(m.params?.name ?? "");
        if (!HERRAMIENTAS.some((h) => h.name === nombre)) return error(-32602, `No hay ninguna herramienta «${nombre}».`);
        try {
          return responder(await llamar(nombre, (m.params?.arguments ?? {}) as Record<string, unknown>));
        } catch (e) {
          process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
          return responder({ content: [texto({ ok: false, diagnosticos: [{ codigo: "cli/error-interno", severidad: "error", mensaje: `Error interno de fem: ${e instanceof Error ? e.message : String(e)}. Es un fallo del programa, no del proyecto.` }] })], isError: true });
        }
      }
      case "resources/list":
        return responder({ resources: RECURSOS });
      case "resources/read": {
        const uri = String(m.params?.uri ?? "");
        const t = uri === "fem://skill" ? guia() : uri === "fem://ejemplo" ? readFileSync(RUTA_EJEMPLO, "utf8") : uri === "fem://esquema" ? readFileSync(RUTA_ESQUEMA, "utf8") : null;
        if (t === null) return error(-32002, `No hay ningún recurso ${uri}.`);
        return responder({ contents: [{ uri, mimeType: RECURSOS.find((r) => r.uri === uri)!.mimeType, text: t }] });
      }
      case "resources/templates/list":
        return responder({ resourceTemplates: [] });
      case "prompts/list":
        return responder({ prompts: [] });
      default:
        return error(-32601, `Método no admitido: ${m.method}`);
    }
  } catch (e) {
    return error(-32603, e instanceof Error ? e.message : String(e));
  }
}

function cerrarVisores(): void {
  for (const v of visores.values()) v.proceso.kill();
}

if (import.meta.main) {
  let resto = "";
  const escribir = (x: unknown) => process.stdout.write(`${JSON.stringify(x)}\n`);
  process.stdin.on("data", (d: Buffer) => {
    resto += d.toString("utf8");
    let i: number;
    while ((i = resto.indexOf("\n")) >= 0) {
      const linea = resto.slice(0, i).trim();
      resto = resto.slice(i + 1);
      if (!linea) continue;
      let m: Peticion;
      try {
        m = JSON.parse(linea) as Peticion;
      } catch {
        escribir({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON roto" } });
        continue;
      }
      void atender(m).then((r) => r && escribir(r));
    }
  });
  process.stdin.on("end", () => {
    cerrarVisores();
    void cola.then(() => process.exit(0));
  });
  process.on("exit", cerrarVisores);
}
