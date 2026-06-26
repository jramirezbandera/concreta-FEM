import { test, expect } from "@playwright/test";
import { abrirApp, bridge } from "./fixtures";

// =============================================================================
// F1.pipeline.happy.spec.ts — Cableado del pipeline F1, camino feliz (feature-16,
// T1.1, decisiones D5/D7/D10).
//
// QUE PRUEBA (nombre honesto, D10): que el DATO FLUYE de extremo a extremo por el
// CABLEADO del pipeline F1 en la app real:
//   obra (Capa 1) -> Calcular (boton) -> discretizar -> solver -> resultados ->
//   deformada + diagramas + reacciones en la UI.
// El solver real (Pyodide+PyNite) se sustituye por el MOCK consciente del modelo
// (D7): determinista, sin arranque de Python, y con numeros COHERENTES con el
// ModeloFEM recibido (ΣFY de reacciones = +100 kN). Asi el spec puede asertar un
// VALOR CONCRETO (no solo "hay tabla").
//
// QUE NO PRUEBA (D10): el flujo de DIBUJO (picking/colocacion/inspector-al-pulsar
// en el canvas R3F). Eso lo cubren los component tests (flujoEntradaPilares,
// ColocacionViga, ...). Aqui la obra se construye por la COSTURA window.__concreta
// (crearPilar/crearViga/anadirCargaLineal), no por el canvas. Lo unico que se
// ejercita por DOM real es lo que ES DOM: el dialogo de grupos/plantas, las
// pestanas, el boton Calcular y los paneles de resultados.
//
// La numerica de libro (qL²/8, flechas) la cubren los golden de Node; aqui no se
// re-asevera (seria acoplar la red de seguridad al mock).
// =============================================================================

// Hipotesis sembrada por crearModeloVacio (helpers.ts): el modelo nuevo SIEMPRE
// trae estas dos hipotesis basicas de F1 con ids ASCII fijos y deterministas. La
// carga lineal del spec cuelga de "Cargas muertas" (permanente). No hace falta
// crearla por UI: existe desde el arranque (estadoObra solo expone grupos/plantas,
// pero la hipotesis es un id estable del dominio).
const HIPOTESIS_PERMANENTE = "hip-cargas-muertas";

// Valor concreto que el mock consciente del modelo reparte entre los apoyos: ΣFY de
// las reacciones = +CARGA_TOTAL_FY (equilibrio plausible, signo correcto). Es el
// numero que el spec asevera en la tabla de reacciones (D7/req del plan).
const SIGMA_FY_ESPERADA = 100;

test("F1 happy: obra -> Calcular (boton) -> deformada + diagramas + reacciones", async ({
  page,
}) => {
  // 1) Abrir la app en estado limpio y determinista (limpia IndexedDB ANTES de
  // goto, fija el flag del mock, espera app-ready). mock=true por defecto: el
  // worker real (Pyodide) nunca arranca.
  await abrirApp(page);

  // ---------------------------------------------------------------------------
  // 2) Grupos + 2 plantas POR EL DIALOGO REAL (DOM). Sin costura aqui: queremos
  // ejercitar el dialogo Radix de verdad (commit en vivo, sin boton "Guardar").
  // ---------------------------------------------------------------------------
  // El acceso al dialogo vive en la Sidebar como fila pulsable (FilaArbol -> <button>).
  await page.getByRole("button", { name: "Gestionar plantas y grupos…" }).click();

  const dialogo = page.getByRole("dialog", { name: "Plantas y grupos" });
  await expect(dialogo).toBeVisible();

  // Un grupo (commit inmediato: queda seleccionado como activo).
  await dialogo.getByRole("button", { name: "Nuevo grupo" }).click();

  // Dos plantas en ese grupo. "Nueva planta" aparece solo con un grupo activo.
  const nuevaPlanta = dialogo.getByRole("button", { name: "Nueva planta" });
  await nuevaPlanta.click();
  await nuevaPlanta.click();

  // Cerrar el dialogo (boton del pie). El estado ya esta commiteado en el store.
  // Hay dos botones con nombre accesible "Cerrar": la "×" de la cabecera Radix
  // (aria-label) y el ghost del pie (texto). Filtramos por TEXTO "Cerrar" para
  // quedarnos con el del pie (la "×" tiene texto "×", no "Cerrar").
  await dialogo
    .getByRole("button", { name: "Cerrar" })
    .filter({ hasText: "Cerrar" })
    .click();
  await expect(dialogo).toBeHidden();

  // ---------------------------------------------------------------------------
  // 3) Leer los ids creados por el dialogo y construir la obra POR LA COSTURA.
  // estadoObra() devuelve los grupos/plantas reales (creados por el DOM de arriba);
  // de ahi salen los plantaId para crearPilar/crearViga.
  // ---------------------------------------------------------------------------
  const c = await bridge(page);

  const obra = await c.evaluate((api) => api.estadoObra());
  expect(obra.grupos.length).toBe(1);
  expect(obra.plantas.length).toBe(2);

  // Orden de plantas: el dialogo las crea con cotas crecientes (cada nueva planta se
  // apila sobre la mas alta). No dependemos del orden del array: tomamos la planta de
  // cota MENOR como "baja" (donde apoyan los pilares) por su grupoId comun. Como
  // estadoObra no expone la cota, basta con tomar las dos plantas del unico grupo:
  // los pilares van de la primera a la segunda (un tramo), la viga en la segunda.
  const grupoId = obra.grupos[0]!.id;
  const plantasGrupo = obra.plantas.filter((p) => p.grupoId === grupoId);
  expect(plantasGrupo.length).toBe(2);
  const plantaBaja = plantasGrupo[0]!.id;
  const plantaAlta = plantasGrupo[1]!.id;

  // Dos pilares (de planta baja a alta) + una viga que los une en la planta alta +
  // una carga lineal sobre la viga (hipotesis permanente sembrada). Todo por la
  // costura: despacha los comandos de dominio reales (un paso de undo cada uno).
  const { vigaId } = await c.evaluate(
    (api, p) => {
      api.crearPilar({
        x: 0,
        y: 0,
        plantaInicial: p.plantaBaja,
        plantaFinal: p.plantaAlta,
      });
      api.crearPilar({
        x: 5,
        y: 0,
        plantaInicial: p.plantaBaja,
        plantaFinal: p.plantaAlta,
      });
      const vId = api.crearViga({
        plantaId: p.plantaAlta,
        xi: 0,
        yi: 0,
        xj: 5,
        yj: 0,
      });
      api.anadirCargaLineal({
        elementoId: vId,
        valor: -10, // kN/m gravitatoria (hacia abajo)
        hipotesisId: p.hipotesisId,
      });
      return { vigaId: vId };
    },
    { plantaBaja, plantaAlta, hipotesisId: HIPOTESIS_PERMANENTE },
  );

  // Sanidad de la obra construida antes de calcular (la costura la ve completa).
  const resumen = await c.evaluate((api) => api.resumenModelo());
  expect(resumen).toEqual({ pilares: 2, vigas: 1, cargas: 1 });

  // ---------------------------------------------------------------------------
  // 4) Ir a Resultados y CALCULAR POR EL BOTON (no el menu: el menu no alimenta el
  // sink y el estado/errores no se reflejarian — T-calcular-menu-sink).
  // ---------------------------------------------------------------------------
  await page.getByRole("tab", { name: "Resultados" }).click();

  // El BOTON de calculo (BotonCalcular) — NO el disparador del menu "▶ Calcular obra"
  // (placeholder deshabilitado que no alimenta el sink). El nombre accesible del boton
  // real es EXACTAMENTE su etiqueta de estado ("Calcular"/"Calculando…"/"Reintentar"/
  // "Cargando motor…"); anclamos el regex para excluir "Calcular obra".
  const botonCalcular = page.getByRole("button", {
    name: /^(Calcular|Calculando…|Reintentar|Cargando motor…)$/,
  });
  await expect(botonCalcular).toBeEnabled(); // el mock reporta el motor "listo"
  // dispatchEvent en vez de click(): el boton es visible/enabled, pero otro panel
  // flotante del HUD (control de plantas "↓") se solapa en el layout glass e
  // intercepta el puntero, lo que haria fallar el chequeo de actionability de click().
  // No es un problema de la app (ambos paneles son operables por el usuario real, sin
  // un puntero de 1px). dispatchEvent envia el evento DIRECTO al target ya verificado
  // (React lo recibe via su listener sintetico) sin pelear por el z-order.
  await botonCalcular.dispatchEvent("click");

  // ESTADO TRANSITORIO (D5): el mock deja calcular() PENDIENTE hasta resolver(). El
  // boton refleja "Calculando…" y aria-busy=true mientras tanto. Lo aseveramos
  // ANTES de liberar la promesa del mock.
  await expect(botonCalcular).toHaveAttribute("aria-busy", "true");
  await expect(botonCalcular).toHaveText("Calculando…");

  // Liberar la promesa pendiente del mock -> resuelve con resultados CONSCIENTES DEL
  // MODELO (nombres reales de members/supports/combos + ΣFY = +100 kN). Las funciones
  // del control NO serializan: se llaman DENTRO de evaluate.
  await page.evaluate(() => window.__concreta!.usarMockSolver().resolver());

  // Tras resolver, el boton vuelve a "Calcular" (sin trabajo en curso).
  await expect(botonCalcular).toHaveAttribute("aria-busy", "false");
  await expect(botonCalcular).toHaveText("Calcular");

  // ---------------------------------------------------------------------------
  // 5) ASEVERAR EL RESULTADO: pestana activa, deformada visible, selector de
  // magnitud funcional, y un VALOR CONCRETO que prueba que el dato fluye.
  // ---------------------------------------------------------------------------
  // 5.a Pestana Resultados activa (auto-switch tras el calculo, useCalcular).
  await expect(page.getByRole("tab", { name: "Resultados" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // 5.b Deformada: el canvas R3F del viewport esta visible (unico gancho estable).
  await expect(page.getByTestId("viewport-canvas")).toBeVisible();

  // 5.c El selector de magnitud (N/V/M/Flecha) del panel de diagramas funciona: es
  // un radiogroup Radix; al activar "M" queda marcado. Acotado al panel-diagramas
  // para no enganchar otros controles.
  const panelDiagramas = page.getByTestId("panel-diagramas");
  await expect(panelDiagramas).toBeVisible();
  const radioM = panelDiagramas.getByRole("radio", { name: "M" });
  await radioM.click();
  await expect(radioM).toHaveAttribute("aria-checked", "true");

  // 5.d EL DATO FLUYE A DIAGRAMAS: con la VIGA seleccionada, el panel resuelve su
  // barra (trazabilidad.vigaAMember -> member real del mock) y dibuja, NO muestra
  // los textos guia "sin barra"/"sin seleccion". Seleccionar abre el inspector y
  // alimenta PanelDiagramas (reacciona a seleccionStore).
  await c.evaluate((api, id) => api.seleccionar([id]), vigaId);

  // El panel ya no muestra el placeholder de "no hay barra/seleccion". (Esos textos
  // son del estado vacio; con resultados + viga seleccionada NO deben aparecer.)
  await expect(
    panelDiagramas.getByText("Selecciona una barra para ver sus esfuerzos."),
  ).toHaveCount(0);
  await expect(
    panelDiagramas.getByText("Esta barra no tiene esfuerzos en el último cálculo."),
  ).toHaveCount(0);
  await expect(
    panelDiagramas.getByText("Calcula la obra para ver los esfuerzos."),
  ).toHaveCount(0);

  // 5.e EL DATO FLUYE A REACCIONES: la fila ΣFY de la tabla de reacciones suma
  // +100 kN (mock consciente del modelo, D7). Acotamos a la tabla y leemos la fila
  // de resumen (su scope=row es "ΣFY"); su celda numerica FY debe ser ~+100.
  const tablaReacciones = page.getByTestId("tabla-reacciones");
  await expect(tablaReacciones).toBeVisible();

  // Fila de resumen: <tr> que contiene la cabecera de fila "ΣFY". Leemos su valor
  // numerico (la celda mono bajo la columna FY) y comprobamos ≈ +100 kN.
  const filaSigma = tablaReacciones.getByRole("row", { name: /ΣFY/ });
  await expect(filaSigma).toBeVisible();

  const textoSigma = await filaSigma.textContent();
  // La fila contiene "ΣFY", la celda FY (~100.00) y la nota "suma de reacciones
  // verticales (kN)". Extraemos el primer numero con signo de la celda numerica.
  const match = textoSigma?.match(/-?\d+(?:[.,]\d+)?/);
  expect(match, `fila ΣFY sin numero legible: ${textoSigma ?? "<vacio>"}`).not.toBeNull();
  const valorSigma = Number(match![0].replace(",", "."));
  expect(valorSigma).toBeCloseTo(SIGMA_FY_ESPERADA, 1); // ≈ +100 kN, signo correcto
});
