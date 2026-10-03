# Fase E1 — núcleo del motor: resultado

> **Fecha:** 2026-10-03. **Plan:** S7 de `investigacion-id.md` (fase E1: «GDL, restricciones con cadenas, apoyos, muelles, CSC, solver de perfil, ΣF/ΣM y diagnósticos»).
> **Veredicto: pasan los cinco criterios.** El núcleo da los mismos desplazamientos y reacciones que OpenSeesPy a ≤ 2e-13, comprueba el equilibrio en cada cálculo y calcula el edificio objetivo con 24 casos en 2,8 s (diafragma rígido) o 4,5 s (sin él). Se puede pasar a E2 (barras).
>
> **Cómo leerlo:** la tabla resume los criterios, que se fijaron al empezar la fase porque S7 no los daba. Cada sección da el detalle y la evidencia. Los hallazgos que cambian algo del plan están en «Hallazgos de E1».

| # | Criterio | Resultado | Evidencia |
|---|---|---|---|
| 1 | Restricciones (diafragma, enlace rígido, cadenas), apoyos, muelles e impuestos a ≤ 1e-10 de un oráculo independiente | **Pasa.** ≤ 2,0e-13 frente a OpenSeesPy Lagrange en los 6 modelos y ≤ 1,4e-13 frente a Transformation (salvo cadenas, ver E1-1). H07 reproducido: 1,71662 / 0,38806 mm | `src/motor/oraculos.test.ts`, `validacion/e1/out_resumen.txt` |
| 2 | ΣF y ΣM ≤ 1e-9 en cada cálculo (error si no), resultados finitos y residuo ≤ 1e-10 | **Pasa.** Es una fase de `calcular()`, no un test. Edificio objetivo: equilibrio ≤ 4,2e-11 y error hacia atrás ≤ 1,1e-14 | `src/motor/calcular.ts`, `validacion/e1/out_banco.txt` |
| 3 | Cada modelo inestable o mal definido da su error con los objetos correctos; ningún falso positivo | **Pasa.** 7 mecanismos con los dos solvers, 15 modelos mal definidos, 2 avisos y 6 modelos válidos con rigideces dispares | `src/motor/diagnosticos.test.ts`, `validacion/e1/out_margen_pivotes.txt` |
| 4 | Propiedades y pruebas metamórficas (H38) ≤ 1e-9; faer frente al solver de perfil | **Pasa.** Giro ≤ 3,7e-12, renumeración ≤ 2,8e-12, superposición, Betti; 6 modos rígidos exactos; faer/perfil ≤ 1,5e-12 | `src/motor/propiedades.test.ts` |
| 5 | Edificio objetivo (D9, H52) con 24 casos: ensamblado ≤ 3 s y total ≤ 6 s en sobremesa | **Pasa.** 29 221 nudos: 2,73 s con diafragma (76 146 ecuaciones) y 4,50 s sin él (152 250), en Node 24 | `validacion/e1/banco.ts` → `out_banco.txt` |

Además, como pide la regla de oro 1, hay una referencia congelada de dos edificios (`src/motor/congelado.test.ts`).

---

## 1. Qué hay en `src/motor/`

El motor es puro: entra un `ModeloAnalitico` y sale, por caso, un `Float64Array` de desplazamientos y otro de reacciones (6 por nudo), con diagnósticos. No tiene React, DOM ni IO. Los convenios de unidades, ejes y signos están en la cabecera de `modelo.ts`.

| Fichero | Qué hace |
|---|---|
| `modelo.ts` | Tipos de entrada y salida, y la cabecera de convenios: kN–m, Z arriba, GDL [ux, uy, uz, rx, ry, rz] y reacciones como fuerza del apoyo sobre la estructura (incluyen los muelles a tierra, como en CSI) |
| `elementos.ts` | Lista uniforme de barras, láminas y muelles; comprobaciones geométricas; rigidez en ejes globales; qué GDL rigidiza cada uno |
| `gdl.ts` | Numeración con restricciones por transformación (u = T·û): relaciones del diafragma y del enlace rígido, cadenas en orden topológico (DFS iterativo), apoyos, GDL sin rigidez |
| `ensamblado.ts` | Patrón CSC (triángulo superior) calculado una sola vez y ensamblado de Tₑᵀ·kₑ·Tₑ; guarda kₑ' de los elementos que tocan apoyos para las reacciones y los impuestos |
| `solucion.ts` | faer o perfil, intercambiables; diagnóstico de mecanismos por pivote; modo del mecanismo; refinamiento iterativo |
| `equilibrio.ts` | Regla de oro 2 |
| `calcular.ts` | Las 8 fases y sus diagnósticos |

**Uso:**

```ts
await iniciarNucleo(bytesDelWasm);           // una vez por hilo (solver "nucleo")
const r = calcular(modelo, { solver: "nucleo" });
if (r.valido) r.casos[0].u;                  // si no, r.diagnosticos dice por qué
```

**Decisiones de diseño que conviene revisar:**
- **El resultado no válido no trae `casos`.** Trae `casosNoValidos` sólo si el fallo es de equilibrio, para depurar. Así ningún consumidor puede presentarlos por descuido (regla de oro 2).
- **Referencias por índice:** los objetos del modelo se referencian por índice; los `id` sólo sirven para los diagnósticos (H27).
- **Elementos provisionales:** las barras (Euler–Bernoulli) y las láminas (DKMQ + membrana) son las del spike E0. E2 y E3 las sustituyen sin tocar el núcleo, que sólo ve nudos, una matriz en globales y qué GDL rigidiza cada elemento (las liberaciones de E2 entran por ahí).
- **Muelles:** a tierra o entre dos nudos coincidentes. Un muelle entre nudos separados no conserva ΣM y se rechaza.
- **Apoyos:** sólo en ejes globales; los desplazamientos impuestos van por caso.
- **GDL sin rigidez:** se restringen solos. Hay aviso si el nudo tiene elementos (p. ej. un muelle de una sola componente) y ninguno en un maestro auxiliar de diafragma. Si un caso los carga, es un error.

## 2. Criterio 1: restricciones frente a OpenSeesPy

**Qué se hizo.**
- **Modelos:** `validacion/e1/modelos-oraculo.ts` define seis modelos, sólo con barras de Euler–Bernoulli (la `elasticBeamColumn` de OpenSees es la misma formulación), porque lo que se valida es el núcleo y no los elementos:
  1. el diafragma de H07;
  2. un diafragma de dos plantas con el maestro fuera del centro y cargas en esclavos, en el maestro y fuera del plano;
  3. enlaces rígidos con brazos en las tres direcciones y un esclavo con rigidez propia;
  4. cadenas: huella → cabeza de pilar → diafragma, y un enlace de enlace;
  5. muelles a tierra y de longitud nula en triedros girados;
  6. desplazamientos impuestos en traslación y giro, junto con cargas.
- **Exportación:** se exportan a JSON.
- **Resolución en OpenSees:** `validacion/e1/oraculo_opensees.py` los resuelve con OpenSeesPy 3.8 de dos formas, `constraints('Transformation')` y `constraints('Lagrange')`. La segunda es una formulación independiente (multiplicadores).

**Resultado** (`out_resumen.txt`, peor error relativo por grupos entre desplazamientos y reacciones):

| Modelo | Frente a Transformation | Frente a Lagrange | Equilibrio |
|---|---|---|---|
| Diafragma de H07 | 9,3e-16 | 6,2e-15 | 5,5e-17 |
| Diafragma de dos plantas | 8,6e-15 | 3,2e-14 | 1,6e-16 |
| Enlaces rígidos | 1,1e-15 | 7,9e-16 | 1,1e-16 |
| Cadenas | **5,5** (error de OpenSees, E1-1) | 4,6e-15 | 7,1e-17 |
| Muelles girados | 2,0e-14 | 2,9e-14 | 2,4e-15 |
| Impuestos | 1,4e-13 | 2,0e-13 | 2,0e-16 |

**Tercera referencia.** El diafragma de `exp_diafragma.py` (H07) da u_x = 1,71662 / 0,38806 mm en las esquinas, igual que el maestro-esclavo exacto que la investigación calculó con numpy sobre la K de PyNite. Coincide en las 5 cifras publicadas, con los pilares con el canto según X.

**Soluciones cerradas** (`analiticos.test.ts`, a ≤ 1e-12 con los dos solvers):
- la ménsula;
- muelles en serie en ejes girados;
- el diafragma sobre 4 pilares en ménsula, con traslación y torsión de planta: K_θθ = Σk·r² + ΣGJ/H;
- el enlace rígido con carga desplazada;
- la biempotrada con asiento;
- la ménsula con giro de base impuesto (sólido rígido, reacciones nulas).

## 3. Criterio 2: equilibrio en cada cálculo

La fase 8 de `calcular()` comprueba en cada caso:
- **Equilibrio:** |ΣF|/Σ|F| y |ΣM|/Σ|M| entre las cargas y las reacciones (apoyos y muelles a tierra), con los momentos respecto al centro del modelo. Si pasa de 1e-9, es un error y el cálculo no es válido.
- **Resultados finitos:** que todos los desplazamientos y reacciones lo sean.
- **Error hacia atrás** del solver (E1-2): si queda por encima de 1e-10 tras el refinamiento, hay aviso.

**Por qué no es tautológica.** Las reacciones salen de las mismas K, pero la suma de cargas y reacciones sólo es cero si se cumplen tres cosas a la vez:
- cada elemento está autoequilibrado (no hace trabajo en un movimiento de sólido rígido);
- T es rígida (los movimientos de sólido rígido son representables);
- el sistema está bien resuelto.

Un error de signo en una relación del diafragma, un elemento mal formulado o un diafragma no plano la rompen.

**Escalas** (E1-3):
- **Fuerzas:** la de cada reacción es la suma de los |términos| que se cancelan en ella, no la reacción neta. Con un giro de sólido rígido impuesto, las reacciones son de redondeo y dividir redondeo entre redondeo daba ≈ 1.
- **Momentos:** su escala incluye Σ|F|·L, para que no se divida por casi cero si todas las fuerzas pasan por el centro.

## 4. Criterio 3: diagnósticos

**Antes de resolver**, todos son errores salvo los avisos marcados:

| Código | Qué detecta |
|---|---|
| `modelo/valor-no-finito`, `nudo-no-valido`, `propiedad-no-valida`, `orientacion-no-valida` | Datos que no tienen sentido; muelles no simétricos o no semidefinidos positivos; ejes no ortonormales |
| `modelo/elemento-degenerado` | Barra de longitud nula; lámina degenerada, no convexa o con los nudos desordenados (en pajarita) |
| `modelo/lamina-alabeada` | Alabeo por encima de 1e-9 del lado (rompería el equilibrio; la corrección de alabeo es de DKMQ24+, fuera del MVP) |
| `modelo/muelle-no-nulo` | Muelle entre nudos separados |
| `restriccion/esclavo-doble`, `ciclo`, `apoyo-en-esclavo`, `diafragma-no-plano` | Las reglas de consistencia de §2.3 |
| `modelo/parte-sin-apoyo` | Una parte conexa (por elementos, muelles y restricciones) sin apoyo ni muelle a tierra; lista sus nudos |
| `carga/impuesto-sin-apoyo`, `carga/gdl-sin-rigidez` | Desplazamiento impuesto en un GDL libre; carga que no tendría por dónde ir |
| `modelo/nudo-aislado`, `modelo/nudos-coincidentes`, `gdl/sin-rigidez` (avisos) | Nudos sueltos (se ignoran); duplicados a menos de 1e-6 m sin muelle ni restricción (H19, H23); GDL restringidos automáticamente |

**Después de factorizar:**
- **`solver/mecanismo`:**
  - **Detección:** un pivote exactamente nulo (faer da error y se sujeta con un muelle) o dⱼ/Kⱼⱼ ≤ 1e-11 (más de 11 cifras perdidas, o pivote negativo).
  - **Modo:** con muelles αⱼ = Kⱼⱼ en los GDL sospechosos, (K' + Σαⱼ·eⱼ·eⱼᵀ)·x = eₖ da exactamente un vector del núcleo de K'.
  - **Mensaje:** dice qué nudos se mueven sin resistencia. Ejemplo: en la planta con diafragma sobre pilares biarticulados, salen el maestro y las cuatro cabezas.
- **`solver/mal-condicionado`** (aviso): más de 8 cifras perdidas.

**Margen del umbral** (`out_margen_pivotes.txt`, cifras perdidas del peor pivote):

| Modelo | Cifras |
|---|---|
| Edificio objetivo con diafragma / semirrígido | 1,7 / 2,5 |
| Losa de 2 cm con malla de 0,25 m | 2,8 |
| Barra 1e4 veces más rígida que sus vecinas | 6,2 |
| Barra 1e6 / 1e8 veces más rígida (penalización a mano) | 8,2 / 10,2 (equilibrio roto, E1-4) |
| Mecanismos: barra articulada, rótula a torsión diluida en el edificio de 152 000 ecuaciones, también girada 30° | Pivote exactamente nulo |
| Mecanismo: barra biarticulada sesgada en 3D | Pivote −8,5e-15 de la diagonal |

Entre los modelos válidos y el umbral hay más de 4 órdenes de margen, y los mecanismos reales quedan en el redondeo.

## 5. Criterio 4: propiedades y pruebas metamórficas

Sobre dos edificios del generador (`src/pruebas/edificio.ts`):
- **Modelo 1:** láminas, pilares, vigas de borde, muro, diafragma rígido y huella de enlaces rígidos encadenada al diafragma.
- **Modelo 2:** lo mismo sin diafragma y con muelles en la base.

| Prueba | Resultado |
|---|---|
| T reproduce los 6 movimientos de sólido rígido (también a través de las cadenas) | ≤ 1e-14; K'·û ≤ 1e-12 de la escala de cada fila |
| K' del modelo de cadenas sin apoyos | Exactamente 6 autovalores nulos |
| Giro + traslación (Z con diafragma; eje general sin él) | 1,5e-12 / 3,7e-12 |
| Renumeración de nudos, elementos, restricciones, esclavos y nudo inicial de las láminas | 1,9e-12 / 2,8e-12 |
| Superposición G + 1,5·Vx − 0,8·asiento | ≤ 1e-9 (test) |
| Maxwell–Betti entre todos los pares de casos | ≤ 1e-9 (test) |
| faer frente al solver de perfil | 1,3e-13 / 1,5e-12 (E1-7) |

## 6. Criterio 5: el edificio objetivo

**Modelo** (`validacion/e1/banco.ts`): 7 plantas de 10×8 pilares con luces de 6 m y malla de 0,75 m. Son 29 221 nudos y 30 632 elementos (H52 estimaba 27 500 nudos para la maciza), con huella, vigas de borde, muro y 24 casos. Ryzen 9 5900X; Node 24.19 (V8, como Chrome) y bun 1.3.14.

| Fase (ms, Node) | Diafragma rígido | Semirrígido |
|---|---|---|
| Ecuaciones / esclavos | 76 146 / 98 637 | 152 250 / 22 512 |
| nnz(K) / nnz(L) | 1,27 M / 8,5 M | 4,07 M / 29,7 M |
| Comprobación y numeración | 365 | 266 |
| Patrón CSC | 78 | 234 |
| Ensamblado | 1 243 | 1 113 |
| Factorización (simbólica + numérica) | 442 | 1 603 |
| Resolución de 24 casos | 185 | 429 |
| Residuo (2 productos por caso) | 175 | 571 |
| Recuperación y equilibrio | 168 | 196 |
| **Total** | **2,73 s** | **4,50 s** |
| Memoria WASM / RSS | 128 MB / 605 MB | 355 MB / 928 MB |
| Peor equilibrio / error hacia atrás | 4,2e-11 / 4,4e-15 | 5,1e-12 / 1,1e-14 |

**Lecturas:**
- **El diafragma rígido divide por dos las ecuaciones** y por 3,5 el relleno.
- **Lo más caro en TypeScript es la rigidez de los elementos:** 1,0 s de los 1,1–1,2 s del ensamblado, unos 33 µs por lámina (E1-6). La dispersión con Tₑ y la búsqueda en el patrón cuestan poco.
- **bun 1.3.14 da tiempos parecidos** (2,74 s / 4,81 s) con mucha más memoria JS: 1,3 GB de heap en el semirrígido frente a 81 MB en Node.

## Hallazgos de E1

| ID | Hallazgo | Consecuencia |
|---|---|---|
| E1-1 | **El `Transformation` de OpenSees 3.8 resuelve mal las cadenas sin avisar.** Cuando el maestro de una restricción es esclavo de otra (huella → cabeza → diafragma), los desplazamientos difieren hasta un 250 % de su propio `Lagrange`. El motor coincide con `Lagrange` a 4,6e-15 | Las cadenas se validan sólo contra `Lagrange`. No usar nunca el `Transformation` de OpenSees como oráculo de cadenas |
| E1-2 | **‖K·x − b‖/‖b‖ no mide el solver, sino el condicionamiento.** Con una barra 1e4 veces más rígida, daba 1,6e-10 y un aviso falso | El residuo es el error hacia atrás por componentes de Oettli–Prager. Se refina sólo con ω > 1e-13: el ruido de LDLᵀ está en 5e-16–2e-15, y refinar por debajo costaba otra resolución (≈ 1 s en el semirrígido) sin mejorar nada |
| E1-3 | **La escala del equilibrio necesita la magnitud de los términos que se cancelan.** Con un giro de sólido rígido impuesto, las reacciones son de redondeo; y si todas las fuerzas pasan por el centro, ΣM se divide por cero | Escala de las reacciones = Σ\|términos\|; escala de momentos con Σ\|F\|·L |
| E1-4 | **La penalización a mano rompe la regla de oro 2 en doble precisión.** Una barra 1e6–1e8 veces más rígida deja ΣF de 5e-9 a 4e-7, porque K·u ya no se puede evaluar mejor. Con 1e4 pasa (6,2 cifras perdidas) | No es un fallo del motor y el cálculo se declara no válido. El mensaje apunta al mal condicionamiento y a sustituir la barra por un enlace rígido. El compilador no debe generar penalizaciones |
| E1-5 | **Los mecanismos dan pivotes exactamente nulos en faer,** incluso diluidos en 152 000 ecuaciones. Sólo uno sesgado en 3D deja un pivote diminuto (−8,5e-15). Los modelos válidos pierden ≤ 2,8 cifras | Umbral de 11 cifras con más de 4 órdenes de margen. Los dos caminos (error de faer y dⱼ/Kⱼⱼ) están cubiertos por tests |
| E1-6 | **La rigidez de los elementos en TS es el 80 % del ensamblado** (33 µs por lámina, con asignaciones en cada llamada) | Palanca para E3, que reescribe la lámina con multiplicadores: buffers reutilizados y sin `flatMap`. No hace falta para el objetivo |
| E1-7 | **faer y el solver de perfil difieren hasta 1,5e-12** sin refinamiento: la cota es κ(K')·ω, con κ ≈ 1e4–1e6 | Tolerancia del diferencial: 1e-11 en vez del 1e-12 de S7, que se había medido sobre las K de E0 |
| E1-8 | **Un diafragma rígido con nudos a distinta cota no es un sólido rígido en 3D:** ux igual a dos alturas sin giro ry. Rompe ΣM | Es un error (`restriccion/diafragma-no-plano`), aunque CSI lo admite. El compilador pone el maestro a la cota de la planta y deja fuera los nudos de otras cotas, que van con enlaces rígidos |

## Pendiente

- **Para E2 y E3:**
  - cargas de elemento (FER de barras, presiones de lámina) y esfuerzos internos;
  - las liberaciones de E2 entran por la máscara de GDL rigidizados de cada elemento (`gdlRigidizados`).
- **Ordenación por plantas.** §2.7 pide calcular también una disección anidada por plantas y quedarse con la de menos nnz(L). Hoy sólo se usa la AMD de faer, que ya cumple el objetivo.
- **Rendimiento de la comprobación de nudos coincidentes.** Es O(N·k) por líneas de X, y en el edificio objetivo va dentro de los 0,3 s de la numeración. Si molesta, se cambia por un hash espacial.
- **Lo que no tiene E1** y no lo pide el MVP: apoyos inclinados, muelles de longitud no nula y clasificación del modo del mecanismo (traslación o giro, dirección).
- **Pendiente de E0:** ver el CI en verde en GitHub (hace falta un push) y medir en móvil. El heap del semirrígido (355 MB de WASM) ya roza el rango de iOS.

## Cómo reproducir

```sh
bun run test:run                                            # todos los tests (E0, E1 y Fase 1)
bun validacion/e1/modelos-oraculo.ts                        # exporta los modelos del oráculo
.venv312/Scripts/python.exe validacion/e1/oraculo_opensees.py   # → src/motor/__fixtures__/opensees-e1.json
bun validacion/e1/resumen.ts                                # errores medidos → out_resumen.txt
bun validacion/e1/margen-pivotes.ts                         # cifras perdidas → out_margen_pivotes.txt
node validacion/e1/banco.ts ambos                           # edificio objetivo → out_banco.txt
bun validacion/e1/congelar.ts                               # SÓLO a sabiendas: regenera la referencia congelada
```
