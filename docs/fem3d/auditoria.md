# Auditoría del motor, la lectura de resultados y el compilador (2026-10-25)

## 1. Alcance y método

- **Qué se auditó:** corrección y fallos silenciosos (un resultado erróneo presentado como válido), no estilo ni rendimiento.
- **Tres piezas, siete parcelas:**
  - motor: barras (`src/elementos/barra.ts`, `cargasBarra.ts`, `tramos.ts`, `src/motor/barras.ts`, `src/secciones/`); láminas (`dkmq.ts`, `membrana.ts`, `lamina.ts`, `src/motor/laminas.ts`, `geometria.ts`); núcleo (`gdl.ts`, `ensamblado.ts`, `solucion.ts`, `equilibrio.ts`, `calcular.ts`, `src/solver/`, `src/nucleo/index.ts`); recuperación (`fuerzasNodales.ts`, `cortes.ts`, `indice.ts`, `campos.ts`);
  - lectura de resultados: `resultados.ts`, `consultas.ts`, `envolventes.ts`, `esfuerzosFranjas.ts`, `franjas.ts`, `estaciones.ts`, `esfuerzosBandas.ts`, `esfuerzosMuros.ts`, `woodArmer.ts`, `src/combinaciones/`, y las consultas, combinaciones y sensatez de resultados de `src/agente/`;
  - compilador: construcción del modelo (`compilar.ts`, `fisico.ts`, `validar.ts`, `campos.ts`, `piezas.ts`, `losas.ts`, `cargas.ts`, `muros.ts`, `unidireccional.ts`, `reticular.ts`, `puntoFijo.ts`…) y geometría y mallado (`arreglo.ts`, `topologia.ts`, `poligonos.ts`, `geometria2d.ts`, `mallado.ts`, `rejilla.ts`, `anchosVigas.ts`, `huella.ts`, `ejes.ts`).
- **Método:** cada parcela se leyó entera. Cada sospecha se reprodujo con un script contra una solución analítica o un invariante antes de darla por hallazgo; lo que no se pudo reproducir va como **plausible**. No se tocó el repositorio.
- **Línea base:** `bunx vitest run src`, 141 ficheros y 2 101 pruebas en verde (301 s).
- **Gravedad:** grave = resultado erróneo que compila y calcula sin aviso; medio = caso no cubierto con un error poco claro, un resultado dudoso o un riesgo de API; leve = inconsistencia sin efecto en los resultados por defecto.

## 2. Veredicto

No hay ningún error de cálculo en el camino por defecto. Sale **un hallazgo grave** (AU-1, un apoyo perdido en silencio), nueve medios y quince leves. El grave y cuatro medios son del compilador o de la lectura de resultados; los demás medios son riesgos de API o entradas a mano que el compilador ya rechaza.

## 3. Hallazgos

### 3.1 Grave

**AU-1 · Un apoyo lineal en una planta sin losas ni muros se pierde en silencio.** CONFIRMADO.
- **Dónde:** `src/compilador/losas.ts:371-373` sólo recorre las plantas con losas o muros, y los trazos de los apoyos lineales se crean dentro de ese bucle (`losas.ts:687`). En `src/compilador/piezas.ts:429`, `losas.apoyosLineales.get(a.id) ?? []` no apoya nada y nadie avisa. `validar.ts:670` sólo comprueba planta, polilínea y coacciones.
- **Escenario:** pórtico de dos pilares y una viga en una planta sin losa, con un apoyo lineal a lo largo de la viga (o fuera de todo, o en la planta baja vacía). Los tres casos compilan con `valido: true`, sin diagnósticos, con sólo los dos apoyos de las bases y `mapeo.apoyos = {}`.
- **Corrección propuesta:** error `apoyo/sin-destino` en `piezas.ts` cuando un apoyo lineal no tiene nudos, como ya hacen la topología con los puntuales y `losas.ts:1254` con los que van por dentro de una huella. Entrada nueva en `invalidos`.

### 3.2 Medios

**AU-2 · Dos losas a menos de ε_snap se funden en una sin decirlo.** CONFIRMADO.
- **Dónde:** la regla 1 de `arreglo.ts` y `validar.ts:626`, que sólo comprueba solapes de área.
- **Escenario:** una junta de dilatación dibujada como dos losas a 2 cm. Compila; las dos losas comparten 17 nudos y transmiten momento. El único diagnóstico es `losa/ajuste` de L2 («su borde se mueve hasta 2,0 cm»), que no nombra a L1 ni dice que quedan unidas. A 10 cm no comparten ninguno. Igual dentro de una losa: una ranura de 2 cm entre lados no contiguos pasa la validación de simplicidad (a 1e-9, `validar.ts:166`) y se cierra.
- **Corrección propuesta:** en `validar`, distancia entre regiones de losas de la misma planta y entre lados no contiguos de una losa < ε_snap → error con los ids, como `losa/huellas-solapadas` en los pilares.

**AU-3 · Un hueco a menos de ε_snap del contorno da un error que parece interno.** CONFIRMADO.
- **Dónde:** `validar.ts:570` comprueba hueco–contorno a 1e-9; el arreglo los une a ε_snap y `mallado.ts:1598` lo detecta tarde.
- **Escenario:** hueco a 2 cm del borde. La planta no compila con `malla/lado-perdido: Un lado de L, L entre (2.000, 0.000) y (4.000, 0.000) no es arista de la malla`.
- **Corrección propuesta:** comprobar hueco–contorno y hueco–hueco a ε_snap en `validar`, con un mensaje de modelo.

**AU-4 · El ancho de una viga plana dentro de un forjado aligerado pesa como el forjado, no como hormigón.** CONFIRMADO. **Decide el usuario.**
- **Dónde:** `cargas.ts:171-216` (`pesoBajoLosa`) descuenta γ·(b/2)·mín(h, t) por lado cubierto, y al ancho le llega el `pp` del forjado (por las piezas del ancho de LV o por la palanca de C4-e). En una maciza el total es exacto (+0,6 %, el cruce pilar–viga de A-9); en un aligerado, el ancho pesa pp_forjado en vez de γ·t.
- **Medido:** recuadro de 6 × 6 m con vigas planas de 30 × 30: reticular 25+5 con pp 4,5, −8,5 kN (−3,8 % del G del recuadro); unidireccional con pp 3,0, −13,8 kN (−7,8 %). En la vivienda, las vigas aportan unos 110 kN menos que γ·A·L (≈ 5 % de G). Del lado inseguro.
- **Matiz:** los totales de peso propio de la vivienda cuadran con CYPECAD a +1,0 % (`fase-cy.md` §2), así que CYPE parece hacer lo mismo.
- **Opciones:** mantenerlo y decirlo en la hipótesis de peso propio, o descontar por lado (b/2)·mín(γ·h, pp del forjado de ese lado).

**AU-5 · Bandas del Anejo I: con `franjas: true` (por defecto), las caras de los pilares de borde no están en la malla.** CONFIRMADO.
- **Dónde:** con franjas, `losas.ts:671` ya no siembra las caras de las bandas («sus caras son las de las franjas»), pero `carasFranjas` (`franjas.ts:302-314`) excluye a propósito las caras de los pilares de borde paralelas al borde. `estaciones.ts:3-4` promete que esas caras se siembran.
- **Escenario:** la losa plana de `consultas.test.ts` (16 pilares de 30 × 30, bandas de `proponerBandas`), h = 0,5 o 0,75: 28 de 126 estaciones salen `valido: false` (`corte/atraviesa-laminas`, `corte/restriccion-partida`); con `franjas: false`, ninguna. `reparto()` (`esfuerzosBandas.ts:156`) las descarta sin avisar.
- **Por qué no lo veían las pruebas:** `esfuerzosBandas.test.ts` compila con `franjas: false`.
- **Alcance:** las bandas ya no están en la app (fase F); quedan para el agente como cortes de comprobación.
- **Corrección propuesta:** sembrar las caras de banda que `carasFranjas` no cubre, o avisar en `estacionesBanda`; y que `reparto` avise de lo que deja fuera.

**AU-6 · Bandas: en la cara de salida de un apoyo, my y mxy se muestrean dentro del apoyo.** CONFIRMADO.
- **Dónde:** `esfuerzosBandas.ts:195` toma siempre `s − δ`; el comentario de las líneas 193-194 dice que se toma del lado del vano, pero el código no mira el lado.
- **Escenario:** banda `L:1:P2`, apoyo [5,85, 6,15]: en 5,85 my = −16,67 (en el vano); en 6,15 las muestras caen en 6,149, dentro del apoyo, y dan my = −14,78 (−11 %), mxy 0,22 frente a 0,27. El mx (exacto) no cambia; sí el Wood–Armer de esa cara.
- **Corrección propuesta:** `s + δ` en la cara cuyo apoyo queda en s menores, como hace `esfuerzosFranjas.ts` con `lado`.

**AU-7 · Cortes: una lámina atravesada con el centroide fuera del rectángulo se descarta en silencio.** CONFIRMADO.
- **Dónde:** `src/motor/cortes.ts:436-445`: el descarte por centroide va antes de la comprobación de que el plano atraviesa la lámina.
- **Escenario:** placa de 2 × 2 con malla regular hasta y = 1 e inclinada por encima; corte en x = 1 con y ∈ [0, 1 + h/5]. Por fuerzas nodales sale `valido: true` sin diagnóstico y con `extension.y = [0, 1]`; con y ∈ [0, 1 + 1,2h], `corte/atraviesa-laminas`. Por campos no se activa el modo mixto y se mezclan fuerzas nodales con la integral de la lámina atravesada en el mismo nudo (lo que C2-2 quiso evitar): 0,10–0,26 % entre la suma de dos rectángulos complementarios y el corte entero.
- **Alcance:** hace falta que todas las láminas atravesadas dentro del rectángulo tengan el centroide fuera; sólo en rectángulos cortos junto a una transición de malla.
- **Corrección propuesta:** comprobar el cruce antes del descarte por centroide, o avisar `corte/borde-no-sigue-malla`.

**AU-8 · `Cortes.cortar` y `FuerzasNodales` confían en que `casos` sea la lista entera y en orden.** CONFIRMADO. Riesgo de API.
- **Dónde:** `fuerzasNodales.ts:98-130` y `:171-230` usan la posición en el array del llamante como índice de `modelo.casos` para las cargas equivalentes; `cortes.ts:272` y `:386` no comprueban nada.
- **Escenario:** `losaUnidireccional(6, 2)` con los casos «q» y «otras»; corte en x = 2 pasando sólo el segundo caso: Vz = 2,1578 en vez de −5,8422, `valido: true`, sin diagnóstico.
- **Alcance:** ningún llamante del repositorio lo hace hoy; importa para la integración en Concreta y para el agente.
- **Corrección propuesta:** exigir la misma longitud y los mismos ids, con `motor/error-interno` si no.

**AU-9 · Barras: con empotramiento parcial (0 < α < 1), el diagrama de desplazamientos no cierra en j'.** CONFIRMADO. Latente.
- **Dónde:** `src/motor/barras.ts:489-491` y `cargasBarra.ts:139-156`: el diagrama integra la curvatura de la sección real desde el giro del nudo, pero la rigidez de CY2 es la mezcla Σ wₖ·Kₖ, que no es la de ninguna barra física. Los esfuerzos sí son correctos.
- **Escenario:** viga de 4 m, 30 × 50, `empotramiento: { i: 0,5 }`, uniforme y puntual, j articulado: `desplazamientosEn(L)` da uz = 5,9e-4 m y ry = −1,5e-4 rad donde el nudo tiene 0 (8,8e-4 m con α = 0,3). Con α = 1 cierra a 1e-19.
- **Alcance:** los únicos consumidores son las flechas de vigas y viguetas (`agente/consultas.ts:389-394`, `sensatezResultados.ts:225-238`) y el compilador sólo pone α en la cabeza del último tramo de pilar. Hoy no sale ningún número erróneo.
- **Corrección propuesta, verificada:** un diagrama por juego (con sus liberados recuperados) mezclado con los pesos wₖ por `DiagramaBarra.combinar`; cierra a 1e-19. Mínimo: marcar los desplazamientos como no válidos cuando hay mezcla.

**AU-10 · Láminas: el motor acepta sin aviso cuadriláteros casi degenerados.** CONFIRMADO.
- **Dónde:** `src/motor/laminas.ts:95-110` sólo exige convexidad estricta y planitud.
- **Escenario:** nudos (0,0), (1,0), (2, 1e-4), (0,2), un ángulo de 179,99°: calcula con `valido: true` y sin diagnósticos.
- **Alcance:** las mallas del compilador ya llevan `malla/calidad`; afecta a modelos analíticos hechos a mano (agente, oráculos, integración).
- **Corrección propuesta:** aviso `modelo/lamina-mal-condicionada` con el jacobiano normalizado mínimo o el ángulo interior (`JACOBIANO_BAJO`).

**Pendiente ya decidido, no fallo · los ábacos con casetón perdido pesan el `pp` del aligerado.** `validar.ts:598` y `:614`: `ppAbaco = l.pp ?? γ·espesor`, y con casetón perdido `pp` es obligatorio. MA-b (`modelado.md` §2.3) ya decidió que `pp` sea el de la zona aligerada y los ábacos γ·h; está planificado en MA3. En el muestrario faltan unos 100 kN sobre 34,6 m² de ábacos (−39 % de su peso); la vivienda lo compensa con 21 cargas a mano. La hipótesis dice el valor que se aplica. Al hacer MA3, revisar a la vez el peso esperado de `sensatez.ts`.

### 3.3 Leves

| Id | Dónde | Qué pasa | Estado |
|---|---|---|---|
| AU-11 | `motor/calcular.ts:119` | Dos casos con el mismo id se aceptan; quien indexe por id pisa uno con otro. El compilador ya lo rechaza (`fisico/id-duplicado`). | CONFIRMADO |
| AU-12 | `motor/calcular.ts:457` | Dos desplazamientos impuestos en el mismo GDL: vale el último, sin aviso. | CONFIRMADO |
| AU-13 | `motor/gdl.ts:170` | `coartados` acepta cualquier valor verdadero: `"false"` coarta. Sólo modelos a mano. | CONFIRMADO |
| AU-14 | `motor/barras.ts:146` | Una liberación que no sea el booleano `true` se ignora. Sólo modelos a mano. | CONFIRMADO |
| AU-15 | `motor/laminas.ts:329-330` | Una carga puntual de lámina sin `F` ni `M` no hace nada y no avisa. | CONFIRMADO |
| AU-16 | `motor/barras.ts:304-307`, `laminas.ts:216-219` | Una carga sobre una barra o lámina que existe pero no se pudo preparar dice «inexistente». Sólo el mensaje. | CONFIRMADO |
| AU-17 | `motor/solucion.ts:9` | La cabecera dice que §2.7 exige un residuo ≤ 1e-10, pero por E1-2 es sólo un aviso y el equilibrio decide. Sólo documental. | PLAUSIBLE |
| AU-18 | `motor/campos.ts:1095-1099` | La fuerza de borde de Kirchhoff se cuenta dos veces cuando h < t (la DKMQ ya resuelve la capa límite): el corte por campos se queda en 0,7–1,1 %. Con las mallas de obra (h ≥ t) no afecta. | CONFIRMADO |
| AU-19 | `compilador/resultados.ts:119` | Con `factorZonaRigida: 0`, el par de la losa se reparte también en el nudo de un pilar (±5 % en el My de la viga junto a él). No es lo de por defecto. | CONFIRMADO |
| AU-20 | `agente/sensatezResultados.ts` | La cuerda de la flecha de un vano arranca en el extremo del tramo flexible, no en la cara. Sólo un aviso de sensatez. | PLAUSIBLE |
| AU-21 | `compilador/fisico.ts:178` | `empotramiento.cabeza` de un pilar se multiplica por la opción (0,3): no se puede empotrar la cabeza de un solo pilar. Documentado. | CONFIRMADO |
| AU-22 | `compilador/cargas.ts:763-781` | El solape muro–losa (C3-g) se descuenta con la cuenta del plano medio; con RV-b, un muro que arranca de la cimentación deja de descontar γ·t·e/2 por metro en su cabeza. Conservador. | PLAUSIBLE |
| AU-23 | `compilador/fisico.ts:489` | D4 aplica A ×2 también a los pilares de acero; la justificación es del hormigón. Coincide con lo decidido («todos los pilares»). | CONFIRMADO |
| AU-24 | `compilador/arreglo.ts:33`, `:269`, `:350` | La cabecera dice que los ejes de las vigas no se mueven, pero la regla 2 los dobla (3 cm junto a un punto de muro); y un vértice puede moverse hasta ~2·ε_snap (6,9 cm con 5 cm, avisado en `losa/ajuste`). La barra no se ve afectada (usa la recta real). | CONFIRMADO |
| AU-25 | `compilador/compilar.ts:108` | La huella de compilación cambia con el `nombre` de una planta o un pilar: renombrar obliga a recalcular. | CONFIRMADO |
| AU-26 | `compilador/anchosVigas.ts`, mallador | Con `refinoEsquinas: false` (malla LV1), la cara del ancho queda doblada 0,3–1,7 cm respecto a `mapeo.anchos` en 7 de las 24 retículas. Con LV2, ninguna. | CONFIRMADO |

## 4. Lo revisado y sano

- **Barras:** Timoshenko 12 × 12 y paso a Euler; modificadores; offsets rígidos (rigidez, desplazamientos y fuerzas consistentes); reglas de inestabilidad de las liberaciones frente a det K_rr; condensación y recuperación con signo coherente; pesos bilineales del empotramiento parcial y equilibrio de cada término; FER derivadas a mano en los dos planos con el término de cortante; integración exacta de los diagramas con saltos; J del rectángulo, círculo, T e I; muelles.
- **Láminas:** placa distorsionada con los ocho multiplicadores, girada 25,7° con `eje1` girado: invariante a 5e-14. Patch test de MacNeal–Harder con multiplicadores y eje 1 a 30°, en flexión y membrana: exacto. Signos con la normal hacia −Z como la cabecera. Cargas de superficie, línea y puntuales exactas en fuerza y momento; degeneraciones y alabeo detectados.
- **Núcleo:** restricciones por transformación (diafragma, enlace, cadenas, ciclos, esclavo doble); impuestos a través de un diafragma y de una cadena (núcleo y perfil a 4e-19); muelle a tierra en un GDL esclavo; reacciones sin doble cuenta; el equilibrio usa las resultantes reales de las cargas, no las equivalentes, así que un fallo de FER no se cancela; `equilibrio/no-cumple` y `resultado/no-finito` invalidan; `calcular` nunca lanza por un dato del modelo; límites de ecuaciones y memoria.
- **Recuperación:** g = k·u − f_eq y cadenas desde las hojas; cortes con impuestos y con empotramiento cierran a 6e-14; convenio de signos y transporte de momentos; SPR con normales en ajedrez (7,5e-14) y con láminas anisótropas de `eje1` girado (por campos en una línea de la malla, los mismos bits que por fuerzas nodales); índice espacial sin omisiones.
- **Lectura de resultados:** orden de tramos de pilar y estaciones; vanos, apoyos y cruces de vigas; reacciones de pilar y muro sin doble cuenta; signos de las muestras en ejes de franja (losa en una dirección: mx 46,0 / 44,3 frente a qL²/8 = 45); Wood–Armer en 20 000 ternas, ninguna insegura frente a Johansen; envolventes por combinación entera; tablas 4.1 y 4.2 del CTE, ψ por categoría, 100/30 sísmico.
- **Construcción del modelo:** el control sin pérdidas compara con los polígonos físicos, no con lo repartido (vivienda y muestrario a 0,00 % de una cuenta a mano); transporte de los momentos de SP-5, zonas rígidas, palanca y empujes; ejes de las cargas locales; zonas rígidas con ZR1, LV-d y RV-b; valores por defecto iguales a los del CLAUDE.md; todas las opciones resueltas entran en la huella; campos desconocidos anidados; RV-a y C4-k sólo donde dicen; `compilar` nunca lanza.
- **Mallado:** un comprobador independiente de la malla final (aristas usadas ≤ 2 veces, sin nudos colgantes, convexidad y orientación, bordes sobre lo dibujado, Σ áreas = área de la región), validado con defectos inyectados, pasó en 400 combinaciones (geometrías de G, retículas al azar con y sin muros, losas y forjados al azar, edificio objetivo, muestrario y vivienda, con `eje`/`cara`/`rejilla: false` y h de 0,25 a 1,5) sin ningún defecto. Las dos tolerancias actúan donde dicen; los respaldos del mallador acaban en error, nunca en una malla incompleta; el refinamiento de Delaunay termina y no pone puntos en huellas ni fuera de la losa.

## 5. Huecos de validación

1. El comprobador de conformidad y cobertura de la malla no está en el repositorio: llevarlo a `src/pruebas/` como test.
2. Las bandas no tienen ninguna prueba con `franjas: true` (AU-5) ni del lado de las muestras en una cara (AU-6).
3. `invalidos` no tiene un apoyo lineal sin destino (AU-1), ids de caso o impuestos repetidos, ni `coartados` o liberaciones no booleanos (AU-11 a AU-14).
4. No hay prueba del diagrama de desplazamientos con α < 1 (AU-9); `posicion()` no tiene ni prueba ni consumidor.
5. La batería de cortes no tiene impuestos, empotramiento parcial ni láminas con la normal invertida.
6. `validar` mide las proximidades a 1e-9 (losa–losa, hueco–contorno, lados no contiguos) donde el arreglo actúa a ε_snap: de ahí AU-2 y AU-3.
7. Ninguna referencia congelada mide el peso de los ábacos con casetón perdido y `pp`, ni la hipótesis de peso propio dice qué pesa el ancho de una viga plana en un aligerado (AU-4).
8. `malla/lado-perdido` acepta un lado con algún subtramo en la malla, no todos; sin reproducir.
9. No hay oráculo de placa gruesa (a/t ≤ 5) con cortante anisótropo, ni de la J de la sección en T.

## 6. Orden propuesto

1. AU-1 (el apoyo perdido), con su entrada en `invalidos`.
2. AU-2 y AU-3: proximidades a ε_snap en `validar`, con mensajes de modelo.
3. AU-4: decisión del usuario (mantener y decirlo, o descontar con el peso de cada lado).
4. AU-7 y AU-8: guardas de los cortes antes de la integración en Concreta.
5. AU-5 y AU-6, si las bandas siguen en uso por el agente.
6. AU-9 y AU-10, y los leves del motor (AU-11 a AU-16), como guardas de entrada.
7. Los huecos 1 a 5 de §5 como pruebas.

Los scripts de reproducción de esta auditoría quedaron en la carpeta temporal de la sesión y no se versionan; cada hallazgo de §3 describe su escenario para rehacerlo.

## 7. Correcciones (2026-10-25)

Hechos los puntos 1 a 4 de §6, en ese orden. Compilador **AU1** (cambia el peso propio de los aligerados y los paños con vigas, AU-4).

- **AU-1, hecho.** `piezas.ts`: un apoyo lineal en una planta sin losas ni muros da el error `apoyo/sin-destino` («no apoya ningún nudo. Apoye los pilares o las vigas con apoyos puntuales»). Entrada nueva en `invalidos-c2` (el apoyo de la base llevado a la planta de cimentación, sin losa).
- **AU-2 y AU-3, hechos.** `validar.ts` mide las proximidades a ε_snap, con mensajes de modelo:
  - **hueco–contorno y hueco–hueco** a menos de ε_snap: `fisico/valor-no-valido` de la losa, con la distancia y qué hacer (hacer del hueco un entrante del contorno, unir los huecos o separarlos);
  - **ranura o lengüeta** (dos lados no contiguos de un mismo anillo a menos de ε_snap y frente a frente a lo largo de más de ε_snap): el mismo error, con los lados. El «frente a frente» (`solapeParalelo`) es lo que deja fuera un escalón: un lado corto entre dos (3 cm en el contorno) no da error, porque sus vecinos no se solapan;
  - **dos losas** de la misma planta con un lado de cada una frente a frente a más de ε_geom y menos de ε_snap: error nuevo `losa/casi-juntas` con los dos ids («si van unidas, dibújelas tocándose; si hay una junta, sepárelas más de ε_snap»). Los lados que se tocan (≤ ε_geom) se unen a sabiendas, y dos losas que se tocan con un escalón de 2 cm junto al contacto no dan error. **Queda fuera** el caso de dos esquinas a menos de ε_snap sin lados frente a frente: el arreglo las une en un punto, como si se tocaran.
  - Probado: cuatro entradas nuevas en `invalidos-c2` y, a mano, que no saltan el escalón entre losas, el escalón en el contorno, los huecos a 6 cm ni un contorno circular de 128 lados. Ningún modelo de la batería ni los tres proyectos de `ejemplos/` cambian.
- **AU-4, decidido y hecho: descontar con el peso de cada lado.** A la viga se le quita, por lado cubierto, lo que esa mitad de su ancho ya pesa como forjado: (b/2)·pp, sin pasar de γ·(b/2)·min(h, t) (C2-g). El pp es el de la losa, el del ábaco si el lado cae en uno (los ábacos parten los tramos como los bordes de las losas) o el del paño. Así el ancho de una viga pesa γ·b·h en cualquier forjado, que es lo que es: hormigón macizo.
  - **Por qué:** mantenerlo y decirlo dejaba del lado inseguro entre un 4 % y un 8 % del peso propio de un recuadro con vigas planas, en silencio salvo para quien lea la hipótesis. Que la vivienda cuadre con CYPECAD a +1,0 % no prueba que CYPE haga lo mismo: en esa cuenta hay otros términos (los ábacos de MA3, compensados a mano), y las comparaciones con CYPE de la vivienda tienen el modelo por debajo de CYPE (0,89–0,96 en momentos), no por encima.
  - **En una maciza con su pp (γ·t), los mismos bits:** se toma lo de C2-g salvo que (b/2)·pp sea menor a 1e-9.
  - Lo replican igual la sensatez de A3 (`ppLosa`, `pesoLibre`: el peso esperado sigue siendo el del cálculo a 1e-9) y la bajada tributaria. Las hipótesis de peso propio de las losas y de los paños lo dicen.
  - Prueba `src/compilador/pesoAncho.test.ts`: añadir una viga plana de 50 × 30 a un recuadro de 6 × 6 aumenta el peso propio en γ·b·h·L − b·Σ pp·ℓ a 1e-9 en maciza (dos espesores), reticular con casetón perdido, recuperable, recuperable con un ábaco que la viga cruza y paño; con la regla de antes fallan los cuatro forjados aligerados.
  - **Medido** (peso propio total, regla de antes → AU1): vivienda 2 160,8 → 2 204,6 kN (+2,0 %; frente a CYPECAD, de +1,0 % a ≈ +3 %); muestrario 5 606,6 → 5 691,3 kN (+1,5 %); edificio reticular de 2 × 3 × 2 vanos, 3 056,7 → 3 245,3 kN (+6,2 %), y unidireccional, 2 749,8 → 2 931,8 kN (+6,6 %), por sus vigas de borde de 30 × 50 bajo el forjado.
  - **Referencias congeladas regeneradas a sabiendas** (`validacion/au/out_cambiosPeso.txt`): cambian 17 de 38, todas con un aligerado, un paño o la maciza de pp 4,3 < γ·t de `aleatorio-3`, y sólo por el peso (de +2,8 % a +10,5 % del caso de peso propio). Con la regla de antes puesta a mano y lo demás de esta tanda, las 56 pruebas de C3, C4, C5 y F salen idénticas: AU-1, AU-2, AU-3, AU-7 y AU-8 no mueven ningún bit. Rehechos con la regla nueva el oráculo a mano del paño de C4 (`validacion/c4/mano.ts`) y la cuenta del peso de `forjados.test.ts`.
  - **De paso:** un ábaco de fachada que se sale de su losa quitaba peso a la viga de borde también fuera de la losa; ahora el lado de la viga sólo cuenta el ábaco dentro de su losa (en el compilador y en la sensatez).
  - Al hacer MA3 (ábacos a γ·h con casetón perdido), esto se ajusta solo: el lado en un ábaco quita su pp.
- **AU-7, hecho.** `cortes.ts`: una lámina atravesada con el centroide fuera del rectángulo cuenta si el tramo del plano en ella entra en él más de 10·TOL_CORTE (`atraviesaDentro`, el mismo recorte que `IntegradorCampos.integrar`).
  - **Por campos,** el corte pasa a mixto (entero por campos): dos rectángulos complementarios suman el corte entero a 1e-6, la tolerancia del recorte (antes, 1,7e-3).
  - **Por fuerzas nodales,** aviso `corte/borde-no-sigue-malla` con las láminas («le falta lo que pasa por ellas hasta el extremo»), no error. Probé primero el error que proponía §3.2: las franjas cortan la recta entera de una cara y usan sólo lo que pasa por los nudos de la ventana de cada pilar, que es exacto aunque los extremos de la recta no sigan la malla; con el error, `pilares-mezclados` perdía la estación de cara de un pilar en dos franjas. Con el aviso, sale bit a bit.
  - Las láminas con el centroide dentro siguen igual. Pruebas en `cortes-mixtos.test.ts` (el escenario de §3.2).
- **AU-8, hecho.** `defectoCasos` (`fuerzasNodales.ts`): los resultados tienen que ser los de todos los casos del modelo, en su orden. `Cortes.cortar` devuelve si no un corte no válido con `motor/error-interno`, y los métodos de `FuerzasNodales` que toman resultados lanzan (como ya hacían con una lámina que no existe); las listas comprobadas se recuerdan. Prueba en `cortes.test.ts` con el escenario de §3.2 (un caso suelto y la lista al revés).
- **Siguen abiertos:** los puntos 5 a 7 de §6 (AU-5, AU-6, AU-9 a AU-16 y los huecos de §5).
