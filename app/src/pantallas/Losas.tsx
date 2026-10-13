/**
 * Resultados · Losas (la pantalla 3 de V1): uz, M11, M22, M12, V13 y V23 por planta (la escena
 * `vistaCampo` de A4, en la combinación de mayor |valor| de las elegidas). Un clic da el valor del
 * punto interpolado como las bandas (la consulta `valor-punto`, no el color); en Propiedades, ese
 * valor, los extremos y las flechas de `fem consultar flechas`; abajo, las combinaciones.
 *
 * Desde I2, cada vista de planta pide el mapa de su planta; Propiedades enseña los datos de la planta
 * de la vista activa. Desde I4, un 3D enseña los mismos mapas sobre las losas en su sitio
 * (`isovalores3d`): los de la planta elegida en su cabecera (con su combinación y su escala, como en
 * la planta) o los de todas, con una escala común; en su cabecera, las losas, los muros o los dos, y
 * bajo el cursor, el valor del punto (`valor-lamina`, la misma interpolación que las bandas). Las
 * fuerzas de membrana F11, F22 y F12, desde I4 (en los muros, F22 es su axil vertical por metro).
 *
 * La escala de cada magnitud (`EscalaMapa`), en Propiedades: completa, sin picos o manual (mínimo,
 * máximo y paso); lo de fuera, rayado.
 */
import { useEffect, useState } from "react";
import type { Vec2 } from "../../../src/agente/render/escena.ts";
import type { EscalaMapa } from "../../../src/agente/render/isovalores.ts";
import type { Campo } from "../../../src/agente/render/resultados.ts";
import type { EleccionCombinaciones } from "../../../src/visor/sesion.ts";
import type { ValorPunto } from "../../../src/visor/datos.ts";
import type { SuperficiesMapa } from "../../../src/visor/isovalores3d.ts";
import { Chip, Desplegable, Disposicion, Segmentado, Separador } from "../armazon/Disposicion.tsx";
import { usePaneles } from "../armazon/paneles.ts";
import { Aviso, ComboCombinaciones, Equilibrio, Seccion, TablaCombinaciones } from "../componentes/comunes.tsx";
import { escalaDe, SeccionEscala, type EscalaElegida } from "../componentes/escala.tsx";
import { BarraModos } from "../espacios/BarraModos.tsx";
import { useVisor } from "../contexto.ts";
import { fmt, mm } from "../fmt.ts";
import { usePedido } from "../sesion/usePedido.ts";
import { BarraVistas } from "../vistas/BarraVistas.tsx";
import { useVistas, vistasDe } from "../vistas/estado.ts";
import type { Marca } from "../vistas/vista2d.ts";
import { queCombinaciones, useSonda } from "../vistas/sonda.ts";
import { Fuente2D, Fuente3DModelo, ZonaVistas } from "../vistas/Zona.tsx";

type Punto = { p: Vec2; v: ValorPunto | null; planta: string; clave: string };

/** El mapa de una planta en una vista: un clic da el valor del punto. */
function PlantaLosas({ planta, campo, eleccion, escala, punto, onPunto, dec, unidad }: { planta: string; campo: Campo; eleccion: EleccionCombinaciones; escala: EscalaMapa | undefined; punto: Punto | null; onPunto: (p: Vec2, planta: string) => void; dec: number; unidad: string }) {
  const { proyecto } = useVisor();
  const d = usePedido(proyecto.cliente, { tipo: "losas", planta, campo, combinaciones: eleccion, ...(escala ? { escala } : {}) });
  const marcas: Marca[] = punto && punto.planta === planta ? [{ p: punto.p, texto: punto.v ? `${fmt(punto.v.valor, dec)} ${unidad}` : "sin mapa" }] : [];
  const aviso = proyecto.desactualizado ? <Aviso tono="warn">El fichero cambió: estos resultados ya no son del proyecto.</Aviso> : d.diagnosticos ? <Aviso tono="fail">{d.diagnosticos.map((x) => x.mensaje).join(" ")}</Aviso> : !d.datos && d.cargando ? <Aviso>Recuperando los campos (SPR)…</Aviso> : null;
  return <Fuente2D escena={proyecto.desactualizado ? null : (d.datos?.escena ?? null)} marcas={marcas} eventos={{ clic: (p) => onPunto(p, planta) }} aviso={aviso} cargando={d.cargando} />;
}

/** El mapa en un 3D (I4): el de la planta de su cabecera, o los de todas; bajo el cursor, el valor del punto. */
function TresDLosas({ planta, campo, eleccion, escala, superficies, dec }: { planta: string | null; campo: Campo; eleccion: EleccionCombinaciones; escala: EscalaMapa | undefined; superficies: SuperficiesMapa; dec: number }) {
  const { proyecto } = useVisor();
  const d = usePedido(proyecto.cliente, proyecto.desactualizado ? null : { tipo: "isovalores3d", campo, combinaciones: eleccion, planta, superficies, ...(escala ? { escala } : {}) });
  const aviso = proyecto.desactualizado ? <Aviso tono="warn">El fichero cambió: estos resultados ya no son del proyecto.</Aviso> : d.diagnosticos ? <Aviso tono="fail">{d.diagnosticos.map((x) => x.mensaje).join(" ")}</Aviso> : !d.datos && d.cargando ? <Aviso>{campo === "uz" ? "Preparando el mapa…" : "Recuperando los campos (SPR)…"}</Aviso> : null;
  const datos = proyecto.desactualizado ? null : d.datos;
  const cliente = proyecto.cliente;
  const comb = datos?.combinacion?.nombre;
  const { alPasar, sonda } = useSonda(
    cliente && comb
      ? async (o) => {
          if (o.tipo !== "lamina") return null;
          const r = await cliente.pedir({ tipo: "valor-lamina", campo, combinaciones: eleccion, nombre: comb, lamina: o.lamina, punto: o.p });
          const v = r.ok ? (r.valor as { valor: number; unidad: string; objeto: string; planta: string; comb: string } | null) : null;
          return v ? [`${fmt(v.valor, dec)} ${v.unidad}`, `${v.objeto} · ${v.planta} · ${v.comb}`] : ["sin mapa"];
        }
      : null,
    JSON.stringify([planta, campo, eleccion, escala, superficies, comb]),
  );
  return <Fuente3DModelo resultados={{ isovalores: datos, leyenda: datos, aviso, cargando: d.cargando, alPasar, sonda }} />;
}

const SUPERFICIES: { id: SuperficiesMapa; nombre: string; title: string }[] = [
  { id: "losas", nombre: "Losas", title: "Las losas: con una planta, su mapa en planta" },
  { id: "muros", nombre: "Muros", title: "Los muros, en sus ejes (1 a lo largo, 2 hacia arriba, 3 a su derecha)" },
  { id: "todas", nombre: "Losas y muros", title: "Las losas y los muros, con una escala común" },
];

const CAMPOS: { id: Campo; nombre: string; dec: number }[] = [
  { id: "uz", nombre: "uz", dec: 2 },
  { id: "m11", nombre: "M11", dec: 1 },
  { id: "m22", nombre: "M22", dec: 1 },
  { id: "m12", nombre: "M12", dec: 1 },
  { id: "v13", nombre: "V13", dec: 1 },
  { id: "v23", nombre: "V23", dec: 1 },
  { id: "f11", nombre: "F11", dec: 1 },
  { id: "f22", nombre: "F22", dec: 1 },
  { id: "f12", nombre: "F12", dec: 1 },
];

export function ModoLosas() {
  const { proyecto, planta } = useVisor();
  const pan = usePaneles("resultados:losas", { props: true, pestana: "combinaciones" });
  const vistas = useVistas();
  // El mapa se ve en planta y en 3D: si no hay ninguna, la vista activa pasa a ser una planta
  const sinPlanta = !vistas.vistas.slice(0, vistasDe(vistas.disposicion)).some((v) => v.tipo === "planta" || v.tipo === "3d");
  useEffect(() => {
    if (sinPlanta) vistas.irATipo("planta");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo al entrar
  }, []);
  const e = proyecto.estado!;
  const [campo, setCampo] = useState<Campo>("uz");
  const [elDesp, setElDesp] = useState<EleccionCombinaciones>({ tipo: "defecto" });
  const [elEsf, setElEsf] = useState<EleccionCombinaciones>({ tipo: "defecto" });
  const [punto, setPunto] = useState<Punto | null>(null);
  const [escalas, setEscalas] = useState<Partial<Record<Campo, EscalaElegida>>>({});
  const [superficies, setSuperficies] = useState<SuperficiesMapa>("losas");
  const elegida = escalas[campo] ?? { modo: "completa" };
  const escala = escalaDe(elegida);
  const eleccion = campo === "uz" ? elDesp : elEsf;
  const setEleccion = campo === "uz" ? setElDesp : setElEsf;
  const dec = CAMPOS.find((c) => c.id === campo)!.dec;
  const d = usePedido(proyecto.cliente, planta ? { tipo: "losas", planta, campo, combinaciones: eleccion, ...(escala ? { escala } : {}) } : null);
  const x = d.datos;
  const clave = JSON.stringify([planta, campo, eleccion, proyecto.version]);
  // Con uz en pantalla, el worker adelanta el SPR de la planta: M11, M22… salen luego sin esperarlo
  const listo = !!x && !d.cargando;
  useEffect(() => {
    if (listo && planta && proyecto.cliente) void proyecto.cliente.pedir({ tipo: "precalentar", planta }).catch(() => {});
  }, [listo, planta, proyecto.cliente]);
  // El punto es de la planta activa (un clic en una vista la activa)
  const puntoValido = punto && punto.clave === clave && punto.planta === planta ? punto : null;
  const claveDe = (pl: string) => JSON.stringify([pl, campo, eleccion, proyecto.version]);

  const clic = async (p: Vec2, pl: string) => {
    if (!proyecto.cliente) return;
    const r = await proyecto.cliente.pedir({ tipo: "valor-punto", planta: pl, campo, combinaciones: eleccion, x: p[0], y: p[1], ...(escala ? { escala } : {}) });
    setPunto({ p, v: r.ok ? (r.valor as ValorPunto | null) : null, planta: pl, clave: claveDe(pl) });
  };

  const unidad = campo === "uz" ? "mm" : campo.startsWith("m") ? "kN·m/m" : "kN/m";
  const resumenComb = queCombinaciones(x ? { descripcion: x.combinaciones.descripcion, n: x.combinaciones.nombres.length } : undefined, x?.dibujada?.nombre);

  const nombreCampo = CAMPOS.find((c) => c.id === campo)!.nombre;
  const herramientas = (
    <>
      <ComboCombinaciones estado={e} valor={eleccion} onCambio={setEleccion} etiqueta={campo === "uz" ? "desplazamientos" : "esfuerzos"} />
      <Separador />
      <BarraModos />
      <Separador />
      <Segmentado etiqueta="Magnitud" opciones={CAMPOS.map((c) => ({ id: c.id, nombre: c.nombre }))} valor={campo} onCambio={setCampo} />
      <Separador />
      <BarraVistas />
    </>
  );
  const vista = (
    <ZonaVistas
      fuentes={{
        planta: (v) => (v.planta ? <PlantaLosas planta={v.planta} campo={campo} eleccion={eleccion} escala={escala} punto={punto && punto.clave === claveDe(v.planta) ? punto : null} onPunto={(p, pl) => void clic(p, pl)} dec={dec} unidad={unidad} /> : null),
        cabeceraPlanta: (v) => (
          <Chip acento title={v.planta === planta ? x?.dibujada?.etiqueta : undefined}>
            {nombreCampo} · {unidad}
            {elegida.modo !== "completa" && ` · ${elegida.modo === "sin-picos" ? "sin picos" : "escala manual"}`}
            {v.planta === planta && (
              <>
                {" · "}
                <span className="mono">{x?.dibujada?.nombre ?? "—"}</span>
                {d.ms !== null && <span className="mono text-text-disabled">{fmt(d.ms, 0)} ms</span>}
              </>
            )}
          </Chip>
        ),
        tresD: (v) => <TresDLosas planta={v.planta} campo={campo} eleccion={eleccion} escala={escala} superficies={superficies} dec={dec} />,
        cabecera3D: () => (
          <>
            <Desplegable etiqueta="Superficies del mapa" valor={superficies} onCambio={setSuperficies} opciones={SUPERFICIES} />
            <Chip acento title={resumenComb}>
              {nombreCampo} · {unidad}
              {elegida.modo !== "completa" && ` · ${elegida.modo === "sin-picos" ? "sin picos" : "escala manual"}`}
            </Chip>
          </>
        ),
      }}
    />
  );

  const propiedades = (
    <>
      {x && (
        <p className="nota">
          Se dibuja <b className="mono">{x.dibujada?.nombre ?? "—"}</b>
          {x.combinaciones.nombres.length > 1 ? `: la de mayor |valor| en la planta de las ${x.combinaciones.nombres.length} de ${x.combinaciones.descripcion}.` : "."} uz de los nudos; momentos y cortantes recuperados por SPR (E5) en los ejes de cada losa. Bandas sin interpolar el color (H43): el número de un punto, con un clic.
        </p>
      )}
        <SeccionEscala
          key={campo}
          mapa={x?.escena.mapa}
          unidad={unidad}
          elegida={elegida}
          onCambio={(e) => setEscalas((m) => ({ ...m, [campo]: e }))}
        />
        <Seccion titulo="Valor en el punto">
          {puntoValido ? (
            puntoValido.v ? (
              <div className="px-3.5 py-2">
                <div className="mono text-[11px] text-text-disabled">
                  {puntoValido.v.losa} · ({fmt(puntoValido.p[0], 2)}; {fmt(puntoValido.p[1], 2)}) m
                </div>
                <div className="mono text-[17px] font-medium" data-valor-punto={puntoValido.v.valor}>
                  {fmt(puntoValido.v.valor, dec)} {unidad}
                </div>
                {puntoValido.v.otros && (
                  <div className="mono text-[12px] text-state-warn">
                    salto: también {puntoValido.v.otros.map((o) => fmt(o, dec)).join(" · ")} {unidad}
                  </div>
                )}
                <div className="text-[11px] text-text-secondary">
                  {puntoValido.v.comb} · {puntoValido.v.lamina >= 0 ? `interpolado en la lámina ${puntoValido.v.lamina}, como las bandas` : "el extremo rotulado"}
                  {puntoValido.v.otros ? ". En el borde de dos regiones (pliegue, ábaco) el campo salta y no se promedia (E5-7)." : ""}
                </div>
              </div>
            ) : (
              <p className="nota">Fuera de las losas, o en una lámina sin mapa (las rígidas de las huellas de los pilares).</p>
            )
          ) : (
            <p className="nota">Clic en el mapa para leer el valor de un punto.</p>
          )}
        </Seccion>
        {x && (
          <>
            <Seccion titulo="Extremos de la planta" valor={x.dibujada?.nombre}>
              {x.escena.extremos.map((ex, i) => (
                <button key={i} type="button" className="lista-fila" style={{ gridTemplateColumns: "1fr auto", height: "auto", padding: "6px 14px" }} onClick={() => ex.punto && setPunto({ p: ex.punto, v: ex.punto ? { valor: ex.valor, unidad: ex.unidad, losa: ex.objeto ?? "", lamina: -1, comb: ex.comb ?? "" } : null, planta: planta!, clave })} title="Marcar el punto">
                  <span>
                    <span className="block text-text-primary">{ex.que}</span>
                    <span className="mono text-[11px] text-text-disabled">
                      {ex.objeto} · {ex.punto ? `(${fmt(ex.punto[0], 2)}; ${fmt(ex.punto[1], 2)})` : ""}
                    </span>
                  </span>
                  <span className="mono text-[13px] text-text-primary" data-extremo={ex.valor}>
                    {fmt(ex.valor, dec)} {ex.unidad}
                  </span>
                </button>
              ))}
              {!x.escena.extremos.length && <p className="nota">{x.escena.notas.join(" ")}</p>}
            </Seccion>
            <Seccion titulo="Flechas" valor={x.combinacionesFlechas.descripcion}>
              {x.flechas.length ? (
                <table className="tb">
                  <thead>
                    <tr>
                      <th>Losa</th>
                      <th>Máxima mm</th>
                      <th>Relativa mm</th>
                    </tr>
                  </thead>
                  <tbody>
                    {x.flechas.map((f) => (
                      <tr key={f.id}>
                        <td>
                          {f.id}
                          <small>{f.tipo === "pano" ? "unidireccional" : "losa"}</small>
                        </td>
                        <td>
                          {mm(f.maxima.v)}
                          <small>{f.maxima.comb}</small>
                        </td>
                        <td>
                          {f.relativa ? mm(f.relativa.v) : "—"}
                          <small>{f.relativa ? `${f.relativa.comb}${f.relativa.pilares ? ` · ${f.relativa.pilares.join(", ")}` : ""}` : ""}</small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="nota">La planta no tiene losas ni paños.</p>
              )}
              <p className="nota">Hacia abajo, positivas. Relativa: a las esquinas de su recuadro de pilares (losas) o a los extremos del vano (paños), como `fem consultar flechas`.</p>
            </Seccion>
          </>
        )}
        <Equilibrio estado={e} />
    </>
  );

  return (
    <Disposicion
      paneles={pan}
      etiquetaHerramientas="Herramientas de Resultados"
      herramientas={herramientas}
      vista={vista}
      props={{ titulo: "Propiedades", contenido: propiedades, ancho: 340 }}
      dock={[{ id: "combinaciones", titulo: "Combinaciones", insignia: x?.combinaciones.nombres.length, contenido: x ? <TablaCombinaciones c={x.combinaciones} resaltar={x.dibujada?.nombre} /> : <p className="nota">…</p> }]}
    />
  );
}
