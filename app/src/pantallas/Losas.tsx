/**
 * Resultados · Losas (la pantalla 3 de V1): uz, M11, M22, M12, V13 y V23 por planta (la escena
 * `vistaCampo` de A4). Con varias combinaciones, su envolvente en cada nudo, la máxima o la mínima
 * (UI-1: antes, la combinación de mayor |valor| de la planta, que no es la envolvente); con una, esa.
 * Un clic da el valor del punto interpolado como el mapa (la consulta `valor-punto`, no el color) y,
 * en una envolvente, el máximo y el mínimo de las combinaciones en él, cada uno con la suya; en
 * Propiedades, ese valor, los extremos y las flechas de `fem consultar flechas`; abajo, las
 * combinaciones. En uz, la flecha se lee hacia abajo y en positivo (UI-14).
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
import type { Campo, Envolvente } from "../../../src/agente/render/resultados.ts";
import type { EleccionCombinaciones } from "../../../src/visor/sesion.ts";
import type { ValorPunto } from "../../../src/visor/datos.ts";
import type { SuperficiesMapa } from "../../../src/visor/isovalores3d.ts";
import { Chip, Desplegable, Disposicion, Segmentado, Separador } from "../armazon/Disposicion.tsx";
import { usePaneles } from "../armazon/paneles.ts";
import { IcLosas } from "../armazon/iconos.tsx";
import { Aviso, Cabecera, ComboCombinaciones, Equilibrio, Seccion, TablaCombinaciones, TITULO_COMBINACIONES, AvisoDesactualizado } from "../componentes/comunes.tsx";
import { escalaDe, SeccionEscala, type EscalaElegida } from "../componentes/escala.tsx";
import { BarraModos } from "../espacios/BarraModos.tsx";
import { useVisor } from "../contexto.ts";
import { fmt, mm, textoApp, coma } from "../fmt.ts";
import { usePedido } from "../sesion/usePedido.ts";
import { BarraVistas } from "../vistas/BarraVistas.tsx";
import { useVistas, vistasDe } from "../vistas/estado.ts";
import type { Marca } from "../vistas/vista2d.ts";
import { queCombinaciones, useSonda } from "../vistas/sonda.ts";
import { Fuente2D, Fuente3DModelo, ZonaVistas } from "../vistas/Zona.tsx";

type Punto = { p: Vec2; v: ValorPunto | null; planta: string; clave: string };

/** Un valor del mapa en texto: en uz, la flecha hacia abajo en positivo y lo que sube, con su flecha (UI-14). */
export function textoValor(campo: Campo, v: number, dec: number, unidad: string): string {
  if (campo !== "uz" || v === 0) return `${fmt(v, dec)} ${unidad}`;
  return v < 0 ? `↓ ${fmt(-v, dec)} ${unidad}` : `↑ ${fmt(v, dec)} ${unidad}`;
}

/** Las dos envolventes de un mapa, con su nombre: en uz, la flecha (la mínima) y lo que sube (la máxima). */
const ENVOLVENTES = (campo: Campo): { id: Envolvente; nombre: string; title: string }[] =>
  campo === "uz"
    ? [
        { id: "min", nombre: "↓ Flecha", title: "En cada nudo, lo que más baja de todas las combinaciones (la envolvente mínima de uz)" },
        { id: "max", nombre: "↑ Hacia arriba", title: "En cada nudo, lo que más sube de todas las combinaciones (la envolvente máxima de uz)" },
      ]
    : [
        { id: "max", nombre: "Máxima", title: "En cada nudo, el mayor valor de todas las combinaciones, con la suya" },
        { id: "min", nombre: "Mínima", title: "En cada nudo, el menor valor de todas las combinaciones, con la suya" },
      ];

/** El mapa de una planta en una vista: un clic da el valor del punto. */
function PlantaLosas({ planta, campo, eleccion, escala, envolvente, punto, onPunto, dec, unidad, malla }: { planta: string; campo: Campo; eleccion: EleccionCombinaciones; escala: EscalaMapa | undefined; envolvente: Envolvente; punto: Punto | null; onPunto: (p: Vec2, planta: string) => void; dec: number; unidad: string; malla?: boolean }) {
  const { proyecto } = useVisor();
  const d = usePedido(proyecto.cliente, { tipo: "losas", planta, campo, combinaciones: eleccion, envolvente, ...(escala ? { escala } : {}), ...(malla ? { malla } : {}) });
  const marcas: Marca[] = punto && punto.planta === planta ? [{ p: punto.p, texto: punto.v ? textoValor(campo, punto.v.valor, dec, unidad) : "sin mapa" }] : [];
  const aviso = proyecto.desactualizado ? <AvisoDesactualizado /> : d.diagnosticos ? <Aviso tono="fail">{d.diagnosticos.map((x) => x.mensaje).join(" ")}</Aviso> : !d.datos && d.cargando ? <Aviso>Suavizando los campos…</Aviso> : null;
  return <Fuente2D escena={proyecto.desactualizado ? null : (d.datos?.escena ?? null)} marcas={marcas} eventos={{ clic: (p) => onPunto(p, planta) }} aviso={aviso} cargando={d.cargando} />;
}

/** El mapa en un 3D (I4): el de la planta de su cabecera, o los de todas; bajo el cursor, el valor del punto. */
function TresDLosas({ planta, campo, eleccion, escala, envolvente, superficies, dec }: { planta: string | null; campo: Campo; eleccion: EleccionCombinaciones; escala: EscalaMapa | undefined; envolvente: Envolvente; superficies: SuperficiesMapa; dec: number }) {
  const { proyecto } = useVisor();
  const d = usePedido(proyecto.cliente, proyecto.desactualizado ? null : { tipo: "isovalores3d", campo, combinaciones: eleccion, planta, superficies, envolvente, ...(escala ? { escala } : {}) });
  const aviso = proyecto.desactualizado ? <AvisoDesactualizado /> : d.diagnosticos ? <Aviso tono="fail">{d.diagnosticos.map((x) => x.mensaje).join(" ")}</Aviso> : !d.datos && d.cargando ? <Aviso>{campo === "uz" ? "Preparando el mapa…" : "Suavizando los campos…"}</Aviso> : null;
  const datos = proyecto.desactualizado ? null : d.datos;
  const cliente = proyecto.cliente;
  const comb = datos?.combinacion?.nombre;
  // En una envolvente (UI-1), la sonda da la de ese punto, con la combinación que manda en él
  const env = datos?.envolvente;
  const { alPasar, sonda } = useSonda(
    cliente && (comb || env)
      ? async (o) => {
          if (o.tipo !== "lamina") return null;
          const r = await cliente.pedir({ tipo: "valor-lamina", campo, combinaciones: eleccion, ...(env ? { envolvente: env } : { nombre: comb }), lamina: o.lamina, punto: o.p });
          const v = r.ok ? (r.valor as { valor: number; unidad: string; objeto: string; planta: string; comb: string } | null) : null;
          return v ? [textoValor(campo, v.valor, dec, v.unidad), `${v.objeto} · ${v.planta} · ${v.comb}`] : ["sin mapa"];
        }
      : null,
    JSON.stringify([planta, campo, eleccion, escala, superficies, comb, env]),
  );
  return <Fuente3DModelo resultados={{ isovalores: datos, leyenda: datos, aviso, cargando: d.cargando, alPasar, sonda }} />;
}

/** En un mapa de envolvente, el máximo y el mínimo de las combinaciones en el punto clicado, cada uno con la suya (UI-1). */
function EnvolventePunto({ env, campo, dec, unidad }: { env: NonNullable<ValorPunto["envolvente"]>; campo: Campo; dec: number; unidad: string }) {
  return (
    <div className="mt-1.5">
      {(["max", "min"] as const).map((k) => (
        <div key={k} className="fila" style={{ padding: 0 }}>
          <span>{campo === "uz" ? (k === "min" ? "Lo que más baja" : env.max.valor > 0 ? "Lo que más sube" : "Lo que menos baja") : k === "max" ? "Máximo" : "Mínimo"} en el punto</span>
          <span className="v" data-envolvente-punto={k}>
            {textoValor(campo, env[k].valor, dec, unidad)} <small>{env[k].comb}</small>
          </span>
        </div>
      ))}
    </div>
  );
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
  const [envolventes, setEnvolventes] = useState<Partial<Record<Campo, Envolvente>>>({});
  const [superficies, setSuperficies] = useState<SuperficiesMapa>("losas");
  const elegida = escalas[campo] ?? { modo: "completa" };
  const escala = escalaDe(elegida);
  // Por defecto, la flecha en uz y la máxima en lo demás (UI-1)
  const envolvente: Envolvente = envolventes[campo] ?? (campo === "uz" ? "min" : "max");
  const eleccion = campo === "uz" ? elDesp : elEsf;
  const setEleccion = campo === "uz" ? setElDesp : setElEsf;
  const dec = CAMPOS.find((c) => c.id === campo)!.dec;
  const d = usePedido(proyecto.cliente, planta ? { tipo: "losas", planta, campo, combinaciones: eleccion, envolvente, ...(escala ? { escala } : {}) } : null);
  const x = d.datos;
  // La envolvente sólo cuenta con varias combinaciones (la de por defecto o la de una situación)
  const varias = x ? x.combinaciones.nombres.length > 1 : eleccion.tipo === "defecto" || eleccion.tipo === "situaciones";
  const clave = JSON.stringify([planta, campo, eleccion, envolvente, proyecto.version]);
  // Con uz en pantalla, el worker adelanta el SPR de la planta: M11, M22… salen luego sin esperarlo
  const listo = !!x && !d.cargando;
  useEffect(() => {
    if (listo && planta && proyecto.cliente) void proyecto.cliente.pedir({ tipo: "precalentar", planta }).catch(() => {});
  }, [listo, planta, proyecto.cliente]);
  // El punto es de la planta activa (un clic en una vista la activa)
  const puntoValido = punto && punto.clave === clave && punto.planta === planta ? punto : null;
  const claveDe = (pl: string) => JSON.stringify([pl, campo, eleccion, envolvente, proyecto.version]);

  const clic = async (p: Vec2, pl: string) => {
    if (!proyecto.cliente) return;
    const r = await proyecto.cliente.pedir({ tipo: "valor-punto", planta: pl, campo, combinaciones: eleccion, envolvente, x: p[0], y: p[1], ...(escala ? { escala } : {}) });
    setPunto({ p, v: r.ok ? (r.valor as ValorPunto | null) : null, planta: pl, clave: claveDe(pl) });
  };

  const unidad = campo === "uz" ? "mm" : campo.startsWith("m") ? "kN·m/m" : "kN/m";
  const resumenComb = queCombinaciones(x ? { descripcion: x.combinaciones.descripcion, n: x.combinaciones.nombres.length } : undefined, x?.dibujada?.nombre);
  /** La envolvente, dicha: en uz, la de la flecha o la de lo que sube. */
  const textoEnv = campo === "uz" ? (envolvente === "min" ? "envolvente de la flecha" : "envolvente hacia arriba") : envolvente === "max" ? "envolvente máxima" : "envolvente mínima";
  /** Lo que se dibuja, en corto: la envolvente o la combinación. */
  const dibujado = x?.envolvente ? textoEnv : (x?.dibujada?.nombre ?? "—");

  const nombreCampo = CAMPOS.find((c) => c.id === campo)!.nombre;
  const herramientas = (
    <>
      {/* Los modos, siempre en el mismo sitio (UI-51); detrás, lo de cada modo */}
      <BarraModos />
      <Separador />
      <ComboCombinaciones estado={e} valor={eleccion} onCambio={setEleccion} proposito={campo === "uz" ? "desplazamientos" : "esfuerzos"} />
      {varias && <Segmentado etiqueta="Envolvente" opciones={ENVOLVENTES(campo)} valor={envolvente} onCambio={(v) => setEnvolventes((m) => ({ ...m, [campo]: v }))} />}
      <Separador />
      <Segmentado etiqueta="Magnitud" opciones={CAMPOS.map((c) => ({ id: c.id, nombre: c.nombre }))} valor={campo} onCambio={setCampo} />
      <Separador />
      <BarraVistas />
    </>
  );
  const vista = (
    <ZonaVistas
      fuentes={{
        planta: (v) => (v.planta ? <PlantaLosas planta={v.planta} campo={campo} eleccion={eleccion} escala={escala} envolvente={envolvente} punto={punto && punto.clave === claveDe(v.planta) ? punto : null} onPunto={(p, pl) => void clic(p, pl)} dec={dec} unidad={unidad} malla={!!v.malla} /> : null),
        malla: true,
        cabeceraPlanta: (v, i) => (
          <>
          <Chip acento title={v.planta === planta ? `${x?.envolvente ? resumenComb : coma(x?.dibujada?.etiqueta ?? "")}${d.ms !== null ? ` · ${fmt(d.ms, 0)} ms` : ""}` : undefined}>
            {nombreCampo} · {unidad}
            {elegida.modo !== "completa" && ` · ${elegida.modo === "sin-picos" ? "sin picos" : "escala manual"}`}
            {v.planta === planta && (
              <>
                {" · "}
                <span className={x?.envolvente ? undefined : "mono"}>{dibujado}</span>
              </>
            )}
          </Chip>
          {/* UI-24: en una planta sin losas, a cuáles ir (como en Armado) */}
          {v.planta && x && !x.plantasConLosas.includes(v.planta) && (
            <>
              <Chip>Sin losas aquí</Chip>
              {x.plantasConLosas.slice(0, 4).map((p) => (
                <button key={p} type="button" className="chip" data-acento onClick={() => vistas.poner(i, { planta: p })}>
                  Ir a {p}
                </button>
              ))}
            </>
          )}
          </>
        ),
        tresD: (v) => <TresDLosas planta={v.planta} campo={campo} eleccion={eleccion} escala={escala} envolvente={envolvente} superficies={superficies} dec={dec} />,
        cabecera3D: () => (
          <>
            <Desplegable etiqueta="Superficies del mapa" valor={superficies} onCambio={setSuperficies} opciones={SUPERFICIES} />
            <Chip acento title={resumenComb}>
              {nombreCampo} · {unidad}
              {varias && ` · ${textoEnv}`}
              {/* UI-23: la combinación también en el 3D */}
              {!varias && eleccion.tipo === "combinacion" && ` · ${eleccion.nombre}`}
              {superficies !== "losas" && ` · ${SUPERFICIES.find((x) => x.id === superficies)!.nombre.toLowerCase()}`}
              {elegida.modo !== "completa" && ` · ${elegida.modo === "sin-picos" ? "sin picos" : "escala manual"}`}
            </Chip>
          </>
        ),
      }}
    />
  );

  const propiedades = (
    <>
      <Cabecera
        icono={IcLosas}
        tipo={`Losas · ${planta ?? "—"}`}
        titulo={`${CAMPOS.find((c) => c.id === campo)!.nombre} · ${unidad}`}
        detalle={
          x ? (
            x.envolvente ? (
              <>
                Se dibuja la <b className="font-medium">{textoEnv}</b> de las {x.combinaciones.nombres.length} combinaciones de {x.combinaciones.descripcion}: en cada nudo, la de {x.envolvente === "max" ? "mayor" : "menor"} valor.
              </>
            ) : (
              <>
                Se dibuja <b className="mono font-medium">{x.dibujada?.nombre ?? "—"}</b>.
              </>
            )
          ) : undefined
        }
      />
      {/* UI-23: lo de este panel es de la planta; el 3D puede estar enseñando los muros o todas las plantas */}
      {superficies !== "losas" && vistas.vistas[vistas.activa]?.tipo === "3d" && (
        <p className="nota">El 3D dibuja {SUPERFICIES.find((y) => y.id === superficies)!.nombre.toLowerCase()}; lo de aquí abajo es de las losas de {planta ?? "la planta"}.</p>
      )}
      {x && <p className="nota">uz en los nudos; momentos y cortantes suavizados entre láminas, en los ejes de cada losa. Las bandas no interpolan el color: el número de un punto, con un clic.</p>}
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
                <div className="mono text-[11px] text-text-muted">
                  {puntoValido.v.losa} · ({fmt(puntoValido.p[0], 2)}; {fmt(puntoValido.p[1], 2)}) m
                </div>
                <div className="mono text-[18px] font-medium" data-valor-punto={puntoValido.v.valor}>
                  {textoValor(campo, puntoValido.v.valor, dec, unidad)}
                </div>
                {puntoValido.v.otros && (
                  <div className="mono text-[12px] text-state-warn">
                    salto: también {puntoValido.v.otros.map((o) => fmt(o, dec)).join(" · ")} {unidad}
                  </div>
                )}
                <div className="text-[11px] text-text-secondary">
                  {puntoValido.v.comb} · {puntoValido.v.lamina >= 0 ? (puntoValido.v.envolvente ? "la que manda en el punto" : "interpolado entre los nudos del elemento") : "el extremo rotulado"}
                  {puntoValido.v.otros ? ". En el borde de dos regiones (pliegue, ábaco) el campo salta y no se promedia." : ""}
                </div>
                {puntoValido.v.envolvente && <EnvolventePunto env={puntoValido.v.envolvente} campo={campo} dec={dec} unidad={unidad} />}
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
            {/* Con nombre: el 3D de todas las plantas rotula otros extremos, los de todo el edificio */}
            <Seccion titulo={`Extremos de ${planta ?? "la planta"}`} valor={x.envolvente ? textoEnv : x.dibujada?.nombre}>
              {x.escena.extremos.map((ex, i) => (
                <button key={i} type="button" className="lista-fila" style={{ gridTemplateColumns: "1fr auto", height: "auto", padding: "6px 14px" }} onClick={() => ex.punto && setPunto({ p: ex.punto, v: ex.punto ? { valor: ex.valor, unidad: ex.unidad, losa: ex.objeto ?? "", lamina: -1, comb: ex.comb ?? "" } : null, planta: planta!, clave })} title="Marcar el punto">
                  <span>
                    <span className="block text-text-primary">{ex.que}</span>
                    <span className="mono text-[11px] text-text-muted">
                      {ex.objeto} · {ex.punto ? `(${fmt(ex.punto[0], 2)}; ${fmt(ex.punto[1], 2)})` : ""}
                      {x.envolvente && ex.comb ? ` · ${ex.comb}` : ""}
                    </span>
                  </span>
                  <span className="mono text-[13px] text-text-primary" data-extremo={ex.valor}>
                    {textoValor(campo, ex.valor, dec, ex.unidad)}
                  </span>
                </button>
              ))}
              {!x.escena.extremos.length && <p className="nota">{textoApp(x.escena.notas.join(" "))}</p>}
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
              <p className="nota">Hacia abajo, positivas. Relativa: a las esquinas de su recuadro de pilares (losas) o a los extremos del vano (paños).</p>
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
      dock={[{ id: "combinaciones", titulo: TITULO_COMBINACIONES, insignia: x?.combinaciones.nombres.length, contenido: x ? <TablaCombinaciones c={x.combinaciones} resaltar={x.dibujada?.nombre} /> : <p className="nota">…</p> }]}
    />
  );
}
