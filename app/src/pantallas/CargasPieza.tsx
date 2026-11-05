/**
 * Propiedades en el espacio Cargas: lo que actúa sobre lo elegido, no lo que es (eso, en Modelo).
 *
 * - **Una pieza** (forjado, viga, pilar o muro): sus cargas por caso, cada una con su resultante y un
 *   clic que la elige; el peso propio en el caso que lo lleva (el `pp` del forjado, que se edita en
 *   Modelo); y, en el caso activo, añadir una carga en toda la pieza con los valores de la plantilla
 *   de su herramienta (Superficie, En barra o Empuje), lo mismo que un clic con ella
 *   (`src/editor/cargasPieza.ts`).
 * - **Nada elegido:** las cargas del caso activo en la planta, por tipo, y lo que recibe cada planta.
 */
import { Pencil, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { CargaFisica, ModeloFisico } from "../../../src/compilador/fisico.ts";
import { componentes, valorCarga, valorCargaVariable } from "../../../src/agente/render/modelo.ts";
import { cargaEnPieza, cargasPieza, resumenCaso, type CargasPieza as Datos, type TipoPieza } from "../../../src/editor/cargasPieza.ts";
import { cargasEnPesoPropio, casoCargasMuertas } from "../../../src/editor/casos.ts";
import type { Plantillas } from "../../../src/editor/dibujo/herramientas.ts";
import type { Operacion } from "../../../src/editor/operaciones.ts";
import type { Vec3 } from "../../../src/motor/modelo.ts";
import { IcCasos, IcForjado, IcMuro, IcPilar, IcViga } from "../armazon/iconos.tsx";
import { Cabecera, Seccion } from "../componentes/comunes.tsx";
import { useVisor } from "../contexto.ts";
import { CampoCarga, NumeroCampo, Segmentado } from "../dibujo/Plantilla.tsx";
import { cota, fmt } from "../fmt.ts";
import { PasarACargasMuertas } from "./PesoPropio.tsx";

const ICONO: Record<TipoPieza, typeof IcForjado> = { losa: IcForjado, pano: IcForjado, viga: IcViga, pilar: IcPilar, muro: IcMuro };
const NOMBRE: Record<TipoPieza, string> = { losa: "Forjado", pano: "Forjado", viga: "Viga", pilar: "Pilar", muro: "Muro" };
const NOMBRE_CARGA: Record<CargaFisica["tipo"], string> = { superficie: "Superficie", lineal: "Lineal", borde: "Borde", puntual: "Puntual", viga: "En viga", pilar: "En pilar", barra: "En barra", empuje: "Empuje" };

const num = (x: number) => fmt(x, 2);

/** Un vector de carga en texto, como en el dibujo (UI-2): «↓ 2,00 kN/m²» o sus componentes con su nombre y su signo. */
function valor(v: Vec3 | undefined, unidad: string, local = false): string {
  return v ? valorCarga(v, unidad, { local, num }) : "—";
}

/** Lo que es una carga, en una línea. */
function textoCarga(c: CargaFisica, parte: boolean): string {
  const de = parte ? " · una parte" : "";
  switch (c.tipo) {
    case "superficie":
      return `${valor(c.q, "kN/m²")}${c.zona ? " · en una zona" : ""}${de}`;
    case "lineal":
      return `${valor(c.q, "kN/m")}${de}`;
    case "borde":
      return `${valor(c.q, "kN/m")} · por el borde${de}`;
    case "puntual":
      return [c.F && valor(c.F, "kN"), c.M && componentes(c.M, ["Mx", "My", "Mz"], "kN·m", num)].filter(Boolean).join(" · ");
    case "viga":
    case "pilar":
    case "barra": {
      const q = valorCargaVariable(c.q, c.qb, "kN/m", { local: c.ejes === "local", num });
      const tramo = c.desde !== undefined || c.hasta !== undefined ? ` · de ${fmt(c.desde ?? 0, 2)} a ${c.hasta === undefined ? "el final" : `${fmt(c.hasta, 2)} m`}` : "";
      return `${q}${tramo}`;
    }
    case "empuje":
      return `${fmt(c.p0, 1)} → ${fmt(c.p1, 1)} kN/m² · de ${fmt(c.z0, 2)} a ${fmt(c.z1, 2)} m · lado ${c.lado}`;
  }
}

/** La resultante en texto: la vertical con su flecha (UI-2) y, si la hay, la horizontal. */
function resultante(F: readonly number[]): string {
  const h = Math.hypot(F[0]!, F[1]!);
  const v = F[2] === 0 ? "0" : `${F[2]! < 0 ? "↓" : "↑"} ${fmt(Math.abs(F[2]!), 1)}`;
  return h > 1e-9 ? `${v} · H ${fmt(h, 1)}` : v;
}

export function PropiedadesCargas({ id, caso, plantillas: t, setPlantillas, editar }: { id: string; caso: string; plantillas: Plantillas; setPlantillas: (p: Plantillas) => void; editar: (o: Operacion, etiqueta: string) => string | null }) {
  const { proyecto, setSeleccion, irA } = useVisor();
  const e = proyecto.estado!;
  const m = proyecto.edicion!.proyecto.modelo;
  const d = useMemo(() => cargasPieza(m, id), [m, id]);
  if (!d) return null;
  const nombreCaso = (c: string) => e.casos.find((x) => x.id === c)?.nombre;
  return (
    <>
      <Cabecera icono={ICONO[d.tipo]} tipo={`${NOMBRE[d.tipo]} · sus cargas`} titulo={id} mono detalle={geometria(m, d)}>
        {/* R-27: un icono, para que la cabecera no se parta en cuatro líneas ni corte el id */}
        <button type="button" className="ib" style={{ width: 28, height: 28 }} onClick={() => irA("modelo")} aria-label="Editar en Modelo" title="Editar en Modelo: su geometría, su sección y su pp">
          <Pencil size={15} />
        </button>
        <button type="button" className="ib" style={{ width: 28, height: 28 }} aria-label="Cerrar" title="Soltar (Esc)" onClick={() => setSeleccion(null)}>
          <X size={16} />
        </button>
      </Cabecera>
      <Anadir d={d} caso={caso} t={t} setPlantillas={setPlantillas} editar={editar} />
      {/* El peso propio, aparte de lo que mete el usuario: lo calcula el programa y se cambia en Modelo */}
      {d.pesoPropio && (
        <Seccion titulo="Peso propio · lo calcula el programa" valor={d.pesoPropio.caso ? `en ${d.pesoPropio.caso}` : "sin caso"}>
          <table className="tb" data-peso-propio>
            <tbody>
              <tr title="Se cambia en Modelo: el pp del forjado, o su sección y su material">
                <td className="txt" style={{ textAlign: "left", color: "var(--color-text-secondary)" }}>
                  {fmt(d.pesoPropio.unidad, 2)} {d.pesoPropio.queUnidad}
                  {d.pesoPropio.total === undefined ? " (sin los solapes)" : ""}
                </td>
                <td>{d.pesoPropio.total === undefined ? "—" : `${resultante([0, 0, -d.pesoPropio.total])} kN`}</td>
              </tr>
            </tbody>
          </table>
          <p className="nota">{d.pesoPropio.caso ? "No es una carga suya: sale de la geometría y del material. Para cambiarlo, el lápiz (Modelo)." : "Ningún caso lleva el peso propio (Casos): no cuenta en el cálculo."}</p>
        </Seccion>
      )}
      {d.casos.map((c) => {
        const conPP = d.pesoPropio?.caso === c.caso;
        const vacio = !c.cargas.length;
        return (
          <Seccion key={c.caso} titulo={`${c.caso === caso ? "● " : ""}${c.caso}${nombreCaso(c.caso) ? ` · ${nombreCaso(c.caso)}` : ""}`} valor={vacio ? (conPP ? "sólo el peso propio" : "sin cargas") : `${resultante(c.F)} kN${conPP ? " + peso propio" : ""}`}>
            {!vacio && (
              <table className="tb">
                <tbody>
                  {c.cargas.map((x) => (
                    <tr key={x.carga.id}>
                      <td className="txt">
                        <button type="button" className="btn mono" style={{ height: 22, padding: "0 6px", fontSize: 11 }} onClick={() => setSeleccion(x.carga.id)} title={`Elegir ${x.carga.id}`}>
                          {x.carga.id}
                        </button>
                      </td>
                      <td className="txt" style={{ textAlign: "left" }}>
                        <span className="text-text-secondary">{NOMBRE_CARGA[x.carga.tipo]}</span> {textoCarga(x.carga, x.parte)}
                      </td>
                      <td>{resultante(x.F)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {conPP && !vacio && (
              <>
                <p className="nota text-state-warn">Están en el caso del peso propio y se mezclan con lo que calcula el programa: mejor en uno de cargas muertas.</p>
                <PasarACargasMuertas />
              </>
            )}
          </Seccion>
        );
      })}
      <p className="nota">
        kN hacia abajo (H: la horizontal). Es lo dibujado: con la unión por las caras, lo que cae en el ancho de una viga lo lleva la viga.
      </p>
    </>
  );
}

/** La pieza en una línea: lo que se edita en Modelo. */
function geometria(m: ModeloFisico, d: Datos): string {
  switch (d.tipo) {
    case "losa": {
      const l = m.losas!.find((x) => x.id === d.id)!;
      return `${l.planta} · ${l.reticular ? "reticular" : "losa maciza"} · ${fmt(l.espesor, 2)} m`;
    }
    case "pano": {
      const p = m.panos!.find((x) => x.id === d.id)!;
      return `${p.planta} · unidireccional · ${fmt(p.direccion, 0)}°`;
    }
    case "viga": {
      const v = m.vigas!.find((x) => x.id === d.id)!;
      return `${v.planta} · ${v.seccion}`;
    }
    case "pilar": {
      const p = m.pilares!.find((x) => x.id === d.id)!;
      return `${p.desde} → ${p.hasta} · ${p.seccion}`;
    }
    case "muro": {
      const w = m.muros!.find((x) => x.id === d.id)!;
      return `${w.desde} → ${w.hasta} · ${fmt(w.espesor, 2)} m`;
    }
  }
}

/** Añadir una carga en toda la pieza, en el caso activo, con los valores de la plantilla de su herramienta. */
function Anadir({ d, caso, t, setPlantillas, editar }: { d: Datos; caso: string; t: Plantillas; setPlantillas: (p: Plantillas) => void; editar: (o: Operacion, etiqueta: string) => string | null }) {
  const { proyecto } = useVisor();
  const m = proyecto.edicion!.proyecto.modelo;
  const [lado, setLado] = useState<"izquierdo" | "derecho" | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const c = t.cargas ?? {};
  const poner = (x: Partial<NonNullable<Plantillas["cargas"]>>) => {
    setError(null);
    setPlantillas({ ...t, cargas: { ...c, ...x } });
  };
  const anadir = () => {
    const r = cargaEnPieza(m, c, d.id, lado);
    setError(typeof r === "string" ? r : editar(r.operacion, r.etiqueta));
  };
  const forjado = d.tipo === "losa" || d.tipo === "pano";
  const barra = d.tipo === "viga" || d.tipo === "pilar";
  return (
    <Seccion titulo={`Añadir en ${caso || "—"}`} valor={forjado ? "en todo él" : d.tipo === "muro" ? "en todo él" : "en toda la pieza"}>
      <div className="py-1">
        {forjado && <CampoCarga etiqueta="q" unidad="kN/m²" valor={c.superficie?.q} onCambio={(q) => poner({ superficie: { ...c.superficie, q } })} ayuda="Por m² de forjado, sin sus huecos: p. ej., 1,5 de solado o 2 de uso." />}
        {barra && (
          <>
            <Segmentado
              etiqueta="ejes"
              valor={c.barra?.ejes ?? "global"}
              opciones={[
                ["global", "Globales"],
                ["local", "Locales"],
              ]}
              onCambio={(ejes) => poner({ barra: { ...c.barra, ejes } })}
            />
            <CampoCarga
              key={c.barra?.ejes ?? "global"}
              etiqueta="q"
              unidad="kN/m"
              componentes={c.barra?.ejes === "local" ? "locales" : undefined}
              valor={c.barra?.q}
              onCambio={(q) => poner({ barra: { ...c.barra, q } })}
              ayuda="Por metro de la pieza; al principio, si varía."
              final={{ etiqueta: "qb", valor: c.barra?.qb, onCambio: (qb) => poner({ barra: { ...c.barra, qb } }), ayuda: "Al final, si varía (vacío: uniforme)." }}
            />
          </>
        )}
        {d.tipo === "muro" && (
          <>
            <Segmentado
              etiqueta="terreno"
              valor={lado ?? ("" as "izquierdo")}
              opciones={[
                ["izquierdo", "Izquierdo"],
                ["derecho", "Derecho"],
              ]}
              onCambio={(x) => {
                setError(null);
                setLado(x);
              }}
              ayuda="Mirando del primer punto del muro al último; empuja hacia el otro lado."
            />
            <NumeroCampo etiqueta="z0" unidad="m" valor={c.empuje?.z0} onCambio={(z0) => poner({ empuje: { ...c.empuje, z0 } })} ayuda="Sobre la base del muro, donde vale p0." />
            <NumeroCampo etiqueta="z1" unidad="m" valor={c.empuje?.z1} onCambio={(z1) => poner({ empuje: { ...c.empuje, z1 } })} falta={c.empuje?.z1 === undefined} ayuda="Donde vale p1; nula fuera de z0–z1." />
            <NumeroCampo etiqueta="p0" unidad="kN/m²" cero valor={c.empuje?.p0} onCambio={(p0) => poner({ empuje: { ...c.empuje, p0 } })} falta={c.empuje?.p0 === undefined} />
            <NumeroCampo etiqueta="p1" unidad="kN/m²" valor={c.empuje?.p1} onCambio={(p1) => poner({ empuje: { ...c.empuje, p1 } })} />
          </>
        )}
        <div className="flex items-center gap-2 px-3.5 pt-1">
          <button type="button" className="btn btn-p" onClick={anadir} disabled={!caso}>
            <Plus size={14} />
            Añadir a {d.id}
          </button>
        </div>
        {error && <p className="nota text-state-fail">{error}</p>}
        <p className="nota">Los mismos valores que la herramienta {forjado ? "Superficie" : barra ? "En barra" : "Empuje"}: para un trozo, dibújela.</p>
      </div>
    </Seccion>
  );
}

/** Sin nada elegido: el caso activo en la planta, por tipo, y lo que recibe cada planta. */
export function ResumenCaso({ caso, setCaso }: { caso: string; setCaso?: (c: string) => void }) {
  const { proyecto, planta } = useVisor();
  const e = proyecto.estado!;
  const m = proyecto.edicion?.proyecto.modelo;
  const c = e.casos.find((x) => x.id === caso);
  const filas = useMemo(() => (m && planta && caso ? resumenCaso(m, caso, planta) : null), [m, planta, caso]);
  const r = e.resumen?.plantas.find((p) => p.id === planta) ?? null;
  const total = filas?.reduce((s, x) => [s[0]! + x.F[0], s[1]! + x.F[1], s[2]! + x.F[2]], [0, 0, 0]);
  // El caso de cargas muertas que ya está, para ir a él desde el del peso propio
  const casoCM = useMemo(() => (m && c?.pesoPropio ? (casoCargasMuertas(m)?.crear.length === 0 ? casoCargasMuertas(m)!.id : null) : null), [m, c?.pesoPropio]);
  return (
    <>
      <Cabecera icono={IcCasos} tipo="Caso activo · nada elegido" titulo={caso || "—"} mono detalle={c ? [c.nombre, c.accion ?? "sin acción", c.pesoPropio ? "con peso propio" : null].filter(Boolean).join(" · ") : undefined} />
      {filas && (
        <Seccion titulo={`En ${planta}${r ? ` (${cota(r.cota)} m)` : ""}`} valor={filas.length ? `${resultante(total!)} kN` : "sin cargas"}>
          {filas.length > 0 ? (
            <table className="tb">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Tipo</th>
                  <th>Cargas</th>
                  <th>kN</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((x) => (
                  <tr key={x.tipo}>
                    <td className="txt" style={{ textAlign: "left" }}>
                      {NOMBRE_CARGA[x.tipo]}
                    </td>
                    <td>{x.n}</td>
                    <td>{resultante(x.F)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="nota">Dibuje las cargas con las herramientas de la barra o elija un forjado, una viga, un pilar o un muro para añadirle una.</p>
          )}
          {c?.pesoPropio && filas.length > 0 && <p className="nota text-state-warn">Son del usuario, en el caso del peso propio: se mezclan con lo que calcula el programa.</p>}
        </Seccion>
      )}
      {c?.pesoPropio && (
        <Seccion titulo="El caso del peso propio" valor="lo calcula el programa">
          <p className="nota">
            El peso de forjados, vigas, pilares y muros sale de la geometría y del material: en la planta, en gris (se cambia en Modelo). Las cargas que meta usted (solados, tabiquería, petos…) van mejor en un caso de cargas muertas, con la misma acción: así se distingue lo suyo de lo del programa, también en los resultados por caso, y las combinaciones dan lo mismo.
          </p>
          <PasarACargasMuertas alHacer={setCaso} />
          {casoCM && casoCM !== caso && !(m && cargasEnPesoPropio(m).length) && setCaso && (
            <div className="px-3.5 pt-1">
              <button type="button" className="btn" onClick={() => setCaso(casoCM)}>
                Ir a {casoCM}
              </button>
            </div>
          )}
        </Seccion>
      )}
      {r && (
        <Seccion titulo="Lo que recibe la planta" valor="kN">
          <table className="tb">
            <thead>
              <tr>
                <th>Caso</th>
                <th>Vertical kN</th>
                <th>Horizontal kN</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(r.cargas).map(([k, v]) => (
                <tr key={k} data-on={k === caso}>
                  <td>{k}</td>
                  <td>{fmt(v, 1)}</td>
                  <td>{r.horizontales?.[k] ? `${fmt(r.horizontales[k]![0], 1)}; ${fmt(r.horizontales[k]![1], 1)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="nota">Con el peso propio (−ΣFz de sus cargas).</p>
        </Seccion>
      )}
      <p className="nota">Un clic en una carga la elige; en una pieza, da sus cargas y deja añadirle una.</p>
    </>
  );
}


/** Encima del formulario de una carga, en Cargas: la pieza que nombra, para ver todas las suyas. */
export function SobrePieza({ id }: { id: string }) {
  const { proyecto, setSeleccion } = useVisor();
  const c = proyecto.edicion?.proyecto.modelo.cargas?.find((x) => x.id === id);
  const pieza = !c ? undefined : c.tipo === "superficie" ? (c.losa ?? c.pano) : c.tipo === "viga" ? c.viga : c.tipo === "pilar" ? c.pilar : c.tipo === "empuje" ? c.muro : undefined;
  if (!pieza) return null;
  return (
    <p className="nota">
      Sobre{" "}
      <button type="button" className="btn mono" style={{ height: 22, padding: "0 6px", fontSize: 11 }} onClick={() => setSeleccion(pieza)} title={`Elegir ${pieza}: todas sus cargas`}>
        {pieza}
      </button>{" "}
      : un clic da todas sus cargas.
    </p>
  );
}
