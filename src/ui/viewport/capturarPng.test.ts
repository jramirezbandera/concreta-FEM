// Tests de descargarPng (feature-15, T7): el helper de descarga del PNG. DOM puro
// (jsdom); `fecha` inyectable para un nombre de fichero determinista.
import { describe, it, expect, vi, afterEach } from "vitest";
import { descargarPng } from "./capturarPng";

interface AnclaFalsa {
  href: string;
  download: string;
  click: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

function anclaFalsa(): AnclaFalsa {
  return { href: "", download: "", click: vi.fn(), remove: vi.fn() };
}

afterEach(() => vi.restoreAllMocks());

describe("descargarPng", () => {
  it("crea un <a download> con el dataUrl, nombre y fecha, lo clica y lo descarta", () => {
    const a = anclaFalsa();
    vi.spyOn(document, "createElement").mockReturnValue(
      a as unknown as HTMLAnchorElement,
    );
    const append = vi
      .spyOn(document.body, "appendChild")
      .mockImplementation((n) => n);

    const fecha = new Date(2026, 5, 24, 18, 5, 32); // 2026-06-24 18:05:32
    descargarPng("data:image/png;base64,AAAA", "captura", fecha);

    expect(a.href).toBe("data:image/png;base64,AAAA");
    expect(a.download).toBe("captura-2026-06-24_18-05-32.png");
    expect(append).toHaveBeenCalledWith(a);
    expect(a.click).toHaveBeenCalledTimes(1);
    expect(a.remove).toHaveBeenCalledTimes(1);
  });

  it("usa 'captura' como nombre por defecto y rellena con ceros", () => {
    const a = anclaFalsa();
    vi.spyOn(document, "createElement").mockReturnValue(
      a as unknown as HTMLAnchorElement,
    );
    vi.spyOn(document.body, "appendChild").mockImplementation((n) => n);

    descargarPng("data:,", undefined, new Date(2026, 0, 1, 0, 0, 0));

    expect(a.download).toBe("captura-2026-01-01_00-00-00.png");
  });
});
