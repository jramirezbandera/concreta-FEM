/**
 * El teclado de lo que antes sólo iba con el ratón (auditoría de la interfaz, C-18, C-19, C-20 y
 * C-38): los grupos de radios y de pestañas con una parada de Tab y las flechas, las filas que se
 * eligen con Intro, y el asa del panel inferior con ↑ y ↓ (y sin guardar en cada movimiento al
 * arrastrarla).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Disposicion } from "../armazon/Disposicion.tsx";
import type { Paneles } from "../armazon/paneles.ts";
import { Grupo } from "../componentes/Grupo.tsx";
import { filaElegible } from "../componentes/comunes.tsx";

function Radios({ inicial, deshabilitada }: { inicial: string | null; deshabilitada?: string }) {
  const [v, setV] = useState(inicial);
  return (
    <Grupo rol="radiogroup" etiqueta="Tipo">
      {["a", "b", "c", "d"].map((x) => (
        <button key={x} type="button" role="radio" aria-checked={v === x} disabled={x === deshabilitada} onClick={() => setV(x)}>
          {x.toUpperCase()}
        </button>
      ))}
    </Grupo>
  );
}

const radio = (n: string) => screen.getByRole("radio", { name: n });
const paradas = () => screen.getAllByRole("radio").map((x) => x.tabIndex);

describe("C-18 · Grupo", () => {
  it("una sola parada de Tab, la elegida; las flechas eligen la de al lado y le llevan el foco", () => {
    render(<Radios inicial="b" />);
    expect(paradas()).toEqual([-1, 0, -1, -1]);
    radio("B").focus();
    fireEvent.keyDown(radio("B"), { key: "ArrowRight" });
    expect(radio("C").getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(radio("C"));
    expect(paradas()).toEqual([-1, -1, 0, -1]);
    fireEvent.keyDown(radio("C"), { key: "ArrowUp" });
    expect(radio("B").getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(radio("B"), { key: "End" });
    expect(radio("D").getAttribute("aria-checked")).toBe("true");
    // Da la vuelta
    fireEvent.keyDown(radio("D"), { key: "ArrowDown" });
    expect(radio("A").getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(radio("A"), { key: "ArrowLeft" });
    expect(radio("D").getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(radio("D"), { key: "Home" });
    expect(document.activeElement).toBe(radio("A"));
  });

  it("sin ninguna elegida, la parada es la primera; las deshabilitadas se saltan", () => {
    render(<Radios inicial={null} deshabilitada="b" />);
    expect(paradas()).toEqual([0, -1, -1, -1]);
    radio("A").focus();
    fireEvent.keyDown(radio("A"), { key: "ArrowRight" });
    expect(radio("C").getAttribute("aria-checked")).toBe("true");
  });
});

/** Unos paneles de mentira: `poner` cambia el estado y se cuenta. */
function ConPaneles({ poner }: { poner: (c: Partial<Paneles>) => void }) {
  const [e, setE] = useState({ nav: false, props: false, dock: true, pestana: "a" as string | null, alto: 280 });
  const p: Paneles = {
    ...e,
    clave: "prueba",
    poner: (c) => {
      poner(c);
      setE((x) => ({ ...x, ...c }));
    },
    abrirPestana: (x) => setE((y) => ({ ...y, dock: true, pestana: x })),
  };
  return (
    <Disposicion
      paneles={p}
      herramientas={null}
      etiquetaHerramientas="Herramientas"
      vista={null}
      dock={[
        { id: "a", titulo: "Primera", contenido: <p>uno</p> },
        { id: "b", titulo: "Segunda", contenido: <p>dos</p> },
      ]}
    />
  );
}

describe("C-18, C-20 y C-38 · el panel inferior", () => {
  it("las pestañas, con las flechas y su panel", () => {
    const poner = vi.fn();
    render(<ConPaneles poner={poner} />);
    const t1 = screen.getByRole("tab", { name: "Primera" });
    expect(t1.tabIndex).toBe(0);
    expect(screen.getByRole("tab", { name: "Segunda" }).tabIndex).toBe(-1);
    expect(screen.getByRole("tabpanel").id).toBe(t1.getAttribute("aria-controls"));
    t1.focus();
    fireEvent.keyDown(t1, { key: "ArrowRight" });
    expect(poner).toHaveBeenLastCalledWith({ dock: true, pestana: "b" });
    expect(screen.getByRole("tabpanel").textContent).toBe("dos");
  });

  it("el asa: ↑ y ↓ de 20 px con sus aria-value*, y el arrastre guarda sólo al soltar", () => {
    const poner = vi.fn();
    const { container } = render(<ConPaneles poner={poner} />);
    const asa = screen.getByRole("separator", { name: "Cambiar la altura del panel inferior" });
    expect(asa.tabIndex).toBe(0);
    expect(asa.getAttribute("aria-valuenow")).toBe("280");
    fireEvent.keyDown(asa, { key: "ArrowUp" });
    expect(poner).toHaveBeenLastCalledWith({ alto: 300 });
    expect(asa.getAttribute("aria-valuenow")).toBe("300");
    fireEvent.keyDown(asa, { key: "ArrowDown" });
    fireEvent.keyDown(asa, { key: "ArrowDown" });
    expect(asa.getAttribute("aria-valuenow")).toBe("260");
    fireEvent.keyDown(asa, { key: "Home" });
    expect(asa.getAttribute("aria-valuenow")).toBe("120");

    poner.mockClear();
    asa.setPointerCapture = () => {};
    const dock = container.querySelector("section.dock") as HTMLElement;
    fireEvent.pointerDown(asa, { clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(asa, { clientY: 450, pointerId: 1 });
    fireEvent.pointerMove(asa, { clientY: 400, pointerId: 1 });
    expect(poner).not.toHaveBeenCalled();
    expect(dock.style.height).toBe("220px");
    fireEvent.pointerUp(asa, { clientY: 400, pointerId: 1 });
    expect(poner).toHaveBeenCalledTimes(1);
    expect(poner).toHaveBeenLastCalledWith({ alto: 220 });
  });
});

describe("C-19 · filas elegibles", () => {
  it("Intro y Espacio eligen la fila; las teclas de sus controles, no", () => {
    const elegir = vi.fn();
    render(
      <table>
        <tbody>
          <tr {...filaElegible(elegir, false)} data-testid="fila">
            <td>
              <button type="button">dentro</button>
            </td>
          </tr>
        </tbody>
      </table>,
    );
    const fila = screen.getByTestId("fila");
    expect(fila.tabIndex).toBe(0);
    expect(fila.getAttribute("aria-selected")).toBe("false");
    fireEvent.keyDown(fila, { key: "Enter" });
    fireEvent.keyDown(fila, { key: " " });
    expect(elegir).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(screen.getByRole("button", { name: "dentro" }), { key: "Enter" });
    expect(elegir).toHaveBeenCalledTimes(2);
  });
});
