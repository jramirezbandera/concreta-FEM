#!/usr/bin/env bun
/**
 * Deja Concreta FEM 3D listo para trabajar con un agente fuera de este repositorio (en la carpeta de
 * una obra, donde por A-e tienen que estar los planos y los proyectos de clientes):
 *
 *   bun run instalar             la skill `fem` en las del usuario, la orden `fem` en el PATH y el
 *                                servidor MCP en Claude Desktop (si está instalado)
 *   bun run instalar --quitar    quita lo que puso (sólo lo suyo)
 *
 * - **La skill** va como enlace (junction en Windows, que no necesita permisos de administrador) a
 *   `.claude/skills/fem` del repo, no como copia: se actualiza con el repo y nunca se queda vieja.
 * - **La orden** son dos lanzadores en `~/.local/bin` (`fem` para sh y `fem.cmd` para cmd y
 *   PowerShell) que ejecutan `cli/fem.ts` de este repo con bun. Llevan una marca (`MARCA`) para
 *   reconocerlos al reinstalar o quitarlos: un `fem` ajeno no se toca.
 *
 * - **El servidor MCP** (`cli/mcp.ts`, `docs/fem3d/agente.md` §13.3), para usarlo sin terminal: la
 *   entrada `concreta-fem` de `mcpServers` en `claude_desktop_config.json`, con bun y la ruta del
 *   servidor de este repo. En Windows, Claude Desktop puede estar en `%APPDATA%\Claude` o, el de la
 *   Tienda, en `%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude` o, con los datos fuera
 *   del paquete, en `%LOCALAPPDATA%\Claude-Data\claude_*`: se escribe en las que existen. Claude
 *   Desktop reescribe ese fichero con sus preferencias: hay que cerrarlo antes. El resto del fichero no se toca (se deja su copia `.bak` antes de cambiarlo), una
 *   entrada `concreta-fem` que no lanza un `cli/mcp.ts` no se pisa, y un fichero que no es JSON, tampoco.
 *   Hay que reiniciar Claude Desktop para que la lea.
 *
 * Opciones para las pruebas y para otros sitios: `--skills <carpeta>`, `--bin <carpeta>` y
 * `--claude-desktop <carpeta>` (repetible; `--sin-mcp` no lo registra).
 */
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";

export const MARCA = "concreta-fem: lanzador de cli/fem.ts";

export interface OpcionesInstalar {
  /** Raíz del repo (la de este fichero, por defecto). */
  repo: string;
  /** Carpeta de las skills del usuario (`~/.claude/skills`). */
  skills: string;
  /** Carpeta en el PATH para los lanzadores (`~/.local/bin`). */
  bin: string;
  quitar?: boolean;
  /** El PATH con el que comprobar que `bin` está en él. */
  path?: string;
  windows?: boolean;
  /** Carpetas de configuración de Claude Desktop donde registrar el servidor MCP (vacía: ninguna). */
  claudeDesktop?: readonly string[];
  /** El ejecutable de bun para el servidor MCP (por defecto, el que ejecuta esto). */
  bun?: string;
}

export const NOMBRE_MCP = "concreta-fem";
const CONFIG_DESKTOP = "claude_desktop_config.json";

/** Las carpetas de configuración de Claude Desktop que hay en este equipo. */
export function carpetasClaudeDesktop(): string[] {
  const r: string[] = [];
  const casa = homedir();
  if (process.platform === "win32") {
    const roaming = process.env.APPDATA ?? join(casa, "AppData", "Roaming");
    const local = process.env.LOCALAPPDATA ?? join(casa, "AppData", "Local");
    if (existsSync(join(roaming, "Claude"))) r.push(join(roaming, "Claude"));
    try {
      for (const p of readdirSync(join(local, "Packages"))) {
        const d = join(local, "Packages", p, "LocalCache", "Roaming", "Claude");
        if (/^Claude_/i.test(p) && existsSync(d)) r.push(d);
      }
    } catch {
      // sin Packages
    }
    // El de la Tienda con los datos fuera del paquete (la opción de las versiones de 2026)
    try {
      for (const p of readdirSync(join(local, "Claude-Data"))) {
        const d = join(local, "Claude-Data", p);
        if (/^claude_/i.test(p) && existsSync(join(d, CONFIG_DESKTOP))) r.push(d);
      }
    } catch {
      // sin Claude-Data
    }
  } else if (process.platform === "darwin") {
    const d = join(casa, "Library", "Application Support", "Claude");
    if (existsSync(d)) r.push(d);
  } else {
    const d = join(process.env.XDG_CONFIG_HOME ?? join(casa, ".config"), "Claude");
    if (existsSync(d)) r.push(d);
  }
  return r;
}

const esNuestroMcp = (e: unknown): boolean => {
  const args = (e as { args?: unknown } | null)?.args;
  return Array.isArray(args) && args.some((a) => typeof a === "string" && /[\\/]cli[\\/]mcp\.ts$/.test(a));
};

/** La entrada del servidor MCP en la configuración de Claude Desktop de `carpeta`. */
function registrarMcp(carpeta: string, entrada: { command: string; args: string[] }, quitar: boolean, r: Informe): void {
  const f = join(carpeta, CONFIG_DESKTOP);
  let config: Record<string, unknown> = {};
  if (existsSync(f)) {
    try {
      const x = JSON.parse(readFileSync(f, "utf8") || "{}") as unknown;
      if (!x || typeof x !== "object" || Array.isArray(x)) throw new Error("no es un objeto");
      config = x as Record<string, unknown>;
    } catch (e) {
      r.errores.push(`${f} no es un JSON válido (${e instanceof Error ? e.message : String(e)}): no se toca. Arréglelo y vuelva a instalar.`);
      return;
    }
  } else if (quitar) return;
  const servidores = (config.mcpServers && typeof config.mcpServers === "object" ? config.mcpServers : {}) as Record<string, unknown>;
  const hay = servidores[NOMBRE_MCP];
  if (quitar) {
    if (hay === undefined) return;
    if (!esNuestroMcp(hay)) {
      r.avisos.push(`La entrada ${NOMBRE_MCP} de ${f} no es la de Concreta FEM: no se toca.`);
      return;
    }
    const { [NOMBRE_MCP]: _, ...otros } = servidores;
    copyFileSync(f, `${f}.bak`);
    writeFileSync(f, `${JSON.stringify({ ...config, mcpServers: otros }, null, 2)}\n`);
    r.hecho.push(`Servidor MCP quitado de ${f}`);
    return;
  }
  if (hay !== undefined && !esNuestroMcp(hay)) {
    r.errores.push(`Ya hay una entrada ${NOMBRE_MCP} en ${f} que no lanza Concreta FEM: no se pisa.`);
    return;
  }
  if (JSON.stringify(hay) === JSON.stringify(entrada)) {
    r.hecho.push(`El servidor MCP ya estaba en ${f}`);
    return;
  }
  if (existsSync(f)) copyFileSync(f, `${f}.bak`);
  mkdirSync(carpeta, { recursive: true });
  writeFileSync(f, `${JSON.stringify({ ...config, mcpServers: { ...servidores, [NOMBRE_MCP]: entrada } }, null, 2)}\n`);
  r.hecho.push(`${hay === undefined ? "Servidor MCP registrado" : "Servidor MCP actualizado"} en ${f} (reinicie Claude Desktop)`);
}

export interface Informe {
  ok: boolean;
  hecho: string[];
  avisos: string[];
  errores: string[];
}

const mismo = (a: string, b: string) => {
  try {
    return realpathSync(a).toLowerCase() === realpathSync(b).toLowerCase();
  } catch {
    return false;
  }
};

/** Qué hay en `ruta`: nada, un enlace (y a dónde), una carpeta o un fichero. */
function que(ruta: string): { tipo: "nada" } | { tipo: "enlace"; a: string } | { tipo: "carpeta" } | { tipo: "fichero" } {
  let st;
  try {
    st = lstatSync(ruta);
  } catch {
    return { tipo: "nada" };
  }
  if (st.isSymbolicLink()) return { tipo: "enlace", a: readlinkSync(ruta) };
  // Una junction de Windows, en Node y bun, es un enlace simbólico para lstat; por si no lo fuera
  return st.isDirectory() ? { tipo: "carpeta" } : { tipo: "fichero" };
}

function lanzadores(repo: string): { nombre: string; texto: string }[] {
  const fem = join(repo, "cli", "fem.ts");
  return [
    { nombre: "fem", texto: `#!/bin/sh\n# ${MARCA}\nexec bun "${fem.split("\\").join("/")}" "$@"\n` },
    { nombre: "fem.cmd", texto: `@echo off\r\nrem ${MARCA}\r\nbun "${fem}" %*\r\n` },
  ];
}

export function instalar(o: OpcionesInstalar): Informe {
  const r: Informe = { ok: true, hecho: [], avisos: [], errores: [] };
  const origen = join(o.repo, ".claude", "skills", "fem");
  const destino = join(o.skills, "fem");
  const windows = o.windows ?? process.platform === "win32";

  // ─── La skill ───
  const d = que(destino);
  const esNuestro = d.tipo === "enlace" && mismo(destino, origen);
  if (o.quitar) {
    if (esNuestro) {
      unlinkSync(destino);
      r.hecho.push(`Skill quitada: ${destino}`);
    } else if (d.tipo !== "nada") r.avisos.push(`${destino} no es el enlace de este repo: no se toca.`);
  } else if (!existsSync(join(origen, "SKILL.md"))) {
    r.errores.push(`No está la skill en ${origen}.`);
  } else if (esNuestro) {
    r.hecho.push(`La skill ya estaba: ${destino} → ${origen}`);
  } else if (d.tipo === "enlace") {
    // Un enlace a otro clon del repo (o roto): se rehace hacia éste
    unlinkSync(destino);
    symlinkSync(origen, destino, windows ? "junction" : "dir");
    r.hecho.push(`Skill enlazada (antes apuntaba a ${d.a}): ${destino} → ${origen}`);
  } else if (d.tipo !== "nada") {
    r.errores.push(`Ya hay una skill fem en ${destino} que no es un enlace a este repo (¿una copia?): bórrela a mano y vuelva a instalar.`);
  } else {
    mkdirSync(o.skills, { recursive: true });
    symlinkSync(origen, destino, windows ? "junction" : "dir");
    r.hecho.push(`Skill enlazada: ${destino} → ${origen}`);
  }

  // ─── Los lanzadores ───
  for (const l of lanzadores(o.repo)) {
    const f = join(o.bin, l.nombre);
    const hay = existsSync(f) ? readFileSync(f, "utf8") : null;
    const suyo = hay !== null && hay.includes(MARCA);
    if (o.quitar) {
      if (suyo) {
        rmSync(f);
        r.hecho.push(`Orden quitada: ${f}`);
      } else if (hay !== null) r.avisos.push(`${f} no es un lanzador de Concreta FEM: no se toca.`);
      continue;
    }
    if (hay !== null && !suyo) {
      r.errores.push(`Ya hay un ${l.nombre} ajeno en ${o.bin}: no se pisa.`);
      continue;
    }
    if (hay === l.texto) {
      r.hecho.push(`La orden ya estaba: ${f}`);
      continue;
    }
    mkdirSync(o.bin, { recursive: true });
    writeFileSync(f, l.texto, { mode: 0o755 });
    r.hecho.push(`${hay === null ? "Orden escrita" : "Orden actualizada"}: ${f}`);
  }

  // ─── El servidor MCP ───
  const entrada = { command: o.bun ?? process.execPath, args: [join(o.repo, "cli", "mcp.ts")] };
  for (const c of o.claudeDesktop ?? []) registrarMcp(c, entrada, !!o.quitar, r);

  if (!o.quitar) {
    const path = (o.path ?? process.env.PATH ?? "").split(delimiter).filter(Boolean);
    const norm = (x: string) => resolve(x).toLowerCase().replace(/[\\/]+$/, "");
    // Git Bash da el PATH como /c/Users/…: se compara también así
    const posix = (x: string) => x.replace(/^\/([a-z])\//i, (_, u: string) => `${u}:/`);
    if (!path.some((p) => norm(posix(p)) === norm(o.bin))) r.avisos.push(`${o.bin} no está en el PATH: añádalo para poder escribir «fem» en cualquier carpeta.`);
  }
  r.ok = r.errores.length === 0;
  return r;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const valor = (n: string) => {
    const i = args.indexOf(n);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const desktop = args.flatMap((x, i) => (x === "--claude-desktop" && args[i + 1] ? [args[i + 1]!] : []));
  const r = instalar({
    repo: resolve(import.meta.dirname, ".."),
    skills: valor("--skills") ?? join(homedir(), ".claude", "skills"),
    bin: valor("--bin") ?? join(homedir(), ".local", "bin"),
    quitar: args.includes("--quitar"),
    claudeDesktop: args.includes("--sin-mcp") ? [] : desktop.length ? desktop : carpetasClaudeDesktop(),
  });
  for (const x of r.hecho) console.log(x);
  for (const x of r.avisos) console.log(`Aviso: ${x}`);
  for (const x of r.errores) console.error(`Error: ${x}`);
  if (r.ok && !args.includes("--quitar")) console.log("\nListo. En la carpeta de una obra: «fem ayuda», y abra allí una sesión de Claude Code: la skill fem ya está.");
  process.exitCode = r.ok ? 0 : 1;
}
