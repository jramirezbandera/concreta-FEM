#!/usr/bin/env bun
/**
 * El paquete de Claude Desktop (extensión MCPB, `docs/fem3d/agente.md` §13.4): el servidor MCP de
 * `cli/mcp.ts` en un solo JS para el Node que trae Claude Desktop, con lo que lee del disco y la app
 * ya construida para la herramienta `visor`. Un usuario que sólo tiene la web lo descarga y lo
 * instala con doble clic, sin el código fuente, bun ni Node.
 *
 *   bun scripts/paquete-mcpb.ts                 construye la app y el paquete en dist/mcpb/
 *   bun scripts/paquete-mcpb.ts --usar-dist     con la app de app/dist tal como esté (el CI)
 *   bun scripts/paquete-mcpb.ts --copiar-a app/dist   además, deja el .mcpb ahí (GitHub Pages)
 *
 * Dentro, `server/` repite las rutas relativas del repo (`cli/`, `src/nucleo/pkg/`, `src/agente/`,
 * `.claude/skills/fem/`, `app/dist/`), así que `RAIZ` de `cli/ordenes.ts` y las rutas que salen de
 * él valen igual. La versión es `0.1.<commits>` (o `MCPB_VERSION`): Claude Desktop actualiza la
 * extensión cuando cambia.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { HERRAMIENTAS } from "../cli/mcp.ts";

const RAIZ = resolve(import.meta.dirname, "..");
const MCPB = "@anthropic-ai/mcpb@2.1.2";
const SALIDA = join(RAIZ, "dist", "mcpb");
const DENTRO = join(SALIDA, "paquete");
const SERVIDOR = join(DENTRO, "server");
export const FICHERO_MCPB = "concreta-fem.mcpb";

const args = process.argv.slice(2);
const valor = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : undefined;
};

/** `bun x <paquete> …`, con el bun que ejecuta esto (sin shell: las rutas llevan espacios). */
function bunx(a: string[], cwd = RAIZ): void {
  const r = spawnSync(process.execPath, ["x", ...a], { cwd, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`Falló: bun x ${a.join(" ")} (código ${r.status})`);
}

function copiar(rel: string): void {
  const de = join(RAIZ, rel);
  if (!existsSync(de)) throw new Error(`No existe ${rel}`);
  const a = join(SERVIDOR, rel);
  mkdirSync(dirname(a), { recursive: true });
  if (statSync(de).isDirectory()) cpSync(de, a, { recursive: true });
  else copyFileSync(de, a);
}

function version(): string {
  if (process.env.MCPB_VERSION) return process.env.MCPB_VERSION;
  const r = spawnSync("git", ["rev-list", "--count", "HEAD"], { cwd: RAIZ, encoding: "utf8" });
  const n = Number.parseInt(r.stdout ?? "", 10);
  if (!Number.isFinite(n)) throw new Error("No se pudo contar los commits (git rev-list --count HEAD): dé MCPB_VERSION.");
  return `0.1.${n}`;
}

// ─── 1. La app ───
if (!args.includes("--usar-dist")) bunx(["vite", "build"], join(RAIZ, "app"));
if (!existsSync(join(RAIZ, "app", "dist", "index.html"))) throw new Error("No está app/dist: constrúyala o quite --usar-dist.");

rmSync(SALIDA, { recursive: true, force: true });
mkdirSync(SERVIDOR, { recursive: true });

// ─── 2. El servidor en un solo JS ───
const v = version();
// Con la orden y no con Bun.build, para no depender de los tipos de bun en el tsconfig
const b = spawnSync(process.execPath, ["build", join(RAIZ, "cli", "mcpPaquete.ts"), "--target=node", "--format=esm", "--outfile", join(SERVIDOR, "cli", "mcp.js")], { cwd: RAIZ, stdio: "inherit" });
if (b.status !== 0) throw new Error("No se pudo empaquetar el servidor.");
writeFileSync(join(SERVIDOR, "package.json"), `${JSON.stringify({ name: "concreta-fem-mcp", version: v, private: true, type: "module" }, null, 2)}\n`);

// ─── 3. Lo que lee del disco, en sus rutas ───
for (const rel of [
  "src/nucleo/pkg/nucleo_bg.wasm",
  "src/agente/proyecto.schema.json",
  ".claude/skills/fem/SKILL.md",
  ".claude/skills/fem/ejemplo.json",
  "cli/fuentes",
  "node_modules/@resvg/resvg-wasm/package.json",
  "node_modules/@resvg/resvg-wasm/index_bg.wasm",
  "NOTICE",
]) copiar(rel);
// La app, sin su service worker (visorEstatico.ts no lo sirve) ni un .mcpb de una vuelta anterior
cpSync(join(RAIZ, "app", "dist"), join(SERVIDOR, "app", "dist"), {
  recursive: true,
  filter: (f) => !/[\\/](sw\.js|workbox-[^\\/]*\.js|[^\\/]*\.mcpb)$/.test(f),
});
copyFileSync(join(RAIZ, "NOTICE"), join(DENTRO, "NOTICE"));
copyFileSync(join(RAIZ, "app", "dist", "icons", "icon-512.png"), join(DENTRO, "icon.png"));

// ─── 4. El manifiesto ───
const manifiesto = {
  manifest_version: "0.3",
  name: "concreta-fem",
  display_name: "Concreta FEM 3D",
  version: v,
  description: "Modelar, calcular, consultar y revisar estructuras de edificación con el motor FEM 3D de Concreta.",
  long_description:
    "El motor de cálculo de Concreta FEM 3D en el equipo, para que Claude trabaje con los proyecto.json de una obra: validar, calcular, consultar resultados, dibujar figuras, preparar el informe de revisión, importar un DXF o DWG y abrir la app sobre el proyecto. Los proyectos guardados en el navegador se pasan antes a una carpeta («Pasar a una carpeta» en la app). No sustituye la revisión del ingeniero.",
  author: { name: "jramirezbandera" },
  homepage: "https://jramirezbandera.github.io/concreta-FEM/",
  repository: { type: "git", url: "https://github.com/jramirezbandera/concreta-FEM.git" },
  icon: "icon.png",
  server: {
    type: "node",
    entry_point: "server/cli/mcp.js",
    mcp_config: { command: "node", args: ["${__dirname}/server/cli/mcp.js"] },
  },
  tools: HERRAMIENTAS.map((h) => ({ name: h.name, description: h.description.split("\n")[0]!.slice(0, 300) })),
  keywords: ["estructuras", "FEM", "hormigón", "cálculo", "CTE", "NCSE"],
  compatibility: { platforms: ["win32", "darwin", "linux"], runtimes: { node: ">=20.0.0" } },
};
writeFileSync(join(DENTRO, "manifest.json"), `${JSON.stringify(manifiesto, null, 2)}\n`);

// ─── 5. Validar y empaquetar ───
bunx([MCPB, "validate", join(DENTRO, "manifest.json")]);
const mcpb = join(SALIDA, FICHERO_MCPB);
bunx([MCPB, "pack", DENTRO, mcpb]);

const destino = valor("--copiar-a");
if (destino) {
  copyFileSync(mcpb, join(resolve(RAIZ, destino), FICHERO_MCPB));
  console.log(`Copiado a ${join(destino, FICHERO_MCPB)}`);
}
const tam = (statSync(mcpb).size / 1024 / 1024).toFixed(1);
console.log(`\n${FICHERO_MCPB} ${v} (${tam} MB): ${mcpb}\nFicheros: ${readdirSync(SERVIDOR, { recursive: true }).length}`);
