/**
 * `bun run instalar` (`cli/instalar.ts`): la skill enlazada (no copiada) y la orden `fem` en una
 * carpeta del PATH, que funciona desde una carpeta fuera del repo; reinstalar no cambia nada, lo
 * ajeno no se pisa y `--quitar` sólo quita lo suyo.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { instalar, MARCA } from "../../cli/instalar.ts";

const REPO = resolve(import.meta.dirname, "..", "..");
const temporales: string[] = [];
const temporal = () => {
  const d = mkdtempSync(join(tmpdir(), "fem-instalar-"));
  temporales.push(d);
  return d;
};
afterEach(() => {
  for (const d of temporales.splice(0)) rmSync(d, { recursive: true, force: true });
});

function sitio() {
  const casa = temporal();
  const o = { repo: REPO, skills: join(casa, "skills"), bin: join(casa, "bin") };
  return { ...o, path: o.bin };
}

describe("bun run instalar", () => {
  it("enlaza la skill del repo y escribe los lanzadores; reinstalar no cambia nada", () => {
    const o = sitio();
    const r = instalar(o);
    expect(r.errores).toEqual([]);
    expect(r.avisos).toEqual([]);
    // Enlace, no copia: se lee la SKILL.md del repo
    expect(readFileSync(join(o.skills, "fem", "SKILL.md"), "utf8")).toBe(readFileSync(join(REPO, ".claude", "skills", "fem", "SKILL.md"), "utf8"));
    expect(existsSync(join(o.skills, "fem", "ejemplo.json"))).toBe(true);
    for (const f of ["fem", "fem.cmd"]) expect(readFileSync(join(o.bin, f), "utf8")).toContain(MARCA);
    const otra = instalar(o);
    expect(otra.ok).toBe(true);
    expect(otra.hecho.every((x) => x.includes("ya estaba"))).toBe(true);
  });

  it("la orden instalada funciona desde una carpeta fuera del repo", () => {
    const o = sitio();
    instalar(o);
    const obra = temporal();
    const r =
      process.platform === "win32"
        ? spawnSync("cmd", ["/c", join(o.bin, "fem.cmd"), "esquema"], { cwd: obra, encoding: "utf8" })
        : spawnSync("sh", [join(o.bin, "fem"), "esquema"], { cwd: obra, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    const j = JSON.parse(r.stdout) as { orden: string; ok: boolean };
    expect(j).toMatchObject({ orden: "esquema", ok: true });
  }, 60_000);

  it("no pisa lo ajeno, y --quitar sólo quita lo suyo", () => {
    const o = sitio();
    mkdirSync(o.bin, { recursive: true });
    writeFileSync(join(o.bin, "fem"), "#!/bin/sh\necho otro\n");
    const r = instalar(o);
    expect(r.ok).toBe(false);
    expect(r.errores.join(" ")).toContain("ajeno");
    expect(readFileSync(join(o.bin, "fem"), "utf8")).toBe("#!/bin/sh\necho otro\n");
    // Una copia de la skill (no un enlace) tampoco se pisa
    const p = sitio();
    mkdirSync(join(p.skills, "fem"), { recursive: true });
    writeFileSync(join(p.skills, "fem", "SKILL.md"), "copia vieja");
    expect(instalar(p).errores.join(" ")).toContain("no es un enlace");

    const q = instalar({ ...o, quitar: true });
    expect(q.ok).toBe(true);
    expect(existsSync(join(o.bin, "fem"))).toBe(true);
    expect(existsSync(join(o.bin, "fem.cmd"))).toBe(false);
    expect(existsSync(join(o.skills, "fem"))).toBe(false);
    // El repo sigue con su skill
    expect(existsSync(join(REPO, ".claude", "skills", "fem", "SKILL.md"))).toBe(true);
  });

  it("avisa si la carpeta de los lanzadores no está en el PATH (también con rutas de Git Bash)", () => {
    const o = sitio();
    expect(instalar({ ...o, path: "/otra" }).avisos.join(" ")).toContain("no está en el PATH");
    if (process.platform === "win32") {
      const gitBash = o.bin.replace(/^([A-Za-z]):\\/, (_, u: string) => `/${u.toLowerCase()}/`).split("\\").join("/");
      expect(instalar({ ...o, path: gitBash }).avisos).toEqual([]);
    }
  });

  it("registra el servidor MCP en Claude Desktop sin tocar lo demás; reinstalar no cambia nada; lo ajeno no se pisa; --quitar lo quita", () => {
    const o = sitio();
    const desktop = temporal();
    const f = join(desktop, "claude_desktop_config.json");
    const antes = { preferencias: { tema: "oscuro" }, mcpServers: { otro: { command: "x", args: [] } } };
    writeFileSync(f, JSON.stringify(antes));
    const r = instalar({ ...o, claudeDesktop: [desktop], bun: "C:/bun/bun.exe" });
    expect(r.errores).toEqual([]);
    const c = JSON.parse(readFileSync(f, "utf8")) as { preferencias: unknown; mcpServers: Record<string, { command: string; args: string[] }> };
    expect(c.preferencias).toEqual(antes.preferencias);
    expect(c.mcpServers.otro).toEqual(antes.mcpServers.otro);
    expect(c.mcpServers["concreta-fem"]).toEqual({ command: "C:/bun/bun.exe", args: [join(REPO, "cli", "mcp.ts")] });
    expect(JSON.parse(readFileSync(`${f}.bak`, "utf8"))).toEqual(antes);
    const texto = readFileSync(f, "utf8");
    expect(instalar({ ...o, claudeDesktop: [desktop], bun: "C:/bun/bun.exe" }).hecho.some((x) => x.includes("MCP ya estaba"))).toBe(true);
    expect(readFileSync(f, "utf8")).toBe(texto);
    // Sin fichero, se crea; con un JSON roto o una entrada ajena, no se toca
    const vacia = temporal();
    instalar({ ...o, claudeDesktop: [vacia], bun: "bun" });
    expect(Object.keys((JSON.parse(readFileSync(join(vacia, "claude_desktop_config.json"), "utf8")) as { mcpServers: object }).mcpServers)).toEqual(["concreta-fem"]);
    const rota = temporal();
    writeFileSync(join(rota, "claude_desktop_config.json"), "{ no");
    expect(instalar({ ...o, claudeDesktop: [rota], bun: "bun" }).errores.join(" ")).toContain("no es un JSON");
    expect(readFileSync(join(rota, "claude_desktop_config.json"), "utf8")).toBe("{ no");
    const ajena = temporal();
    const otra = JSON.stringify({ mcpServers: { "concreta-fem": { command: "python", args: ["otro.py"] } } });
    writeFileSync(join(ajena, "claude_desktop_config.json"), otra);
    expect(instalar({ ...o, claudeDesktop: [ajena], bun: "bun" }).errores.join(" ")).toContain("no se pisa");
    expect(readFileSync(join(ajena, "claude_desktop_config.json"), "utf8")).toBe(otra);
    // Quitar: sólo la suya
    const q = instalar({ ...o, quitar: true, claudeDesktop: [desktop, ajena] });
    expect(q.ok).toBe(true);
    const d = JSON.parse(readFileSync(f, "utf8")) as { preferencias: unknown; mcpServers: Record<string, unknown> };
    expect(d).toEqual(antes);
    expect(readFileSync(join(ajena, "claude_desktop_config.json"), "utf8")).toBe(otra);
  });
});
