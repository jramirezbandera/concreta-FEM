/**
 * Resultados · Armado (fase F, `docs/fem3d/franjas.md` §2.6; fase AB, `armado.md` §2): las franjas
 * de armado de las losas de la planta, coloreadas por la demanda de Wood–Armer de una armadura (X o
 * Y, inferior o superior; la escena `armado-…` de A4, la de `fem render`).
 *
 * - En planta y en 3D (`armado3d`), con la leyenda y la cabecera en kN·m/m.
 * - Un clic en la planta da el valor del punto (`valor-armado`: la estación cuyo tramo lo contiene,
 *   bit a bit con «fem consultar franja») y elige su franja; en el 3D, el mismo valor bajo el cursor.
 * - La armadura base de cada losa (la común y la propia, en el proyecto: operación `armado`) deja
 *   en gris lo que cubre y contornea las zonas de refuerzo; cambiarla no recalcula.
 * - Abajo, la tabla de las franjas y la de las zonas de refuerzo (`fem consultar refuerzos`); en
 *   Propiedades, el valor del punto, la base, la zona o la franja elegida (su diagrama, con la base).
 *
 * Cada número es de una consulta, nunca del dibujo.
 */
import { useEffect, useState } from "react";
import { ARMADURAS as LISTA_ARMADURAS, baseDe, hayBase, type ArmadoProyecto, type BasesArmado } from "../../../src/agente/armaduraBase.ts";
import { NOMBRE_CORTO, UNIDAD_ARMADO, type Armadura, type FiltroArmado, type OpcionesArmado } from "../../../src/agente/render/armado.ts";
import type { Vec2 } from "../../../src/agente/render/escena.ts";
import type { DemandaFranja, EstacionFranjaEnvolvente, FilaRefuerzo } from "../../../src/agente/consultas.ts";
import { leerNumero, textoNumero } from "../../../src/editor/celdas.ts";
import type { ValorArmado } from "../../../src/visor/armado.ts";
import type { DatosFranja } from "../../../src/visor/franjas.ts";
import type { EleccionCombinaciones, FuenteEscena } from "../../../src/visor/sesion.ts";
import { Chip, Desplegable, Disposicion, Separador } from "../armazon/Disposicion.tsx";
import { usePaneles } from "../armazon/paneles.ts";
import { Aviso, ComboCombinaciones, ListaDiagnosticos, Seccion } from "../componentes/comunes.tsx";
import { escalaDe, SeccionEscala, type EscalaElegida } from "../componentes/escala.tsx";
import { BarraModos } from "../espacios/BarraModos.tsx";
import { useVisor } from "../contexto.ts";
import { fmt } from "../fmt.ts";
import { usePedido } from "../sesion/usePedido.ts";
import { BarraVistas } from "../vistas/BarraVistas.tsx";
import { useVistas, vistasDe } from "../vistas/estado.ts";
import { useSonda } from "../vistas/sonda.ts";
import type { Marca } from "../vistas/vista2d.ts";
import { conMalla, encuadrarCajaActiva, Fuente2D, Fuente3DModelo, ZonaVistas } from "../vistas/Zona.tsx";
import { useEleccion } from "./useEleccion.ts";

const ARMADURAS: { id: Armadura; nombre: string }[] = LISTA_ARMADURAS.map((id) => ({ id, nombre: NOMBRE_CORTO[id] }));
const U = UNIDAD_ARMADO;

/** Lo que va en cada pedido del mapa: la base, la escala y el filtro (no reabren la sesión). */
type OpMapa = Pick<OpcionesArmado, "armado" | "escala" | "filtro">;
type Punto = { p: Vec2; v: ValorArmado | null; planta: string; clave: string };

/** Una demanda con su estación y su combinación (si hay más de una). */
function Demanda({ v, varias }: { v: DemandaFranja | null; varias: boolean }) {
  if (!v) return <>0</>;
  return (
    <>
      {fmt(v.v, 1)}
      <small>
        s = {fmt(v.s, 2)}
        {varias && v.comb ? ` · ${v.comb}` : ""}
      </small>
    </>
  );
}

/** Un valor con su combinación (si hay más de una). */
function Valor({ v, varias }: { v: [number, string]; varias: boolean }) {
  if (!Number.isFinite(v[0])) return <>—</>;
  return (
    <>
      {fmt(v[0], 1)}
      {varias && v[1] ? <small>{v[1]}</small> : null}
    </>
  );
}

/** «20» si todas las losas de la lista tienen la misma base; «por losa» si no; null sin base. */
function resumenBase(armado: ArmadoProyecto | undefined, losas: readonly string[], a: Armadura): string | null {
  const bs = [...new Set(losas.map((l) => baseDe(armado, l, a)))];
  if (bs.every((b) => b === null)) return null;
  return bs.length === 1 ? fmt(bs[0]!, 1) : "por losa";
}

/** El mapa de una planta: un clic da el valor del punto y elige su franja. */
function EscenaArmado({ fuente, objetos, marcas, onPunto }: { fuente: FuenteEscena | null; objetos: ReadonlySet<string> | null; marcas: Marca[]; onPunto: (p: Vec2, planta: string) => void }) {
  const { proyecto, seleccion } = useVisor();
  const pedido = !fuente || proyecto.desactualizado || fuente.tipo !== "planta" ? null : { tipo: "escena" as const, planta: fuente.planta, vista: fuente.vista };
  const d = usePedido(proyecto.cliente, pedido);
  const resaltado = useEleccion(fuente, seleccion && objetos?.has(seleccion) ? seleccion : null);
  const aviso = proyecto.desactualizado ? <Aviso tono="warn">El fichero cambió: estos resultados ya no son del proyecto.</Aviso> : d.diagnosticos ? <Aviso tono="fail">{d.diagnosticos.map((x) => x.mensaje).join(" ")}</Aviso> : !d.datos && d.cargando ? <Aviso>Cortando las franjas…</Aviso> : null;
  return <Fuente2D escena={proyecto.desactualizado ? null : d.datos} resaltado={resaltado} marcas={marcas} eventos={{ clic: (p) => fuente?.tipo === "planta" && onPunto(p, fuente.planta) }} aviso={aviso} cargando={d.cargando} />;
}

/** El armado en un 3D: el de la planta de su cabecera o el de todas; bajo el cursor, el valor del punto. */
function TresDArmado({ planta, armadura, eleccion, op }: { planta: string | null; armadura: Armadura; eleccion: EleccionCombinaciones; op: OpMapa }) {
  const { proyecto } = useVisor();
  const armado = op.armado;
  const d = usePedido(proyecto.cliente, proyecto.desactualizado ? null : { tipo: "armado3d", armadura, combinaciones: eleccion, planta, ...op });
  const aviso = proyecto.desactualizado ? <Aviso tono="warn">El fichero cambió: estos resultados ya no son del proyecto.</Aviso> : d.diagnosticos ? <Aviso tono="fail">{d.diagnosticos.map((x) => x.mensaje).join(" ")}</Aviso> : !d.datos && d.cargando ? <Aviso>Cortando las franjas…</Aviso> : null;
  const datos = proyecto.desactualizado ? null : d.datos;
  const cliente = proyecto.cliente;
  const { alPasar, sonda } = useSonda(
    cliente && datos
      ? async (o) => {
          if (o.tipo !== "lamina") return null;
          const pl = datos.plantas[o.lamina];
          if (!pl) return null;
          const r = await cliente.pedir({ tipo: "valor-armado", planta: pl, armadura, combinaciones: eleccion, x: o.p[0], y: o.p[1], ...(armado ? { armado } : {}) });
          const v = r.ok ? (r.valor as ValorArmado | null) : null;
          return v ? [`${fmt(v.valor, 1)} ${U}${v.exceso !== null ? ` (${v.exceso > 0 ? "+" : ""}${fmt(v.exceso, 1)} sobre la base)` : ""}`, `${v.franja} · s = ${fmt(v.s, 2)} m · ${v.comb}`] : ["fuera de las franjas"];
        }
      : null,
    JSON.stringify([planta, armadura, eleccion, op, datos?.plantas]),
  );
  return <Fuente3DModelo resultados={{ isovalores: datos, leyenda: datos, aviso, cargando: d.cargando, alPasar, sonda }} />;
}

/**
 * El diagrama de una franja a lo largo: mx máximo y mínimo (líneas) y las demandas inferior y
 * superior de Wood–Armer (áreas), con el eje de los momentos positivos hacia abajo, como el de una
 * viga, y la armadura base de su losa (discontinua: la inferior abajo, la superior arriba). Sólo
 * dibuja los valores de la tabla.
 */
function DiagramaFranja({ d, base }: { d: DatosFranja; base: { inferior: number | null; superior: number | null } }) {
  const es = d.estaciones.filter((x) => x.valido !== false);
  if (!es.length) return null;
  const [W, H, m] = [320, 150, 8];
  const s0 = d.franja.s[0];
  const s1 = d.franja.s[1];
  const vmax = Math.max(1e-9, ...es.flatMap((x) => [Math.abs(x.max[0]), Math.abs(x.min[0]), x.inferior[0], x.superior[0]]), base.inferior ?? 0, base.superior ?? 0);
  const X = (s: number) => m + ((s - s0) / (s1 - s0 || 1)) * (W - 2 * m);
  // Positivos hacia abajo (tracción abajo), como los diagramas de las vigas
  const Y = (v: number) => H / 2 + (v / vmax) * (H / 2 - m);
  const linea = (v: (x: EstacionFranjaEnvolvente) => number) => es.map((x, i) => `${i ? "L" : "M"}${X(x.s).toFixed(1)},${Y(v(x)).toFixed(1)}`).join(" ");
  const area = (v: (x: EstacionFranjaEnvolvente) => number) => `${linea(v)} L${X(es[es.length - 1]!.s).toFixed(1)},${Y(0).toFixed(1)} L${X(es[0]!.s).toFixed(1)},${Y(0).toFixed(1)} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Diagrama de ${d.franja.id}`}>
      <path d={area((x) => x.inferior[0])} fill="#d6604d" fillOpacity={0.25} />
      <path d={area((x) => -x.superior[0])} fill="#4393c3" fillOpacity={0.25} />
      <line x1={m} x2={W - m} y1={Y(0)} y2={Y(0)} stroke="currentColor" strokeOpacity={0.5} />
      <path d={linea((x) => x.max[0])} fill="none" stroke="#b2182b" strokeWidth={1.2} />
      <path d={linea((x) => x.min[0])} fill="none" stroke="#2166ac" strokeWidth={1.2} />
      {base.inferior !== null && <line data-base="inferior" x1={m} x2={W - m} y1={Y(base.inferior)} y2={Y(base.inferior)} stroke="#b2182b" strokeDasharray="5 3" strokeWidth={1} />}
      {base.superior !== null && <line data-base="superior" x1={m} x2={W - m} y1={Y(-base.superior)} y2={Y(-base.superior)} stroke="#2166ac" strokeDasharray="5 3" strokeWidth={1} />}
      {es
        .filter((x) => x.tipo !== "paso")
        .map((x) => (
          <line key={`${x.s}${x.lado}`} x1={X(x.s)} x2={X(x.s)} y1={m} y2={H - m} stroke="currentColor" strokeOpacity={0.15} />
        ))}
    </svg>
  );
}

/** La franja elegida: su diagrama y sus estaciones. */
function DetalleFranja({ d, varias, base }: { d: DatosFranja; varias: boolean; base: { inferior: number | null; superior: number | null } }) {
  const f = d.franja;
  // La tabla de todas las estaciones (cientos de filas), sólo si se pide
  const [todas, setTodas] = useState(false);
  const exactas = d.estaciones.filter((x) => x.tipo !== "paso");
  const reticular = f.intereje !== null;
  return (
    <>
      <Seccion titulo={f.id} valor={`dirección ${f.direccion === 1 ? "X (1)" : "Y (2)"}`}>
        <div className="px-3.5 py-1.5 text-[12px] text-text-secondary">
          {f.losa} · ancho {fmt(f.ancho, 3)} m{reticular ? ` (el intereje)` : ""} · t de {fmt(f.t[0], 2)} a {fmt(f.t[1], 2)} m · s de {fmt(f.s[0], 2)} a {fmt(f.s[1], 2)} m
        </div>
        <DiagramaFranja d={d} base={base} />
        <p className="nota">
          Líneas: mx máximo (rojo) y mínimo (azul). Áreas: demanda de Wood–Armer inferior (abajo) y superior (arriba). Positivos hacia abajo; las verticales, las caras y las líneas de apoyo.
          {base.inferior !== null || base.superior !== null ? " Discontinua, la armadura base de la losa." : ""}
        </p>
      </Seccion>
      <Seccion titulo="Caras y apoyos" valor={U}>
        <table className="tb" aria-label={`Caras y apoyos de ${f.id}`}>
          <thead>
            <tr>
              <th>s m</th>
              <th>mx mín</th>
              <th>inf.</th>
              <th>sup.</th>
            </tr>
          </thead>
          <tbody>
            {exactas.map((x) => (
              <tr key={`${x.s}${x.lado}`} data-invalida={x.valido === false || undefined}>
                <td>
                  {fmt(x.s, 3)}
                  <small>
                    {x.tipo} {x.lado === -1 ? "←" : "→"} {x.piezas?.join(", ") ?? ""}
                    {x.distanciaMuestras !== undefined ? ` · my, mxy a ${fmt(x.distanciaMuestras, 2)} m` : ""}
                  </small>
                </td>
                <td data-mx-min={x.min[0]}>
                  <Valor v={x.min} varias={varias} />
                </td>
                <td data-inferior={x.inferior[0]}>
                  <Valor v={x.inferior} varias={varias} />
                </td>
                <td data-superior={x.superior[0]}>
                  <Valor v={x.superior} varias={varias} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="nota">De «fem consultar franja»: exactas, por fuerzas nodales, del lado de la flecha. Momento medio por metro de la franja; mx &gt; 0 tracciona la cara inferior. Con un borde rígido detrás (una viga, una huella), my y mxy se toman a la distancia que se indica, un canto de la losa: pegados a él, el torsor tiene una capa límite que la malla no resuelve.</p>
      </Seccion>
      <Seccion titulo="Todas las estaciones" valor={d.estaciones.length}>
        {!todas ? (
          <button type="button" className="btn mx-3.5 my-1.5" onClick={() => setTodas(true)}>
            Ver las {d.estaciones.length} estaciones
          </button>
        ) : (
          <table className="tb" aria-label={`Estaciones de ${f.id}`}>
            <thead>
              <tr>
                <th>s m</th>
                <th>mx máx</th>
                <th>mx mín</th>
                <th>inf.</th>
                <th>sup.</th>
              </tr>
            </thead>
            <tbody>
              {d.estaciones.map((x) => (
                <tr key={`${x.tipo}${x.s}${x.lado ?? 0}`} data-invalida={x.valido === false || undefined}>
                  <td>
                    {fmt(x.s, 2)}
                    {x.tipo !== "paso" ? <small>{x.tipo}</small> : null}
                  </td>
                  <td>{fmt(x.max[0], 1)}</td>
                  <td>{fmt(x.min[0], 1)}</td>
                  <td>{fmt(x.inferior[0], 1)}</td>
                  <td>{fmt(x.superior[0], 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {reticular && <p className="nota">Reticular: el momento por nervio es el medio por el intereje ({fmt(f.intereje!, 2)} m), fuera de los ábacos.</p>}
      </Seccion>
      {d.diagnosticos.length > 0 && (
        <Seccion titulo="Avisos" valor={d.diagnosticos.length}>
          <ListaDiagnosticos ds={d.diagnosticos} />
        </Seccion>
      )}
    </>
  );
}

/** El valor de un punto del mapa (`valor-armado`). */
function ValorPunto({ punto, armadura, varias }: { punto: Punto | null; armadura: Armadura; varias: boolean }) {
  if (!punto) return <p className="nota">Clic en el mapa para leer el valor de un punto.</p>;
  const v = punto.v;
  if (!v) return <p className="nota">Fuera de las franjas: fuera de las losas, en un hueco o entre las caras de un pilar (allí mandan las caras).</p>;
  const e = v.estacion;
  return (
    <div className="px-3.5 py-2" data-valor-armado={v.valor}>
      <div className="mono text-[11px] text-text-disabled">
        {v.franja} · s = {fmt(v.s, 2)} m · ({fmt(punto.p[0], 2)}; {fmt(punto.p[1], 2)}) m
      </div>
      <div className="mono text-[17px] font-medium">
        {fmt(v.valor, 1)} {U}
        <span className="ml-1.5 text-[11px] font-normal text-text-secondary">{NOMBRE_CORTO[armadura]}</span>
      </div>
      {v.base !== null && (
        <div className={`mono text-[12px] ${v.exceso! > 0 ? "text-state-warn" : "text-text-secondary"}`} data-exceso={v.exceso}>
          base {fmt(v.base, 1)} · {v.exceso! > 0 ? `falta ${fmt(v.exceso!, 1)}` : "cubierto"} {U}
        </div>
      )}
      <div className="text-[11px] text-text-secondary">
        {varias ? `${v.comb} · ` : ""}estación {e.tipo === "paso" ? "de paso (por campos)" : `${e.tipo} (exacta, por fuerzas nodales)`}
      </div>
      <div className="mono mt-1 text-[11px] text-text-disabled">
        inf. {fmt(e.inferior[0], 1)} · sup. {fmt(e.superior[0], 1)} · mx de {fmt(e.min[0], 1)} a {fmt(e.max[0], 1)}
      </div>
    </div>
  );
}

/** Una celda de la armadura base: vacía hereda (la común, en gris). */
function CeldaBase({ valor, heredado, etiqueta, activa, onCambio, deshabilitada }: { valor: number | undefined; heredado: number | undefined; etiqueta: string; activa: boolean; onCambio: (v: number | undefined) => string | null; deshabilitada: boolean }) {
  const [t, setT] = useState(valor === undefined ? "" : textoNumero(valor));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setT(valor === undefined ? "" : textoNumero(valor)), [valor]);
  const aplicar = () => {
    const s = t.trim();
    let n: number | undefined;
    if (s !== "") {
      const x = leerNumero(s);
      if (typeof x === "string") return setError(x);
      if (x < 0) return setError("La base no puede ser negativa.");
      n = x;
    }
    setError(null);
    if (n !== valor) setError(onCambio(n));
  };
  return (
    <td className={activa ? "bg-accent-subtle" : undefined}>
      <input
        type="text"
        inputMode="decimal"
        className="sel w-[58px] text-right mono"
        aria-label={etiqueta}
        aria-invalid={!!error || undefined}
        title={error ?? undefined}
        placeholder={heredado !== undefined ? textoNumero(heredado) : "—"}
        value={t}
        disabled={deshabilitada}
        onChange={(ev) => setT(ev.target.value)}
        onBlur={aplicar}
        onKeyDown={(ev) => ev.key === "Enter" && aplicar()}
      />
    </td>
  );
}

/** La armadura base (kN·m/m): la común y la de cada losa de la planta, en el proyecto. */
function SeccionBase({ planta, armadura }: { planta: string | null; armadura: Armadura }) {
  const { proyecto } = useVisor();
  const ed = proyecto.edicion;
  const p = ed?.proyecto;
  const armado = p?.armado;
  const losas = (p?.modelo.losas ?? []).filter((l) => l.planta === planta).map((l) => l.id);
  const cambiar = (fila: string | null, k: Armadura, v: number | undefined): string | null => {
    if (!ed) return "El proyecto no se puede editar.";
    const a: ArmadoProyecto = { ...(armado?.base ? { base: { ...armado.base } } : {}), ...(armado?.losas ? { losas: Object.fromEntries(Object.entries(armado.losas).map(([id, b]) => [id, { ...b }])) } : {}) };
    const b: BasesArmado = fila === null ? (a.base ??= {}) : ((a.losas ??= {})[fila] ??= {});
    if (v === undefined) delete b[k];
    else b[k] = v;
    const r = ed.editar({ op: "armado", armado: a }, "Armadura base");
    return r.ok ? null : r.errores.map((e) => e.mensaje).join(" ");
  };
  const fila = (id: string | null) => (
    <tr key={id ?? "comun"}>
      <td>{id ?? <span className="text-text-primary">Todas</span>}</td>
      {LISTA_ARMADURAS.map((k) => (
        <CeldaBase
          key={k}
          valor={id === null ? armado?.base?.[k] : armado?.losas?.[id]?.[k]}
          heredado={id === null ? undefined : armado?.base?.[k]}
          etiqueta={`Base ${NOMBRE_CORTO[k]} de ${id ?? "todas las losas"}`}
          activa={k === armadura}
          deshabilitada={!ed}
          onCambio={(v) => cambiar(id, k, v)}
        />
      ))}
    </tr>
  );
  return (
    <Seccion titulo="Armadura base" valor={U}>
      <table className="tb" aria-label="Armadura base">
        <thead>
          <tr>
            <th>Losa</th>
            {LISTA_ARMADURAS.map((k) => (
              <th key={k}>{NOMBRE_CORTO[k].replace(" inferior", " inf.").replace(" superior", " sup.")}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {fila(null)}
          {losas.map(fila)}
        </tbody>
      </table>
      <p className="nota">El momento que cubre la armadura base de cada losa. Vacía, la de «Todas» (en gris). Con base, el mapa contornea las zonas de refuerzo (lo que la supera); para ver sólo eso, el filtro «desde la base». Se guarda en el proyecto, fuera del cálculo: cambiarla no recalcula.</p>
    </Seccion>
  );
}

/** Una zona de refuerzo elegida: su extensión y su máximo. */
function DetalleZona({ z, varias }: { z: FilaRefuerzo; varias: boolean }) {
  return (
    <Seccion titulo={z.id} valor="zona de refuerzo">
      <div className="px-3.5 py-2 text-[12px] text-text-secondary">
        <div className="mono text-[17px] font-medium text-text-primary">
          {fmt(z.maximo.v, 1)} {U} <span className="text-[12px] text-state-warn">(+{fmt(z.maximo.exceso, 1)})</span>
        </div>
        <div>
          máximo en {z.maximo.franja}, s = {fmt(z.maximo.s, 2)} m{varias ? ` · ${z.maximo.comb}` : ""}
        </div>
        <div className="mt-1">
          base {fmt(z.base, 1)} {U} · {z.franjas.length} franja{z.franjas.length > 1 ? "s" : ""} ({z.franjas[0]}
          {z.franjas.length > 1 ? ` a ${z.franjas[z.franjas.length - 1]}` : ""})
        </div>
        <div>
          s de {fmt(z.s[0], 2)} a {fmt(z.s[1], 2)} m (longitud {fmt(z.longitud, 2)} m) · t de {fmt(z.t[0], 2)} a {fmt(z.t[1], 2)} m · área {fmt(z.area, 2)} m²
        </div>
      </div>
      <p className="nota">La extensión es la de los tramos de sus estaciones (±0,125 m), sin anclajes ni solapes.</p>
    </Seccion>
  );
}

/** La base de la armadura si todas las losas de la lista tienen la misma (null si no hay o varía). */
function numeroBase(armado: ArmadoProyecto | undefined, losas: readonly string[], a: Armadura): number | null {
  const bs = [...new Set(losas.map((l) => baseDe(armado, l, a)))];
  return bs.length === 1 ? bs[0]! : null;
}

/** «≥ 15», «≤ 40» o «15 a 40», en kN·m/m. */
const textoFiltro = (f: FiltroArmado): string => (f.min !== undefined && f.max !== undefined ? `${fmt(f.min, 1)} a ${fmt(f.max, 1)}` : f.min !== undefined ? `≥ ${fmt(f.min, 1)}` : `≤ ${fmt(f.max!, 1)}`);

/**
 * El filtro del mapa: se colorea sólo lo que está entre «desde» y «hasta» (cualquiera vacío, sin
 * límite); lo demás, en gris. Se aplica con Intro o al salir del campo.
 */
function SeccionFiltro({ filtro, base, onCambio }: { filtro: FiltroArmado | undefined; base: number | null; onCambio: (f: FiltroArmado | undefined) => void }) {
  const texto = (n: number | undefined) => (n === undefined ? "" : textoNumero(n));
  const [borrador, setBorrador] = useState({ min: texto(filtro?.min), max: texto(filtro?.max) });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setBorrador({ min: texto(filtro?.min), max: texto(filtro?.max) }), [filtro?.min, filtro?.max]);
  const poner = (min: number | undefined, max: number | undefined) => {
    if (min !== undefined && max !== undefined && !(min < max)) return setError(`«Desde» (${fmt(min, 1)}) tiene que ser menor que «hasta» (${fmt(max, 1)}).`);
    setError(null);
    const nuevo: FiltroArmado | undefined = min === undefined && max === undefined ? undefined : { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
    if (nuevo?.min !== filtro?.min || nuevo?.max !== filtro?.max) onCambio(nuevo);
  };
  const aplicar = () => {
    const v: (number | undefined)[] = [];
    for (const k of ["min", "max"] as const) {
      const t = borrador[k].trim();
      if (t === "") v.push(undefined);
      else {
        const x = leerNumero(t);
        if (typeof x === "string") return setError(x);
        v.push(x);
      }
    }
    poner(v[0], v[1]);
  };
  const entrada = (k: "min" | "max", etiqueta: string) => (
    <label className="flex flex-col gap-0.5 text-[11px] text-text-secondary">
      {etiqueta}
      <input
        type="text"
        inputMode="decimal"
        className="sel w-[84px] text-right mono"
        aria-label={`${etiqueta} del filtro`}
        placeholder="—"
        value={borrador[k]}
        onChange={(ev) => setBorrador({ ...borrador, [k]: ev.target.value })}
        onBlur={aplicar}
        onKeyDown={(ev) => ev.key === "Enter" && aplicar()}
      />
    </label>
  );
  return (
    <Seccion titulo="Filtro" valor={filtro ? `${textoFiltro(filtro)} ${U}` : "todo"}>
      <div className="flex flex-col gap-2 px-3.5 py-2">
        <div className="flex items-end gap-2">
          {entrada("min", "Desde")}
          {entrada("max", "Hasta")}
          {filtro && (
            <button type="button" className="btn" style={{ height: 28 }} onClick={() => poner(undefined, undefined)}>
              Quitar
            </button>
          )}
        </div>
        {base !== null && filtro?.min !== base && (
          <button type="button" className="btn self-start" onClick={() => poner(base, filtro?.max)} title="Colorea sólo lo que supera la armadura base: lo que hay que reforzar">
            Desde la base ({fmt(base, 1)})
          </button>
        )}
        {error && <Aviso tono="fail">{error}</Aviso>}
      </div>
      <p className="nota">Se colorea sólo lo que está en el rango ({U}), con la escala de eso; lo demás, en gris. Vacío, sin límite.</p>
    </Seccion>
  );
}

export function ModoArmado() {
  const { proyecto, planta, seleccion, setSeleccion } = useVisor();
  const pan = usePaneles("resultados:armado", { props: true, dock: true, pestana: "franjas" });
  const vistas = useVistas();
  // El armado se ve en planta y en 3D: si no hay ninguna, la vista activa pasa a ser una planta
  const sinPlanta = !vistas.vistas.slice(0, vistasDe(vistas.disposicion)).some((v) => v.tipo === "planta" || v.tipo === "3d");
  useEffect(() => {
    if (sinPlanta) vistas.irATipo("planta");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo al entrar
  }, []);
  const e = proyecto.estado!;
  const [eleccion, setEleccion] = useState<EleccionCombinaciones>({ tipo: "defecto" });
  const [armadura, setArmadura] = useState<Armadura>("x-sup");
  // La escala y el filtro de cada armadura (sus valores son de órdenes distintos)
  const [escalas, setEscalas] = useState<Partial<Record<Armadura, EscalaElegida>>>({});
  const [filtros, setFiltros] = useState<Partial<Record<Armadura, FiltroArmado>>>({});
  const [punto, setPunto] = useState<Punto | null>(null);
  // La base es la del proyecto que se edita (va en cada pedido: cambiarla no reabre la sesión)
  const armado = proyecto.edicion?.proyecto.armado;
  const conBase = hayBase(armado, armadura);
  const escalaElegida: EscalaElegida = escalas[armadura] ?? { modo: "completa" };
  const escala = escalaDe(escalaElegida);
  const filtro = filtros[armadura];
  const op: OpMapa = { ...(armado ? { armado } : {}), ...(escala ? { escala } : {}), ...(filtro ? { filtro } : {}) };
  const r = usePedido(proyecto.cliente, proyecto.desactualizado || !planta ? null : { tipo: "armado", planta, combinaciones: eleccion, armadura, ...op });
  const d = proyecto.desactualizado ? null : r.datos;
  const ids = d ? new Set(d.filas.map((f) => f.id)) : null;
  const zonas = d?.zonas ?? [];
  const objetos = d ? new Set([...d.filas.map((f) => f.id), ...zonas.map((z) => z.id)]) : null;
  // El detalle, de la franja elegida si es de las de la tabla
  const elegida = seleccion && ids?.has(seleccion) ? seleccion : null;
  const zona = seleccion ? (zonas.find((z) => z.id === seleccion) ?? null) : null;
  const rf = usePedido(proyecto.cliente, proyecto.desactualizado || !elegida ? null : { tipo: "franja", id: elegida, combinaciones: eleccion });
  const detalle = rf.datos && rf.datos.franja.id === elegida ? rf.datos : null;
  const varias = (d?.combinaciones.nombres.length ?? 1) > 1;
  const conFranjas = d?.plantas ?? [];
  const inferior = armadura.endsWith("inf");
  const losasPlanta = (proyecto.edicion?.proyecto.modelo.losas ?? []).filter((l) => l.planta === planta).map((l) => l.id);
  const base = resumenBase(armado, losasPlanta, armadura);

  const clave = (pl: string) => JSON.stringify([pl, armadura, eleccion, proyecto.version, armado ?? null]);
  const clic = async (p: Vec2, pl: string) => {
    if (!proyecto.cliente) return;
    const x = await proyecto.cliente.pedir({ tipo: "valor-armado", planta: pl, armadura, combinaciones: eleccion, x: p[0], y: p[1], ...(armado ? { armado } : {}) });
    const v = x.ok ? (x.valor as ValorArmado | null) : null;
    setPunto({ p, v, planta: pl, clave: clave(pl) });
    setSeleccion(v ? v.franja : null);
  };
  const puntoValido = punto && planta && punto.planta === planta && punto.clave === clave(planta) ? punto : null;

  const herramientas = (
    <>
      <ComboCombinaciones estado={e} valor={eleccion} onCambio={setEleccion} etiqueta="esfuerzos" />
      <Desplegable etiqueta="Armadura" valor={armadura} onCambio={setArmadura} opciones={ARMADURAS} />
      <Separador />
      <BarraModos />
      <Separador />
      <BarraVistas />
    </>
  );

  const chip = (
    <Chip acento title="Momento de dimensionado de Wood–Armer por metro de franja. X es la dirección 1 de cada losa (su eje 1) e Y, la perpendicular">
      Armado · {NOMBRE_CORTO[armadura]} · {U}
      {conBase && base !== null && ` · base ${base}`}
      {filtro && ` · ${textoFiltro(filtro)}`}
      {escalaElegida.modo !== "completa" && ` · ${escalaElegida.modo === "sin-picos" ? "sin picos" : "escala manual"}`}
    </Chip>
  );

  const cabecera = (v: { planta: string | null }, i: number) => (
    <>
      {chip}
      {v.planta && d && !conFranjas.includes(v.planta) && (
        <>
          <Chip>Sin losas aquí</Chip>
          {conFranjas.slice(0, 4).map((p) => (
            <button key={p} type="button" className="chip" data-acento onClick={() => vistas.poner(i, { planta: p })}>
              Ir a {p}
            </button>
          ))}
        </>
      )}
    </>
  );

  const vista = (
    <ZonaVistas
      fuentes={{
        planta: (v) => {
          const pl = v.planta;
          const marcas: Marca[] = punto && pl && punto.planta === pl && punto.clave === clave(pl) ? [{ p: punto.p, texto: punto.v ? `${fmt(punto.v.valor, 1)} ${U}` : "fuera" }] : [];
          return <EscenaArmado fuente={pl ? { tipo: "planta", planta: pl, vista: conMalla({ vista: "armado" as const, combinaciones: eleccion, armadura, ...op }, v) } : null} objetos={objetos} marcas={marcas} onPunto={(p, x) => void clic(p, x)} />;
        },
        cabeceraPlanta: (v, i) => cabecera(v, i),
        malla: true,
        tresD: (v) => <TresDArmado planta={v.planta} armadura={armadura} eleccion={eleccion} op={op} />,
        cabecera3D: () => chip,
      }}
    />
  );

  const aviso = proyecto.desactualizado ? <Aviso tono="warn">El fichero cambió: estos resultados ya no son del proyecto.</Aviso> : r.diagnosticos ? <Aviso tono="fail">{r.diagnosticos.map((x) => x.mensaje).join(" ")}</Aviso> : !r.datos && r.cargando ? <Aviso>Cortando las franjas…</Aviso> : null;

  const tabla = d ? (
    <Seccion titulo={`Franjas de ${planta}`} valor={`${d.filas.length} · fem consultar franjas`}>
      {d.filas.length === 0 ? (
        <p className="nota">Esta planta no tiene losas macizas ni reticulares.</p>
      ) : (
        <table className="tb" aria-label="Franjas de la planta">
          <thead>
            <tr>
              <th>Franja</th>
              <th>Ancho m</th>
              <th>Inferior {U}</th>
              <th>Superior {U}</th>
            </tr>
          </thead>
          <tbody>
            {d.filas.map((f) => (
              <tr key={f.id} className="clic" data-on={f.id === seleccion} onClick={() => setSeleccion(f.id)}>
                <td>
                  {f.id}
                  <small>
                    t de {fmt(f.t[0], 2)} a {fmt(f.t[1], 2)}
                  </small>
                </td>
                <td>{fmt(f.ancho, 2)}</td>
                <td data-inferior={f.inferior?.v ?? 0} className={inferior ? "font-medium" : undefined}>
                  <Demanda v={f.inferior} varias={varias} />
                </td>
                <td data-superior={f.superior?.v ?? 0} className={inferior ? undefined : "font-medium"}>
                  <Demanda v={f.superior} varias={varias} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="nota">Mayor momento de dimensionado de Wood–Armer de cada franja (por metro), por combinación con los momentos medios de su ancho, y dónde está (s, a lo largo).</p>
      {aviso}
    </Seccion>
  ) : (
    aviso ?? <p className="nota">…</p>
  );

  const tablaZonas = d ? (
    <Seccion titulo={`Zonas de refuerzo de ${planta} · ${NOMBRE_CORTO[armadura]}`} valor={`${zonas.length} · fem consultar refuerzos`}>
      {!conBase ? (
        <p className="nota">Sin armadura base en {NOMBRE_CORTO[armadura]}: póngala en Propiedades (sin nada elegido) para ver las zonas que no cubre.</p>
      ) : zonas.length === 0 ? (
        <p className="nota">La base cubre toda la demanda de {NOMBRE_CORTO[armadura]} en esta planta.</p>
      ) : (
        <table className="tb" aria-label="Zonas de refuerzo">
          <thead>
            <tr>
              <th>Zona</th>
              <th>Franjas</th>
              <th>s m</th>
              <th>Longitud m</th>
              <th>Ancho m</th>
              <th>Máximo {U}</th>
              <th>Exceso {U}</th>
            </tr>
          </thead>
          <tbody>
            {zonas.map((z) => (
              <tr
                key={z.id}
                className="clic"
                data-on={z.id === seleccion}
                onClick={() => {
                  setSeleccion(z.id);
                  encuadrarCajaActiva(z.caja);
                }}
              >
                <td>
                  {z.id}
                  <small>base {fmt(z.base, 1)}</small>
                </td>
                <td>
                  {z.franjas.length}
                  <small>
                    {z.franjas[0]}
                    {z.franjas.length > 1 ? ` a ${z.franjas[z.franjas.length - 1]}` : ""}
                  </small>
                </td>
                <td>
                  {fmt(z.s[0], 2)} a {fmt(z.s[1], 2)}
                </td>
                <td>{fmt(z.longitud, 2)}</td>
                <td>{fmt(z.t[1] - z.t[0], 2)}</td>
                <td data-maximo={z.maximo.v}>
                  {fmt(z.maximo.v, 1)}
                  <small>
                    {z.maximo.franja} · s = {fmt(z.maximo.s, 2)}
                    {varias ? ` · ${z.maximo.comb}` : ""}
                  </small>
                </td>
                <td data-exceso={z.maximo.exceso}>{fmt(z.maximo.exceso, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {d.sinBase.length > 0 && conBase && <p className="nota">Sin base en {NOMBRE_CORTO[armadura]} (el mapa entero): {d.sinBase.join(", ")}.</p>}
      <p className="nota">Lo que supera la base, conexo por franjas seguidas o vecinas. La extensión es la de los tramos de sus estaciones (±0,125 m), sin anclajes ni solapes. Un clic la encuadra.</p>
    </Seccion>
  ) : (
    aviso ?? <p className="nota">…</p>
  );

  const baseFranja = (losa: string) => ({ inferior: baseDe(armado, losa, inferior ? armadura : (`${armadura[0]}-inf` as Armadura)), superior: baseDe(armado, losa, inferior ? (`${armadura[0]}-sup` as Armadura) : armadura) });

  const propiedades = (
    <>
      <Seccion titulo="Valor en el punto">
        <ValorPunto punto={puntoValido} armadura={armadura} varias={varias} />
      </Seccion>
      <SeccionEscala key={armadura} mapa={d?.escena.mapa} unidad={U} elegida={escalaElegida} onCambio={(x) => setEscalas((m) => ({ ...m, [armadura]: x }))} lados="arriba" />
      <SeccionFiltro key={`f${armadura}`} filtro={filtro} base={numeroBase(armado, losasPlanta, armadura)} onCambio={(x) => setFiltros((m) => ({ ...m, [armadura]: x }))} />
      {zona && <DetalleZona z={zona} varias={varias} />}
      {detalle ? <DetalleFranja d={detalle} varias={varias} base={baseFranja(detalle.franja.losa)} /> : elegida && rf.cargando ? <p className="nota">Cortando la franja…</p> : null}
      {!zona && !detalle && <SeccionBase planta={planta} armadura={armadura} />}
      <Seccion titulo="Qué se dibuja">
        <p className="nota">
          Momento de dimensionado de Wood–Armer por metro de la franja ({U}), por combinación con los momentos medios de su ancho, en la dirección de la franja (fase F): de «fem consultar franja». En las caras de los pilares y en las líneas de apoyo, exacto (por fuerzas nodales); entre ellas, cada 0,25 m, por campos. Cada estación colorea su tramo de la franja, hasta la mitad de sus vecinas.
        </p>
        {(zona || detalle) && (
          <button type="button" className="btn mx-3.5 my-1.5" onClick={() => setSeleccion(null)}>
            Armadura base…
          </button>
        )}
      </Seccion>
    </>
  );

  return (
    <Disposicion
      paneles={pan}
      etiquetaHerramientas="Herramientas de Resultados"
      herramientas={herramientas}
      vista={vista}
      props={{ titulo: "Propiedades", contenido: propiedades, ancho: 360 }}
      dock={[
        { id: "franjas", titulo: "Franjas", insignia: d?.filas.length, contenido: tabla },
        { id: "refuerzos", titulo: "Refuerzos", insignia: conBase ? zonas.length : undefined, contenido: tablaZonas },
      ]}
    />
  );
}
