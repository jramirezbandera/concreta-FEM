/**
 * El gestor de casos de carga (GE2, `docs/fem3d/gestores.md` §3.4): la lista con quién usa cada
 * uno y, en «Nuevo», los típicos del CTE con un clic y las «Hipótesis típicas» de una vez. La ficha
 * de un caso es su formulario (el del inspector, con las columnas de la tabla Casos).
 *
 * Lo que decide (los típicos, reutilizar uno con la misma acción, los ids libres) sale de
 * `src/editor/casos.ts`; aquí sólo se pinta.
 */
import { Fragment, useState } from "react";
import { Table2 } from "lucide-react";
import type { CategoriaUso } from "../../../src/combinaciones/psi.ts";
import { CASOS_TIPICOS, casoIgual, casosDelJuego, crearCasos, describirCaso, JUEGO_DEFECTO, psiCaso, type JuegoCasos } from "../../../src/editor/casos.ts";
import { comoUna, textoUsos, usosDe } from "../../../src/editor/gestores.ts";
import type { Operacion } from "../../../src/editor/operaciones.ts";
import { useVisor } from "../contexto.ts";
import { AyudaCaso, LetraAccion, useCampoActivo } from "./AyudaCaso.tsx";
import { Dialogo, DialogoBorrar } from "./Dialogos.tsx";
import { FormularioObjeto } from "./Formulario.tsx";
import { Lista } from "./Gestores.tsx";
import { ACCIONES } from "./explicaciones.ts";
import { cerrarGestor, type PedidoGestor } from "./referencia.tsx";

/** Los grupos de típicos, con la acción de cada uno. */
const GRUPOS = [
  ["Permanentes", "G"],
  ["Uso", "Q"],
  ["Nieve", "S"],
  ["Viento", "W"],
  ["Sismo", "E"],
] as const;
const USOS: readonly CategoriaUso[] = ["A", "B", "C", "D", "E", "G"];

export function GestorCasos({ pedido }: { pedido: PedidoGestor }) {
  const { proyecto, pedirTabla } = useVisor();
  const ed = proyecto.edicion!;
  const m = ed.proyecto.modelo;
  const casos = m.casos ?? [];
  // Por su posición: renombrarlo en la ficha no lo suelta
  const inicial = pedido.nueva ? -1 : Math.max(0, casos.findIndex((c) => c.id === pedido.id));
  const [elegido, setElegido] = useState<number>(casos.length ? inicial : -1);
  const [juego, setJuego] = useState<JuegoCasos>(JUEGO_DEFECTO);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [borrar, setBorrar] = useState<string | null>(null);
  const actual = elegido >= 0 ? casos[elegido] : undefined;
  const ir = (i: number) => {
    setElegido(i);
    setError(null);
  };

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

  /** Un típico: lo crea (o elige el que ya es él) y lo deja elegido. */
  const tipico = (clave: string) => {
    const t = CASOS_TIPICOS.find((x) => x.clave === clave)!;
    const c = crearCasos(m, [t.caso]);
    if (!c.ok) return setError(c.mensaje);
    const id = c.ids[0]!;
    if (!terminar(id, c.operaciones, `Nuevo caso ${id}`)) return;
    setAviso(c.nuevos.length ? `Creado ${id}.` : `Ya estaba: ${id}.`);
    ir(c.nuevos.length ? casos.length : casos.findIndex((x) => x.id === id));
  };

  const delJuego = crearCasos(m, casosDelJuego(juego).map((t) => t.caso));
  const crearJuego = () => {
    if (!delJuego.ok) return setError(delJuego.mensaje);
    if (!delJuego.nuevos.length) return setAviso(`Ya están todos: ${delJuego.reutilizados.join(", ")}.`);
    if (!terminar(delJuego.nuevos[0]!, delJuego.operaciones, `Hipótesis típicas: ${delJuego.nuevos.join(", ")}`)) return;
    setAviso(`Creados ${delJuego.nuevos.join(", ")}${delJuego.reutilizados.length ? `; ya estaban ${delJuego.reutilizados.join(", ")}` : ""}.`);
  };

  const usos = actual ? usosDe(m, actual.id) : [];
  const ya = new Map(CASOS_TIPICOS.map((t) => [t.clave, casoIgual(m, t.caso)?.id]));
  const poner = (c: Partial<JuegoCasos>) => setJuego({ ...juego, ...c });
  const { activo, manejadores } = useCampoActivo();

  return (
    <>
      <Dialogo
        titulo="Casos de carga"
        clase="gestor"
        onCerrar={cerrarGestor}
        pie={
          <>
            <button type="button" className="btn btn-q mr-auto" onClick={() => (cerrarGestor(), pedirTabla("casos"))} title="Para cambiar muchos a la vez o pegar de Excel">
              <Table2 size={14} />
              Abrir la tabla
            </button>
            {actual && (
              <button type="button" className="btn" onClick={() => setBorrar(actual.id)}>
                Borrar
              </button>
            )}
            {actual && pedido.alElegir ? (
              <button type="button" className="btn btn-p" onClick={() => terminar(actual.id, [], "")}>
                Usar {actual.id}
              </button>
            ) : (
              <button type="button" className={actual ? "btn btn-p" : "btn"} onClick={cerrarGestor}>
                Cerrar
              </button>
            )}
          </>
        }
      >
        <Lista
          titulo="casos"
          nuevaTexto="Nuevo caso"
          nueva={!actual}
          onNueva={() => (setAviso(null), ir(-1))}
          elementos={casos.map((c) => ({ id: c.id, texto: c.nombre ?? "", detalle: describirCaso(c), n: usosDe(m, c.id).reduce((t, u) => t + u.n, 0), marca: c.accion?.tipo ?? "" }))}
          elegida={actual?.id ?? null}
          onElegir={(id) => (setAviso(null), ir(casos.findIndex((c) => c.id === id)))}
        />
        <div className="ges-ficha">
          {pedido.para && <p className="ges-para">Para {pedido.para}</p>}
          {aviso && (
            <p className="ges-aviso" role="status">
              {aviso}
            </p>
          )}
          {!actual ? (
            <>
              {!pedido.alElegir && (
                <>
                  <p className="dlg-et" style={{ marginTop: 0 }}>
                    Hipótesis típicas: el juego de una vez
                  </p>
                  <p className="ges-para">Crea de una vez los casos que pide casi cualquier edificio, con su acción y sus ψ del CTE. Los que ya estén se reutilizan.</p>
                  <div className="ges-cuerpo">
                    <div className="ges-datos">
                      <div className="flex flex-wrap gap-x-5 gap-y-1.5 py-1">
                        {(
                          [
                            ["permanentes", "Peso propio (G)"],
                            ["cargasMuertas", "Cargas muertas aparte (CM)"],
                            ["viento", "Viento ±X ±Y"],
                            ["sismo", "Sismo X e Y"],
                          ] as const
                        ).map(([k, t]) => (
                          <label key={k} className="flex items-center gap-1.5">
                            <input type="checkbox" checked={juego[k]} onChange={(e) => poner({ [k]: e.target.checked })} />
                            {t}
                          </label>
                        ))}
                      </div>
                      <label className="campo">
                        <span>uso</span>
                        <select className="sel" aria-label="Uso de las hipótesis" value={juego.uso ?? ""} onChange={(e) => poner({ uso: (e.target.value || null) as CategoriaUso | null })}>
                          <option value="">(sin sobrecarga de uso)</option>
                          {USOS.map((u) => (
                            <option key={u} value={u}>
                              {CASOS_TIPICOS.find((t) => t.clave === `Q${u}`)!.caso.nombre}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="campo">
                        <span>nieve</span>
                        <select className="sel" aria-label="Nieve de las hipótesis" value={juego.nieve ?? ""} onChange={(e) => poner({ nieve: (e.target.value || null) as JuegoCasos["nieve"] })}>
                          <option value="">(sin nieve)</option>
                          <option value="hasta-1000">hasta 1000 m de altitud</option>
                          <option value="mas-de-1000">más de 1000 m de altitud</option>
                        </select>
                      </label>
                    </div>
                    <div className="ges-ver">
                      <p className="ges-usos" style={{ marginTop: 4 }} aria-label="Lo que se va a hacer">
                        {!delJuego.ok
                          ? delJuego.mensaje
                          : `${delJuego.nuevos.length ? `Se crean ${delJuego.nuevos.join(", ")}.` : "No se crea ninguno."}${delJuego.reutilizados.length ? ` Ya están: ${delJuego.reutilizados.join(", ")}.` : ""}`}
                      </p>
                      <button type="button" className="btn btn-p mt-2" disabled={!delJuego.ok || !delJuego.nuevos.length} onClick={crearJuego}>
                        Crear las hipótesis
                      </button>
                    </div>
                  </div>
                </>
              )}
              <p className="dlg-et" style={pedido.alElegir ? { marginTop: 0 } : undefined}>
                {pedido.alElegir ? "Típicos del CTE: un clic lo crea y lo elige" : "O uno a uno: un clic"}
              </p>
              <div className="grid grid-cols-[150px_minmax(0,1fr)] items-start gap-x-3 gap-y-2.5">
                {GRUPOS.map(([g, tipo]) => (
                  <Fragment key={g}>
                    <span className="ges-grupo">
                      <span>
                        <LetraAccion tipo={tipo} />
                        {g}
                      </span>
                      <small>{ACCIONES[tipo].breve}</small>
                    </span>
                    <div className="ges-tipicos" role="group" aria-label={`Casos típicos: ${g.toLowerCase()}`}>
                      {CASOS_TIPICOS.filter((t) => t.grupo === g).map((t) => {
                        const hay = ya.get(t.clave);
                        return (
                          <button key={t.clave} type="button" className="ges-tipico" style={{ textAlign: "left" }} title={`${t.caso.nombre} · ${describirCaso(t.caso)}${psiCaso(t.caso) ? ` · ψ ${psiCaso(t.caso)}` : ""}${hay ? ` (ya está: ${hay})` : ""}`} onClick={() => tipico(t.clave)}>
                            <span>{t.clave === "S1000" ? "S >1000" : t.caso.id}</span>
                            <small>{hay ? `ya está: ${hay}` : (t.caso.nombre ?? "").replace(/^Uso . · /, "").replace(/^Nieve \(más de 1000 m\)$/, "nieve de altura")}</small>
                          </button>
                        );
                      })}
                    </div>
                  </Fragment>
                ))}
              </div>
            </>
          ) : (
            <div className="ges-cuerpo ancho">
              <div className="ges-datos" {...manejadores}>
                <FormularioObjeto id={actual.id} tabla="casos" />
              </div>
              <div className="ges-ver">
                <AyudaCaso caso={actual} m={m} campo={activo} />
                <p className="ges-usos">{usos.length ? `Lo usan ${textoUsos(usos)}.` : "No lo usa ninguna carga."}</p>
              </div>
            </div>
          )}
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
            ir(casos.length > 1 ? 0 : -1);
          }}
        />
      )}
    </>
  );
}
