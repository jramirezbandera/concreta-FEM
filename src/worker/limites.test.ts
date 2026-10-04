import { describe, expect, it } from "vitest";
import { infoNavegador, LIMITES, perfilDispositivo } from "./limites.ts";

const UA = {
  chromeWindows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
  safariMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  android: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36",
};

describe("perfil del dispositivo", () => {
  it("móvil por userAgentData, por el agente de usuario o por ser un iPad que se presenta como Mac", () => {
    expect(perfilDispositivo(infoNavegador({ userAgent: UA.android, userAgentData: { mobile: true }, deviceMemory: 8 }))).toBe("movil");
    expect(perfilDispositivo(infoNavegador({ userAgent: UA.iphone }))).toBe("movil");
    expect(perfilDispositivo(infoNavegador({ userAgent: UA.safariMac, maxTouchPoints: 5 }))).toBe("movil");
  });

  it("sobremesa sólo con deviceMemory ≥ 8; sin dato (Safari, Firefox), el perfil prudente", () => {
    expect(perfilDispositivo(infoNavegador({ userAgent: UA.chromeWindows, userAgentData: { mobile: false }, deviceMemory: 8 }))).toBe("sobremesa");
    expect(perfilDispositivo(infoNavegador({ userAgent: UA.chromeWindows, userAgentData: { mobile: false }, deviceMemory: 4 }))).toBe("portatil");
    expect(perfilDispositivo(infoNavegador({ userAgent: UA.safariMac, maxTouchPoints: 0 }))).toBe("portatil");
  });

  it("los límites decrecen de sobremesa a móvil y el reciclaje queda por debajo del límite de memoria", () => {
    const [s, p, m] = [LIMITES.sobremesa, LIMITES.portatil, LIMITES.movil];
    expect(s.ecuaciones).toBeGreaterThan(p.ecuaciones);
    expect(p.ecuaciones).toBeGreaterThan(m.ecuaciones);
    expect(s.memoriaNucleo).toBeLessThanOrEqual(2 ** 32 * 0.75);
    for (const l of [s, p, m]) expect(l.umbralReciclaje).toBeLessThan(l.memoriaNucleo);
    expect([p.umbralReciclaje, m.umbralReciclaje]).toEqual([0, 0]); // tras cada cálculo
  });
});
