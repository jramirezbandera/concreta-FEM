/**
 * Espacio Revisión (la pantalla 7 de V1): el informe de A3 (`revisar`, el mismo de `fem revisar`)
 * con su índice en el navegador y sus comprobaciones de sensatez en Propiedades.
 *
 * Sin firma (decisión del usuario, 2026-11-05): no tiene sentido firmar los resultados de un
 * programa. El informe es la revisión de sensatez del modelo y de sus resultados.
 */
import { useEffect, useMemo, useState } from "react";
import type { Bloque } from "../../../src/agente/informe.ts";
import { Disposicion } from "../armazon/Disposicion.tsx";
import { IcInforme } from "../armazon/iconos.tsx";
import { usePaneles } from "../armazon/paneles.ts";
import { Aviso, Cabecera, Seccion, AvisoDesactualizado } from "../componentes/comunes.tsx";
import { Dialogo } from "../editor/Dialogos.tsx";
import { useVisor } from "../contexto.ts";
import { usePedido } from "../sesion/usePedido.ts";

const ancla = (i: number) => `informe-${i}`;

/**
 * R-33: la letra de la figura. El SVG de `fem render` pide Roboto, que la página no puede darle a
 * una imagen (salía con serifa, la de por defecto): aquí, una sin serifa del sistema detrás. El
 * fichero del informe no cambia.
 */
const conLetra = (svg: string) => svg.replace(/font-family="Roboto"/, `font-family="Roboto, 'Segoe UI', system-ui, -apple-system, Helvetica, Arial, sans-serif"`);

/**
 * Figura del informe: su SVG (generado por el render de A4) como imagen, sin insertarlo en el DOM.
 * R-33: un clic la abre a toda la pantalla, a su tamaño (en el ancho del informe, los rótulos
 * quedaban en 6–7 px).
 */
function Figura({ svg, titulo }: { svg: string; titulo: string }) {
  const url = useMemo(() => URL.createObjectURL(new Blob([conLetra(svg)], { type: "image/svg+xml" })), [svg]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const [grande, setGrande] = useState(false);
  return (
    <figure className="my-3">
      <button type="button" className="block w-full cursor-zoom-in p-0" style={{ background: "none", border: 0 }} onClick={() => setGrande(true)} title="Ampliar la figura" aria-label={`Ampliar: ${titulo}`}>
        <img src={url} alt={titulo} className="w-full rounded border border-border-sub bg-white" />
      </button>
      <figcaption className="mt-1 text-[11px] text-text-muted">{titulo} · un clic la amplía</figcaption>
      {grande && (
        <Dialogo
          titulo={titulo}
          clase="dialogo-figura"
          onCerrar={() => setGrande(false)}
          pie={
            <button type="button" className="btn btn-p" onClick={() => setGrande(false)}>
              Cerrar
            </button>
          }
        >
          <img src={url} alt={titulo} className="block max-w-none rounded border border-border-sub bg-white" />
        </Dialogo>
      )}
    </figure>
  );
}

/** D-34: el estado de una comprobación en la tabla del informe, con el color de las pastillas de la derecha. */
function Celda({ c }: { c: string }) {
  if (c.startsWith("AVISOS")) return <span className="pill warn">{c}</span>;
  if (c === "bien") return <span className="text-state-ok">{c}</span>;
  return <>{c}</>;
}

function Documento({ doc }: { doc: Bloque[] }) {
  return (
    <article className="mx-auto max-w-[880px] px-7 py-6 text-[13px] leading-[1.45]">
      {doc.map((b, i) => {
        switch (b.tipo) {
          case "titulo": {
            const T = b.nivel === 1 ? "h1" : b.nivel === 2 ? "h2" : "h3";
            return (
              <T key={i} id={ancla(i)} className={b.nivel === 1 ? "mb-2 text-[18px] font-semibold" : b.nivel === 2 ? "mb-1.5 mt-6 border-b border-border-main pb-1 text-[13px] font-semibold" : "mb-1 mt-4 text-[13px] font-semibold"}>
                {b.texto}
              </T>
            );
          }
          case "parrafo":
            return (
              <p key={i} className="my-1.5 text-text-secondary">
                {b.texto}
              </p>
            );
          case "lista":
            return (
              <ul key={i} className="my-1.5 list-disc pl-5 text-text-secondary">
                {b.items.map((x, j) => (
                  <li key={j} className="py-0.5">
                    {x}
                  </li>
                ))}
              </ul>
            );
          case "tabla":
            return (
              <div key={i} className="my-2 overflow-x-auto rounded border border-border-sub">
                <table className="tb">
                  <thead>
                    <tr>
                      {b.cabecera.map((c, j) => (
                        <th key={j} style={b.numericas?.includes(j) ? undefined : { textAlign: "left" }}>
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.filas.map((f, j) => (
                      <tr key={j}>
                        {f.map((c, k) => (
                          <td key={k} className={b.numericas?.includes(k) ? undefined : "txt"} style={b.numericas?.includes(k) ? undefined : { textAlign: "left" }}>
                            <Celda c={c} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "figura":
            return <Figura key={i} svg={b.svg} titulo={b.titulo} />;
        }
      })}
    </article>
  );
}

const TONO = { bien: "ok", avisos: "warn", "no-aplica": "neu" } as const;
const TEXTO = { bien: "BIEN", avisos: "AVISOS", "no-aplica": "NO APLICA" } as const;

export function EspacioRevision() {
  const { proyecto } = useVisor();
  const pan = usePaneles("revision", { nav: true, props: true });
  const e = proyecto.estado!;
  const r = usePedido(proyecto.cliente, { tipo: "revision" });
  const x = r.datos;

  const resumen = !x ? null : x.avisos ? { tono: "warn", texto: `${x.avisos} AVISO${x.avisos === 1 ? "" : "S"} DE SENSATEZ` } : { tono: "ok", texto: "SIN AVISOS DE SENSATEZ" };
  const herramientas = (
    <span className="flex items-center gap-2 px-2 text-[13px] text-text-secondary">
      <IcInforme size={20} />
      {resumen ? <span className={`pill ${resumen.tono}`}>{resumen.texto}</span> : "Revisando…"}
    </span>
  );

  return (
    <Disposicion
      paneles={pan}
      etiquetaHerramientas="Herramientas de Revisión"
      herramientas={herramientas}
      nav={{
        titulo: "Índice",
        contenido: (
          <>
        <Seccion titulo="Índice">
          {x ? (
            <nav className="py-1">
              {x.documento.map((b, i) =>
                b.tipo === "titulo" && b.nivel <= 2 ? (
                  <a key={i} href={`#${ancla(i)}`} className="block px-3.5 py-1 text-[12px] text-text-secondary hover:bg-bg-elevated hover:text-text-primary" style={{ paddingLeft: b.nivel === 1 ? 14 : 24 }}>
                    {b.texto}
                  </a>
                ) : null,
              )}
            </nav>
          ) : (
            <p className="nota">…</p>
          )}
        </Seccion>
          </>
        ),
      }}
      vista={
      <section className="scroll-hide min-h-0 flex-1 overflow-y-auto bg-bg-primary" aria-label="Informe de revisión">
        {proyecto.desactualizado ? (
          <div className="mt-10 grid place-items-center">
            <AvisoDesactualizado que="este informe" />
          </div>
        ) : r.diagnosticos ? (
          <div className="mt-10 grid place-items-center">
            <Aviso tono="fail">{r.diagnosticos.map((d) => d.mensaje).join(" ")}</Aviso>
          </div>
        ) : x ? (
          <Documento doc={x.documento} />
        ) : (
          <div className="mt-10 grid place-items-center">
            <Aviso>Revisando el modelo y los resultados… En un edificio grande tarda unos segundos.</Aviso>
          </div>
        )}
      </section>
      }
      props={{
        titulo: "Informe",
        ancho: 320,
        contenido: (
          <>
        <Cabecera icono={IcInforme} tipo="Informe de revisión" titulo={!x ? "—" : x.avisos ? "Con avisos" : "Sin avisos"} detalle="Comprobaciones de orden de magnitud del modelo y de sus resultados; no son comprobaciones de norma." />
        {x && (
          <>
            <Seccion titulo="Identidad">
              <div className="fila">
                <span>Huella</span>
                <span className="v">{e.huella.slice(0, 16)}</span>
              </div>
              <div className="fila">
                <span>Núcleo</span>
                <span className="v">{proyecto.cliente?.motor?.slice(0, 16)}</span>
              </div>
              <p className="nota">El informe vale para esta versión del proyecto: si el modelo cambia, se rehace.</p>
            </Seccion>
            {/* R-29: de sensatez (los del compilador y el cálculo, al final del informe y en Diagnósticos) */}
            <Seccion titulo="Comprobaciones de sensatez" valor={`${x.avisos} aviso${x.avisos === 1 ? "" : "s"}`}>
              {x.comprobaciones.map((c) => (
                <a key={c.codigo} href={`#${ancla(x.documento.findIndex((b) => b.tipo === "titulo" && b.texto.includes(c.titulo)))}`} className="flex items-center justify-between gap-2 border-b border-border-sub px-3.5 py-1.5 text-[12px] text-text-secondary hover:bg-bg-elevated">
                  <span className="min-w-0">
                    <span className="block text-text-primary">{c.titulo}</span>
                    {c.peor && <span className="mono block truncate text-[11px] text-text-muted">peor: {c.peor}</span>}
                  </span>
                  <span className={`pill ${TONO[c.estado]}`}>{TEXTO[c.estado]}</span>
                </a>
              ))}
            </Seccion>
          </>
        )}
          </>
        ),
      }}
    />
  );
}
