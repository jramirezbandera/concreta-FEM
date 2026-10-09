# Fases A0–A2 — capa de agente: esquema, CLI, consultas y spike: resultado

> **Fecha:** 2026-10-09. **Plan:** `agente.md` (§3, criterios de A0, A1 y A2; §7, lo que se fijó al empezar). El usuario arrancó A0–A2 tras C5 y dejó la recuperación SPR (C5-4) como pendiente técnico.
>
> **Veredicto: A0 y A1 pasan todos sus criterios, y la puerta A2 también.**
> - **Esquema y CLI (A0).**
>   - El esquema de `proyecto.json` se genera desde los tipos de `fisico.ts` y acepta los 92 modelos válidos de C1–C5.
>   - Con el compilador detrás, rechaza las 206 entradas no válidas de C1–C4 nombrando el id físico.
>   - `fem calcular` da los mismos bits que llamar a `compilar` y `calcular`, y la huella no depende del orden del JSON ni del motor de JavaScript.
> - **Consultas (A1).**
>   - Envolventes, flechas, deriva, reacciones, piezas y bandas: dan exactamente lo que dan las consultas de C5 y `EsfuerzosPiezas` a mano.
>   - En el edificio objetivo, cada salida cabe en ≤ 2 400 tokens estimados (el tope era 4 000).
>   - Ningún muestreo denso supera el máximo de una envolvente en la batería al azar de C1–C4.
> - **Spike (A2).**
>   - Tres subagentes de Claude Code (Opus 5.5) trabajaron con sólo su descripción en texto, la skill, el esquema y la CLI. Los tres llegaron a un modelo válido **al primer `fem validar`**.
>   - Sus resultados coinciden con la referencia a ≤ 5e-12; la retícula con núcleo, bit a bit.
>   - Cada uno tardó de 75 a 141 s y gastó unos 100 000 tokens.
>   - **Salvedad:** las descripciones son muy precisas, porque las escribió quien conoce las referencias. El spike mide si la capa basta para pasar de un texto preciso a un modelo correcto. No mide la lectura de un proyecto real, con sus ambigüedades.
>
> **Hallazgos principales:**
> - **A-1:** sin el esquema, un campo opcional mal escrito pasaba por `compilar` como válido y sin ningún aviso, y el modelo se calculaba con el valor por defecto. Pasa en 9 de 9 erratas probadas (`insercon`, `gro`, `bse`, `diafragm`, `pesopropio`, `Nu`…). El esquema las para (`additionalProperties: false`), pero quien llame a `compilar` directamente sigue expuesto.
> - **A-2:** ψ se da en números, así que un agente sin la tabla tendría que sacarla de memoria, que es justo lo que prohíbe la regla A1.
> - **A-3:** los diagnósticos repetidos (uno por estación de una banda) hacían que una consulta pasara del tope de tamaño. Ahora se listan tres por código y el resto se cuenta.
>
> **Cómo leerlo:** las tablas resumen los criterios, que se fijaron al empezar (`agente.md` §3 y §7). Cada sección da el detalle y la evidencia. Lo que queda para el usuario está en «Pendiente».

## Criterios de A0

| # | Criterio | Resultado | Evidencia |
|---|---|---|---|
| 1 | El esquema acepta todos los modelos de los fixtures y de las referencias congeladas de C1–C4 | **Pasa.** Acepta 92 modelos tras pasar por JSON: las referencias congeladas de C1–C5, los hechos a mano de C1 y C4, los de validación y 40 al azar con losas, muros y forjados. El ejemplo de la skill también, y compila sin avisos. El esquema versionado es el que sale de los tipos | `src/agente/esquema.test.ts`; `validacion/a0/modelos.ts` |
| 2 | Las entradas no válidas del compilador se rechazan, por el esquema o por `validar`, nombrando el id físico | **Pasa.** Son las 206 de los catálogos de C1–C4 (71 + 51 + 40 + 44). Lo que el esquema para lleva el id del objeto, o el del objeto que lo contiene (un `Vec2` de una viga nombra la viga). Lo demás lo para el compilador con su código y su id, como en C1–C4 | `src/agente/esquema.test.ts` |
| 3 | `fem calcular` da los mismos bits que `compilar` y `calcular` desde un test | **Pasa.** En la retícula con núcleo y en dos modelos al azar con unidireccional y reticular: desplazamientos, reacciones y esfuerzos de barras y láminas idénticos bit a bit, también al reutilizar los resultados guardados | `src/agente/cli.test.ts` |
| 4 | La salida no depende del orden del JSON ni de la máquina: la huella se mantiene | **Pasa.** Con las claves en orden inverso y las listas barajadas, la misma huella y los mismos bits. Node (V8) y Bun (JavaScriptCore) dan la misma salida de `validar` y `compilar`. El nombre, la descripción y `$schema` no entran en la huella | `src/agente/cli.test.ts` |

## Criterios de A1

| # | Criterio | Resultado | Evidencia |
|---|---|---|---|
| 1 | Cada consulta coincide exactamente con `EsfuerzosPiezas`, `Cortes` y `CamposLaminas` a mano | **Pasa.** Comprobado: las envolventes frente a la fuerza bruta (el mismo valor y la misma pieza, estación y combinación, reproducidos por `EsfuerzosPiezas` caso a caso a 1e-9); las flechas frente a `Consultas.flechas` y frente a la uz nudo a nudo; la deriva frente a `desplomes` y al maestro; las reacciones frente a `Consultas.reacciones` y en equilibrio con las cargas; las piezas frente a `vano`, `pilar` y `diagrama`; y la banda frente a `Consultas.banda` | `src/agente/consultas.test.ts` |
| 2 | En el edificio objetivo, el resumen y las consultas no pasan de un tamaño fijado al empezar | **Pasa.** El tope eran 4 000 tokens, estimados como bytes/2,5. Lo mayor es el pilar de 7 tramos (2 377), seguido de las envolventes (2 012). Cada orden tarda de 4,2 a 11 s, sobre todo en volver a compilar | `validacion/a1/out_tamano.txt` |
| 3 | Las envolventes no pierden el máximo en la batería al azar de C1–C4 | **Pasa.** Nueve modelos (C1 a C4, la retícula con núcleo), con los casos sueltos y dos combinaciones de signos mezclados. Cada extremo es el de todas las barras, estaciones y lados, y un muestreo de 65 puntos por barra no lo supera | `src/agente/consultas.test.ts` |

## Criterios de A2 (puerta)

| # | Criterio | Resultado | Evidencia |
|---|---|---|---|
| 1 | Con descripciones sin ambigüedad, el agente llega a un modelo válido en las tres pruebas | **Pasa.** Los tres, al primer `fem validar` y sin ningún error. El del 1-022 convirtió las unidades con un script, como pedía la descripción | `validacion/a2/agente/` (proyecto y script de cada agente) |
| 2 | Resultados globales a 1e-6 frente a la referencia: reacciones totales, deriva por planta, flecha máxima por losa y cinco piezas | **Pasa.** 1-022: ≤ 2,5e-14. Retícula con núcleo: 0, bit a bit (el mismo modelo con otros ids). Edificio objetivo: ≤ 5,2e-12 en los maestros y ≤ 4,4e-13 en el resto. El comparador da ~1e-14 con una variante equivalente (ids, orden, vigas al revés) y no pasa con otras opciones | `validacion/a2/comparar.ts`, `src/agente/comparar-a2.test.ts` |
| 3 | Se registran las vueltas, el tiempo y los tokens | **Hecho** (tabla siguiente) | Informes de los agentes |

| Modelo | `validar` hasta ok | Órdenes de `fem` | Herramientas | Tiempo | Tokens |
|---|---|---|---|---|---|
| 1-022 (31 nudos) | 1 | esquema 1, validar 1, resumen 1, calcular 1 | 11 | 75 s | 96 935 |
| Retícula con núcleo (1 464 nudos) | 1 | esquema 1, validar 1, resumen 1, calcular 1 | 10 | 77 s | 97 134 |
| Edificio objetivo (34 737 nudos) | 1 | esquema 1, validar 1, resumen 5, calcular 1 | 12 | 141 s | 103 959 |

- Los tokens son todo el contexto del subagente, sobre todo la skill y el esquema (47 KB), que cada uno leyó entero.
- Los cinco `resumen` del edificio son el modelo y cuatro variantes que el agente hizo para descomponer el peso propio (A-8).

**Cómo se hizo.**
- Cada agente trabajó en una carpeta propia fuera del repositorio, con la prohibición de leer nada de él salvo la skill, su ejemplo y el esquema.
- Al acabar dio la lista de ficheros que había leído: en los tres casos, sólo esos.
- Los tres son el mismo modelo que escribió la capa y las descripciones. El del edificio avisa de que la sesión le cargó el `CLAUDE.md` del repositorio, que no tiene datos de los modelos.

---

## 1. Qué hay nuevo

| Fichero | Qué hace |
|---|---|
| `src/agente/proyecto.ts`, `proyecto.schema.json` | El tipo `Proyecto` (`esquema`, `nombre`, `descripcion`, `modelo`, `opciones`), su lectura y el esquema versionado |
| `scripts/generar-esquema.ts` | Genera el esquema desde los tipos con la API del compilador de TypeScript (`bun run esquema`) |
| `src/agente/esquema.ts` | Validador del subconjunto de JSON Schema que se genera, con mensajes en español, la ruta, el objeto y su id, y el campo más parecido a una errata |
| `src/agente/resultados.ts` | Resultados guardados: cabecera JSON y los `Float64Array` de cada caso, tal cual |
| `src/agente/combinaciones.ts` | Conjuntos de combinaciones: casos, situaciones del generador o expresiones («1.35*G+1.5*Q») |
| `src/agente/consultas.ts` | `resumen` y las consultas de A1 |
| `cli/fem.ts`, `cli/ordenes.ts` | La CLI: la única parte con IO de la capa (regla A4) |
| `.claude/skills/fem/` | La skill de Claude Code: flujo, reglas, convenios y un ejemplo que se valida en un test |
| `src/pruebas/invalidos-c*.ts` | Los catálogos de entradas no válidas de C1–C4, sacados de sus tests sin cambiarlos |
| `validacion/a0/`, `a1/`, `a2/` | Modelos válidos, el tamaño de las salidas, y las descripciones, el comparador y los proyectos de los agentes del spike |

**Uso:**

```sh
bun run fem validar proyecto.json        # o: bun cli/fem.ts …
bun run fem resumen proyecto.json
bun run fem calcular proyecto.json
bun run fem consultar proyecto.json envolventes --planta N3
bun run fem consultar proyecto.json pieza X15-N3 --combinacion "1.35*G+1.5*Q" --estaciones
```

## 2. Cómo se hacen

**Esquema.**
- Las interfaces y los alias con nombre van a `$defs`. Las tuplas llevan longitud fija, las uniones de literales son `enum` y las demás uniones, `anyOf`.
- Todo objeto lleva `additionalProperties: false`.
- El validador elige la variante de una unión por su discriminante (`tipo`, `forma`), así que un error en una carga dice qué le falta a esa carga y no a las seis variantes.
- Los mensajes llevan la ruta (`modelo.pilares[3].seccion`) y el objeto con su id. Un campo desconocido propone el más parecido: `"secion" no es un campo de Pilar; ¿quería decir "seccion"?`.

**CLI.**
- Cada orden escribe un objeto JSON con `orden`, `ok` y `diagnosticos`.
- **Códigos de salida:** 0 bien; 1 errores del modelo o del cálculo; 2 orden mal dada; 3 error interno.
- **Diagnósticos:** primero los errores; como mucho tres por código y treinta en total, y el resto se cuenta en `omitidos`.
- **Números:** a 6 cifras significativas, salvo con `--exacto`.
- **Resultados:** se guardan en `.fem/<huella>/`, junto al proyecto. Se reutilizan si la huella y el sha256 del núcleo no cambian, y se conservan los tres últimos.

**Consultas.** Salen de las de C5, sin cambiar convenios.
- **Combinaciones por defecto:** ELU del generador para los esfuerzos (persistente, y sísmica o accidental si hay casos de ese tipo) y ELS característica para los desplazamientos, si todos los casos llevan su acción. Si no, los casos sueltos. Las reacciones, que son lineales, van por caso.
- **Máximos sobre una región:** se buscan en cada combinación y dicen cuál gobierna.
  - En las barras, son los extremos del diagrama combinado en sus estaciones: extremos, cuartos, cargas y los ceros de Vz y Vy (H36).
  - La flecha de una vigueta, que no tiene nudos intermedios, es el extremo de su deformada: las raíces de su derivada, aisladas y refinadas por bisección.
- **Axil de las vigas:** el de las que están en un diafragma rígido no tiene valor (C1-d), así que no entra en las envolventes de N.

## 3. Hallazgos

| ID | Hallazgo | Consecuencia |
|---|---|---|
| A-1 | **El compilador ignora en silencio los campos opcionales mal escritos.** De 9 erratas probadas en pilares, vigas, plantas, casos, materiales, losas y el propio modelo, las 9 compilan como válidas y sin ningún diagnóstico, con el valor por defecto en vez del escrito | El esquema las para. Queda por decidir si `compilar` debe rechazarlas también, para quien lo llame sin pasar por la CLI (Concreta) |
| A-2 | **ψ se da en números.** El agente necesita la tabla 4.2 del DB SE, y sin ella la sacaría de memoria (regla A1). Lo detectó el propio validador al escribir el ejemplo de la skill con `"psi": "A"` | La skill dice que ψ sale de la descripción. Pendiente: admitir la categoría de uso por nombre, que el código ya tiene (`psiUso`) |
| A-3 | **Los diagnósticos repetidos rompían el tope de tamaño.** La banda más larga del edificio objetivo daba 27 avisos `corte/restriccion-partida` iguales, uno por estación: 14,8 KB de los que 2,6 eran el valor | Tres por código; el resto, contados. La banda queda en 3,8 KB |
| A-4 | **Los resultados de Node y de Bun difieren en el último bit,** porque la malla depende de un ulp del seno (C2-3), y comparten la carpeta de su huella | Es la precisión de C2–C5 (1e-12 en coordenadas); el criterio 3 se mide en un mismo motor. Se dice en la cabecera de `resultados.ts` |
| A-5 | **Cada consulta vuelve a compilar.** En el edificio objetivo son 4 s de los 4,2–11 de cada orden | Aceptable para A2; pendiente un caché de la compilación si el agente itera mucho |
| A-6 | **Comparar por posición necesita invarianza al sentido de la viga.** Al dibujarla al revés cambian de signo Vz y Mz; N, Vy, T y My no | El comparador de A2 usa max/min de My y el mayor \|Vz\| del vano |

**Del spike (A2):**

| ID | Hallazgo | Consecuencia |
|---|---|---|
| A-7 | **Lo que no estaba en la skill lo dedujeron del esquema, pero con dudas.** Qué inercia es Iy en una sección general (el del 1-022 la sacó de los ejes locales), si la cimentación debe ser `sotano` (dos lo pusieron y uno no, y los tres acertaron: sólo mueve el origen de las cotas), si un muro cerrado repite el primer punto y que una carga de pilar sin `desde` ni `hasta` va en toda su altura | Aclarado tras el spike en la skill y en los comentarios de `fisico.ts` (y así en el esquema). Comprobado que marcar la cimentación como sótano da los mismos resultados a 1e-14 |
| A-8 | **Los tres revisaron el resumen contra la descripción y reconstruyeron a mano el peso propio.** El del edificio necesitó cuatro variantes del modelo para descomponer G. Así encontró que la mitad exterior de las vigas de borde pesa con todo su canto (la losa va a ejes) y que una secundaria que cruza el hueco pesa entera | El desglose del peso propio por tipo de pieza es una comprobación de A3 (§3 de `agente.md`). También piden ΣFx y ΣFy por planta (una fuerza horizontal en la planta equivocada no se ve), las opciones efectivas y las hipótesis en el resumen |
| A-9 | **Peso propio que se cuenta dos veces** (señalado por el agente del núcleo, que reconstruyó la G del compilador exacta con estos términos): el descuelgue de las vigas que corren sobre el eje de un muro se suma al muro (25 kN de 2 085), y el pilar no descuenta su solape con la losa (22 kN) | Es del compilador (C2-g, C3-g), no de la capa. Pendiente del usuario |
| A-10 | **`calcular` avisa de `modelo/nudos-coincidentes`** en las esquinas del núcleo, donde arrancan un pilar y un muro, y `validar` no. El mensaje nombra nudos analíticos | La skill lo dice. Pendiente: avisarlo al compilar y con los objetos físicos |

## 4. Pendiente

**Del usuario:** A-1, A-2 y A-9 se decidieron e hicieron el 2026-10-09, tras A3 (`fase-a3.md` §5).

**Técnico:**
- La recuperación SPR de C5-4, por decisión del usuario.
- Un caché de la compilación junto a los resultados (A-5): las consultas del edificio objetivo pasarían de 4–11 s a 0,5–7 s.
- El resumen con ΣFx y ΣFy por planta, las opciones efectivas y las hipótesis (A-8). El desglose del peso propio va con A3.
- Avisos que pidieron los agentes:
  - `modelo/nudos-coincidentes` al compilar y con ids físicos (A-10);
  - una viga que cruza un hueco de losa;
  - la posición del elemento en `muro/aspecto`.

**Siguiente:**
- **A3 (sensatez e informe):** según A-d, tiene que estar antes de usar la capa con un proyecto real.
- **Un segundo spike** con una descripción como la de un proyecto real, con datos que falten o se contradigan, para medir si el agente pregunta en vez de decidir (regla 3 de la skill).

## Cómo reproducir

```sh
bun run test:run                                   # todos los tests; los de la capa, en src/agente/
bun run esquema                                    # regenera el esquema desde los tipos
bun validacion/a1/tamano.ts                        # criterio 2 de A1 → validacion/a1/out_tamano.txt
bun validacion/a2/comparar.ts <1022|nucleo|edificio> <proyecto.json>   # criterio 2 de A2
```
