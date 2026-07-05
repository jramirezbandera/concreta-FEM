# Spike T-f3-masa-placa · T0.2 — P-Δ del motor real CON PLACAS (quads)

**Estado: GO.** `analyze_PDelta(sparse=True)` **corre sin lanzar** con quads
presentes en el modelo, la deriva de las cabezas **se amplifica** frente a
`analyze_linear` con el mismo combo (ratio >1, modesto para pórticos robustos y
creciente con la esbeltez), el **equilibrio cuadra** (ΣV = carga vertical total,
ΣH = carga lateral, axiles conservados) y **no hay sorpresas** (ni no-convergencia,
ni warnings de scipy, ni iteraciones anómalas).

- Script reproducible: [`pdelta_placa_spike.py`](./pdelta_placa_spike.py)
  (`python src/solver/spikes/pdelta_placa_spike.py` imprime el informe). **No**
  forma parte de `npm test`.
- Par del motor: PyNiteFEA **2.0.2** (el del proyecto). Ejecutado con PyNite local
  (numpy 2.4.4 / scipy 1.18.0, el mismo build que el spike del CR). El álgebra de
  la rigidez geométrica es Python puro e idéntica a la que correrá en Pyodide/WASM;
  el golden de Fase 3 lo re-asertará con el **motor Pyodide real** (par 0.28.3 /
  2.0.2 / numpy 2.2.5).
- Material HA-25 **real** del catálogo (`src/biblioteca/hormigon.ts`): E = Ecm =
  22000·(fcm/10)^0,3 con fcm = 33 MPa → **31 476 MPa = 3.1476e7 kN/m²**, ν = 0.2,
  ρ = 25 kN/m³. Losa 6×6, **t = 0.25 m** (el prompt del spike pide 0.25; el golden
  de producción `losa-plana.golden.test.ts` usa 0.20 — el mecanismo es idéntico,
  solo cambia la presión de peso propio), malla 6×6 quads, q_superficial = 5 kN/m².

---

## Hallazgo rector (verificado, NO re-derivado)

Docstring oficial de `analyze_PDelta` en PyNite 2.0.2: **"P-Delta effects in
plates/quads are not considered"**. Los quads ensamblan rigidez **elástica** `k()`
pero **no** rigidez **geométrica** `kg()`. Consecuencia física, confirmada por los
números del spike:

- El P-Δ con placas amplifica el 2.º orden **solo por el axil de las BARRAS**
  (pilares) bajo la deriva lateral. La losa aporta rigidez elástica y transmite
  carga, pero **no se pandea ella misma**.
- Por eso, para un pórtico robusto (pilares cortos/gruesos), la amplificación es
  **muy modesta** (~0.5 %); solo se hace visible al esbeltar los pilares.
- El mecanismo **corre limpio**: el `analyze_PDelta` de F2a es de balanceo a nivel
  nudo, y los pilares empotrados con la losa encima aportan rigidez de sobra; no se
  cruza ninguna singularidad para las geometrías realistas ensayadas.

---

## (a) ¿P-Δ corre con quads presentes?

**SÍ, en los 4 casos** (robusto, esbelto, esbelto+q-alta, muy esbelto). Ninguna
excepción. La presencia de quads no rompe `analyze_PDelta(sparse=True)`: los quads
entran en la matriz elástica y en el vector de cargas (presión de superficie), y el
bucle P-Δ itera sobre el axil de las barras sin tocarlos.

> Nota para producción: el **glue actual BLOQUEA** P-Δ (y modal) cuando
> `len(m.quads) > 0` (`pynite_glue.py:276`, `MotorAnalisisConPanos`). Ese bloqueo
> es por la **masa de la placa** (el P-Δ *estático* de F2a aplica cargas
> explícitas, no masa; pero la decisión 6A lo agrupó con el modal). Este spike
> demuestra que el **motor** corre P-Δ con quads sin problema — el desbloqueo es una
> decisión de la feature T-f3-masa-placa, no una limitación del solver.

---

## (b) Amplificación: DX de cabezas, P-Δ vs linear (mismo combo 1.0·G + 1.0·H)

| Caso | Pilar | H | q (kN/m²) | DX linear (m) | DX P-Δ (m) | **amp = DX_PΔ/DX_lin** |
|------|-------|---|-----------|---------------|------------|------------------------|
| A robusto | 0.30×0.30 | 3.0 | 5 | 6.5052e-4 | 6.5391e-4 | **1.00522** |
| B esbelto | 0.25×0.25 | 4.0 | 5 | 2.8327e-3 | 2.8827e-3 | **1.01764** |
| C esbelto q-alta | 0.25×0.25 | 4.0 | 15 | 2.8328e-3 | 2.9273e-3 | **1.03336** |
| D muy esbelto | 0.20×0.20 | 5.0 | 30 | 1.2792e-2 | 1.5991e-2 | **1.25009** |

- **Todas > 1** (la deriva de 2.º orden crece sobre la de 1.º orden): el P-Δ está
  activo y hace su trabajo.
- **Monótona con la esbeltez y el axil**: pórtico robusto ~0.5 %, muy esbelto ~25 %.
  El caso robusto de referencia (30×30, H=3) da la amplificación **modesta**
  esperada por el prompt (rango 1.001–1.1: cae en 1.005).
- FX_total = 20 kN repartido en las 4 cabezas produce deriva visible (mm) sin
  pandear; el offset de 1 m (pilares cerca de esquina, luz interior 4 m) es la
  geometría del corazón del golden de losa plana.

---

## (c) Integridad del equilibrio

Todos los casos, tanto en linear como en P-Δ:

- **ΣFY reacciones = carga vertical total** (peso propio losa + sobrecarga + peso
  propio pilares), exacto:
  - A: ΣV = 432.0000 = Vteor 432.0000 (errRel P-Δ **1.5e-9**).
  - B: 430.0000 (errRel **4.5e-9**).
  - C: 790.0000 (errRel **1.1e-8**).
  - D: 1324.9999 vs 1325.0000 (errRel **9.1e-8**).
  El residuo de equilibrio del P-Δ crece con la esbeltez (más iteraciones de 2.º
  orden) pero se mantiene **≤ 1e-7** en todo el barrido realista.
- **ΣFX reacciones = −FX_total** (= −20.000, exacto salvo ~2e-3 en el caso D muy
  esbelto): la carga lateral se equilibra íntegra.
- **ΣFZ ≈ 0** (~1e-11, ruido numérico): sin carga en Z, sin reacción neta en Z.
- **Axiles de pilar conservados y físicamente coherentes**: bajo la deriva, el pilar
  de sotavento gana axil y el de barlovento lo pierde; la **suma** se conserva (=ΣV).
  Ejemplo D: linear [325.06, 337.44] → P-Δ [323.75, 338.75] (la pareja se abre
  ~1.3 kN por el 2.º orden, suma intacta).

---

## (d) Sorpresas

**Ninguna.** Ejecutado con `python -W all` (todos los warnings visibles):

- **Sin no-convergencia**: `analyze_PDelta` converge en todos los casos, incluido el
  muy esbelto (amp 1.25).
- **Sin warnings de scipy**: no aparece `MatrixRankWarning` ni ningún warning del
  solver disperso (a diferencia de la inestabilidad global de UNA barra del
  `pdelta.smoke.test.ts`, aquí la losa + 4 pilares empotrados es sobradamente
  estable y la matriz nunca se acerca a la singularidad).
- **Sin iteraciones anómalas**: el balanceo P-Δ a nivel nudo converge rápido; el
  coste es despreciable frente al arranque del motor.
- Único detalle numérico: el residuo de ΣV/ΣH del P-Δ es varios órdenes mayor que el
  del linear (1e-7 vs 1e-15), consistente con que el P-Δ es iterativo. No es un
  problema: sigue muy por debajo de cualquier tolerancia de equilibrio de obra.

---

## ASERCIONES RECOMENDADAS para `losa-plana-pdelta.golden.test.ts` (Fase 3)

Geometría recomendada para el golden (dos sub-casos):

**Sub-caso ROBUSTO (corazón, amplificación modesta pero real)** — losa 6×6 t=0.20 o
0.25 sobre 4 pilares 0.30×0.30 en (1,1),(5,1),(1,5),(5,5), H=3, base empotrada;
gravitatoria (pp losa + pp pilares + q=5 kN/m²) + FX_total ≈ 20 kN repartido en las 4
cabezas; combo `1.0·G + 1.0·H`:

```ts
// (a) P-Δ CORRE con quads (no lanza MotorAnalisisConPanos si la feature lo desbloquea;
//     si sigue bloqueado, ese es OTRO test — este golden asume el camino desbloqueado).
expect(r.analysis.type).toBe("PDelta");

// (b) AMPLIFICACION: la deriva de 2.º orden supera a la de 1.º orden, modesta.
const ampDx = dxMaxCabezas(rPD) / dxMaxCabezas(rLin);
expect(ampDx).toBeGreaterThan(1.001);   // hay 2.º orden real (medido 1.005)
expect(ampDx).toBeLessThan(1.10);       // robusto -> modesto (holgura sobre 1.005)

// (c) EQUILIBRIO en P-Δ:
//     ΣV = carga vertical total (pp losa + pp pilares + q·área), tolerancia 1e-6.
expect(Math.abs(sumaV_PD - gTotal) / gTotal).toBeLessThan(1e-6);
//     ΣH = -FX_total (carga lateral equilibrada), tolerancia 1e-4 relativa.
expect(Math.abs(sumaFX_PD + fxTotal) / fxTotal).toBeLessThan(1e-4);
//     axiles: cada pilar sigue con axil>0 y la SUMA de axiles ≈ ΣV.
```

**Sub-caso ESBELTO (amplificación claramente visible, evita falso verde)** — mismo
paño sobre 4 pilares 0.20×0.20, H=5, q=30 kN/m²:

```ts
// La amplificacion se hace grande y separable del ruido: exige un salto claro.
const ampDxEsbelto = dxMaxCabezas(rPD) / dxMaxCabezas(rLin);
expect(ampDxEsbelto).toBeGreaterThan(1.15);   // medido 1.25; blinda que P-Δ actua
```

**Tolerancias justificadas por el spike:**

- **ΣV**: usar `1e-6` relativo. El residuo del P-Δ medido va de 1.5e-9 (robusto) a
  9.1e-8 (muy esbelto); `1e-6` deja holgura de un orden y absorbe el cambio de build
  numpy/scipy local↔Pyodide. (El linear cuadra a 1e-15; no mezclar tolerancias.)
- **ΣH**: `1e-4` relativo. El robusto cuadra a máquina; el muy esbelto se desvía
  ~2e-3 sobre 20 kN (≈1e-4 relativo) por el residuo iterativo. Con el pórtico
  robusto del corazón, `1e-6` también pasa; se recomienda `1e-4` para robustez ante
  la geometría esbelta y el cambio de build.
- **amp mínima (robusto)**: `> 1.001`. Medido 1.005; `1.001` es la cota inferior
  segura que distingue "P-Δ actúa" de "ruido numérico" sin ser frágil al build.
- **amp máxima (robusto)**: `< 1.10`. Ancla que el pórtico robusto no dispara un 2.º
  orden desbocado (delataría un bug: p.ej. rigidez geométrica de placa mal aplicada,
  que PyNite 2.0.2 NO hace). Medido 1.005 → holgura ×20.
- **amp mínima (esbelto)**: `> 1.15`. Medido 1.25; blinda contra un P-Δ que
  silenciosamente no amplificara (falso verde) al esbeltar.

**No aseverar** el valor absoluto de la flecha DY ni del momento local sobre el
pilar bajo P-Δ: la flecha es fiable pero su cifra exacta depende de la malla, y el
momento local es dependiente de malla (deuda T-f3-losa-plana-momento-local, ya
documentada). El golden debe apoyarse en **ratios** (amplificación) e **invariantes
de equilibrio** (ΣV, ΣH, suma de axiles), no en cifras absolutas de campo.

---

## Cosas que la Fase 3 debe saber

1. **El motor SÍ corre P-Δ con quads**; el bloqueo actual del glue
   (`MotorAnalisisConPanos`, `pynite_glue.py:276`) es por la **masa** de la placa
   (compartido con el camino modal), no una limitación del solver estático. La
   feature T-f3-masa-placa decide si desbloquea el P-Δ con placas; si lo hace, el
   golden de arriba es el respaldo.
2. **P-Δ con placas amplifica SOLO por el axil de las barras** (hallazgo rector). No
   esperes que la losa contribuya rigidez geométrica: PyNite 2.0.2 no la ensambla
   para quads. Documéntalo en la UI/honestidad (el P-Δ de una losa sin pilares
   comprimidos sería idéntico al lineal).
3. **Camino P-Δ actual del glue** (`run_analysis`): `analyze_PDelta(sparse=True)`,
   `check_stability` en su default True, `check_statics` forzado a false. El spike
   no necesita tocar nada de eso; solo el bloqueo por quads.
4. **Presión de quad POSITIVA = hacia abajo** (gravedad), OPUESTA a la FY de barras
   (signo canónico, `pynite_glue.py:174-183`). El spike lo respeta: presión =
   ρ·t + q_sup, positiva.
5. **Apoya el golden en ratios e invariantes**, no en cifras de campo absolutas
   (malla-dependientes). La amplificación (adimensional) y el equilibrio (ΣV/ΣH) son
   los observables robustos.
