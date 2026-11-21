/**
 * Fase CO, criterio 5 (`docs/fem3d/comprobaciones.md` §7): las copias de Concreta son las del
 * manifiesto, enteras y sin tocar. El criterio 6 son sus propias pruebas, en `concreta/test/`.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { DESTINO, sinExtensiones, verificar, type Manifiesto } from "../../scripts/copiar-concreta.ts";

describe("copias de Concreta", () => {
  it("casan con el manifiesto: ni falta, ni sobra, ni cambia un fichero", () => {
    expect(verificar()).toEqual([]);
  });

  it("el manifiesto fija el commit y la licencia, y los parches van listados", () => {
    const m = JSON.parse(readFileSync(`${DESTINO}/manifiesto.json`, "utf8")) as Manifiesto;
    expect(m.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(m.licencia).toContain("Required Notice: Copyright Javier Ramírez Bandera");
    // Lo único que cambia en una copia son las extensiones de sus importaciones: quitándolas, el original
    for (const f of m.ficheros) {
      expect(f.sha256Origen).toMatch(/^[0-9a-f]{64}$/);
      if (m.parches.some((p) => p.fichero === f.origen)) continue;
      const original = sinExtensiones(readFileSync(f.destino, "utf8"));
      expect(createHash("sha256").update(original, "utf8").digest("hex"), f.origen).toBe(f.sha256Origen);
      expect(original.includes(".ts'") || original.includes('.ts"')).toBe(false);
    }
    expect(m.parches).toEqual([]);
    expect(m.sustituciones.map((s) => s.fichero)).toEqual(["src/lib/frame-core/sections.ts"]);
  });
});
