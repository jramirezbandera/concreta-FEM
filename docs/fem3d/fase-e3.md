# Fase E3 — láminas: resultado

> **Fecha:** 2026-10-04. **Plan:** S7 de `investigacion-id.md` (fase E3: «DKMQ24 con multiplicadores, cargas, resultantes y giro a ejes de usuario»), con D3 (multiplicadores por dirección) y H01, H02, H10 y H18.
> **Veredicto: pasan los seis criterios.**
> - La lámina con multiplicadores tiene exactamente 6 modos rígidos y pasa el patch test de MacNeal–Harder a ≤ 1,1e-13 con sección ortótropa y ejes girados.
> - Coincide con PyNite a ≤ 1,5e-12, con las resultantes ya en ejes de usuario.
> - Converge con orden 2 a la placa de Mindlin ortótropa de Navier.
> - Da 0,995 en Scordelis-Lo y en el hemisferio.
> - Las cargas de lámina cierran el equilibrio de cada cálculo con su resultante real.
> - El edificio objetivo con un reticular y 144 000 cargas de lámina se calcula en 3,1 s (diafragma rígido) o 4,7 s (sin él).
>
> Se puede pasar a E5 (Q y bandas) y a lo que queda de E4. Queda abierta la semántica de los multiplicadores frente a SAP2000 (S5 #21), que necesita un modelo del usuario.
>
> **Cómo leerlo:** la tabla resume los criterios, que se fijaron al empezar la fase. Cada sección da el detalle y la evidencia. Los hallazgos que cambian algo del plan están en «Hallazgos de E3».

| # | Criterio | Resultado | Evidencia |
|---|---|---|---|
| 1 | Elemento: sin multiplicadores, el de E0; con ellos, simétrico, 6 modos rígidos exactos y patch tests de MacNeal–Harder exactos con ejes de usuario girados; la rigidez global no depende de los ejes elegidos | **Pasa.** Frente al código de E0: 1,5e-15. Patch test (membrana y flexión a la vez, reticular, eje 1 a 30° y −110°): u ≤ 4,3e-15, N ≤ 7,5e-16, M ≤ 4,2e-15, Q ≤ 1,1e-13. Girar el eje 1 90° = intercambiar los multiplicadores: 8,3e-16 | `src/elementos/lamina.test.ts`, `src/motor/laminas.test.ts`, `validacion/e3/out_resumen.txt` |
| 2 | Oráculos y soluciones cerradas: PyNite ≤ 1e-10 en u, reacciones y resultantes en ejes de usuario; Navier ortótropa con orden 2; benchmarks de lámina de H48 | **Pasa.** PyNite ≤ 1,5e-12 en las cuatro placas, en el centroide y en los puntos de Gauss. Navier ortótropa (m11 ≠ m22, v13 ≠ v23): orden 1,9–2,0; con h = 0,125 m, w −0,011 % y Mx 0,11 %. Scordelis-Lo 0,995, hemisferio 0,995, cilindro pellizcado 1,018 | `src/motor/oraculos-e3.test.ts`, `navier.test.ts`, `benchmarks-laminas.test.ts`; `out_navier.txt`, `out_benchmarks.txt` |
| 3 | Cargas de lámina (superficie uniforme o por nudo, línea y puntual en cualquier punto; ejes locales o globales), con el equilibrio de cada cálculo sobre su resultante real | **Pasa.** Empuje hidrostático: resultante y momento exactos a ≤ 1e-12. Línea sobre un lado = reparto trapecial exacto. Equilibrio con los tres tipos ≤ 5,5e-16. Unas equivalentes un 0,1 % erróneas dan un cálculo no válido | `src/motor/laminas.test.ts`, `src/motor/equilibrio-laminas.test.ts` |
| 4 | Resultantes en ejes de usuario con el convenio de H02, y pruebas metamórficas ≤ 1e-9 | **Pasa.** Ménsula: Mx = −F(L − x) y Qx = −F a 1e-9. Placa girada 30° de H01: los momentos de referencia a la última cifra publicada. Giro ≤ 2,2e-12, renumeración ≤ 1,5e-12, inversión del orden de nudos ≤ 7,7e-13, superposición ≤ 2,0e-13 | `src/motor/laminas.test.ts`, `src/motor/propiedades-e3.test.ts` |
| 5 | Diagnósticos de multiplicadores, ejes y cargas fuera de la lámina; ningún falso positivo | **Pasa.** 14 modelos mal definidos, cada uno con su código. Los 7 modelos de validación y los edificios no dan ningún diagnóstico | `src/motor/laminas.test.ts` |
| 6 | Edificio objetivo con láminas de E3 y 24 casos: total ≤ 6 s; rigidez de la lámina más rápida (E1-6) | **Pasa.** 3,08 s (diafragma rígido) y 4,71 s (semirrígido). La rigidez de la lámina baja de 33 µs a 4,9 µs y el ensamblado, de 1,26 s a 0,48 s | `validacion/e3/banco.ts` → `out_banco.txt` |

Además, como pide la regla de oro 1, hay una referencia congelada de dos edificios con láminas de E3 y de la lámina plegada (`src/motor/congelado-e3.test.ts`), con las resultantes de todas las láminas.

---

## 1. Qué hay nuevo

| Fichero | Qué hace |
|---|---|
| `src/elementos/dkmq.ts` | DKMQ con sección general (Hb 3×3, Hs 2×2) y φₖ anisótropa por lado; operador de esfuerzos en los puntos de Gauss. Búferes reutilizados. Sigue siendo el port de PyNite en el caso isótropo |
| `src/elementos/membrana.ts` | Membrana ITW con drilling sobre una C general; γt = (γ/G)·C₃₃ |
| `src/elementos/lamina.ts` | Ejes de usuario, sección con multiplicadores (D' = S·D·S), rigidez en globales y operador de resultantes |
| `src/motor/laminas.ts` | La lámina en el motor: preparación con diagnósticos, cargas de lámina por caso (equivalentes y resultante real), resultantes en el centroide y `ResultantesLaminas` |
| `src/pruebas/placa.ts`, `navier.ts` | Mallas rectangulares para los tests y la solución de Navier de Mindlin ortótropa |

**Modelo analítico** (`modelo.ts`):
- `LaminaAnalitica` gana `eje1` (dirección de referencia del eje 1, que se proyecta sobre el plano) y `multiplicadores` (f11, f22, f12, m11, m22, m12, v13, v23).
- `CasoCarga.laminas`: cargas de superficie (uniformes o con un valor por nudo), de línea (un tramo dentro de una lámina) y puntuales (fuerza y momento en cualquier punto de la lámina), en ejes de la lámina o globales.
- `ResultadoCaso.esfuerzosLaminas`: 8 valores por lámina en su centroide, [Nx, Ny, Nxy, Mx, My, Mxy, Qx, Qy], en los ejes de la lámina.

**Uso de las resultantes:**

```ts
const r = calcular(modelo);                        // r.casos[k].esfuerzosLaminas: centroides
const rl = new ResultantesLaminas(modelo);         // prepara las láminas una vez
rl.enGauss(l, u);                                  // 4 puntos × 8, en el orden de PUNTOS_GAUSS
rl.en(l, u, xi, eta);                              // extrapolación bilineal (como PyNite); sólo para dibujar fuera de los puntos de Gauss
rl.enNudos(l, u);                                  // 4 nudos × 8 (discontinuas entre elementos, H01)
rl.lamina(l).R;                                    // ejes de la lámina (filas e1, e2, e3)
```

`u` puede ser el de un caso o cualquier combinación lineal de casos. Las resultantes de un elemento de desplazamientos no dependen de las cargas (no hay término como las FER de las barras), así que las de una combinación son las de su u combinado, exactamente.

**Ejes y convenio de signos** (cabecera de `modelo.ts`, H02):
- **Eje 3:** la normal por el orden de los nudos, (X₃ − X₁) × (X₄ − X₂).
- **Eje 1:** `eje1` proyectado o, sin él, la regla de CSI: eje 1 horizontal y eje 2 hacia +Z; en una lámina horizontal (seno del ángulo con Z < 1e-3), eje 2 = +Y. Una losa con la normal hacia +Z tiene 1 = X y 2 = Y.
- **Resultantes:** Nx, Ny, Nxy, Mx, My, Mxy, Qx, Qy = F11, F22, F12, M11, M22, M12, V13, V23 de CSI. Mx > 0 tracciona la cara −z: momento de vano positivo en una losa con la normal hacia arriba, como My en las barras. Qx = −(∂Mx/∂x + ∂Mxy/∂y): negativo junto al apoyo de x menor, como Vz en una biapoyada.
- **Invertir el orden de los nudos** invierte el eje 3 y otro (el 1 con la regla de CSI, el 2 con `eje1`). Nxy, Mx y My cambian de signo; Mxy no; de los cortantes cambia el del eje que se mantiene. Comprobado con las dos reglas.

**Decisiones de diseño que conviene revisar:**
- **La lámina se formula directamente en los ejes de usuario.** La sección (con sus multiplicadores) y las resultantes van en los mismos ejes, y no hay que girar tensores. La rigidez global no depende de los ejes elegidos (≤ 1e-12 frente a los ejes de PyNite).
- **Regla de CSI por defecto y no «X proyectada»** (S7 §2.1). Para una losa horizontal con la normal hacia +Z son lo mismo; la regla de CSI resuelve además los muros (1 horizontal, 2 hacia arriba), donde la X proyectada no existe. En rampas el eje 1 salta 90° (E3-2): el compilador pasará `eje1` en las losas.
- **Multiplicadores como D' = S·D·S** con S = diag(√f11, √f22, √f12), igual para m y v:
  - cada multiplicador escala la rigidez de su componente;
  - el término de Poisson queda escalado por √(f11·f22);
  - se conservan la simetría y la definición positiva;
  - el γt del drilling sigue a la rigidez a cortante de la membrana ya multiplicada.

  **Falta confirmar que es la semántica de SAP2000** (S5 #21, en «Pendiente»).
- **Sin multiplicador de peso.** El peso propio de una losa lo genera el compilador como carga de superficie desde el `pp` de la zona (H24), y el motor no tiene masa hasta E7.
- **Cargas con las funciones bilineales y sin momentos nodales**, como la presión de PyNite (bit a bit con ella):
  - son estáticamente equivalentes a la carga, así que ΣF y ΣM cierran exactos;
  - una carga puntual o de línea puede caer en cualquier punto de la lámina, también en un lado compartido;
  - una carga de línea tiene que quedar dentro de una lámina: el compilador recorta las que crucen varias.
- **Equilibrio con la resultante real.** Se calcula por un camino independiente: integrales cerradas de la ley bilineal sobre el cuadrilátero (∫Nₐ dA y ∫NₐN_b dA con el jacobiano lineal), del tramo o del punto. No se suman las fuerzas equivalentes.
- **Resultantes en el centroide en cada caso:** la media de los 4 puntos de Gauss, como PyNite (H01, H10). El operador de cada lámina se calcula una sola vez para todos los casos. Qx y Qy van incluidos, pero sólo sirven para ver (H18, E3-4).

## 2. Criterio 1: el elemento

**Generalización de la DKMQ.** La flexión admite una sección general (Hb 3×3, Hs 2×2). La φₖ de cada lado es la anisótropa (Katili et al. 2018): el cociente entre la rigidez a flexión y a cortante de la «viga de Timoshenko» del lado,

  φₖ = 12·D_bk / (D_sk·Lₖ²),  D_bk = vₖᵀ·Hb·vₖ con vₖ = [Cₖ², Sₖ², 2·Cₖ·Sₖ],  D_sk = [Cₖ, Sₖ]·Hs·[Cₖ, Sₖ]ᵀ.

En el caso isótropo, D_bk = D y D_sk = κGt, y es la φₖ de Katili (1993) y de PyNite.

**Resultados** (`src/elementos/lamina.test.ts`; valores en `out_resumen.txt`):

| Prueba | Peor valor |
|---|---|
| Sin multiplicadores frente al código de E0 (sacado de git, 45646fc): K global en 5 formas × 4 espesores × 2 γ | 1,5e-15 |
| Fixtures de E0 y E1–E2 que siguen pasando sin tocarlos: DKMQ frente a PyNite (k a 7e-16), lámina congelada (muro, MacNeal–Harder, viga en muro) y edificios congelados de E1 y E2 | ≤ 1e-9, como antes |
| Reticular en el espacio: 6.º autovalor / máximo (modos rígidos) | 1,4e-16 |
| Reticular en el espacio: 7.º autovalor / máximo (sin modos espurios) | ≥ 6,7e-5 |
| Girar el eje 1 90° = intercambiar f11↔f22, m11↔m22, v13↔v23 (en 5 formas, también la distorsionada). Prueba la φₖ anisótropa: los cosenos de cada lado respecto a los ejes del material cambian | 8,3e-16 |
| Rigidez global con ejes de CSI = con `eje1` cualquiera = con ejes de PyNite (isótropa) | ≤ 1e-12 |

**Patch test de MacNeal–Harder en el motor**, con membrana y flexión a la vez (`validacion/e3/parche.ts`):
- **Campos impuestos:** u = k(2x + 2y), v = 3ky, ψ = ω = −k, w = k(x² + xy + y²)/2.
- **Resultantes exactas:** N = C·ε y M = −Hb·κ en los ejes de usuario, Q = 0.

| Variante | u (interiores) | N | M | Q (frente a M/L) |
|---|---|---|---|---|
| Isótropa, ejes de CSI | 3,5e-15 | 5,9e-16 | 4,2e-15 | 5,9e-14 |
| Reticular, ejes de CSI | 3,5e-15 | 4,3e-16 | 2,6e-15 | 5,8e-14 |
| Reticular, eje 1 a 30° | 2,6e-15 | 7,5e-16 | 2,7e-15 | 4,3e-14 |
| Reticular, eje 1 a −110° | 4,3e-15 | 5,9e-16 | 1,4e-15 | 1,1e-13 |

Cierra la pregunta S5 #11 (signos de Mxy y de Q con ejes no alineados).

## 3. Criterio 2: oráculos, soluciones cerradas y benchmarks

### PyNite 3.2.0

PyNite tiene la misma flexión DKMQ isótropa y reparte la presión igual, así que es un oráculo bit a bit de la flexión de placas planas en cualquier orientación. Sólo admite presión normal uniforme, y su membrana es otra (H05). Por eso los modelos sólo llevan cargas normales al plano y momentos en él (`validacion/e3/modelos-oraculo.ts`).

El oráculo (`oraculo_pynite.py`) gira por su cuenta los momentos de PyNite (en sus ejes, x = i→j) a los ejes de usuario, con una implementación propia en Python de la regla de ejes, y les cambia el signo (H02).

| Modelo | u | Reacciones | M (centroide / Gauss) | Q (centroide / Gauss) |
|---|---|---|---|---|
| Losa horizontal de 8×6 distorsionada, un borde empotrado | 6,8e-15 | 1,4e-14 | 1,4e-14 / 1,2e-14 | 2,5e-14 / 3,1e-14 |
| Losa inclinada en el espacio, con `eje1` | 6,5e-13 | 1,0e-12 | 5,0e-13 / 5,5e-13 | 6,4e-13 / 7,5e-13 |
| Muro vertical con la normal a 30° de X (ejes de CSI) | 1,5e-12 | 7,1e-13 | 5,8e-13 / 5,7e-13 | 6,2e-13 / 6,0e-13 |
| Losa con la normal hacia −Z (eje 1 = −X) | 2,9e-14 | 2,5e-14 | 3,5e-14 / 4,1e-14 | 4,4e-14 / 4,7e-14 |

Son los peores valores entre faer y el solver de perfil.

### Navier: placa de Mindlin ortótropa

Referencia: Reddy, §6.2. Las ecuaciones se han deducido de nuevo y van en la cabecera de `src/pruebas/navier.ts`.
- **Modelo:** placa de 6 × 4 m simplemente apoyada (con el giro tangente coartado) y carga uniforme (`validacion/e3/navier.ts` → `out_navier.txt`).
- **Variantes:** isótropa delgada (a/t = 100), isótropa gruesa (a/t = 15) y ortótropa con m11 = 1, m22 = 0,3, m12 = 0,2, v13 = 0,5 y v23 = 0,15 (a/t = 20).

| Ortótropa (reticular) | w centro | Mx centro | My centro | Mxy esquina | Qx borde |
|---|---|---|---|---|---|
| h = 0,5 m | −0,152 % | 1,804 % | 1,134 % | −1,575 % | −9,49 % |
| h = 0,25 m | −0,043 % | 0,451 % | 0,280 % | −0,510 % | −2,90 % |
| h = 0,125 m | **−0,011 %** | **0,113 %** | **0,070 %** | −0,172 % | −0,75 % |
| Orden observado | 1,93 | 2,00 | 2,00 | 1,57 | 1,95 |

La isótropa gruesa se comporta igual (w −0,041 %, Mx 0,125 %, Qx −1,5 % con h = 0,125).

La delgada converge en w y en M (orden 1,7–1,9), pero **su Qx en el borde sigue un 28 % bajo con h = 0,125 m** (E3-4, H18).

### Benchmarks de H48

En estos benchmarks trabajan juntas la membrana con drilling y la flexión, en láminas curvas facetadas (`validacion/e3/benchmarks.ts` → `out_benchmarks.txt`). Las mallas son de cuadriláteros planos: cuerdas de un cilindro, o trapecios isósceles entre paralelos y meridianos.

| Malla | Scordelis-Lo (0,3024) | Cilindro pellizcado (1,8248e-5) | Hemisferio (0,0940) |
|---|---|---|---|
| 8×8 | 1,005 | 0,948 | 0,926 |
| 16×16 | 0,997 | 1,020 | 0,992 |
| 32×32 | **0,995** | **1,018** | **0,995** |

**Lecturas:**
- **Scordelis-Lo y cilindro:** coinciden con lo que H48 midió para `Quad3D` (0,995 y 1,018, «banda de ±2 %»).
- **Hemisferio:** es la prueba más dura para el drilling (H05), y ahí la lámina da 0,995.
- **Viga recta de MacNeal–Harder fuera del plano (0,4321):** 0,987, 0,987 y 0,986 en las mallas rectangular, trapezoidal y de paralelogramos. En el plano siguen los valores de E0 (0,90 / 0,78 / 0,79).

## 4. Criterio 3: cargas de lámina

| Prueba | Resultado |
|---|---|
| Puntual sobre un nudo = carga nodal; superficie con el mismo valor en los 4 nudos = uniforme; presión local = global con la normal +Z | ≤ 1e-13 |
| Línea trapecial a lo largo de un lado = L(2qa + qb)/6 y L(qa + 2qb)/6 en sus nudos | ≤ 1e-13 |
| Empuje hidrostático por nudos sobre un muro: ΣRy = −γH²B/2 y ΣMx = γH³B/6 | ≤ 1e-12 |
| Puntual con momento, línea oblicua y superficie por nudos dentro de elementos distorsionados de una lámina inclinada, en ejes locales | Equilibrio ≤ 1e-12 |
| Lámina plegada (los tres tipos, ejes locales y globales, con barras) | Equilibrio ≤ 5,5e-16 |
| Mutación: funciones de forma de las equivalentes un 0,1 % mayores, para los tres tipos | Cálculo no válido (`equilibrio/no-cumple`) |

**Regla de oro 2.** La fase 8 de `calcular()` suma la resultante real de las cargas de lámina a la de las de barra. Como en E2-6, un error de reparto que conserve la resultante no lo ve ningún equilibrio global; lo cubren los oráculos y las pruebas de esta tabla.

## 5. Criterio 4: resultantes, signos y pruebas metamórficas

**Signos** (`src/motor/laminas.test.ts`):
- **Ménsula de 4 × 1 con ν = 0** y carga de línea en la punta: Mx = −F(L − x) (tracción arriba) y Qx = −F en todos los centroides, a ≤ 1e-9.
- **Biapoyada con gravedad:**
  - Mx de vano positivo y Qx negativo junto al apoyo de x = 0;
  - los dos, exactos para la carga repartida a los nudos (E3-3).
- **H01, placa de 4 × 4 apoyada y girada 30° en su plano.** Con el eje 1 según X, el elemento (2, 5) da Mx = 5,76524, My = 2,39419 y Mxy = −0,65576 kN·m/m: los momentos globales de referencia de la investigación (−5 765,24, −2 394,19 y 655,76 N·m/m en el signo de PyNite), a la última cifra publicada.
- **Invertir el orden de los nudos,** con la regla de CSI y con `eje1`: cada resultante cambia (o no) de signo como dice la cabecera, a ≤ 1e-10.

**Pruebas metamórficas** (`validacion/e3/metamorficas.ts`, `out_resumen.txt`). Modelos:
- una lámina plegada: losa reticular con eje 1 a 30°, muro con empuje por nudos, faldón con `eje1` y viga de borde descolgada;
- dos edificios con `laminasE3`;
- los cuatro modelos del oráculo PyNite.

| Prueba | Peor valor |
|---|---|
| Giro y traslación del modelo, con el eje 1 de cada lámina fijado (la regla de CSI depende de Z): u y reacciones giran; las resultantes y los esfuerzos de barra no cambian | 2,2e-12 |
| Renumeración de nudos, barras y láminas, y cambio del nudo inicial de cada lámina | 1,5e-12 |
| Inversión del orden de los nudos de todas las láminas (u y reacciones iguales; resultantes con los signos de la cabecera) | 7,7e-13 |
| Superposición con cargas de lámina de los tres tipos | 2,0e-13 |
| Peor equilibrio en todos los cálculos del resumen | 1,1e-13 |

## 6. Criterio 5: diagnósticos

| Código | Qué detecta en las láminas |
|---|---|
| `modelo/propiedad-no-valida` | Un multiplicador nulo, negativo o no finito; γ/G ≤ 0 o estabilización negativa (además del material, como en E1) |
| `modelo/orientacion-no-valida` | `eje1` no finito o casi normal al plano: menos de 1e-3 de su longitud en el plano |
| `modelo/elemento-degenerado`, `modelo/lamina-alabeada` | Como en E1, ahora con la normal por las diagonales |
| `carga/no-valida` | Lámina inexistente, ejes desconocidos, valores no finitos, superficie con un número de nudos distinto de 4, línea de longitud nula o tipo desconocido |
| `carga/fuera-de-lamina` | Punto o extremo de línea fuera del plano o del contorno de la lámina, con la tolerancia geométrica del modelo |

Cada uno de los 14 modelos mal definidos de la prueba da exactamente su código. No hay falsos positivos:
- los 7 modelos de las metamórficas, los edificios y los del oráculo no dan ningún diagnóstico;
- una carga en el lado común de dos láminas es válida en cualquiera de las dos.

## 7. Rendimiento: el edificio objetivo con láminas de E3

**Modelo** (`validacion/e3/banco.ts`; `out_banco.txt`): el edificio de los bancos de E1 y E2 (29 221 nudos, D9), con barras de E2 y `laminasE3`:
- 28 280 láminas, con los vanos alternos de reticular (multiplicadores y eje 1 girado) y ábacos macizos;
- 143 990 cargas de lámina en los 24 casos: gravitatoria de superficie, tabiquería de línea, puntuales, viento sobre el muro y sobrecarga por nudos.

Node 24, Ryzen 9 5900X.

| Fase (ms) | E3, diafragma rígido | E3, semirrígido | E2, diafragma rígido (informe de E2) |
|---|---|---|---|
| Comprobación y numeración | 421 | 306 | 397 |
| Cargas | 533 | 414 | 154 |
| Ensamblado | **479** | **462** | 1 257 |
| Solución | 871 | 2 692 | 907 |
| Recuperación (con las resultantes de las láminas) | 693 | 634 | 350 |
| **Total** | **3,08 s** | **4,71 s** | 3,15 s |
| Peor equilibrio / error hacia atrás | 2,1e-11 / 5,0e-15 | 2,9e-12 / 2,5e-13 | 3,2e-11 / 4,5e-15 |
| RSS / memoria WASM | 750 / 128 MB | 1 183 / 355 MB | 709 / 128 MB |

**Microbanco** (`validacion/e3/microbanco.ts`), por unidad:

| Qué | Coste |
|---|---|
| Rigidez de una lámina en globales | 4,9 µs (33 µs en E1) |
| Operador de resultantes del centroide | 3,0 µs |
| Fuerzas equivalentes y resultante de una carga de lámina | 2,7 µs |

**Lecturas:**
- **La palanca de E1-6 da ×6,7 en la lámina y ×2,6 en el ensamblado.** Ahora el ensamblado lo dominan la dispersión y la búsqueda en el patrón.
- **Las cargas de lámina cuestan unos 0,4 s.** Son 144 000 en 24 casos, a 2,7 µs cada una.
- **Las resultantes cuestan ~0,3 s** con 28 280 láminas y 24 casos: el operador se calcula una vez por lámina.
- **El modelo de E2 con el motor de E3** baja de 3,15 s a 2,70 s, aunque ahora también calcula las resultantes de sus láminas.

## Hallazgos de E3

| ID | Hallazgo | Consecuencia |
|---|---|---|
| E3-1 | **La φₖ anisótropa es coherente con los ejes del material.** Con multiplicadores distintos por dirección, girar el eje 1 90° e intercambiarlos da la misma rigidez a 8e-16, también en elementos distorsionados; con los mismos multiplicadores, la rigidez cambia un 0,1 % o más. La flexión ortótropa converge a Navier con orden 2 | La generalización de la DKMQ queda validada sin oráculo comercial. Lo que falta es la semántica de los multiplicadores frente a SAP2000 (S5 #21), no la formulación |
| E3-2 | **La regla de CSI hace saltar el eje 1 90° en las rampas.** Con seno ≥ 1e-3 el eje 1 pasa de X (losa horizontal) a la horizontal del plano inclinado (−Y en una rampa según X), igual que en SAP2000 | El compilador pasa `eje1` en todas las losas (la X global o la dirección de los nervios, como pedía S7 §2.1). Así los ejes de una planta con rampas son continuos. La regla de CSI queda para los muros |
| E3-3 | **La carga bilineal (la de PyNite) convierte una franja en una viga con cargas nudales.** El Mx del centroide es exactamente la media de los momentos de los dos nudos (−qh²/8 respecto al valor en el centroide, orden 2) y el Qx es exacto | No es un error del elemento. Explica parte del error de orden 2 de los momentos de H10. Si hiciera falta, una carga consistente con la DKMQ (con momentos nodales) lo reduciría; no es necesario para el MVP |
| E3-4 | **El Q de la DKMQ depende de h/t:** −0,75 % con h = 0,125 en la placa ortótropa de a/t = 20, pero −28 % en la delgada de a/t = 100 con la misma malla | Confirma H18 en el motor propio. Qx y Qy van en el resultado sólo para ver; el cortante para comprobar sale de las fuerzas nodales en una línea (E5) |
| E3-5 | **Con drilling real, las láminas curvas facetadas funcionan.** Hemisferio 0,995 con 32×32; Scordelis-Lo y el cilindro, como `Quad3D` | Cierra lo que S7 dejaba en riesgo para la membrana. Muros y núcleos (ETABS 15, S5 #1) quedan para E6 |
| E3-6 | **Las resultantes no dependen de las cargas** (elemento de desplazamientos), al contrario que los diagramas de barra | `ResultantesLaminas` acepta el u de una combinación. El Wood–Armer por combinación (H34) no necesita guardar resultantes por caso: basta con el u combinado |

## Pendiente

- **Semántica de los multiplicadores frente a SAP2000** (S5 #21, D3). Propuesta para cerrarla con un único modelo del usuario:
  1. modelar en SAP2000 la placa ortótropa de Navier de `validacion/e3/navier.ts`: 6 × 4 m, t = 0,30, E = 3e7, ν = 0,2, apoyo simple con el giro tangente coartado, q = 10 kN/m²;
  2. con los multiplicadores m11 = 1, m22 = 0,3, m12 = 0,2, v13 = 0,5 y v23 = 0,15, y malla de 0,125 m;
  3. comparar w en el centro (Navier: −8,2838e-4 m) y M11 y M22 en el centro.

  Si SAP2000 escala el término de Poisson de otra forma (por ejemplo, sin tocarlo), aparece una diferencia del orden del ν·(1 − √0,3) en los momentos. Después, el reticular con ábacos de S5 #21.
- **Para el compilador** (fase 2 de S1):
  - `eje1` en todas las losas (E3-2);
  - orden de nudos con la normal hacia +Z en losas y fijada en muros (H02, H23);
  - cargas de línea recortadas a cada lámina;
  - empujes por nudos;
  - cargas proyectadas (× coseno);
  - peso propio desde `pp` (H24).
- **E5:** el corte por fuerzas nodales en una línea y SPR para los mapas (H18, E3-4). Además, las bandas de dimensionado (D5).
- **Membrana ortótropa:** la validan el patch test (exacto) y las metamórficas; falta una solución cerrada de una ménsula con f11 ≠ f22 o un oráculo (Kratos u OpenSees con material ortótropo).
- **Aviso de elementos muy distorsionados** (H23): hoy se rechazan los no convexos y los alabeados, pero no hay aviso de calidad (relación de jacobianos, ángulos). Sin datos del mallador real no se ha fijado un umbral.
- **Lo que no tiene E3 y no pide el MVP:**
  - triángulos;
  - corrección de alabeo (DKMQ24+);
  - temperatura;
  - masa (E7);
  - carga consistente con momentos nodales (E3-3).
- **Rendimiento:**
  - la dispersión del ensamblado: posiciones del patrón precalculadas por elemento;
  - un vector de 6·nn por caso para las cargas de lámina.

  Ninguna hace falta para el objetivo.
- **Pendiente de E0–E2:** ver el CI en verde en GitHub y medir en móvil (con E3, el semirrígido sigue en 355 MB de WASM).

## Cómo reproducir

```sh
bun run test:run                                            # todos los tests (E0–E3 y Fase 1)
bun validacion/e3/modelos-oraculo.ts                        # exporta los modelos del oráculo
.venv/Scripts/python.exe validacion/e3/oraculo_pynite.py    # → src/motor/__fixtures__/pynite-e3.json
bun validacion/e3/navier.ts                                 # convergencia frente a Navier → out_navier.txt
bun validacion/e3/benchmarks.ts                             # Scordelis-Lo, cilindro, hemisferio, MacNeal–Harder → out_benchmarks.txt
bun validacion/e3/resumen.ts                                # errores medidos → out_resumen.txt
node validacion/e3/banco.ts ambos                           # edificio objetivo con láminas de E3 → out_banco.txt
node validacion/e3/microbanco.ts                            # coste por lámina y por carga
bun validacion/e3/congelar.ts                               # SÓLO a sabiendas: regenera la referencia congelada de E3
```
