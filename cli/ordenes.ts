/**
 * Órdenes de la CLI `fem` (A0, A1; `docs/fem3d/agente.md` §7). Es la única parte de la capa de
 * agente con IO (regla A4): lee el proyecto, guarda y reutiliza los resultados en `.fem/<huella>/`
 * junto a él, y devuelve un único objeto JSON con su código de salida. Todo lo demás es de
 * `src/agente/`, `src/compilador/` y `src/motor/`, puros.
 *
 * Códigos de salida: 0 bien; 1 el modelo, el cálculo o la consulta tienen errores; 2 la orden está
 * mal dada (argumentos, fichero que no existe, JSON roto); 3 error interno.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { comprobarArmado } from "../src/agente/armaduraBase.ts";
import { comprobarObra } from "../src/agente/obra.ts";
import { conjuntoCombinaciones, seleccionPorDefecto, type ConjuntoCombinaciones, type Proposito, type Seleccion } from "../src/agente/combinaciones.ts";
import { consultar, CONSULTAS, resumen, TOP_POR_DEFECTO, type OpcionesConsulta } from "../src/agente/consultas.ts";
import { leerProyecto, VERSION_ESQUEMA, type Proyecto } from "../src/agente/proyecto.ts";
import { desempaquetarResultados, empaquetarResultados, type CabeceraResultados } from "../src/agente/resultados.ts";
import { revisar, type Revision } from "../src/agente/revision.ts";
import { CAMPOS, conjuntoPorDefecto, escalaDeTexto, escenaASvg, esfuerzoDeVista, necesitaCalculo, nombreFigura, propositoDe, ResultadosRender, VISTAS, vistaArmado, vistaAxiles, vistaBandas, vistaCampo, vistaReacciones, vistaCargas, vistaDiagnosticos, vistaDiagramas, vistaMalla, vistaModelo, type Armadura, type Campo, type Envolvente, type Escena, type Vista } from "../src/agente/render/index.ts";
import { sensatezPrevia } from "../src/agente/sensatez.ts";
import { importarDxf, type OpcionesImportar } from "../src/agente/importarDxf.ts";
import { FICHERO_APP, leerEstadoApp, seleccionApp } from "../src/agente/estadoApp.ts";
import { huellaSinCompilar } from "../src/compilador/compilar.ts";
import { aplanarDxf } from "../src/dxf/aplanar.ts";
import { ErrorDxf, leerDxf } from "../src/dxf/lector.ts";
import { esDwg, leerDwg } from "../src/dwg/lector.ts";
import { serializar } from "../src/editor/serializar.ts";
import { proponerAlinear, textoGrupo, TOLERANCIA_ALINEAR } from "../src/editor/alinear.ts";
import { operacionVigasBorde, proponerVigasBorde } from "../src/editor/vigasBorde.ts";
import { aplicar } from "../src/editor/operaciones.ts";
import { SITUACIONES, type Situacion } from "../src/combinaciones/generador.ts";
import { compilar, type ResultadoCompilacion } from "../src/compilador/compilar.ts";
import { Consultas } from "../src/compilador/consultas.ts";
import { traducirDiagnosticos } from "../src/compilador/mapeo.ts";
import { tieneEspectro } from "../src/compilador/sismo.ts";
import { emplazamiento, LIMITE_EMPLAZAMIENTO } from "../src/agente/emplazamiento.ts";
import { calcular } from "../src/motor/calcular.ts";
import type { Diagnostico } from "../src/motor/diagnosticos.ts";
import type { ResultadoCaso, ResultadoModal } from "../src/motor/modelo.ts";
import { iniciarNucleo } from "../src/nucleo/index.ts";
import { svgAPng } from "./png.ts";

export const RAIZ = resolve(import.meta.dirname, "..");
const WASM = join(RAIZ, "src", "nucleo", "pkg", "nucleo_bg.wasm");
export const RUTA_ESQUEMA = join(RAIZ, "src", "agente", "proyecto.schema.json");

/** Diagnósticos que se listan, en total y de cada código; del resto sólo se cuentan por código. */
export const MAX_DIAGNOSTICOS = 30;
export const MAX_POR_CODIGO = 3;
/** Carpetas de resultados que se conservan en `.fem/` (las más recientes). */
const RESULTADOS_CONSERVADOS = 3;

export const CODIGO = { bien: 0, errores: 1, uso: 2, interno: 3 } as const;

export interface Salida {
  codigo: number;
  json: Record<string, unknown>;
}

export interface Argumentos {
  orden: string;
  posicionales: string[];
  banderas: Map<string, string[]>;
}

const BANDERAS_CON_VALOR = new Set(["modelo", "situacion", "combinacion", "caso", "planta", "tipo", "top", "objeto", "losa", "cifras", "vista", "escala", "armadura", "envolvente", "salida", "capa-pilares", "capa-losas", "capa-ejes", "unidades", "planta-losas", "material", "espesor", "lado-maximo", "nombre", "tolerancia", "ancho", "canto"]);
const BANDERAS_SIN_VALOR = new Set(["exacto", "casos", "recalcular", "todos", "estaciones", "ayuda", "escribir"]);

export function analizarArgumentos(argv: readonly string[]): Argumentos | { error: string } {
  const [orden = "ayuda", ...resto] = argv;
  const posicionales: string[] = [];
  const banderas = new Map<string, string[]>();
  for (let i = 0; i < resto.length; i++) {
    const a = resto[i]!;
    if (!a.startsWith("--")) {
      posicionales.push(a);
      continue;
    }
    const [nombre, enLinea] = a.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
    if (BANDERAS_SIN_VALOR.has(nombre)) {
      if (enLinea !== undefined) return { error: `--${nombre} no lleva valor` };
      banderas.set(nombre, []);
    } else if (BANDERAS_CON_VALOR.has(nombre)) {
      const v = enLinea ?? resto[++i];
      if (v === undefined) return { error: `--${nombre} necesita un valor` };
      banderas.set(nombre, [...(banderas.get(nombre) ?? []), v]);
    } else return { error: `--${nombre} no es una opción de fem (${[...BANDERAS_SIN_VALOR, ...BANDERAS_CON_VALOR].map((b) => `--${b}`).join(", ")})` };
  }
  return { orden, posicionales, banderas };
}

const AYUDA = `fem — Concreta FEM 3D desde la línea de órdenes (docs/fem3d/agente.md §7)

  fem validar <proyecto.json>              esquema y compilación
  fem compilar <proyecto.json> [--modelo salida.json]
  fem calcular <proyecto.json> [--recalcular]
  fem resumen <proyecto.json>
  fem consultar <proyecto.json> <consulta> [opciones]   (consultas: ${CONSULTAS.join(", ")})
  fem render <proyecto.json> [--vista V] [--planta P] [--caso C] [--escala E] [--envolvente max|min]   PNG y SVG de cada planta (A4; vistas: ${VISTAS.join(", ")})
      --escala de los mapas (uz…v23, f11…f12): completa (por defecto), sin-picos o mín:máx:paso («-40:20:5», «::5»)
      --envolvente de los mapas con varias combinaciones: en cada nudo, la mayor o la menor (sin ella, la combinación de mayor |valor| de la planta)
  fem revisar <proyecto.json> [--recalcular]   sensatez e informe de revisión (A3)
  fem importar-dxf <plano.dxf|plano.dwg> [--salida proyecto.json] [--capa-pilares C] [--capa-losas C] [--capa-ejes C]
      [--planta id:cota]… [--planta-losas id] [--material HA-30] [--espesor 0.30] [--unidades m|cm|mm] [--nombre N]
      sin --salida, sólo dice lo que reconoce (y las capas); con ella, escribe el proyecto (nunca encima de otro)
  fem seleccion <proyecto.json>            lo que el ingeniero tiene elegido en la app (planta, espacio y objetos, tal como están en el fichero)
  fem alinear <proyecto.json> [--tolerancia 0.03] [--escribir]
      pilares y vértices casi alineados según los ejes (a menos de la tolerancia, en m, sin coincidir) y adónde los llevaría;
      sólo propone: con --escribir, los mueve y reescribe el proyecto (deja el de antes en <proyecto>.json.bak)
  fem vigas-borde <proyecto.json> [--losa L]… [--ancho 0.30] [--canto <el de la losa>] [--escribir]
      los zunchos de los bordes libres de cada losa, como «Vigas de borde» del editor (por el eje de los pilares del lado o enrasados por fuera);
      sólo propone: con --escribir, los pone y reescribe el proyecto (deja el de antes en <proyecto>.json.bak)
  fem emplazamiento <municipio | código INE> [--top N]
      el municipio de la obra para el sismo y el viento: su código INE («ine» de acciones.emplazamiento), ab y K del Anejo 1 de la NCSE-02
      y la zona eólica de la capital de su provincia, con el aviso si la provincia tiene más de una; no lleva proyecto
  fem esquema
  fem visor <proyecto.json> [--nuevo]      abre la app sobre el proyecto (no escribe JSON; Ctrl+C la cierra)

Combinaciones de las consultas: --casos | --situacion ELU-PT[,ELS-C…] | --combinacion "1.35*G+1.5*Q" (repetible) | --caso G
Otras: --planta P --tipo pilar|viga|vigueta --objeto id --losa id --armadura x-inf|x-sup|y-inf|y-sup (refuerzos, con la base del proyecto) --top N --todos --estaciones --exacto --cifras N
modos: masas por planta y modos de vibración (periodos, masa efectiva y forma); necesita "acciones": { "sismo": {} } en el modelo y no depende de las combinaciones
sismo: el sismo del programa por espectros de respuesta (NCSE-02): emplazamiento y espectro y, según X y según Y, cortante en la base, cortantes y fuerzas de planta, desplazamientos, θ de segundo orden y el contraste con el método simplificado; necesita "ine" (el municipio, de fem emplazamiento) o "ab" y "K", y "terreno" y "mu", en "acciones": { "sismo": {…} }; sus casos EX+e, EX-e, EY+e y EY-e entran en las combinaciones sísmicas (--situacion ELU-SIS) y en --caso
Salida: un objeto JSON. Códigos: 0 bien, 1 errores del modelo o del cálculo, 2 orden mal dada, 3 error interno.`;

// ─── Diagnósticos y números ─────────────────────────────────────────────────────────────────────

/**
 * Errores primero; como mucho MAX_POR_CODIGO de cada código y MAX_DIAGNOSTICOS en total. Del resto,
 * cuántos hay de cada código (un aviso repetido en cada estación de una banda dice lo mismo).
 */
export function listaDiagnosticos(ds: readonly Diagnostico[]): { diagnosticos: Diagnostico[]; omitidos?: Record<string, number> } {
  const orden = [...ds].sort((a, b) => (a.severidad === "error" ? 0 : 1) - (b.severidad === "error" ? 0 : 1));
  const lista: Diagnostico[] = [];
  const omitidos: Record<string, number> = {};
  const porCodigo = new Map<string, number>();
  for (const d of orden) {
    const n = porCodigo.get(d.codigo) ?? 0;
    porCodigo.set(d.codigo, n + 1);
    if (n < MAX_POR_CODIGO && lista.length < MAX_DIAGNOSTICOS) lista.push(d);
    else omitidos[d.codigo] = (omitidos[d.codigo] ?? 0) + 1;
  }
  return Object.keys(omitidos).length ? { diagnosticos: lista, omitidos } : { diagnosticos: lista };
}

/** JSON de la salida: arrays tipados como listas y, salvo con --exacto, los no enteros a `cifras` cifras significativas. */
export function textoSalida(json: unknown, cifras: number | null): string {
  return JSON.stringify(json, (_k, v: unknown) => {
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) v = Array.from(v as unknown as ArrayLike<number>);
    if (cifras !== null && Array.isArray(v)) return v.map((x) => (typeof x === "number" ? redondear(x, cifras) : x));
    if (cifras !== null && typeof v === "number") return redondear(v, cifras);
    return v;
  });
}

const redondear = (x: number, cifras: number) => (Number.isInteger(x) || !Number.isFinite(x) ? x : Number(x.toPrecision(cifras)));

const hayErrores = (ds: readonly Diagnostico[]) => ds.some((d) => d.severidad === "error");

// ─── Proyecto, compilación y resultados ────────────────────────────────────────────────────────

type Leido = { ruta: string; proyecto: Proyecto } | Salida;

function leer(orden: string, ruta: string | undefined): Leido {
  if (!ruta) return { codigo: CODIGO.uso, json: { orden, ok: false, diagnosticos: [{ codigo: "cli/sin-proyecto", severidad: "error", mensaje: `fem ${orden} necesita la ruta del proyecto.json.` }] } };
  const abs = resolve(ruta);
  if (!existsSync(abs) || !statSync(abs).isFile()) return { codigo: CODIGO.uso, json: { orden, ok: false, diagnosticos: [{ codigo: "cli/no-existe", severidad: "error", mensaje: `No existe el fichero ${abs}.` }] } };
  const r = leerProyecto(readFileSync(abs, "utf8"));
  if (!r.valido) {
    const roto = r.diagnosticos.some((d) => d.codigo === "proyecto/json");
    return { codigo: roto ? CODIGO.uso : CODIGO.errores, json: { orden, ok: false, ...listaDiagnosticos(r.diagnosticos) } };
  }
  return { ruta: abs, proyecto: r.proyecto };
}

const huellaMotor = (() => {
  let h: string | undefined;
  return () => (h ??= createHash("sha256").update(readFileSync(WASM)).digest("hex"));
})();

let nucleoListo = false;
async function nucleo(): Promise<void> {
  if (nucleoListo) return;
  await iniciarNucleo(readFileSync(WASM));
  nucleoListo = true;
}

/** Carpeta de resultados de una huella, junto al proyecto. */
export const carpetaResultados = (rutaProyecto: string, huella: string) => join(dirname(rutaProyecto), ".fem", huella);

const sha256 = (texto: string) => createHash("sha256").update(texto, "utf8").digest("hex");
const sha256Bytes = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const rel = (ruta: string) => relative(process.cwd(), ruta).split(sep).join("/");

interface Calculado {
  compilacion: Extract<ResultadoCompilacion, { valido: true }>;
  casos: ResultadoCaso[];
  /** VS2: los modos, si el proyecto lleva `acciones.sismo`. */
  modal?: ResultadoModal;
  cabecera: CabeceraResultados;
  reutilizados: boolean;
  tiempos: Record<string, number>;
}

/** Compila y calcula, o reutiliza los resultados guardados de la misma huella. */
async function calculado(orden: string, ruta: string, p: Proyecto, recalcular: boolean): Promise<Calculado | Salida> {
  const t0 = performance.now();
  const c = compilar(p.modelo, p.opciones);
  const tCompilar = (performance.now() - t0) / 1000;
  if (!c.valido) return { codigo: CODIGO.errores, json: { orden, ok: false, huella: c.huella, ...listaDiagnosticos(c.diagnosticos) } };
  const carpeta = carpetaResultados(ruta, c.huella);
  const [fCab, fBin] = [join(carpeta, "resultados.json"), join(carpeta, "resultados.bin")];
  if (!recalcular && existsSync(fCab) && existsSync(fBin)) {
    try {
      const cabecera = JSON.parse(readFileSync(fCab, "utf8")) as CabeceraResultados & { motor?: string; sha256?: string };
      const bin = new Uint8Array(readFileSync(fBin));
      // Misma huella, mismo núcleo, los mismos bytes que se guardaron y el mismo modelo analítico (el
      // visor comprueba lo mismo, V1): si no, se recalcula
      const r = cabecera.huella === c.huella && cabecera.motor === huellaMotor() && cabecera.sha256 === sha256Bytes(bin) ? desempaquetarResultados(cabecera, bin, c.modelo) : null;
      if (r && "casos" in r) return { compilacion: c, casos: r.casos, ...(r.modal ? { modal: r.modal } : {}), cabecera, reutilizados: true, tiempos: { compilar: tCompilar } };
    } catch {
      // resultados rotos: se recalculan
    }
  }
  await nucleo();
  const t1 = performance.now();
  const r = calcular(c.modelo);
  const tCalcular = (performance.now() - t1) / 1000;
  const diags = traducirDiagnosticos(r.diagnosticos, c.modelo, c.mapeo);
  if (!r.valido) return { codigo: CODIGO.errores, json: { orden, ok: false, huella: c.huella, ...listaDiagnosticos([...c.diagnosticos, ...diags]) } };
  const { cabecera, bytes } = empaquetarResultados(c.huella, c.modelo, r.casos, r.estadisticas, diags, r.modal);
  guardar(carpeta, { ...cabecera, motor: huellaMotor(), sha256: sha256Bytes(bytes) }, bytes);
  return { compilacion: c, casos: r.casos, ...(r.modal ? { modal: r.modal } : {}), cabecera, reutilizados: false, tiempos: { compilar: tCompilar, calcular: tCalcular } };
}

function guardar(carpeta: string, cabecera: object, bytes: Uint8Array): void {
  mkdirSync(carpeta, { recursive: true });
  const tmp = `${carpeta}.tmp-${process.pid}`;
  mkdirSync(tmp, { recursive: true });
  writeFileSync(join(tmp, "resultados.bin"), bytes);
  writeFileSync(join(tmp, "resultados.json"), JSON.stringify(cabecera));
  for (const f of ["resultados.bin", "resultados.json"]) renameSync(join(tmp, f), join(carpeta, f));
  rmSync(tmp, { recursive: true, force: true });
  // Sólo las más recientes: son derivadas y pesan
  const raiz = dirname(carpeta);
  const otras = readdirSync(raiz)
    .map((n) => join(raiz, n))
    .filter((d) => d !== carpeta && statSync(d).isDirectory())
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  for (const d of otras.slice(RESULTADOS_CONSERVADOS - 1)) rmSync(d, { recursive: true, force: true });
}

// ─── Revisión ───────────────────────────────────────────────────────────────────────────────────

function revision(l: { ruta: string; proyecto: Proyecto }, r: Calculado): Revision {
  const q = new Consultas(l.proyecto.modelo, r.compilacion, r.casos, l.proyecto.opciones, r.modal);
  return revisar(l.proyecto, r.compilacion, q, {
    motor: huellaMotor(),
    diagnosticos: [...r.compilacion.diagnosticos, ...r.cabecera.diagnosticos],
    equilibrio: r.cabecera.casos.map((c) => ({ id: c.id, ...c.equilibrio })),
  });
}

// ─── Órdenes ────────────────────────────────────────────────────────────────────────────────────

function seleccionDe(a: Argumentos): Seleccion | { error: string } | null {
  const sel: Seleccion[] = [];
  if (a.banderas.has("casos")) sel.push({ tipo: "casos" });
  const sit = a.banderas.get("situacion");
  if (sit) {
    const s = sit.flatMap((x) => x.split(",")).map((x) => x.trim());
    const malas = s.filter((x) => !SITUACIONES.includes(x as Situacion));
    if (malas.length) return { error: `situación desconocida: ${malas.join(", ")} (${SITUACIONES.join(", ")})` };
    sel.push({ tipo: "situaciones", situaciones: s as Situacion[] });
  }
  const ex = [...(a.banderas.get("combinacion") ?? []), ...(a.banderas.get("caso") ?? [])];
  if (ex.length) sel.push({ tipo: "expresiones", expresiones: ex });
  if (sel.length > 1) return { error: "usa sólo una de --casos, --situacion y --combinacion/--caso" };
  return sel[0] ?? null;
}

export async function ejecutar(argv: readonly string[]): Promise<Salida> {
  const a = analizarArgumentos(argv);
  if ("error" in a) return { codigo: CODIGO.uso, json: { orden: argv[0] ?? "", ok: false, diagnosticos: [{ codigo: "cli/argumentos", severidad: "error", mensaje: a.error }] } };
  const { orden } = a;
  const mal = (mensaje: string): Salida => ({ codigo: CODIGO.uso, json: { orden, ok: false, diagnosticos: [{ codigo: "cli/argumentos", severidad: "error", mensaje }] } });
  switch (orden) {
    case "ayuda":
    case "--ayuda":
    case "-h":
    case "--help":
      return { codigo: CODIGO.bien, json: { orden: "ayuda", ok: true, ayuda: AYUDA } };
    case "esquema":
      return { codigo: CODIGO.bien, json: { orden, ok: true, version: VERSION_ESQUEMA, ruta: RUTA_ESQUEMA } };
    case "validar":
    case "compilar": {
      const l = leer(orden, a.posicionales[0]);
      if ("codigo" in l) return l;
      const c = compilar(l.proyecto.modelo, l.proyecto.opciones);
      // A3: las comprobaciones de sensatez que no necesitan el cálculo, también si no compila
      const previa = sensatezPrevia(l.proyecto.modelo, l.proyecto.opciones).flatMap((x) => x.avisos);
      // AB: la armadura base, fuera del modelo (no impide compilar, pero es un error del fichero)
      const armado = comprobarArmado(l.proyecto.armado, l.proyecto.modelo);
      // DO: los materiales por defecto de la obra, también fuera del modelo
      const obra = comprobarObra(l.proyecto.obra, l.proyecto.modelo);
      const ok = c.valido && !hayErrores(c.diagnosticos) && !armado.length && !obra.length;
      const json: Record<string, unknown> = { orden, ok, huella: c.huella, ...listaDiagnosticos([...c.diagnosticos, ...armado, ...obra, ...previa]) };
      if (orden === "compilar" && c.valido) {
        const { tiempos, ...estadisticas } = c.estadisticas;
        json.estadisticas = { ...estadisticas, segundos: Object.values(tiempos).reduce((s, t) => s + t, 0) / 1000 };
        json.hipotesis = c.hipotesis;
        const salida = a.banderas.get("modelo")?.[0];
        if (salida) {
          writeFileSync(resolve(salida), JSON.stringify({ huella: c.huella, modelo: c.modelo, mapeo: c.mapeo }));
          json.modelo = resolve(salida);
        }
      }
      return { codigo: ok ? CODIGO.bien : CODIGO.errores, json };
    }
    case "calcular": {
      const l = leer(orden, a.posicionales[0]);
      if ("codigo" in l) return l;
      const r = await calculado(orden, l.ruta, l.proyecto, a.banderas.has("recalcular"));
      if ("codigo" in r) return r;
      const est = r.cabecera.estadisticas;
      // VS3: con el espectro en el sismo de las acciones, sus casos y el cortante en la base (el detalle, con `fem consultar sismo`)
      const sismo = tieneEspectro(l.proyecto.modelo) && r.modal ? new Consultas(l.proyecto.modelo, r.compilacion, r.casos, l.proyecto.opciones, r.modal).sismo() : null;
      return {
        codigo: sismo && !sismo.valido ? CODIGO.errores : CODIGO.bien,
        json: {
          orden,
          ok: !sismo || sismo.valido,
          huella: r.compilacion.huella,
          resultados: relative(process.cwd(), carpetaResultados(l.ruta, r.compilacion.huella)).split(sep).join("/"),
          reutilizados: r.reutilizados,
          casos: r.cabecera.casos.map((c) => ({ id: c.id, equilibrio: c.equilibrio })),
          // VS2: con el sismo en las acciones, los modos (el detalle, con `fem consultar modos`)
          ...(r.modal ? { modos: { numero: r.modal.modos.length, T1: r.modal.modos[0]?.periodo ?? null, masa: r.modal.masas.diafragmas, equilibrio: Math.max(0, ...r.modal.modos.flatMap((m) => [m.equilibrio.fuerzas, m.equilibrio.momentos])) } } : {}),
          ...(sismo?.valido ? { sismo: { casos: sismo.valor.casos, periodo: sismo.valor.direcciones.map((d) => d.dominante.periodo), cortanteBasal: sismo.valor.direcciones.map((d) => d.basal), coeficiente: sismo.valor.direcciones.map((d) => d.coeficiente) } } : {}),
          estadisticas: { nudos: est.nudos, ecuaciones: est.ecuaciones, barras: r.compilacion.estadisticas.barras, laminas: r.compilacion.estadisticas.laminas },
          segundos: r.tiempos,
          ...listaDiagnosticos([...r.compilacion.diagnosticos, ...r.cabecera.diagnosticos, ...(sismo?.diagnosticos ?? [])]),
        },
      };
    }
    case "resumen": {
      const l = leer(orden, a.posicionales[0]);
      if ("codigo" in l) return l;
      const c = compilar(l.proyecto.modelo, l.proyecto.opciones);
      if (!c.valido) return { codigo: CODIGO.errores, json: { orden, ok: false, huella: c.huella, ...listaDiagnosticos(c.diagnosticos) } };
      const res = resumen(l.proyecto, c);
      return { codigo: res.valido ? CODIGO.bien : CODIGO.errores, json: { orden, ok: res.valido, ...(res.valido ? { valor: res.valor } : {}), ...listaDiagnosticos(res.diagnosticos) } };
    }
    case "consultar": {
      const l = leer(orden, a.posicionales[0]);
      if ("codigo" in l) return l;
      const consulta = a.posicionales[1];
      if (!consulta || !CONSULTAS.includes(consulta as never)) return mal(`fem consultar necesita una consulta: ${CONSULTAS.join(", ")}.`);
      const seleccion = seleccionDe(a);
      if (seleccion && "error" in seleccion) return mal(seleccion.error);
      const top = a.banderas.get("top")?.[0];
      if (top !== undefined && !(Number.isInteger(Number(top)) && Number(top) > 0)) return mal("--top tiene que ser un entero positivo");
      const r = await calculado(orden, l.ruta, l.proyecto, a.banderas.has("recalcular"));
      if ("codigo" in r) return r;
      const q = new Consultas(l.proyecto.modelo, r.compilacion, r.casos, l.proyecto.opciones, r.modal);
      const opciones: OpcionesConsulta = {
        ...(a.banderas.get("planta") ? { planta: a.banderas.get("planta")![0]! } : {}),
        ...(a.banderas.get("tipo") ? { tipo: a.banderas.get("tipo")![0]! } : {}),
        ...(a.banderas.get("objeto") ? { objeto: a.banderas.get("objeto")![0]! } : {}),
        ...(a.banderas.get("losa") ? { losa: a.banderas.get("losa")![0]! } : {}),
        ...(top !== undefined ? { top: Number(top) } : {}),
        ...(a.banderas.has("todos") ? { todos: true } : {}),
        ...(a.banderas.has("estaciones") ? { estaciones: true } : {}),
        ...(a.banderas.get("armadura") ? { armadura: a.banderas.get("armadura")![0]! } : {}),
        ...(l.proyecto.armado ? { armado: l.proyecto.armado } : {}),
        id: a.posicionales[2],
        // Los casos de las consultas: con los del programa (el viento y el sismo), que el fichero no lleva
        combinaciones: (proposito: Proposito) => conjuntoCombinaciones(q, seleccion ?? seleccionPorDefecto(q.fisico.casos, proposito)),
      };
      const res = consultar(q, consulta as (typeof CONSULTAS)[number], opciones);
      return {
        codigo: res.valido ? CODIGO.bien : CODIGO.errores,
        json: { orden, consulta, ok: res.valido, huella: r.compilacion.huella, ...(res.valido ? { valor: res.valor } : {}), ...listaDiagnosticos(res.diagnosticos) },
      };
    }
    case "render": {
      const l = leer(orden, a.posicionales[0]);
      if ("codigo" in l) return l;
      const vistas = (a.banderas.get("vista") ?? ["modelo"]).flatMap((x) => x.split(",")).map((x) => x.trim()) as Vista[];
      const malas = vistas.filter((v) => !VISTAS.includes(v));
      if (malas.length) return mal(`vista desconocida: ${malas.join(", ")} (${VISTAS.join(", ")})`);
      const f = l.proyecto.modelo;
      const plantas = (a.banderas.get("planta") ?? f.plantas.map((p) => p.id)).flatMap((x) => x.split(","));
      const sinPlanta = plantas.filter((p) => !f.plantas.some((x) => x.id === p));
      if (sinPlanta.length) return mal(`planta desconocida: ${sinPlanta.join(", ")} (${f.plantas.map((p) => p.id).join(", ")})`);
      const seleccion = seleccionDe(a);
      if (seleccion && "error" in seleccion) return mal(seleccion.error);
      const escalas = a.banderas.get("escala") ?? [];
      if (escalas.length > 1) return mal("--escala sólo una vez");
      const escala = escalaDeTexto(escalas[0] ?? "");
      if ("error" in escala) return mal(escala.error);
      const envolventes = a.banderas.get("envolvente") ?? [];
      if (envolventes.length > 1 || (envolventes[0] !== undefined && envolventes[0] !== "max" && envolventes[0] !== "min")) return mal("--envolvente: max o min, una vez");
      const envolvente = envolventes[0] as Envolvente | undefined;
      const casos = a.banderas.get("caso") ?? f.casos.map((c) => c.id);
      const c = compilar(f, l.proyecto.opciones);
      const d = { nombre: l.proyecto.nombre, huella: c.huella };
      // Lo que necesita el cálculo, y sus combinaciones
      let rr: ResultadosRender | null = null;
      let diags: Diagnostico[] = [...c.diagnosticos];
      const conjuntos = new Map<string, ConjuntoCombinaciones>();
      if (vistas.some(necesitaCalculo)) {
        const r = await calculado(orden, l.ruta, l.proyecto, a.banderas.has("recalcular"));
        if ("codigo" in r) return r;
        const q = new Consultas(f, r.compilacion, r.casos, l.proyecto.opciones, r.modal);
        rr = new ResultadosRender(q, r.compilacion);
        diags = [...r.compilacion.diagnosticos, ...r.cabecera.diagnosticos];
        const res = resumen(l.proyecto, r.compilacion);
        if (!res.valido) return { codigo: CODIGO.errores, json: { orden, ok: false, huella: c.huella, ...listaDiagnosticos(res.diagnosticos) } };
        for (const proposito of ["desplazamientos", "esfuerzos", "reacciones"] as const) {
          if (seleccion || proposito === "reacciones") {
            // Las reacciones, por defecto, en la ELS característica (UI-11; por casos si no llevan su acción)
            const x = conjuntoCombinaciones(q, seleccion ?? seleccionPorDefecto(q.fisico.casos, "reacciones"));
            if (!x.valido) return { codigo: CODIGO.errores, json: { orden, ok: false, huella: c.huella, ...listaDiagnosticos(x.diagnosticos) } };
            conjuntos.set(proposito, x.valor);
          } else conjuntos.set(proposito, conjuntoPorDefecto(q, res.valor, proposito));
        }
      }
      const previa = sensatezPrevia(f, l.proyecto.opciones).flatMap((x) => x.avisos);
      const carpeta = join(carpetaResultados(l.ruta, c.huella), "render");
      mkdirSync(carpeta, { recursive: true });
      const figuras: Record<string, unknown>[] = [];
      for (const planta of plantas)
        for (const vista of vistas) {
          const escenas: [Escena, string | undefined][] = [];
          if (vista === "modelo") escenas.push([vistaModelo(f, planta, d), undefined]);
          else if (vista === "cargas") for (const caso of casos) escenas.push([vistaCargas(f, planta, caso, d), caso]);
          else if (vista === "diagnosticos") escenas.push([vistaDiagnosticos(f, planta, [...diags, ...previa], d), undefined]);
          else if (vista === "malla") escenas.push([vistaMalla(rr!, planta, d), undefined]);
          else if (esfuerzoDeVista(vista)) escenas.push([vistaDiagramas(rr!, planta, esfuerzoDeVista(vista)!, conjuntos.get("esfuerzos")!, d), undefined]);
          else if (vista === "pilares-n") escenas.push([vistaAxiles(rr!, planta, conjuntos.get("esfuerzos")!, d), undefined]);
          else if (vista === "reacciones") escenas.push([vistaReacciones(rr!, planta, conjuntos.get("reacciones")!, d), undefined]);
          else if (vista === "bandas") escenas.push([vistaBandas(rr!, planta, conjuntos.get("esfuerzos")!, d), undefined]);
          else if (vista.startsWith("armado-")) escenas.push([vistaArmado(rr!, planta, vista.slice("armado-".length) as Armadura, conjuntos.get("esfuerzos")!, d, { ...(escala ? { escala } : {}), ...(l.proyecto.armado ? { armado: l.proyecto.armado } : {}) }), undefined]);
          else escenas.push([vistaCampo(rr!, planta, vista as Campo, conjuntos.get(propositoDe(vista))!, d, escala, envolvente), undefined]);
          for (const [e, caso] of escenas) {
            const s = escenaASvg(e);
            const base = join(carpeta, nombreFigura(planta, vista, caso));
            writeFileSync(`${base}.svg`, s.svg);
            writeFileSync(`${base}.png`, await svgAPng(s.svg));
            const comb = e.extremos.find((x) => x.comb)?.comb;
            figuras.push({
              planta,
              vista,
              ...(caso ? { caso } : {}),
              png: `${basename(base)}.png`,
              svg: `${basename(base)}.svg`,
              ancho: s.encuadre.ancho,
              alto: s.encuadre.alto,
              pxPorM: s.encuadre.escala,
              ...(e.mapa ? { escala: { limites: e.mapa.limites, ...(e.mapa.fueraAbajo ? { fueraAbajo: true } : {}), ...(e.mapa.fueraArriba ? { fueraArriba: true } : {}), ...(e.mapa.picos ? { picos: true } : {}), ...(e.mapa.nulo ? { nulo: true } : {}), ...(e.mapa.sinPicos ? { sinPicos: e.mapa.sinPicos.map((x) => Number(x.toPrecision(6))) } : {}) } } : {}),
              ...(necesitaCalculo(vista) && vista !== "malla" ? { combinaciones: conjuntos.get(propositoDe(vista))!.descripcion } : {}),
              ...(comb && (CAMPOS as readonly string[]).includes(vista) ? { combinacion: comb } : {}),
              extremos: e.extremos.slice(0, TOP_POR_DEFECTO).map((x) => ({ que: x.que, valor: x.valor, unidad: x.unidad, ...(x.objeto ? { objeto: x.objeto } : {}), ...(x.punto ? { punto: x.punto } : {}), ...(x.comb ? { comb: x.comb } : {}) })),
              ...(e.extremos.length > TOP_POR_DEFECTO ? { extremosOmitidos: e.extremos.length - TOP_POR_DEFECTO } : {}),
              ...(s.omitidos ? { rotulosOmitidos: s.omitidos } : {}),
            });
          }
        }
      return {
        codigo: CODIGO.bien,
        json: { orden, ok: true, huella: c.huella, valido: c.valido, carpeta: rel(carpeta), figuras, ...listaDiagnosticos(vistas.includes("diagnosticos") ? [] : diags.filter((x) => x.severidad === "error")) },
      };
    }
    case "revisar": {
      const l = leer(orden, a.posicionales[0]);
      if ("codigo" in l) return l;
      const r = await calculado(orden, l.ruta, l.proyecto, a.banderas.has("recalcular"));
      if ("codigo" in r) return r;
      const rev = revision(l, r);
      const carpeta = carpetaResultados(l.ruta, r.compilacion.huella);
      mkdirSync(carpeta, { recursive: true });
      writeFileSync(join(carpeta, "informe.md"), rev.markdown);
      writeFileSync(join(carpeta, "informe.html"), rev.html);
      const sha = sha256(rev.markdown);
      return {
        codigo: CODIGO.bien,
        json: {
          orden,
          ok: true,
          huella: r.compilacion.huella,
          informe: { markdown: rel(join(carpeta, "informe.md")), html: rel(join(carpeta, "informe.html")), sha256: sha },
          avisos: rev.avisos.length,
          comprobaciones: rev.comprobaciones.map((c) => ({ codigo: c.codigo, estado: c.estado, avisos: c.avisos.length, ...(c.peor ? { peor: c.peor } : {}) })),
          ...listaDiagnosticos([...rev.avisos, ...r.compilacion.diagnosticos, ...r.cabecera.diagnosticos]),
        },
      };
    }
    case "importar-dxf":
      return importarDxfOrden(a, mal);
    case "emplazamiento": {
      // VS4: el municipio de la obra, para el sismo (ine, ab y K) y el viento (zona eólica). No lleva proyecto.
      const consulta = a.posicionales.join(" ").trim();
      if (!consulta) return mal("fem emplazamiento necesita el nombre del municipio (o parte) o su código INE de 5 cifras.");
      const top = a.banderas.get("top")?.[0];
      const limite = top === undefined ? LIMITE_EMPLAZAMIENTO : Number(top);
      if (!(Number.isInteger(limite) && limite >= 1)) return mal(`--top: «${top}» no es un número entero mayor que cero.`);
      const { noEncontrado, ...e } = emplazamiento(consulta, limite);
      // Sin municipios no se da nada por bueno: no estar en el Anejo 1 no es estar exento
      const diagnosticos = noEncontrado ? [{ codigo: "emplazamiento/no-encontrado", severidad: "error", mensaje: `«${consulta}»: ${noEncontrado[0]!.toLowerCase()}${noEncontrado.slice(1)}` }] : [];
      return { codigo: noEncontrado ? CODIGO.errores : CODIGO.bien, json: { orden, ok: !noEncontrado, ...e, diagnosticos } };
    }
    case "alinear":
      return alinearOrden(a, mal);
    case "vigas-borde":
      return vigasBordeOrden(a, mal);
    case "seleccion": {
      const l = leer(orden, a.posicionales[0]);
      if ("codigo" in l) return l;
      const f = join(dirname(l.ruta), ".fem", FICHERO_APP);
      const nada = (mensaje: string): Salida => ({ codigo: CODIGO.errores, json: { orden, ok: false, diagnosticos: [{ codigo: "seleccion/sin-app", severidad: "error", mensaje }] } });
      if (!existsSync(f)) return nada("La app no ha dejado lo que tiene elegido junto a este proyecto. Tiene que tenerlo abierto desde su carpeta (o con fem visor), no en «Mis proyectos» del navegador: allí, «Pasar a una carpeta».");
      const e = leerEstadoApp(readFileSync(f, "utf8"));
      if (!e) return nada(`${rel(f)} no es un estado de la app.`);
      if (e.proyecto !== basename(l.ruta)) return nada(`La app tiene abierto ${e.proyecto}, no ${basename(l.ruta)}.`);
      const s = seleccionApp(e, l.proyecto, huellaSinCompilar(l.proyecto.modelo, l.proyecto.opciones), new Date());
      const { avisos, ...valor } = s;
      return { codigo: CODIGO.bien, json: { orden, ok: true, valor, diagnosticos: avisos.map((m) => ({ codigo: "seleccion/aviso", severidad: "aviso", mensaje: m })) } };
    }
    default:
      return mal(`orden desconocida «${orden}». ${AYUDA}`);
  }
}

/** `fem importar-dxf` (MA6, `docs/fem3d/modelado.md` §2.6). */
function importarDxfOrden(a: Argumentos, mal: (m: string) => Salida): Salida {
  const orden = "importar-dxf";
  const ruta = a.posicionales[0];
  if (!ruta) return mal("fem importar-dxf necesita la ruta del plano (.dxf o .dwg).");
  const abs = resolve(ruta);
  if (!existsSync(abs) || !statSync(abs).isFile()) return { codigo: CODIGO.uso, json: { orden, ok: false, diagnosticos: [{ codigo: "cli/no-existe", severidad: "error", mensaje: `No existe el fichero ${abs}.` }] } };
  const b = (n: string) => a.banderas.get(n);
  const uno = (n: string) => b(n)?.[b(n)!.length - 1];
  const capas = (n: string) => b(n)?.flatMap((x) => x.split(",")).map((x) => x.trim()).filter(Boolean);
  const plantas: { id: string; cota: number }[] = [];
  for (const x of (b("planta") ?? []).flatMap((y) => y.split(","))) {
    const m = /^\s*([^:\s]+)\s*:\s*(-?\d+(?:[.,]\d+)?)\s*$/.exec(x);
    if (!m) return mal(`--planta: «${x}» no es id:cota («N1:3.40»).`);
    plantas.push({ id: m[1]!, cota: Number(m[2]!.replace(",", ".")) });
  }
  const numero = (n: string): number | undefined | null => {
    const v = uno(n);
    if (v === undefined) return undefined;
    const x = Number(v.replace(",", "."));
    return Number.isFinite(x) && x > 0 ? x : null;
  };
  const espesor = numero("espesor");
  const ladoMaximo = numero("lado-maximo");
  if (espesor === null) return mal("--espesor tiene que ser un número positivo, en m.");
  if (ladoMaximo === null) return mal("--lado-maximo tiene que ser un número positivo, en m.");
  const unidades = uno("unidades");
  if (unidades !== undefined && !["m", "cm", "mm", "in", "ft"].includes(unidades)) return mal("--unidades: m, cm, mm, in o ft.");
  const salida = uno("salida") ? resolve(uno("salida")!) : null;
  if (salida && existsSync(salida)) return { codigo: CODIGO.uso, json: { orden, ok: false, diagnosticos: [{ codigo: "cli/ya-existe", severidad: "error", mensaje: `Ya existe ${salida}: importar-dxf no escribe encima de un proyecto. Elija otro nombre o bórrelo antes.` }] } };
  if (salida && !existsSync(dirname(salida))) return { codigo: CODIGO.uso, json: { orden, ok: false, diagnosticos: [{ codigo: "cli/no-existe", severidad: "error", mensaje: `No existe la carpeta ${dirname(salida)}.` }] } };
  const bytes = new Uint8Array(readFileSync(abs));
  let dxf: ReturnType<typeof leerDxf>;
  try {
    // Un DWG (R14 a 2018, fase DW) da el mismo Dxf que su DXF
    dxf = esDwg(bytes) ? leerDwg(bytes) : leerDxf(bytes);
  } catch (e) {
    if (e instanceof ErrorDxf) return { codigo: CODIGO.uso, json: { orden, ok: false, diagnosticos: [{ codigo: "dxf/no-se-lee", severidad: "error", mensaje: `No se puede leer ${basename(abs)} como ${esDwg(bytes) ? "DWG" : "DXF"}: ${e.message}` }] } };
    throw e;
  }
  const d = aplanarDxf(dxf);
  // La plantilla, si el DXF está junto al proyecto (la app lo busca ahí)
  const junto = salida !== null && dirname(salida) === dirname(abs);
  const o: OpcionesImportar = {
    ...(capas("capa-pilares") ? { capasPilares: capas("capa-pilares")! } : {}),
    ...(capas("capa-losas") ? { capasLosas: capas("capa-losas")! } : {}),
    ...(capas("capa-ejes") ? { capasEjes: capas("capa-ejes")! } : {}),
    ...(unidades ? { unidades: unidades as OpcionesImportar["unidades"] & string } : {}),
    ...(plantas.length ? { plantas } : {}),
    ...(uno("planta-losas") ? { plantaLosas: uno("planta-losas")! } : {}),
    ...(uno("material") ? { material: uno("material")! } : {}),
    ...(espesor ? { espesor } : {}),
    ...(ladoMaximo ? { ladoMaximo } : {}),
    nombre: uno("nombre") ?? basename(salida ?? abs).replace(/\.(json|dxf|dwg)$/i, ""),
    ...(junto ? { plantilla: { fichero: basename(abs), sha256: sha256Bytes(bytes) } } : {}),
  };
  const r = importarDxf(dxf, d, o);
  if (!r.ok) return { codigo: CODIGO.errores, json: { orden, ok: false, ...(r.informe ? { capas: r.informe.capas, propuesta: r.informe.propuesta } : {}), diagnosticos: r.errores.map((m) => ({ codigo: "importar/dato", severidad: "error", mensaje: m })) } };
  const { capas: listaCapas, ...informe } = r.informe;
  if (salida && !junto) informe.avisos.push(`El DXF no está en la carpeta del proyecto: no va como plantilla. Para verlo detrás en la app, cópielo junto a ${basename(salida)} y añádalo desde «Plantilla DXF».`);
  const c = compilar(r.proyecto.modelo, r.proyecto.opciones);
  const json: Record<string, unknown> = { orden, ok: true, ...informe, capas: listaCapas.filter((x) => x.segmentos || x.textos) };
  if (salida) {
    writeFileSync(salida, serializar(r.proyecto), "utf8");
    json.proyecto = rel(salida);
  } else json.escrito = false;
  Object.assign(json, { valido: c.valido, ...listaDiagnosticos(c.diagnosticos.filter((x) => x.severidad === "error")) });
  return { codigo: CODIGO.bien, json };
}

/**
 * `fem alinear` (MA5, `docs/fem3d/modelado.md` §2.5 y §7): sólo propone (MA-e); con `--escribir`,
 * aplica la propuesta como el editor (`aplicar`), deja el fichero de antes en `.bak` y escribe el
 * proyecto en el formato canónico.
 */
function alinearOrden(a: Argumentos, mal: (m: string) => Salida): Salida {
  const orden = "alinear";
  const l = leer(orden, a.posicionales[0]);
  if ("codigo" in l) return l;
  const t = a.banderas.get("tolerancia")?.at(-1);
  let tol = TOLERANCIA_ALINEAR;
  if (t !== undefined) {
    const x = Number(t.replace(",", "."));
    if (!Number.isFinite(x) || x <= 0 || x > 0.2) return mal("--tolerancia tiene que ser un número positivo, en m (por defecto 0.03; como mucho 0.2).");
    tol = x;
  }
  const p = proponerAlinear(l.proyecto.modelo, tol);
  const ruta = (r: readonly (string | number)[]) => (r[0] === "x" && r.length === 1 ? "" : r.join("."));
  const json: Record<string, unknown> = {
    orden,
    ok: true,
    tolerancia: tol,
    ...(p.direccion ? { direccion: p.direccion } : {}),
    grupos: p.grupos.map((g) => ({ ...g, aviso: textoGrupo(g, p.direccion) })),
    movimientos: p.movimientos.map((x) => ({ id: x.id, coleccion: x.coleccion, ...(ruta(x.ruta) ? { punto: ruta(x.ruta) } : {}), de: x.de, a: x.a })),
    ...(p.avisos.length ? { avisos: p.avisos } : {}),
    quedan: p.quedan,
  };
  if (!a.banderas.has("escribir") || !p.operacion) {
    json.escrito = false;
    return { codigo: CODIGO.bien, json };
  }
  const r = aplicar(l.proyecto, p.operacion);
  if (!r.ok) return { codigo: CODIGO.errores, json: { ...json, ok: false, escrito: false, ...listaDiagnosticos(r.errores) } };
  writeFileSync(`${l.ruta}.bak`, readFileSync(l.ruta));
  writeFileSync(l.ruta, serializar(r.proyecto), "utf8");
  const c = compilar(r.proyecto.modelo, r.proyecto.opciones);
  Object.assign(json, { escrito: true, proyecto: rel(l.ruta), copia: rel(`${l.ruta}.bak`), huella: c.huella, valido: c.valido, ...listaDiagnosticos(c.diagnosticos.filter((x) => x.severidad === "error")) });
  return { codigo: CODIGO.bien, json };
}

/**
 * `fem vigas-borde` (MA, `docs/fem3d/modelado.md` §8): «Vigas de borde» del editor
 * (`proponerVigasBorde`) en todas las losas o en las de `--losa`, con la sección ancho × canto (por
 * defecto, 0,30 × el canto de cada losa). Como `fem alinear`, sólo propone; con `--escribir`, aplica
 * las vigas, deja el fichero de antes en `.bak` y escribe el formato canónico.
 */
function vigasBordeOrden(a: Argumentos, mal: (m: string) => Salida): Salida {
  const orden = "vigas-borde";
  const l = leer(orden, a.posicionales[0]);
  if ("codigo" in l) return l;
  const num = (k: string): number | null | undefined => {
    const t = a.banderas.get(k)?.at(-1);
    if (t === undefined) return undefined;
    const x = Number(t.replace(",", "."));
    return Number.isFinite(x) && x > 0 && x <= 3 ? x : null;
  };
  const [ancho, canto] = [num("ancho"), num("canto")];
  if (ancho === null || canto === null) return mal("--ancho y --canto tienen que ser números positivos, en m (como mucho 3).");
  const todas = l.proyecto.modelo.losas ?? [];
  const pedidas = a.banderas.get("losa") ?? todas.map((x) => x.id);
  const faltan = pedidas.filter((id) => !todas.some((x) => x.id === id));
  if (faltan.length) return mal(`No hay ninguna losa ${faltan.map((x) => `«${x}»`).join(", ")}.`);
  let proyecto = l.proyecto;
  const losas: Record<string, unknown>[] = [];
  for (const id of pedidas) {
    const losa = proyecto.modelo.losas!.find((x) => x.id === id)!;
    const p = proponerVigasBorde(proyecto.modelo, id, ancho ?? 0.3, canto ?? losa.espesor);
    if ("error" in p) {
      losas.push({ losa: id, error: p.error });
      continue;
    }
    losas.push({ losa: id, seccion: p.seccion.id, ...(p.nueva ? { seccionNueva: p.seccion } : {}), vigas: p.vigas.map((v) => ({ id: v.id, puntos: v.puntos, regla: v.regla, ...(v.pilares.length ? { pilares: v.pilares } : {}) })), ...(p.avisos.length ? { avisos: p.avisos } : {}) });
    // Las de cada losa, sobre el proyecto con las de las anteriores: sus ids y su sección no se repiten
    const op = operacionVigasBorde(proyecto.modelo, p);
    if (!op) continue;
    const r = aplicar(proyecto, op);
    if (!r.ok) return { codigo: CODIGO.errores, json: { orden, ok: false, escrito: false, losas, ...listaDiagnosticos(r.errores) } };
    proyecto = r.proyecto;
  }
  const json: Record<string, unknown> = { orden, ok: true, losas };
  if (!a.banderas.has("escribir") || proyecto === l.proyecto) {
    json.escrito = false;
    return { codigo: CODIGO.bien, json };
  }
  writeFileSync(`${l.ruta}.bak`, readFileSync(l.ruta));
  writeFileSync(l.ruta, serializar(proyecto), "utf8");
  const c = compilar(proyecto.modelo, proyecto.opciones);
  Object.assign(json, { escrito: true, proyecto: rel(l.ruta), copia: rel(`${l.ruta}.bak`), huella: c.huella, valido: c.valido, ...listaDiagnosticos(c.diagnosticos.filter((x) => x.severidad === "error")) });
  return { codigo: CODIGO.bien, json };
}

/** Cifras significativas de la salida: null (todas) con --exacto. */
export function cifrasDe(argv: readonly string[]): number | null {
  if (argv.includes("--exacto")) return null;
  const i = argv.findIndex((x) => x === "--cifras" || x.startsWith("--cifras="));
  if (i < 0) return 6;
  const v = Number(argv[i]!.includes("=") ? argv[i]!.split("=")[1] : argv[i + 1]);
  return Number.isInteger(v) && v >= 1 && v <= 17 ? v : 6;
}
