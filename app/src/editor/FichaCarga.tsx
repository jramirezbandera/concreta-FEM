/**
 * El valor de una carga en Propiedades (2026-10-28, a petición del usuario: el menú de cargas «es un
 * lío», con la q en tres componentes y campos que no se usan). Es el de la plantilla de su herramienta
 * (`CampoCarga`): la dirección (hacia abajo por defecto) y un solo número; en positivo, hacia abajo.
 * Lo que casi nunca hace falta va detrás de una casilla, como en la plantilla: una carga que varía a lo
 * largo de la pieza (qb) y el momento de una puntual (M). En ejes locales, las tres componentes.
 *
 * Lo que escribe va por `escribirVarios`, en un solo paso: cambiar la dirección de una carga que varía
 * cambia q y qb a la vez.
 */
import { useRef, useState } from "react";
import { Lector, textoVector, type Fila } from "../../../src/editor/celdas.ts";
import type { Vec3 } from "../../../src/motor/modelo.ts";
import { CampoCarga } from "../dibujo/Plantilla.tsx";

interface Props {
  id: string;
  fila: Fila;
  /** Escribe varios campos de la fila en un paso de deshacer. */
  escribirVarios: (cambios: Readonly<Record<string, string>>) => void;
  errores: Readonly<Record<string, string>>;
}

const UNIDAD: Record<string, string> = { viga: "kN/m", pilar: "kN/m", lineal: "kN/m", superficie: "kN/m²" };
const AYUDA: Record<string, string> = {
  viga: "Por metro de la viga: p. ej., 7 de un cerramiento.",
  pilar: "Por metro del pilar.",
  lineal: "Por metro de la línea: p. ej., 7 de un cerramiento.",
  superficie: "Por m² de forjado: p. ej., 1,5 de solado o 2 de uso.",
};

export function ValorCarga({ id, fila, escribirVarios, errores }: Props) {
  const tipo = (fila.tipo ?? "").trim().toLowerCase();
  const L = new Lector(fila);
  const leer = (c: string): Vec3 | undefined => ((fila[c] ?? "").trim() ? L.vector(c) : undefined);
  // Lo que `CampoCarga` cambia seguido (q y qb al cambiar de dirección) va junto, en un paso
  const cola = useRef<Record<string, string> | null>(null);
  const poner = (clave: string) => (v: Vec3 | undefined) => {
    const t = v ? textoVector(v) : "";
    if (cola.current) return void (cola.current[clave] = t);
    cola.current = { [clave]: t };
    queueMicrotask(() => {
      const c = cola.current!;
      cola.current = null;
      escribirVarios(c);
    });
  };
  const [variable, setVariable] = useState(() => !!(fila.qb ?? "").trim());
  const [momento, setMomento] = useState(() => !!(fila.M ?? "").trim());
  const conQb = variable || !!(fila.qb ?? "").trim();
  const conM = momento || !!(fila.M ?? "").trim();
  const error = (c: string) =>
    errores[c] && (
      <div className="campo">
        <span />
        <p className="error">
          {c}: {errores[c]}
        </p>
      </div>
    );

  if (tipo === "puntual")
    return (
      <>
        <CampoCarga key={id} etiqueta="F" unidad="kN" valor={leer("F")} onCambio={poner("F")} ayuda="La fuerza en el punto: p. ej., la reacción de un apeo." />
        {error("F")}
        <label className="chk">
          <input
            type="checkbox"
            checked={conM}
            onChange={(x) => {
              setMomento(x.target.checked);
              if (!x.target.checked && (fila.M ?? "").trim()) escribirVarios({ M: "" });
            }}
          />
          <span>Con momento</span>
        </label>
        {conM && <CampoCarga key={`${id}M`} etiqueta="M" unidad="kN·m" componentes="globales" valor={leer("M")} onCambio={poner("M")} ayuda="Mx My Mz en ejes globales (regla de la mano derecha)." />}
        {error("M")}
      </>
    );
  if (!UNIDAD[tipo]) return null;
  const barra = tipo === "viga" || tipo === "pilar";
  const local = barra && (fila.ejes ?? "").trim().toLowerCase() === "local";
  return (
    <>
      <CampoCarga
        key={`${id}${local}`}
        etiqueta="q"
        unidad={UNIDAD[tipo]!}
        componentes={local ? "locales" : undefined}
        valor={leer("q")}
        onCambio={poner("q")}
        ayuda={conQb ? "Al principio de la pieza o del tramo." : AYUDA[tipo]}
        final={barra && conQb ? { etiqueta: "qb", valor: leer("qb"), onCambio: poner("qb"), ayuda: "Al final de la pieza o del tramo." } : undefined}
      />
      {error("q")}
      {error("qb")}
      {barra && (
        <label className="chk">
          <input
            type="checkbox"
            checked={conQb}
            onChange={(x) => {
              setVariable(x.target.checked);
              if (!x.target.checked && (fila.qb ?? "").trim()) escribirVarios({ qb: "" });
            }}
          />
          <span>Varía a lo largo de la pieza</span>
        </label>
      )}
    </>
  );
}
