/**
 * Resultados · Modal (VS4, `docs/fem3d/viento-sismo.md` §3.5): las masas y los modos de vibración del
 * cálculo (`fem consultar modos`) y, con el espectro, el sismo del programa (`fem consultar sismo`).
 *
 * - En el 3D, la forma del modo elegido como una deformada animada (la de I4), con la mayor
 *   traslación de los centros de masas igual a la escala.
 * - En Propiedades, el modo (periodo, frecuencia, masa efectiva), las masas por planta con su centro de
 *   masas y, con espectro, el cortante en la base de cada dirección y el aviso de segundo orden.
 * - Abajo, la tabla de los modos (un clic elige uno) y la de los cortantes de planta por dirección.
 *
 * Todo número sale de las consultas de la sesión (pedidos `modal`, `modo` y `sismo`).
 */
import { useEffect, useMemo, useState } from "react";
import { Campo, Chip, Disposicion, Separador } from "../armazon/Disposicion.tsx";
import { Situacion } from "../armazon/Situacion.tsx";
import { usePaneles } from "../armazon/paneles.ts";
import { IcModal } from "../armazon/iconos.tsx";
import { Cabecera, Seccion, AvisoDesactualizado } from "../componentes/comunes.tsx";
import { BarraModos } from "../espacios/BarraModos.tsx";
import { useVisor } from "../contexto.ts";
import { cota, fmt, textoApp } from "../fmt.ts";
import { usePedido } from "../sesion/usePedido.ts";
import { BarraVistas } from "../vistas/BarraVistas.tsx";
import { useVistas, vistasDe } from "../vistas/estado.ts";
import { Fuente3DModelo, ZonaVistas } from "../vistas/Zona.tsx";
import { Espectro } from "../editor/Espectro.tsx";

const pct = (x: number) => `${fmt(100 * x, 1)} %`;

export function ModoModal() {
  const { proyecto } = useVisor();
  const pan = usePaneles("resultados:modal", { props: true, dock: true, pestana: "modos" });
  const vistas = useVistas();
  const sin3D = !vistas.vistas.slice(0, vistasDe(vistas.disposicion)).some((v) => v.tipo === "3d");
  useEffect(() => {
    if (sin3D) vistas.irATipo("3d");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo al entrar
  }, []);
  const e = proyecto.estado!;
  const [modo, setModo] = useState(1);
  const [escalaDada, setEscalaDada] = useState<number | null>(null);
  const [animada, setAnimada] = useState(true);
  const modal = usePedido(proyecto.cliente, { tipo: "modal" });
  const sismo = usePedido(proyecto.cliente, { tipo: "sismo" });
  const md = modal.datos?.modal ?? null;
  const n = md?.numeroDeModos ?? 0;
  const forma = usePedido(proyecto.cliente, md && modo <= n ? { tipo: "modo", modo } : null);
  const zs = e.plantas.map((p) => p.cota ?? 0);
  const alto = Math.max(1, Math.max(...zs) - Math.min(...zs));
  // La forma viene con la mayor traslación de los centros de masas igual a 1 m: la escala son los metros que se dibujan
  const escalaAuto = Math.max(0.05, Math.round(0.03 * alto * 20) / 20);
  const escala = escalaDada ?? escalaAuto;
  const m = md?.modos[modo - 1];
  const s = sismo.datos?.resultado ?? null;

  const herramientas = (
    <>
      <BarraModos />
      <Separador />
      <Campo etiqueta="Modo">
        <span className="flex items-center gap-1.5">
          <button type="button" className="btn" style={{ height: 28 }} disabled={modo <= 1} onClick={() => setModo((k) => Math.max(1, k - 1))} aria-label="Modo anterior">
            ‹
          </button>
          <select className="sel" value={modo} onChange={(x) => setModo(Number(x.target.value))} aria-label="Modo de vibración" disabled={!md}>
            {(md?.modos ?? []).map((x) => (
              <option key={x.modo} value={x.modo}>
                {x.modo} · T = {fmt(x.T, 3)} s · {pct(x.masaEfectiva[0])} X, {pct(x.masaEfectiva[1])} Y
              </option>
            ))}
          </select>
          <button type="button" className="btn" style={{ height: 28 }} disabled={modo >= n} onClick={() => setModo((k) => Math.min(n, k + 1))} aria-label="Modo siguiente">
            ›
          </button>
        </span>
      </Campo>
      <Separador />
      <Campo etiqueta="Amplitud (m)">
        <span className="flex items-center gap-1.5">
          <input type="number" min={0.01} step={0.05} className="sel w-[90px] text-right" aria-label="Amplitud de la forma, m" value={escala} onChange={(v) => setEscalaDada(Number(v.target.value) || escalaAuto)} />
          {escalaDada !== null && (
            <button type="button" className="btn" style={{ height: 28 }} onClick={() => setEscalaDada(null)} title="Volver a la amplitud automática">
              auto
            </button>
          )}
          <button type="button" className="btn" style={{ height: 28 }} aria-pressed={animada} data-on={animada} onClick={() => setAnimada((x) => !x)} title="La forma del modo, de 0 a la amplitud y vuelta, en bucle">
            {animada ? "Parar" : "Animar"}
          </button>
        </span>
      </Campo>
      <Separador />
      <BarraVistas />
    </>
  );

  const def3D = useMemo(() => (forma.datos && !proyecto.desactualizado ? { u: forma.datos.u, escala, extremos: forma.datos.extremos, animada } : null), [forma.datos, escala, proyecto.desactualizado, animada]);
  const vista = (
    <ZonaVistas
      fuentes={{
        tresD: () =>
          proyecto.desactualizado ? (
            <div className="velo">
              <AvisoDesactualizado />
            </div>
          ) : (
            <Fuente3DModelo deformada={def3D} modo="analitico" />
          ),
        cabecera3D: () =>
          proyecto.desactualizado || !m ? null : (
            <>
              <Chip>
                <strong className="font-semibold">Modo {m.modo}</strong> · T = {fmt(m.T, 3)} s · f = {fmt(m.f, 2)} Hz
              </Chip>
              <Chip acento>masa efectiva {pct(m.masaEfectiva[0])} X · {pct(m.masaEfectiva[1])} Y · {pct(m.masaEfectiva[2])} giro</Chip>
            </>
          ),
      }}
    />
  );

  const tablaModos = md ? (
    <Seccion titulo="Modos de vibración" valor={`${md.numeroDeModos}, tres por planta con masa`}>
      <table className="tb">
        <thead>
          <tr>
            <th>Modo</th>
            <th>T s</th>
            <th>f Hz</th>
            <th>Masa X</th>
            <th>Masa Y</th>
            <th>Giro</th>
            <th>Σ X</th>
            <th>Σ Y</th>
            {s && <th>V base X kN</th>}
            {s && <th>V base Y kN</th>}
          </tr>
        </thead>
        <tbody>
          {md.modos.map((x) => {
            const vx = s?.direcciones[0]?.modos.find((y) => y.modo === x.modo);
            const vy = s?.direcciones[1]?.modos.find((y) => y.modo === x.modo);
            return (
              <tr key={x.modo} data-on={x.modo === modo} onClick={() => setModo(x.modo)} style={{ cursor: "pointer" }}>
                <td>
                  {x.modo}
                  {s?.direcciones.some((d) => d.dominante.modo === x.modo) && <small>dominante según {s.direcciones.filter((d) => d.dominante.modo === x.modo).map((d) => d.eje).join(" e ")}</small>}
                </td>
                <td>{fmt(x.T, 3)}</td>
                <td>{fmt(x.f, 2)}</td>
                <td>{pct(x.masaEfectiva[0])}</td>
                <td>{pct(x.masaEfectiva[1])}</td>
                <td>{pct(x.masaEfectiva[2])}</td>
                <td>{pct(x.acumulada[0])}</td>
                <td>{pct(x.acumulada[1])}</td>
                {s && <td>{vx ? fmt(vx.cortanteBasal, 1) : "—"}</td>}
                {s && <td>{vy ? fmt(vy.cortanteBasal, 1) : "—"}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="nota">Masa efectiva de cada modo, entre la que vibra (la de las plantas con diafragma rígido), en X, en Y y en el giro alrededor del centro de masas; Σ, la acumulada. Un clic en un modo lo enseña en el 3D.{s ? " V base: el cortante en la base del modo con el espectro, con su signo; el combinado, en Propiedades." : ""}</p>
    </Seccion>
  ) : (
    <p className="nota">{modal.datos ? textoApp(modal.datos.motivo ?? "") : "…"}</p>
  );

  const tablaCortantes = s ? (
    <Seccion titulo="Cortantes de planta" valor={`regla ${s.regla === "cqc" ? "cuadrática completa" : "del art. 3.6.2.4"}`}>
      <table className="tb">
        <thead>
          <tr>
            <th>Planta</th>
            <th>Cota m</th>
            <th>Masa t</th>
            <th>V según X kN</th>
            <th>F equiv. X kN</th>
            <th>Par X kN·m</th>
            <th>u·μ X mm</th>
            <th>θ X</th>
            <th>V según Y kN</th>
            <th>F equiv. Y kN</th>
            <th>Par Y kN·m</th>
            <th>u·μ Y mm</th>
            <th>θ Y</th>
          </tr>
        </thead>
        <tbody>
          {s.direcciones[0]!.plantas.map((px, i) => {
            const py = s.direcciones[1]!.plantas[i];
            return (
              <tr key={px.plantas.join("/")}>
                <td>{px.plantas.join(" / ")}</td>
                <td>{cota(px.cota)}</td>
                <td>{fmt(px.masa, 1)}</td>
                <td>{fmt(px.cortante, 1)}</td>
                <td>{fmt(px.fuerza, 1)}</td>
                <td>{fmt(px.par, 1)}</td>
                <td>{fmt(1000 * px.desplazamiento, 1)}</td>
                <td className={px.theta >= 0.1 ? "w" : undefined}>{fmt(px.theta, 3)}</td>
                <td>{py ? fmt(py.cortante, 1) : "—"}</td>
                <td>{py ? fmt(py.fuerza, 1) : "—"}</td>
                <td>{py ? fmt(py.par, 1) : "—"}</td>
                <td>{py ? fmt(1000 * py.desplazamiento, 1) : "—"}</td>
                <td className={py && py.theta >= 0.1 ? "w" : undefined}>{py ? fmt(py.theta, 3) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="nota">V: el cortante combinado bajo la planta; F equiv.: la diferencia de los cortantes combinados (puede salir negativa en las plantas altas); par: el de la excentricidad accidental (F·e); u·μ: el desplazamiento combinado del centro de masas, por la ductilidad; θ = P·d/(V·h), art. 3.8 (por encima de 0,10 hay que considerar el segundo orden).</p>
    </Seccion>
  ) : (
    <p className="nota">{sismo.datos ? (sismo.datos.definido ? textoApp(sismo.datos.motivo ?? "…") : "Sin emplazamiento (municipio o ab) no hay espectro: sólo masas y modos. Se da en Cargas · Sismo.") : "…"}</p>
  );

  const propiedades = (
    <>
      <Cabecera icono={IcModal} tipo="Modal" titulo={m ? `Modo ${m.modo}` : "Masas y modos"} detalle={<>Las masas salen de las cargas (G entero, Q por la fracción del art. 3.2 de la NCSE-02) y los modos, de la condensación exacta a los diafragmas rígidos: todos, tres por planta con masa.</>} />
      {modal.diagnosticos && <p className="nota text-state-fail">{modal.diagnosticos.map((y) => textoApp(y.mensaje)).join(" ")}</p>}
      {m && (
        <Seccion titulo={`Modo ${m.modo}`}>
          <div className="fila">
            <span>Periodo</span>
            <span className="v">{fmt(m.T, 3)} s</span>
          </div>
          <div className="fila">
            <span>Frecuencia</span>
            <span className="v">{fmt(m.f, 3)} Hz</span>
          </div>
          <div className="fila">
            <span>Masa efectiva X · Y · giro</span>
            <span className="v">
              {pct(m.masaEfectiva[0])} · {pct(m.masaEfectiva[1])} · {pct(m.masaEfectiva[2])}
            </span>
          </div>
          <table className="tb">
            <thead>
              <tr>
                <th>Planta</th>
                <th>ux</th>
                <th>uy</th>
                <th>rz</th>
              </tr>
            </thead>
            <tbody>
              {md!.plantas.map((p, k) => (
                <tr key={p.planta}>
                  <td>{p.planta}</td>
                  <td>{fmt(m.forma[k]![0], 3)}</td>
                  <td>{fmt(m.forma[k]![1], 3)}</td>
                  <td>{fmt(m.forma[k]![2], 4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="nota">La forma en el centro de masas de cada planta, con la mayor traslación igual a 1 (rz en rad/m).</p>
        </Seccion>
      )}
      {md && (
        <Seccion titulo="Masas" valor={`${fmt(md.masas.plantas, 1)} t vibran`}>
          <div className="fila">
            <span>Peso sísmico</span>
            <span className="v">{fmt(md.peso, 0)} kN</span>
          </div>
          <div className="fila">
            <span>Al terreno · repartida por cota</span>
            <span className="v">
              {fmt(md.masas.terreno, 1)} · {fmt(md.masas.repartida, 1)} t
            </span>
          </div>
          <table className="tb">
            <thead>
              <tr>
                <th>Planta</th>
                <th>Masa t</th>
                <th>CM x · y m</th>
                <th>r giro m</th>
              </tr>
            </thead>
            <tbody>
              {md.plantas.map((p) => (
                <tr key={p.planta}>
                  <td>
                    {p.planta}
                    <small>{cota(p.cota)}</small>
                  </td>
                  <td>{fmt(p.masa, 1)}</td>
                  <td>
                    {fmt(p.cm[0], 2)} · {fmt(p.cm[1], 2)}
                  </td>
                  <td>{fmt(p.radioDeGiro, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Seccion>
      )}
      {s && (
        <Seccion titulo="Sismo del programa" valor="espectros de respuesta">
          {s.direcciones.map((d) => (
            <div className="fila" key={d.eje}>
              <span>
                Según {d.eje} · modo dominante {d.dominante.modo} (T = {fmt(d.dominante.T, 3)} s)
              </span>
              <span className="v">
                {fmt(d.cortanteBasal, 1)} kN · {pct(d.coeficienteSismico)}
              </span>
            </div>
          ))}
          <div className="fila">
            <span>Peso sísmico</span>
            <span className="v">{fmt(s.peso, 0)} kN</span>
          </div>
          {s.direcciones.some((d) => d.thetaMaxima >= 0.1) && <p className="nota text-state-warn">θ llega a {fmt(Math.max(...s.direcciones.map((d) => d.thetaMaxima)), 2)}: hay que considerar los efectos de segundo orden (art. 3.8), y este cálculo es de primer orden.</p>}
          {sismo.datos?.curva && sismo.datos.espectro && <Espectro curva={sismo.datos.curva} periodos={sismo.datos.periodos} TA={sismo.datos.espectro.emplazamiento.TA} TB={sismo.datos.espectro.emplazamiento.TB} ac={sismo.datos.espectro.emplazamiento.ac} />}
          <p className="nota">El emplazamiento y la curva, en Cargas · Sismo. Los casos EX±e y EY±e entran en las combinaciones de la situación sísmica de todas las pantallas.</p>
        </Seccion>
      )}
    </>
  );

  return (
    <Disposicion
      paneles={pan}
      etiquetaHerramientas="Herramientas de Resultados"
      herramientas={herramientas}
      vista={vista}
      nav={{ titulo: "Navegador", contenido: <Situacion /> }}
      props={{ titulo: "Propiedades", contenido: propiedades, ancho: 340 }}
      dock={[
        { id: "modos", titulo: "Modos", insignia: md?.numeroDeModos, contenido: tablaModos },
        { id: "cortantes", titulo: "Cortantes de planta", contenido: tablaCortantes },
      ]}
    />
  );
}
