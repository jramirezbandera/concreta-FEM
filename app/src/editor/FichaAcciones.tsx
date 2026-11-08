/**
 * La ficha «Viento y sismo» (VS4, `docs/fem3d/viento-sismo.md` §3.5): las acciones del programa,
 * `acciones` del modelo, en un diálogo desde la barra de Cargas.
 *
 * - **Emplazamiento, común a los dos** (a petición del usuario, como los datos de la obra de Concreta):
 *   la provincia, el municipio (un buscador sobre la tabla del Anejo 1 de la NCSE-02; uno que no
 *   figura, sólo por su nombre) y la altitud. Debajo, lo que sale de ellos al momento: la zona eólica
 *   de la provincia y el ab y el K del municipio.
 * - **Viento:** la zona (la de la provincia o forzada), qb (la de la zona, la simplificada o escrita),
 *   la aspereza y la rasante; debajo, lo que sale en el modelo aplicado (pedido `viento`): qb, cp y
 *   cs por dirección y la fuerza de cada planta.
 * - **Sismo:** ab y K escritos (por encima de los del municipio), el terreno, μ, la importancia, Ω, la
 *   regla y la excentricidad; debajo, el emplazamiento sísmico (ac, TA, TB) y la curva del espectro.
 *
 * Cada campo lleva su «?» con lo que es y de dónde sale. «Aplicar» escribe `acciones` entera en un
 * paso de deshacer (operación `acciones`); el `ine` y la `altitud` que los ficheros de antes llevan en
 * el sismo o en el viento pasan al emplazamiento. Los textos no nombran programas comerciales.
 */
import { useEffect, useMemo, useState } from "react";
import type { AccionesEdificio, NieveEdificio, SismoEdificio, VientoEdificio } from "../../../src/compilador/fisico.ts";
import { leerNumero } from "../../../src/editor/celdas.ts";
import { ASPEREZAS, ORDEN_ASPEREZAS, ZONAS_EOLICAS, type GradoAspereza, type ZonaEolica } from "../../../src/normas/cteViento.ts";
import { provinciaPorIne } from "../../../src/normas/provincias.ts";
import { SISTEMAS_ESTRUCTURALES, type SistemaEstructural } from "../../../src/normas/ncse02.ts";
import { ZONAS_INVERNALES, type ExposicionNieve, type ZonaInvernal } from "../../../src/normas/cteNieve.ts";
import { esCapitalDeProvincia } from "../../../src/normas/provincias.ts";
import { nieveObra } from "../../../src/compilador/nieve.ts";
import { propuestaCasoNieve } from "../../../src/editor/casos.ts";
import { comoUna } from "../../../src/editor/gestores.ts";
import type { DatosSismo, DatosViento } from "../../../src/visor/programa.ts";
import { useVisor } from "../contexto.ts";
import { fmt, textoApp } from "../fmt.ts";
import { usePedido } from "../sesion/usePedido.ts";
import { Ayuda } from "../componentes/Ayuda.tsx";
import { Dialogo } from "./Dialogos.tsx";
import { CampoEmplazamiento, Etiqueta, useEmplazamiento } from "./Emplazamiento.tsx";
import { Espectro } from "./Espectro.tsx";

const NOMBRE_SISTEMA: Record<SistemaEstructural, string> = {
  "porticos-ha": "Pórticos de hormigón armado",
  "porticos-ha-pantallas": "Pórticos de hormigón con pantallas",
  "porticos-acero": "Pórticos de acero",
  "acero-triangulado": "Acero triangulado",
  fabrica: "Muros de fábrica",
};
const TERRENOS = ["I", "II", "III", "IV"] as const;
const TERRENO: Record<(typeof TERRENOS)[number], { C: string; texto: string }> = {
  I: { C: "1,0", texto: "roca compacta, suelo cementado o granular muy denso (vs > 750 m/s)" },
  II: { C: "1,3", texto: "roca muy fracturada, suelo granular denso o cohesivo duro (400–750 m/s)" },
  III: { C: "1,6", texto: "suelo granular de compacidad media o cohesivo firme (200–400 m/s)" },
  IV: { C: "2,0", texto: "suelo granular suelto o cohesivo blando (vs ≤ 200 m/s)" },
};
const DUCTILIDAD: Record<number, string> = { 1: "sin ductilidad", 2: "baja", 3: "alta", 4: "muy alta" };

/** Lo que dice el «?» de cada campo. */
const AYUDA = {
  zona: "Zona de la figura D.1 del DB SE-AE: A (vb = 26 m/s, qb = 0,42 kN/m²), B (27 m/s, 0,45) o C (29 m/s, 0,52). Por defecto, la de la provincia del emplazamiento; fuércela si la obra está al otro lado de una línea del mapa.",
  qb: "Presión dinámica del viento, qb = 0,5·δ·vb². La de la zona es el valor preciso del Anejo D; el DB admite 0,5 kN/m² en cualquier punto (art. 3.3.2-1), del lado de la seguridad en las zonas A y B y por debajo en la C. Escrita, para un estudio de viento o un dato empírico.",
  aspereza:
    "El entorno del edificio en la dirección del viento (tabla 3.4 del DB SE-AE). Decide el coeficiente de exposición ce de cada planta (fórmula D.2): a más obstáculos, menos viento. Lo habitual en edificación es el IV, zona urbana.",
  rasante:
    "Cota del terreno en la fachada a barlovento, en m (art. 3.3.3-1): desde ella se mide la altura z de cada planta para su ce. Por defecto, la ±0,00. Las plantas por debajo de la rasante no reciben viento.",
  ab: "Aceleración sísmica básica, en g (art. 2.1): 0,11 es 0,11·g. Por defecto, la del municipio del emplazamiento. Escríbala sólo con un estudio de peligrosidad del emplazamiento o si el municipio no figura en el Anejo 1.",
  K: "Coeficiente de contribución, de 1,0 a 1,3 (Anejo 1): tiene en cuenta la influencia de los terremotos lejanos (la falla Azores-Gibraltar) y alarga los periodos TA y TB. Por defecto, el del municipio.",
  terreno:
    "Terreno de cimentación (art. 2.4), del estudio geotécnico: el de los 30 primeros metros bajo la superficie. Su coeficiente C (I 1,0; II 1,3; III 1,6; IV 2,0) amplifica la aceleración (S) y alarga los periodos TA = K·C/10 y TB = K·C/2,5. Con varios estratos, el C ponderado por sus espesores.",
  mu: "Coeficiente de comportamiento por ductilidad (art. 3.7.3.1): 1 sin ductilidad, 2 baja, 3 alta, 4 muy alta. Divide las fuerzas del sismo (β = ν/μ), así que a más ductilidad, menos fuerza; pero el proyecto tiene que cumplir los detalles del capítulo 4 de la norma para esa ductilidad. Si la estructura es distinta en cada dirección, uno según X y otro según Y.",
  importancia:
    "Art. 1.2.2. Normal: su destrucción puede ocasionar víctimas o interrumpir un servicio, sin efectos catastróficos (viviendas, oficinas, comercios). Especial: tiene que seguir en servicio tras el terremoto o su destrucción tendría efectos catastróficos (hospitales, bomberos, centros de comunicaciones o de protección civil). Da el coeficiente de riesgo ρ: 1,0 o 1,3.",
  sistema:
    "Sólo para el periodo fundamental aproximado del art. 3.7.2.2, con el que se contrasta el cortante en la base del método simplificado. No cambia el cálculo por espectros.",
  omega: "Amortiguamiento de la estructura, en % del crítico (tabla 3.1 de la norma). Corrige el espectro con ν = (5/Ω)^0,4 (art. 2.5) y entra en la combinación cuadrática completa. Por defecto, 5 %.",
  regla:
    "Cómo se suman las respuestas de los modos. La del art. 3.6.2.4: raíz de la suma de los cuadrados, con los modos de periodos a menos del 10 % sumados en valor absoluto. La cuadrática completa (comentario C.3.6.2.4, la «expresión general» de la norma) usa la correlación entre modos con el amortiguamiento Ω y no depende de cómo gire la malla dos modos de igual periodo. Por defecto, la cuadrática completa.",
  excentricidad:
    "Excentricidad accidental de las masas, como fracción de la dimensión de cada planta perpendicular al sismo (art. 3.2: no menos de 1/20 = 0,05). Da los casos EX+e, EX−e, EY+e y EY−e. Con 0, sin ella.",
  zonaInvernal:
    "Zona de clima invernal de la figura E.2 del DB SE-AE, de 1 a 7. Con la altitud, da sk en la tabla E.2. Por defecto, la de la provincia (la de su capital); la figura es un mapa y sus líneas cruzan provincias: fuércela si la obra cae al otro lado.",
  origenSk:
    "De dónde sale la sobrecarga de nieve sobre terreno horizontal sk. En la capital de la provincia, la tabla 3.8 (su sk a su altitud); en cualquier otro sitio, la tabla E.2 por la zona y la altitud, interpolando. Por defecto, la 3.8 si el municipio del emplazamiento es la capital. Escrita, por la ordenanza municipal o datos empíricos (obligatorio si la altitud no está en la tabla, art. 3.5.2-3).",
  exposicion:
    "Art. 3.5.1-3: la construcción protegida de la acción del viento (rodeada de edificios más altos o de arbolado) reduce la nieve un 20 %; el emplazamiento fuertemente expuesto (en un alto, en campo abierto) la aumenta un 20 %.",
  casoNieve:
    "La nieve va en un caso de acción S, con el ψ de la altitud de la obra (DB SE, tabla 4.2): hasta 1 000 m, ψ₀ 0,5, ψ₁ 0,2 y ψ₂ 0; por encima, 0,7, 0,5 y 0,2. Sus cargas las pone usted: el programa no sabe qué es cubierta ni dónde se acumula.",
  nieve: "Art. 3.2: la masa de la nieve cuenta la mitad si permanece más de 30 días al año; si no, no cuenta. Por defecto, sí por encima de 1 000 m.",
} as const;

/** Un número escrito con coma, o nada; un texto que no es un número, con su error. */
const numeroOpcional = (t: string): number | undefined | string => (t.trim() === "" ? undefined : leerNumero(t));
const texto = (v: number | undefined): string => (v === undefined ? "" : String(v).replace(".", ","));

type Pestana = "viento" | "nieve" | "sismo";
type OrigenSk = "auto" | "capital" | "e2" | "escrita";
type ModoQb = "zona" | "simplificado" | "escrita";

export function FichaAcciones({ onCerrar, pestana: inicial = "viento", activar = false }: { onCerrar: (hecho?: string) => void; pestana?: Pestana; activar?: boolean }) {
  const { proyecto } = useVisor();
  const ed = proyecto.edicion!;
  const a = ed.proyecto.modelo.acciones ?? {};
  const [pestana, setPestana] = useState<Pestana>(inicial);
  const [error, setError] = useState<string | null>(null);

  // Emplazamiento: el de las acciones o, en un fichero de antes, el municipio del sismo y la altitud del viento
  const emp = useEmplazamiento(a);
  const { municipio, prov, nombreLibre } = emp;
  const e0 = a.emplazamiento;
  const ine0 = e0?.ine ?? a.sismo?.ine ?? "";

  // Viento: con el interruptor apagado no hay viento del programa
  const [conViento, setConViento] = useState(a.viento !== undefined || (activar && inicial === "viento"));
  const zonaInicial = a.viento?.zona && a.viento.zona !== (provinciaPorIne(e0?.provincia ?? ine0)?.zonaEolica ?? "") ? a.viento.zona : "";
  const [zonaForzada, setZonaForzada] = useState<ZonaEolica | "">(zonaInicial);
  const qb0 = a.viento?.qb;
  const [modoQb, setModoQb] = useState<ModoQb>(qb0 === undefined ? "zona" : qb0 === 0.5 ? "simplificado" : "escrita");
  const [qb, setQb] = useState(qb0 !== undefined && qb0 !== 0.5 ? texto(qb0) : "");
  const [aspereza, setAspereza] = useState<GradoAspereza>(a.viento?.aspereza ?? "IV");
  const [rasante, setRasante] = useState(texto(a.viento?.rasante));
  const zona: ZonaEolica | undefined = zonaForzada || prov?.zonaEolica;

  // Sismo
  const [conSismo, setConSismo] = useState(a.sismo !== undefined || (activar && inicial === "sismo"));
  const [ab, setAb] = useState(texto(a.sismo?.ab));
  const [K, setK] = useState(texto(a.sismo?.K));
  const t0 = a.sismo?.terreno;
  const [terreno, setTerreno] = useState<string>(typeof t0 === "string" ? t0 : typeof t0 === "number" ? "C" : Array.isArray(t0) ? "estratos" : "II");
  const [C, setC] = useState(texto(typeof t0 === "number" ? t0 : undefined));
  const mu0 = a.sismo?.mu;
  const [muX, setMuX] = useState(String(typeof mu0 === "number" ? mu0 : (mu0?.x ?? 2)));
  const [muY, setMuY] = useState(typeof mu0 === "object" && mu0.y !== mu0.x ? String(mu0.y) : "");
  const [importancia, setImportancia] = useState<"normal" | "especial">(a.sismo?.importancia ?? "normal");
  const [omega, setOmega] = useState(texto(a.sismo?.omega));
  const [regla, setRegla] = useState<"srss" | "cqc">(a.sismo?.regla ?? "cqc");
  const [excentricidad, setExcentricidad] = useState(texto(a.sismo?.excentricidad));
  const [sistema, setSistema] = useState<SistemaEstructural | "">(a.sismo?.sistema ?? "");
  const [nieve, setNieve] = useState(a.sismo?.nievePermanente ?? false);

  // Nieve: lo que se fuerza; sk sale del emplazamiento
  const [zonaInv, setZonaInv] = useState(a.nieve?.zonaInvernal !== undefined ? String(a.nieve.zonaInvernal) : "");
  const [origenSk, setOrigenSk] = useState<OrigenSk>(a.nieve?.sk !== undefined ? "escrita" : a.nieve?.capital === true ? "capital" : a.nieve?.capital === false ? "e2" : "auto");
  const [skEscrita, setSkEscrita] = useState(texto(a.nieve?.sk));
  const [exposicion, setExposicion] = useState<ExposicionNieve>(a.nieve?.exposicion ?? "normal");
  const opcionesMu = [...new Set([1, 2, 3, 4, ...[muX, muY].filter(Boolean).map(Number)])].sort((x, y) => x - y);

  /** Lo que se escribirá, o por qué no. */
  const acciones = useMemo((): { valor: AccionesEdificio | null } | { error: string } => {
    const r: AccionesEdificio = {};
    if ("error" in emp.valor) return { error: emp.valor.error };
    if (emp.valor.valor) r.emplazamiento = emp.valor.valor;

    if (conViento) {
      const v: VientoEdificio = { aspereza };
      if (zonaForzada) v.zona = zonaForzada;
      else if (!prov) return { error: "El viento necesita la provincia del emplazamiento (de ella sale la zona eólica) o la zona eólica forzada." };
      if (modoQb === "simplificado") v.qb = 0.5;
      else if (modoQb === "escrita") {
        const n = numeroOpcional(qb);
        if (typeof n !== "number") return { error: "Escriba qb en kN/m² (o elija la de la zona)." };
        v.qb = n;
      }
      const nR = numeroOpcional(rasante);
      if (typeof nR === "string") return { error: `La rasante: ${nR}.` };
      if (nR !== undefined) v.rasante = nR;
      // Las fachadas escritas a mano se conservan
      if (a.viento?.fachadas) v.fachadas = a.viento.fachadas;
      r.viento = v;
    }
    if (conSismo) {
      const s: SismoEdificio = {};
      if (a.sismo?.masas) s.masas = a.sismo.masas;
      if (nieve) s.nievePermanente = true;
      const nAb = numeroOpcional(ab);
      if (typeof nAb === "string") return { error: `ab: ${nAb}.` };
      if (nAb !== undefined) s.ab = nAb;
      const nK = numeroOpcional(K);
      if (typeof nK === "string") return { error: `K: ${nK}.` };
      if (nK !== undefined) s.K = nK;
      if (s.ab !== undefined && s.K === undefined && !municipio) return { error: "Con ab escrita y sin un municipio del Anejo 1 hace falta también K." };
      const conEspectro = municipio !== null || s.ab !== undefined;
      if (conEspectro) {
        if (terreno === "C") {
          const n = numeroOpcional(C);
          if (typeof n !== "number") return { error: "El coeficiente C del terreno necesita un número (de 1 a 2)." };
          s.terreno = n;
        } else if (terreno === "estratos") {
          if (!Array.isArray(t0)) return { error: "Los estratos del terreno se escriben en el fichero (acciones.sismo.terreno)." };
          s.terreno = t0;
        } else s.terreno = terreno as "I" | "II" | "III" | "IV";
        const x = Number(muX);
        const y = muY === "" ? x : Number(muY);
        s.mu = y === x ? x : { x, y };
        if (importancia !== "normal") s.importancia = importancia;
        for (const [nombre, t, poner] of [
          ["Ω", omega, (n: number) => (s.omega = n)],
          ["La excentricidad", excentricidad, (n: number) => (s.excentricidad = n)],
        ] as const) {
          const n = numeroOpcional(t);
          if (typeof n === "string") return { error: `${nombre}: ${n}.` };
          if (n !== undefined) poner(n);
        }
        if (regla !== "cqc") s.regla = regla;
        if (sistema) s.sistema = sistema;
      }
      r.sismo = s;
    }
    const nv: NieveEdificio = {};
    if (zonaInv) nv.zonaInvernal = Number(zonaInv) as ZonaInvernal;
    if (origenSk === "capital") nv.capital = true;
    else if (origenSk === "e2") nv.capital = false;
    else if (origenSk === "escrita") {
      const n = numeroOpcional(skEscrita);
      if (typeof n !== "number" || !(n > 0)) return { error: "Escriba sk en kN/m² (o elija una tabla)." };
      nv.sk = n;
    }
    if (exposicion !== "normal") nv.exposicion = exposicion;
    if (Object.keys(nv).length) r.nieve = nv;
    return { valor: r.viento || r.sismo || r.emplazamiento || r.nieve ? r : null };
  }, [emp.valor, municipio, conViento, zonaForzada, prov, aspereza, modoQb, qb, rasante, a, conSismo, nieve, ab, K, terreno, C, t0, muX, muY, importancia, omega, excentricidad, regla, sistema, zonaInv, origenSk, skEscrita, exposicion]);

  // Lo que sale en el modelo aplicado (la sesión del worker tiene el proyecto guardado): lo escrito se ve al aplicar
  const viento = usePedido(proyecto.cliente, { tipo: "viento" });
  const sismo = usePedido(proyecto.cliente, { tipo: "sismo" });
  const cambiado = JSON.stringify("valor" in acciones ? (acciones.valor ?? {}) : null) !== JSON.stringify(a);

  // La nieve de lo escrito, al momento (no pide nada al worker), y el caso que pide su altitud
  const modeloAhora = ed.proyecto.modelo;
  const nieveCalc = useMemo(() => ("valor" in acciones ? nieveObra({ ...modeloAhora, acciones: acciones.valor ?? {} }) : null), [acciones, modeloAhora]);
  const casoNieve = useMemo(() => propuestaCasoNieve(modeloAhora, nieveCalc?.nieve?.psi ?? null), [modeloAhora, nieveCalc]);
  const [hechoCaso, setHechoCaso] = useState<string | null>(null);
  const arreglarCasoNieve = () => {
    if (!casoNieve || !casoNieve.operaciones.length) return;
    const r = ed.editar(comoUna(casoNieve.operaciones), casoNieve.estado === "falta" ? `Caso de nieve ${casoNieve.casos.join(", ")}` : `ψ de la nieve en ${casoNieve.casos.join(", ")}`);
    if (!r.ok) return setError(r.errores.map((x) => textoApp(x.mensaje)).join(" "));
    setHechoCaso(casoNieve.estado === "falta" ? `Creado el caso ${casoNieve.casos.join(", ")}: elíjalo como caso activo para poner sus cargas.` : `Cambiado el ψ de ${casoNieve.casos.join(", ")}.`);
  };
  const nombreObra = municipio?.nombre ?? nombreLibre;
  const esCapitalAuto = !!(prov && nombreObra && esCapitalDeProvincia(prov.ine, nombreObra));

  const aplicar = () => {
    if ("error" in acciones) return setError(acciones.error);
    const r = ed.editar({ op: "acciones", acciones: acciones.valor }, "Viento y sismo");
    if (!r.ok) return setError(r.errores.map((e) => textoApp(e.mensaje)).join(" "));
    onCerrar(acciones.valor?.viento || acciones.valor?.sismo ? "Viento y sismo del programa aplicados: los casos salen en el selector." : acciones.valor ? "Emplazamiento aplicado." : "Sin acciones del programa.");
  };

  useEffect(() => setError(null), [acciones]);

  return (
    <Dialogo
      titulo="Viento, nieve y sismo"
      onCerrar={() => onCerrar()}
      alConfirmar={aplicar}
      clase="dialogo-ancho"
      pendiente={cambiado ? "Hay cambios sin aplicar." : null}
      pie={
        <>
          {error && <span className="mr-auto text-state-fail">{error}</span>}
          {"error" in acciones && !error && <span className="mr-auto text-state-warn">{acciones.error}</span>}
          <button type="button" className="btn" onClick={() => onCerrar()}>
            Cancelar
          </button>
          <button type="button" className="btn btn-p" onClick={aplicar} disabled={"error" in acciones}>
            Aplicar
          </button>
        </>
      }
    >
      <CampoEmplazamiento e={emp} />

      <div role="tablist" className="mb-3 mt-4 flex gap-1 border-b border-border-main">
        {(["viento", "nieve", "sismo"] as const).map((p) => (
          <button key={p} type="button" role="tab" aria-selected={pestana === p} className="dock-tab" data-on={pestana === p} onClick={() => setPestana(p)}>
            {p === "viento" ? "Viento" : p === "nieve" ? "Nieve" : "Sismo"}
          </button>
        ))}
      </div>
      {pestana === "viento" ? (
        <div className="grid gap-3">
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-[3px]" checked={conViento} onChange={(e) => setConViento(e.target.checked)} />
            <span>
              Viento del programa (DB SE-AE 3.3 y Anejo D)
              <span className="block text-[12px] text-text-secondary">8 casos: según X y según Y en los dos sentidos, cada uno con la excentricidad del 5 % a un lado y al otro. Una fuerza por planta, en su diafragma.</span>
            </span>
          </label>
          {conViento && (
            <>
              <div className="acc-form">
                <Etiqueta htmlFor="v-zona" ayuda={AYUDA.zona}>
                  Zona eólica
                </Etiqueta>
                <span className="flex flex-wrap items-center gap-2">
                  <select id="v-zona" className="sel" value={zonaForzada} onChange={(e) => setZonaForzada(e.target.value as ZonaEolica | "")}>
                    <option value="">{prov ? `La de la provincia: ${prov.zonaEolica} · vb ${ZONAS_EOLICAS[prov.zonaEolica].vb} m/s` : "La de la provincia (elíjala arriba)"}</option>
                    {(Object.keys(ZONAS_EOLICAS) as ZonaEolica[]).map((z) => (
                      <option key={z} value={z}>
                        {z} · vb = {ZONAS_EOLICAS[z].vb} m/s, qb = {fmt(ZONAS_EOLICAS[z].qb, 2)} kN/m² (forzada)
                      </option>
                    ))}
                  </select>
                  {zonaForzada && prov && zonaForzada !== prov.zonaEolica && <span className="text-[12px] text-state-warn">la de {prov.nombre} es {prov.zonaEolica}</span>}
                </span>
                <Etiqueta htmlFor="v-qb" ayuda={AYUDA.qb}>
                  Presión dinámica qb
                </Etiqueta>
                <span className="flex flex-wrap items-center gap-2">
                  <select id="v-qb" className="sel" value={modoQb} onChange={(e) => setModoQb(e.target.value as ModoQb)}>
                    <option value="zona">La de la zona{zona ? `: ${fmt(ZONAS_EOLICAS[zona].qb, 2)} kN/m²` : ""}</option>
                    <option value="simplificado">Simplificada del art. 3.3.2-1: 0,50 kN/m²</option>
                    <option value="escrita">Escrita</option>
                  </select>
                  {modoQb === "escrita" && (
                    <>
                      <input className="sel mono w-[6rem]" aria-label="qb escrita" value={qb} inputMode="decimal" onChange={(e) => setQb(e.target.value)} />
                      <span className="text-text-secondary">kN/m²</span>
                    </>
                  )}
                </span>
                <Etiqueta htmlFor="v-asp" ayuda={AYUDA.aspereza}>
                  Entorno (aspereza)
                </Etiqueta>
                <select id="v-asp" className="sel" value={aspereza} onChange={(e) => setAspereza(e.target.value as GradoAspereza)} title={ASPEREZAS[aspereza].descripcion}>
                  {ORDEN_ASPEREZAS.map((g) => (
                    <option key={g} value={g}>
                      {g} · {ASPEREZAS[g].descripcion}
                    </option>
                  ))}
                </select>
                <Etiqueta htmlFor="v-ras" ayuda={AYUDA.rasante}>
                  Rasante
                </Etiqueta>
                <span className="flex items-center gap-2">
                  <input id="v-ras" className="sel mono w-[7rem]" value={rasante} inputMode="decimal" placeholder="±0,00" onChange={(e) => setRasante(e.target.value)} />
                  <span className="text-text-secondary">m, cota del terreno a barlovento</span>
                </span>
              </div>
              <ResumenViento d={viento.datos ?? null} aplicado={!cambiado} />
            </>
          )}
        </div>
      ) : pestana === "nieve" ? (
        <div className="grid gap-3">
          <p className="nota acc-nota">
            La nieve no genera casos ni cargas: el programa da sk desde el emplazamiento y usted pone las cargas en el caso de nieve, en las cubiertas y donde se acumula. Al dibujar una carga de superficie en ese caso, su plantilla propone q = μ·sk.
          </p>
          <div className="acc-form">
            <Etiqueta htmlFor="n-zona" ayuda={AYUDA.zonaInvernal}>
              Zona de clima invernal
            </Etiqueta>
            <span className="flex flex-wrap items-center gap-2">
              <select id="n-zona" className="sel" value={zonaInv} onChange={(e) => setZonaInv(e.target.value)}>
                <option value="">{prov ? `La de la provincia: ${prov.zonaInvernal}` : "La de la provincia (elíjala arriba)"}</option>
                {ZONAS_INVERNALES.map((z) => (
                  <option key={z} value={String(z)}>
                    Zona {z} (forzada)
                  </option>
                ))}
              </select>
              {zonaInv && prov && Number(zonaInv) !== prov.zonaInvernal && <span className="text-[12px] text-state-warn">la de {prov.nombre} es {prov.zonaInvernal}</span>}
            </span>
            <Etiqueta htmlFor="n-sk" ayuda={AYUDA.origenSk}>
              sk, de dónde sale
            </Etiqueta>
            <span className="flex flex-wrap items-center gap-2">
              <select id="n-sk" className="sel" value={origenSk} onChange={(e) => setOrigenSk(e.target.value as OrigenSk)}>
                <option value="auto">{esCapitalAuto ? `Tabla 3.8: la obra está en la capital (${prov?.capital.capital})` : "Tabla E.2, por la zona y la altitud"}</option>
                <option value="capital">Tabla 3.8, la capital{prov ? ` (${prov.capital.capital}, ${prov.capital.altitud} m)` : ""}</option>
                <option value="e2">Tabla E.2, por la zona y la altitud</option>
                <option value="escrita">Escrita</option>
              </select>
              {origenSk === "escrita" && (
                <>
                  <input className="sel mono w-[6rem]" aria-label="sk escrita" value={skEscrita} inputMode="decimal" onChange={(e) => setSkEscrita(e.target.value)} />
                  <span className="text-text-secondary">kN/m²</span>
                </>
              )}
            </span>
            <Etiqueta htmlFor="n-exp" ayuda={AYUDA.exposicion}>
              Exposición
            </Etiqueta>
            <select id="n-exp" className="sel" value={exposicion} onChange={(e) => setExposicion(e.target.value as ExposicionNieve)}>
              <option value="normal">Normal</option>
              <option value="protegida">Protegida del viento (−20 %)</option>
              <option value="expuesta">Fuertemente expuesta (+20 %)</option>
            </select>
          </div>
          {nieveCalc && !nieveCalc.nieve && <p className="nota acc-nota text-state-warn">{nieveCalc.motivo}</p>}
          {nieveCalc?.nieve && (
            <>
              <h4 className="acc-titulo">Lo que sale</h4>
              <dl className="acc-cifras">
                <Cifra n="sk" v={nieveCalc.nieve.sk === null ? "fuera de tabla" : `${fmt(nieveCalc.nieve.sk, 2)} kN/m²`} t={nieveCalc.nieve.skOrigen === "escrita" ? "Escrita" : nieveCalc.nieve.skOrigen === "tabla3.8" ? `Tabla 3.8, ${nieveCalc.nieve.capital?.nombre}` : `Tabla E.2, zona ${nieveCalc.nieve.zona} a ${nieveCalc.nieve.altitud} m`} />
                <Cifra n="Origen" v={nieveCalc.nieve.skOrigen === "escrita" ? "escrita" : nieveCalc.nieve.skOrigen === "tabla3.8" ? "tabla 3.8" : `E.2, zona ${nieveCalc.nieve.zona}`} />
                <Cifra n="Exposición" v={`×${fmt(nieveCalc.nieve.factor, 1)}`} t="Art. 3.5.1-3" />
                <Cifra n="qn plana" v={nieveCalc.nieve.qnPlana === null ? "—" : `${fmt(nieveCalc.nieve.qnPlana, 2)} kN/m²`} t="μ·sk con μ = 1: cubierta plana o de hasta 30° (art. 3.5.3); de 30° a 60°, μ baja hasta 0" />
                <Cifra n="ψ del caso" v={nieveCalc.nieve.psi === null ? "—" : nieveCalc.nieve.psi === "nieve-mas-de-1000" ? "más de 1 000 m" : "hasta 1 000 m"} t="DB SE, tabla 4.2, por la altitud de la obra" />
              </dl>
              {nieveCalc.nieve.frontera && <p className="nota acc-nota text-state-warn">Zona de clima invernal: {nieveCalc.nieve.frontera}</p>}
              {nieveCalc.nieve.notas.map((x) => (
                <p key={x} className="nota acc-nota">
                  {x}
                </p>
              ))}
            </>
          )}
          <div className="acc-caso">
            <span className="acc-etq">
              <b>Caso de nieve</b>
              <Ayuda texto={AYUDA.casoNieve} />
            </span>
            {!casoNieve ? (
              <span className="text-text-secondary">Con la altitud del emplazamiento se sabe qué ψ lleva.</span>
            ) : casoNieve.estado === "ok" ? (
              <span>{casoNieve.casos.join(", ")}, con el ψ de su altitud. Póngale las cargas en Cargas, con él como caso activo.</span>
            ) : casoNieve.estado === "falta" ? (
              <>
                <span>No hay ningún caso de nieve.</span>
                <button type="button" className="btn" onClick={arreglarCasoNieve}>
                  Crear «{casoNieve.tipico.caso.nombre}»
                </button>
              </>
            ) : (
              <>
                <span className="text-state-warn">{casoNieve.casos.join(", ")} lleva el ψ de la otra altitud.</span>
                <button type="button" className="btn" onClick={arreglarCasoNieve}>
                  Cambiarle el ψ
                </button>
              </>
            )}
          </div>
          {hechoCaso && <p className="nota acc-nota text-state-pass">{hechoCaso}</p>}
          <p className="nota acc-nota">
            A mano, porque dependen de la cubierta: μ en faldones de más de 30° (μ = 1 hasta 30° y 0 desde 60°, art. 3.5.3), la distribución asimétrica (μ/2 donde la nieve es favorable), las acumulaciones junto a petos, limahoyas y cambios de nivel (art. 3.5.4) y, por encima de 1 000 m, el hielo en los voladizos.
          </p>
        </div>
      ) : (
        <div className="grid gap-3">
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-[3px]" checked={conSismo} onChange={(e) => setConSismo(e.target.checked)} />
            <span>
              Sismo (NCSE-02)
              <span className="block text-[12px] text-text-secondary">Las masas salen de las cargas y se calculan los modos de vibración. Con el emplazamiento, el análisis por espectros de respuesta (art. 3.6.2): 4 casos, EX±e y EY±e.</span>
            </span>
          </label>
          {conSismo && (
            <>
              <div className="acc-form">
                <Etiqueta htmlFor="s-ab" ayuda={AYUDA.ab}>
                  ab escrita
                </Etiqueta>
                <span className="flex items-center gap-2">
                  <input id="s-ab" className="sel mono w-[7rem]" value={ab} inputMode="decimal" placeholder={municipio ? fmt(municipio.ab, 2) : "—"} onChange={(e) => setAb(e.target.value)} />
                  <span className="text-text-secondary">g{municipio && !ab.trim() ? ", la del municipio" : ""}</span>
                </span>
                <Etiqueta htmlFor="s-k" ayuda={AYUDA.K}>
                  K escrito
                </Etiqueta>
                <span className="flex items-center gap-2">
                  <input id="s-k" className="sel mono w-[7rem]" value={K} inputMode="decimal" placeholder={municipio ? fmt(municipio.K, 1) : "—"} onChange={(e) => setK(e.target.value)} />
                  {municipio && !K.trim() && <span className="text-text-secondary">el del municipio</span>}
                </span>
                <Etiqueta htmlFor="s-terr" ayuda={AYUDA.terreno}>
                  Terreno (art. 2.4)
                </Etiqueta>
                <span className="flex items-center gap-2">
                  <select id="s-terr" className="sel min-w-0 flex-1" value={terreno} onChange={(e) => setTerreno(e.target.value)} title={terreno in TERRENO ? TERRENO[terreno as keyof typeof TERRENO].texto : undefined}>
                    {TERRENOS.map((t) => (
                      <option key={t} value={t}>
                        Tipo {t} · C = {TERRENO[t].C} · {TERRENO[t].texto}
                      </option>
                    ))}
                    <option value="C">Coeficiente C escrito</option>
                    {Array.isArray(t0) && <option value="estratos">Los estratos del fichero (C ponderado en 30 m)</option>}
                  </select>
                  {terreno === "C" && <input className="sel mono w-[6rem]" aria-label="Coeficiente C" value={C} inputMode="decimal" onChange={(e) => setC(e.target.value)} />}
                </span>
                <Etiqueta htmlFor="s-mu" ayuda={AYUDA.mu}>
                  Ductilidad μ
                </Etiqueta>
                <span className="flex flex-wrap items-center gap-2">
                  <select id="s-mu" className="sel" value={muX} onChange={(e) => setMuX(e.target.value)}>
                    {opcionesMu.map((m) => (
                      <option key={m} value={String(m)}>
                        {fmt(m, m % 1 ? 1 : 0)}
                        {DUCTILIDAD[m] ? ` · ${DUCTILIDAD[m]}` : ""}
                      </option>
                    ))}
                  </select>
                  <span className="text-text-secondary">según Y</span>
                  <select className="sel" aria-label="μ según Y" value={muY} onChange={(e) => setMuY(e.target.value)}>
                    <option value="">la misma</option>
                    {opcionesMu.map((m) => (
                      <option key={m} value={String(m)}>
                        {fmt(m, m % 1 ? 1 : 0)}
                        {DUCTILIDAD[m] ? ` · ${DUCTILIDAD[m]}` : ""}
                      </option>
                    ))}
                  </select>
                </span>
                <Etiqueta htmlFor="s-imp" ayuda={AYUDA.importancia}>
                  Importancia
                </Etiqueta>
                <select id="s-imp" className="sel" value={importancia} onChange={(e) => setImportancia(e.target.value as "normal" | "especial")}>
                  <option value="normal">Normal · ρ = 1,0</option>
                  <option value="especial">Especial · ρ = 1,3</option>
                </select>
                <Etiqueta htmlFor="s-sis" ayuda={AYUDA.sistema}>
                  Sistema estructural
                </Etiqueta>
                <select id="s-sis" className="sel" value={sistema} onChange={(e) => setSistema(e.target.value as SistemaEstructural | "")}>
                  <option value="">— (sin contrastar con el método simplificado)</option>
                  {SISTEMAS_ESTRUCTURALES.map((s) => (
                    <option key={s} value={s}>
                      {NOMBRE_SISTEMA[s]}
                    </option>
                  ))}
                </select>
                <Etiqueta htmlFor="s-om" ayuda={AYUDA.omega}>
                  Amortiguamiento Ω
                </Etiqueta>
                <span className="flex items-center gap-2">
                  <input id="s-om" className="sel mono w-[7rem]" value={omega} inputMode="decimal" placeholder="5" onChange={(e) => setOmega(e.target.value)} />
                  <span className="text-text-secondary">% del crítico</span>
                </span>
                <Etiqueta htmlFor="s-reg" ayuda={AYUDA.regla}>
                  Combinación de modos
                </Etiqueta>
                <select id="s-reg" className="sel" value={regla} onChange={(e) => setRegla(e.target.value as "srss" | "cqc")}>
                  <option value="cqc">Cuadrática completa (comentario C.3.6.2.4)</option>
                  <option value="srss">La del art. 3.6.2.4 (raíz de la suma de los cuadrados)</option>
                </select>
                <Etiqueta htmlFor="s-exc" ayuda={AYUDA.excentricidad}>
                  Excentricidad accidental
                </Etiqueta>
                <span className="flex items-center gap-2">
                  <input id="s-exc" className="sel mono w-[7rem]" value={excentricidad} inputMode="decimal" placeholder="0,05" onChange={(e) => setExcentricidad(e.target.value)} />
                  <span className="text-text-secondary">de la dimensión de la planta (1/20)</span>
                </span>
                <span />
                <span className="flex items-center gap-2">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={nieve} onChange={(e) => setNieve(e.target.checked)} /> La nieve permanece más de 30 días al año
                  </label>
                  <Ayuda texto={AYUDA.nieve} />
                </span>
              </div>
              <ResumenSismo d={sismo.datos ?? null} aplicado={!cambiado} />
            </>
          )}
        </div>
      )}
    </Dialogo>
  );
}

/** Una cifra con su nombre y, al pasar el ratón, lo que es. */
function Cifra({ n, v, t }: { n: string; v: string; t?: string }) {
  return (
    <div title={t}>
      <dt>{n}</dt>
      <dd>{v}</dd>
    </div>
  );
}

/** Lo que el viento del programa da en el modelo de la sesión. */
function ResumenViento({ d, aplicado }: { d: DatosViento | null; aplicado: boolean }) {
  if (!d) return <p className="nota">…</p>;
  if (!d.definido) return <p className="nota acc-nota">Lo que sale de estos datos se ve al aplicarlos.</p>;
  const v = d.viento;
  return (
    <div className="grid gap-2">
      <h4 className="acc-titulo">Lo que da en el modelo{!aplicado && <span className="text-state-warn"> · lo aplicado: pulse «Aplicar» para ver lo de estos datos</span>}</h4>
      {d.errores.map((p) => (
        <p key={p.codigo + p.mensaje} className="nota acc-nota text-state-fail">
          {textoApp(p.mensaje)}
        </p>
      ))}
      {d.avisos.map((p) => (
        <p key={p.codigo + p.mensaje} className="nota acc-nota text-state-warn">
          {textoApp(p.mensaje)}
        </p>
      ))}
      {v && (
        <>
          <dl className="acc-cifras">
            <Cifra n="qb" v={`${fmt(v.qb, 3)} kN/m²`} t={v.qbOrigen === "zona" ? `De la zona ${v.zona}${v.zonaOrigen === "provincia" && v.provincia ? `, la de ${v.provincia.nombre}` : ""}` : v.qbOrigen === "dada" ? "Escrita" : "Simplificada (art. 3.3.2-1)"} />
            <Cifra n="Zona" v={`${v.zona}${v.zonaOrigen === "provincia" ? " (provincia)" : " (escrita)"}`} />
            <Cifra n="Aspereza" v={v.aspereza} t={ASPEREZAS[v.aspereza].descripcion} />
            <Cifra n="Altura" v={`${fmt(v.altura, 2)} m`} t="De la rasante a la planta más alta con viento" />
          </dl>
          <table className="tb">
            <thead>
              <tr>
                <th>Viento</th>
                <th title="Dimensión del edificio en la dirección del viento">Fondo m</th>
                <th title="Altura entre fondo: decide cp y cs (tabla 3.5 del DB SE-AE)">Esbeltez</th>
                <th title="Coeficiente eólico de presión, en la fachada a barlovento">cp</th>
                <th title="Coeficiente eólico de succión, en la fachada a sotavento">cs</th>
                <th title="Excentricidad: el 5 % del ancho de la fachada">±e m</th>
              </tr>
            </thead>
            <tbody>
              {[v.x, v.y].map((dir) => (
                <tr key={dir.eje}>
                  <td>según {dir.eje}</td>
                  <td>{fmt(dir.profundidad, 2)}</td>
                  <td>{fmt(dir.esbeltez, 2)}</td>
                  <td>{fmt(dir.cp, 2)}</td>
                  <td>{fmt(dir.cs, 2)}</td>
                  <td>{fmt(dir.e, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="tb">
            <thead>
              <tr>
                <th>Planta</th>
                <th title="Altura sobre la rasante">z m</th>
                <th title="Coeficiente de exposición a esa altura (fórmula D.2)">ce</th>
                <th title="Presión estática qe = qb·ce">qe kN/m²</th>
                <th title="Fachada de la banda de la planta perpendicular a X">Área X m²</th>
                <th title="F = (cp − cs)·qe·A">F según X kN</th>
                <th title="Fachada de la banda de la planta perpendicular a Y">Área Y m²</th>
                <th title="F = (cp − cs)·qe·A">F según Y kN</th>
              </tr>
            </thead>
            <tbody>
              {v.x.plantas.map((p, i) => {
                const py = v.y.plantas[i];
                return (
                  <tr key={p.planta}>
                    <td>{p.planta}</td>
                    <td>{fmt(p.z, 2)}</td>
                    <td>{fmt(p.ce, 3)}</td>
                    <td>{fmt(p.qe, 3)}</td>
                    <td>
                      {fmt(p.area, 1)}
                      {p.dada && <small> escrita</small>}
                    </td>
                    <td>{fmt(p.F, 2)}</td>
                    <td>{py ? fmt(py.area, 1) : "—"}</td>
                    <td>{py ? fmt(py.F, 2) : "—"}</td>
                  </tr>
                );
              })}
              <tr className="acc-total">
                <td>Σ</td>
                <td colSpan={4} />
                <td>{fmt(v.x.plantas.reduce((t, p) => t + p.F, 0), 2)}</td>
                <td />
                <td>{fmt(v.y.plantas.reduce((t, p) => t + p.F, 0), 2)}</td>
              </tr>
            </tbody>
          </table>
          <p className="nota acc-nota">Cada caso lleva una puntual por planta en el centro de su banda, desplazada ±e, al diafragma de la planta.</p>
        </>
      )}
    </div>
  );
}

/** El espectro del emplazamiento y, con resultados, el cortante en la base. */
function ResumenSismo({ d, aplicado }: { d: DatosSismo | null; aplicado: boolean }) {
  if (!d) return <p className="nota">…</p>;
  if (!d.definido) return <p className="nota acc-nota">Sin emplazamiento (un municipio del Anejo 1 o ab escrita) sólo se calculan las masas y los modos. Lo que sale de estos datos se ve al aplicarlos.</p>;
  const e = d.espectro;
  const mu = e ? `${fmt(e.mu[0], 0)}${e.mu[1] !== e.mu[0] ? ` / ${fmt(e.mu[1], 0)}` : ""}` : "";
  const beta = e ? `${fmt(e.beta[0], 3)}${e.beta[1] !== e.beta[0] ? ` / ${fmt(e.beta[1], 3)}` : ""}` : "";
  return (
    <div className="grid gap-2">
      <h4 className="acc-titulo">Lo que da en el modelo{!aplicado && <span className="text-state-warn"> · lo aplicado: pulse «Aplicar» para ver lo de estos datos</span>}</h4>
      {d.problemas.map((p) => (
        <p key={p.codigo + p.mensaje} className={`nota acc-nota ${p.severidad === "error" ? "text-state-fail" : "text-state-warn"}`}>
          {textoApp(p.mensaje)}
        </p>
      ))}
      {e && (
        <dl className="acc-cifras">
          <Cifra n="ab" v={`${fmt(e.emplazamiento.ab, 2)} g`} t={e.municipio ? `${e.municipio.nombre} (${e.municipio.provincia})` : "Escrita"} />
          <Cifra n="K" v={fmt(e.emplazamiento.K, 1)} t="Coeficiente de contribución" />
          <Cifra n="C" v={`${fmt(e.emplazamiento.C, 2)} (${e.terreno})`} t="Coeficiente del terreno" />
          <Cifra n="S" v={fmt(e.emplazamiento.S, 3)} t="Coeficiente de amplificación del terreno (art. 2.2)" />
          <Cifra n="ρ" v={fmt(e.emplazamiento.rho, 1)} t="Coeficiente de riesgo, por la importancia" />
          <Cifra n="ac" v={`${fmt(e.emplazamiento.ac, 3)} g`} t="Aceleración sísmica de cálculo, ac = S·ρ·ab (art. 2.2)" />
          <Cifra n="TA · TB" v={`${fmt(e.emplazamiento.TA, 3)} · ${fmt(e.emplazamiento.TB, 3)} s`} t="Periodos característicos del espectro: TA = K·C/10, TB = K·C/2,5" />
          <Cifra n="ν" v={fmt(e.nu, 3)} t={`Factor de amortiguamiento, (5/Ω)^0,4 con Ω = ${fmt(e.omega, 0)} %`} />
          <Cifra n="μ" v={mu} t="Ductilidad según X / según Y" />
          <Cifra n="β" v={beta} t="Coeficiente de respuesta β = ν/μ" />
        </dl>
      )}
      {d.curva && e && <Espectro curva={d.curva} periodos={d.periodos} TA={e.emplazamiento.TA} TB={e.emplazamiento.TB} ac={e.emplazamiento.ac} />}
      {d.resultado && (
        <p className="nota acc-nota">
          Con el cálculo: cortante en la base según X {fmt(d.resultado.direcciones[0]!.cortanteBasal, 1)} kN ({fmt(100 * d.resultado.direcciones[0]!.coeficienteSismico, 1)} % del peso sísmico, {fmt(d.resultado.peso, 0)} kN), según Y {fmt(d.resultado.direcciones[1]!.cortanteBasal, 1)} kN ({fmt(100 * d.resultado.direcciones[1]!.coeficienteSismico, 1)} %). El detalle, en Resultados · Modal.
        </p>
      )}
      {d.motivo && <p className="nota acc-nota">{textoApp(d.motivo)}</p>}
    </div>
  );
}
