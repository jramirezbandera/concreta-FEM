/**
 * Espacio Revisión (la pantalla 7 de V1): el informe de A3 (`revisar`, el mismo de `fem revisar`)
 * con su índice en el navegador, y el estado de su firma en `<proyecto>.revision.json`. El visor no firma: firmar es `fem firmar`, sólo
 * del ingeniero, y el fichero de firmas se vuelve a leer cuando cambia.
 */
import { useEffect, useMemo, useState } from "react";
import { ClipboardCopy } from "lucide-react";
import type { Bloque } from "../../../src/agente/informe.ts";
import { Disposicion, Herramienta, Separador } from "../armazon/Disposicion.tsx";
import { IcFirma, type Icono } from "../armazon/iconos.tsx";
import { usePaneles } from "../armazon/paneles.ts";
import { Aviso, Seccion } from "../componentes/comunes.tsx";
import { useVisor } from "../contexto.ts";
import { nombreFirmas } from "../sesion/origen.ts";
import { usePedido } from "../sesion/usePedido.ts";

const ancla = (i: number) => `informe-${i}`;

/** Figura del informe: su SVG (generado por el render de A4) como imagen, sin insertarlo en el DOM. */
function Figura({ svg, titulo }: { svg: string; titulo: string }) {
  const url = useMemo(() => URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })), [svg]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <figure className="my-3">
      <img src={url} alt={titulo} className="w-full rounded border border-border-sub bg-white" />
      <figcaption className="mt-1 text-[11px] text-text-disabled">{titulo}</figcaption>
    </figure>
  );
}

function Documento({ doc }: { doc: Bloque[] }) {
  return (
    <article className="mx-auto max-w-[880px] px-7 py-6 text-[13px] leading-[1.45]">
      {doc.map((b, i) => {
        switch (b.tipo) {
          case "titulo": {
            const T = b.nivel === 1 ? "h1" : b.nivel === 2 ? "h2" : "h3";
            return (
              <T key={i} id={ancla(i)} className={b.nivel === 1 ? "mb-2 text-[18px] font-semibold" : b.nivel === 2 ? "mb-1.5 mt-6 border-b border-border-main pb-1 text-[14px] font-semibold" : "mb-1 mt-4 text-[13px] font-semibold"}>
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
                            {c}
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

const IcCopiar: Icono = ({ size }) => <ClipboardCopy size={size} strokeWidth={1.5} aria-hidden="true" />;

export function EspacioRevision() {
  const { proyecto } = useVisor();
  const pan = usePaneles("revision", { nav: true, props: true });
  const [copiada, setCopiada] = useState(false);
  const e = proyecto.estado!;
  const fichero = proyecto.fuente?.tipo === "origen" ? proyecto.fuente.origen.fichero : (proyecto.fuente?.nombre ?? "proyecto.json");
  const r = usePedido(proyecto.cliente, { tipo: "revision", firmas: proyecto.firmas, ficheroFirmas: nombreFirmas(fichero) });
  const x = r.datos;

  const orden = `bun run fem firmar ${fichero} --por "Nombre"`;
  const estadoFirma = !x ? null : "error" in x.firma ? { tono: "fail", texto: "FICHERO DE FIRMAS CON ERRORES" } : x.firma.firmado ? (x.firma.mismoInforme ? { tono: "ok", texto: "FIRMADO" } : { tono: "warn", texto: "FIRMADO OTRO INFORME" }) : { tono: "neu", texto: "SIN FIRMAR" };
  const herramientas = (
    <>
      <span className="flex items-center gap-2 px-2 text-[13px] text-text-secondary">
        <IcFirma size={20} />
        {estadoFirma ? <span className={`pill ${estadoFirma.tono}`}>{estadoFirma.texto}</span> : "Revisando…"}
      </span>
      <Separador />
      <Herramienta
        icono={IcCopiar}
        nombre={copiada ? "Copiada" : "Orden de firmar"}
        title={`Copiar la orden: ${orden}`}
        onClick={() => {
          void navigator.clipboard?.writeText(orden).then(() => setCopiada(true));
          window.setTimeout(() => setCopiada(false), 1500);
        }}
      />
      <span className="self-center px-2 text-[12px] text-text-disabled">Firmar es sólo del ingeniero, en la línea de órdenes, después de leer el informe.</span>
    </>
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
            <Aviso tono="warn">El fichero cambió: este informe ya no es el del proyecto.</Aviso>
          </div>
        ) : r.diagnosticos ? (
          <div className="mt-10 grid place-items-center">
            <Aviso tono="fail">{r.diagnosticos.map((d) => d.mensaje).join(" ")}</Aviso>
          </div>
        ) : x ? (
          <Documento doc={x.documento} />
        ) : (
          <div className="mt-10 grid place-items-center">
            <Aviso>Revisando el modelo y los resultados (A3)… En el edificio objetivo tarda unos segundos.</Aviso>
          </div>
        )}
      </section>
      }
      props={{
        titulo: "Firma",
        ancho: 320,
        contenido: (
          <>
        <Seccion titulo="Firma">
          {x &&
            ("error" in x.firma ? (
              <p className="nota text-state-fail">El fichero de firmas {x.firma.error}.</p>
            ) : x.firma.firmado ? (
              <div className="px-3.5 py-2">
                <span className={`pill ${x.firma.mismoInforme ? "ok" : "warn"}`}>{x.firma.mismoInforme ? "FIRMADO" : "FIRMADO OTRO INFORME"}</span>
                <p className="mt-2 text-[12px] text-text-secondary">
                  Por <b className="text-text-primary">{x.firma.por}</b> el {x.firma.fecha.slice(0, 10)}.
                  {!x.firma.mismoInforme && " La firma es de esta huella pero de otro informe (otro núcleo de cálculo u otras comprobaciones): hay que volver a revisarlo."}
                </p>
              </div>
            ) : (
              <div className="px-3.5 py-2">
                <span className="pill neu">SIN FIRMAR</span>
                {x.otrasHuellas > 0 && <p className="mt-2 text-[12px] text-state-warn">Hay {x.otrasHuellas} firma{x.otrasHuellas === 1 ? "" : "s"} de versiones anteriores del proyecto: el modelo cambió desde entonces.</p>}
              </div>
            ))}
          <p className="nota">
            Firmar es sólo del ingeniero, en la línea de órdenes, después de leer el informe:
            <code className="mt-1 block rounded bg-bg-elevated px-2 py-1 font-mono text-[11px] text-text-primary">bun run fem firmar {fichero} --por "Nombre"</code>
            {proyecto.fuente?.tipo === "origen" ? "El visor vuelve a leer las firmas cuando cambian." : "Abierto sin su carpeta: el visor no ve el fichero de firmas."}
          </p>
        </Seccion>
        {x && (
          <>
            <Seccion titulo="Identidad">
              <div className="fila">
                <span>Huella</span>
                <span className="v">{e.huella.slice(0, 16)}</span>
              </div>
              <div className="fila">
                <span>sha256 del informe</span>
                <span className="v" title={x.sha256}>
                  {x.sha256.slice(0, 16)}
                </span>
              </div>
              <div className="fila">
                <span>Núcleo</span>
                <span className="v">{proyecto.cliente?.motor?.slice(0, 16)}</span>
              </div>
              <p className="nota">El sha256 es el del informe en Markdown que escribe `fem revisar`: el que cubre la firma.</p>
            </Seccion>
            <Seccion titulo="Comprobaciones" valor={`${x.avisos} avisos`}>
              {x.comprobaciones.map((c) => (
                <a key={c.codigo} href={`#${ancla(x.documento.findIndex((b) => b.tipo === "titulo" && b.texto.includes(c.titulo)))}`} className="flex items-center justify-between gap-2 border-b border-border-sub px-3.5 py-1.5 text-[12px] text-text-secondary hover:bg-bg-elevated">
                  <span className="min-w-0">
                    <span className="block text-text-primary">{c.titulo}</span>
                    {c.peor && <span className="mono block truncate text-[10.5px] text-text-disabled">peor: {c.peor}</span>}
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
