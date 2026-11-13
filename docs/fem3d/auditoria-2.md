# Segunda auditoría del motor y el compilador (2026-11-12)

## 1. Alcance y método

- **Qué se auditó:** corrección y fallos silenciosos (un resultado erróneo presentado como válido), no estilo ni rendimiento. Es la continuación de `auditoria.md` (2026-10-25); sus hallazgos AU-1…AU-26 no se repiten aquí salvo para decir cómo están.
- **Nueve parcelas,** cada una leída entera por un auditor, con más cuidado en lo cambiado desde el commit `6779d1d` y en lo que entonces no existía:
  - P1 barras (`src/elementos/barra.ts`, `cargasBarra.ts`, `tramos.ts`, `src/motor/barras.ts`, `diagramaCompuesto.ts`, `src/secciones/`);
  - P2 láminas y núcleo (`dkmq.ts`, `membrana.ts`, `lamina.ts`, `src/motor/laminas.ts`, `gdl.ts`, `ensamblado.ts`, `solucion.ts`, `equilibrio.ts`, `calcular.ts`, `src/solver/`, `src/nucleo/`, `kernel/src/`);
  - P3 recuperación (`fuerzasNodales.ts`, `cortes.ts`, `indice.ts`, `campos.ts`, `casosEfimeros.ts`);
  - P4 dinámica y segundo orden (`modal.ts`, `espectral.ts`, `ncse02.ts`, `sismo.ts`, `segundoOrden.ts`): nunca auditado;
  - P5 acciones y combinaciones (`viento.ts`, `nieve.ts`, `emplazamiento.ts`, `src/normas/`, `src/combinaciones/`, `envolventes.ts`): viento, nieve y emplazamiento, nunca auditados;
  - P6 lectura de resultados (`resultados.ts`, `consultas.ts`, `esfuerzosFranjas.ts`, `esfuerzosBandas.ts`, `esfuerzosMuros.ts`, `woodArmer.ts`, los pésimos de `src/agente/consultas.ts`);
  - P7 construcción del modelo (`compilar.ts`, `fisico.ts`, `validar.ts`, `piezas.ts`, `topologia.ts`, `puntoFijo.ts`, `barras.ts`, `huella.ts`, `mapeo.ts`…);
  - P8 losas, cargas, forjados y muros (`losas.ts`, `cargas.ts`, `unidireccional.ts`, `abacos.ts`, `bordes.ts`, `pesoForjado.ts`, `muros.ts`, `anchosVigas.ts`);
  - P9 geometría y mallado (`arreglo.ts`, `poligonos.ts`, `mallado.ts`, `rejilla.ts`, `franjas.ts`, `bandas.ts`).
- **Método:** cada sospecha se reprodujo con un script contra una solución analítica, un invariante o una cuenta independiente antes de darla por hallazgo; lo no reproducido va como **plausible**. El hallazgo grave y los medios los repitió además el coordinador con el script de su auditor (columna «Rep.» de §3: **sí** = vuelto a ejecutar; **salida** = sólo vista la salida guardada; **código** = confirmado leyendo el código; **no** = sólo el auditor). No se tocó el repositorio salvo este documento.
- **Presupuesto:** la auditoría se cortó dos veces por el límite de uso y varias parcelas entregaron sin terminar. Lo que quedó sin mirar está en §6, y no debe leerse como «sano».
- **Gravedad:** grave = resultado erróneo que compila y calcula sin aviso, en un caso que un usuario puede dibujar; medio = caso no cubierto con un error poco claro, un resultado dudoso, un riesgo de API o un error del lado inseguro acotado; leve = sin efecto en los resultados por defecto, documental o sólo en modelos a mano.
- **Línea base:** ver §7.

## 2. Veredicto

- El motor (elementos, restricciones, solución, masas, modos, espectro, combinación modal) y la conservación de cargas del compilador cuadran con cuentas independientes a precisión de máquina; la malla no tiene ningún defecto de conformidad en 1 696 combinaciones.
- Sale **un hallazgo grave** (A2-1): estaciones de franja de armado con NaN que pasan por válidas y dan armado 0, en el camino por defecto.
- Salen **17 medios**. Los que tocan el camino por defecto y quedan del lado inseguro son A2-2 (las franjas de paso suman menos momento que el equilibrio), A2-4 y A2-5 (segundo orden con sótano o con la ±0,00 fuera de la cimentación), A2-6 (dos casos de sobrecarga de la misma categoría) y A2-7 (una carga de superficie perdida con sólo un aviso).
- El resto son leves (§3.3).
- **Segunda ronda (§10):** lo que había quedado sin mirar se auditó después. No añade ningún grave; añade nueve medios (A2-47 a A2-55) y once leves. Total: 1 grave, 26 medios y 39 leves.

## 3. Hallazgos

### 3.1 Grave

**A2-1 · Estaciones de cara «válidas» con my y mxy = NaN: el armado de Wood–Armer sale 0 arriba y abajo, sin aviso.** CONFIRMADO. Rep.: sí.
- **Dónde:**
  - `src/compilador/esfuerzosFranjas.ts:386` (`porCampos`): los quiebres son `[...bordes, ...ventanas.flat()]`, sin quitar repetidos;
  - `:481-486` (`estacion`): `valido` sólo mira los pesos, no que los medios sean finitos;
  - `:324-326` (`envolvente`): con NaN, las comparaciones `>` descartan la estación en silencio;
  - raíz en `src/motor/cortes.ts`: un corte por campos con dos quiebres iguales dentro de una lámina crea un tramo de longitud nula y devuelve muestras de peso 0 con M = NaN; el My del corte es NaN con `valido: true` y sin diagnóstico.
- **Escenario:** un pilar con cara de franja centrado en su franja, de modo que el borde de su ventana F-h (centro ± b/2) coincide con un borde de franja. Es la losa plana de `franjas.test.ts` (pilares de 30 en retícula, vuelo de 0,5 m, franjas de 1 m). Se rompe la franja contigua a cada fila de pilares, en todas las rectas de cara.
- **Medido:**
  - losa de 3 × 3 vanos de 6 × 5 m: 36 de 2 591 estaciones de cara salen `valido: true` con my = mxy = NaN, y las 36 dan armado inferior 0 y superior 0 con combinación −1;
  - L:X2, s = 6,15: mx = −40,09 kN·m/m con 1,35G + 1,5Q y armado superior 0;
  - muestrario: 4 estaciones (L1:X7); vivienda: ninguna;
  - no se dispara con pilares de 50, con vigas de borde ni con el reticular probado (el quiebre repetido cae en un lado de lámina o no hay coincidencia). Que un reticular con el punto de paso en un pilar lo dispare es plausible, sin probar.
- **Efecto:** el fallo local es del 100 % (`fem consultar franja` da `superior: [0, ""]`). El máximo de la franja apenas baja en lo medido (−0,9 % como mucho, 39,97 frente a 40,32), porque lo cubren las estaciones de paso vecinas. El efecto en el mapa de armado y en las zonas de refuerzo no se midió.
- **Scripts:** `p6\nan2.ts`, `nan3.ts`, `nan4.ts`, `nan5.ts`.
- **Corrección propuesta:** quitar los quiebres repetidos (a EPS) en `porCampos`; en `Cortes`, ignorar los tramos de longitud nula; en `estacion`, `valido` sólo si los medios son finitos; en `envolvente`, un Wood–Armer no finito es estación no válida, no 0; y una prueba de que ninguna estación válida tiene medios no finitos.

### 3.2 Medios

**A2-2 · Las estaciones de paso de las franjas suman menos momento que el equilibrio.** CONFIRMADO. Rep.: sí. Limitación conocida (F-8), mayor de lo documentado.
- **Dónde:** `esfuerzosFranjas.ts:383-410`: los medios de paso salen sólo de las muestras SPR, también cuando la recta sigue la malla y el corte entero es exacto.
- **Medido** (Σ franjas de mx × ancho frente a la estática de un lado, que coincide con el corte por fuerzas nodales al céntimo):
  - losa plana 3 × 3 de 5 m, pilares de 50, h = 0,75: −7,4 % en el centro de vano (línea de malla), −18 % a 0,5 m de él; con h = 0,375, −2,0 % y −4,6 %;
  - reticular, h = 0,75: 0,92 en el centro de vano, 0,80–0,85 en rectas que no siguen la malla y 0,51 donde el momento es pequeño (19,2 frente a 37,9 kN·m); con h = 0,375, 0,98, 0,95 y 0,85.
- **Signo:** siempre menos momento positivo. El positivo de vano, que dimensiona la armadura inferior, queda del lado inseguro en torno al 7–8 % con la malla de obra. `fase-f.md` (F-8) dice «2–4 %».
- **Camino por defecto:** sí. Converge con h: es de la recuperación por campos, no de la lectura.
- **Scripts:** `p6\eq.ts`, `franjas1.ts`.
- **Corrección propuesta:** donde la recta de paso sigue la malla, repartir por fuerzas nodales como en las caras; o escalar los medios de paso para que su suma sea el corte exacto de la recta más cercana. Como mínimo, corregir F-8.

**A2-3 · La cobertura mínima de una estación de apoyo no se aplica en una de las dos caras de una viga.** CONFIRMADO. Rep.: sí.
- **Dónde:** `esfuerzosFranjas.ts:938-952`: `tramosLosa(ln.s)` resta entero el ancho de la viga en una de sus caras, `enLosaF = 0` y `w ≥ 0,5·enLosaF` pasa siempre.
- **Escenario:** vigas de borde dibujadas una por vano (lo que hace por defecto la herramienta Viga), la losa hasta su cara de fuera y pilares de 30.
- **Medido:** reticular: L:X14 tiene una estación de apoyo con 0,100 m de losa de 0,800 y mx(Q) = −29,33 kN·m/m; su simétrica, 0,700 m y −5,51. Maciza: 0,369 de 0,956 m y −9,58 frente a −5,88. En una de las dos caras de la viga de borde, `tramosRectaLosa` devuelve `[]`.
- **Efecto:** dos franjas simétricas difieren hasta ×5; en lo medido, del lado seguro. El «momento por nervio» sale de una astilla de 10 cm.
- **Scripts:** `p6\apoyo.ts`, `sim.ts`.
- **Corrección propuesta:** medir el ancho en losa a ε del lado tomado, y juntar en una estación las líneas de apoyo de la misma s, lado y franja antes de aplicar la cobertura.

**A2-4 · Segundo orden: con un sótano sujeto en horizontal, Q sale diluido.** CONFIRMADO. Rep.: sí.
- **Dónde:** `src/compilador/segundoOrden.ts:98-101`: z₀ es la cota más baja con apoyo horizontal y M_H se mide desde ahí.
- **Escenario:** dos plantas de 2 × 2 vanos (A) y las mismas sobre un sótano de 3 m con el techo sujeto en ux y uy (B; apoyos puntuales en lugar de muros, que no se midieron).
- **Medido:** M_H 360 → 600 kN·m, C(G) 0,02009 → 0,01338, Q máx. 0,0271 → 0,0181, con B desplazándose un 8,7 % más. Con z₀ en el techo del sótano, C(G) de B sería 0,02230.
- **Camino por defecto:** sí. Lado inseguro, sin aviso; puede dejar sin saltar `segundo-orden/traslacional`. SO-d fija z₀ «en los apoyos horizontales más bajos» y no menciona los sótanos.
- **Script:** `p4\sotano.ts`.
- **Corrección propuesta:** z₀ por hipótesis, en el nivel más alto bajo el cual sus desplazamientos son despreciables, o la rasante. Como mínimo, un aviso con coacción horizontal en más de una cota.

**A2-5 · Segundo orden con el sismo del programa: M_H depende del origen de cotas.** CONFIRMADO por el auditor. Rep.: código.
- **Dónde:** `segundoOrden.ts:125`: `MH = sup.valor(zF) − z0·V` combina Σz·F y ΣF por separado; la combinación modal no es lineal.
- **Medido:** edificio de 3 plantas con la ±0,00 en la primera planta (z₀ = −3): M_H 8 702,9 frente a 8 570,6 (+1,54 %) y Q 0,06371 frente a 0,06469. El viento estático es invariante.
- **Camino por defecto:** sí con z₀ ≠ 0. Lado inseguro, acotado.
- **Script:** `p4\so.ts`.
- **Corrección propuesta:** una sola llamada, `sup.valor(f, b => e·zF[b] − z0·(e·F[b]))`.

**A2-6 · Dos casos de sobrecarga de la misma categoría nunca van los dos a 1,5.** CONFIRMADO. Rep.: sí.
- **Dónde:** `src/combinaciones/generador.ts:196-201` y `:254-281`: cada caso variable sin familia es un grupo propio y sólo uno es principal.
- **Medido:** G + Q1 + Q2 (los dos `uso-A`): como mucho 1,35·G + 1,5·Q1 + 1,05·Q2. Pilar con NG = 600 y NQ1 = NQ2 = 150: 1 192,5 frente a 1 260 (−5,4 %); ELS característica, 855 frente a 900. Con la misma `familia` son excluyentes, que es peor.
- **Camino por defecto:** no (un caso por categoría). Lado inseguro, sin aviso, y sin documentar.
- **Script:** `p5\c1_combinaciones.ts`.
- **Corrección propuesta:** un grupo simultáneo para los casos Q con el mismo ψ nombrado; como mínimo, un aviso de sensatez. Entre categorías distintas, decide el usuario.

**A2-7 · Una carga de superficie cuya zona cae entera fuera de las losas se pierde con sólo un aviso.** CONFIRMADO. Rep.: sí.
- **Dónde:** `src/compilador/cargas.ts:883`, `if (!(A > 0))`: para polígonos disjuntos, `momentosInterseccion` devuelve ruido positivo (8,9e-16).
- **Escenario:** una zona entera dentro del hueco de una losa habiendo otra losa en la planta, o pegada por fuera al borde de una losa sola, con otra carga en el mismo caso.
- **Medido:** compila; los 12,8 kN desaparecen y queda el aviso `carga/zona-fuera-de-losa`. Con una losa sola y la zona en el hueco sí sale el error `carga/fuera-de-losa`. Si es la única carga del caso, salta `cargas/perdidas` («Es un fallo del compilador»).
- **Script:** `p8\cg4.ts`, `cg3.ts`.
- **Corrección propuesta:** umbral relativo (`A > 1e-9·Az`), y la misma guarda en los paños.

**A2-8 · Una viga que pasa a menos de ε_snap de la cara de un pilar, sin tocarlo, se une a él sin aviso.** CONFIRMADO. Rep.: sí.
- **Dónde:** `src/compilador/topologia.ts:325`: une y no emite `topologia/fusion`.
- **Medido:** viga a 0,16 o 0,19 m del eje de un pilar de 30 intermedio: `valido: true`, cero diagnósticos y la viga partida en dos barras de 2,925 m con un brazo rígido al pilar. A 0,20 m, una barra de 5,85 m y el aviso `topologia/casi-encuentro`.
- **Camino por defecto:** sí. `compilador.md` dice que ε_snap es «fusión con aviso»; las demás fusiones avisan.
- **Script:** `p7\t1_topologia.ts`.
- **Corrección propuesta:** aviso `topologia/fusion` con la distancia cuando `d − semi > epsGeom`.

**A2-9 · Barras entre niveles (CB-f): zona rígida donde no hay pilar, y dependiente de los ids.** CONFIRMADO. Rep.: sí.
- **Dónde:** `src/compilador/piezas.ts:427-441`: la huella del nudo se usa como un prisma vertical sin límite, y el material es el de `pp.pilares[0]` (el de menor id).
- **Medido:**
  - tornapuntas que sube desde la cabeza de un pilar de 40 que acaba ahí: 1,217 m rígidos de 3,041 m (rigidez axil ×1,67), sin avisos;
  - hormigón abajo y HEB arriba en el mismo nudo: 0,25 m rígidos con unos ids y ninguno con los ids cambiados. «Renumerar» puede cambiar el modelo.
- **Script:** `p7\t2_barras.ts`.
- **Corrección propuesta:** aplicar CB-f sólo si hay un tramo de pilar de hormigón del lado por el que sale la barra, con su huella y su material.

**A2-10 · Un mecanismo de giro en planta puede pasar por válido, y el equilibrio no lo ve.** CONFIRMADO. Rep.: sí.
- **Dónde:** `src/motor/solucion.ts:27` y `:213-218` (el pivote se mide contra `K_jj`) y `src/motor/equilibrio.ts:53-80` (la escala del equilibrio es Σ|k·u|, que crece con u).
- **Escenario:** losa de láminas sin diafragma, apoyos sólo uz salvo un único punto fijo en horizontal, miles de ecuaciones.
- **Medido:** 8 de 36 modelos salen `valido: true` con sólo `solver/mal-condicionado`; con una carga excéntrica sin equilibrio posible, max|u_h| de 1e9–1e10 m con «equilibrio» de 1e-12. Con pilares y diafragma el pivote cae en el maestro y se detecta siempre (40 de 40).
- **Camino por defecto:** no en edificios normales. No se montó con `compilar`.
- **Scripts:** `p2\t2d_giro_libre.ts`, `t2c_pivotes.ts`, `t1b_diafragma_azar.ts`.
- **Corrección propuesta:** un equilibrio referido también a las cargas (|ΣF| ≤ ~1e-6·Σ|cargas|), error si max|u| supera un múltiplo grande del tamaño del modelo, y medir el pivote contra la escala de su redondeo.

**A2-11 · La puntual del viento cae en el eje de una viga y le deja un cortante lateral que no existe.** CONFIRMADO. Rep.: sí.
- **Dónde:** `src/compilador/viento.ts:364-366` con `cargas.ts:822` y `:854-859`: `topo.localizar` va antes que SP-5.
- **Medido:** edificio de 12 × 9 m con vigas en todos los ejes: Vy = 21,1 y 26,3 kN en la viga central (fuerza de planta 26,1 y 36,4 kN). Con la fuerza deslizada sobre su recta, Vy = Mz = 0 y los mismos desplazamientos.
- **Camino por defecto:** sí, con una viga por la mitad del fondo. Lado seguro; no toca desplazamientos, pilares ni reacciones. No se miró si los pares del sismo pasan por el mismo camino.
- **Script:** `p5\v2_punto.ts`.
- **Corrección propuesta:** una puntual sólo horizontal sobre una viga de un diafragma rígido, al nudo del diafragma con su Mz, como SP-5.

**A2-12 · Una carga puntual justo en el borde de un ancho o de una tira da `carga/sin-destino`.** CONFIRMADO. Rep.: sí.
- **Dónde:** `src/compilador/losas.ts:804`: `anchosPunto` exige `distanciaABorde > epsGeom`.
- **Escenario:** una puntual en el borde de una losa enrasada con la cara de fuera del zuncho (una carga en la línea de fachada), en el borde o el vértice de una tira, o en la diagonal del inglete.
- **Medido:** «no cae sobre ningún pilar, nudo, viga, losa…». No se pierde carga. Las lineales sí lo contemplan. Es plausible que apoyos puntuales y extremos de barra hagan lo mismo (sin comprobar).
- **Script:** `p8\tb3.ts`.
- **Corrección propuesta:** si el punto está a ≤ ε_geom del borde de un ancho, llevarlo a ese ancho.

**A2-13 · Cortes: una barra con cargas cortada en la zona rígida de su extremo lejano rompe el equilibrio del corte.** CONFIRMADO. Rep.: sí.
- **Dónde:** `src/motor/cortes.ts:677-682`: fuera del tramo flexible se toma siempre −g del nudo del lado A.
- **Medido:** pórtico de `validacion/e5/cortes.ts`: en x = 4,79, Vz = 18,549 y My = 0,058; en x = 4,90 (offset de j, sin carga entre los dos), Vz = −23,751 y My = 110,5. En 40 modelos al azar, los 21 cortes de este tipo fallan y los otros 884 cierran a ≤ 1,9e-12.
- **Camino por defecto:** no. Las franjas usan `soloLaminas`; sólo lo alcanzan las bandas del agente (deducido leyendo).
- **Scripts:** `p3\s2_offset.ts`, `s1_equilibrio.ts`.
- **Corrección propuesta:** mirar qué tramo de i → i′ → j′ → j cambia de lado; si es el offset del nudo B, +g_B. Añadir el caso a `cortesCompletos()`.

**A2-14 · Corte por campos: el cortante sale hasta el doble en un corte que acaba en un borde apoyado.** CONFIRMADO. Rep.: sí.
- **Dónde:** `src/motor/campos.ts:813-836` (`bordesLibres`): un lado con apoyo, enlace o barra no lleva la fuerza de borde de Kirchhoff.
- **Medido:** placa de 6 × 6 apoyada en uz, t = 0,25: con h = 0,75, Vz = −43,4 frente a −23,1 (+88 %) y hasta +135 %; con h = 0,125, +5…+9 %. Con la fuerza de borde puesta, ≤ 4 % con h ≥ 2t y −8…−20 % con h ≤ t. El My no cambia.
- **Relacionado, AU-18:** ya no es «0,7–1,1 %»: en una placa sobre cuatro esquinas, con h ≤ t la fuerza de borde sobra un 4–6,5 %, y sin ella falta un 13–37 % con h ≥ t.
- **Camino por defecto:** no (sólo Vz y T de cortes por campos: las estaciones de vano de las bandas del agente y la API). Leyendo el código, pasa igual en un borde sobre una viga; sin medir.
- **Scripts:** `p3\s6_borde_apoyado.ts`, `s7_au18.ts`.
- **Corrección propuesta:** documentar ya el límite; después, poner la fuerza de borde donde sólo está coartada uz o la recoge una barra o un enlace, graduada con h/t.

**A2-15 · Una planta a más de 3–10 km del origen no compila, con un error que parece interno.** CONFIRMADO por el auditor. Rep.: salida.
- **Dónde:** el validador de área de `mallado.ts:1597-1601` y el control sin pérdidas de `cargas.ts`, con coordenadas sin recentrar.
- **Medido:** hasta 1 km, la misma malla; a 3 km falla el primero; desde 10 km, todos con `cargas/perdidas` («Es un fallo del compilador»); desde 30–100 km, `malla/area`.
- **Alcance:** nunca sale una malla mala. Afecta a coordenadas UTM escritas a mano o por el agente; la app ya trae al origen un DXF lejano.
- **Script:** `p9\lejos.ts`.
- **Corrección propuesta:** recentrar las cuentas en la caja de la planta, o un error de modelo claro en `validar`.

**A2-16 · Una losa que cabe entera en el ancho de una viga más sus tiras da `cargas/perdidas`.** CONFIRMADO por el auditor. Rep.: salida. Causa sin mirar.
- **Medido:** losa de 10 × 0,5 m sobre una viga de 30: error relativo 0,566 en fuerzas, «Es un fallo del compilador». Sin la viga compila.
- **Script:** `p9\limites.ts`, caso 20.

**A2-17 · Corte mixto: una lámina que toca el plano sólo en un vértice desaparece.** CONFIRMADO en modelos al azar. Rep.: no.
- **Dónde:** `cortes.ts:553` con `campos.ts:922-932`.
- **Medido:** dos rectángulos complementarios no suman el entero (0,30 del mayor esfuerzo en un caso, 0,41 en otro). Fuera de estos casos, suman a ≤ 2,2e-4.
- **Camino por defecto:** sólo si un paso de franja por campos cae justo en un nudo de esquina de la losa; sin mirar en modelos compilados.
- **Script:** `p3\s9_complementarios.ts`.

**A2-18 · Un recuadro con zunchos girado 30° y `tirasBorde: false` no compila.** CONFIRMADO. Rep.: sí. Causa sin mirar.
- **Medido:** recuadro de 10 × 6 con zunchos de 30: `malla/triangulacion: … (Infinite loop: no further intersect after non-convex). Es un fallo del compilador`. Con 17°, y con las tiras de borde (por defecto), no pasa.
- **Script:** `p8\tb2.ts`.

### 3.3 Leves

| Id | Dónde | Qué pasa | Estado |
|---|---|---|---|
| A2-19 | `motor/calcular.ts:216-228` | `cargas.zF` (SO) omite los momentos de empotramiento: con una puntual a 0,75 m de la base de un pilar de 3 m, 5,625 frente a 9 (−37,5 %); triangular, +5 %. El viento del programa no pasa por ahí. | CONFIRMADO (rep.) |
| A2-20 | `motor/calcular.ts:444-463` | El equilibrio no ve un error de u autoequilibrado; lo vería ω, y ω > 1e-10 es sólo un aviso. No se logró disparar. Amplía AU-17. | PLAUSIBLE |
| A2-21 | `motor/solucion.ts:279-290` | El refinamiento por grupos para con el máximo del grupo. Sólo actuaría con ω > 1e-12, que no se da. | PLAUSIBLE |
| A2-22 | `segundoOrden.ts:114-125` | Una hipótesis horizontal con `direccion` sólo cuenta esa componente: un viento a 45° declarado «X» da Q = 0,0367 en vez de 0,0523; uno sólo en Y declarado «X» no se amplifica y no hay diagnóstico. | CONFIRMADO |
| A2-23 | `segundoOrden.ts:170` | Q negativo (G hacia arriba) desamplifica: γz de 0,974 a 0,994, sin aviso. | CONFIRMADO (rep.) |
| A2-24 | `consultas.ts:946-950`, `espectral.ts:246-248` | La θ del art. 3.8 toma la altura entre cotas consecutivas: en la vivienda, h = 0,90 m para la cubierta `escalon`. Sólo afecta al aviso. | CONFIRMADO |
| A2-25 | `consultas.ts:1005` | El aviso `sismo/segundo-orden` dice que «este cálculo es de primer orden», y por defecto ya va amplificado. | Documental |
| A2-26 | `nieve.ts:124-158` | La frontera de la zona de clima invernal no llega a los diagnósticos ni a la hipótesis (el viento sí tiene `viento/zona-frontera`). Villarcayo: sk 0,30 con la zona de Burgos; 0,90 con la que `provincias.ts` da para Merindades. La nieve no genera cargas. | CONFIRMADO |
| A2-27 | `normas/provincias.ts:153-156` | «Vélez-Málaga» se toma por la capital (se parte por el guion). Sin efecto numérico hoy. | CONFIRMADO |
| A2-28 | skill `fem` | Cuatro vientos a mano sin `familia` dan 24 combinaciones con W+X y W−X a la vez. Lado seguro. La skill no nombra `familia`. | CONFIRMADO (rep.) |
| A2-29 | `viento.ts:289`, `:326` | Viento con `fachadas` escritas y sin geometría: fondo 0, esbeltez 0, cp − cs = 1,0 y e = 0, sin aviso. | CONFIRMADO |
| A2-30 | `combinaciones/generador.ts:169-188` | Llamado directamente, calla con un tipo desconocido o un ψ NaN, y lanza un TypeError opaco con `direccion: "Z"`. Por el compilador no llega. | CONFIRMADO (rep.) |
| A2-31 | `cargas.ts:165-210` | C2-g/AU-4 mira el lado a b/4: un borde de losa entre el eje y la cara de una viga deja sin contar γ·t·b/4 por metro como mucho (−3,1 kN en el ejemplo), o lo cuenta de más. | CONFIRMADO |
| A2-32 | `abacos.ts:257-278` | La unión de ábacos se encadena: dos interiores en diagonal y los de esquina macizan los 36 m² de una losa de 6 × 6. Con el aviso `reticular/abacos-unidos`; conservador en peso. | CONFIRMADO |
| A2-33 | `validar.ts` | `pp: 0` en un reticular y `relleno.pesoPieza: 0.88` (kN por kg) compilan sin aviso. | CONFIRMADO |
| A2-34 | `topologia.ts:190`, `piezas.ts:154` | Dos pilares apilados con los ejes a 5 cm justos se unen o no según el redondeo; si no, `pilar/arranque-sin-apoyo`. | CONFIRMADO |
| A2-35 | `topologia.ts` | Dos pilares de 30 a 6 cm en las mismas plantas compilan sin aviso (a 4 cm, error). Probado sin losa. | CONFIRMADO |
| A2-36 | `barras.ts:19`, `piezas.ts:429` | Barra casi vertical: el convenio de ejes y la zona rígida saltan con una componente horizontal de 1e-9 m. En lo probado acaba en error. | CONFIRMADO |
| A2-37 | `mallado.ts:1590` | Láminas de lado < 5 mm lejos de los pilares sin aviso en 60 de 1 696 combinaciones (con las opciones por defecto, la planta triangular y dos losas al azar). Efecto en los resultados, sin medir. | CONFIRMADO |
| A2-38 | `losas.ts` (`aLasCaras`) | Una viga dibujada hasta 1 cm antes de la cara de un pilar deja 458 láminas de menos de 5 mm. Con avisos. | CONFIRMADO |
| A2-39 | mallador | Una viga a 2° del borde de la losa deja 11 nudos de su cara sin enlace. Con `malla/calidad`. Causa sin analizar. | CONFIRMADO |
| A2-40 | `cortes.ts:716-720` | `soloEsclavos` con una cadena enlace → enlace contaría dos veces. El compilador no genera esas cadenas (0 en 13 modelos). | PLAUSIBLE |
| A2-41 | `campos.ts:1374-1377` | `plaza()`/`nodales()` toman N de la región de membrana de la primera lámina. Documentado; los mapas y los cortes no lo usan. | Lectura |
| A2-42 | `cargasBarra.ts:253-258` | Los puntos donde q se anula dentro de un tramo no son estación: con una trapezoidal de signo cambiante, el extremo de Vz, Vy o N se queda corto (p90 0,6–1,3 % del extremo). No se comprobó si el compilador emite alguna. | CONFIRMADO |
| A2-43 | `diagramaCompuesto.ts:470-510` | Con sismo, el máximo de My por estaciones queda ≤ 0,69 % bajo (0,37 % de qL²/8) en barras de vano entero. | CONFIRMADO |
| A2-44 | `secciones/perfiles.ts:48-71` | El It de algunos HEA es un 1–3 % menor que el que el auditor recordaba de las tablas (sin fuente consultada). Copiado de Concreta. | Por cotejar |
| A2-45 | `franjas.ts:136-147` | Las franjas de un reticular simétrico no lo son en los bordes (1,20 y 0,40 m). Dentro de lo documentado. | CONFIRMADO |
| A2-46 | `rejilla.ts` | `malla/sin-rejilla` por `malla/conformidad` en la retícula 3 con muros y h = 0,25: el respaldo actúa y avisa, y la malla pasa el comprobador. Sin estudiar. | CONFIRMADO |

## 4. Lo revisado y sano

- **Barras:** la barra entera frente a ella misma partida en 377 casos (offsets, liberaciones, Timoshenko y Euler, cargas parciales, ejes locales y globales) a ≤ 3,5e-7, el condicionamiento del modelo partido; equilibrio diferencial del diagrama a 4,8e-13. AU-9 en 527 modelos: cierre a 4,8e-15. `DiagramasBarras` perezoso, bit a bit en cualquier orden. `DiagramaCompuesto` en 17 350 lecturas frente a la regla a mano: 1,2e-15. 87 perfiles en su banda geométrica y 14 con Iy e Iz de catálogo a 0,00 %.
- **Láminas y núcleo:** las guardas de AU-10 a AU-16 no rechazan de más en lo probado. `ResultadoCaso.cargas`: F exacta y P·δ con el desplazamiento del nudo físico a ≤ 4e-16. Restricciones en cadena con muelle e impuestos frente a barras muy rígidas (Δu/u ≈ 2e-5). Casos de 1e-6 y 1e6 kN en un mismo cálculo, cada uno lineal a 9e-16. Rigidez 24 × 24 con 6 autovalores nulos exactos. Los mecanismos sin apoyo horizontal se detectan hasta 100 000 ecuaciones.
- **Recuperación:** 884 cortes completos en 40 modelos al azar cierran a ≤ 1,9e-12 (salvo A2-13). El índice espacial da los mismos bits que la búsqueda exhaustiva en 3 800 cortes; lo mismo en orden inverso y con `soltarCasos` y `soltarEvaluador` intercalados. SPR con muestras sintéticas: reproduce su grado a ≤ 6e-13, Λ máxima 9,18 y ninguna partición toma el campo de la otra.
- **Dinámica:** masas, centro de masas e inercia a 9e-16 de la cuenta a mano. Modos frente a `scipy.linalg.eigh` con K y M montadas a mano: periodos a ≤ 3,3e-15. Espectro frente a las fórmulas en 300 emplazamientos: diferencia 0 (VS3-1 es correcto). Combinación modal, cortantes, fuerzas equivalentes y torsor a ≤ 1e-15 de `Consultas.sismo()`. `Superposicion` en 300 casos al azar: 4e-14. γz = 1/(1 − ΣγC) a 2e-16, independiente del orden de los casos.
- **Acciones y combinaciones:** tablas D.2, 3.4, 3.5, E.2 y 3.8 iguales a las del auditor. Tres plantas a mano a 1e-12. Trasladar, girar 90° e invertir el orden no cambia las fuerzas. Equilibrio de los 8 casos a ≤ 5e-10. 16 municipios con su ab y K. Un generador ingenuo de combinaciones no supera al del repo en 4 000 variables al azar por situación; ninguna combinación con dos vientos.
- **Lectura de resultados:** Wood–Armer en 100 000 ternas frente a una implementación propia (diferencia 0) y a Johansen (déficit 4e-16). `woodArmerPesimo` igual a la fuerza bruta de los 8 signos. Σ anchos de las franjas = ancho de la losa. Estaciones reflejadas e intercambio X ↔ Y al 0,00 % en mallas simétricas.
- **Construcción del modelo:** unos 600 cambios de campos y opciones: ninguno cambia el modelo analítico sin cambiar la huella. `compilar` no muta su entrada. Zonas rígidas (RV-b, LV-d, ZR1), CY-b y D4 como dicen las decisiones, al mm.
- **Losas y cargas:** en unas 60 configuraciones con las opciones cruzadas, la resultante analítica coincide con una cuenta física propia a < 1e-6 kN: tiras de borde, AU-4 cruzado, cargas que cruzan huecos, anchos y ábacos, la carga `borde`, el peso propio calculado (diez reticulares), la unión de ábacos y el unidireccional.
- **Mallado:** un comprobador independiente, validado con 10 defectos inyectados, pasó 1 696 combinaciones (106 modelos × 16 juegos de opciones): ningún nudo colgante, grieta, solape ni cara sin enlace; los únicos defectos son los de AU-26, con `refinoEsquinas: false`. 52 casos límite sin bucles ni excepciones.

## 5. Huecos de validación

1. Ninguna prueba exige que una estación de franja válida tenga medios finitos (A2-1), ni compara Σ franjas de paso con la estática (A2-2), ni la cobertura en las dos caras de una viga (A2-3).
2. El comprobador de la malla sigue sin estar en el repo (hueco 1 de la auditoría anterior). El de esta vez, con sus defectos inyectados, sirve de base.
3. No hay una cuenta física independiente de `poligonos.ts` para el control sin pérdidas, ni una prueba sistemática de «cambia el modelo ⇒ cambia la huella».
4. Segundo orden: ninguna prueba con z₀ ≠ 0, con sótano, con `direccion` que no casa ni con Q < 0. `zF` sin prueba con cargas de barra no simétricas.
5. Combinaciones: ninguna prueba con dos casos Q de la misma categoría.
6. Cortes: `cortesCompletos()` sin una barra cargada cortada en el offset lejano; ninguna batería de equilibrio sobre modelos al azar; ninguna prueba del Vz por campos con bordes apoyados ni con quiebres repetidos.
7. Motor: ninguna prueba con un mecanismo único de giro en planta ni de que una carga sin equilibrio posible dé `equilibrio/no-cumple` cuando u se dispara.
8. Topología: la viga que pasa junto a un pilar sin tocarlo. Barras: un nudo con pilar sólo por un lado o de dos materiales, y el mismo modelo con los ids permutados.
9. Cargas: zona disjunta de las losas con más losas o más cargas; puntual en el borde de un ancho o de una tira.
10. Mallado: una planta lejos del origen; lado mínimo fuera de las huellas.
11. Diagramas: extremos por estaciones frente a un muestreo fino, lineal y compuesto.
12. Siguen los huecos 4 (`posicion()`), 5, 8 y 9 de la auditoría anterior.

## 6. Sin mirar

**Sustituido por §10.5:** casi todo lo de esta lista se midió en la segunda ronda. Lo que quedó sin comprobar en la primera:

- **Muros:** peso, solape C3-g (AU-22), empujes, huecos, machones y dinteles.
- **Lectura:** `EsfuerzosPiezas` y los pares de la losa, reacciones (sospecha sin reproducir: la base coartada de un pilar sobre la línea de un apoyo lineal podría contarse en los dos), desplomes y flechas con μ y γz, el escalón de las franjas (PB-8, PB-11) frente a un cálculo independiente, las bandas, y los pésimos del sismo con números.
- **Compilador:** el fuzz de entradas no válidas (no terminó), la independencia de ids y el giro de la planta con barras y punto fijo, `mapeo.ts`, HR, `aLasCaras`, los apoyos a viga y los pilares apeados.
- **Mallado:** el determinismo (orden, ids, giro, ruido de ε_geom), el fuzz de `poligonos.ts` y `geometria2d.ts`, y el hueco 8 (`malla/lado-perdido`).
- **Dinámica:** sótano con muros de verdad, dos diafragmas en una cota, los casos efímeros de VS4.
- **Combinaciones:** ELU accidental y la amplificación de segundo orden sobre las combinaciones con fuerza bruta propia.

## 7. Línea base

`bunx vitest run src`: 209 ficheros y 2 928 pruebas (16 omitidas), en 329 s.

- **Un fallo real, en HEAD:** `src/pruebas/textos.test.ts`. La leyenda de `fem consultar pieza` (commit `930f367`) dice «tipo CSI» en `src/agente/consultas.ts`, y la prueba no admite nombres de software comercial en los textos. No es del motor ni del compilador.
- **Dos fallos por tiempo, no reales:** `src/visor/i4.test.ts` (60 s) y el `beforeAll` de `src/visor/visor.test.ts` (120 s) se agotan dentro de la batería entera y pasan a solas (107 pruebas en 131 s). Con la batería completa en paralelo van justos de tiempo.
- El resto, en verde.

## 8. Abiertos de la auditoría anterior

- **AU-1 a AU-16:** corregidos; sin regresión en lo que se volvió a medir (AU-4, AU-7, AU-8 y AU-9).
- **AU-17:** igual; A2-20 lo amplía.
- **AU-18:** igual en el código, y mayor de lo que se dijo (A2-14).
- **AU-19, AU-20 y AU-22:** sin mirar.
- **AU-21, AU-23, AU-24, AU-25 y AU-26:** igual que estaban.
- **Huecos 1, 4, 5, 8 y 9 de su §5:** abiertos.

## 9. Orden propuesto

1. A2-1 (el NaN de las franjas), con su prueba.
2. A2-7 (la carga perdida) y A2-8 (la fusión sin aviso): arreglos pequeños en el camino por defecto.
3. A2-4 y A2-5 (segundo orden), antes de usar el armado de pilares.
4. A2-2 (las franjas de paso frente al equilibrio): decide el usuario entre repartir por fuerzas nodales, escalar o documentarlo.
5. A2-6 (dos sobrecargas de la misma categoría): decide el usuario.
6. A2-3, A2-9, A2-11 y A2-12.
7. A2-10 (el mecanismo de giro) y A2-13, A2-14 y A2-17 (cortes), antes de la integración en Concreta.
8. A2-15, A2-16 y A2-18 (errores que parecen internos).
9. Los huecos 1 a 3 de §5 como pruebas, y lo de §6.

Los scripts de reproducción quedaron en la carpeta temporal de la sesión (`…\scratchpad\au2\p1` a `p9` y `r1` a `r6`) y no se versionan; cada hallazgo describe su escenario para rehacerlo.

## 10. Segunda ronda (2026-11-13): lo que había quedado sin mirar

Seis auditores más cubrieron el §6: muros (R1), piezas, reacciones y desplomes (R2), el escalón de las franjas y las bandas (R3), fuzz e invariancias del compilador (R4), determinismo de la malla y polígonos (R5), y dinámica y combinaciones (R6). Mismo método. **No sale ningún hallazgo grave nuevo; salen nueve medios y varios leves.** El §6 de arriba queda sustituido por §10.5.

### 10.1 Lo medido sobre hallazgos de la primera ronda

- **A2-1 (el NaN de las franjas), su efecto en el mapa y los refuerzos.** Rep.: sí. En la losa plana de `franjas.test.ts`, 18 tramos de 0,125 × 1 m por armadura salen a 0 (2,25 m² de 304), con vecinas de hasta 74,5 kN·m/m en la superior. Las zonas de refuerzo pierden 0,5–2 m² de área; el número de zonas sólo cambia en un caso (y-sup con base 20: 18 frente a 16) y el máximo y la longitud de cada zona no cambian. Sigue siendo grave por definición (un valor erróneo dado por válido), con efecto pequeño en lo medido.
- **A2-4, confirmado con muros perimetrales de verdad.** Rep.: no. z₀ es la base de los muros; C(G) baja a 0,61 de su valor con viento y a 0,64 con sismo. El θ del art. 3.8 no se diluye (0,0254 frente a 0,0237), así que las dos medidas de segundo orden del programa discrepan en el mismo edificio.
- **A2-11, acotado al viento.** El sismo no pasa por puntuales: |Vy| ≤ 1,8e-11 kN en todas las vigas.
- **A2-18, más amplio: falla también con las opciones por defecto** (A2-52).
- **A2-7, general:** `momentosInterseccion` da A > 0 en el 13 % de 4 387 parejas de polígonos disjuntos o tangentes (hasta 9,1e-13 m²). El otro uso sin umbral es `cargas.ts:876` (paños).
- **AU-22, medido** (A2-58). **AU-19, más estrecho:** sólo con `factorZonaRigida: 0` y `unionLosaViga: "eje"`.

### 10.2 Medios nuevos

**A2-47 · Las reacciones por objeto cuentan dos veces los nudos coartados compartidos.** CONFIRMADO por dos auditores. Rep.: sí.
- **Dónde:** `src/compilador/consultas.ts:809-838` (`nudosReaccion`): un muro toma todo nudo coartado de su base y un apoyo lineal, todo nudo coartado a ε_snap de su polilínea, sin mirar si otro objeto ya lo tiene. Llega a `fem consultar reacciones` y a la tabla «Cargas en cimentación» del informe. Los `totales` de la consulta son correctos.
- **Medido:** núcleo en U de tres muros y 3 plantas: G 1 991,2 frente a 1 895,1 kN (+5,1 %); viento en X, −219,4 frente a −180 (+22 %); viento en Y, una resultante vertical de −126,3 kN que no existe. Losa sobre dos apoyos lineales por las bases de los pilares: 828,2 frente a 468,0 (+77 %). Pilar + muro no comparten nudo.
- **Camino por defecto:** sí, sin aviso en la consulta. No se miró si las reacciones dibujadas en la app lo heredan.
- **Scripts:** `r2\nucleo.ts`, `r2\reac.ts`, `r4\t5_uniones.ts`.
- **Corrección propuesta:** dar cada nudo a un solo objeto o repartirlo, y una prueba de Σ objetos = totales. Antes de dimensionar zapatas con esa tabla (CO).

**A2-48 · El cortante del dintel de un muro sale bajo en q·(ancho de columna)/2.** CONFIRMADO. Rep.: sí.
- **Dónde:** `src/compilador/esfuerzosMuros.ts:218-231`: lo que entra en el nudo de la cara desde fuera del muro se atribuye entero al machón.
- **Medido:** 20 kN/m sobre una puerta de 2 m: 15,0 frente a 20 (−25 %) con h = 0,75 y 0,5; −12,5 % con 0,25; −6 % con 0,125. Puerta de 1 m: 5 frente a 10 (−50 %). En el centro, −5 donde es 0. El momento en la cara es exacto.
- **Camino por defecto:** sí. Lado inseguro, sin aviso. El test del repo sólo comprueba antisimetría.
- **Scripts:** `r1\dintel2.ts`, `r1\machones.ts`.
- **Corrección propuesta:** sumar en las caras la mitad de lo que entra en los nudos del corte desde fuera, o dar el cortante por equilibrio del dintel.

**A2-49 · Con una ventana, los machones no suman el muro y no lo dicen.** CONFIRMADO. Rep.: sí.
- **Dónde:** `esfuerzosMuros.ts:174-190`: los machones se parten en toda la planta pero se cortan en las cotas de planta, donde el muro es continuo.
- **Medido:** ventana de 2–4 × 1–2 en un muro de 6 m: en la base, ΣN = −187,4 frente a −220 (−15 %) y ΣVy = 34,1 frente a 60 (−43 %). Con puerta, exacto.
- **Corrección propuesta:** cortar el machón en los bordes del hueco, o marcar esos cortes como sección parcial.

**A2-50 · PB-11 quedó a medias: los enlaces de la tira se pierden si no tocan la recta base.** CONFIRMADO por el auditor. Rep.: salida.
- **Dónde:** `src/motor/cortes.ts:721`: las restricciones se buscan con el índice del plano, y los enlaces pedidos en `esclavos` que quedan a más de su diámetro (≈ b/2) de la base se descartan sin diagnóstico.
- **Escenario:** pilar de esquina alargado según una viga de borde (30×50 o 30×80 con la esquina fija, 30×70 centrado), o cualquier malla fina.
- **Medido:** el corte incluye 0 de los enlaces pedidos; el metro del 30×80 con h = 0,75 da +8,40 kN·m/m donde con toda la tira saldría −4,95 (cuenta propia del auditor). No converge. Magnitud de unos kN·m/m en una tira de 0,35 m.
- **Camino por defecto:** sí, sin aviso.
- **Scripts:** `r3\escalon.ts`, `r3\k1.ts`.
- **Corrección propuesta:** tomar de la lista las restricciones nombradas, y exigir que entren todas las pedidas.

**A2-51 · La zona rígida de una viga cuyo eje corre por la cara de un pilar depende del redondeo.** CONFIRMADO. Rep.: sí.
- **Dónde:** `src/compilador/topologia.ts:548-549` (`cuerdaHuella` sin tolerancia) y `geometria2d.ts:91-92`.
- **Escenario:** pilares con `fijo: "mitad-…"` o una esquina y la viga dibujada por sus puntos fijos (lo que hace V2c-d).
- **Medido:** pórtico de 2 vanos: My = −75,10 sin trasladar y −72,24 trasladado (10; −10) o (0,7; 0,7) (3,9 %); zona rígida 0 o 0,10 m. Con losa, hasta el 7,5 % en el momento del pilar. Con `fijo: "centro"` no pasa.
- **Script:** `r4\t3b_cara.ts`.
- **Corrección propuesta:** decidir la regla del eje en la cara y aplicarla con ε_geom; añadir el modelo a las metamórficas.

**A2-52 · Un recuadro girado con zunchos de borde no compila con las opciones por defecto.** CONFIRMADO por el auditor. Rep.: salida.
- **Dónde:** `src/compilador/mallado.ts:1075-1105` (la triangulación restringida y su respaldo).
- **Medido** (recuadro de 10 × 6, pilares de 30 girados con la planta, barrido de 0° a 90° cada 1°): con la losa enrasada con la cara de fuera del zuncho fallan 16 de 91 ángulos; con la losa a 0,20 m del eje, 24; a 0,50, 14; a 0,60, 9. A 0,27 (la tira se lleva la franja) y a 1,00, ninguno. Con `tirasBorde: false` y 0,27, 37. Con los pilares sin girar, 1. Siempre `malla/triangulacion … Es un fallo del compilador`.
- **Causa** (caso de 30° sin tiras): puntos de un borde girado colineales sólo a ~1e-16 dejan triángulos de área nula que constrainautor no atraviesa; el respaldo usa la misma librería. Que sea el mismo mecanismo en los fallos por defecto es plausible.
- **Sin medir:** si falla igual con coordenadas redondeadas al mm, que es lo que da un dibujo real. Las geometrías de G y las retículas giradas 37° sí compilan.
- **Scripts:** `r5\a4.ts`, `r5\a4b.ts`.
- **Corrección propuesta:** llevar a su recta común los puntos de un mismo trazo antes de triangular, o quitar de las restricciones las aristas que ya están. Prueba: este barrido.

**A2-53 · Un ruido de ±ε_geom/3 cambia la malla en 9 de 12 modelos.** CONFIRMADO por el auditor; causa sin aislar. Rep.: no.
- **Medido:** ret7 pasa de 1 995 a 3 344 nudos (flecha −2,0 %, reacciones 1,05 %); ret16, de 4 093 a 5 983 (−0,7 %, 1,2 %); los demás, de 1 a 150 nudos y ≤ 0,3 %. Una retícula con muros dio «cálculo no válido» con el ruido: dudoso, hay que repetirlo.
- **Camino por defecto:** sí, para un dibujo con restos de 1e-7. Contradice la regla del mallador.
- **Scripts:** `r5\det.ts`, `r5\det2.ts` (éste, sin acabar: separa por amplitud y por lista).

**A2-54 · Con un apoyo lineal que llega a una viga, la malla cambia al trasladar la planta.** CONFIRMADO por el auditor; causa sin analizar. Rep.: no.
- **Medido:** 838, 860, 866 u 872 nudos según la traslación; sin el apoyo lineal, 800 en todas. Esfuerzos de pilares ≤ 0,7 %.
- **Script:** `r4\t3b_cara.ts`, `r4\t3_giro.ts`.

**A2-55 · Un empuje fuera de la altura del muro se recorta sin aviso, o da carga 0.** CONFIRMADO. Rep.: sí.
- **Dónde:** `src/compilador/muros.ts:585`, `validar.ts:691`. Las z son sobre la base del muro.
- **Medido:** z de −1 a 3, 99,4 kN en vez de 132,5, sin aviso; de 0 a 4, 166,9, sin aviso; de −5 a −1, 0 kN con `valido: true` y sólo `muro/ajuste`.
- **Script:** `r4\t1b_sondas.ts`.
- **Corrección propuesta:** error si [z0, z1] no corta el muro; aviso con la parte perdida si sobresale.

### 10.3 Leves nuevos

| Id | Dónde | Qué pasa | Estado |
|---|---|---|---|
| A2-56 | `esfuerzosFranjas.ts:871`, `:948` | Una franja pasa por un pilar de borde sin cara, sin apoyo y sin `franja/pilar-sin-cara` (1 de 384 en ocho retículas). | CONFIRMADO |
| A2-57 | `esfuerzosFranjas.ts:590-603` | Junto a un pilar que asoma de su viga, 38 de 1 285 estaciones toman my y mxy a 2,5–5 cm de la cara, no a un canto (LV2-h). Efecto en \|mxy\|, sin medir. | CONFIRMADO |
| A2-58 | `cargas.ts:793-810` | AU-22 medido: con RV-b, cada cabeza de muro bajo losa pesa γ·t·e/2 por metro de más (+5,6 kN en un muro de 6 × 3 m); un muro apeado sobre una losa, eso de menos (−5 %). | CONFIRMADO |
| A2-59 | `esfuerzosMuros.ts:19-20` | Dintel bajo diafragma rígido: N, Vy y Mz salen finitos y válidos, no NaN como dice la cabecera (N = 0,21 frente a −12,16 sin diafragma). | CONFIRMADO (rep.) |
| A2-60 | `consultas.ts:795-803` | `machones` y `dinteles` devuelven siempre `valido: true` y sin diagnósticos del corte. No se logró un corte no válido. | PLAUSIBLE |
| A2-61 | `compilar.ts:158-196`, `validar.ts:292` | `compilar` llamado directamente: 164 de 4 617 mutaciones acaban en `compilador/error-interno` (listas que no lo son, elementos null, `materiales[i].tipo` no admitido). Ninguna excepción escapa. La CLI lo para antes. | CONFIRMADO (rep.) |
| A2-62 | `validar.ts:641`, `cargas.ts:710` | Por `compilar` directo, `pesoPropio` que no es `true` (1, "true") quita el peso propio sin aviso; `acciones: "x"` se ignora. La CLI lo rechaza. Importa para la integración. | CONFIRMADO (rep.) |
| A2-63 | franjas | Una estación de apoyo cambia al trasladar la planta (0,497 ↔ 0,554 en un reticular con vigas de borde). Sin causa. | CONFIRMADO |
| A2-64 | mallador | Con un giro de 30°, 137 nudos de un modelo con paño y reticular difieren 1e-7 a 3e-7 m. Resultados a ≤ 8e-8. | Nota |
| A2-65 | `segundoOrden.ts:171` | La etiqueta de una combinación amplificada lleva el factor de primer orden («0.9·W+X+e» con 0,9476). Ya apuntado en `segundo-orden.md`. | Documental |
| A2-66 | `muros.ts`, `cargas.ts` | Muros en T: el que acomete cuenta t²/2 de más (+1,3 %). Una viga que cruza un muro perpendicular no descuenta su tramo dentro del espesor. Conservador. | Nota |

### 10.4 Revisado y sano

- **Muros:** peso propio frente a una cuenta de volúmenes, exacto a 4 decimales con el plano medio (una y dos plantas, puerta, ventana, hueco que cruza el forjado, viga por el eje, L). Empujes frente a una integral propia: ≤ 5e-15 en 17 casos, con los dos lados. Equilibrio ≤ 5e-12; giro de 90° y traslación, idénticos. Machones con hueco desde la base: suma exacta.
- **Piezas:** pares de la losa conservados a ≤ 2,1e-12 en cada nudo, con voladizo y vano corto; cortante y extremos sin cambio; `vano()` no pierde máximos frente a 4 000 puntos. Desplomes y derivas a 1,7e-14 de la regla modal (modo a modo, ×μ), con las combinaciones amplificadas. Flechas de losa a 2,2e-16. Pésimos del sismo: cubren la fuerza bruta en 10 000 particiones y sin sismo dan la parte estática. Tramos de pilar con punto fijo: orden, cabeza y pie, y equilibrio, exactos.
- **Franjas y bandas:** el metro del pilar coincide con una cuenta sin `Cortes` a ≤ 1e-13 en 244 metros de 16 modelos (ninguno cuenta el maestro, dos veces la huella ni el enlace de otro pilar; la excepción es A2-50). Traslación, giro rígido de 90° y cambio de orden e ids: ≤ 1e-11 (salvo A2-63). Ninguna muestra fuera de la losa en 1 541 estaciones. Σ bandas = estática a 0,000 %.
- **Compilador:** barajar y renombrar ids en cinco modelos: mismo analítico (≤ 3,6e-15 m) y resultados a ≤ 1,2e-12. Traslación y giros de 90° a ≤ 1,2e-11 (salvo A2-51 y A2-54). Mapeo: cada barra en su pieza y tramo, [0, L] sin huecos. HR: 0 nudos rígidos fuera de la huella en 4 modelos nuevos. Pilares apeados: axil, momento y peso exactos. `aLasCaras`: ninguna lámina < 5 mm con el pilar desplazado 1–40 mm.
- **Mallado:** sin ruido, 12 modelos dan la misma malla con listas barajadas (0 exacto), ids renombrados (≤ 1,9e-14), traslaciones (≤ 1,1e-12) y giros de 90°, 180° y 37° (≤ 1,3e-13; la rejilla gira con la losa). `poligonos.ts` y `geometria2d.ts` frente a implementaciones propias: áreas, momentos, punto en polígono (0 discrepancias en 113 442 puntos), intersecciones y distancias.
- **Dinámica y combinaciones:** sótano con muros: la masa de su techo entra en los modos y las masas efectivas suman 1. Dos cubiertas a cotas distintas: masas, banda del viento, fuerzas y par a mano. Casos efímeros: 593 operaciones en 10 secuencias, 0 sha256 distintos. Fuerza bruta de combinaciones en ELU-ACC, GEO, GEO-SIS y los dos perfiles: no supera al generador. Amplificación: factor = generado·γz a 3,5e-16 en 1 289 y 1 444 combinaciones; gravitatorios intactos.

### 10.5 Lo que sigue sin mirar

- **Mallado:** la causa de A2-53 y A2-54; A2-52 con coordenadas al mm; el hueco 8 (`malla/lado-perdido`, sólo leído); el efecto de A2-37 (astillas lejos de pilares) en los resultados.
- **Muros:** muro sobre viga, pilar en un machón, machones en polilínea, `muros.ts` pasos 1, 2 y 4 (estaciones y mallado).
- **Franjas:** el escalón en pilares circulares o girados y en plantas no ortogonales; un reticular con el punto de paso en un pilar (A2-1); bandas con vigas y reticular.
- **Lectura:** viguetas con pares de la losa, barras BN en `pieza`, las reacciones dibujadas en la app (A2-47).
- **Compilador:** fuzz con valores extremos y sobre las opciones; `CASI_EN_CARA` en esquinas de quiebro.
- **Dinámica:** dos diafragmas en un nivel (sólo alcanzable con un modelo a mano), planta sin diafragma, z₀ con muros articulados.

### 10.6 Orden propuesto, revisado

1. A2-1 (NaN de las franjas), con su prueba.
2. A2-7 y A2-55 (cargas que se pierden) y A2-8 (fusión sin aviso).
3. A2-47 (reacciones dobles), antes de CO.
4. A2-4 y A2-5 (segundo orden con sótano o z₀ ≠ 0).
5. A2-52 (recuadro girado que no compila): primero medir con coordenadas al mm.
6. A2-48 y A2-49 (dinteles y machones).
7. A2-2 y A2-6: decide el usuario.
8. A2-50 y A2-51; A2-3, A2-9, A2-11 y A2-12.
9. A2-53 y A2-54: aislar la causa.
10. A2-10, A2-13, A2-14 y A2-17, antes de la integración; A2-61 y A2-62 con ella.
11. A2-15 y A2-16, y los huecos de §5 como pruebas.

## 11. Correcciones (2026-11-13)

Hechos los puntos 1 a 3 de §10.6 (A2-1, A2-7, A2-8 y A2-47). Ni la malla ni los casos cambian; las referencias congeladas de F y de C4 se regeneraron a sabiendas, sólo en lo que dice cada punto.

- **A2-1, hecho.** Raíz en el motor (`src/motor/campos.ts`): un quiebre repetido del corte por campos ya no crea un tramo de largo nulo (sus muestras tenían peso 0 y M = NaN). Además, regla de oro 2 en la lectura (`esfuerzosFranjas.ts`): una estación con algún momento medio no finito no es válida (error `franja/no-finito`), y en la envolvente un Wood–Armer no finito deja la estación en NaN, nunca en una demanda 0.
  - **Referencia congelada de F** (`validacion/f/out_cambiosA21.txt`): cambian 74 de 2 083 estaciones de cara y apoyo, todas las que daban 0/0, que pasan a su valor; la malla, los mx y las demás estaciones, idénticos. Confirma la sospecha del reticular: en `h25-reticular`, cuatro caras pasaban de 0 a 44,13 kN·m/m, el 98 % del máximo de su franja.
  - **Pruebas** (`franjas.test.ts`): ninguna estación válida con medios no finitos ni con demanda 0 por un NaN en la losa plana, y un corte por campos con quiebres repetidos da los mismos bits que sin repetirlos (falla con el motor de antes).
- **A2-7, hecho.** `cargas.ts`: la carga de superficie y la parte de un paño cuentan si su área supera 1e-9 del área de la zona, no si es > 0. Una zona entera fuera de las losas da el error `carga/fuera-de-losa` en los nueve escenarios del auditor (antes, tres perdían la carga con un aviso).
  - **Referencia congelada de C4** (`validacion/au2/out_cambiosA27.txt`): en 4 de 8 modelos desaparecen 90–97 cargas de barra y 4–5 nodales del caso Q, todas nulas (el resto de redondeo de la zona con paños que no toca, repartido a sus viguetas); las resultantes, iguales a 1e-14.
  - **Pruebas:** tres entradas nuevas en `invalidos-c2` (zona en el hueco, pegada por fuera y en el hueco con otra losa al lado); la de «pegada por fuera» falla con el código de antes.
- **A2-8, hecho.** `topologia.ts`: una viga que pasa a menos de ε_snap de la cara de un pilar sin tocarla se une a él con el aviso `topologia/fusion` y la distancia. Si toca la huella (la atraviesa, va por su eje o por su cara), sin aviso, como antes. Prueba en `topologia.test.ts`. Ningún modelo de las referencias congeladas lo da.
- **A2-47, hecho.** `Consultas.reacciones` (`consultas.ts`): un nudo coartado que reclaman varios objetos entra con su parte: el de un pilar o un apoyo puntual es suyo frente a un muro o un apoyo lineal, y entre objetos del mismo tipo (dos muros en L, dos apoyos lineales que se cruzan, un pilar y un apoyo puntual), a partes iguales. La resultante lleva `compartidos` y el diagnóstico `consulta/reaccion-compartida` (info), que `fem consultar reacciones` pasa. Con un solo dueño, los mismos bits.
  - **Medido:** en los escenarios del auditor (núcleo en U con y sin viento, losa sobre apoyos lineales por las bases, muros en L, apoyo lineal por un apoyo puntual, apoyos lineales que se cruzan), Σ objetos = Σ del motor en fuerzas y momentos.
  - **Pruebas** en `consultas.test.ts` (dos modelos; fallan con el código de antes). La tabla «Cargas en cimentación» del informe usa la misma consulta.
- **A2-5, hecho.** `segundoOrden.ts`: M_H se calcula respecto a z₀ en cada caso base y luego se combina, en vez de combinar Σ z·F y ΣF por separado (con el sismo, la combinación modal no es lineal). Con z₀ = 0, los mismos bits. Prueba en `segundoOrden.test.ts`: el edificio de SO con la ±0,00 en la primera planta da M_H y C a 1e-9 de los de antes (con el código de antes, 0,85 % en EX±e). El oráculo de OpenSees y la referencia de C5, igual.
- **A2-4, pendiente del usuario:** cambia el criterio del segundo orden (SO-d, confirmada el 2026-11-08: z₀ en los apoyos horizontales más bajos). Opciones en §3.2.
- **A2-48, hecho.** `esfuerzosMuros.ts`: el corte de un dintel sigue sin la losa ni la viga de la cota, pero la componente vertical de lo que entra en el muro por el nudo de la cota del corte (lo que ese nudo da a las láminas del muro, de todas sus plantas) se reparte a medias. Sólo en Vz: una fuerza vertical en ese nudo no da momento respecto al origen del corte, y lo horizontal que entra por él es del diafragma o de la losa, que el dintel no lleva (E5-1). El centro, si su recta sigue la malla, va por fuerzas nodales con el mismo reparto (los mismos números que por campos, más el nudo).
  - **Medido** (muro de 6 m con una carga lineal de 20 kN/m): el cortante en las caras es q·luz/2 exacto con cualquier malla (puerta de 2 m: 20 kN, antes 15 con h = 0,75; de 1 m: 10, antes 5), también con una ventana y con diafragma; en el centro, 0 (antes −5). Con una losa de 6 × 5 entre dos muros, de 22,1 a 20,3 kN al refinar (antes de 14,8 a 18,7). Con una carga que arranca justo en la cara queda un error O(h) (0,6 kN con h = 0,125: ese nudo sólo recibe carga de un lado).
  - **Lo que se descartó:** repartir también lo horizontal y los momentos. En ETABS 15c (carga horizontal, diafragma rígido) cambiaba un 31 % el N y un 35 % el My de los dinteles, que son la acción del diafragma como tirante; y contar sólo las láminas bajo la cota rompía el cortante constante de un dintel acoplado (lo que baja por el muro de encima no entra de fuera).
  - **Oráculo:** `oraculo_cortes.py` reparte el mismo nudo con las fuerzas de OpenSees (`EsfuerzosCorte.medioNudo`); ETABS 15c frente a OpenSees, con las mismas diferencias que antes (Vz ≤ 0,4 % con h = 10 in), y la referencia de C5, idéntica (sus dinteles no tienen carga vertical; `validacion/au2/out_cambiosA248.txt`).
  - **Pruebas** en `esfuerzosMuros.test.ts` (fallan con el código de antes); la de antes sólo comprobaba la antisimetría.
- **A2-49, pendiente del usuario:** dónde se corta un machón junto a una ventana (en el alféizar y bajo el dintel, como un «pier», o en las cotas como hoy, marcando que la sección es parcial).
- **A2-50, hecho.** `cortes.ts`: con `soloLaminas`, las restricciones nombradas en `restricciones` se toman por su id, no por el índice espacial del plano, que sólo da las que lo cortan o lo tocan (con su diámetro de margen). Los enlaces de la cara de la viga que pide el escalón de PB-11 entran aunque estén enteros del lado A, lejos de la recta base. En el pilar de esquina del auditor, el metro con h = 0,75 pasa de −0,24 a −3,61 kN·m/m (30 × 50) y de +8,40 a −4,95 (30 × 80, que tenía el signo cambiado): los valores de su cuenta propia con toda la tira. Ninguna referencia congelada cambia (ninguna tiene una tira de más de b/2). Prueba en `metroCaraEnViga.test.ts` (falla con el código de antes). El escalón sigue sin converger con el campo en esas caras (PB-12, conocido y aceptado).
- **A2-9, hecho.** `piezas.ts`: la zona rígida de CB-f en el extremo de una barra va con la huella y el material del tramo de pilar del lado por el que sale (el de encima si sube, el de debajo si baja, cualquiera de los dos si es horizontal). Una barra que sube desde la cabeza de un pilar que acaba ahí ya no lleva zona rígida (antes, 1,22 m de 3,04), y en un nudo con un pilar de hormigón abajo y uno de acero arriba el modelo ya no depende de los ids. Pruebas en `barras.test.ts` (fallan con el código de antes); la referencia de BN y el oráculo de PyNite, igual.
- **A2-11, hecho.** `cargas.ts`: una puntual sólo horizontal que cae en el eje de una viga de una planta con diafragma rígido (dentro de una losa) va al diafragma con su momento de transporte, como SP-5; antes iba a la viga como carga de barra y le dejaba un Vy y un Mz que no existen (21–26 kN en la viga central del edificio del auditor con el viento del programa). En un nudo, a ese nudo, como siempre. Los desplazamientos no cambian. Prueba en `diafragmaCargas.test.ts` (falla con el código de antes); las referencias congeladas, igual.
- **A2-12, hecho para las cargas.** `losas.ts`: una puntual sembrada que no toca ninguna lámina y está en el ancho de una viga o en su borde (la cara de fuera de un zuncho con la losa enrasada, el borde de una tira, su vértice o el inglete) va a la viga. Los seis escenarios del auditor compilan y conservan la carga. Prueba en `losas.test.ts` (falla con el código de antes). **Queda:** un apoyo puntual en la mitad de fuera del ancho de una viga de borde, a más de ε_snap de la losa, sigue dando `apoyo/sin-destino` en la topología (error claro; no pierde nada).
- **A2-55, hecho.** `muros.ts`: un empuje entero fuera de la altura del muro (sus z son sobre la base del muro; con cotas absolutas en un sótano, por debajo) es el error `muro/empuje-fuera`, y uno que sobresale lleva el aviso `muro/empuje-recortado` con lo que queda fuera. Antes, el primero cargaba 0 kN como válido y el segundo se recortaba en silencio. Prueba en `muros.test.ts` y entrada nueva en `invalidos-c3`.
- **A2-13, hecho.** `cortes.ts`: un corte que cruza una barra por un offset rígido toma lo del nudo cuyo offset cruza: −g del nudo del lado A si es el suyo, +g del nudo del lado B si es el del otro extremo (todo el tramo flexible, con sus cargas, queda entonces del lado A). Antes, siempre −g del nudo del lado A. En el pórtico de E5, los cortes por los dos offsets de la viga cargada y con las dos normales cierran el equilibrio a 1e-15 (antes, 0,53 y 0,69); en los 905 cortes al azar del auditor, ninguno malo. Cuatro cortes nuevos en `cortesCompletos()` (fallan con el código de antes); las referencias de C5 y F, igual.
- **A2-61 y A2-62, hechos.** `validar.ts` (`formaValida`): antes de la huella y de resolver ábacos, bordes y viento, `compilar` comprueba la forma del modelo (un objeto, sus listas, listas de objetos, contornos y huecos de losas y paños como listas de pares, las acciones como objetos), con los códigos de siempre (`fisico/no-valido`, `fisico/sin-id`, `fisico/valor-no-valido`). Un tipo de material desconocido ya no llega a `materialElastico`, `pesoPropio` tiene que ser un booleano y `amplificar` del segundo orden también (`segundo-orden/no-valido`). En el fuzz del auditor (4 617 mutaciones), de 164 «fallos del compilador» a 0. Prueba en `forma.test.ts`.
- **A2-3, hecho.** `esfuerzosFranjas.ts`: el ancho en losa con el que se mide la cobertura de una estación de apoyo se toma un poco dentro del lado tomado (en la recta misma de la cara de una viga, su ancho se restaba entero en una de las dos caras), y las líneas de apoyo de una misma recta y lado (una viga dibujada por vanos da una por vano) van juntas en una estación por franja (antes, la primera tapaba a las demás). En el reticular simétrico del auditor, todas las estaciones de apoyo tienen su simétrica a 0,02 % (antes, hasta ×5, con una de 0,10 m de 0,80). Referencia de F regenerada a sabiendas (`validacion/f/out_cambiosA23.txt`): cambian 21 de 2 083 estaciones de cara y apoyo, todas donde se juntan dos líneas, y salen 2 nuevas que antes no pasaban la cobertura; la malla, los mx de cara y de paso y lo demás, idénticos. Prueba en `franjas.test.ts` (falla con el código de antes).
