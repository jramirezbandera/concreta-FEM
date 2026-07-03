// Componente (RTL, project jsdom) de LeyendaRampa: rampa de color generica + rotulos
// min/max + unidad. Verifica los fixes de auditoria:
//  - [UX-MM] la unidad entre parentesis va en un span sin uppercase (mm != MM).
//  - [UX-RANGO] formato adaptativo: rango diminuto -> mas decimales; "-0.0" -> "0.0".
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LeyendaRampa } from "./LeyendaRampa";

describe("LeyendaRampa · unidad (UX-MM)", () => {
  it("separa la unidad entre parentesis en un span propio (sin uppercase)", () => {
    const { container } = render(
      <LeyendaRampa min={0} max={1} unidad="desplazamiento (mm)" />,
    );
    // El texto va en .caps (uppercase por CSS) pero la unidad va aparte, en su span.
    const ud = container.querySelector(".cx-leyenda-rampa__ud");
    expect(ud).not.toBeNull();
    // El contenido de texto de la unidad conserva "mm" en minusculas (el uppercase es
    // solo CSS sobre .caps, que NO envuelve al span de la unidad).
    expect(ud!.textContent).toBe("(mm)");
    // El texto descriptivo va en .caps.
    const caps = container.querySelector(".cx-leyenda-rampa__unidad .caps");
    expect(caps!.textContent).toBe("desplazamiento");
  });

  it("sin parentesis, toda la etiqueta va como texto (comportamiento previo)", () => {
    const { container } = render(<LeyendaRampa min={0} max={1} unidad="magnitud" />);
    expect(container.querySelector(".cx-leyenda-rampa__ud")).toBeNull();
    expect(container.querySelector(".caps")!.textContent).toBe("magnitud");
  });
});

describe("LeyendaRampa · orientacion vertical (D10)", () => {
  it("por defecto es horizontal (sin la clase --vertical)", () => {
    const { container } = render(<LeyendaRampa min={0} max={1} unidad="flecha (mm)" />);
    expect(container.querySelector(".cx-leyenda-rampa--vertical")).toBeNull();
    // La barra sigue presente (rampa de color).
    expect(container.querySelector(".cx-leyenda-rampa__barra")).not.toBeNull();
  });

  it("orientacion='vertical' aplica la variante y muestra los MISMOS min/max", () => {
    const { container } = render(
      <LeyendaRampa min={0} max={10} unidad="flecha (mm)" orientacion="vertical" />,
    );
    expect(container.querySelector(".cx-leyenda-rampa--vertical")).not.toBeNull();
    // Los rotulos de limite se siguen mostrando (max arriba, min abajo).
    expect(screen.getByText("0.0")).toBeInTheDocument();
    expect(screen.getByText("10.0")).toBeInTheDocument();
  });
});

describe("LeyendaRampa · formato de rango (UX-RANGO)", () => {
  it("con rango diminuto sube la precision (no colapsa a -0.0 … 0.0)", () => {
    render(<LeyendaRampa min={-0.004} max={0.002} unidad="flecha (mm)" decimales={1} />);
    // Con 1 decimal ambos serian "-0.0"/"0.0"; el formato fino muestra 3 decimales.
    expect(screen.getByText("-0.004")).toBeInTheDocument();
    expect(screen.getByText("0.002")).toBeInTheDocument();
  });

  it("normaliza el residuo '-0.0' al positivo '0.0'", () => {
    render(<LeyendaRampa min={-0} max={5} unidad="flecha (mm)" decimales={1} />);
    // -0 con 1 decimal seria "-0.0"; se normaliza a "0.0".
    expect(screen.getByText("0.0")).toBeInTheDocument();
    expect(screen.queryByText("-0.0")).not.toBeInTheDocument();
  });

  it("con rango amplio respeta los decimales pedidos (sin subir precision)", () => {
    render(<LeyendaRampa min={0} max={10} unidad="momento (kN·m/m)" decimales={2} />);
    expect(screen.getByText("0.00")).toBeInTheDocument();
    expect(screen.getByText("10.00")).toBeInTheDocument();
  });
});
