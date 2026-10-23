/**
 * Lo que va en Propiedades mientras una herramienta de dibujo está activa (V2c-1, `dibujo.md` §2.1):
 * su plantilla (lo que en CYPECAD pide el diálogo antes de colocar, pero sin diálogo: vale para los
 * siguientes), los enganches por tipo y el ortogonal. Y el campo de teclado junto al cursor (§2.3).
 */
import { useState } from "react";
import type { ModeloFisico, PuntoFijo } from "../../../src/compilador/fisico.ts";
import { PUNTOS_FIJOS } from "../../../src/compilador/puntoFijo.ts";
import { NOMBRE_ENGANCHE, TIPOS_ENGANCHE } from "../../../src/editor/dibujo/enganches.ts";
import { operacionProponerEjes, plantasPilar, type Alinear, type NombreHerramienta, type Plantillas } from "../../../src/editor/dibujo/herramientas.ts";
import type { Operacion } from "../../../src/editor/operaciones.ts";
import type { NombreTabla } from "../../../src/editor/tablas.ts";
import { Seccion } from "../componentes/comunes.tsx";
import type { ControladorDibujo, Instantanea } from "./controlador.ts";

const TITULO: Record<Exclude<NombreHerramienta, "elegir">, string> = { ejes: "Ejes", pilar: "Pilar", viga: "Viga" };

/**
 * La sección de por defecto de una herramienta: la más usada por los objetos de su tipo; si no, la
 * primera cuyo id empieza por su letra (P, V); si no, la primera.
 */
export function seccionPorDefecto(m: ModeloFisico, tipo: "pilares" | "vigas"): string | undefined {
  const n = new Map<string, number>();
  for (const o of m[tipo] ?? []) n.set(o.seccion, (n.get(o.seccion) ?? 0) + 1);
  let mejor: string | undefined;
  for (const [s, k] of n) if (m.secciones.some((x) => x.id === s) && (!mejor || k > n.get(mejor)!)) mejor = s;
  const letra = tipo === "pilares" ? "P" : "V";
  return mejor ?? m.secciones.find((s) => s.id.startsWith(letra))?.id ?? m.secciones[0]?.id;
}

/** La plantilla con lo de por defecto donde no hay nada válido. */
export function plantillasEfectivas(m: ModeloFisico | null, t: Plantillas): Plantillas {
  if (!m) return t;
  const valida = (s: string | undefined) => (s && m.secciones.some((x) => x.id === s) ? s : undefined);
  return {
    pilar: { ...t.pilar, seccion: valida(t.pilar.seccion) ?? seccionPorDefecto(m, "pilares") },
    viga: { ...t.viga, seccion: valida(t.viga.seccion) ?? seccionPorDefecto(m, "vigas") },
  };
}

const FIJO: Record<PuntoFijo, string> = {
  centro: "centro",
  "mitad-derecha": "centro del lado derecho",
  "mitad-izquierda": "centro del lado izquierdo",
  "mitad-superior": "centro del lado superior",
  "mitad-inferior": "centro del lado inferior",
  "esquina-superior-derecha": "esquina superior derecha",
  "esquina-superior-izquierda": "esquina superior izquierda",
  "esquina-inferior-derecha": "esquina inferior derecha",
  "esquina-inferior-izquierda": "esquina inferior izquierda",
};

interface Props {
  foto: Instantanea;
  ctrl: ControladorDibujo;
  modelo: ModeloFisico;
  /** La planta de la vista activa. */
  planta: string | null;
  plantillas: Plantillas;
  setPlantillas: (p: Plantillas) => void;
  editar: (o: Operacion, etiqueta: string) => string | null;
  abrirTabla: (t: NombreTabla) => void;
}

export function PlantillaDibujo({ foto, ctrl, modelo: m, planta, plantillas: t, setPlantillas, editar, abrirTabla }: Props) {
  const h = foto.herramienta;
  if (h === "elegir") return null;
  const secciones = m.secciones;
  const selSeccion = (valor: string | undefined, onCambio: (s: string) => void, tipo: "P" | "V") => (
    <>
      <label className="campo">
        <span>sección</span>
        <select className="sel" value={valor ?? ""} aria-label="Sección" onChange={(x) => onCambio(x.target.value)}>
          {!valor && <option value="">(ninguna)</option>}
          {secciones.map((s) => (
            <option key={s.id} value={s.id}>
              {s.id}
            </option>
          ))}
        </select>
      </label>
      <NuevaSeccion modelo={m} tipo={tipo} editar={editar} onCreada={onCambio} />
    </>
  );
  const pl = planta ? plantasPilar(m, planta, t.pilar) : null;
  const propuesta = h === "ejes" ? operacionProponerEjes(m) : null;
  return (
    <>
      <Seccion titulo={`Dibujar · ${TITULO[h]}`} valor={planta ? `en ${planta}` : undefined}>
        <p className="nota">{foto.ayuda}</p>
        {foto.error && <p className="nota text-state-fail">{foto.error}</p>}
        {!foto.error && foto.hecho && <p className="nota">Hecho: {foto.hecho} (Ctrl+Z lo deshace).</p>}
        <div className="py-1.5">
          {h === "pilar" && (
            <>
              <label className="campo">
                <span>desde</span>
                <select className="sel" value={t.pilar.desde ?? ""} aria-label="Planta de la base" onChange={(x) => setPlantillas({ ...t, pilar: { ...t.pilar, desde: x.target.value || undefined } })}>
                  <option value="">(la más baja: {m.plantas.at(-1)?.id})</option>
                  {m.plantas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="campo">
                <span>hasta</span>
                <select className="sel" value={t.pilar.hasta ?? ""} aria-label="Planta de la cabeza" onChange={(x) => setPlantillas({ ...t, pilar: { ...t.pilar, hasta: x.target.value || undefined } })}>
                  <option value="">(la de la vista{planta ? `: ${planta}` : ""})</option>
                  {m.plantas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id}
                    </option>
                  ))}
                </select>
                {pl && !pl.ok && <p className="error">{pl.mensaje}</p>}
              </label>
              {selSeccion(t.pilar.seccion, (s) => setPlantillas({ ...t, pilar: { ...t.pilar, seccion: s } }), "P")}
              <NumeroCampo etiqueta="giro" unidad="°" valor={t.pilar.giro} onCambio={(g) => setPlantillas({ ...t, pilar: { ...t.pilar, giro: g } })} ayuda="del canto h desde +X" />
              <label className="campo">
                <span>punto fijo</span>
                <select className="sel" value={t.pilar.fijo ?? "centro"} aria-label="Punto fijo" onChange={(x) => setPlantillas({ ...t, pilar: { ...t.pilar, fijo: x.target.value === "centro" ? undefined : (x.target.value as PuntoFijo) } })}>
                  {PUNTOS_FIJOS.map((f) => (
                    <option key={f} value={f}>
                      {FIJO[f]}
                    </option>
                  ))}
                </select>
                <p className="ayuda">El punto de la sección que va donde se hace clic, en todas las plantas.</p>
              </label>
            </>
          )}
          {h === "viga" && (
            <>
              {selSeccion(t.viga.seccion, (s) => setPlantillas({ ...t, viga: { ...t.viga, seccion: s } }), "V")}
              <label className="campo">
                <span>alinear</span>
                <select className="sel" value={t.viga.alinear ?? "eje"} aria-label="Alinear" onChange={(x) => setPlantillas({ ...t, viga: { ...t.viga, alinear: x.target.value as Alinear } })}>
                  <option value="eje">eje a eje</option>
                  <option value="izquierda">cara izquierda</option>
                  <option value="derecha">cara derecha</option>
                </select>
                <p className="ayuda">Eje a eje, por el punto fijo de los pilares. Con una cara, cada tramo que nace o acaba en un pilar va con esa cara (izquierda o derecha según el sentido del dibujo) en la del pilar.</p>
              </label>
            </>
          )}
          {h === "ejes" && (
            <div className="flex flex-wrap gap-2 px-3.5 py-1">
              <button type="button" className="btn" disabled={!propuesta} title={propuesta ? "Guarda en el proyecto los ejes que se ven, propuestos por las alineaciones de los pilares" : "Sólo sin ejes en el proyecto y con pilares alineados"} onClick={() => propuesta && editar(propuesta.operacion, propuesta.etiqueta)}>
                Proponer ejes
              </button>
            </div>
          )}
        </div>
        <div className="px-3.5 pb-2">
          <button type="button" className="text-[12px] text-accent hover:underline" onClick={() => abrirTabla(h === "ejes" ? "ejes" : h === "pilar" ? "pilares" : "vigas")}>
            Abrir la tabla de {h === "ejes" ? "ejes" : h === "pilar" ? "pilares" : "vigas"}
          </button>
        </div>
      </Seccion>
      <Seccion titulo="Enganches" valor={foto.orto ? "ortogonal" : undefined}>
        <div className="grid grid-cols-2 gap-x-2 px-3.5 py-1.5 text-[12px]">
          <label className="col-span-2 flex items-center gap-1.5">
            <input type="checkbox" checked={foto.orto} onChange={() => ctrl.alternarOrto()} />
            Ortogonal (F8; Mayús, también a 45°)
          </label>
          {TIPOS_ENGANCHE.map((x) => (
            <label key={x} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={foto.activos.has(x)}
                onChange={(e) => {
                  const n = new Set(foto.activos);
                  if (e.target.checked) n.add(x);
                  else n.delete(x);
                  ctrl.ponerActivos(n);
                }}
              />
              {NOMBRE_ENGANCHE[x]}
            </label>
          ))}
        </div>
      </Seccion>
      <Seccion titulo="Teclado">
        <p className="nota">
          Con la herramienta pidiendo un punto, escriba: <span className="mono">x; y</span> (absolutas), <span className="mono">@dx; dy</span> (relativas), <span className="mono">@L&lt;ángulo</span> (desde el eje 1 de la losa) o una longitud (hacia el cursor). Intro acepta; Esc anula; Retroceso quita el último punto.
        </p>
      </Seccion>
    </>
  );
}

function NumeroCampo({ etiqueta, unidad, valor, onCambio, ayuda }: { etiqueta: string; unidad?: string; valor: number | undefined; onCambio: (v: number | undefined) => void; ayuda?: string }) {
  const [texto, setTexto] = useState<string | null>(null);
  const mostrado = texto ?? (valor === undefined ? "" : String(valor).replace(".", ","));
  const v = Number(mostrado.trim().replace(",", "."));
  const mal = mostrado.trim() !== "" && !Number.isFinite(v);
  const escribir = () => {
    if (texto === null) return;
    if (!mal) onCambio(texto.trim() === "" || v === 0 ? undefined : v);
    setTexto(null);
  };
  return (
    <label className="campo">
      <span>
        {etiqueta}
        {unidad && <small>{unidad}</small>}
      </span>
      <input value={mostrado} data-error={mal} aria-label={etiqueta} aria-invalid={mal} onChange={(x) => setTexto(x.target.value)} onBlur={escribir} onKeyDown={(x) => x.key === "Enter" && escribir()} />
      {mal ? <p className="error">Un número</p> : ayuda ? <p className="ayuda">{ayuda}</p> : null}
    </label>
  );
}

/** Una sección rectangular nueva, b × h en cm, sin ir a la tabla: «P30x30», «V30x50». */
function NuevaSeccion({ modelo: m, tipo, editar, onCreada }: { modelo: ModeloFisico; tipo: "P" | "V"; editar: Props["editar"]; onCreada: (id: string) => void }) {
  const [abierta, setAbierta] = useState(!m.secciones.length);
  const [b, setB] = useState("30");
  const [h, setH] = useState(tipo === "P" ? "30" : "50");
  const [error, setError] = useState<string | null>(null);
  const material = m.materiales.find((x) => x.tipo === "hormigon")?.id;
  if (!abierta)
    return (
      <div className="px-3.5 pb-1">
        <button type="button" className="text-[12px] text-accent hover:underline" onClick={() => setAbierta(true)}>
          Nueva sección rectangular…
        </button>
      </div>
    );
  const crear = () => {
    const [nb, nh] = [Number(b.replace(",", ".")), Number(h.replace(",", "."))];
    if (!(nb > 0 && nh > 0)) return setError("b y h, en cm, mayores que 0.");
    if (!material) return setError("No hay ningún hormigón en Materiales.");
    const id = `${tipo}${b.replace(",", ".")}x${h.replace(",", ".")}`;
    if (!m.secciones.some((s) => s.id === id)) {
      const e = editar({ op: "crear", coleccion: "secciones", objeto: { id, material, forma: "rectangular", b: nb / 100, h: nh / 100 } }, `Sección ${id}`);
      if (e) return setError(e);
    }
    setError(null);
    setAbierta(false);
    onCreada(id);
  };
  return (
    <div className="px-3.5 pb-1.5">
      <div className="flex items-end gap-1.5 text-[12px]">
        <label className="flex flex-col">
          b (cm)
          <input className="sel w-14" aria-label="b de la sección nueva, cm" value={b} onChange={(x) => setB(x.target.value)} />
        </label>
        <label className="flex flex-col">
          h (cm)
          <input className="sel w-14" aria-label="h de la sección nueva, cm" value={h} onChange={(x) => setH(x.target.value)} onKeyDown={(x) => x.key === "Enter" && crear()} />
        </label>
        <button type="button" className="btn" onClick={crear}>
          Crear
        </button>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-text-disabled">
        Rectangular de {material ?? "hormigón"}{tipo === "P" ? "; h es el canto, según el giro" : "; h es el canto"}.
      </p>
      {error && <p className="mt-1 text-[11px] text-state-fail">{error}</p>}
    </div>
  );
}

/** El campo de lo que se teclea, junto al cursor. */
export function CampoTeclado({ ctrl, campo }: { ctrl: ControladorDibujo; campo: NonNullable<Instantanea["campo"]> }) {
  const [texto, setTexto] = useState(campo.texto);
  return (
    <div className="campo-teclado" style={{ left: campo.x + 16, top: campo.y + 16 }} role="dialog" aria-label="Punto por teclado">
      <input
        className="sel mono"
        autoFocus
        aria-label="Punto: x; y, @dx; dy, @L<ángulo o longitud"
        value={texto}
        onChange={(x) => setTexto(x.target.value)}
        onBlur={() => ctrl.cerrarCampo()}
        onKeyDown={(x) => {
          x.stopPropagation();
          if (x.key === "Enter") ctrl.teclear(texto);
          else if (x.key === "Escape") ctrl.cerrarCampo();
        }}
      />
      {campo.error && <p className="error">{campo.error}</p>}
    </div>
  );
}
