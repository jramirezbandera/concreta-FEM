// Tests del capturaBus (feature-15, T7): canal emit/suscribe del disparo de captura
// PNG. Puro (sin three.js): solo verifica el reparto del evento y la baja.
import { describe, it, expect, vi } from "vitest";
import { emitirCaptura, suscribirCaptura } from "./capturaBus";

describe("capturaBus", () => {
  it("emitirCaptura invoca al oyente suscrito una vez con el nombre", () => {
    const oyente = vi.fn();
    const baja = suscribirCaptura(oyente);

    emitirCaptura("plano");

    expect(oyente).toHaveBeenCalledTimes(1);
    expect(oyente).toHaveBeenCalledWith("plano");
    baja();
  });

  it("emite sin nombre (undefined) cuando no se pasa", () => {
    const oyente = vi.fn();
    const baja = suscribirCaptura(oyente);

    emitirCaptura();

    expect(oyente).toHaveBeenCalledWith(undefined);
    baja();
  });

  it("la funcion de baja deja de recibir eventos", () => {
    const oyente = vi.fn();
    const baja = suscribirCaptura(oyente);
    baja();

    emitirCaptura();

    expect(oyente).not.toHaveBeenCalled();
  });

  it("reparte a todos los oyentes suscritos", () => {
    const a = vi.fn();
    const b = vi.fn();
    const bajaA = suscribirCaptura(a);
    const bajaB = suscribirCaptura(b);

    emitirCaptura("x");

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    bajaA();
    bajaB();
  });
});
