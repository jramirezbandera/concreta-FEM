/**
 * La escala de un mapa en Propiedades (Resultados · Losas y Armado): completa, sin picos o manual.
 * Los números de «manual» se guardan aunque se cambie de modo.
 */
import { useState, type CSSProperties } from "react";
import { rotulo, type EscalaDibujada } from "../../../src/agente/render/escena.ts";
import { limitesMapa, type EscalaMapa } from "../../../src/agente/render/isovalores.ts";
import { fmt } from "../fmt.ts";
import { Aviso, Seccion } from "./comunes.tsx";

/** La escala elegida de una magnitud: los números de «manual» se guardan aunque se cambie de modo. */
export type EscalaElegida = { modo: "completa" | "sin-picos" | "manual"; min?: number; max?: number; paso?: number };

export const escalaDe = (e: EscalaElegida | undefined): EscalaMapa | undefined =>
  !e || e.modo === "completa" ? undefined : e.modo === "sin-picos" ? { modo: "sin-picos" } : { ...(e.min !== undefined ? { min: e.min } : {}), ...(e.max !== undefined ? { max: e.max } : {}), ...(e.paso !== undefined ? { paso: e.paso } : {}) };

/** Lo que deja fuera «sin picos»: por cada lado (los isovalores) o sólo por arriba (el armado, desde 0). */
export type LadosPicos = "dos" | "arriba";

/**
 * La escala del mapa: completa, sin picos o manual. En manual, el mínimo, el máximo y el paso (cada
 * uno se puede dejar vacío) se aplican con Intro o al salir del campo, y empiezan con los del mapa.
 */
export function SeccionEscala({ mapa, unidad, elegida, onCambio, lados = "dos" }: { mapa: EscalaDibujada | undefined; unidad: string; elegida: EscalaElegida; onCambio: (e: EscalaElegida) => void; lados?: LadosPicos }) {
  const texto = (n: number | undefined) => (n === undefined ? "" : String(Number(n.toPrecision(6))).replace(".", ","));
  const [borrador, setBorrador] = useState({ min: texto(elegida.min), max: texto(elegida.max), paso: texto(elegida.paso) });
  const [error, setError] = useState<string | null>(null);
  const modo = (m: EscalaElegida["modo"]) => {
    if (m === "manual" && elegida.min === undefined && elegida.max === undefined && elegida.paso === undefined && mapa) {
      // Empieza con la escala que se ve
      const e: EscalaElegida = { modo: "manual", min: mapa.limites[0], max: mapa.limites[mapa.limites.length - 1], paso: mapa.paso };
      setBorrador({ min: texto(e.min), max: texto(e.max), paso: texto(e.paso) });
      onCambio(e);
    } else onCambio({ ...elegida, modo: m });
    setError(null);
  };
  const aplicar = () => {
    const leer = (t: string) => (t.trim() === "" ? undefined : Number(t.trim().replace(",", ".").replace("−", "-")));
    const e: EscalaElegida = { modo: "manual", min: leer(borrador.min), max: leer(borrador.max), paso: leer(borrador.paso) };
    for (const k of ["min", "max", "paso"] as const) if (e[k] !== undefined && !Number.isFinite(e[k])) return setError(`«${borrador[k]}» no es un número.`);
    const v = limitesMapa(e.min ?? -1, e.max ?? 1, escalaDe(e));
    if ("error" in v) return setError(`${v.error[0]!.toUpperCase()}${v.error.slice(1)}.`);
    setError(null);
    if (e.min !== elegida.min || e.max !== elegida.max || e.paso !== elegida.paso) onCambio(e);
  };
  const entrada = (k: "min" | "max" | "paso", etiqueta: string) => (
    <label className="campo">
      <span>{etiqueta.toLowerCase()}</span>
      <span className="unidad" data-unidad={unidad} style={{ "--u": unidad.length } as CSSProperties}>
        <input
          type="text"
          inputMode="decimal"
          aria-label={`${etiqueta} de la escala`}
          placeholder="auto"
          value={borrador[k]}
          onChange={(ev) => setBorrador({ ...borrador, [k]: ev.target.value })}
          onBlur={aplicar}
          onKeyDown={(ev) => ev.key === "Enter" && aplicar()}
        />
      </span>
    </label>
  );
  const MODOS = [
    { id: "completa", nombre: "Completa", title: "Del mínimo al máximo del mapa" },
    { id: "sin-picos", nombre: "Sin picos", title: lados === "dos" ? "Sin el 1 % del área por cada lado: un pico local no deja el resto en una o dos bandas" : "Sin el 1 % del área de los valores más altos: un pico local no deja el resto en una o dos bandas" },
    { id: "manual", nombre: "Manual", title: "Mínimo, máximo y paso dados" },
  ] as const;
  const area = lados === "dos" ? "2 %" : "1 %";
  return (
    <Seccion titulo="Escala" valor={mapa?.nulo ? "campo nulo" : mapa ? `${rotulo(mapa.limites[0]!, 4)} a ${rotulo(mapa.limites[mapa.limites.length - 1]!, 4)} ${unidad}` : undefined}>
      <div className="px-3.5 pt-1 pb-1.5">
        <div className="seg seg-ancho" role="group" aria-label="Escala del mapa">
          {MODOS.map((o) => (
            <button key={o.id} type="button" data-on={elegida.modo === o.id} aria-pressed={elegida.modo === o.id} title={o.title} onClick={() => modo(o.id)}>
              {o.nombre}
            </button>
          ))}
        </div>
      </div>
      {elegida.modo === "manual" && (
        <div className="pb-1">
          {entrada("min", "Mínimo")}
          {entrada("max", "Máximo")}
          {entrada("paso", "Paso")}
        </div>
      )}
      <div className="flex flex-col gap-2 px-3.5 pb-2 empty:hidden">
        {error && <Aviso tono="fail">{error}</Aviso>}
        {mapa?.picos && elegida.modo === "completa" && (
          <Aviso tono="warn">
            <span>
              La escala la marcan picos en menos del {area} del área (hasta {fmt(Math.abs(mapa.minimo) > Math.abs(mapa.maximo) ? mapa.minimo : mapa.maximo, 1)} {unidad}). Sin ellos, el mapa va de {fmt(mapa.sinPicos![0], 1)} a {fmt(mapa.sinPicos![1], 1)}:{" "}
              <button type="button" className="underline" onClick={() => modo("sin-picos")}>
                ver sin picos
              </button>
              .
            </span>
          </Aviso>
        )}
        {mapa && (mapa.fueraAbajo || mapa.fueraArriba) && <p className="nota">Lo que se sale de la escala va rayado; los extremos de la planta son los reales.</p>}
      </div>
    </Seccion>
  );
}
