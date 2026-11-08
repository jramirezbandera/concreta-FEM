/**
 * Los extremos de una viga, una vigueta o una barra con sus esfuerzos (VS-o, `fem consultar pieza`):
 * cada fila, un extremo (en negrita, su valor) con los demás esfuerzos de su combinación en ese punto,
 * para las comprobaciones que juntan varios (cortante con torsión, flexión con cortante, N con M en una
 * barra). Con el sismo del programa (marcadas con «±»), los de sus signos pésimos, no un estado
 * simultáneo. Por vanos de cara a cara en una viga; a lo largo de la barra, en una barra.
 */
import { Fragment, type ReactNode } from "react";
import type { Extremo } from "../../../src/agente/consultas.ts";
import { filaElegible } from "../componentes/comunes.tsx";
import { fmt } from "../fmt.ts";
import { TITULO_PESIMOS } from "./Ternas.tsx";

/** Una fila: el extremo k de `fem consultar pieza`, su nombre en la tabla y qué es. */
export interface FilaExtremo {
  k: string;
  nombre: string;
  title: string;
  /** El esfuerzo del extremo, [N, Vy, Vz, T, My, Mz]. */
  c: number;
}

export interface ColumnaExtremo {
  c: number;
  nombre: string;
}

/** Los extremos de cada vano de una viga y sus columnas: lo que juntan el cortante con la torsión y la flexión con el cortante. */
export const FILAS_VANO: readonly FilaExtremo[] = [
  { k: "My+", nombre: "My máx.", title: "El mayor My (tracciona la cara inferior)", c: 4 },
  { k: "My-", nombre: "My mín.", title: "El menor My (tracciona la cara superior)", c: 4 },
  { k: "Vz", nombre: "Vz máx.", title: "El mayor |Vz|, con su signo", c: 2 },
  { k: "T", nombre: "T máx.", title: "El mayor |T|, con su signo", c: 3 },
];
export const COLUMNAS_VANO: readonly ColumnaExtremo[] = [
  { c: 2, nombre: "Vz kN" },
  { c: 3, nombre: "T kN·m" },
  { c: 4, nombre: "My kN·m" },
];

/** Los de una barra, a lo largo de ella: N con los momentos y los cortantes. */
export const FILAS_BARRA: readonly FilaExtremo[] = [
  { k: "N-", nombre: "N mín.", title: "La mayor compresión (el N más negativo)", c: 0 },
  { k: "N+", nombre: "N máx.", title: "La mayor tracción (o la menor compresión)", c: 0 },
  { k: "Vy", nombre: "Vy máx.", title: "El mayor |Vy|, con su signo", c: 1 },
  { k: "Vz", nombre: "Vz máx.", title: "El mayor |Vz|, con su signo", c: 2 },
  { k: "My", nombre: "My máx.", title: "El mayor |My|, con su signo", c: 4 },
  { k: "Mz", nombre: "Mz máx.", title: "El mayor |Mz|, con su signo", c: 5 },
];
export const COLUMNAS_BARRA: readonly ColumnaExtremo[] = [
  { c: 0, nombre: "N kN" },
  { c: 2, nombre: "Vz kN" },
  { c: 4, nombre: "My kN·m" },
  { c: 5, nombre: "Mz kN·m" },
];

export const NOTA_EXTREMOS =
  "Cada fila, un extremo (en negrita) con los demás esfuerzos de su combinación en ese punto: con ellos se comprueban el cortante con la torsión y la flexión con el cortante. Con el sismo del programa (marcadas con «±»), los esfuerzos de los modos combinados no tienen signo ni son simultáneos: la fila da cada uno con su signo pésimo (el que aumenta su valor absoluto; en una viga, N con la menor compresión).";

/**
 * La tabla: por grupo (un vano, o la barra entera), una fila de título si lo tiene y una por extremo.
 * `onGrupo`, un clic en el grupo (lleva el cursor al vano).
 */
export function TablaExtremos({
  grupos,
  filas,
  columnas,
}: {
  grupos: readonly { titulo?: ReactNode; extremos: Record<string, Extremo>; onGrupo?: () => void; activo?: boolean }[];
  filas: readonly FilaExtremo[];
  columnas: readonly ColumnaExtremo[];
}) {
  const izquierda = { textAlign: "left" } as const;
  return (
    <table className="tb">
      <thead>
        <tr>
          <th style={izquierda} title="El extremo de la fila, dónde está y su combinación">
            Extremo
          </th>
          {columnas.map((c) => (
            <th key={c.c}>{c.nombre}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {grupos.map((g, i) => (
          <Fragment key={i}>
            {g.titulo && (
              <tr className={`grupo${g.onGrupo ? " clic" : ""}`} data-on={g.activo || undefined} {...(g.onGrupo ? filaElegible(g.onGrupo, !!g.activo) : {})}>
                <td className="et" colSpan={columnas.length + 1}>
                  {g.titulo}
                </td>
              </tr>
            )}
            {filas.map((f) => {
              const x = g.extremos[f.k];
              return (
                <tr key={f.k} data-extremo={f.k} className={g.onGrupo ? "clic" : undefined} {...(g.onGrupo ? { onClick: g.onGrupo } : {})}>
                  <td className="et" title={f.title}>
                    {f.nombre}
                    {x && <small style={{ whiteSpace: "nowrap" }}>s = {fmt(x.s ?? 0, 2)} m</small>}
                    <small>
                      {x?.comb ?? ""}
                      {x?.pesimos && (
                        <span title={TITULO_PESIMOS} aria-label={`, ${TITULO_PESIMOS.toLowerCase()}`}>
                          {" "}±
                        </span>
                      )}
                    </small>
                  </td>
                  {columnas.map((c) => {
                    // El del extremo, su valor; los demás, los de sus esfuerzos (sin ellos, sólo el suyo)
                    const v = !x ? null : c.c === f.c ? x.v : (x.esfuerzos?.[c.c] ?? null);
                    return <td key={c.c}>{v === null ? "—" : c.c === f.c ? <b>{fmt(v, 1)}</b> : fmt(v, 1)}</td>;
                  })}
                </tr>
              );
            })}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}
