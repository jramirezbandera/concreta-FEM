/**
 * Espacio Revisión (la pantalla 7 de V1): el informe de A3 (`revisar`, el mismo de `fem revisar`)
 * con su índice en el navegador, y el estado de su firma en `<proyecto>.revision.json`.
 *
 * UI-32: se firma también aquí, con el nombre tecleado y «He revisado el informe», con la misma
 * huella y el mismo sha256 del informe que `fem firmar`, y la nota de que la herramienta está en
 * validación. Es una interacción humana: el agente firma sólo si se lo pide el ingeniero, y la skill
 * se lo prohíbe. Donde el origen no puede escribir junto al proyecto (el servidor local), la orden
 * de la CLI.
 */
import { useEffect, useMemo, useState } from "react";
import { anadirFirma, leerFirmas, NOTA_VALIDACION, VERSION_FIRMAS, type Firma } from "../../../src/agente/revision.ts";
import { ClipboardCopy } from "lucide-react";
import type { Bloque } from "../../../src/agente/informe.ts";
import { Disposicion, Herramienta, Separador } from "../armazon/Disposicion.tsx";
import { IcFirma, type Icono } from "../armazon/iconos.tsx";
import { usePaneles } from "../armazon/paneles.ts";
import { Aviso, Cabecera, Seccion, AvisoDesactualizado } from "../componentes/comunes.tsx";
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
      <figcaption className="mt-1 text-[11px] text-text-muted">{titulo}</figcaption>
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

/** Firmar el informe aquí (UI-32): quién firma, tecleado, y la confirmación de haberlo revisado. */
function FormularioFirma({ huella, informe, avisos, firmas, firmar }: { huella: string; informe: string; avisos: number; firmas: string; firmar: (texto: string) => Promise<string | null> }) {
  const [por, setPor] = useState("");
  const [revisado, setRevisado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [firmando, setFirmando] = useState(false);
  const listo = por.trim().length >= 3 && revisado && !firmando;
  const hacer = async () => {
    if (!listo) return;
    const f = leerFirmas(firmas);
    if ("error" in f) return setError(`El fichero de firmas ${f.error}: no se toca.`);
    const firma: Firma = { huella, por: por.trim(), fecha: new Date().toISOString(), informe, via: "app", nota: NOTA_VALIDACION };
    setFirmando(true);
    const e = await firmar(`${JSON.stringify(anadirFirma(f, firma), null, 2)}\n`);
    setFirmando(false);
    setError(e);
  };
  return (
    <form
      className="flex flex-col gap-2 px-3.5 py-2"
      onSubmit={(e) => {
        e.preventDefault();
        void hacer();
      }}
    >
      <label className="campo">
        <span>Quién firma</span>
        <input value={por} onChange={(e) => setPor(e.target.value)} placeholder="Nombre y apellidos" aria-label="Quién firma" autoComplete="name" />
      </label>
      <label className="flex items-start gap-2 text-[12px] text-text-secondary">
        <input type="checkbox" className="mt-[3px]" checked={revisado} onChange={(e) => setRevisado(e.target.checked)} aria-label="He revisado el informe" />
        <span>
          He revisado el informe{avisos ? ` y sus ${avisos} aviso${avisos === 1 ? "" : "s"}` : ""}, y firmo esta versión del proyecto.
        </span>
      </label>
      <p className="m-0 text-[11.5px] leading-snug text-text-muted">{NOTA_VALIDACION} La firma queda en el fichero de firmas, con la huella del modelo y el sha256 del informe.</p>
      {error && <p className="m-0 text-[12px] text-state-fail" role="alert">{error}</p>}
      <button type="submit" className="btn btn-p self-start" disabled={!listo} title={!revisado ? "Marque antes «He revisado el informe»" : por.trim().length < 3 ? "Escriba quién firma" : "Firmar el informe de esta versión"}>
        {firmando ? "Firmando…" : "Firmar el informe"}
      </button>
    </form>
  );
}

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
      {proyecto.firmar ? (
        <span className="self-center px-2 text-[12px] text-text-muted">Firmar es del ingeniero, después de leer el informe: en Propiedades, a la derecha.</span>
      ) : (
        <>
          <Herramienta
            icono={IcCopiar}
            nombre={copiada ? "Copiada" : "Orden de firmar"}
            title={`Copiar la orden: ${orden}`}
            onClick={() => {
              void navigator.clipboard?.writeText(orden).then(() => setCopiada(true));
              window.setTimeout(() => setCopiada(false), 1500);
            }}
          />
          <span className="self-center px-2 text-[12px] text-text-muted">Firmar es del ingeniero, en la línea de órdenes, después de leer el informe.</span>
        </>
      )}
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
        titulo: "Firma",
        ancho: 320,
        contenido: (
          <>
        <Cabecera
          icono={IcFirma}
          tipo="Informe de revisión"
          titulo={!x ? "—" : "error" in x.firma ? "Firmas ilegibles" : x.firma.firmado ? (x.firma.mismoInforme ? "Firmado" : "Firmado otro informe") : "Sin firmar"}
          detalle={x && !("error" in x.firma) && x.firma.firmado ? `Por ${x.firma.por} el ${x.firma.fecha.slice(0, 10)}.` : undefined}
        >
          {x && !("error" in x.firma) && <span className={`pill ${x.firma.firmado ? (x.firma.mismoInforme ? "ok" : "warn") : "neu"}`}>{x.firma.firmado ? (x.firma.mismoInforme ? "FIRMADO" : "OTRO INFORME") : "SIN FIRMAR"}</span>}
        </Cabecera>
        <Seccion titulo="Firma">
          {x &&
            ("error" in x.firma ? (
              <p className="nota text-state-fail">El fichero de firmas {x.firma.error}.</p>
            ) : x.firma.firmado ? (
              !x.firma.mismoInforme && <p className="nota text-state-warn">La firma es de esta huella pero de otro informe (otro núcleo de cálculo u otras comprobaciones): hay que volver a revisarlo.</p>
            ) : (
              x.otrasHuellas > 0 && <p className="nota text-state-warn">Hay {x.otrasHuellas} firma{x.otrasHuellas === 1 ? "" : "s"} de versiones anteriores del proyecto: el modelo cambió desde entonces.</p>
            ))}
          {x && !("error" in x.firma) && !(x.firma.firmado && x.firma.mismoInforme) && proyecto.firmar && !proyecto.desactualizado ? (
            <FormularioFirma huella={e.huella} informe={x.sha256} avisos={x.avisos} firmas={proyecto.firmas} firmar={proyecto.firmar} />
          ) : !proyecto.firmar ? (
            <p className="nota">
              {proyecto.fuente?.tipo !== "origen"
                ? "Abierto sin su carpeta, el proyecto no se puede firmar aquí: guárdelo en sus proyectos (botón de la barra de arriba) o ábralo desde su carpeta."
                : "Aquí no se puede escribir junto al proyecto: fírmelo en la línea de órdenes, después de leer el informe."}
              <code className="mt-1 block rounded bg-bg-elevated px-2 py-1 font-mono text-[11px] text-text-primary">bun run fem firmar {fichero} --por "Nombre"</code>
            </p>
          ) : null}
          {x && !("error" in x.firma) && x.firma.firmado && <p className="nota">Firmas en {proyecto.fuente?.tipo === "origen" && proyecto.fuente.origen.navegador ? "este navegador, con el proyecto" : `${fichero.replace(/\.json$/i, "")}.revision.json, junto al proyecto`} ({VERSION_FIRMAS}).</p>}
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
              <p className="nota">El sha256 es el del informe en Markdown que escribe <span className="mono">fem revisar</span>: el que cubre la firma.</p>
            </Seccion>
            <Seccion titulo="Comprobaciones" valor={`${x.avisos} aviso${x.avisos === 1 ? "" : "s"}`}>
              {x.comprobaciones.map((c) => (
                <a key={c.codigo} href={`#${ancla(x.documento.findIndex((b) => b.tipo === "titulo" && b.texto.includes(c.titulo)))}`} className="flex items-center justify-between gap-2 border-b border-border-sub px-3.5 py-1.5 text-[12px] text-text-secondary hover:bg-bg-elevated">
                  <span className="min-w-0">
                    <span className="block text-text-primary">{c.titulo}</span>
                    {c.peor && <span className="mono block truncate text-[10.5px] text-text-muted">peor: {c.peor}</span>}
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
