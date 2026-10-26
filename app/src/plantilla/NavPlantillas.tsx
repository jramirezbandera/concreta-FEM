/**
 * Las plantillas DXF en el navegador de Modelo (V2c-4, `docs/fem3d/dibujo.md` §10.3): cada una con
 * el estado de su fichero y, desplegada, sus unidades, el redondeo de lo enganchado, sus plantas, sus
 * capas (con cuántas entidades tiene cada una), su colocación (con Colocar y Girar en la planta) y
 * Quitar. Todo cambio es una operación `plantillas` del editor: se deshace y no cambia la huella.
 */
import { useState, type ReactNode } from "react";
import { ChevronRight, Trash2 } from "lucide-react";
import type { PlantillaDxf } from "../../../src/agente/proyecto.ts";
import { leerNumero, textoNumero } from "../../../src/editor/celdas.ts";
import { insunitsDistintas, UNIDADES, type UnidadDxf } from "../../../src/editor/dibujo/plantilla.ts";
import type { NombrePlantillaDxf } from "../../../src/editor/dibujo/herramientaPlantilla.ts";
import { Seccion } from "../componentes/comunes.tsx";
import { useVisor } from "../contexto.ts";
import { fmt } from "../fmt.ts";
import { importarDxf, type usePlantillasDxf } from "./plantillas.ts";

const REDONDEOS: { v: 0 | 0.01 | 0.001; nombre: string }[] = [
  { v: 0.001, nombre: "1 mm" },
  { v: 0.01, nombre: "1 cm" },
  { v: 0, nombre: "Nada (el DXF tal cual)" },
];

interface Props {
  pl: ReturnType<typeof usePlantillasDxf>;
  /** Activa Colocar o Girar con esta plantilla. */
  herramienta: (h: NombrePlantillaDxf, nombre: string) => void;
  /** Un error al importar (de la barra). */
  error?: string | null;
}

export function NavPlantillas({ pl, herramienta, error }: Props) {
  const { proyecto } = useVisor();
  const ed = proyecto.edicion;
  const lista = ed?.proyecto.plantillas ?? [];
  const [abierta, setAbierta] = useState<string | null>(null);
  if (!ed) return null;
  const cambiar = (t: PlantillaDxf, nueva: PlantillaDxf, etiqueta: string) => ed.editar({ op: "plantillas", plantillas: lista.map((x) => (x.nombre === t.nombre ? nueva : x)) }, etiqueta);
  return (
    <Seccion titulo="Plantillas DXF" valor={lista.length || undefined}>
      {!lista.length && <p className="nota">Un plano DXF en gris detrás de la planta, para calcar con sus enganches: «Plantilla DXF» en la barra.</p>}
      {error && <p className="nota text-state-fail">{error}</p>}
      {lista.map((t) => (
        <Ficha key={t.nombre} t={t} abierta={abierta === t.nombre} alternar={() => setAbierta(abierta === t.nombre ? null : t.nombre)} pl={pl} cambiar={(n, e) => cambiar(t, n, e)} quitar={() => ed.editar({ op: "plantillas", plantillas: lista.filter((x) => x.nombre !== t.nombre) }, `Quitar la plantilla «${t.nombre}»`)} herramienta={(h) => herramienta(h, t.nombre)} />
      ))}
    </Seccion>
  );
}

function Ficha({ t, abierta, alternar, pl, cambiar, quitar, herramienta }: { t: PlantillaDxf; abierta: boolean; alternar: () => void; pl: Props["pl"]; cambiar: (n: PlantillaDxf, etiqueta: string) => void; quitar: () => void; herramienta: (h: NombrePlantillaDxf) => void }) {
  const { proyecto } = useVisor();
  const plantas = proyecto.edicion?.proyecto.modelo.plantas ?? [];
  const est = pl.estados.get(t.sha256);
  const d = est?.tipo === "listo" ? est.dibujo : null;
  const estado = !est || est.tipo === "cargando" ? "Leyendo…" : est.tipo === "falta" ? "Falta el fichero" : est.tipo === "error" ? "No se pudo leer" : `${d!.capas.reduce((s, c) => s + c.entidades, 0)} entidades`;
  const ocultas = new Set(t.ocultas ?? []);
  const [aviso, setAviso] = useState<string | null>(null);

  /** El fichero elegido otra vez: si es el mismo, se vuelve a leer; si no, la plantilla pasa a él. */
  const elegirFichero = async (f: File) => {
    setAviso(null);
    try {
      const { sha256 } = await importarDxf(f, proyecto.fuente?.tipo === "origen" ? proyecto.fuente.origen : null);
      if (sha256 !== t.sha256 || f.name !== t.fichero) cambiar({ ...t, fichero: f.name, sha256 }, `Cambiar el plano de la plantilla «${t.nombre}»`);
      if (sha256 === t.sha256) pl.recargar(sha256);
      else setAviso("Es otra versión del plano: revise su colocación y sus capas.");
    } catch (e) {
      setAviso(e instanceof Error ? e.message : String(e));
    }
  };

  const numero = (texto: string, actual: number, poner: (v: number) => void) => {
    const v = leerNumero(texto);
    if (typeof v === "string") return setAviso(v);
    setAviso(null);
    if (v !== actual) poner(v);
  };
  const [tx, ty] = t.traslacion ?? [0, 0];
  const conTraslacion = (x: number, y: number): PlantillaDxf => {
    const { traslacion: _t, ...resto } = t;
    return x === 0 && y === 0 ? resto : { ...resto, traslacion: [x, y] };
  };
  const distintas = d ? insunitsDistintas(d, t.unidades) : null;

  return (
    <div className="arbol-grupo" data-abierto={abierta}>
      <div className="arbol-fila" style={{ paddingRight: 6 }}>
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 border-0 bg-transparent p-0 text-left" style={{ color: "inherit", font: "inherit", cursor: "pointer" }} aria-expanded={abierta} onClick={alternar}>
          <ChevronRight size={14} className="giro" aria-hidden="true" />
          <span className="truncate">{t.nombre}</span>
        </button>
        <span className={`n ${est?.tipo === "falta" || est?.tipo === "error" ? "text-state-fail" : ""}`}>{estado}</span>
        <button type="button" className="ib-chip" aria-label={`Quitar la plantilla ${t.nombre}`} title="Quitar la plantilla (el modelo no cambia)" onClick={quitar}>
          <Trash2 size={12} />
        </button>
      </div>
      {abierta && (
        <div className="px-3.5 pb-2 text-[12px]" style={{ display: "grid", gap: 6 }}>
          <Linea k="Fichero">
            <span className="mono truncate" title={`sha256 ${t.sha256}`}>
              {t.fichero}
            </span>
            <label className="ib-chip" style={{ cursor: "pointer", width: "auto", padding: "0 6px" }} title="Elegir el fichero DXF (el mismo, si falta, u otra versión del plano)">
              Elegir…
              <input type="file" accept=".dxf" hidden aria-label={`Elegir el fichero de la plantilla ${t.nombre}`} onChange={(x) => x.target.files?.[0] && void elegirFichero(x.target.files[0])} />
            </label>
          </Linea>
          {est?.tipo === "falta" && <p className="nota">No está en este navegador ni junto al proyecto: elíjalo.</p>}
          {est?.tipo === "error" && <p className="nota text-state-fail">{est.mensaje}</p>}
          <Linea k="Unidades">
            <select className="sel" aria-label="Unidades del DXF" value={t.unidades} onChange={(x) => cambiar({ ...t, unidades: x.target.value as UnidadDxf }, `Unidades de la plantilla «${t.nombre}»`)}>
              {(Object.keys(UNIDADES) as UnidadDxf[]).map((u) => (
                <option key={u} value={u}>
                  {UNIDADES[u].nombre}
                </option>
              ))}
            </select>
          </Linea>
          {distintas && <p className="nota">El DXF dice que está en {UNIDADES[distintas].nombre} ($INSUNITS), pero su tamaño es el de un edificio en {UNIDADES[t.unidades].nombre}.</p>}
          <Linea k="Redondeo">
            <select className="sel" aria-label="Redondeo de lo enganchado" title="Lo que se engancha de la plantilla se redondea; lo del modelo, nunca" value={String(t.redondeo ?? 0.001)} onChange={(x) => cambiar(conRedondeo(t, Number(x.target.value) as 0 | 0.01 | 0.001), `Redondeo de la plantilla «${t.nombre}»`)}>
              {REDONDEOS.map((r) => (
                <option key={r.v} value={String(r.v)}>
                  {r.nombre}
                </option>
              ))}
            </select>
          </Linea>
          <Linea k="Colocación">
            <CampoNumero etiqueta="Traslación x (m)" valor={tx} poner={(v) => cambiar(conTraslacion(v, ty), `Mover la plantilla «${t.nombre}»`)} leer={numero} />
            <CampoNumero etiqueta="Traslación y (m)" valor={ty} poner={(v) => cambiar(conTraslacion(tx, v), `Mover la plantilla «${t.nombre}»`)} leer={numero} />
            <CampoNumero etiqueta="Giro (°)" valor={t.giro ?? 0} poner={(v) => cambiar(conGiro(t, v), `Girar la plantilla «${t.nombre}»`)} leer={numero} />
          </Linea>
          <div className="flex gap-1.5">
            <button type="button" className="btn" disabled={!d} title="Un punto de la plantilla y a dónde va, en la planta" onClick={() => herramienta("colocarPlantilla")}>
              Colocar…
            </button>
            <button type="button" className="btn" disabled={!d} title="El centro, un punto de la plantilla y hacia dónde gira, en la planta" onClick={() => herramienta("girarPlantilla")}>
              Girar…
            </button>
          </div>
          <div>
            <div className="text-text-secondary">Plantas</div>
            <div className="flex flex-wrap gap-x-3">
              {plantas.map((p) => (
                <label key={p.id} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={t.plantas.includes(p.id)}
                    onChange={(x) => cambiar({ ...t, plantas: x.target.checked ? plantas.map((y) => y.id).filter((y) => y === p.id || t.plantas.includes(y)) : t.plantas.filter((y) => y !== p.id) }, `Plantas de la plantilla «${t.nombre}»`)}
                  />
                  {p.id}
                </label>
              ))}
            </div>
          </div>
          {d && (
            <div>
              <div className="text-text-secondary">Capas (las que se ven y enganchan)</div>
              {d.capas
                .filter((c) => c.entidades > 0 || ocultas.has(c.nombre))
                .map((c) => (
                  <label key={c.nombre} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={!ocultas.has(c.nombre)}
                      onChange={(x) => {
                        const n = x.target.checked ? [...ocultas].filter((y) => y !== c.nombre) : [...ocultas, c.nombre];
                        const { ocultas: _o, ...resto } = t;
                        cambiar(n.length ? { ...resto, ocultas: n } : resto, `Capas de la plantilla «${t.nombre}»`);
                      }}
                    />
                    <span className="truncate">{c.nombre}</span>
                    <span className="ml-auto text-text-secondary">{fmt(c.entidades, 0)}</span>
                  </label>
                ))}
            </div>
          )}
          {d && Object.keys(d.ignoradas).length > 0 && (
            <p className="nota">
              Sin leer: {Object.entries(d.ignoradas)
                .map(([k, n]) => `${n} ${k}`)
                .join(", ")}
              {d.ignoradas.MLINE ? ". Las MLINE se ven si se descomponen en el programa de CAD." : "."}
            </p>
          )}
          {d?.avisos.map((a) => (
            <p key={a} className="nota text-state-warn">
              {a}
            </p>
          ))}
          {aviso && <p className="nota text-state-fail">{aviso}</p>}
        </div>
      )}
    </div>
  );
}

const conRedondeo = (t: PlantillaDxf, r: 0 | 0.01 | 0.001): PlantillaDxf => {
  const { redondeo: _r, ...resto } = t;
  return r === 0.001 ? resto : { ...resto, redondeo: r };
};

const conGiro = (t: PlantillaDxf, g: number): PlantillaDxf => {
  const { giro: _g, ...resto } = t;
  const n = ((g % 360) + 360) % 360;
  return n === 0 ? resto : { ...resto, giro: n };
};

function Linea({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-[74px] shrink-0 text-text-secondary">{k}</span>
      {children}
    </div>
  );
}

/** Un número que se escribe al salir del campo o con Intro. */
function CampoNumero({ etiqueta, valor, poner, leer }: { etiqueta: string; valor: number; poner: (v: number) => void; leer: (texto: string, actual: number, poner: (v: number) => void) => void }) {
  const [texto, setTexto] = useState<string | null>(null);
  const fin = () => {
    if (texto !== null) leer(texto, valor, poner);
    setTexto(null);
  };
  return (
    <input
      className="sel min-w-0 flex-1"
      aria-label={etiqueta}
      title={etiqueta}
      value={texto ?? textoNumero(valor)}
      onChange={(x) => setTexto(x.target.value)}
      onBlur={fin}
      onKeyDown={(x) => {
        if (x.key === "Enter") fin();
        else if (x.key === "Escape") setTexto(null);
      }}
    />
  );
}
