/**
 * El emplazamiento de la obra (`acciones.emplazamiento`), común a la ficha «Viento, nieve y sismo» y
 * a «Datos de la obra» (DO-d: el mismo dato con el mismo componente, editable desde los dos sitios):
 * la provincia, el municipio (un buscador sobre la tabla del Anejo 1 de la NCSE-02; uno que no figura,
 * sólo por su nombre) y la altitud. Debajo, lo que sale de ellos al momento: la zona eólica de la
 * provincia, el ab y el K del municipio y, si se pide, la sk de la nieve.
 *
 * `useEmplazamiento` lleva el estado del formulario y da lo que se escribirá; `CampoEmplazamiento`
 * lo pinta. Los ficheros de antes llevan el `ine` en el sismo y la altitud en el viento: se toman de
 * ahí y, al aplicar, pasan al emplazamiento.
 */
import { useMemo, useState, type ReactNode } from "react";
import type { AccionesEdificio, EmplazamientoEdificio } from "../../../src/compilador/fisico.ts";
import { leerNumero } from "../../../src/editor/celdas.ts";
import { ZONAS_EOLICAS } from "../../../src/normas/cteViento.ts";
import { buscarMunicipios, municipioPorIne, textoProcedencia, type Municipio } from "../../../src/normas/peligrosidad.ts";
import { PROVINCIAS, provinciaPorIne, type Provincia } from "../../../src/normas/provincias.ts";
import { Ayuda } from "../componentes/Ayuda.tsx";
import { fmt } from "../fmt.ts";

export const AYUDA_EMPLAZAMIENTO = {
  provincia:
    "Decide la zona eólica del viento: la de su capital en la figura D.1 del DB SE-AE. La figura es un mapa y sus líneas cruzan provincias: si la obra cae al otro lado, se fuerza la zona en la pestaña Viento.",
  municipio:
    "De él salen la aceleración sísmica básica ab y el coeficiente de contribución K del sismo (Anejo 1 de la NCSE-02). El Anejo 1 sólo lista los municipios con ab ≥ 0,04 g: si el suyo no figura puede estar exento (art. 1.2.3), pero también ser una errata o un municipio segregado después de 2002. Compruébelo: puede guardarlo sólo con su nombre y escribir ab y K en Sismo.",
  altitud: "Altitud topográfica de la obra sobre el nivel del mar, en m. El DB SE-AE no es aplicable al viento por encima de 2 000 m (art. 3.3.1-2). Con la zona de clima invernal, da la nieve.",
} as const;

/** Un número escrito con coma, o nada; un texto que no es un número, con su error. */
const numeroOpcional = (t: string): number | undefined | string => (t.trim() === "" ? undefined : leerNumero(t));
const texto = (v: number | undefined): string => (v === undefined ? "" : String(v).replace(".", ","));

/** Etiqueta de una fila del formulario, con su «?». */
export function Etiqueta({ htmlFor, children, ayuda }: { htmlFor: string; children: ReactNode; ayuda?: string }) {
  return (
    <span className="acc-etq">
      <label htmlFor={htmlFor}>{children}</label>
      {ayuda && <Ayuda texto={ayuda} />}
    </span>
  );
}

export interface EstadoEmplazamiento {
  ine: string;
  provincia: string;
  nombreLibre: string;
  busqueda: string;
  altitud: string;
  /** El municipio del Anejo 1 elegido, o null. */
  municipio: Municipio | null;
  /** La provincia elegida, o undefined. */
  prov: Provincia | undefined;
  /** Lo que se escribirá (undefined: nada), o por qué no. */
  valor: { valor: EmplazamientoEdificio | undefined } | { error: string };
  setBusqueda: (t: string) => void;
  setAltitud: (t: string) => void;
  setNombreLibre: (t: string) => void;
  elegirMunicipio: (m: Municipio) => void;
  cambiarProvincia: (p: string) => void;
  quitarMunicipio: () => void;
}

/** El estado del emplazamiento, desde las acciones del modelo. */
export function useEmplazamiento(a: AccionesEdificio): EstadoEmplazamiento {
  const e0 = a.emplazamiento;
  const ine0 = e0?.ine ?? a.sismo?.ine ?? "";
  const [ine, setIne] = useState(ine0);
  const [provincia, setProvincia] = useState(e0?.provincia ?? (ine0 ? ine0.slice(0, 2) : ""));
  const [nombreLibre, setNombreLibre] = useState(!e0?.ine && e0?.municipio ? e0.municipio : "");
  const [busqueda, setBusqueda] = useState("");
  const [altitud, setAltitud] = useState(texto(e0?.altitud ?? a.viento?.altitud));
  const municipio = useMemo(() => (/^\d{5}$/.test(ine) ? municipioPorIne(ine) : null), [ine]);
  const prov = provincia ? provinciaPorIne(provincia) : undefined;
  const valor = useMemo((): EstadoEmplazamiento["valor"] => {
    const emp: EmplazamientoEdificio = {};
    if (municipio) {
      emp.ine = municipio.ine;
      emp.municipio = municipio.nombre;
    } else {
      if (provincia) emp.provincia = provincia;
      if (nombreLibre.trim()) emp.municipio = nombreLibre.trim();
    }
    const nAlt = numeroOpcional(altitud);
    if (typeof nAlt === "string") return { error: `La altitud: ${nAlt}.` };
    if (nAlt !== undefined) emp.altitud = nAlt;
    return { valor: Object.keys(emp).length ? emp : undefined };
  }, [municipio, provincia, nombreLibre, altitud]);
  return {
    ine,
    provincia,
    nombreLibre,
    busqueda,
    altitud,
    municipio,
    prov,
    valor,
    setBusqueda,
    setAltitud,
    setNombreLibre,
    elegirMunicipio: (m) => {
      setIne(m.ine);
      setProvincia(m.ine.slice(0, 2));
      setNombreLibre("");
      setBusqueda("");
    },
    cambiarProvincia: (p) => {
      setProvincia(p);
      if (ine && ine.slice(0, 2) !== p) setIne("");
    },
    quitarMunicipio: () => {
      setIne("");
      setNombreLibre("");
    },
  };
}

/** El bloque del emplazamiento; `extra`, más filas de lo que sale de él (la nieve, en Datos de la obra). */
export function CampoEmplazamiento({ e, leyenda = "Emplazamiento · común al viento, la nieve y el sismo", extra }: { e: EstadoEmplazamiento; leyenda?: string; extra?: ReactNode }) {
  const { municipio, prov, provincia, nombreLibre, busqueda } = e;
  // Los de la provincia elegida primero; los de otras, detrás (si la provincia está mal, que se vea)
  const { candidatos, deOtras } = useMemo(() => {
    if (busqueda.trim().length < 2) return { candidatos: [], deOtras: [] };
    const todos = buscarMunicipios(busqueda, 400);
    if (!provincia) return { candidatos: todos.slice(0, 12), deOtras: [] };
    const aqui = todos.filter((m) => m.ine.startsWith(provincia)).slice(0, 12);
    return { candidatos: aqui, deOtras: todos.filter((m) => !m.ine.startsWith(provincia)).slice(0, Math.max(4, 12 - aqui.length)) };
  }, [busqueda, provincia]);
  return (
    <fieldset className="acc-grupo">
      <legend>{leyenda}</legend>
      <div className="acc-form">
        <Etiqueta htmlFor="e-prov" ayuda={AYUDA_EMPLAZAMIENTO.provincia}>
          Provincia
        </Etiqueta>
        <select id="e-prov" className="sel" value={provincia} onChange={(ev) => e.cambiarProvincia(ev.target.value)}>
          <option value="">Elija la provincia</option>
          {[...PROVINCIAS]
            .sort((x, y) => x.nombre.localeCompare(y.nombre, "es"))
            .map((p) => (
              <option key={p.ine} value={p.ine}>
                {p.nombre}
              </option>
            ))}
        </select>
        <Etiqueta htmlFor="e-mun" ayuda={AYUDA_EMPLAZAMIENTO.municipio}>
          Municipio
        </Etiqueta>
        <div>
          {municipio || nombreLibre ? (
            <p className="acc-elegido">
              {municipio ? (
                <>
                  <b>{municipio.nombre}</b> <span className="text-text-secondary">({municipio.provincia}, INE {municipio.ine})</span>
                </>
              ) : (
                <>
                  <b>{nombreLibre}</b> <span className="text-text-secondary">· no figura en el Anejo 1</span>
                </>
              )}
              <button type="button" className="enlace ml-auto" onClick={e.quitarMunicipio}>
                Cambiar
              </button>
            </p>
          ) : (
            <>
              <input id="e-mun" className="sel w-full" value={busqueda} autoComplete="off" placeholder={prov ? `Escriba el nombre de un municipio de ${prov.nombre}` : "Escriba el nombre y elija uno de la lista"} onChange={(ev) => e.setBusqueda(ev.target.value)} aria-label="Buscar municipio" />
              {candidatos.length + deOtras.length > 0 && (
                <ul className="lista-candidatos" role="listbox" aria-label="Municipios del Anejo 1">
                  {[...candidatos, ...deOtras].map((m, i) => (
                    <li key={m.ine}>
                      {provincia && i === candidatos.length && <p className="acc-separador">En otras provincias</p>}
                      <button type="button" role="option" aria-selected={false} className="w-full text-left" onClick={() => e.elegirMunicipio(m)}>
                        {m.nombre} <span className="text-text-secondary">({m.provincia}, INE {m.ine})</span> · ab = {fmt(m.ab, 2)} g, K = {fmt(m.K, 1)}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {busqueda.trim().length >= 2 && !candidatos.length && (
                <div className="nota acc-nota">
                  <p>
                    «{busqueda.trim()}» no figura en el Anejo 1{prov ? ` en ${prov.nombre}` : ""}. Puede estar por debajo de 0,04 g (exento, art. 1.2.3), ser una errata del nombre o un municipio creado después de 2002. Compruébelo antes de darlo por exento.
                  </p>
                  {prov ? (
                    <button type="button" className="enlace" onClick={() => (e.setNombreLibre(busqueda.trim()), e.setBusqueda(""))}>
                      Guardarlo sólo con su nombre (el sismo necesitará ab y K escritos)
                    </button>
                  ) : (
                    <p>Elija antes la provincia para guardarlo sólo con su nombre.</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        <Etiqueta htmlFor="e-alt" ayuda={AYUDA_EMPLAZAMIENTO.altitud}>
          Altitud
        </Etiqueta>
        <span className="flex items-center gap-2">
          <input id="e-alt" className="sel mono w-[7rem]" value={e.altitud} inputMode="decimal" placeholder="—" onChange={(ev) => e.setAltitud(ev.target.value)} />
          <span className="text-text-secondary">m sobre el nivel del mar</span>
        </span>
      </div>
      <dl className="acc-derivados">
        <div>
          <dt>Zona eólica</dt>
          <dd>{prov ? `${prov.zonaEolica} · qb = ${fmt(ZONAS_EOLICAS[prov.zonaEolica].qb, 2)} kN/m²` : "— (falta la provincia)"}</dd>
        </div>
        <div>
          <dt>Sismo</dt>
          <dd>{municipio ? `ab = ${fmt(municipio.ab, 2)} g · K = ${fmt(municipio.K, 1)}` : nombreLibre ? "fuera del Anejo 1: ab y K escritos" : "— (falta el municipio)"}</dd>
        </div>
        {extra}
        {municipio && <p className="acc-fuente">ab y K: {textoProcedencia(municipio.procedencia)}.</p>}
        {prov?.frontera && <p className="acc-fuente text-state-warn">Zona eólica: {prov.frontera.eolica}</p>}
      </dl>
    </fieldset>
  );
}
