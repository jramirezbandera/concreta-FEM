/**
 * Los tramos de un pilar en Propiedades (2026-11-05, de la primera prueba de uso de un usuario
 * externo): antes sólo se cambiaban escribiendo «N3: P30x30; N5: P25x25» en la celda `tramos`. Ahora
 * cada tramo, de la cabeza a la base, con su altura, el pilar dibujado en alzado (el canto a escala) y
 * un desplegable de secciones, de hormigón y de acero por separado. «Y los de encima» pone la misma
 * en los tramos de encima (lo habitual: el pilar se reduce de una planta hacia arriba).
 *
 * Lo que escribe es la celda `tramos` entera (`textoTramos`), como un campo más: un paso de deshacer.
 */
import { ArrowUpToLine } from "lucide-react";
import type { Seccion } from "../../../src/compilador/fisico.ts";
import { medidasSeccion } from "../../../src/compilador/puntoFijo.ts";
import { textoTramos, tramosPilar, type TramosPilar } from "../../../src/editor/ficha.ts";
import { describirSeccion, comoUna } from "../../../src/editor/gestores.ts";
import { operacionFila } from "../../../src/editor/edicion.ts";
import { DEF_TABLAS, filaConValor, type Contexto } from "../../../src/editor/tablas.ts";
import type { Fila } from "../../../src/editor/celdas.ts";
import { useVisor } from "../contexto.ts";
import { esDelGestor, abrirGestor, OpcionesGestor, pedidoCampo } from "./referencia.tsx";

/** Un número a la española con 2 decimales como mucho. */
const n2 = (v: number) => String(Number(v.toFixed(2))).replace(".", ",");

interface Props {
  id: string;
  fila: Fila;
  ctx: Contexto;
  escribir: (clave: string, valor: string) => void;
  errores: Readonly<Record<string, string>>;
}

/** Las secciones por su material: hormigón, acero y las demás (material general). */
function porMaterial(ctx: Contexto): { titulo: string; secciones: Seccion[] }[] {
  const tipo = (s: Seccion) => ctx.modelo.materiales.find((m) => m.id === s.material)?.tipo;
  const grupos = [
    { titulo: "Hormigón", secciones: ctx.modelo.secciones.filter((s) => tipo(s) === "hormigon") },
    { titulo: "Acero", secciones: ctx.modelo.secciones.filter((s) => tipo(s) === "acero") },
    { titulo: "Otras", secciones: ctx.modelo.secciones.filter((s) => tipo(s) !== "hormigon" && tipo(s) !== "acero") },
  ];
  return grupos.filter((g) => g.secciones.length);
}

/** Alto de cada fila y ancho del dibujo, px. */
const ALTO = 54;
const ANCHO = 34;

export function TramosPilarPanel({ id, fila, ctx, escribir, errores }: Props) {
  const { proyecto } = useVisor();
  const ed = proyecto.edicion;
  const t = tramosPilar(fila, ctx);
  const general = (fila.seccion ?? "").trim();
  const texto = (fila.tramos ?? "").trim();
  if (!t) {
    return texto && fila.desde && fila.hasta ? (
      <p className="nota">
        Los tramos están mal escritos en la tabla («{texto}»: cada uno, «planta: sección»).{" "}
        <button type="button" className="text-accent hover:underline" onClick={() => escribir("tramos", "")}>
          Quitarlos
        </button>
      </p>
    ) : (
      <p className="nota">Con el arranque y la cabeza, aquí salen sus tramos, cada uno con su sección.</p>
    );
  }
  const grupos = porMaterial(ctx);
  const seccion = (sid: string) => ctx.modelo.secciones.find((s) => s.id === sid);
  // El canto a escala: el mayor de los tramos llena el dibujo
  const cantos = t.tramos.map((x) => medidasSeccion(seccion(x.seccion))?.h ?? 0);
  const mayor = Math.max(...cantos, 1e-9);
  const poner = (cambios: Record<string, string>) => {
    const nuevo = textoTramos(t, general, cambios);
    if (nuevo !== texto) escribir("tramos", nuevo);
  };

  /** «Nueva sección…» o «Editar…» desde el desplegable de un tramo: lo creado y la asignación, en un paso. */
  const gestor = (cabeza: string, eleccion: string, valor: string) => {
    if (!ed) return;
    const def = DEF_TABLAS.pilares;
    abrirGestor(
      pedidoCampo({
        coleccion: "secciones",
        eleccion,
        valor,
        tabla: "pilares",
        clave: "seccion",
        fila,
        para: `la sección del tramo de ${id} con la cabeza en ${cabeza}`,
        alElegir: (nueva, crear) => {
          const celda = textoTramos(t, general, { [cabeza]: nueva });
          if (!crear.length && celda === texto) return null;
          const op = operacionFila(ed.proyecto.modelo, "pilares", id, filaConValor(def, fila, "tramos", celda));
          if (!op.ok) return op.errores.map((e) => e.mensaje).join(" · ");
          const r = ed.editar(comoUna([...crear, op.operacion]), `${id} · sección del tramo ${cabeza} = ${nueva}`);
          return r.ok ? null : r.errores.map((e) => e.mensaje).join(" ");
        },
      }),
    );
  };

  return (
    <div className="mx-3.5 mb-2" data-testid="tramos-pilar">
      <p className="text-[12px] leading-snug text-text-secondary mb-1.5">
        {t.tramos.length === 1
          ? `Un solo tramo, de ${t.tramos[0]!.base} a ${t.tramos[0]!.cabeza}.`
          : `De la cabeza a la base. Los que no tienen otra llevan la sección del pilar${general ? ` (${general})` : ""}.`}
      </p>
      <table className="w-full text-[12px] tabular-nums" aria-label={`Tramos de ${id}`} style={{ borderCollapse: "collapse" }}>
        <tbody>
          {/* Cada tramo en dos líneas (su nombre y su altura; su sección): Propiedades es estrecho */}
          {t.tramos.map((x, i) => {
            const s = seccion(x.seccion);
            const acero = !!s && ctx.modelo.materiales.find((m) => m.id === s.material)?.tipo === "acero";
            const w = Math.max(4, (cantos[i]! / mayor) * (ANCHO - 6));
            const encima = t.tramos.slice(0, i);
            return (
              <tr key={x.cabeza} data-tramo={x.cabeza} data-propia={x.propia || undefined}>
                <td style={{ width: ANCHO, padding: 0, verticalAlign: "top" }}>
                  {/* El pilar en alzado: los tramos seguidos, cada uno con su canto */}
                  <svg width={ANCHO} height={ALTO} aria-hidden="true" style={{ display: "block" }}>
                    <line x1={0} x2={ANCHO} y1={0.5} y2={0.5} stroke="currentColor" strokeOpacity={0.35} />
                    <rect
                      x={(ANCHO - w) / 2}
                      y={1}
                      width={w}
                      height={ALTO - 1}
                      className={acero ? "text-accent" : "text-text-secondary"}
                      fill="currentColor"
                      fillOpacity={x.propia ? 0.45 : 0.22}
                      stroke="currentColor"
                      strokeOpacity={0.8}
                    />
                    {i === t.tramos.length - 1 && <line x1={0} x2={ANCHO} y1={ALTO - 0.5} y2={ALTO - 0.5} stroke="currentColor" strokeOpacity={0.35} />}
                  </svg>
                </td>
                <td className="pl-2" style={{ width: "100%", paddingTop: 3, paddingBottom: 5 }}>
                  <div className="flex items-center gap-1" title={`El tramo de ${x.base} a ${x.cabeza} (en la tabla, por la planta de su cabeza)`}>
                    <span className={x.propia ? "font-semibold" : undefined}>
                      {x.base}–{x.cabeza}
                    </span>
                    {x.altura !== null && <span className="text-text-secondary">· {n2(x.altura)} m</span>}
                    {encima.some((y) => y.seccion !== x.seccion) && (
                      <button
                        type="button"
                        className="ib-chip ib-texto ml-auto"
                        style={{ display: "inline-flex", gap: 3, whiteSpace: "nowrap" }}
                        aria-label={`${x.seccion} también en los tramos de encima de ${x.base}–${x.cabeza}`}
                        title={`${x.seccion} también en los tramos de encima`}
                        onClick={() => poner(Object.fromEntries([x, ...encima].map((y) => [y.cabeza, x.seccion])))}
                      >
                        <ArrowUpToLine size={12} /> encima
                      </button>
                    )}
                  </div>
                  <select
                    className="sel mt-0.5 w-full"
                    aria-label={`Sección del tramo ${x.base}–${x.cabeza}`}
                    value={x.propia ? x.seccion : ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (esDelGestor(v)) return gestor(x.cabeza, v, x.seccion);
                      poner({ [x.cabeza]: v || general });
                    }}
                  >
                    <option value="">{general ? `la del pilar (${general})` : "la del pilar"}</option>
                    {/* Una sección escrita que no está en el modelo se conserva (la validación lo dice) */}
                    {x.propia && !s && <option value={x.seccion}>{x.seccion}</option>}
                    {grupos.map((g) => (
                      <optgroup key={g.titulo} label={g.titulo}>
                        {g.secciones.map((y) => (
                          <option key={y.id} value={y.id}>
                            {`${y.id} · ${describirSeccion(y)}`}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                    <OpcionesGestor coleccion="secciones" valor={x.seccion} />
                  </select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {errores.tramos && <p className="error">{errores.tramos}</p>}
      <Fuera t={t} general={general} quitar={() => escribir("tramos", textoTramos(t, general, {}, true))} />
    </div>
  );
}

/** Lo escrito en `tramos` que no es de ningún tramo del pilar: se dice y se quita a mano. */
function Fuera({ t, quitar }: { t: TramosPilar; general: string; quitar: () => void }) {
  if (!t.fuera.length) return null;
  return (
    <p className="nota text-state-warn mt-1">
      {t.fuera.map((x) => `${x.planta}: ${x.seccion}`).join("; ")} no {t.fuera.length === 1 ? "es de ningún tramo" : "son de ningún tramo"} de este pilar (cada tramo va por la planta de su cabeza, entre {t.tramos[t.tramos.length - 1]!.base} y {t.tramos[0]!.cabeza}).{" "}
      <button type="button" className="text-accent hover:underline" onClick={quitar}>
        Quitar{t.fuera.length === 1 ? "lo" : "los"}
      </button>
    </p>
  );
}
