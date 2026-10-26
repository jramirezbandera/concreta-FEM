/**
 * Lo que va en Propiedades mientras una herramienta de dibujo está activa (V2c-1, `dibujo.md` §2.1):
 * su plantilla (lo que en CYPECAD pide el diálogo antes de colocar, pero sin diálogo: vale para los
 * siguientes), los enganches por tipo y el ortogonal. Y el campo de teclado junto al cursor (§2.3).
 *
 * La ayuda de la herramienta y su error van en el aviso del lienzo, no aquí: el panel es la plantilla.
 */
import { Check, Plus, Table2 } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { comoUna, describirSeccion } from "../../../src/editor/gestores.ts";
import { cotasPlantas } from "../../../src/compilador/cotas.ts";
import type { ModeloFisico, PuntoFijo, Seccion as SeccionFisica } from "../../../src/compilador/fisico.ts";
import { medidasSeccion, SIGNOS_PUNTO_FIJO } from "../../../src/compilador/puntoFijo.ts";
import { NOMBRE_ENGANCHE, TIPOS_ENGANCHE } from "../../../src/editor/dibujo/enganches.ts";
import { operacionProponerEjes, plantasPilar, type Alinear, type NombreHerramienta, type Plantillas } from "../../../src/editor/dibujo/herramientas.ts";
import type { Operacion } from "../../../src/editor/operaciones.ts";
import type { NombreTabla } from "../../../src/editor/tablas.ts";
import { IcEjes, IcPilar, IcViga } from "../armazon/iconos.tsx";
import { Cabecera, Seccion } from "../componentes/comunes.tsx";
import { abrirGestor, EDITAR, esDelGestor, NUEVA, OpcionesGestor } from "../editor/referencia.tsx";
import { cota } from "../fmt.ts";
import type { ControladorDibujo, Instantanea } from "./controlador.ts";

type Herramienta = Exclude<NombreHerramienta, "elegir">;
const TITULO: Record<Herramienta, string> = { ejes: "Ejes", pilar: "Pilar", viga: "Viga" };
const ICONO = { ejes: IcEjes, pilar: IcPilar, viga: IcViga } as const;
const TABLA: Record<Herramienta, NombreTabla> = { ejes: "ejes", pilar: "pilares", viga: "vigas" };

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

const ALINEAR: { v: Alinear; texto: string; ayuda: string }[] = [
  { v: "eje", texto: "Eje", ayuda: "Eje a eje, por el punto fijo de los pilares." },
  { v: "izquierda", texto: "Cara izq.", ayuda: "Cada tramo que nace o acaba en un pilar va con su cara izquierda (según el sentido del dibujo) en la del pilar." },
  { v: "derecha", texto: "Cara der.", ayuda: "Cada tramo que nace o acaba en un pilar va con su cara derecha (según el sentido del dibujo) en la del pilar." },
];

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
  const Icono = ICONO[h];
  const cotas = cotasPlantas(m.plantas);
  const opcionesPlantas = m.plantas.map((p, i) => (
    <option key={p.id} value={p.id}>
      {`${p.id} · ${cota(cotas[i])}`}
    </option>
  ));
  const pl = planta ? plantasPilar(m, planta, t.pilar) : null;
  const propuesta = h === "ejes" ? operacionProponerEjes(m) : null;
  const ponerPilar = (c: Partial<Plantillas["pilar"]>) => setPlantillas({ ...t, pilar: { ...t.pilar, ...c } });
  const seccionPilar = m.secciones.find((s) => s.id === t.pilar.seccion);
  // GE3: «Nuevas plantas…» al final de «desde» y «hasta»; añadirlas es un paso de deshacer
  const elegirPlanta = (campo: "desde" | "hasta", v: string) => {
    if (!esDelGestor(v)) return ponerPilar({ [campo]: v || undefined });
    const actual = t.pilar[campo] ?? (campo === "hasta" ? planta : m.plantas.at(-1)?.id) ?? undefined;
    abrirGestor({
      coleccion: "plantas",
      ...(v === EDITAR && actual ? { id: actual } : { nueva: true }),
      ...(actual ? { planta: actual } : {}),
      para: `«${campo}» de la plantilla de Pilar`,
      alElegir: (id, crear) => {
        if (crear.length) {
          const e = editar(comoUna(crear), `Plantas nuevas (${id}…)`);
          if (e) return e;
        }
        ponerPilar({ [campo]: id });
        return null;
      },
    });
  };
  return (
    <div role="region" aria-label={`Dibujar · ${TITULO[h]}`}>
      <Cabecera icono={Icono} tipo={`Dibujar${planta ? ` en ${planta}` : ""}`} titulo={TITULO[h]}>
        <button type="button" className="btn" title={`Abrir la tabla de ${TABLA[h]}`} onClick={() => abrirTabla(TABLA[h])}>
          <Table2 size={14} />
          Tabla
        </button>
      </Cabecera>
      {!foto.error && foto.hecho && (
        <p className="dib-hecho" role="status">
          <Check size={14} />
          <span className="min-w-0 flex-1 truncate">{foto.hecho}</span>
          <span className="dib-tecla">Ctrl+Z</span>
        </p>
      )}

      {h === "pilar" && (
        <Seccion titulo="Plantilla" valor="para los siguientes">
          <div className="py-1">
            <label className="campo">
              <span>desde</span>
              <select className="sel" value={t.pilar.desde ?? ""} aria-label="Planta de la base" onChange={(x) => elegirPlanta("desde", x.target.value)}>
                <option value="">{`${m.plantas.at(-1)?.id ?? "—"} · la más baja`}</option>
                {opcionesPlantas}
                <OpcionesGestor coleccion="plantas" valor={t.pilar.desde ?? ""} />
              </select>
            </label>
            <label className="campo">
              <span>hasta</span>
              <select className="sel" value={t.pilar.hasta ?? ""} aria-label="Planta de la cabeza" data-error={!!pl && !pl.ok} onChange={(x) => elegirPlanta("hasta", x.target.value)}>
                <option value="">{`${planta ?? "—"} · la de la vista`}</option>
                {opcionesPlantas}
                <OpcionesGestor coleccion="plantas" valor={t.pilar.hasta ?? ""} />
              </select>
              {pl && !pl.ok && <p className="error">{pl.mensaje}</p>}
            </label>
            <CampoSeccion modelo={m} valor={t.pilar.seccion} tipo="P" editar={editar} onCambio={(s) => ponerPilar({ seccion: s })} />
            <NumeroCampo etiqueta="giro" unidad="°" valor={t.pilar.giro} onCambio={(g) => ponerPilar({ giro: g })} ayuda="Del canto h, desde +X y en sentido antihorario." />
            <div className="campo" style={{ alignItems: "start" }}>
              <span className="pt-1.5">punto fijo</span>
              <div>
                <SelectorPuntoFijo seccion={seccionPilar} giro={t.pilar.giro ?? 0} valor={t.pilar.fijo ?? "centro"} onCambio={(f) => ponerPilar({ fijo: f === "centro" ? undefined : f })} />
              </div>
              <p>
                <span className="text-text-secondary">{FIJO[t.pilar.fijo ?? "centro"]}</span>: el punto de la sección que va donde se hace clic, en todas las plantas.
              </p>
            </div>
          </div>
        </Seccion>
      )}

      {h === "viga" && (
        <Seccion titulo="Plantilla" valor="para las siguientes">
          <div className="py-1">
            <CampoSeccion modelo={m} valor={t.viga.seccion} tipo="V" editar={editar} onCambio={(s) => setPlantillas({ ...t, viga: { ...t.viga, seccion: s } })} />
            <div className="campo">
              <span>alinear</span>
              <div className="seg dib-seg" role="radiogroup" aria-label="Alinear">
                {ALINEAR.map((a) => (
                  <button key={a.v} type="button" role="radio" aria-checked={(t.viga.alinear ?? "eje") === a.v} data-on={(t.viga.alinear ?? "eje") === a.v} onClick={() => setPlantillas({ ...t, viga: { ...t.viga, alinear: a.v } })}>
                    {a.texto}
                  </button>
                ))}
              </div>
              <p>{ALINEAR.find((a) => a.v === (t.viga.alinear ?? "eje"))!.ayuda}</p>
            </div>
          </div>
        </Seccion>
      )}

      {h === "ejes" && (
        <Seccion titulo="Ejes de replanteo" valor={m.ejes?.length ? `${m.ejes.length}` : undefined}>
          <p className="nota">Dos clics por eje. Sin ejes en el proyecto, los que se ven salen de las alineaciones de los pilares: «Proponer ejes» los guarda.</p>
          <div className="px-3.5 pb-3">
            <button type="button" className="btn" disabled={!propuesta} title={propuesta ? "Guarda en el proyecto los ejes que se ven, propuestos por las alineaciones de los pilares" : "Sólo sin ejes en el proyecto y con pilares alineados"} onClick={() => propuesta && editar(propuesta.operacion, propuesta.etiqueta)}>
              Proponer ejes
            </button>
          </div>
        </Seccion>
      )}

      <Seccion titulo="Enganches" valor={`${foto.activos.size} de ${TIPOS_ENGANCHE.length}`}>
        <label className="chk dib-orto">
          <input type="checkbox" checked={foto.orto} onChange={() => ctrl.alternarOrto()} />
          <span className="flex-1">
            Ortogonal <small>(Mayús, también a 45°)</small>
          </span>
          <span className="dib-tecla">F8</span>
        </label>
        <div className="dib-fichas" role="group" aria-label="Enganches">
          {TIPOS_ENGANCHE.map((x) => (
            <button
              key={x}
              type="button"
              aria-pressed={foto.activos.has(x)}
              onClick={() => {
                const n = new Set(foto.activos);
                if (n.has(x)) n.delete(x);
                else n.add(x);
                ctrl.ponerActivos(n);
              }}
            >
              {NOMBRE_ENGANCHE[x]}
            </button>
          ))}
        </div>
      </Seccion>

      <Seccion titulo="Teclado">
        <dl className="dib-teclado">
          {h === "pilar" && (
            <>
              <dt>Tab, L</dt>
              <dd>fija una cota temporal a L de su eje o pilar</dd>
            </>
          )}
          <dt>x; y</dt>
          <dd>absolutas</dd>
          <dt>@dx; dy</dt>
          <dd>relativas al último punto</dd>
          <dt>@L&lt;α</dt>
          <dd>longitud y ángulo desde el eje 1 de la losa</dd>
          <dt>L</dt>
          <dd>longitud hacia el cursor</dd>
        </dl>
        <p className="dib-teclas">
          <span className="dib-tecla">Intro</span> acepta <span className="dib-tecla">Esc</span> anula <span className="dib-tecla">Retroceso</span> quita el último punto
        </p>
      </Seccion>
    </div>
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
      <span>{etiqueta}</span>
      <span className="dib-unidad" data-unidad={unidad}>
        <input value={mostrado} placeholder="0" data-error={mal} aria-label={etiqueta} aria-invalid={mal} onChange={(x) => setTexto(x.target.value)} onBlur={escribir} onKeyDown={(x) => x.key === "Enter" && escribir()} />
      </span>
      {mal ? <p className="error">Un número</p> : ayuda ? <p className="ayuda">{ayuda}</p> : null}
    </label>
  );
}

/**
 * La sección de la plantilla: el desplegable (con lo que es cada una, y «Nueva…» y «Editar…» al
 * final), un «+» que abre el gestor de secciones en «Nueva» (GE) y lo que es la elegida. Sin
 * secciones en el proyecto, sólo crearla. Crear una sección es un paso de deshacer; la plantilla no
 * es del modelo, así que elegirla no lo es.
 */
function CampoSeccion({ modelo: m, valor, tipo, editar, onCambio }: { modelo: ModeloFisico; valor: string | undefined; tipo: "P" | "V"; editar: Props["editar"]; onCambio: (s: string) => void }) {
  const ninguna = !m.secciones.length;
  const abrir = (eleccion: string) =>
    abrirGestor({
      coleccion: "secciones",
      ...(eleccion === EDITAR && valor ? { id: valor } : { nueva: true }),
      uso: tipo === "P" ? "pilar" : "viga",
      para: `la plantilla de ${tipo === "P" ? "Pilar" : "Viga"}`,
      alElegir: (id, crear) => {
        if (crear.length) {
          const e = editar(comoUna(crear), `Sección ${id}`);
          if (e) return e;
        }
        onCambio(id);
        return null;
      },
    });
  const elegida = m.secciones.find((s) => s.id === valor);
  return (
    <div className="campo">
      <span>sección</span>
      {ninguna ? (
        <button type="button" className="btn btn-p" onClick={() => abrir(NUEVA)}>
          <Plus size={14} />
          Nueva sección…
        </button>
      ) : (
        <div className="flex min-w-0 gap-1">
          <select className="sel min-w-0 flex-1" value={valor ?? ""} aria-label="Sección" onChange={(x) => (esDelGestor(x.target.value) ? abrir(x.target.value) : onCambio(x.target.value))}>
            {!valor && <option value="">(ninguna)</option>}
            {m.secciones.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id}
              </option>
            ))}
            <OpcionesGestor coleccion="secciones" valor={valor ?? ""} />
          </select>
          <button type="button" className="ib dib-mas" aria-label="Nueva sección" title="Nueva sección: rectangular, circular, en T, perfil de catálogo o general" onClick={() => abrir(NUEVA)}>
            <Plus size={15} />
          </button>
        </div>
      )}
      <p>{ninguna ? "Ninguna en el proyecto: créela con su tipo y medidas." : elegida ? describirSeccion(elegida) : ""}</p>
    </div>
  );
}

/**
 * El punto fijo sobre un dibujo de la sección, girada como en la planta: los nueve puntos, como
 * botones de radio (las flechas mueven el punto en los ejes de la sección).
 */
function SelectorPuntoFijo({ seccion, giro, valor, onCambio }: { seccion: SeccionFisica | undefined; giro: number; valor: PuntoFijo; onCambio: (f: PuntoFijo) => void }) {
  const med = medidasSeccion(seccion) ?? { h: 1, b: 1 };
  const circular = seccion?.forma === "circular";
  // Escala para que la huella girada quepa en la caja; ningún lado por debajo de 30 px
  const r = (giro * Math.PI) / 180;
  const [c, s] = [Math.abs(Math.cos(r)), Math.abs(Math.sin(r))];
  const k = Math.min(132 / (med.h * c + med.b * s), 80 / (med.h * s + med.b * c));
  const [w, alto] = [Math.max(40, med.h * k), Math.max(40, med.b * k)];
  const [u0, v0] = SIGNOS_PUNTO_FIJO[valor];
  const buscar = (u: number, v: number) => (Object.keys(SIGNOS_PUNTO_FIJO) as PuntoFijo[]).find((f) => SIGNOS_PUNTO_FIJO[f][0] === u && SIGNOS_PUNTO_FIJO[f][1] === v)!;
  const tecla = (x: KeyboardEvent) => {
    const d: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    const m = d[x.key];
    if (!m) return;
    x.preventDefault();
    const f = buscar(Math.max(-1, Math.min(1, u0 + m[0])), Math.max(-1, Math.min(1, v0 + m[1])));
    onCambio(f);
    (x.currentTarget.querySelector(`[data-fijo="${f}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <div className="dib-pf" role="radiogroup" aria-label="Punto fijo" onKeyDown={tecla}>
      <div className="dib-pf-sec" data-circular={circular} style={{ width: w, height: alto, transform: `rotate(${-giro}deg)` }}>
        {(Object.keys(SIGNOS_PUNTO_FIJO) as PuntoFijo[]).map((f) => {
          const [u, v] = SIGNOS_PUNTO_FIJO[f];
          return (
            <button
              key={f}
              type="button"
              role="radio"
              data-fijo={f}
              aria-checked={f === valor}
              aria-label={FIJO[f]}
              title={FIJO[f]}
              tabIndex={f === valor ? 0 : -1}
              style={{ left: `${((u + 1) / 2) * 100}%`, top: `${((1 - v) / 2) * 100}%` }}
              onClick={() => onCambio(f)}
            />
          );
        })}
      </div>
    </div>
  );
}

/** El campo de lo que se teclea, junto al cursor. */
export function CampoTeclado({ ctrl, campo }: { ctrl: ControladorDibujo; campo: NonNullable<Instantanea["campo"]> }) {
  const [texto, setTexto] = useState(campo.texto);
  return (
    <div className="campo-teclado" style={{ left: campo.x + 16, top: campo.seleccionar ? campo.y - 72 : campo.y + 16 }} role="dialog" aria-label="Punto por teclado">
      <input
        className="sel mono"
        autoFocus
        aria-label={campo.cota ? `Distancia de la cota ${campo.cota}` : "Punto: x; y, @dx; dy, @L<ángulo o longitud"}
        placeholder={campo.cota ? "distancia, m" : undefined}
        value={texto}
        onChange={(x) => setTexto(x.target.value)}
        onFocus={(x) => campo.seleccionar && x.target.select()}
        onBlur={() => ctrl.cerrarCampo()}
        onKeyDown={(x) => {
          x.stopPropagation();
          if (x.key === "Enter") ctrl.teclear(texto);
          else if (x.key === "Escape") ctrl.escCampo();
          else if (x.key === "Tab" && ctrl.tab(x.shiftKey)) x.preventDefault();
          // CT2: el otro lado de la cota que se estira
          else if ((x.key === "ArrowLeft" || x.key === "ArrowRight") && ctrl.cambiarLado()) x.preventDefault();
        }}
      />
      {campo.cota && <p className="campo-cota">Cota {campo.cota}</p>}
      {campo.error && <p className="error">{campo.error}</p>}
    </div>
  );
}
