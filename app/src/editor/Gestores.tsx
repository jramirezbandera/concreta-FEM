/**
 * Los gestores de secciones y materiales (GE, `docs/fem3d/gestores.md` §3.2 y §3.3), como «Define >
 * Section Properties» de SAP2000: la lista a la izquierda (con quién usa cada uno) y la ficha a la
 * derecha (el dibujo a escala, los datos y las propiedades que usa el compilador). «Nueva» pide
 * primero el tipo. Se abren desde la barra de Modelo y desde «Nueva…» / «Editar…» de cualquier
 * desplegable (`referencia.tsx`); la tabla queda para editar muchas a la vez.
 *
 * Todo lo que decide sale de `src/editor/gestores.ts` (ids, reutilizar, materiales típicos,
 * propiedades); aquí sólo se leen los campos y se pinta.
 */
import { useState } from "react";
import { Plus, Table2 } from "lucide-react";
import type { Material, Seccion } from "../../../src/compilador/fisico.ts";
import {
  cambiarSeccion,
  comoUna,
  crearMaterial,
  crearSeccion,
  describirMaterial,
  describirSeccion,
  FAMILIA_FORMA,
  formaPropuesta,
  idMaterialLibre,
  idSeccion,
  MATERIALES_TIPICOS,
  materialesElegibles,
  materialPropuesto,
  propiedadesMaterial,
  propiedadesSeccion,
  seccionIgual,
  seccionPropuesta,
  textoUsos,
  usosDe,
  type DatosSeccion,
  type FormaSeccion,
  type UsoSeccion,
} from "../../../src/editor/gestores.ts";
import type { Operacion } from "../../../src/editor/operaciones.ts";
import type { Objeto } from "../../../src/editor/referencias.ts";
import { enCatalogo, perfilDeCatalogo, PERFILES, SERIES_PERFILES, type SeriePerfil } from "../../../src/secciones/perfiles.ts";
import type { ModeloFisico } from "../../../src/compilador/fisico.ts";
import { useVisor } from "../contexto.ts";
import { fmt } from "../fmt.ts";
import { Dialogo, DialogoBorrar } from "./Dialogos.tsx";
import { GestorCasos } from "./GestorCasos.tsx";
import { GestorPlantas } from "./GestorPlantas.tsx";
import { cerrarGestor, useGestor, type PedidoGestor } from "./referencia.tsx";
import "./gestores.css";

/** El gestor abierto, si hay pedido (va una vez en `App`). */
export function GestorAbierto() {
  const { pedido, n } = useGestor();
  const { proyecto } = useVisor();
  if (!pedido || !proyecto.edicion) return null;
  // La clave reinicia el gestor con cada pedido
  switch (pedido.coleccion) {
    case "secciones":
      return <GestorSecciones key={n} pedido={pedido} />;
    case "materiales":
      return <GestorMateriales key={n} pedido={pedido} />;
    case "casos":
      return <GestorCasos key={n} pedido={pedido} />;
    case "plantas":
      return <GestorPlantas key={n} pedido={pedido} />;
  }
}

// ─── Números ────────────────────────────────────────────────────────────────────────────────────

/** Lo escrito en un campo: null si está vacío, NaN si no es un número. */
const leer = (t: string | undefined): number | null => (t === undefined || t.trim() === "" ? null : Number(t.trim().replace(",", ".")));
/** Un número para un campo, sin el ruido de la coma flotante. */
const escrito = (v: number | undefined, factor = 1): string => (v === undefined ? "" : String(Number((v * factor).toPrecision(12))).replace(".", ","));
/** Con n cifras significativas. */
function cifras(v: number, n = 4): string {
  if (v === 0 || !Number.isFinite(v)) return fmt(v, 0);
  const dec = Math.max(0, Math.min(6, n - 1 - Math.floor(Math.log10(Math.abs(v)))));
  return fmt(v, dec);
}

// ─── Secciones ──────────────────────────────────────────────────────────────────────────────────

interface FormSeccion {
  forma: FormaSeccion;
  campos: Record<string, string>;
  material: string;
  /** En una nueva, vacío: el propuesto. */
  id: string;
  /** El perfil de fuera del catálogo que se conserva (escrito en el JSON). */
  perfilBase?: Extract<Seccion, { forma: "I" }>["perfil"];
}

const CM: Partial<Record<FormaSeccion, readonly [string, string][]>> = {
  rectangular: [
    ["b", "ancho, según y local"],
    ["h", "canto, según z local"],
  ],
  circular: [["D", "diámetro"]],
  T: [
    ["bf", "ancho del ala"],
    ["hf", "espesor del ala"],
    ["bw", "ancho del alma"],
    ["h", "canto total"],
  ],
};
const GENERAL: readonly [string, string, string][] = [
  ["A", "cm²", "área"],
  ["Iy", "cm⁴", "inercia de My (plano del canto)"],
  ["Iz", "cm⁴", "inercia de Mz"],
  ["J", "cm⁴", "torsión"],
  ["Avy", "cm²", "cortante según y; vacía: Euler–Bernoulli"],
  ["Avz", "cm²", "cortante según z; vacía: Euler–Bernoulli"],
  ["b", "cm", "huella del pilar y ancho; opcional"],
  ["h", "cm", "canto; opcional (sin él, no hay zonas rígidas)"],
];
const POR_CM2 = 1e4;
const POR_CM4 = 1e8;

function formDe(d: DatosSeccion, id: string): FormSeccion {
  const c: Record<string, string> = {};
  switch (d.forma) {
    case "rectangular":
      Object.assign(c, { b: escrito(d.b, 100), h: escrito(d.h, 100) });
      break;
    case "circular":
      c.D = escrito(d.D, 100);
      break;
    case "T":
      Object.assign(c, { bf: escrito(d.bf, 100), hf: escrito(d.hf, 100), bw: escrito(d.bw, 100), h: escrito(d.h, 100) });
      break;
    case "I": {
      const cat = enCatalogo(d.perfil);
      Object.assign(c, { serie: cat?.serie ?? "", tamano: cat ? String(cat.tamano) : "" });
      return { forma: d.forma, campos: c, material: d.material, id, ...(cat ? {} : { perfilBase: d.perfil }) };
    }
    case "general":
      Object.assign(c, { A: escrito(d.A, POR_CM2), Iy: escrito(d.Iy, POR_CM4), Iz: escrito(d.Iz, POR_CM4), J: escrito(d.J, POR_CM4), Avy: escrito(d.Avy, POR_CM2), Avz: escrito(d.Avz, POR_CM2), b: escrito(d.b, 100), h: escrito(d.h, 100) });
      break;
  }
  return { forma: d.forma, campos: c, material: d.material, id };
}

/** Lo rellenado como sección, o los errores por campo. */
function datosDe(f: FormSeccion): { ok: true; datos: DatosSeccion } | { ok: false; errores: Record<string, string> } {
  const errores: Record<string, string> = {};
  const pos = (k: string, factor: number, obligatorio = true): number | undefined => {
    const v = leer(f.campos[k]);
    if (v === null) {
      if (obligatorio) errores[k] = "falta";
      return undefined;
    }
    if (!(v > 0)) {
      errores[k] = "mayor que 0";
      return undefined;
    }
    return v / factor;
  };
  const material = f.material;
  let datos: DatosSeccion;
  switch (f.forma) {
    case "rectangular":
      datos = { material, forma: f.forma, b: pos("b", 100)!, h: pos("h", 100)! };
      break;
    case "circular":
      datos = { material, forma: f.forma, D: pos("D", 100)! };
      break;
    case "T": {
      const [bf, hf, bw, h] = [pos("bf", 100), pos("hf", 100), pos("bw", 100), pos("h", 100)];
      if (bf !== undefined && hf !== undefined && h !== undefined && hf >= h) errores.hf = "menor que el canto";
      if (bf !== undefined && bw !== undefined && bw > bf) errores.bw = "no mayor que el ala";
      datos = { material, forma: f.forma, bf: bf!, hf: hf!, bw: bw!, h: h! };
      break;
    }
    case "I": {
      const p = f.campos.serie ? perfilDeCatalogo(f.campos.serie as SeriePerfil, Number(f.campos.tamano))?.perfil : f.perfilBase;
      if (!p) errores.tamano = "elija un perfil";
      datos = { material, forma: f.forma, perfil: p! };
      break;
    }
    case "general": {
      const A = pos("A", POR_CM2);
      const Iy = pos("Iy", POR_CM4);
      const Iz = pos("Iz", POR_CM4);
      const J = pos("J", POR_CM4);
      const Avy = pos("Avy", POR_CM2, false);
      const Avz = pos("Avz", POR_CM2, false);
      const b = pos("b", 100, false);
      const h = pos("h", 100, false);
      if ((b === undefined) !== (h === undefined) && !errores.b && !errores.h) errores[b === undefined ? "b" : "h"] = "con el otro, o ninguno";
      datos = { material, forma: f.forma, A: A!, Iy: Iy!, Iz: Iz!, J: J!, ...(Avy !== undefined ? { Avy } : {}), ...(Avz !== undefined ? { Avz } : {}), ...(b !== undefined ? { b } : {}), ...(h !== undefined ? { h } : {}) };
      break;
    }
  }
  if (!material) errores.material = "falta";
  return Object.keys(errores).length ? { ok: false, errores } : { ok: true, datos };
}

const TIPOS: { forma: FormaSeccion; nombre: string; grupo: string }[] = [
  { forma: "rectangular", nombre: "Rectangular", grupo: "Hormigón" },
  { forma: "circular", nombre: "Circular", grupo: "Hormigón" },
  { forma: "T", nombre: "En T", grupo: "Hormigón" },
  { forma: "I", nombre: "Perfil de catálogo", grupo: "Acero" },
  { forma: "general", nombre: "General", grupo: "Propiedades dadas" },
];

const sinId = (s: Seccion): DatosSeccion => {
  const { id: _id, ...d } = s;
  return d as DatosSeccion;
};

function GestorSecciones({ pedido }: { pedido: PedidoGestor }) {
  const { proyecto, pedirTabla } = useVisor();
  const ed = proyecto.edicion!;
  const m = ed.proyecto.modelo;
  const uso: UsoSeccion | null = pedido.uso ?? null;
  const nuevaPropuesta = (forma: FormaSeccion = formaPropuesta(uso)): FormSeccion => formDe(seccionPropuesta(forma, uso, materialPropuesto(m, FAMILIA_FORMA[forma])), "");
  const inicial = pedido.nueva ? null : (m.secciones.find((s) => s.id === pedido.id) ?? m.secciones[0] ?? null);
  const [elegida, setElegida] = useState<string | null>(inicial?.id ?? null);
  const [form, setForm] = useState<FormSeccion>(() => (inicial ? formDe(sinId(inicial), inicial.id) : nuevaPropuesta()));
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [borrar, setBorrar] = useState<string | null>(null);

  const ir = (id: string | null, f?: FormSeccion) => {
    setElegida(id);
    setError(null);
    const s = id === null ? undefined : m.secciones.find((x) => x.id === id);
    setForm(f ?? (s ? formDe(sinId(s), s.id) : nuevaPropuesta()));
  };
  const actual = elegida === null ? undefined : m.secciones.find((s) => s.id === elegida);
  const lectura = datosDe(form);
  const errores = lectura.ok ? {} : lectura.errores;
  const datos = lectura.ok ? lectura.datos : null;
  const props = datos ? propiedadesSeccion(m, datos) : null;
  const cambiada = !!actual && (!datos || JSON.stringify(sinId(actual)) !== JSON.stringify(datos) || form.id.trim() !== actual.id);
  const usos = actual ? usosDe(m, actual.id) : [];
  const igual = !actual && datos && !form.id.trim() ? seccionIgual(m, datos) : undefined;
  const propuesto = !actual && datos ? (igual?.id ?? idSeccion(m, datos, uso)) : "";

  /** Aplica unas operaciones (si hay) y, desde un campo, elige `id`; devuelve si se hizo. */
  const terminar = (id: string, ops: readonly Operacion[], etiqueta: string): boolean => {
    if (pedido.alElegir) {
      const e = pedido.alElegir(id, ops);
      if (e) {
        setError(e);
        return false;
      }
      cerrarGestor();
      return true;
    }
    if (ops.length) {
      const r = ed.editar(comoUna(ops), etiqueta);
      if (!r.ok) {
        setError(r.errores.map((x) => x.mensaje).join(" "));
        return false;
      }
    }
    return true;
  };

  const crear = () => {
    if (!datos) return setError("Falta lo marcado.");
    const c = crearSeccion(m, datos, { id: form.id, uso });
    if (!c.ok) return setError(c.mensaje);
    if (!terminar(c.id, c.operaciones, `Nueva sección ${c.id}`)) return;
    setAviso(c.reutilizada ? `Ya había una igual: ${c.id}.` : `Creada ${c.id}.`);
    ir(c.id, formDe(datos, c.id));
  };
  const aplicar = () => {
    if (!actual || !datos) return setError("Falta lo marcado.");
    const c = cambiarSeccion(m, actual.id, datos, form.id);
    if (!c.ok) return setError(c.mensaje);
    const r = ed.editar(comoUna(c.operaciones), `Sección ${actual.id}`);
    if (!r.ok) return setError(r.errores.map((x) => x.mensaje).join(" "));
    setAviso(`${c.id}: cambiada en ${textoUsos(usos)}.`);
    ir(c.id, formDe(datos, c.id));
  };
  const duplicar = () => {
    if (!actual) return;
    const d = datos ?? sinId(actual);
    setAviso(null);
    ir(null, { ...formDe(d, ""), id: idSeccion(m, d, uso) });
  };

  const primaria = actual ? (
    pedido.alElegir && !cambiada ? (
      <button type="button" className="btn btn-p" onClick={() => terminar(actual.id, [], "")}>
        Usar {actual.id}
      </button>
    ) : (
      <button type="button" className="btn btn-p" disabled={!cambiada || !datos} onClick={aplicar}>
        {usos.length ? `Aplicar a ${textoUsos(usos)}` : "Aplicar"}
      </button>
    )
  ) : (
    <button type="button" className="btn btn-p" disabled={!datos} onClick={crear}>
      {pedido.alElegir ? (igual ? `Usar ${igual.id}` : "Crear y usar") : igual ? `Elegir ${igual.id}` : "Crear"}
    </button>
  );

  return (
    <>
      <Dialogo
        titulo="Secciones"
        clase="gestor"
        onCerrar={cerrarGestor}
        pie={
          <>
            <button type="button" className="btn btn-q mr-auto" onClick={() => (cerrarGestor(), pedirTabla("secciones"))} title="Para cambiar muchas a la vez o pegar de Excel">
              <Table2 size={14} />
              Abrir la tabla
            </button>
            {actual && (
              <>
                <button type="button" className="btn" onClick={() => setBorrar(actual.id)}>
                  Borrar
                </button>
                <button type="button" className="btn" onClick={duplicar} title="Una copia para cambiar sólo algunos objetos">
                  Duplicar
                </button>
              </>
            )}
            {primaria}
          </>
        }
      >
        <Lista
          titulo="secciones"
          nueva={elegida === null}
          onNueva={() => (setAviso(null), ir(null))}
          elementos={m.secciones.map((s) => ({ id: s.id, texto: describirSeccion(sinId(s)).replace(` · ${s.material}`, ""), detalle: s.material, n: usosDe(m, s.id).reduce((t, u) => t + u.n, 0) }))}
          elegida={elegida}
          onElegir={(id) => (setAviso(null), ir(id))}
        />
        <div
          className="ges-ficha"
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.target instanceof HTMLInputElement) (actual ? (cambiada ? aplicar() : undefined) : crear());
          }}
        >
          {pedido.para && <p className="ges-para">Para {pedido.para}</p>}
          {aviso && (
            <p className="ges-aviso" role="status">
              {aviso}
            </p>
          )}
          {!actual && (
            <div className="ges-tipos" role="radiogroup" aria-label="Tipo de sección">
              {TIPOS.map((t) => (
                <button key={t.forma} type="button" role="radio" aria-checked={form.forma === t.forma} className="ges-tipo" onClick={() => setForm({ ...nuevaPropuesta(t.forma), id: form.id })}>
                  <DibujoSeccion datos={seccionPropuesta(t.forma, uso, "")} mini />
                  <span>{t.nombre}</span>
                  <small>{t.grupo}</small>
                </button>
              ))}
            </div>
          )}
          <div className="ges-cuerpo">
            <div className="ges-datos">
              <p className="dlg-et">{actual ? `${actual.id} · ${TIPOS.find((t) => t.forma === form.forma)?.nombre ?? form.forma}` : "Nueva"}</p>
              <label className="campo">
                <span>id</span>
                <input value={form.id} placeholder={propuesto} aria-label="id de la sección" onChange={(e) => setForm({ ...form, id: e.target.value })} />
                {!actual && <p>{igual ? `Ya hay una igual: se usará ${igual.id}.` : "Vacío: el propuesto."}</p>}
              </label>
              <CamposSeccion form={form} errores={errores} setForm={setForm} />
              <label className="campo">
                <span>material</span>
                <select className="sel" value={form.material} aria-label="Material de la sección" data-error={!!errores.material} onChange={(e) => setForm({ ...form, material: e.target.value })}>
                  {!form.material && <option value="">(ninguno)</option>}
                  <OpcionesMaterial m={m} />
                </select>
                <p>{m.materiales.some((x) => x.id === form.material) ? "" : form.material ? "Típico: se añade al proyecto con la sección." : ""}</p>
              </label>
            </div>
            <div className="ges-ver">
              <DibujoSeccion datos={datos} />
              <Propiedades
                filas={
                  props
                    ? [
                        ["A", `${cifras(props.barra.A * POR_CM2)} cm²`],
                        ["Iy", `${cifras(props.barra.Iy * POR_CM4)} cm⁴`],
                        ["Iz", `${cifras(props.barra.Iz * POR_CM4)} cm⁴`],
                        ["J", `${cifras(props.barra.J * POR_CM4)} cm⁴`],
                        ["Avy", props.barra.Avy === undefined ? "—" : `${cifras(props.barra.Avy * POR_CM2)} cm²`],
                        ["Avz", props.barra.Avz === undefined ? "—" : `${cifras(props.barra.Avz * POR_CM2)} cm²`],
                        ["peso", `${cifras(props.peso, 3)} kN/m`],
                        ["E", `${fmt(props.barra.E / 1000, 0)} MPa`],
                      ]
                    : []
                }
                nota={props ? "Las que usa el cálculo (compilarSeccion), con las áreas de cortante de CSI." : "Complete los datos para ver sus propiedades."}
              />
              {actual && <p className="ges-usos">{usos.length ? `Se usa en ${textoUsos(usos)}: cambiarla los cambia a todos. Para variar sólo algunos, «Duplicar».` : "No la usa ningún objeto."}</p>}
            </div>
          </div>
          {error && (
            <p className="ges-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </Dialogo>
      {borrar && (
        <DialogoBorrar
          ids={[borrar]}
          onCerrar={(hecho) => {
            setBorrar(null);
            if (!hecho) return;
            setAviso(hecho);
            const otra = m.secciones.find((s) => s.id !== borrar);
            ir(otra?.id ?? null);
          }}
        />
      )}
    </>
  );
}

function CamposSeccion({ form, errores, setForm }: { form: FormSeccion; errores: Record<string, string>; setForm: (f: FormSeccion) => void }) {
  const poner = (k: string, v: string) => setForm({ ...form, campos: { ...form.campos, [k]: v } });
  const campo = (k: string, unidad: string, ayuda: string) => (
    <label key={k} className="campo">
      <span>
        {k}
        <small>{unidad}</small>
      </span>
      <input value={form.campos[k] ?? ""} inputMode="decimal" aria-label={`${k} de la sección, ${unidad}`} data-error={!!errores[k]} aria-invalid={!!errores[k]} onChange={(e) => poner(k, e.target.value)} />
      <p className={errores[k] ? "error" : undefined}>{errores[k] ?? ayuda}</p>
    </label>
  );
  if (form.forma === "I") {
    const serie = form.campos.serie as SeriePerfil | "";
    const tamanos = serie ? PERFILES.filter((p) => p.serie === serie) : [];
    const p = serie ? perfilDeCatalogo(serie, Number(form.campos.tamano))?.perfil : form.perfilBase;
    return (
      <>
        <label className="campo">
          <span>serie</span>
          <select className="sel" value={serie} aria-label="Serie del perfil" onChange={(e) => setForm({ ...form, campos: { serie: e.target.value, tamano: String(PERFILES.find((x) => x.serie === e.target.value && x.tamano >= Number(form.campos.tamano || 0))?.tamano ?? PERFILES.find((x) => x.serie === e.target.value)?.tamano ?? "") } })}>
            {!serie && <option value="">{form.perfilBase ? "(fuera del catálogo)" : "(elija)"}</option>}
            {SERIES_PERFILES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        {serie && (
          <label className="campo">
            <span>tamaño</span>
            <select className="sel" value={form.campos.tamano ?? ""} aria-label="Tamaño del perfil" data-error={!!errores.tamano} onChange={(e) => poner("tamano", e.target.value)}>
              {tamanos.map((t) => (
                <option key={t.tamano} value={t.tamano}>
                  {`${t.serie} ${t.tamano}`}
                </option>
              ))}
            </select>
          </label>
        )}
        {p && (
          <p className="ges-perfil mono">
            h {fmt(p.h, 0)} · b {fmt(p.b, 0)} · tf {fmt(p.tf, 1)} · tw {fmt(p.tw, 1)} mm
            <br />A {fmt(p.A, 2)} cm²
            <br />Iy {fmt(p.Iy, 0)} · Iz {fmt(p.Iz, 1)} · It {fmt(p.It, 2)} cm⁴
            <br />
            <span className="text-text-tertiary">ArcelorMittal, del catálogo de Concreta.</span>
          </p>
        )}
      </>
    );
  }
  if (form.forma === "general") return <>{GENERAL.map(([k, u, a]) => campo(k, u, a))}</>;
  return <>{(CM[form.forma] ?? []).map(([k, a]) => campo(k, "cm", a))}</>;
}

function OpcionesMaterial({ m }: { m: ModeloFisico }) {
  const e = materialesElegibles(m);
  return (
    <>
      <optgroup label="En el proyecto">
        {e
          .filter((x) => !x.nuevo)
          .map(({ material: x }) => (
            <option key={x.id} value={x.id}>{`${x.id} · ${describirMaterial(x)}`}</option>
          ))}
      </optgroup>
      <optgroup label="Típicos (se añaden)">
        {e
          .filter((x) => x.nuevo)
          .map(({ material: x }) => (
            <option key={x.id} value={x.id}>{`${x.id} · ${describirMaterial(x)}`}</option>
          ))}
      </optgroup>
    </>
  );
}

/**
 * La sección dibujada a escala, con sus ejes locales: y horizontal, z (el canto h) vertical. Las
 * cotas, en cm (en mm en un perfil).
 */
function DibujoSeccion({ datos, mini = false }: { datos: DatosSeccion | null; mini?: boolean }) {
  const forma = (() => {
    if (!datos) return null;
    switch (datos.forma) {
      case "rectangular":
        return { w: datos.b * 100, h: datos.h * 100, d: `M0 0h${datos.b * 100}v${datos.h * 100}h${-datos.b * 100}z`, cotas: [`b ${escrito(datos.b, 100)}`, `h ${escrito(datos.h, 100)}`] };
      case "circular": {
        const r = datos.D * 50;
        return { w: 2 * r, h: 2 * r, d: `M0 ${r}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`, cotas: [`Ø ${escrito(datos.D, 100)}`, ""] };
      }
      case "T": {
        const [bf, hf, bw, h] = [datos.bf * 100, datos.hf * 100, datos.bw * 100, datos.h * 100];
        const x = (bf - bw) / 2;
        return { w: bf, h, d: `M0 0h${bf}v${hf}h${-x}v${h - hf}h${-bw}v${-(h - hf)}h${-x}z`, cotas: [`bf ${escrito(datos.bf, 100)}`, `h ${escrito(datos.h, 100)}`] };
      }
      case "I": {
        const { h, b, tf, tw } = datos.perfil;
        const x = (b - tw) / 2;
        return { w: b, h, d: `M0 0h${b}v${tf}h${-x}v${h - 2 * tf}h${x}v${tf}h${-b}v${-tf}h${x}v${-(h - 2 * tf)}h${-x}z`, cotas: [`b ${fmt(b, 0)}`, `h ${fmt(h, 0)} mm`] };
      }
      case "general":
        return datos.b && datos.h ? { w: datos.b * 100, h: datos.h * 100, d: `M0 0h${datos.b * 100}v${datos.h * 100}h${-datos.b * 100}z`, cotas: [`b ${escrito(datos.b, 100)}`, `h ${escrito(datos.h, 100)}`], hueca: true } : null;
    }
  })();
  if (!forma || !(forma.w > 0 && forma.h > 0) || !Number.isFinite(forma.w + forma.h)) {
    return <div className={mini ? "ges-mini" : "ges-dibujo"}>{!mini && <span className="text-text-tertiary">{datos?.forma === "general" ? "Propiedades dadas, sin forma" : "Sin forma que dibujar"}</span>}</div>;
  }
  const L = Math.max(forma.w, forma.h);
  const pad = L * (mini ? 0.08 : 0.32);
  const vb = `${-pad} ${-pad} ${forma.w + 2 * pad} ${forma.h + 2 * pad}`;
  const t = L * 0.075;
  return (
    <div className={mini ? "ges-mini" : "ges-dibujo"}>
      <svg viewBox={vb} role="img" aria-label={mini ? undefined : `Dibujo de la sección: ${forma.cotas.filter(Boolean).join(", ")}`} aria-hidden={mini || undefined}>
        <path d={forma.d} className="ges-forma" data-hueca={"hueca" in forma || undefined} />
        {!mini && (
          <>
            <line x1={-pad * 0.15} y1={forma.h / 2} x2={forma.w + pad * 0.6} y2={forma.h / 2} className="ges-eje" />
            <line x1={forma.w / 2} y1={-pad * 0.6} x2={forma.w / 2} y2={forma.h + pad * 0.6} className="ges-eje" />
            <text x={forma.w + pad * 0.66} y={forma.h / 2 + t * 0.35} fontSize={t}>
              y
            </text>
            <text x={forma.w / 2 + t * 0.3} y={-pad * 0.62} fontSize={t}>
              z
            </text>
            <text x={forma.w / 2} y={forma.h + pad * 0.85} fontSize={t} textAnchor="middle">
              {forma.cotas[0]}
            </text>
            {forma.cotas[1] && (
              <text x={-pad * 0.4} y={forma.h / 2} fontSize={t} textAnchor="middle" transform={`rotate(-90 ${-pad * 0.4} ${forma.h / 2})`}>
                {forma.cotas[1]}
              </text>
            )}
          </>
        )}
      </svg>
    </div>
  );
}

/** Lo que es cada propiedad que enseñan los gestores (el `title` de su fila y «Qué es cada una»). */
const QUE_ES: Record<string, string> = {
  A: "Área de la sección. Da la rigidez axil, E·A.",
  Iy: "Inercia alrededor del eje y local: la flexión del canto h (My). Da la rigidez E·Iy.",
  Iz: "Inercia alrededor del eje z local: la flexión en el sentido del ancho b (Mz).",
  J: "Constante de torsión de Saint-Venant: la rigidez a torsión G·J. En las vigas de hormigón va ×0,1 (D4).",
  Avy: "Área de cortante según y: la deformación por cortante de Timoshenko (Vy). Sin ella, no se cuenta.",
  Avz: "Área de cortante según z (Vz), como Avy.",
  peso: "Peso por metro lineal, γ·A: el que lleva el caso de peso propio.",
  E: "Módulo de elasticidad. En hormigón, el Ecm del Código Estructural para su fck.",
  G: "Módulo de cortante, E / (2·(1 + ν)): da la rigidez a torsión y a cortante.",
  γ: "Peso específico: con el volumen de cada pieza da su peso propio.",
};

export function Propiedades({ filas, nota }: { filas: [string, string][]; nota: string }) {
  const glosario = filas.filter(([k]) => QUE_ES[k]);
  return (
    <div className="ges-props">
      {filas.length > 0 && (
        <dl>
          {filas.map(([k, v]) => (
            <div key={k} title={QUE_ES[k]}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <p>{nota}</p>
      {glosario.length > 0 && (
        <details className="ges-glosario">
          <summary>Qué es cada una</summary>
          <dl>
            {glosario.map(([k]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{QUE_ES[k]}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </div>
  );
}

/** La lista de la izquierda de un gestor; `nuevaTexto`, la línea de arriba («Nueva sección»). */
export function Lista({ titulo, nuevaTexto, elementos, elegida, nueva, onElegir, onNueva }: { titulo: string; nuevaTexto?: string; elementos: { id: string; texto: string; detalle: string; n: number; marca?: string }[]; elegida: string | null; nueva: boolean; onElegir: (id: string) => void; onNueva: () => void }) {
  return (
    <nav className="ges-lista" aria-label={`Lista de ${titulo}`}>
      <button type="button" className="ges-nueva" aria-current={nueva || undefined} onClick={onNueva}>
        <Plus size={14} />
        {nuevaTexto ?? (titulo === "secciones" ? "Nueva sección" : "Nuevo material")}
      </button>
      {elementos.length === 0 && <p className="ges-vacia">Ninguna en el proyecto.</p>}
      {elementos.map((x) => (
        <button key={x.id} type="button" aria-current={x.id === elegida || undefined} onClick={() => onElegir(x.id)}>
          {/* `marca`: el id como la letra de su acción, con su color (casos) */}
          {x.marca === undefined ? <span className="ges-id">{x.id}</span> : <span className="ges-id acc-letra" data-acc={x.marca || undefined}>{x.id}</span>}
          <span className="ges-texto">{x.texto}</span>
          <span className="ges-n" title={x.n ? `${x.n} objetos la usan` : "Sin usar"}>
            {x.detalle}
            {x.n ? ` · ${x.n}` : " · sin usar"}
          </span>
        </button>
      ))}
    </nav>
  );
}

// ─── Materiales ─────────────────────────────────────────────────────────────────────────────────

interface FormMaterial {
  tipo: Material["tipo"];
  campos: Record<string, string>;
  id: string;
}

function formMaterial(x: Material): FormMaterial {
  if (x.tipo === "hormigon") return { tipo: x.tipo, id: x.id, campos: { fck: escrito(x.fck), nu: escrito(x.nu), peso: escrito(x.peso) } };
  if (x.tipo === "acero") return { tipo: x.tipo, id: x.id, campos: { E: escrito(x.E), peso: escrito(x.peso) } };
  return { tipo: x.tipo, id: x.id, campos: { E: escrito(x.E), G: escrito(x.G), peso: escrito(x.peso) } };
}

/** Lo rellenado como material, o los errores por campo. */
function materialDe(f: FormMaterial, id: string): { ok: true; material: Material } | { ok: false; errores: Record<string, string> } {
  const errores: Record<string, string> = {};
  const num = (k: string, o: { obligatorio?: boolean; min?: number; max?: number; mayorQue?: number }): number | undefined => {
    const v = leer(f.campos[k]);
    if (v === null) {
      if (o.obligatorio) errores[k] = "falta";
      return undefined;
    }
    if (!Number.isFinite(v) || (o.mayorQue !== undefined && !(v > o.mayorQue)) || (o.min !== undefined && v < o.min) || (o.max !== undefined && v > o.max)) {
      errores[k] = o.max !== undefined ? `entre ${o.min} y ${String(o.max).replace(".", ",")}` : o.mayorQue !== undefined ? `mayor que ${o.mayorQue}` : `al menos ${o.min}`;
      return undefined;
    }
    return v;
  };
  const opc = <T,>(k: string, v: T | undefined) => (v === undefined ? {} : { [k]: v });
  let material: Material;
  if (f.tipo === "hormigon") material = { id, tipo: "hormigon", fck: num("fck", { obligatorio: true, mayorQue: 0 })!, ...opc("nu", num("nu", { min: 0, max: 0.5 })), ...opc("peso", num("peso", { min: 0 })) };
  else if (f.tipo === "acero") material = { id, tipo: "acero", ...opc("E", num("E", { mayorQue: 0 })), ...opc("peso", num("peso", { min: 0 })) };
  else material = { id, tipo: "general", E: num("E", { obligatorio: true, mayorQue: 0 })!, G: num("G", { obligatorio: true, mayorQue: 0 })!, peso: num("peso", { obligatorio: true, min: 0 })! };
  if (!id) errores.id = "falta";
  return Object.keys(errores).length ? { ok: false, errores } : { ok: true, material };
}

const CAMPOS_MATERIAL: Record<Material["tipo"], readonly [string, string, string][]> = {
  hormigon: [
    ["fck", "MPa", "resistencia característica; E es el Ecm del Código Estructural"],
    ["nu", "", "coeficiente de Poisson; vacío, 0,2"],
    ["peso", "kN/m³", "peso específico; vacío, 25"],
  ],
  acero: [
    ["E", "MPa", "vacío, 210 000"],
    ["peso", "kN/m³", "peso específico; vacío, 78,5"],
  ],
  general: [
    ["E", "kN/m²", "módulo de elasticidad"],
    ["G", "kN/m²", "módulo de cortante"],
    ["peso", "kN/m³", "peso específico"],
  ],
};
const NOMBRE_TIPO: Record<Material["tipo"], string> = { hormigon: "Hormigón", acero: "Acero", general: "General" };

/** El id que se propone para un material nuevo: «HA-<fck>», «S275» o «M<n>». */
function idMaterialPropuesto(m: ModeloFisico, f: FormMaterial): string {
  if (f.tipo === "hormigon") {
    const fck = leer(f.campos.fck);
    return idMaterialLibre(m, fck !== null && fck > 0 ? `HA-${String(fck).replace(".", ",")}` : "HA");
  }
  if (f.tipo === "acero") return idMaterialLibre(m, "S275");
  for (let i = 1; ; i++) if (!m.materiales.some((x) => x.id === `M${i}`) && !m.secciones.some((x) => x.id === `M${i}`)) return idMaterialLibre(m, `M${i}`);
}

function GestorMateriales({ pedido }: { pedido: PedidoGestor }) {
  const { proyecto, pedirTabla } = useVisor();
  const ed = proyecto.edicion!;
  const m = ed.proyecto.modelo;
  const vacio = (tipo: Material["tipo"] = pedido.familia ?? "hormigon"): FormMaterial => ({ tipo, id: "", campos: tipo === "hormigon" ? { fck: "30" } : {} });
  const inicial = pedido.nueva ? null : (m.materiales.find((x) => x.id === pedido.id) ?? m.materiales[0] ?? null);
  const [elegido, setElegido] = useState<string | null>(inicial?.id ?? null);
  const [form, setForm] = useState<FormMaterial>(() => (inicial ? formMaterial(inicial) : vacio()));
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [borrar, setBorrar] = useState<string | null>(null);

  const ir = (id: string | null, f?: FormMaterial) => {
    setElegido(id);
    setError(null);
    const x = id === null ? undefined : m.materiales.find((y) => y.id === id);
    setForm(f ?? (x ? formMaterial(x) : vacio()));
  };
  const actual = elegido === null ? undefined : m.materiales.find((x) => x.id === elegido);
  const propuesto = actual ? actual.id : idMaterialPropuesto(m, form);
  const lectura = materialDe(form, form.id.trim() || propuesto);
  const errores = lectura.ok ? {} : lectura.errores;
  const material = lectura.ok ? lectura.material : null;
  const cambiado = !!actual && (!material || JSON.stringify(actual) !== JSON.stringify(material));
  const usos = actual ? usosDe(m, actual.id) : [];
  const props = material ? propiedadesMaterial(material) : null;

  const terminar = (id: string, ops: readonly Operacion[], etiqueta: string): boolean => {
    if (pedido.alElegir) {
      const e = pedido.alElegir(id, ops);
      if (e) {
        setError(e);
        return false;
      }
      cerrarGestor();
      return true;
    }
    if (ops.length) {
      const r = ed.editar(comoUna(ops), etiqueta);
      if (!r.ok) {
        setError(r.errores.map((x) => x.mensaje).join(" "));
        return false;
      }
    }
    return true;
  };
  const crearCon = (x: Material) => {
    const c = crearMaterial(m, x);
    if (!c.ok) return setError(c.mensaje);
    if (!terminar(c.id, c.operaciones, `Nuevo material ${c.id}`)) return;
    setAviso(`Creado ${c.id}.`);
    ir(c.id, formMaterial(x));
  };
  const crear = () => (material ? crearCon(material) : setError("Falta lo marcado."));
  const aplicar = () => {
    if (!actual || !material) return setError("Falta lo marcado.");
    const r = ed.editar({ op: "cambiar", coleccion: "materiales", id: actual.id, objeto: material as unknown as Objeto }, `Material ${actual.id}`);
    if (!r.ok) return setError(r.errores.map((x) => x.mensaje).join(" "));
    setAviso(`${material.id}: cambiado en ${textoUsos(usos)}.`);
    ir(material.id, formMaterial(material));
  };

  const hay = new Set(m.materiales.map((x) => x.id));
  const primaria = actual ? (
    pedido.alElegir && !cambiado ? (
      <button type="button" className="btn btn-p" onClick={() => terminar(actual.id, [], "")}>
        Usar {actual.id}
      </button>
    ) : (
      <button type="button" className="btn btn-p" disabled={!cambiado || !material} onClick={aplicar}>
        {usos.length ? `Aplicar a ${textoUsos(usos)}` : "Aplicar"}
      </button>
    )
  ) : (
    <button type="button" className="btn btn-p" disabled={!material} onClick={crear}>
      {pedido.alElegir ? "Crear y usar" : "Crear"}
    </button>
  );

  return (
    <>
      <Dialogo
        titulo="Materiales"
        clase="gestor"
        onCerrar={cerrarGestor}
        pie={
          <>
            <button type="button" className="btn btn-q mr-auto" onClick={() => (cerrarGestor(), pedirTabla("materiales"))}>
              <Table2 size={14} />
              Abrir la tabla
            </button>
            {actual && (
              <button type="button" className="btn" onClick={() => setBorrar(actual.id)}>
                Borrar
              </button>
            )}
            {primaria}
          </>
        }
      >
        <Lista
          titulo="materiales"
          nueva={elegido === null}
          onNueva={() => (setAviso(null), ir(null))}
          elementos={m.materiales.map((x) => ({ id: x.id, texto: describirMaterial(x), detalle: NOMBRE_TIPO[x.tipo].toLowerCase(), n: usosDe(m, x.id).reduce((t, u) => t + u.n, 0) }))}
          elegida={elegido}
          onElegir={(id) => (setAviso(null), ir(id))}
        />
        <div
          className="ges-ficha"
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.target instanceof HTMLInputElement) (actual ? (cambiado ? aplicar() : undefined) : crear());
          }}
        >
          {pedido.para && <p className="ges-para">Para {pedido.para}</p>}
          {aviso && (
            <p className="ges-aviso" role="status">
              {aviso}
            </p>
          )}
          {!actual && (
            <>
              <p className="dlg-et">Típicos: un clic</p>
              <div className="ges-tipicos" role="group" aria-label="Materiales típicos">
                {MATERIALES_TIPICOS.map((x) => (
                  <button key={x.id} type="button" className="ges-tipico" disabled={hay.has(x.id)} title={hay.has(x.id) ? "Ya está en el proyecto" : `${describirMaterial(x)}${x.tipo === "acero" ? " (el grado sólo da el nombre: el cálculo es elástico)" : ""}`} onClick={() => crearCon(x)}>
                    <span>{x.id}</span>
                    <small>{hay.has(x.id) ? "ya está" : x.tipo === "hormigon" ? `fck ${x.fck}` : "acero"}</small>
                  </button>
                ))}
              </div>
              <p className="dlg-et">U otro</p>
            </>
          )}
          <div className="ges-cuerpo">
            <div className="ges-datos">
              {actual && <p className="dlg-et">{actual.id}</p>}
              <label className="campo">
                <span>id</span>
                <input value={form.id} placeholder={propuesto} aria-label="id del material" data-error={!!errores.id} onChange={(e) => setForm({ ...form, id: e.target.value })} />
                {!actual && <p>Vacío: el propuesto.</p>}
              </label>
              <div className="campo">
                <span>tipo</span>
                <div className="seg" role="radiogroup" aria-label="Tipo de material">
                  {(["hormigon", "acero", "general"] as const).map((t) => (
                    <button key={t} type="button" role="radio" aria-checked={form.tipo === t} data-on={form.tipo === t} onClick={() => setForm(t === form.tipo ? form : { ...vacio(t), id: form.id })}>
                      {NOMBRE_TIPO[t]}
                    </button>
                  ))}
                </div>
              </div>
              {CAMPOS_MATERIAL[form.tipo].map(([k, u, a]) => (
                <label key={k} className="campo">
                  <span>
                    {k === "nu" ? "ν" : k === "peso" ? "γ" : k}
                    {u && <small>{u}</small>}
                  </span>
                  <input value={form.campos[k] ?? ""} inputMode="decimal" aria-label={`${k} del material${u ? `, ${u}` : ""}`} data-error={!!errores[k]} aria-invalid={!!errores[k]} onChange={(e) => setForm({ ...form, campos: { ...form.campos, [k]: e.target.value } })} />
                  <p className={errores[k] ? "error" : undefined}>{errores[k] ?? a}</p>
                </label>
              ))}
            </div>
            <div className="ges-ver">
              <Propiedades
                filas={props ? [["E", `${fmt(props.E / 1000, 0)} MPa`], ["G", `${fmt(props.G / 1000, 0)} MPa`], ["γ", `${cifras(props.peso, 3)} kN/m³`]] : []}
                nota={props ? (material?.tipo === "hormigon" ? "E: el Ecm del Código Estructural al MPa, como CYPECAD (CY-a)." : "Los que usa el cálculo.") : "Complete los datos para ver sus propiedades."}
              />
              {actual && <p className="ges-usos">{usos.length ? `Lo usan ${textoUsos(usos)}: cambiarlo los cambia a todos.` : "No lo usa ningún objeto."}</p>}
            </div>
          </div>
          {error && (
            <p className="ges-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </Dialogo>
      {borrar && (
        <DialogoBorrar
          ids={[borrar]}
          onCerrar={(hecho) => {
            setBorrar(null);
            if (!hecho) return;
            setAviso(hecho);
            ir(m.materiales.find((x) => x.id !== borrar)?.id ?? null);
          }}
        />
      )}
    </>
  );
}

