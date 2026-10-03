# Fase E2 — barras: resultado

> **Fecha:** 2026-10-03. **Plan:** S7 de `investigacion-id.md` (fase E2: «Timoshenko, offsets, punto de inserción, liberaciones, FER, diagramas y `seccion3D()`»), con los modificadores de H47.
> **Veredicto: pasan los cinco criterios.** La barra coincide con PyNite (Euler–Bernoulli, liberaciones y todas las cargas de barra) a ≤ 7,5e-14 y con OpenSeesPy (Timoshenko, offsets y liberaciones) a ≤ 6,4e-14. Las FER y los diagramas son exactos sin trocear la barra, y el equilibrio de cada cálculo usa la resultante real de las cargas de barra. El edificio objetivo con 2 352 barras de E2 y 24 casos se calcula en 3,1 s (diafragma rígido) o 4,8 s (sin él). Se puede pasar a E3 (láminas).
>
> **Cómo leerlo:** la tabla resume los criterios, que se fijaron al empezar la fase. Cada sección da el detalle y la evidencia. Los hallazgos que cambian algo del plan están en «Hallazgos de E2».

| # | Criterio | Resultado | Evidencia |
|---|---|---|---|
| 1 | La barra frente a dos oráculos independientes a ≤ 1e-10: PyNite (Euler–Bernoulli, liberaciones, cargas de barra) y OpenSeesPy (Timoshenko, offsets, liberaciones) | **Pasa.** PyNite ≤ 7,5e-14 en u, reacciones y esfuerzos en 7 estaciones por barra; OpenSees ≤ 6,4e-14 en u, reacciones y fuerzas de extremo | `src/motor/oraculos-e2.test.ts`, `validacion/e2/out_resumen.txt` |
| 2 | Soluciones cerradas y «una barra = la barra troceada» a ≤ 1e-12 | **Pasa.** FER de Timoshenko frente a un modelo de dos barras: 9,2e-16; trapecial frente a ∫ q·FER puntual: 1,3e-15 | `src/elementos/barra.test.ts`, `src/motor/barras.test.ts` |
| 3 | Propiedades y pruebas metamórficas a ≤ 1e-9; equilibrio en cada cálculo con la resultante real de las cargas de barra | **Pasa.** Giro ≤ 3,1e-12, renumeración ≤ 1,5e-12, inversión de barras ≤ 2,7e-14, superposición ≤ 1,5e-14; equilibrio ≤ 1,1e-13; unas FER erróneas en un 0,1 % dan un cálculo no válido | `src/motor/propiedades-e2.test.ts`, `src/motor/equilibrio-barras.test.ts` |
| 4 | Diagnósticos: liberaciones inestables, offsets que se comen o invierten la barra, cargas fuera del tramo flexible; ningún falso positivo | **Pasa.** 3 juegos inestables, 8 defectos de barra y 6 de cargas, cada uno con su código; los modelos válidos no dan ningún diagnóstico | `src/motor/barras.test.ts` |
| 5 | Convenio de signos de H02 escrito en la cabecera del motor y comprobado; `seccion3D()` | **Pasa.** Los 6 casos de la ménsula de H02 en 3 orientaciones; J del rectángulo frente a la serie directa a ≤ 1e-14 | `src/motor/modelo.ts`, `src/motor/barras.test.ts`, `src/secciones/seccion3D.test.ts` |

Además, como pide la regla de oro 1, hay una referencia congelada de dos edificios con barras de E2 (`src/motor/congelado-e2.test.ts`), que guarda también los esfuerzos de todas las barras.

---

## 1. Qué hay nuevo

| Fichero | Qué hace |
|---|---|
| `src/elementos/barra.ts` | Rigidez de Timoshenko exacta (Przemieniecki; sin áreas de cortante es Euler–Bernoulli), liberaciones por condensación subsistema a subsistema, offsets rígidos y modificadores |
| `src/elementos/tramos.ts` | Funciones polinómicas a trozos con saltos: la base exacta de cargas, FER y diagramas |
| `src/elementos/cargasBarra.ts` | Cargas de barra en ejes locales, FER por el método de flexibilidad y `DiagramaBarra` (esfuerzos, giros y flechas a lo largo del tramo flexible) |
| `src/motor/barras.ts` | La barra en el motor: preparación con diagnósticos, cargas de barra por caso, resultante real para el equilibrio, esfuerzos de extremo y `DiagramasBarras` |
| `src/motor/geometria.ts` | Coordenadas, centro, tamaño y tolerancia geométrica (antes en `elementos.ts`) |
| `src/secciones/seccion3D.ts` | A, Iy, Iz, J, Avy y Avz de rectángulo, círculo, T (vigueta de D2) y perfiles en I del catálogo de Concreta |

**Modelo analítico** (`modelo.ts`):
- `BarraAnalitica` gana `offsets` (vectores globales del nudo al extremo del tramo flexible), `liberaciones` (por extremo, en ejes locales) y `modificadores` (A, Avy, Avz, J, Iy, Iz).
- `CasoCarga.barras`: cargas puntuales (fuerza y momento) y distribuidas trapeciales parciales, en ejes locales o globales, con las posiciones en m desde i'.
- `ResultadoCaso.esfuerzosBarras`: 12 valores por barra, [N, Vy, Vz, T, My, Mz] en i' (x = 0⁺) y en j' (x = L'⁻).

**Uso de los diagramas:**

```ts
const r = calcular(modelo);                       // r.casos[k].esfuerzosBarras: extremos
const diagramas = new DiagramasBarras(modelo);    // prepara barras y cargas una vez
const d = diagramas.diagrama(b, k, r.casos[k]);   // barra b, caso k
d.esfuerzosEn(x, -1 | 1);                         // [N, Vy, Vz, T, My, Mz], por la izquierda o la derecha de un salto
d.desplazamientosEn(x);                           // [ux, uy, uz, rx, ry, rz] locales del eje
d.estaciones();                                   // extremos, cuartos, cargas y ceros de Vy y Vz (H36)
DiagramaBarra.combinar([d1, d2], [1.35, 1.5]);    // combinación exacta de casos
```

**Convenio de signos** (cabecera de `modelo.ts`, H02): regla de CSI aplicada a los ejes del motor, con z = canto. N > 0 es tracción; My > 0 comprime la fibra +z (vano positivo); My' = −Vz y Mz' = −Vy. En una biapoyada con gravedad, Vz es negativo en el apoyo izquierdo. Frente a la salida de SAP2000 con su eje 2 según el canto: N = P, Vz = V2, Vy = −V3, T = T, My = M3, Mz = −M2. Con los mismos ejes, PyNite da todas las componentes con el signo cambiado.

**Decisiones de diseño que conviene revisar:**
- **Offsets como vectores globales y totalmente rígidos.** No hay «factor de zona rígida» ni offsets en ejes locales: el compilador calcula los vectores a partir de las caras de los pilares y del punto de inserción.
- **Las cargas de barra van sólo sobre el tramo flexible.** Las posiciones son absolutas desde i' y tienen que caer en [0, L']. Una carga sobre una zona rígida la tiene que pasar el compilador al nudo como carga nodal.
- **Sin área de cortante, Euler–Bernoulli.** Un área de cortante ausente quita la deformación por cortante en ese plano (como CSI con área 0); un área ≤ 0 es un error, para que un dato que falta no se convierta en silencio en una barra más rígida.
- **Modificadores estrictamente positivos.** Para quitar la torsión se libera, no se pone J × 0.
- **Esfuerzos de extremo interiores:** los valores en 0⁺ y L'⁻. Una carga puntual justo en un extremo pasa al nudo y no aparece en ellos.
- **Los diagramas se calculan bajo demanda** y no se guardan en el resultado: por caso sólo van los 12 esfuerzos de extremo de cada barra (H36). El diagrama de una combinación es exacto (`DiagramaBarra.combinar`).
- **Áreas de cortante de CSI en `seccion3D()`:** 5/6·A en el rectángulo, 0,9·A en el círculo, h·tw y 5/3·b·tf en el perfil en I. Así la comparación con SAP2000 no falla por hipótesis.
- **J de la T** como suma de sus dos rectángulos (serie exacta), sin la mejora de la unión: queda del lado flexible.

## 2. Criterio 1: oráculos

**PyNite 3.2.0** (`validacion/e2/oraculo_pynite.py`). Es Euler–Bernoulli, condensa las liberaciones e integra las cargas en forma cerrada (H11). Modelos (`validacion/e2/modelos-oraculo.ts`):
1. **Pórtico espacial:** dos plantas con cubierta a cuatro aguas (pares esviados), una tornapunta biarticulada con la torsión liberada en un extremo, y vigas con rótulas en My o en Mz. Tres casos con cargas distribuidas uniformes y trapeciales parciales, puntuales y momentos, en ejes locales y globales.
2. **Viga de Gerber:** viga continua esviada en 3D sobre cuatro apoyos, con una rótula en el vano central.

PyNite fija sus ejes locales con su propia regla (H08) y un ángulo `rotation` alrededor de x (fórmula de Rodrigues). El oráculo calcula ese ángulo para que su z coincida con nuestro `vz`, y lo comprueba a 1e-12.

| Modelo | u | Reacciones | Esfuerzos (7 estaciones por barra) |
|---|---|---|---|
| Pórtico espacial (faer / perfil) | 7,5e-14 / 5,2e-14 | 4,7e-14 / 3,1e-14 | 4,2e-14 / 2,8e-14 |
| Viga de Gerber (faer / perfil) | 6,3e-15 / 1,7e-14 | 5,4e-15 / 6,6e-15 | 4,4e-15 / 6,7e-15 |

Los esfuerzos se comparan con −PyNite: queda confirmada en 3D, con barras esviadas, rótulas y todas las cargas, la conversión de signos de H02.

**OpenSeesPy 3.8** (`validacion/e2/oraculo_opensees.py`):
- **Correspondencias:**
  - Timoshenko → `ElasticTimoshenkoBeam`; Euler–Bernoulli → `elasticBeamColumn`;
  - offsets → `-jntOffset` (variante `jnt`) o nudos auxiliares con `rigidLink('beam')` (variante `rigid`);
  - liberaciones → nudo duplicado con `equalDOF` en los GDL no liberados.
- **Troceado:** OpenSees no admite puntuales en la barra de Timoshenko ni trapeciales parciales, así que el oráculo trocea cada barra en sus cargas puntuales. La fuerza de extremo de cada trozo se compara con nuestro diagrama de la barra entera en ese punto. Es a la vez una validación independiente de las FER de Timoshenko y de «cargas sin trocear».

| Modelo [variante] | u | Reacciones | Fuerzas de extremo de los trozos |
|---|---|---|---|
| Timoshenko: pilares cortos y cantos grandes, voladizo esviado | 4,8e-14 | 2,4e-14 | 9,4e-15 |
| Offsets [rigid]: zonas rígidas, vigas descolgadas y offsets generales | 9,3e-15 | 9,5e-15 | 2,7e-14 |
| Offsets en Euler–Bernoulli [jnt] | 6,4e-14 | 1,0e-14 | 1,4e-14 |
| Offsets en Euler–Bernoulli [rigid] | 3,3e-14 | 5,1e-15 | 1,4e-14 |
| Liberaciones de todos los tipos, con y sin offsets [rigid] | 2,8e-14 | 2,8e-14 | 5,3e-14 |

**Dos defectos de OpenSees encontrados por el camino** (E2-1, E2-2):
- su `ElasticTimoshenkoBeam` aplica mal `-jntOffset`;
- con Lagrange, `nodeReaction` no suma la fuerza de la restricción en un apoyo que es maestro de una restricción.

Por eso `jnt` sólo se usa con Euler–Bernoulli, y en la variante `rigid` esos apoyos (uno) no entran en la comparación de reacciones; en la variante `jnt` sí entran.

## 3. Criterio 2: soluciones cerradas y cargas sin trocear

**Elemento** (`src/elementos/barra.test.ts`):
- **Rigidez:** el bloque de j coincide con la inversa de la flexibilidad de la ménsula de Timoshenko (≤ 1e-13). Sin áreas de cortante es la de Euler–Bernoulli, y converge a ella al crecer Av.
- **Modos rígidos:** con offsets y liberaciones, la rigidez en los nudos conserva exactamente los 6 modos rígidos (≤ 1e-13), es simétrica y semidefinida.
- **FER de Euler–Bernoulli:** qL/2 y qL²/12, y Pab²/L².
- **FER de Timoshenko:**
  - puntual: igual a un modelo exacto de dos barras (9,2e-16);
  - trapecial parcial: igual a ∫ q(ξ)·FER puntual(ξ) dξ (1,3e-15);
  - uniforme: qL²/12, como en Euler–Bernoulli, por simetría.
- **Diagrama:** con extremos en movimiento arbitrario y cargas, llega exactamente a los desplazamientos y fuerzas de j'. Así se cruzan dos derivaciones independientes: la rigidez de Przemieniecki y la integración por flexibilidad.

**Motor** (`src/motor/barras.test.ts`, con los dos solvers):
- **Ménsula de Timoshenko** con carga en la punta y uniforme, en los dos planos: w = PL³/3EI + PL/GAv y w = qL⁴/8EI + qL²/2GAv.
- **Biempotrada:** qL/2, qL²/12, qL²/24 en el centro y flecha qL⁴/384EI + qL²/8GAv.
- **Empotrada-apoyada por liberación de My** (Timoshenko, contra el método de las fuerzas), con el giro de la rótula recuperado.
- **Zonas rígidas:** la parte flexible es la biempotrada de L' y los nudos reciben el brazo.
- **Punto de inserción:** un axil excéntrico da My = −F·e y ux = FL/EA + F·e²·L/EI.
- **Celosía espacial (trípode):** axiles por estática, y giros sin rigidez restringidos con aviso.
- **Una barra = la barra troceada** (≤ 1e-12). Barra esviada de Timoshenko con offsets generales, una rótula, modificadores y cargas de los cuatro tipos en ejes locales y globales:
  - reacciones iguales;
  - diagrama igual, en cada punto de corte, a los esfuerzos de los trozos;
  - eje deformado que pasa por los nudos intermedios del modelo troceado.

## 4. Criterio 3: propiedades, pruebas metamórficas y equilibrio

Sobre los cinco modelos de los oráculos y dos edificios con barras de E2 (`validacion/e2/metamorficas.ts`; `out_resumen.txt`):

| Prueba | Peor valor |
|---|---|
| Giro y traslación del modelo (offsets y cargas globales giran; los esfuerzos de barra, locales, no cambian) | 3,1e-12 |
| Renumeración de nudos y barras | 1,5e-12 |
| Inversión del sentido de todas las barras (N, Vy, T y My iguales; Vz y Mz cambian de signo) | 2,7e-14 |
| Superposición con cargas de barra | 1,5e-14 |
| Equilibrio ΣF/ΣM en todos los modelos | 1,1e-13 |

**Equilibrio con cargas de barra.** La fase 8 de `calcular()` suma la resultante real de cada carga de barra, en forma cerrada a partir de su definición y respecto al centro del modelo, y no sus fuerzas nodales equivalentes. Así, un error de las FER que no esté en equilibrio con las cargas rompe la regla de oro 2. `equilibrio-barras.test.ts` lo comprueba con unas FER un 0,1 % mayores: el cálculo deja de ser válido. Un error de las FER que sí esté en equilibrio (que reparta mal entre los extremos) no lo puede ver ningún equilibrio global (E2-6): para eso están los criterios 1 y 2.

## 5. Criterio 4: diagnósticos

| Código | Qué detecta |
|---|---|
| `modelo/liberacion-inestable` | Un juego que deja un mecanismo dentro de la barra: axil, torsor o un cortante liberados en los dos extremos, o un plano sin rigidez transversal (las reglas de CSI). Se comprueba con exactitud: es inestable si un modo rígido del subsistema cae entero en los GDL liberados |
| `modelo/elemento-degenerado` | Tramo flexible de longitud nula (los offsets se comen la barra) |
| `modelo/offset-no-valido` | Offsets no finitos o que invierten el tramo flexible respecto a sus nudos |
| `modelo/orientacion-no-valida` | `vz` paralelo al tramo flexible (no al eje entre nudos) |
| `modelo/propiedad-no-valida` | Área de cortante ≤ 0, modificador ≤ 0, liberaciones que no dan 6 valores por extremo |
| `carga/fuera-de-barra` | Posiciones fuera de [0, L'], con una tolerancia de 1e-9 del tamaño del modelo (dentro de ella se acotan) |
| `carga/no-valida` | Barra inexistente, ejes desconocidos, valores no finitos, tramo vacío o invertido |
| `carga/gdl-sin-rigidez` (de E1) | Ahora también una FER sobre un GDL sin rigidez, como un torsor en una barra con la torsión liberada cuyo nudo no tiene otra rigidez a torsión |

**Liberaciones sin falsos ceros.** Si la teoría dice que la rigidez condensada es nula, se pone a cero exactamente. Ocurre con el axil o el torsor liberados en un extremo, y en flexión cuando sólo quedan dos GDL: biarticulada, extremo libre, o una rótula más un cortante. Así un nudo que sólo tiene barras articuladas tiene sus giros sin rigidez exactamente, y el núcleo los restringe solo con aviso, en vez de dejar un pivote de redondeo. Lo comprueba la celosía.

## 6. Rendimiento: el edificio objetivo con barras de E2

**Modelo** (`validacion/e2/banco.ts`; `out_banco.txt`): el mismo edificio que el banco de E1 (29 221 nudos, D9), con `barrasE2`:
- pilares y vigas de Timoshenko;
- zona rígida en la cabeza de los pilares;
- vigas descolgadas con zonas rígidas en las caras de los pilares;
- rótulas en una fachada;
- 9 275 cargas de barra en los 24 casos.

Node 24, Ryzen 9 5900X.

| Fase (ms) | E2, diafragma rígido | E2, semirrígido | E1, diafragma rígido | E1, semirrígido |
|---|---|---|---|---|
| Comprobación y numeración | 397 | 271 | 365 | 266 |
| Cargas (con las FER) | 154 | 147 | 54 | 56 |
| Ensamblado | 1 257 | 1 071 | 1 243 | 1 113 |
| Solución | 907 | 2 740 | 826 | 2 631 |
| Recuperación (con los esfuerzos de barra) | 350 | 336 | 168 | 196 |
| **Total** | **3,15 s** | **4,79 s** | **2,73 s** | **4,50 s** |
| Peor equilibrio / error hacia atrás | 3,2e-11 / 4,5e-15 | 4,5e-12 / 1,3e-13 | 4,2e-11 / 4,4e-15 | 5,1e-12 / 1,1e-14 |

**Lecturas:**
- **Las barras de E2 cuestan unos 0,3–0,4 s** en el edificio objetivo, entre las FER de las cargas (~0,1 s) y los esfuerzos de 2 352 barras en 24 casos (~0,15–0,18 s). Sigue dentro del objetivo de E1: total ≤ 6 s.
- **Con el mismo modelo de E1** (barras sin cargas), el motor de E2 da los mismos números. Sólo la recuperación crece: los esfuerzos de extremo se calculan siempre.

## Hallazgos de E2

| ID | Hallazgo | Consecuencia |
|---|---|---|
| E2-1 | **La `ElasticTimoshenkoBeam` de OpenSees 3.8 aplica mal `-jntOffset` sin avisar.** Acorta la longitud al tramo flexible, pero ignora la cinemática del brazo rígido: con un offset lateral da lo mismo que sin offset; con zonas rígidas, la flecha de la ménsula sin el brazo (hasta un 31 % de diferencia). `elasticBeamColumn` con `-jntOffset` coincide con `rigidLink` a 1e-15 | Los offsets de Timoshenko se validan sólo con `rigidLink`, y `-jntOffset` sólo con Euler–Bernoulli. No usar nunca `ElasticTimoshenkoBeam` con `-jntOffset` como oráculo |
| E2-2 | **Con `constraints('Lagrange')`, el `nodeReaction` de OpenSees no incluye la fuerza de la restricción** en un apoyo que es maestro de un `rigidLink` o un `equalDOF`: da −(carga aplicada) | El oráculo excluye esos apoyos de la comparación de reacciones y los valida en una variante sin restricciones (`jnt`) |
| E2-3 | **Una dirección sin rigidez esviada es un mecanismo, no un GDL que se restrinja solo.** Ejemplo: el giro alrededor del eje en el nudo intermedio de dos barras esviadas con la torsión liberada. El núcleo sólo restringe solos los GDL sin rigidez alineados con los ejes globales (fila exactamente nula). A 0° el cálculo es válido con aviso; a 30°, error `solver/mecanismo` que nombra el nudo | No hay fallo silencioso. Pero el compilador de D2 no debe dejar nudos intermedios de vigueta sin rigidez a torsión: que libere la torsión sólo en un extremo de cada vigueta entre vigas. Restringir direcciones esviadas pediría una base de GDL girada en el nudo, lo mismo que los apoyos inclinados (pendiente de E1) |
| E2-4 | **Con brazos rígidos, el error hacia atrás por componentes de LDLᵀ llega a 1,3e-13** en unas pocas filas (b = 0, muchos términos que se cancelan); en E1 no pasaba de 2e-15. Con el umbral de refinado de E1 (1e-13) costaba otra resolución (0,9 s) en el semirrígido | `RESIDUO_SUFICIENTE` pasa de 1e-13 a 1e-12. El objetivo sigue en 1e-10 y el aviso no cambia |
| E2-5 | **FER exactas para Timoshenko por flexibilidad:** con i' empotrado, s₀ es la única incógnita y seis condiciones de desplazamiento nulo en j' la dan en forma cerrada para cualquier carga lineal a trozos. Es la misma maquinaria de los diagramas | No hacen falta tablas de FER por tipo de carga ni troceado. Añadir un tipo de carga es añadir su contribución a `diagramaDeCargas` |
| E2-6 | **El equilibrio global no ve los errores de FER autoequilibrados.** Un reparto erróneo entre los dos extremos que conserve la resultante pasa la regla de oro 2 | La regla de oro 2 usa la resultante real (y detecta los errores no autoequilibrados, comprobado con una mutación). Los demás los cubren los criterios 1 y 2, que tienen que mantenerse para cada tipo de carga nuevo |
| E2-7 | **PyNite = −motor en las seis componentes** con los mismos ejes locales, también con barras esviadas, rótulas y cargas en ejes globales. Su `rotation` (Rodrigues alrededor de x) permite fijar exactamente cualquier `vz` | Confirma H02 en 3D. El oráculo de PyNite queda disponible para cualquier tipo de carga de barra nuevo |

## Pendiente

- **Para el compilador** (fase 2 de S1):
  - cargas sobre zonas rígidas, como carga nodal;
  - offsets a partir de las caras de los pilares y del punto de inserción (con el aviso de doble cómputo del peso, H24);
  - cargas proyectadas (multiplicar por el coseno);
  - viguetas de D2 sin nudos intermedios sin rigidez a torsión (E2-3).
- **Esfuerzos en el nudo y en las zonas rígidas.** §2.6 de la especificación pide también el valor en el nudo. Hoy se dan en las caras del tramo flexible (i', j'); en el nudo se obtienen trasladando por el offset.
- **Lo que no tiene E2 y no pide el MVP:**
  - momentos distribuidos;
  - temperatura (E7);
  - secciones de inercia variable;
  - torsión no uniforme (alabeo);
  - una base de GDL girada en el nudo (E2-3 y apoyos inclinados).
- **`seccion3D()`:** faltan otras familias de acero (tubos, 2UPN, angulares; sus It ya están en el catálogo de Concreta) y la mejora de la unión en la J de la T.
- **Rendimiento:** la recuperación de los esfuerzos de extremo reserva memoria por barra y caso (~0,15 s en el edificio objetivo). Si molesta, se pasa a búferes reutilizados, como E1-6 para las láminas.
- **Benchmarks de CSI para barras (H48: SAP2000 1-004, 1-018 y 1-022):** quedan para E6 junto con los modelos SAP2000 del usuario.
- **Pendiente de E0 y E1:** ver el CI en verde en GitHub y medir en móvil.

## Cómo reproducir

```sh
bun run test:run                                                # todos los tests (E0, E1, E2 y Fase 1)
bun validacion/e2/modelos-oraculo.ts                            # exporta los modelos de los oráculos
.venv/Scripts/python.exe validacion/e2/oraculo_pynite.py        # → src/motor/__fixtures__/pynite-e2.json
.venv312/Scripts/python.exe validacion/e2/oraculo_opensees.py   # → src/motor/__fixtures__/opensees-e2.json
bun validacion/e2/resumen.ts                                    # errores medidos → out_resumen.txt
node validacion/e2/banco.ts ambos                               # edificio objetivo con barras de E2 → out_banco.txt
bun validacion/e2/congelar.ts                                   # SÓLO a sabiendas: regenera la referencia congelada de E2
```
