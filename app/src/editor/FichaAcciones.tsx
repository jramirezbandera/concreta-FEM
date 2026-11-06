/**
 * La ficha «Viento y sismo» (VS4, `docs/fem3d/viento-sismo.md` §3.5): las acciones del programa,
 * `acciones.viento` y `acciones.sismo` del modelo, en un diálogo desde la barra de Cargas.
 *
 * - Viento: la zona eólica (o qb escrita), la aspereza, la altitud y la rasante; debajo, lo que sale
 *   de ellas en el modelo de ahora (pedido `viento`): qb, cp y cs, y la fuerza de cada planta según X
 *   y según Y, con el área de su banda. Se calcula sin calcular: cambia con cada dato.
 * - Sismo: el municipio (un buscador sobre la tabla del Anejo 1 de la NCSE-02; ab y K a mano,
 *   por encima), el terreno, μ, la importancia, Ω, la regla y la excentricidad; debajo, el
 *   emplazamiento (ac, TA, TB) y la curva del espectro (pedido `sismo`), con los periodos de los
 *   modos si hay resultados.
 *
 * «Aplicar» escribe `acciones` entera en un paso de deshacer (operación `acciones`); lo que no vale
 * lo dice el compilador en Diagnósticos. Los textos no nombran programas comerciales.
 */
import { useEffect, useMemo, useState } from "react";
import type { AccionesEdificio, SismoEdificio, VientoEdificio } from "../../../src/compilador/fisico.ts";
import { leerNumero } from "../../../src/editor/celdas.ts";
import { ASPEREZAS, ORDEN_ASPEREZAS, ZONAS_EOLICAS, type GradoAspereza, type ZonaEolica } from "../../../src/normas/cteViento.ts";
import { buscarMunicipios, municipioPorIne, textoProcedencia, type Municipio } from "../../../src/normas/peligrosidad.ts";
import { provinciaPorIne } from "../../../src/normas/provincias.ts";
import { SISTEMAS_ESTRUCTURALES, type SistemaEstructural } from "../../../src/normas/ncse02.ts";
import type { DatosSismo, DatosViento } from "../../../src/visor/programa.ts";
import { useVisor } from "../contexto.ts";
import { fmt, textoApp } from "../fmt.ts";
import { usePedido } from "../sesion/usePedido.ts";
import { Dialogo } from "./Dialogos.tsx";

const NOMBRE_SISTEMA: Record<SistemaEstructural, string> = {
  "porticos-ha": "Pórticos de hormigón armado",
  "porticos-ha-pantallas": "Pórticos de hormigón con pantallas",
  "porticos-acero": "Pórticos de acero",
  "acero-triangulado": "Acero triangulado",
  fabrica: "Muros de fábrica",
};
const TERRENOS = ["I", "II", "III", "IV"] as const;
const DESCRIPCION_TERRENO: Record<(typeof TERRENOS)[number], string> = {
  I: "roca compacta, suelo cementado o granular muy denso (vs > 750 m/s)",
  II: "roca muy fracturada, suelo granular denso o cohesivo duro (400–750 m/s)",
  III: "suelo granular de compacidad media o cohesivo firme (200–400 m/s)",
  IV: "suelo granular suelto o cohesivo blando (vs ≤ 200 m/s)",
};

/** Un número escrito con coma, o nada; un texto que no es un número, con su error. */
const numeroOpcional = (t: string): number | undefined | string => (t.trim() === "" ? undefined : leerNumero(t));
const texto = (v: number | undefined): string => (v === undefined ? "" : String(v).replace(".", ","));

type Pestana = "viento" | "sismo";

export function FichaAcciones({ onCerrar, pestana: inicial = "viento" }: { onCerrar: (hecho?: string) => void; pestana?: Pestana }) {
  const { proyecto } = useVisor();
  const ed = proyecto.edicion!;
  const a = ed.proyecto.modelo.acciones ?? {};
  const [pestana, setPestana] = useState<Pestana>(inicial);
  const [error, setError] = useState<string | null>(null);

  // Viento: con el interruptor apagado no hay viento del programa
  const [conViento, setConViento] = useState(a.viento !== undefined);
  const [zona, setZona] = useState<ZonaEolica>(a.viento?.zona ?? "A");
  const [qb, setQb] = useState(texto(a.viento?.qb));
  const [aspereza, setAspereza] = useState<GradoAspereza>(a.viento?.aspereza ?? "IV");
  const [altitud, setAltitud] = useState(texto(a.viento?.altitud));
  const [rasante, setRasante] = useState(texto(a.viento?.rasante));

  // Sismo
  const [conSismo, setConSismo] = useState(a.sismo !== undefined);
  const [ine, setIne] = useState(a.sismo?.ine ?? "");
  const [busqueda, setBusqueda] = useState("");
  const [ab, setAb] = useState(texto(a.sismo?.ab));
  const [K, setK] = useState(texto(a.sismo?.K));
  const t0 = a.sismo?.terreno;
  const [terreno, setTerreno] = useState<string>(typeof t0 === "string" ? t0 : typeof t0 === "number" ? "C" : Array.isArray(t0) ? "estratos" : "II");
  const [C, setC] = useState(texto(typeof t0 === "number" ? t0 : undefined));
  const mu0 = a.sismo?.mu;
  const [muX, setMuX] = useState(texto(typeof mu0 === "number" ? mu0 : mu0?.x));
  const [muY, setMuY] = useState(texto(typeof mu0 === "number" ? undefined : mu0?.y));
  const [importancia, setImportancia] = useState<"normal" | "especial">(a.sismo?.importancia ?? "normal");
  const [omega, setOmega] = useState(texto(a.sismo?.omega));
  const [regla, setRegla] = useState<"srss" | "cqc">(a.sismo?.regla ?? "srss");
  const [excentricidad, setExcentricidad] = useState(texto(a.sismo?.excentricidad));
  const [sistema, setSistema] = useState<SistemaEstructural | "">(a.sismo?.sistema ?? "");
  const [nieve, setNieve] = useState(a.sismo?.nievePermanente ?? false);

  const municipio = useMemo(() => (ine.length === 5 ? municipioPorIne(ine) : null), [ine]);
  const candidatos = useMemo(() => (busqueda.trim().length >= 2 ? buscarMunicipios(busqueda, 12) : []), [busqueda]);
  const provincia = municipio ? provinciaPorIne(municipio.ine) : null;

  /** Lo que se escribirá, o por qué no. */
  const acciones = useMemo((): { valor: AccionesEdificio | null } | { error: string } => {
    const r: AccionesEdificio = {};
    if (conViento) {
      const v: VientoEdificio = { zona, aspereza };
      for (const [nombre, t, poner] of [
        ["qb", qb, (x: number) => (v.qb = x)],
        ["La altitud", altitud, (x: number) => (v.altitud = x)],
        ["La rasante", rasante, (x: number) => (v.rasante = x)],
      ] as const) {
        const n = numeroOpcional(t);
        if (typeof n === "string") return { error: `${nombre}: ${n}.` };
        if (n !== undefined) poner(n);
      }
      // Las fachadas escritas a mano se conservan
      if (a.viento?.fachadas) v.fachadas = a.viento.fachadas;
      r.viento = v;
    }
    if (conSismo) {
      const s: SismoEdificio = {};
      if (a.sismo?.masas) s.masas = a.sismo.masas;
      if (nieve) s.nievePermanente = true;
      if (ine) {
        if (!/^\d{5}$/.test(ine)) return { error: "El código INE del municipio tiene 5 cifras." };
        s.ine = ine;
        if (municipio) s.municipio = municipio.nombre;
      }
      const nAb = numeroOpcional(ab);
      if (typeof nAb === "string") return { error: `ab: ${nAb}.` };
      if (nAb !== undefined) s.ab = nAb;
      const nK = numeroOpcional(K);
      if (typeof nK === "string") return { error: `K: ${nK}.` };
      if (nK !== undefined) s.K = nK;
      const conEspectro = s.ine !== undefined || s.ab !== undefined;
      if (conEspectro) {
        if (terreno === "C") {
          const n = numeroOpcional(C);
          if (typeof n !== "number") return { error: "El coeficiente C del terreno necesita un número (de 1 a 2)." };
          s.terreno = n;
        } else if (terreno === "estratos") {
          if (!Array.isArray(t0)) return { error: "Los estratos del terreno se escriben en el fichero (acciones.sismo.terreno)." };
          s.terreno = t0;
        } else s.terreno = terreno as "I" | "II" | "III" | "IV";
        const x = numeroOpcional(muX);
        const y = numeroOpcional(muY);
        if (typeof x === "string") return { error: `μ: ${x}.` };
        if (typeof y === "string") return { error: `μ según Y: ${y}.` };
        if (x === undefined) return { error: "Con espectro hace falta la ductilidad μ (1, 2, 3 o 4)." };
        s.mu = y === undefined || y === x ? x : { x, y };
        if (importancia !== "normal") s.importancia = importancia;
        for (const [nombre, t, poner] of [
          ["Ω", omega, (n: number) => (s.omega = n)],
          ["La excentricidad", excentricidad, (n: number) => (s.excentricidad = n)],
        ] as const) {
          const n = numeroOpcional(t);
          if (typeof n === "string") return { error: `${nombre}: ${n}.` };
          if (n !== undefined) poner(n);
        }
        if (regla !== "srss") s.regla = regla;
        if (sistema) s.sistema = sistema;
      }
      r.sismo = s;
    }
    return { valor: r.viento || r.sismo ? r : null };
  }, [conViento, zona, qb, aspereza, altitud, rasante, a, conSismo, ine, municipio, ab, K, terreno, C, t0, muX, muY, importancia, omega, excentricidad, regla, sistema, nieve]);

  // Lo que sale de los datos escritos, en el modelo de ahora: se aplica a una copia del proyecto en el worker no, aquí: la sesión
  // del worker tiene el proyecto guardado; lo escrito se ve al aplicar. Hasta entonces, lo de la sesión.
  const viento = usePedido(proyecto.cliente, { tipo: "viento" });
  const sismo = usePedido(proyecto.cliente, { tipo: "sismo" });
  const cambiado = JSON.stringify("valor" in acciones ? (acciones.valor ?? {}) : null) !== JSON.stringify(a);

  const aplicar = () => {
    if ("error" in acciones) return setError(acciones.error);
    const r = ed.editar({ op: "acciones", acciones: acciones.valor }, "Viento y sismo");
    if (!r.ok) return setError(r.errores.map((e) => textoApp(e.mensaje)).join(" "));
    onCerrar(acciones.valor ? "Viento y sismo del programa aplicados: los casos salen en el selector." : "Sin acciones del programa.");
  };

  useEffect(() => setError(null), [acciones]);

  return (
    <Dialogo
      titulo="Viento y sismo"
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
      <div role="tablist" className="mb-3 flex gap-1 border-b border-border-main">
        {(["viento", "sismo"] as const).map((p) => (
          <button key={p} type="button" role="tab" aria-selected={pestana === p} className="dock-tab" data-on={pestana === p} onClick={() => setPestana(p)}>
            {p === "viento" ? "Viento" : "Sismo"}
          </button>
        ))}
      </div>
      {pestana === "viento" ? (
        <div className="grid gap-3">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={conViento} onChange={(e) => setConViento(e.target.checked)} /> Viento del programa (DB SE-AE 3.3 y Anejo D): 8 casos, según X e Y en los dos sentidos, con la excentricidad del 5 % a cada lado
          </label>
          {conViento && (
            <>
              <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2">
                <label htmlFor="v-zona">Zona eólica</label>
                <span className="flex items-center gap-2">
                  <select id="v-zona" className="sel" value={zona} onChange={(e) => setZona(e.target.value as ZonaEolica)}>
                    {(Object.keys(ZONAS_EOLICAS) as ZonaEolica[]).map((z) => (
                      <option key={z} value={z}>
                        {z} · vb = {ZONAS_EOLICAS[z].vb} m/s, qb = {fmt(ZONAS_EOLICAS[z].qb, 2)} kN/m²
                      </option>
                    ))}
                  </select>
                  {provincia && (
                    <span className="text-[12px] text-text-secondary" title={provincia.frontera?.eolica}>
                      En {provincia.nombre} (capital), zona {provincia.zonaEolica}
                      {provincia.frontera?.eolica ? " · " + provincia.frontera.eolica : ""}
                    </span>
                  )}
                </span>
                <label htmlFor="v-qb">qb escrita (kN/m²)</label>
                <input id="v-qb" className="sel mono w-[8rem]" value={qb} inputMode="decimal" placeholder="la de la zona" onChange={(e) => setQb(e.target.value)} />
                <label htmlFor="v-asp">Aspereza del entorno</label>
                <select id="v-asp" className="sel" value={aspereza} onChange={(e) => setAspereza(e.target.value as GradoAspereza)}>
                  {ORDEN_ASPEREZAS.map((g) => (
                    <option key={g} value={g}>
                      {g} · {ASPEREZAS[g].descripcion}
                    </option>
                  ))}
                </select>
                <label htmlFor="v-alt">Altitud (m)</label>
                <input id="v-alt" className="sel mono w-[8rem]" value={altitud} inputMode="decimal" placeholder="—" onChange={(e) => setAltitud(e.target.value)} />
                <label htmlFor="v-ras">Rasante (cota, m)</label>
                <input id="v-ras" className="sel mono w-[8rem]" value={rasante} inputMode="decimal" placeholder="la ±0,00" onChange={(e) => setRasante(e.target.value)} />
              </div>
              <ResumenViento d={viento.datos ?? null} aplicado={!cambiado} />
            </>
          )}
        </div>
      ) : (
        <div className="grid gap-3">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={conSismo} onChange={(e) => setConSismo(e.target.checked)} /> Sismo (NCSE-02): las masas de las cargas y los modos de vibración; con el emplazamiento, el análisis por espectros de respuesta (art. 3.6.2)
          </label>
          {conSismo && (
            <>
              <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2">
                <label htmlFor="s-mun">Municipio</label>
                <div>
                  <input id="s-mun" className="sel w-full" value={busqueda} placeholder={municipio ? `${municipio.nombre} (${provincia?.nombre ?? ""}), INE ${municipio.ine}` : "Escriba el nombre y elija uno de la lista"} onChange={(e) => setBusqueda(e.target.value)} aria-label="Buscar municipio" />
                  {candidatos.length > 0 && (
                    <ul className="lista-candidatos" role="listbox">
                      {candidatos.map((m) => (
                        <li key={m.ine}>
                          <button type="button" role="option" aria-selected={m.ine === ine} className="w-full text-left" onClick={() => elegirMunicipio(m)}>
                            {m.nombre} <span className="text-text-secondary">({provinciaPorIne(m.ine)?.nombre}, INE {m.ine})</span> · ab = {fmt(m.ab, 2)} g, K = {fmt(m.K, 1)}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {busqueda.trim().length >= 2 && !candidatos.length && <p className="nota">No figura en el Anejo 1. Puede estar por debajo de 0,04 g (exento, art. 1.2.3), ser una errata del nombre, o ser un municipio creado después de 2002. Compruébelo antes de darlo por exento; si procede, escriba ab y K.</p>}
                  {municipio && (
                    <p className="nota">
                      {municipio.nombre}: ab = {fmt(municipio.ab, 2)} g, K = {fmt(municipio.K, 1)} · {textoProcedencia(municipio.procedencia)}.{" "}
                      <button type="button" className="enlace" onClick={() => setIne("")}>
                        Quitar
                      </button>
                    </p>
                  )}
                  {ine && !municipio && <p className="nota text-state-fail">El código INE {ine} no está en la tabla del Anejo 1.</p>}
                </div>
                <label htmlFor="s-ab">ab escrita (g)</label>
                <input id="s-ab" className="sel mono w-[8rem]" value={ab} inputMode="decimal" placeholder={municipio ? `la del municipio, ${fmt(municipio.ab, 2)}` : "—"} onChange={(e) => setAb(e.target.value)} />
                <label htmlFor="s-k">K escrito</label>
                <input id="s-k" className="sel mono w-[8rem]" value={K} inputMode="decimal" placeholder={municipio ? `el del municipio, ${fmt(municipio.K, 1)}` : "—"} onChange={(e) => setK(e.target.value)} />
                <label htmlFor="s-terr">Terreno (art. 2.4)</label>
                <span className="flex items-center gap-2">
                  <select id="s-terr" className="sel" value={terreno} onChange={(e) => setTerreno(e.target.value)}>
                    {TERRENOS.map((t) => (
                      <option key={t} value={t}>
                        Tipo {t} · {DESCRIPCION_TERRENO[t]}
                      </option>
                    ))}
                    <option value="C">Coeficiente C escrito</option>
                    {Array.isArray(t0) && <option value="estratos">Los estratos del fichero (C ponderado en 30 m)</option>}
                  </select>
                  {terreno === "C" && <input className="sel mono w-[6rem]" aria-label="Coeficiente C" value={C} inputMode="decimal" onChange={(e) => setC(e.target.value)} />}
                </span>
                <label htmlFor="s-mu">Ductilidad μ</label>
                <span className="flex items-center gap-2">
                  <input id="s-mu" className="sel mono w-[6rem]" value={muX} inputMode="decimal" placeholder="1, 2, 3 o 4" onChange={(e) => setMuX(e.target.value)} />
                  <span className="text-text-secondary">según Y, si es otra</span>
                  <input className="sel mono w-[6rem]" aria-label="μ según Y" value={muY} inputMode="decimal" placeholder="la misma" onChange={(e) => setMuY(e.target.value)} />
                </span>
                <label htmlFor="s-imp">Importancia</label>
                <select id="s-imp" className="sel" value={importancia} onChange={(e) => setImportancia(e.target.value as "normal" | "especial")}>
                  <option value="normal">Normal · ρ = 1,0</option>
                  <option value="especial">Especial · ρ = 1,3</option>
                </select>
                <label htmlFor="s-sis">Sistema estructural</label>
                <select id="s-sis" className="sel" value={sistema} onChange={(e) => setSistema(e.target.value as SistemaEstructural | "")} title="Sólo para el periodo aproximado del art. 3.7.2.2 con el que se contrasta el cortante en la base: no cambia el cálculo">
                  <option value="">—</option>
                  {SISTEMAS_ESTRUCTURALES.map((s) => (
                    <option key={s} value={s}>
                      {NOMBRE_SISTEMA[s]}
                    </option>
                  ))}
                </select>
                <label htmlFor="s-om">Amortiguamiento Ω (%)</label>
                <input id="s-om" className="sel mono w-[6rem]" value={omega} inputMode="decimal" placeholder="5" onChange={(e) => setOmega(e.target.value)} />
                <label htmlFor="s-reg">Regla de combinación</label>
                <select id="s-reg" className="sel" value={regla} onChange={(e) => setRegla(e.target.value as "srss" | "cqc")}>
                  <option value="srss">La del art. 3.6.2.4: raíz de la suma de los cuadrados, con los modos a menos del 10 % sumados en valor absoluto</option>
                  <option value="cqc">Cuadrática completa (comentario C.3.6.2.4), con Ω</option>
                </select>
                <label htmlFor="s-exc">Excentricidad accidental</label>
                <input id="s-exc" className="sel mono w-[6rem]" value={excentricidad} inputMode="decimal" placeholder="0,05" onChange={(e) => setExcentricidad(e.target.value)} title="Fracción de la dimensión de la planta perpendicular al sismo (art. 3.2: no menos de 1/20); 0, sin ella" />
                <span />
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={nieve} onChange={(e) => setNieve(e.target.checked)} /> La nieve permanece más de 30 días al año (su masa cuenta la mitad, art. 3.2)
                </label>
              </div>
              <ResumenSismo d={sismo.datos ?? null} aplicado={!cambiado} />
            </>
          )}
        </div>
      )}
    </Dialogo>
  );

  function elegirMunicipio(m: Municipio) {
    setIne(m.ine);
    setBusqueda("");
  }
}

/** Lo que el viento del programa da en el modelo de la sesión. */
function ResumenViento({ d, aplicado }: { d: DatosViento | null; aplicado: boolean }) {
  if (!d) return <p className="nota">…</p>;
  if (!d.definido) return <p className="nota">Lo que sale de estos datos se ve al aplicarlos.</p>;
  return (
    <div className="grid gap-2">
      {!aplicado && <p className="nota text-state-warn">Lo de abajo es lo aplicado: pulse «Aplicar» para ver lo de estos datos.</p>}
      {d.errores.map((p) => (
        <p key={p.codigo + p.mensaje} className="nota text-state-fail">
          {textoApp(p.mensaje)}
        </p>
      ))}
      {d.avisos.map((p) => (
        <p key={p.codigo + p.mensaje} className="nota text-state-warn">
          {textoApp(p.mensaje)}
        </p>
      ))}
      {d.viento && (
        <>
          <p className="nota">
            qb = {fmt(d.viento.qb, 3)} kN/m² ({d.viento.qbOrigen === "zona" ? `zona ${d.viento.zona}` : d.viento.qbOrigen === "dada" ? "escrita" : "simplificada"}), aspereza {d.viento.aspereza}, rasante a {fmt(d.viento.rasante, 2)} m, altura {fmt(d.viento.altura, 2)} m. Según X: esbeltez {fmt(d.viento.x.esbeltez, 2)}, cp = {fmt(d.viento.x.cp, 2)}, cs = {fmt(d.viento.x.cs, 2)}, e = {fmt(d.viento.x.e, 2)} m; según Y: {fmt(d.viento.y.esbeltez, 2)}, {fmt(d.viento.y.cp, 2)}, {fmt(d.viento.y.cs, 2)}, {fmt(d.viento.y.e, 2)} m.
          </p>
          <table className="tb">
            <thead>
              <tr>
                <th>Planta</th>
                <th>z m</th>
                <th>ce</th>
                <th>qe kN/m²</th>
                <th>Área X m²</th>
                <th>F según X kN</th>
                <th>Área Y m²</th>
                <th>F según Y kN</th>
              </tr>
            </thead>
            <tbody>
              {d.viento.x.plantas.map((p, i) => {
                const py = d.viento!.y.plantas[i];
                return (
                  <tr key={p.planta}>
                    <td>{p.planta}</td>
                    <td>{fmt(p.z, 2)}</td>
                    <td>{fmt(p.ce, 3)}</td>
                    <td>{fmt(p.qe, 3)}</td>
                    <td>
                      {fmt(p.area, 1)}
                      {p.dada && <small>escrita</small>}
                    </td>
                    <td>{fmt(p.F, 2)}</td>
                    <td>{py ? fmt(py.area, 1) : "—"}</td>
                    <td>{py ? fmt(py.F, 2) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="nota">Cada caso lleva una puntual por planta en el centro de su banda, desplazada ±e, al diafragma de la planta. Σ F según X = {fmt(d.viento.x.plantas.reduce((t, p) => t + p.F, 0), 2)} kN; según Y, {fmt(d.viento.y.plantas.reduce((t, p) => t + p.F, 0), 2)} kN.</p>
        </>
      )}
    </div>
  );
}

/** El espectro del emplazamiento y, con resultados, el cortante en la base. */
function ResumenSismo({ d, aplicado }: { d: DatosSismo | null; aplicado: boolean }) {
  if (!d) return <p className="nota">…</p>;
  if (!d.definido) return <p className="nota">Sin emplazamiento (municipio o ab) sólo se calculan las masas y los modos. Lo que sale de estos datos se ve al aplicarlos.</p>;
  const e = d.espectro;
  return (
    <div className="grid gap-2">
      {!aplicado && <p className="nota text-state-warn">Lo de abajo es lo aplicado: pulse «Aplicar» para ver lo de estos datos.</p>}
      {d.problemas.map((p) => (
        <p key={p.codigo + p.mensaje} className={`nota ${p.severidad === "error" ? "text-state-fail" : "text-state-warn"}`}>
          {textoApp(p.mensaje)}
        </p>
      ))}
      {e && (
        <p className="nota">
          ab = {fmt(e.emplazamiento.ab, 2)} g, K = {fmt(e.emplazamiento.K, 1)}
          {e.municipio ? ` (${e.municipio.nombre}, ${e.municipio.provincia})` : ""}; terreno {e.terreno}, C = {fmt(e.emplazamiento.C, 2)}, S = {fmt(e.emplazamiento.S, 3)}, ρ = {fmt(e.emplazamiento.rho, 1)}: ac = {fmt(e.emplazamiento.ac, 3)} g, TA = {fmt(e.emplazamiento.TA, 3)} s, TB = {fmt(e.emplazamiento.TB, 3)} s. Ω = {fmt(e.omega, 0)} %, ν = {fmt(e.nu, 3)}; μ = {fmt(e.mu[0], 0)}
          {e.mu[1] !== e.mu[0] ? ` / ${fmt(e.mu[1], 0)}` : ""}, β = {fmt(e.beta[0], 3)}
          {e.beta[1] !== e.beta[0] ? ` / ${fmt(e.beta[1], 3)}` : ""}.
        </p>
      )}
      {d.curva && e && <Espectro curva={d.curva} periodos={d.periodos} TA={e.emplazamiento.TA} TB={e.emplazamiento.TB} />}
      {d.resultado && (
        <p className="nota">
          Con el cálculo: cortante en la base según X {fmt(d.resultado.direcciones[0]!.cortanteBasal, 1)} kN ({fmt(100 * d.resultado.direcciones[0]!.coeficienteSismico, 1)} % del peso sísmico, {fmt(d.resultado.peso, 0)} kN), según Y {fmt(d.resultado.direcciones[1]!.cortanteBasal, 1)} kN ({fmt(100 * d.resultado.direcciones[1]!.coeficienteSismico, 1)} %). El detalle, en Resultados · Modal.
        </p>
      )}
      {d.motivo && <p className="nota">{textoApp(d.motivo)}</p>}
    </div>
  );
}

/** La curva del espectro: α(T) elástico y αᵢ(T) según X y según Y, con los periodos de los modos. */
export function Espectro({ curva, periodos, TA, TB }: { curva: DatosSismo["curva"] & object; periodos: number[]; TA: number; TB: number }) {
  const [W, H, ml, mb] = [420, 170, 34, 22];
  const Tmax = curva.T[curva.T.length - 1]!;
  const amax = Math.max(...curva.elastico);
  const X = (T: number) => ml + (T / Tmax) * (W - ml - 8);
  const Y = (a: number) => H - mb - (a / amax) * (H - mb - 10);
  const linea = (ys: number[]) => curva.T.map((T, i) => `${i ? "L" : "M"}${X(T).toFixed(1)} ${Y(ys[i]!).toFixed(1)}`).join("");
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Espectro de respuesta">
      <line x1={ml} x2={W - 4} y1={H - mb} y2={H - mb} stroke="var(--color-border-main)" />
      <line x1={ml} x2={ml} y1={6} y2={H - mb} stroke="var(--color-border-main)" />
      {[TA, TB].map((T, i) => (
        <g key={i}>
          <line x1={X(T)} x2={X(T)} y1={10} y2={H - mb} stroke="var(--color-border-main)" strokeDasharray="3 3" />
          <text x={X(T)} y={H - 8} fontSize={10} textAnchor="middle" fontFamily="var(--font-mono)" fill="var(--color-text-muted)">
            {i ? "TB" : "TA"} {fmt(T, 2)}
          </text>
        </g>
      ))}
      <path d={linea(curva.elastico)} fill="none" stroke="var(--color-text-muted)" strokeWidth={1.2} strokeDasharray="4 3" />
      <path d={linea(curva.x)} fill="none" stroke="var(--color-accent)" strokeWidth={1.6} />
      <path d={linea(curva.y)} fill="none" stroke="var(--color-uy)" strokeWidth={1.6} strokeDasharray="6 3" />
      {periodos.map((T, i) => (
        <circle key={i} cx={X(Math.min(T, Tmax))} cy={Y(curva.x[Math.min(curva.T.length - 1, Math.round((T / Tmax) * (curva.T.length - 1)))]!)} r={2.5} fill="var(--color-accent)" />
      ))}
      <text x={ml - 4} y={Y(amax) + 4} fontSize={10} textAnchor="end" fontFamily="var(--font-mono)" fill="var(--color-text-muted)">
        {fmt(amax, 1)}
      </text>
      <text x={ml - 4} y={Y(1) + 4} fontSize={10} textAnchor="end" fontFamily="var(--font-mono)" fill="var(--color-text-muted)">
        1
      </text>
      <text x={W - 4} y={H - 8} fontSize={10} textAnchor="end" fontFamily="var(--font-mono)" fill="var(--color-text-muted)">
        T {fmt(Tmax, 0)} s
      </text>
      <text x={ml + 6} y={16} fontSize={10} fill="var(--color-text-muted)">
        α(T) elástico — — · αᵢ según X ── · según Y – –
      </text>
    </svg>
  );
}
