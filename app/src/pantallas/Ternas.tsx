/**
 * Las ternas concomitantes de los tramos de pilar (UI-10, `docs/fem3d/auditoria-ui.md`): en la cabeza
 * y en el pie de cada tramo, la combinación que da el N mínimo (la mayor compresión), el N máximo, el
 * mayor |My| y el mayor |Mz|, cada una con los N, My y Mz de esa misma combinación. Son los extremos
 * de `fem consultar pieza`, que ya llevan sus concomitantes; antes, cada columna del cuadro era el
 * extremo de otra combinación, y un pilar se dimensiona por ternas.
 *
 * La usan el cuadro de la planta y el pilar elegido en Pilares, y un pilar en Diagramas.
 */
import { Fragment, type ReactNode } from "react";
import type { FilaPilar } from "../../../src/visor/datos.ts";
import { fmt } from "../fmt.ts";
import { filaElegible } from "../componentes/comunes.tsx";

/** El aviso del axil reducido de A3 (`UMBRALES.axilReducido`). */
export const LIMITE_NU = 0.65;

/** Los pésimos de cada extremo del tramo, en el orden de la tabla. */
export const TERNAS = [
  { k: "N-", nombre: "N mín.", title: "La mayor compresión (el N más negativo), con My y Mz de la misma combinación" },
  { k: "N+", nombre: "N máx.", title: "La menor compresión (o la mayor tracción), con My y Mz de la misma combinación" },
  { k: "My", nombre: "My máx.", title: "El mayor |My|, con su signo, con N y Mz de la misma combinación" },
  { k: "Mz", nombre: "Mz máx.", title: "El mayor |Mz|, con su signo, con N y My de la misma combinación" },
] as const;

export const EXTREMOS_TRAMO = [
  { k: "cabeza", nombre: "Cabeza" },
  { k: "base", nombre: "Pie" },
] as const;

/** Qué es cada fila. */
export const NOTA_TERNAS =
  "Cada fila, los N, My y Mz concomitantes de una combinación: la que da ese pésimo en la cabeza o en el pie del tramo flexible (N < 0, compresión; My y Mz, en los ejes de la sección, con su signo). Un pilar se dimensiona con ellas. Con el sismo del programa (marcadas con «±»), los esfuerzos de los modos combinados no tienen signo ni son simultáneos: la fila da cada uno con el signo pésimo, los momentos con el que más los aumenta y N con la menor o la mayor compresión.";

/** VS-o: el título de la marca de una terna con el sismo del programa. */
export const TITULO_PESIMOS = "Con el sismo del programa: cada esfuerzo con su signo pésimo, no un estado simultáneo";

function CeldaNu({ f, rowSpan }: { f: FilaPilar; rowSpan: number }) {
  if (!f.nu) return <td rowSpan={rowSpan}>—</td>;
  return (
    <td rowSpan={rowSpan} className={f.nu.nu > LIMITE_NU ? "w" : undefined} title={f.nu.nu > LIMITE_NU ? `Pasa de ${fmt(LIMITE_NU, 2)}, el aviso del axil reducido` : undefined}>
      {fmt(f.nu.nu, 2)}
      {/* C-22: el aviso, también con un signo (no sólo el color) */}
      {f.nu.nu > LIMITE_NU && <span aria-label={`, más de ${fmt(LIMITE_NU, 2)}`}> !</span>}
      <small>{f.nu.comb}</small>
    </td>
  );
}

/**
 * Las ternas de unos tramos: por tramo, en la cabeza y en el pie, una fila por pésimo con N, My y Mz
 * de su combinación. `titulo`, la primera celda de cada tramo (el pilar o la planta); con `onFila`,
 * un clic en el tramo. `compacta` (Propiedades, ~400 px): el título y el ν de cada tramo, en una fila
 * encima de las suyas, y sólo cinco columnas.
 */
export function TablaTernas({ filas, titulo, cabecera, activa, onFila, compacta }: { filas: readonly FilaPilar[]; titulo: (f: FilaPilar) => ReactNode; cabecera: string; activa?: (f: FilaPilar) => boolean; onFila?: (f: FilaPilar) => void; compacta?: boolean }) {
  const n = EXTREMOS_TRAMO.length * TERNAS.length;
  const izquierda = { textAlign: "left" } as const;
  return (
    <table className="tb">
      <thead>
        <tr>
          {!compacta && <th>{cabecera}</th>}
          <th style={izquierda}>Dónde</th>
          <th style={izquierda} title="El pésimo de la fila, y su combinación">
            Pésimo
          </th>
          <th>N kN</th>
          <th>My kN·m</th>
          <th>Mz kN·m</th>
          {!compacta && <th className="nu">ν</th>}
        </tr>
      </thead>
      <tbody>
        {filas.map((f) => (
          <Fragment key={`${f.pilar}@${f.planta}`}>
            {compacta && (
              <tr className={`grupo${onFila ? " clic" : ""}`} data-on={activa?.(f) || undefined} {...(onFila ? filaElegible(() => onFila(f), !!activa?.(f)) : {})}>
                <td className="et" colSpan={5}>
                  {titulo(f)}
                  {f.nu && (
                    <small className={f.nu.nu > LIMITE_NU ? "text-state-warn" : undefined}>
                      ν {fmt(f.nu.nu, 2)}
                      {f.nu.nu > LIMITE_NU ? ` > ${fmt(LIMITE_NU, 2)} !` : ""} · {f.nu.comb}
                    </small>
                  )}
                </td>
              </tr>
            )}
            {EXTREMOS_TRAMO.map((ex, i) =>
              TERNAS.map((t, j) => {
                const x = f.tramo[ex.k][t.k];
                const primera = !compacta && i === 0 && j === 0;
                return (
                  // C-19: con el teclado, una parada por tramo (su primera fila; en la compacta, la del título)
                  <tr key={`${ex.k}${t.k}`} className={onFila ? "clic" : undefined} data-on={activa?.(f) || undefined} data-terna={`${ex.k} ${t.k}`} {...(onFila ? (!compacta && i === 0 && j === 0 ? filaElegible(() => onFila(f), !!activa?.(f)) : { onClick: () => onFila(f) }) : {})}>
                    {primera && (
                      <td className="et" rowSpan={n}>
                        {titulo(f)}
                      </td>
                    )}
                    {j === 0 && (
                      <td className="et" rowSpan={TERNAS.length}>
                        {ex.nombre}
                      </td>
                    )}
                    <td className="et" title={t.title}>
                      {t.nombre}
                      <small style={{ whiteSpace: "nowrap" }}>
                        {x?.comb ?? ""}
                        {x?.pesimos && (
                          <span title={TITULO_PESIMOS} aria-label={`, ${TITULO_PESIMOS.toLowerCase()}`}>
                            {" "}±
                          </span>
                        )}
                      </small>
                    </td>
                    <td>{x ? fmt(x.esfuerzos[0], 1) : "—"}</td>
                    <td>{x ? fmt(x.esfuerzos[4], 1) : "—"}</td>
                    <td>{x ? fmt(x.esfuerzos[5], 1) : "—"}</td>
                    {primera && <CeldaNu f={f} rowSpan={n} />}
                  </tr>
                );
              }),
            )}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}
