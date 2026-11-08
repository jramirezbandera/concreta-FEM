/**
 * «Datos de la obra» (fase DO, `docs/fem3d/datos-obra.md` §3.1): lo que decide la obra y no el
 * dibujo, en un diálogo de una página (DO-a). Es el primer paso de una obra nueva (con «Siguiente:
 * plantas» y «Más tarde», DO-f) y se abre después desde «Obra» en la barra de Modelo, el nombre del
 * proyecto en la barra de título, el navegador y la paleta.
 *
 * 1. Proyecto: nombre, descripción y uso del edificio (DO-b).
 * 2. Emplazamiento: el mismo componente que la ficha de acciones (DO-d), con la zona eólica, ab, K y
 *    la sk de la nieve al momento.
 * 3. Materiales de la obra, por tipo de elemento (DO-h), con «Cambiar también las N existentes» (DO-c).
 * 4. Acciones, plantas y casos: resúmenes con su acceso (las fichas y gestores que ya existen).
 * 5. Normas: una línea, sin elegir.
 *
 * «Aplicar» escribe todo en un paso de deshacer. Los accesos a otras fichas aplican antes lo escrito
 * aquí (si vale), porque sólo hay un diálogo abierto a la vez. Los textos no nombran programas
 * comerciales.
 */
import { useMemo, useState } from "react";
import { FAMILIA_OBRA, NOMBRE_TIPO_OBRA, TIPOS_OBRA, type ObraProyecto, type TipoObra } from "../../../src/agente/obra.ts";
import type { CategoriaUso } from "../../../src/combinaciones/psi.ts";
import { cotasPlantas } from "../../../src/compilador/cotas.ts";
import type { AccionesEdificio } from "../../../src/compilador/fisico.ts";
import { nieveObra } from "../../../src/compilador/nieve.ts";
import { USOS } from "../../../src/editor/casos.ts";
import { describirMaterial, materialesElegibles } from "../../../src/editor/gestores.ts";
import { aplicarObra, piezasACambiar } from "../../../src/editor/obra.ts";
import type { Operacion } from "../../../src/editor/operaciones.ts";
import { provinciaPorIne } from "../../../src/normas/provincias.ts";
import { useVisor } from "../contexto.ts";
import { fmt, plural, textoApp } from "../fmt.ts";
import { Dialogo } from "./Dialogos.tsx";
import { CampoEmplazamiento, Etiqueta, useEmplazamiento } from "./Emplazamiento.tsx";
import { abrirGestor, cerrarGestor, type PedidoGestor } from "./referencia.tsx";

const AYUDA = {
  nombre: "El nombre de la obra: sale en la barra de título, en «Mis proyectos» y en el informe. No cambia el cálculo.",
  uso: "La categoría de uso del edificio (DB SE-AE, tabla 3.1). Es la que se propone para la sobrecarga de uso en los casos típicos, con sus coeficientes ψ (DB SE, tabla 4.2). No cambia el cálculo: lo que cuenta es el ψ de cada caso.",
  materiales:
    "El material con el que se crean las piezas nuevas de cada tipo. Cada sección, forjado y muro lleva el suyo, así que puede haber piezas de otro material. Al cambiarlo, puede pasar también las que ya hay de ese tipo.",
} as const;

const NORMAS = "CTE DB SE, DB SE-AE y Código Estructural; sismo, NCSE-02";

export function DatosObra({ pedido }: { pedido: PedidoGestor }) {
  const { proyecto } = useVisor();
  const ed = proyecto.edicion!;
  const p = ed.proyecto;
  const m = p.modelo;
  const a: AccionesEdificio = m.acciones ?? {};
  const inicio = !!pedido.inicio;

  const [nombre, setNombre] = useState(p.nombre ?? "");
  const [descripcion, setDescripcion] = useState(p.descripcion ?? "");
  const [uso, setUso] = useState<CategoriaUso | "">(p.obra?.uso ?? "");
  const emp = useEmplazamiento(a);
  const [materiales, setMateriales] = useState<Partial<Record<TipoObra, string>>>({ ...p.obra?.materiales });
  const [existentes, setExistentes] = useState<Partial<Record<TipoObra, boolean>>>({});
  const [conViento, setConViento] = useState(a.viento !== undefined);
  const [conSismo, setConSismo] = useState(a.sismo !== undefined);
  const [error, setError] = useState<string | null>(null);

  const elegibles = useMemo(() => materialesElegibles(m), [m]);
  /** Las piezas de cada tipo que cambiarían con su material nuevo. */
  const aCambiar = useMemo(() => {
    const r: Partial<Record<TipoObra, number>> = {};
    for (const t of TIPOS_OBRA) {
      const v = materiales[t];
      if (v && v !== p.obra?.materiales?.[t]) r[t] = piezasACambiar(m, t, v).length;
    }
    return r;
  }, [materiales, m, p.obra]);

  /** Lo que se escribirá: un lote, o por qué no. */
  const cambio = useMemo((): { operaciones: Operacion[]; vacio: boolean } | { error: string } => {
    if ("error" in emp.valor) return { error: emp.valor.error };
    const ops: Operacion[] = [];
    // Proyecto
    const n = nombre.trim();
    const d = descripcion.trim();
    if (n !== (p.nombre ?? "") || d !== (p.descripcion ?? "")) ops.push({ op: "datos", nombre: n, descripcion: d });
    // Acciones: el emplazamiento (el ine y la altitud de los ficheros de antes pasan a él) y lo que se apaga
    const acc: AccionesEdificio = { ...a };
    const e = emp.valor.valor;
    if (e) acc.emplazamiento = e;
    else delete acc.emplazamiento;
    if (acc.sismo && (acc.sismo.ine !== undefined || acc.sismo.municipio !== undefined) && e) {
      const { ine: _i, municipio: _m, ...s } = acc.sismo;
      acc.sismo = s;
    }
    if (acc.viento?.altitud !== undefined && e?.altitud !== undefined) {
      const { altitud: _a, ...v } = acc.viento;
      acc.viento = v;
    }
    if (!conViento) delete acc.viento;
    if (!conSismo) delete acc.sismo;
    if (JSON.stringify(acc) !== JSON.stringify(a)) ops.push({ op: "acciones", acciones: Object.keys(acc).length ? acc : null });
    // Obra
    const obra: ObraProyecto = { ...p.obra, ...(uso ? { uso } : {}) };
    if (!uso) delete obra.uso;
    const mats = Object.fromEntries(TIPOS_OBRA.filter((t) => materiales[t]).map((t) => [t, materiales[t]!]));
    if (Object.keys(mats).length) obra.materiales = mats;
    else delete obra.materiales;
    const tipos = TIPOS_OBRA.filter((t) => existentes[t] && (aCambiar[t] ?? 0) > 0);
    if (JSON.stringify(obra) !== JSON.stringify(p.obra ?? {}) || tipos.length) {
      const r = aplicarObra({ ...p, modelo: m }, Object.keys(obra).length ? obra : null, tipos);
      if (!r.ok) return { error: r.mensaje };
      ops.push(...r.operaciones);
    }
    return { operaciones: ops, vacio: ops.length === 0 };
  }, [emp.valor, nombre, descripcion, uso, materiales, existentes, aCambiar, conViento, conSismo, a, p, m]);

  /** Aplica lo escrito; true si se pudo (o no había nada). */
  const escribir = (): boolean => {
    if ("error" in cambio) {
      setError(cambio.error);
      return false;
    }
    if (cambio.vacio) return true;
    const r = ed.editar(cambio.operaciones.length === 1 ? cambio.operaciones[0]! : { op: "lote", operaciones: cambio.operaciones }, "Datos de la obra");
    if (!r.ok) {
      setError(r.errores.map((x) => textoApp(x.mensaje)).join(" "));
      return false;
    }
    return true;
  };
  const aplicar = () => {
    if (!escribir()) return;
    if (inicio) abrirGestor({ coleccion: "plantas", inicio: true });
    else cerrarGestor();
  };
  /** Aplica y abre otra ficha o gestor, que al cerrarse vuelve aquí. */
  const irA = (otro: PedidoGestor) => {
    if (escribir()) abrirGestor({ ...otro, volver: pedido });
  };
  const masTarde = () => abrirGestor({ coleccion: "plantas", inicio: true });

  // Lo que sale del emplazamiento escrito, al momento: la nieve (sin pedir nada al worker)
  const nieve = useMemo(() => (emp.valor && "valor" in emp.valor ? nieveObra({ ...m, acciones: { ...a, emplazamiento: emp.valor.valor } }) : null), [emp.valor, m, a]);
  const casoNieve = m.casos.find((c) => c.accion?.tipo === "S");

  // Resúmenes
  const zona = a.viento?.zona ?? (emp.prov ? emp.prov.zonaEolica : undefined);
  const resumenViento = a.viento ? `zona ${zona ?? "—"} · entorno ${a.viento.aspereza ?? "IV"} · 8 casos` : "sin viento del programa";
  const ab = a.sismo?.ab ?? emp.municipio?.ab;
  const mu = a.sismo?.mu;
  const resumenSismo = a.sismo
    ? ab !== undefined
      ? `ab = ${fmt(ab, 2)} g · μ ${typeof mu === "number" ? mu : mu ? `${mu.x}/${mu.y}` : "—"} · 4 casos`
      : "sólo masas y modos (falta el municipio o ab)"
    : "sin sismo del programa";
  const resumenNieve = nieve?.nieve?.sk != null ? `sk = ${fmt(nieve.nieve.skEfectiva ?? nieve.nieve.sk, 2)} kN/m² · ${casoNieve ? `caso ${casoNieve.id}` : "sin caso de nieve"}` : (nieve?.motivo ?? "falta el emplazamiento");
  const cotas = cotasPlantas(m.plantas);
  const sobre = m.plantas.length - 1;
  const alturas = [...new Set(m.plantas.slice(0, -1).map((x) => x.altura).filter((h): h is number => typeof h === "number"))];
  const cero = m.plantas.find((_, i) => cotas[i] === 0);
  const resumenPlantas = `${plural(sobre, "planta")} sobre ${m.plantas.at(-1)?.id ?? "la cimentación"}${alturas.length === 1 ? ` de ${fmt(alturas[0]!, 2)} m` : alturas.length > 1 ? `, de ${fmt(Math.min(...alturas), 2)} a ${fmt(Math.max(...alturas), 2)} m` : ""} · ±0,00 en ${cero?.id ?? "—"}`;
  const resumenCasos = m.casos.length ? m.casos.map((c) => c.id).join(", ") : "ninguno";

  const pendiente = !("error" in cambio) && !cambio.vacio ? "Hay cambios sin aplicar." : null;

  return (
    <Dialogo
      titulo="Datos de la obra"
      onCerrar={inicio ? masTarde : cerrarGestor}
      alConfirmar={aplicar}
      clase="dialogo-ancho"
      pendiente={inicio ? null : pendiente}
      fondoCierra={!inicio}
      pie={
        <>
          {error && <span className="mr-auto text-state-fail">{error}</span>}
          {"error" in cambio && !error && <span className="mr-auto text-state-warn">{cambio.error}</span>}
          {inicio ? (
            <>
              <button type="button" className="btn" onClick={masTarde}>
                Más tarde
              </button>
              <button type="button" className="btn btn-p" onClick={aplicar} disabled={"error" in cambio}>
                Siguiente: plantas
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn" onClick={cerrarGestor}>
                Cancelar
              </button>
              <button type="button" className="btn btn-p" onClick={aplicar} disabled={"error" in cambio}>
                Aplicar
              </button>
            </>
          )}
        </>
      }
    >
      {inicio && <p className="nota mb-3">Lo que decide la obra: dónde está, de qué uso es y sus materiales. Todo se puede cambiar después desde «Obra», en la barra de Modelo.</p>}
      <fieldset className="acc-grupo">
        <legend>Proyecto</legend>
        <div className="acc-form">
          <Etiqueta htmlFor="o-nombre" ayuda={AYUDA.nombre}>
            Nombre
          </Etiqueta>
          <input id="o-nombre" className="sel w-full" value={nombre} placeholder="Nombre de la obra" onChange={(x) => setNombre(x.target.value)} />
          <Etiqueta htmlFor="o-desc">Descripción</Etiqueta>
          <textarea id="o-desc" className="sel w-full" rows={2} value={descripcion} placeholder="Descripción" onChange={(x) => setDescripcion(x.target.value)} />
          <Etiqueta htmlFor="o-uso" ayuda={AYUDA.uso}>
            Uso del edificio
          </Etiqueta>
          <select id="o-uso" className="sel" value={uso} onChange={(x) => setUso(x.target.value as CategoriaUso | "")}>
            <option value="">Sin decir</option>
            {USOS.map(([c, n]) => (
              <option key={c} value={c}>
                {c} · {n}
              </option>
            ))}
          </select>
        </div>
      </fieldset>

      <div className="mt-3">
        <CampoEmplazamiento
          e={emp}
          extra={
            <div>
              <dt>Nieve</dt>
              <dd>{nieve?.nieve?.sk != null ? `sk = ${fmt(nieve.nieve.sk, 2)} kN/m² (zona ${nieve.nieve.zona ?? "—"})` : "— (falta la provincia o la altitud)"}</dd>
            </div>
          }
        />
      </div>

      <fieldset className="acc-grupo mt-3">
        <legend>Materiales de la obra · de lo que se crea</legend>
        <div className="acc-form">
          {TIPOS_OBRA.map((t) => {
            const familia = FAMILIA_OBRA[t];
            const opciones = elegibles.filter((x) => x.material.tipo === familia || (x.material.tipo === "general" && !x.nuevo));
            const n = aCambiar[t] ?? 0;
            return (
              <div key={t} className="contents">
                <Etiqueta htmlFor={`o-mat-${t}`} ayuda={t === "forjados" ? AYUDA.materiales : undefined}>
                  {NOMBRE_TIPO_OBRA[t][0]!.toUpperCase() + NOMBRE_TIPO_OBRA[t].slice(1)}
                </Etiqueta>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <select id={`o-mat-${t}`} className="sel" value={materiales[t] ?? ""} onChange={(x) => setMateriales((v) => ({ ...v, [t]: x.target.value || undefined }))}>
                    <option value="">El más usado</option>
                    {opciones.map(({ material, nuevo }) => (
                      <option key={material.id} value={material.id}>
                        {material.id} · {describirMaterial(material)}
                        {nuevo ? " (se añade)" : ""}
                      </option>
                    ))}
                  </select>
                  {n > 0 && (
                    <label className="flex items-center gap-1.5 text-[12px]">
                      <input type="checkbox" checked={!!existentes[t]} onChange={(x) => setExistentes((v) => ({ ...v, [t]: x.target.checked }))} />
                      Cambiar también {n === 1 ? "la pieza existente" : `las ${n} piezas existentes`} con otro {familia === "acero" ? "acero" : "hormigón"}
                    </label>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        <p className="acc-fuente mt-2">
          Otro material:{" "}
          <button type="button" className="enlace" onClick={() => irA({ coleccion: "materiales" })}>
            Materiales…
          </button>
        </p>
      </fieldset>

      <fieldset className="acc-grupo mt-3">
        <legend>Acciones, plantas y casos</legend>
        <div className="acc-form">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={conViento}
              onChange={(x) => {
                if (x.target.checked && !a.viento) irA({ coleccion: "acciones", pestana: "viento", activar: true });
                else setConViento(x.target.checked);
              }}
            />
            Con viento
          </label>
          <Resumen texto={conViento ? resumenViento : "sin viento del programa"} onClick={() => irA({ coleccion: "acciones", pestana: "viento" })} />
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={conSismo}
              onChange={(x) => {
                if (x.target.checked && !a.sismo) irA({ coleccion: "acciones", pestana: "sismo", activar: true });
                else setConSismo(x.target.checked);
              }}
            />
            Con sismo
          </label>
          <Resumen texto={conSismo ? resumenSismo : "sin sismo del programa"} onClick={() => irA({ coleccion: "acciones", pestana: "sismo" })} />
          <span className="pl-6">Nieve</span>
          <Resumen texto={resumenNieve} onClick={() => irA({ coleccion: "acciones", pestana: "nieve" })} />
          {!inicio && (
            <>
              <span className="pl-6">Plantas</span>
              <Resumen texto={resumenPlantas} accion="Plantas…" onClick={() => irA({ coleccion: "plantas" })} />
            </>
          )}
          <span className="pl-6">Casos</span>
          <Resumen texto={resumenCasos} accion="Casos…" onClick={() => irA({ coleccion: "casos" })} />
          <span className="pl-6">Normas</span>
          <span className="text-text-secondary">{NORMAS}</span>
        </div>
      </fieldset>
      {emp.prov && emp.municipio === null && !emp.nombreLibre && <p className="acc-fuente mt-2">Con el municipio salen además ab y K del sismo ({provinciaPorIne(emp.prov.ine)?.nombre}).</p>}
    </Dialogo>
  );
}

function Resumen({ texto, accion = "Configurar…", onClick }: { texto: string; accion?: string; onClick: () => void }) {
  return (
    <span className="flex flex-wrap items-center gap-x-3">
      <span className="text-text-secondary">{texto}</span>
      <button type="button" className="enlace" onClick={onClick}>
        {accion}
      </button>
    </span>
  );
}
