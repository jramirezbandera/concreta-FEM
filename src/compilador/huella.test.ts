/**
 * Criterio 6 de C1: huella SHA-256 (H13, COM-12). Vectores de FIPS 180-4, contraste con
 * `node:crypto`, serialización canónica, invariancia al orden de las listas, sensibilidad a un
 * cambio de 1e-9 y la misma huella en Node (V8) y en Bun (JavaScriptCore).
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { huellas } from "../../validacion/c1/huellas.ts";
import { azar, fisicoAleatorio } from "../pruebas/fisicoAleatorio.ts";
import { compilar } from "./compilar.ts";
import { canonico, sha256 } from "./huella.ts";

const bun = (() => {
  try {
    execFileSync("bun", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("criterio 6 de C1: huella", () => {
  it("SHA-256: vectores de FIPS 180-4 (vacío, «abc», 448 bits y un millón de «a»)", () => {
    expect(sha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
    expect(sha256("a".repeat(1_000_000))).toBe("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
  });

  it("SHA-256: igual que node:crypto en textos de 0 a 200 bytes, con UTF-8 de varios bytes", () => {
    const r = azar(11);
    const letras = "abcñáé€𝔸 0123{}\":,";
    for (let n = 0; n <= 200; n++) {
      let t = "";
      while (new TextEncoder().encode(t).length < n) t += [...letras][Math.floor(r() * [...letras].length)]!;
      expect(sha256(t), `longitud ${n}`).toBe(createHash("sha256").update(t, "utf8").digest("hex"));
    }
  });

  it("serialización canónica: claves ordenadas, undefined fuera y números exactos o con N cifras", () => {
    expect(canonico({ b: 1, a: [1, undefined, { d: undefined, c: 0.1 + 0.2 }] })).toBe('{"a":[1,null,{"c":0.30000000000000004}],"b":1}');
    expect(canonico({ x: 0.1 + 0.2, y: -0 }, 12)).toBe('{"x":0.3,"y":0}');
    expect(canonico(new Float64Array([1.5, 2]))).toBe("[1.5,2]");
  });

  it("la huella de compilación no depende del orden de las listas y cambia con 1e-9 m", () => {
    for (const s of [1, 5, 13]) {
      const f = fisicoAleatorio(s);
      const r = azar(s);
      const barajar = <T>(l: readonly T[]) => [...l].sort(() => r() - 0.5);
      const g = { ...f, pilares: barajar(f.pilares!), vigas: barajar(f.vigas!), cargas: barajar(f.cargas!), secciones: barajar(f.secciones) };
      const a = compilar(f);
      expect(compilar(g).huella).toBe(a.huella);
      expect(a.huella).toMatch(/^[0-9a-f]{64}$/);
      const h = { ...f, pilares: f.pilares!.map((p, i) => (i === 0 ? { ...p, x: p.x + 1e-9 } : p)) };
      expect(compilar(h).huella).not.toBe(a.huella);
      // y con otras opciones
      expect(compilar(f, { factorZonaRigida: 0.25 }).huella).not.toBe(a.huella);
      expect(compilar(f, { modificadores: {} }).huella).not.toBe(a.huella);
    }
  });

  it.skipIf(!bun)("la misma huella en Node (V8) y en Bun (JavaScriptCore), física y analítica a 12 cifras", () => {
    const enBun = JSON.parse(execFileSync("bun", [join(import.meta.dirname, "..", "..", "validacion", "c1", "huellas.ts")], { encoding: "utf8" }));
    expect(enBun).toEqual(huellas());
  });
});
