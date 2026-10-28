/**
 * Lo que va en Propiedades mientras una herramienta de dibujo está activa (V2c-1, V2c-2 y V2c-3,
 * `dibujo.md` §2.1 y §9): su plantilla (lo que en CYPECAD pide el diálogo antes de colocar, pero sin diálogo: vale
 * para los siguientes), los enganches por fuente y por tipo y el ortogonal. Y el campo de teclado junto al cursor
 * (§2.3). Lo que la plantilla no dice se toma de lo último del mismo tipo en el proyecto (o de lo
 * típico: losa de 25 cm, reticular 25+5, muro de 25 cm); los valores de las cargas, nunca.
 *
 * La ayuda de la herramienta y su error van en el aviso del lienzo, no aquí: el panel es la plantilla.
 */
import { Check, Copy, FileImage, FlipHorizontal2, Move, Plus, RotateCw, Table2 } from "lucide-react";
import { Fragment, useState, type KeyboardEvent, type ReactNode } from "react";
import { comoUna, describirSeccion, type UsoSeccion } from "../../../src/editor/gestores.ts";
import { cotasPlantas } from "../../../src/compilador/cotas.ts";
import type { ModeloFisico, PuntoFijo, Seccion as SeccionFisica } from "../../../src/compilador/fisico.ts";
import type { Seis, Vec3 } from "../../../src/motor/modelo.ts";
import { medidasSeccion, SIGNOS_PUNTO_FIJO } from "../../../src/compilador/puntoFijo.ts";
import { operacionProponerEjes, plantasPilar, type Alinear, type NombreHerramienta, type Plantillas } from "../../../src/editor/dibujo/herramientas.ts";
import { ANCHO_ZUNCHO, COARTADOS, HUECO_MURO, pesoPlantillaForjado, type PlantillaForjado } from "../../../src/editor/dibujo/piezas.ts";
import { BOVEDILLA_POR_DEFECTO, BOVEDILLAS, CASETON_POR_DEFECTO, CASETONES, type Bovedilla, type Caseton } from "../../../src/compilador/pesoForjado.ts";
import type { PlantillaCargas } from "../../../src/editor/dibujo/cargas.ts";
import type { Operacion } from "../../../src/editor/operaciones.ts";
import { TEXTO_BOVEDILLA, TEXTO_CASETON, TIPOS_FORJADO, type NombreTabla, type TipoForjado } from "../../../src/editor/tablas.ts";
import { esEditar, type NombreEditar, type PlantillaEditar } from "../../../src/editor/dibujo/editar.ts";
import { esPlantillaDxf, type NombrePlantillaDxf } from "../../../src/editor/dibujo/herramientaPlantilla.ts";
import { IcApoyo, IcApoyoLineal, IcEjes, IcEmpuje, IcEnBarra, IcHueco, IcLineal, IcLosa, IcMuro, IcPilar, IcPuntual, IcSuperficie, IcViga, type Icono } from "../armazon/iconos.tsx";
import { Ayuda } from "../componentes/Ayuda.tsx";
import { Cabecera, Seccion } from "../componentes/comunes.tsx";
import { abrirGestor, EDITAR, esDelGestor, NUEVA, OpcionesGestor } from "../editor/referencia.tsx";
import { cota } from "../fmt.ts";
import type { ControladorDibujo, Instantanea } from "./controlador.ts";

/** V2c-3: los iconos de editar, de lucide. */
export const IcMover: Icono = ({ size }) => <Move size={size} strokeWidth={1.5} aria-hidden="true" />;
export const IcCopiar: Icono = ({ size }) => <Copy size={size} strokeWidth={1.5} aria-hidden="true" />;
export const IcGirar: Icono = ({ size }) => <RotateCw size={size} strokeWidth={1.5} aria-hidden="true" />;
export const IcSimetria: Icono = ({ size }) => <FlipHorizontal2 size={size} strokeWidth={1.5} aria-hidden="true" />;
/** V2c-4: la plantilla DXF. */
export const IcPlantillaDxf: Icono = ({ size }) => <FileImage size={size} strokeWidth={1.5} aria-hidden="true" />;

type Herramienta = Exclude<NombreHerramienta, "elegir" | NombreEditar | NombrePlantillaDxf>;
const TITULO: Record<Herramienta, string> = {
  ejes: "Ejes",
  pilar: "Pilar",
  viga: "Viga",
  forjado: "Forjado",
  hueco: "Hueco",
  muro: "Muro",
  apoyo: "Apoyo",
  apoyoLineal: "Apoyo lineal",
  puntual: "Carga puntual",
  lineal: "Carga lineal",
  superficie: "Carga de superficie",
  barra: "Carga en barra",
  empuje: "Empuje",
};
const ICONO = { ejes: IcEjes, pilar: IcPilar, viga: IcViga, forjado: IcLosa, hueco: IcHueco, muro: IcMuro, apoyo: IcApoyo, apoyoLineal: IcApoyoLineal, puntual: IcPuntual, lineal: IcLineal, superficie: IcSuperficie, barra: IcEnBarra, empuje: IcEmpuje } as const;
const TABLA: Record<Herramienta, NombreTabla> = {
  ejes: "ejes",
  pilar: "pilares",
  viga: "vigas",
  forjado: "forjados",
  hueco: "forjados",
  muro: "muros",
  apoyo: "apoyos",
  apoyoLineal: "apoyosLineales",
  puntual: "cargas",
  lineal: "cargas",
  superficie: "cargas",
  barra: "cargas",
  empuje: "cargas",
};

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

/** El material de por defecto: el más usado por los objetos de esa lista; si no, el primero de hormigón; si no, el primero. */
function materialPorDefecto(m: ModeloFisico, xs: readonly { material: string }[]): string | undefined {
  const n = new Map<string, number>();
  for (const o of xs) n.set(o.material, (n.get(o.material) ?? 0) + 1);
  let mejor: string | undefined;
  for (const [s, k] of n) if (m.materiales.some((x) => x.id === s) && (!mejor || k > n.get(mejor)!)) mejor = s;
  return mejor ?? m.materiales.find((x) => x.tipo === "hormigon")?.id ?? m.materiales[0]?.id;
}

/**
 * La plantilla de Forjado con lo que no dice tomado del último forjado de su tipo (o de lo típico). El
 * pp no se hereda: sin él, sale de la sección y del casetón o la bovedilla (`pesoForjado.ts`).
 */
function forjadoEfectivo(m: ModeloFisico, t: PlantillaForjado): PlantillaForjado {
  const tipo = t.tipo ?? "maciza";
  const valida = (s: string | undefined) => (s && m.secciones.some((x) => x.id === s) ? s : undefined);
  const materialValido = (s: string | undefined) => (s && m.materiales.some((x) => x.id === s) ? s : undefined);
  if (tipo === "unidireccional") {
    const u = m.panos?.at(-1);
    return { ...t, tipo, intereje: t.intereje ?? u?.intereje ?? 0.7, seccion: valida(t.seccion) ?? valida(u?.seccion) ?? m.secciones.find((s) => s.forma === "T")?.id, bovedilla: t.bovedilla ?? u?.bovedilla, direccion: t.direccion ?? u?.direccion };
  }
  const losas = (m.losas ?? []).filter((l) => !!l.reticular === (tipo === "reticular"));
  const u = losas.at(-1);
  const material = materialValido(t.material) ?? materialValido(u?.material) ?? materialPorDefecto(m, m.losas ?? []);
  if (tipo === "maciza") return { ...t, tipo, espesor: t.espesor ?? u?.espesor ?? 0.25, material };
  const r = u?.reticular;
  return { ...t, tipo, espesor: t.espesor ?? u?.espesor ?? 0.3, material, intereje: t.intereje ?? r?.intereje ?? 0.8, nervio: t.nervio ?? r?.nervio ?? 0.12, capa: t.capa ?? r?.capa ?? 0.05, caseton: t.caseton ?? r?.caseton };
}

/** La plantilla con lo de por defecto donde no hay nada válido; `caso`, el activo de la barra de Cargas. */
export function plantillasEfectivas(m: ModeloFisico | null, t: Plantillas, caso?: string): Plantillas {
  if (!m) return t;
  const valida = (s: string | undefined) => (s && m.secciones.some((x) => x.id === s) ? s : undefined);
  const muro = m.muros?.at(-1);
  const materialMuro = t.muro?.material && m.materiales.some((x) => x.id === t.muro!.material) ? t.muro.material : materialPorDefecto(m, m.muros ?? []);
  return {
    ...t,
    pilar: { ...t.pilar, seccion: valida(t.pilar.seccion) ?? seccionPorDefecto(m, "pilares") },
    viga: { ...t.viga, seccion: valida(t.viga.seccion) ?? seccionPorDefecto(m, "vigas") },
    forjado: forjadoEfectivo(m, t.forjado ?? {}),
    hueco: { ...t.hueco, z0: t.hueco?.z0 ?? HUECO_MURO.z0, z1: t.hueco?.z1 ?? HUECO_MURO.z1 },
    muro: { ...t.muro, espesor: t.muro?.espesor ?? muro?.espesor ?? 0.25, material: materialMuro },
    apoyo: { coartados: t.apoyo?.coartados ?? COARTADOS.empotrado },
    apoyoLineal: { coartados: t.apoyoLineal?.coartados ?? COARTADOS.uz },
    cargas: { ...t.cargas, ...(caso ? { caso } : {}) },
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
  if (esEditar(h)) return <PlantillaEditarPanel h={h} foto={foto} ctrl={ctrl} modelo={m} planta={planta} t={t.editar ?? {}} poner={(c) => setPlantillas({ ...t, editar: { ...t.editar, ...c } })} />;
  if (esPlantillaDxf(h))
    return (
      <div role="region" aria-label={`Dibujar · ${h === "colocarPlantilla" ? "Colocar" : "Girar"} la plantilla`}>
        <Cabecera icono={IcPlantillaDxf} tipo={`${h === "colocarPlantilla" ? "Colocar" : "Girar"} la plantilla DXF${planta ? ` en ${planta}` : ""}`} titulo={t.dxf?.nombre ?? "—"} />
        <p className="nota">{foto.ayuda} Lo que se mueve es la plantilla, no el modelo; su traslación y su giro, también en el navegador.</p>
      </div>
    );
  const Icono = ICONO[h];
  const cotas = cotasPlantas(m.plantas);
  const opcionesPlantas = m.plantas.map((p, i) => (
    <option key={p.id} value={p.id}>
      {`${p.id} · ${cota(cotas[i])}`}
    </option>
  ));
  const pl = planta ? plantasPilar(m, planta, t.pilar) : null;
  const plMuro = planta && h === "muro" ? plantasPilar(m, planta, t.muro ?? {}, "del muro") : null;
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

      {h === "forjado" && <PlantillaForjadoPanel modelo={m} t={t.forjado ?? {}} poner={(c, limpiar) => setPlantillas({ ...t, forjado: limpiar ? c : { ...t.forjado, ...c } })} editar={editar} />}

      {h === "hueco" && (
        <Seccion titulo="Plantilla" valor="para los siguientes">
          <div className="py-1">
            <Segmentado
              etiqueta="en un forjado"
              valor={t.hueco?.modo ?? "rectangulo"}
              opciones={[
                ["rectangulo", "Rectángulo"],
                ["poligono", "Polígono"],
              ]}
              onCambio={(modo) => setPlantillas({ ...t, hueco: { ...t.hueco, modo } })}
              ayuda={(t.hueco?.modo ?? "rectangulo") === "rectangulo" ? "Dos esquinas opuestas, en los ejes del ortogonal." : "Clic a clic; Intro o un clic en el primero lo cierra."}
            />
            <NumeroCampo etiqueta="z0" unidad="m" valor={t.hueco?.z0} onCambio={(z0) => setPlantillas({ ...t, hueco: { ...t.hueco, z0 } })} ayuda="En un muro: la altura del borde de abajo sobre el suelo de la planta de abajo." />
            <NumeroCampo etiqueta="z1" unidad="m" valor={t.hueco?.z1} onCambio={(z1) => setPlantillas({ ...t, hueco: { ...t.hueco, z1 } })} ayuda="En un muro: la del borde de arriba." />
            <CampoZunchos t={t.hueco ?? {}} poner={(c) => setPlantillas({ ...t, hueco: { ...t.hueco, ...c } })} ayuda="En una losa: un zuncho en cada lado del hueco que no va sobre una viga o un muro, con la losa hasta su eje y la carga de la banda en él." />
            <p className="nota">El primer clic dice dónde va: dentro de un forjado o encima de un muro (dos clics por su eje, en un tramo).</p>
          </div>
        </Seccion>
      )}

      {h === "muro" && (
        <Seccion titulo="Plantilla" valor="para los siguientes">
          <div className="py-1">
            <label className="campo">
              <span>desde</span>
              <select className="sel" value={t.muro?.desde ?? ""} aria-label="Planta de la base" onChange={(x) => setPlantillas({ ...t, muro: { ...t.muro, desde: x.target.value || undefined } })}>
                <option value="">{`${m.plantas.at(-1)?.id ?? "—"} · la más baja`}</option>
                {opcionesPlantas}
              </select>
            </label>
            <label className="campo">
              <span>hasta</span>
              <select className="sel" value={t.muro?.hasta ?? ""} aria-label="Planta de la cabeza" data-error={!!plMuro && !plMuro.ok} onChange={(x) => setPlantillas({ ...t, muro: { ...t.muro, hasta: x.target.value || undefined } })}>
                <option value="">{`${planta ?? "—"} · la de la vista`}</option>
                {opcionesPlantas}
              </select>
              {plMuro && !plMuro.ok && <p className="error">{plMuro.mensaje}</p>}
            </label>
            <NumeroCampo etiqueta="espesor" unidad="m" valor={t.muro?.espesor} onCambio={(espesor) => setPlantillas({ ...t, muro: { ...t.muro, espesor } })} />
            <CampoMaterial modelo={m} valor={t.muro?.material} para="la plantilla de Muro" editar={editar} onCambio={(material) => setPlantillas({ ...t, muro: { ...t.muro, material } })} />
            <label className="campo">
              <span>base</span>
              <select className="sel" value={t.muro?.base ?? "empotrado"} aria-label="Base" onChange={(x) => setPlantillas({ ...t, muro: { ...t.muro, base: x.target.value as "empotrado" } })}>
                <option value="empotrado">empotrado</option>
                <option value="articulado">articulado</option>
                <option value="ninguno">ninguno (nace sobre otra pieza)</option>
              </select>
            </label>
            <Segmentado
              etiqueta="lo dibujado"
              valor={t.muro?.alinear ?? "eje"}
              opciones={[
                ["eje", "Eje"],
                ["izquierda", "Cara izq."],
                ["derecha", "Cara der."],
              ]}
              onCambio={(alinear) => setPlantillas({ ...t, muro: { ...t.muro, alinear } })}
              ayuda={(t.muro?.alinear ?? "eje") === "eje" ? "El eje del muro." : `Su cara ${t.muro?.alinear === "izquierda" ? "izquierda" : "derecha"} según el sentido del dibujo: el eje va medio espesor más allá.`}
            />
          </div>
        </Seccion>
      )}

      {(h === "apoyo" || h === "apoyoLineal") && (
        <Seccion titulo="Plantilla" valor="para los siguientes">
          <div className="py-1">
            <CampoCoartados valor={t[h]?.coartados ?? (h === "apoyo" ? COARTADOS.empotrado : COARTADOS.uz)} onCambio={(coartados) => setPlantillas({ ...t, [h]: { coartados } })} />
          </div>
        </Seccion>
      )}

      {CARGA_HERR.has(h) && <PlantillaCargaPanel h={h as NombreCargaH} t={t.cargas ?? {}} poner={(c) => setPlantillas({ ...t, cargas: { ...t.cargas, ...c } })} />}

    </div>
  );
}

const EDITAR_TITULO: Record<NombreEditar, string> = { mover: "Mover", copiar: "Copiar", girar: "Girar", simetria: "Simetría" };
const EDITAR_ICONO: Record<NombreEditar, Icono> = { mover: IcMover, copiar: IcCopiar, girar: IcGirar, simetria: IcSimetria };

/** V2c-3: Mover, Copiar, Girar y Simetría: lo elegido, las vigas de los pilares, conservar lo original y las plantas de las copias. */
function PlantillaEditarPanel({ h, foto, ctrl, modelo: m, planta, t, poner }: { h: NombreEditar; foto: Instantanea; ctrl: ControladorDibujo; modelo: ModeloFisico; planta: string | null; t: PlantillaEditar; poner: (c: PlantillaEditar) => void }) {
  const Icono = EDITAR_ICONO[h];
  const elegidos = foto.transformando;
  const cotas = cotasPlantas(m.plantas);
  const plantas = new Set(t.plantas ?? []);
  return (
    <div role="region" aria-label={`Editar · ${EDITAR_TITULO[h]}`}>
      <Cabecera icono={Icono} tipo={`Editar${planta ? ` en ${planta}` : ""}`} titulo={EDITAR_TITULO[h]} />
      {!foto.error && foto.hecho && (
        <p className="dib-hecho" role="status">
          <Check size={14} />
          <span className="min-w-0 flex-1 truncate">{foto.hecho}</span>
          <span className="dib-tecla">Ctrl+Z</span>
        </p>
      )}
      <Seccion titulo="Lo elegido" valor={elegidos ? elegidos.length : undefined}>
        {elegidos ? (
          <div className="fichas ids">
            {elegidos.slice(0, 40).map((id) => (
              <span key={id}>{id}</span>
            ))}
            {elegidos.length > 40 && <span>… y {elegidos.length - 40} más</span>}
          </div>
        ) : (
          <p className="nota">Nada aún: elija en la vista (clic o ventana; con Ctrl+clic, varios e Intro).</p>
        )}
      </Seccion>
      <Seccion titulo="Opciones" valor="para las siguientes">
        <div className="py-1">
          {h === "simetria" && (
            <label className="chk">
              <input type="checkbox" checked={!!t.conservar} onChange={(x) => poner({ conservar: x.target.checked })} />
              <span>Conservar lo original (la simetría es una copia)</span>
            </label>
          )}
          {h !== "copiar" && !(h === "simetria" && t.conservar) && (
            <label className="chk">
              <input type="checkbox" checked={t.conVigas !== false} onChange={(x) => poner({ conVigas: x.target.checked })} />
              <span>Las vigas siguen a los pilares</span>
            </label>
          )}
          {h !== "copiar" && !(h === "simetria" && t.conservar) && <p className="nota">Las vigas no elegidas que acaban en el punto fijo de un pilar que se mueve lo siguen. Con Ctrl en el último clic, no.</p>}
          {h === "copiar" && (
            <>
              <div className="campo" style={{ alignItems: "start" }}>
                <span className="pt-1">plantas</span>
                <div role="group" aria-label="Plantas de las copias">
                  {m.plantas.map((p, i) => (
                    <label key={p.id} className="chk">
                      <input
                        type="checkbox"
                        checked={plantas.has(p.id)}
                        onChange={(x) => {
                          const n = new Set(plantas);
                          if (x.target.checked) n.add(p.id);
                          else n.delete(p.id);
                          poner({ plantas: m.plantas.map((q) => q.id).filter((q) => n.has(q)) });
                        }}
                      />
                      <span>{`${p.id} · ${cota(cotas[i])}`}</span>
                    </label>
                  ))}
                </div>
              </div>
              <p className="nota">{plantas.size ? "Lo que es de una planta (vigas, forjados, apoyos y cargas) se copia en las marcadas; pilares, muros y ejes, una vez. Intro sin punto base lo copia en su sitio." : "Sin ninguna marcada, cada copia va en la planta de lo copiado."}</p>
              {plantas.size > 0 && elegidos && (
                <div className="px-3.5 pb-2">
                  <button type="button" className="btn" onClick={() => ctrl.intro()}>
                    Copiar en su sitio
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </Seccion>
    </div>
  );
}

/** Un número de la plantilla; vacío es «el de por defecto» (y 0 también, salvo con `cero`); `falta`, en rojo mientras esté vacío. */
export function NumeroCampo({ etiqueta, unidad, valor, onCambio, ayuda, falta, cero, vacio = "0" }: { etiqueta: string; unidad?: string; valor: number | undefined; onCambio: (v: number | undefined) => void; ayuda?: string; falta?: boolean; cero?: boolean; vacio?: string }) {
  const [texto, setTexto] = useState<string | null>(null);
  const mostrado = texto ?? (valor === undefined ? "" : String(valor).replace(".", ","));
  const v = Number(mostrado.trim().replace(",", "."));
  const mal = mostrado.trim() !== "" && !Number.isFinite(v);
  const escribir = () => {
    if (texto === null) return;
    if (!mal) onCambio(texto.trim() === "" || (v === 0 && !cero) ? undefined : v);
    setTexto(null);
  };
  return (
    <label className="campo">
      <span>
        <span className="campo-nombre">{etiqueta}</span>
        {ayuda && <Ayuda texto={ayuda} />}
      </span>
      <span className="dib-unidad" data-unidad={unidad}>
        <input value={mostrado} placeholder={falta ? "obligatorio" : vacio} data-error={mal || (!!falta && !mostrado.trim())} aria-label={etiqueta} aria-invalid={mal} onChange={(x) => setTexto(x.target.value)} onBlur={escribir} onKeyDown={(x) => x.key === "Enter" && escribir()} />
      </span>
      {mal && <p className="error">Un número</p>}
    </label>
  );
}

/**
 * La sección de la plantilla: el desplegable (con lo que es cada una, y «Nueva…» y «Editar…» al
 * final), un «+» que abre el gestor de secciones en «Nueva» (GE) y lo que es la elegida. Sin
 * secciones en el proyecto, sólo crearla. Crear una sección es un paso de deshacer; la plantilla no
 * es del modelo, así que elegirla no lo es.
 */
function CampoSeccion({ modelo: m, valor, tipo, editar, onCambio, etiqueta = "sección" }: { modelo: ModeloFisico; valor: string | undefined; tipo: "P" | "V" | "vigueta"; editar: Props["editar"]; onCambio: (s: string) => void; etiqueta?: string }) {
  const ninguna = !m.secciones.length;
  const uso: UsoSeccion = tipo === "P" ? "pilar" : tipo === "V" ? "viga" : "vigueta";
  const abrir = (eleccion: string) =>
    abrirGestor({
      coleccion: "secciones",
      ...(eleccion === EDITAR && valor ? { id: valor } : { nueva: true }),
      uso,
      para: `la plantilla de ${tipo === "P" ? "Pilar" : tipo === "V" ? "Viga" : "Forjado"}`,
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
      <span>{etiqueta}</span>
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

/** Unos botones de radio en una fila (el modo de una herramienta, el tipo de un forjado). */
export function Segmentado<T extends string>({ etiqueta, valor, opciones, onCambio, ayuda }: { etiqueta: string; valor: T; opciones: readonly (readonly [T, string])[]; onCambio: (v: T) => void; ayuda?: ReactNode }) {
  return (
    <div className="campo">
      <span>{etiqueta}</span>
      <div className="seg dib-seg" role="radiogroup" aria-label={etiqueta}>
        {opciones.map(([v, texto]) => (
          <button key={v} type="button" role="radio" aria-checked={valor === v} data-on={valor === v} onClick={() => onCambio(v)}>
            {texto}
          </button>
        ))}
      </div>
      {ayuda && <p>{ayuda}</p>}
    </div>
  );
}

/** El material de la plantilla, con «Nuevo material…» y «Editar…» (GE). */
function CampoMaterial({ modelo: m, valor, para, editar, onCambio }: { modelo: ModeloFisico; valor: string | undefined; para: string; editar: Props["editar"]; onCambio: (s: string) => void }) {
  const abrir = (eleccion: string) =>
    abrirGestor({
      coleccion: "materiales",
      ...(eleccion === EDITAR && valor ? { id: valor } : { nueva: true }),
      familia: "hormigon",
      para,
      alElegir: (id, crear) => {
        if (crear.length) {
          const e = editar(comoUna(crear), `Material ${id}`);
          if (e) return e;
        }
        onCambio(id);
        return null;
      },
    });
  return (
    <label className="campo">
      <span>material</span>
      <select className="sel" value={valor ?? ""} aria-label="Material" data-error={!valor} onChange={(x) => (esDelGestor(x.target.value) ? abrir(x.target.value) : onCambio(x.target.value))}>
        {!valor && <option value="">(ninguno)</option>}
        {m.materiales.map((x) => (
          <option key={x.id} value={x.id}>
            {x.id}
          </option>
        ))}
        <OpcionesGestor coleccion="materiales" valor={valor ?? ""} />
      </select>
    </label>
  );
}

const GDL = ["ux", "uy", "uz", "rx", "ry", "rz"] as const;
const PRESETS: readonly (readonly [keyof typeof COARTADOS, string])[] = [
  ["empotrado", "Empotrado"],
  ["articulado", "Articulado"],
  ["uz", "Sólo uz"],
];

/** Lo que coacciona un apoyo: los tres típicos y los seis GDL uno a uno. */
function CampoCoartados({ valor, onCambio }: { valor: Seis<boolean>; onCambio: (v: Seis<boolean>) => void }) {
  const preset = PRESETS.find(([k]) => COARTADOS[k].every((x, i) => x === valor[i]))?.[0];
  return (
    <>
      <Segmentado etiqueta="coacciona" valor={preset ?? ("" as keyof typeof COARTADOS)} opciones={PRESETS} onCambio={(k) => onCambio(COARTADOS[k])} />
      <div className="campo">
        <span>GDL</span>
        <div className="dib-gdl" role="group" aria-label="GDL coartados">
          {GDL.map((g, i) => (
            <button key={g} type="button" aria-pressed={valor[i]} onClick={() => onCambio(valor.map((x, j) => (j === i ? !x : x)) as unknown as Seis<boolean>)}>
              {g}
            </button>
          ))}
        </div>
        <p>En ejes globales; los marcados no se mueven.</p>
      </div>
    </>
  );
}

type DirCarga = "abajo" | "x" | "y" | "xyz";
const DIRS_CARGA: readonly (readonly [DirCarga, string])[] = [
  ["abajo", "↓ Gravedad"],
  ["x", "X"],
  ["y", "Y"],
  ["xyz", "x, y, z"],
];
/** La dirección de un vector de carga: la de un eje si sólo tiene esa componente. */
const direccionDe = (v: Vec3 | undefined): DirCarga | null => (!v ? null : v[0] === 0 && v[1] === 0 ? "abajo" : v[1] === 0 && v[2] === 0 ? "x" : v[0] === 0 && v[2] === 0 ? "y" : "xyz");
/** El valor según una dirección (hacia abajo, en positivo). */
const valorSegun = (v: Vec3 | undefined, d: Exclude<DirCarga, "xyz">): number | undefined => (v === undefined ? undefined : d === "abajo" ? (v[2] === 0 ? 0 : -v[2]) : d === "x" ? v[0] : v[1]);
const vectorSegun = (m: number | undefined, d: Exclude<DirCarga, "xyz">): Vec3 | undefined => (!m ? undefined : d === "abajo" ? [0, 0, -m] : d === "x" ? [m, 0, 0] : [0, m, 0]);
const conComponente = (v: Vec3 | undefined, i: number, c: number | undefined): Vec3 | undefined => {
  const n = [...(v ?? [0, 0, 0])] as [number, number, number];
  n[i] = c ?? 0;
  return n.every((x) => x === 0) ? undefined : n;
};

/**
 * El valor de una carga: la dirección (hacia abajo por defecto, X, Y o las tres componentes) y un
 * solo número; hacia abajo va en positivo y se guarda con z < 0. Con `componentes`, sólo las tres
 * (el momento, o una carga en ejes locales). `final`, el valor al final de una carga variable, en la
 * misma dirección.
 */
export function CampoCarga({
  etiqueta,
  unidad,
  valor,
  onCambio,
  ayuda,
  final,
  componentes,
}: {
  etiqueta: string;
  unidad: string;
  valor: Vec3 | undefined;
  onCambio: (v: Vec3 | undefined) => void;
  ayuda?: string;
  final?: { etiqueta: string; valor: Vec3 | undefined; onCambio: (v: Vec3 | undefined) => void; ayuda: string };
  componentes?: "globales" | "locales";
}) {
  const [elegida, setElegida] = useState<DirCarga>(() => direccionDe(valor) ?? "abajo");
  const derivada = direccionDe(valor);
  const dir: DirCarga = componentes ? "xyz" : elegida === "xyz" || !derivada ? elegida : derivada;
  const cambiarDir = (d: DirCarga) => {
    setElegida(d);
    if (d === "xyz") return;
    // Lo escrito pasa a la dirección nueva: el mismo número (desde las tres, la componente de esa dirección)
    const pasar = (v: Vec3 | undefined) => vectorSegun(dir === "xyz" ? valorSegun(v, d) : valorSegun(v, dir), d);
    onCambio(pasar(valor));
    if (final) final.onCambio(pasar(final.valor));
  };
  const ayudaDir: Record<DirCarga, string> = {
    abajo: `Hacia abajo, en positivo: 2 son 2 ${unidad} de peso. En negativo, hacia arriba.`,
    x: "Horizontal, según +X global; en negativo, hacia −X.",
    y: "Horizontal, según +Y global; en negativo, hacia −Y.",
    xyz: "Las tres componentes en ejes globales; hacia abajo, z < 0.",
  };
  const tres = (et: string, v: Vec3 | undefined, cambio: (v: Vec3 | undefined) => void, ay?: string) =>
    (["x", "y", "z"] as const).map((e, i) => <NumeroCampo key={`${et}${e}`} etiqueta={`${et}${e}`} unidad={unidad} valor={v === undefined ? undefined : v[i]} onCambio={(c) => cambio(conComponente(v, i, c))} ayuda={i === 2 ? ay : undefined} />);
  return (
    <>
      {!componentes && <Segmentado etiqueta="dirección" valor={dir} opciones={DIRS_CARGA} onCambio={cambiarDir} ayuda={ayudaDir[dir]} />}
      {dir === "xyz" ? (
        <>
          {tres(etiqueta, valor, onCambio, componentes === "locales" ? "En los ejes de la pieza: x a lo largo de ella y z según su canto." : ayuda)}
          {final && tres(final.etiqueta, final.valor, final.onCambio, final.ayuda)}
        </>
      ) : (
        <>
          <NumeroCampo etiqueta={etiqueta} unidad={unidad} valor={valorSegun(valor, dir)} onCambio={(m) => onCambio(vectorSegun(m, dir))} ayuda={ayuda} />
          {final && <NumeroCampo etiqueta={final.etiqueta} unidad={unidad} valor={valorSegun(final.valor, dir)} onCambio={(m) => final.onCambio(vectorSegun(m, dir))} ayuda={final.ayuda} />}
        </>
      )}
    </>
  );
}

/** «Con zunchos» y su ancho (Forjado y Hueco; `piezas.ts`). */
function CampoZunchos({ t, poner, ayuda }: { t: { zunchos?: boolean; anchoZuncho?: number }; poner: (c: { zunchos?: boolean; anchoZuncho?: number }) => void; ayuda: string }) {
  const con = t.zunchos !== false;
  return (
    <>
      <label className="chk">
        <input type="checkbox" checked={con} onChange={(x) => poner({ zunchos: x.target.checked })} />
        <span>Con zunchos</span>
      </label>
      {con && <NumeroCampo etiqueta="ancho zuncho" unidad="m" valor={t.anchoZuncho} onCambio={(anchoZuncho) => poner({ anchoZuncho })} vacio={String(ANCHO_ZUNCHO).replace(".", ",")} ayuda={ayuda} />}
    </>
  );
}

const TIPO_FORJADO: Record<TipoForjado, string> = { maciza: "Maciza", reticular: "Reticular", unidireccional: "Unidirecc." };

/** La plantilla de Forjado: el modo (recuadro o polígono), el tipo y lo de cada tipo, como las columnas de la tabla. */
function PlantillaForjadoPanel({ modelo: m, t, poner, editar }: { modelo: ModeloFisico; t: PlantillaForjado; poner: (c: PlantillaForjado, limpiar?: boolean) => void; editar: Props["editar"] }) {
  const tipo = t.tipo ?? "maciza";
  // El pp vacío sale solo; si no puede salir (casetón de otro material, vigueta que no es una T), falta
  const peso = pesoPlantillaForjado(m, t);
  const faltaPp = t.pp === undefined && (tipo === "reticular" ? t.caseton === "perdido" : tipo === "unidireccional" && !!m.secciones.find((x) => x.id === t.seccion) && !peso);
  const vacioPp = peso ? `${String(Math.round(peso.pp * 100) / 100).replace(".", ",")} (sale solo)` : "sale solo";
  const num = (k: "espesor" | "pp" | "direccion" | "intereje" | "nervio" | "capa", etiqueta: string, unidad: string, ayuda?: string) => <NumeroCampo key={`${tipo}-${k}`} etiqueta={etiqueta} unidad={unidad} valor={t[k]} onCambio={(v) => poner({ [k]: v })} ayuda={ayuda} cero={k === "pp"} vacio={k === "pp" ? vacioPp : "0"} falta={k === "pp" && faltaPp} />;
  return (
    <Seccion titulo="Plantilla" valor="para los siguientes">
      <div className="py-1">
        <Segmentado
          etiqueta="cómo"
          valor={t.modo ?? "recuadro"}
          opciones={[
            ["recuadro", "Recuadro"],
            ["poligono", "Polígono"],
          ]}
          onCambio={(modo) => poner({ modo })}
          ayuda={(t.modo ?? "recuadro") === "recuadro" ? "Un clic dentro de un recuadro cerrado por vigas, muros, apoyos lineales o bordes de forjado: el contorno, por sus ejes, desde el vértice más cercano al clic." : "Clic a clic; Intro, doble clic o un clic en el primero lo cierra."}
        />
        <Segmentado etiqueta="tipo" valor={tipo} opciones={TIPOS_FORJADO.map((x) => [x, TIPO_FORJADO[x]] as const)} onCambio={(x) => poner({ modo: t.modo, tipo: x, zunchos: t.zunchos, anchoZuncho: t.anchoZuncho }, true)} />
        {tipo !== "unidireccional" && (
          <>
            {num("espesor", "canto", "m")}
            <CampoMaterial modelo={m} valor={t.material} para="la plantilla de Forjado" editar={editar} onCambio={(material) => poner({ material })} />
            <CampoZunchos t={t} poner={poner} ayuda="Un zuncho del canto del forjado en cada lado que no va sobre una viga, un muro, un apoyo lineal u otro forjado: su eje, por el de los pilares del lado (o enrasado por fuera), la losa hasta él y la carga de la banda en la viga. Cerrado por vigas, no pone ninguno." />
          </>
        )}
        {tipo === "reticular" && (
          <>
            {num("intereje", "intereje", "m", "Entre ejes de nervios.")}
            {num("nervio", "nervio", "m", "Ancho del nervio (bw).")}
            {num("capa", "capa", "m", "Capa de compresión (hf).")}
            <label className="campo">
              <span>
                <span className="campo-nombre">casetón</span>
                <Ayuda texto="De qué es el casetón: con él sale el peso propio (hormigón de nervios y capa más el casetón en el hueco). «Perdido de otro material» pide escribir el pp." />
              </span>
              <select className="sel" value={t.caseton ?? CASETON_POR_DEFECTO} aria-label="Casetón" onChange={(x) => poner({ caseton: x.target.value as Caseton })}>
                {CASETONES.map((c) => (
                  <option key={c} value={c}>
                    {TEXTO_CASETON[c]}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {tipo === "unidireccional" && (
          <>
            {num("intereje", "intereje", "m", "Entre ejes de viguetas.")}
            <CampoSeccion modelo={m} valor={t.seccion} tipo="vigueta" etiqueta="vigueta" editar={editar} onCambio={(seccion) => poner({ seccion })} />
            <label className="campo">
              <span>
                <span className="campo-nombre">bovedilla</span>
                <Ayuda texto="De qué es la bovedilla: con ella y una vigueta en T sale el peso propio (vigueta y capa más la bovedilla en el hueco)." />
              </span>
              <select className="sel" value={t.bovedilla ?? BOVEDILLA_POR_DEFECTO} aria-label="Bovedilla" onChange={(x) => poner({ bovedilla: x.target.value as Bovedilla })}>
                {BOVEDILLAS.map((b) => (
                  <option key={b} value={b}>
                    {TEXTO_BOVEDILLA[b]}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {num(
          "pp",
          "pp",
          "kN/m²",
          tipo === "maciza"
            ? "Vacío: γ·canto."
            : tipo === "reticular"
              ? "Vacío, sale solo: el hormigón de nervios y capa más el casetón (los ábacos, γ·canto). Lo escrito manda: el medio de toda la losa con los ábacos."
              : "Vacío, sale solo con una vigueta en T: vigueta y capa más la bovedilla. Lo escrito manda.",
        )}
        {num("direccion", "dirección", "°", tipo === "unidireccional" ? "La de las viguetas, desde +X." : tipo === "reticular" ? "La de los nervios, desde +X." : "La del eje 1 de las láminas, desde +X.")}
      </div>
    </Seccion>
  );
}

const CARGA_HERR: ReadonlySet<string> = new Set(["puntual", "lineal", "superficie", "barra", "empuje"]);
type NombreCargaH = "puntual" | "lineal" | "superficie" | "barra" | "empuje";

/** La plantilla de una carga: el caso activo (el de la barra) y sus valores, que nunca tienen uno por defecto. */
function PlantillaCargaPanel({ h, t, poner }: { h: NombreCargaH; t: PlantillaCargas; poner: (c: PlantillaCargas) => void }) {
  const [momento, setMomento] = useState(false);
  const conM = momento || !!t.puntual?.M;
  return (
    <Seccion titulo="Plantilla" valor={t.caso ? `caso ${t.caso}` : "sin caso"}>
      <div className="py-1">
        {!t.caso && <p className="nota text-state-fail">Elija el caso activo en la barra (o cree uno con Casos).</p>}
        {h === "puntual" && (
          <>
            <CampoCarga etiqueta="F" unidad="kN" valor={t.puntual?.F} onCambio={(F) => poner({ puntual: { ...t.puntual, F } })} ayuda="La fuerza en el punto: p. ej., la reacción de un apeo." />
            <label className="chk">
              <input
                type="checkbox"
                checked={conM}
                onChange={(x) => {
                  setMomento(x.target.checked);
                  if (!x.target.checked) poner({ puntual: { ...t.puntual, M: undefined } });
                }}
              />
              <span>Con momento</span>
            </label>
            {conM && <CampoCarga etiqueta="M" unidad="kN·m" componentes="globales" valor={t.puntual?.M} onCambio={(M) => poner({ puntual: { ...t.puntual, M } })} ayuda="Mx My Mz en ejes globales (regla de la mano derecha)." />}
          </>
        )}
        {h === "lineal" && <CampoCarga etiqueta="q" unidad="kN/m" valor={t.lineal?.q} onCambio={(q) => poner({ lineal: { q } })} ayuda="Por metro de la línea dibujada: p. ej., 7 de un cerramiento." />}
        {h === "superficie" && (
          <>
            <Segmentado
              etiqueta="dónde"
              valor={t.superficie?.modo ?? "forjado"}
              opciones={[
                ["forjado", "Forjado"],
                ["zona", "Zona"],
              ]}
              onCambio={(modo) => poner({ superficie: { ...t.superficie, modo } })}
              ayuda={(t.superficie?.modo ?? "forjado") === "forjado" ? "Un clic dentro de una losa o un paño: todo él, sin sus huecos." : "Un polígono; si cae entero en un forjado, la parte de él en la zona."}
            />
            <CampoCarga etiqueta="q" unidad="kN/m²" valor={t.superficie?.q} onCambio={(q) => poner({ superficie: { ...t.superficie, q } })} ayuda="Por m² de forjado: p. ej., 1,5 de solado o 2 de uso." />
          </>
        )}
        {h === "barra" && (
          <>
            <Segmentado
              etiqueta="dónde"
              valor={t.barra?.modo ?? "entera"}
              opciones={[
                ["entera", "Pieza entera"],
                ["tramo", "Tramo"],
              ]}
              onCambio={(modo) => poner({ barra: { ...t.barra, modo } })}
              ayuda={(t.barra?.modo ?? "entera") === "entera" ? "Un clic en una viga o en un pilar." : "Dos clics en una viga: los extremos del tramo (en un pilar, todo él)."}
            />
            <Segmentado
              etiqueta="ejes"
              valor={t.barra?.ejes ?? "global"}
              opciones={[
                ["global", "Globales"],
                ["local", "Locales"],
              ]}
              onCambio={(ejes) => poner({ barra: { ...t.barra, ejes } })}
              ayuda={(t.barra?.ejes ?? "global") === "global" ? "Los de la planta: z hacia arriba." : "Los de la pieza: x a lo largo de ella y z según su canto."}
            />
            <CampoCarga
              key={t.barra?.ejes ?? "global"}
              etiqueta="q"
              unidad="kN/m"
              componentes={t.barra?.ejes === "local" ? "locales" : undefined}
              valor={t.barra?.q}
              onCambio={(q) => poner({ barra: { ...t.barra, q } })}
              ayuda="Por metro de la pieza; al principio, si varía."
              final={{ etiqueta: "qb", valor: t.barra?.qb, onCambio: (qb) => poner({ barra: { ...t.barra, qb } }), ayuda: "Al final de la pieza o del tramo, si varía (vacío: uniforme)." }}
            />
          </>
        )}
        {h === "empuje" && (
          <>
            <NumeroCampo etiqueta="z0" unidad="m" valor={t.empuje?.z0} onCambio={(z0) => poner({ empuje: { ...t.empuje, z0 } })} ayuda="Sobre la base del muro, donde vale p0." />
            <NumeroCampo etiqueta="z1" unidad="m" valor={t.empuje?.z1} onCambio={(z1) => poner({ empuje: { ...t.empuje, z1 } })} falta={t.empuje?.z1 === undefined} ayuda="Donde vale p1; nula fuera de z0–z1." />
            <NumeroCampo etiqueta="p0" unidad="kN/m²" cero valor={t.empuje?.p0} onCambio={(p0) => poner({ empuje: { ...t.empuje, p0 } })} falta={t.empuje?.p0 === undefined} />
            <NumeroCampo etiqueta="p1" unidad="kN/m²" valor={t.empuje?.p1} onCambio={(p1) => poner({ empuje: { ...t.empuje, p1 } })} />
            <p className="nota">El clic, del lado del terreno: empuja hacia el otro.</p>
          </>
        )}
      </div>
    </Seccion>
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

/**
 * Lo que se puede escribir en el campo de teclado con cada herramienta, como la línea de órdenes de
 * AutoCAD: [lo que se escribe, lo que es]. Con una cota, el campo pide sólo su distancia.
 */
function formasTeclado(h: Instantanea["herramienta"], asa: boolean): (readonly [string, string])[] {
  const abs = ["x; y", "coordenadas absolutas, m"] as const;
  if (asa) return [abs, ["@dx; dy", "desde donde estaba el vértice"]];
  if (h === "girar") return [["α", "el ángulo en grados, desde +X"], abs];
  if (esEditar(h)) return [abs, ["@dx; dy", "desde el punto base"]];
  const formas: (readonly [string, string])[] = [abs, ["@dx; dy", "desde el último punto"], ["@L<α", "longitud y ángulo, desde el eje 1"], ["L", "longitud hacia el cursor"]];
  if (h === "pilar") formas.push(["Tab", "elige una cota; luego, su distancia"]);
  return formas;
}

/** El campo de lo que se teclea, junto al cursor, con lo que se puede escribir en él. */
export function CampoTeclado({ ctrl, campo }: { ctrl: ControladorDibujo; campo: NonNullable<Instantanea["campo"]> }) {
  const [texto, setTexto] = useState(campo.texto);
  const foto = ctrl.instantanea();
  const formas = campo.cota && !foto.asa ? [] : formasTeclado(foto.herramienta, !!foto.asa);
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
          // CT3: Ctrl+Intro mueve el pilar elegido sin sus vigas
          if (x.key === "Enter") ctrl.teclear(texto, x.ctrlKey || x.metaKey);
          else if (x.key === "Escape") ctrl.escCampo();
          else if (x.key === "Tab" && ctrl.tab(x.shiftKey)) x.preventDefault();
          // CT2: el otro lado de la cota que se estira
          else if ((x.key === "ArrowLeft" || x.key === "ArrowRight") && ctrl.cambiarLado()) x.preventDefault();
        }}
      />
      {campo.cota && <p className="campo-cota">{foto.asa ? campo.cota : `Cota ${campo.cota}`}</p>}
      {campo.error && <p className="error">{campo.error}</p>}
      {formas.length > 0 && (
        <dl className="campo-formas">
          {formas.map(([f, q]) => (
            <Fragment key={f}>
              <dt>{f}</dt>
              <dd>{q}</dd>
            </Fragment>
          ))}
        </dl>
      )}
      <p className="campo-teclas">
        <span className="dib-tecla">Intro</span> acepta <span className="dib-tecla">Esc</span> anula
      </p>
    </div>
  );
}
