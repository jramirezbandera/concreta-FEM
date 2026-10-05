# Fase C4 — compilador de forjados: resultado

> **Fecha:** 2026-10-05. **Plan:** `compilador.md` (alcance, decisiones C4-a…C4-j y criterios de C4), que concreta la fase C4: «unidireccional como viguetas-barra (D2; sin nudos intermedios sin rigidez a torsión, E2-3) y reticular con multiplicadores y ábacos (D3)».
>
> **Veredicto: pasan los nueve criterios; el 2, con una salvedad en el ábaco.**
> - **Unidireccional.** Los paños a mano dan su modelo hecho a mano a ≤ 2e-14, también girado 30°, con una vigueta en la huella de un pilar y con un hueco sin brochales. Dos vanos sobre muros finos dan la reacción central de la viga continua a −0,4 %.
> - **Reticular.** Los multiplicadores son los de la T calculada a mano. La placa de Navier ortótropa converge con orden 2 (−0,09 % con h = 0,25). Frente al emparrillado de nervios como barras (el modelo de CYPECAD), el recuadro apoyado queda a −2,7 % en flecha y −2,0 % en momento por nervio, y la diferencia baja al haber más nervios por vano.
> - **Salvedad del criterio 2:** con un pilar y su ábaco, la flecha queda a −4,5 % (se pedía 3 %). La diferencia es el efecto Poisson del ábaco macizo, que un emparrillado no puede tener: con ν = 0 en los dos, −2,1 %.
> - **Robustez.** 36 plantas al azar compilan con «sin pérdidas» ≤ 1,1e-14 y calculan en equilibrio, sin mecanismos. Reordenar da el mismo modelo bit a bit; trasladar y girar 90° o 37° dan las mismas viguetas y la misma malla. 42 entradas no válidas dan su error con el id físico. El modelo es el mismo en V8 y en JavaScriptCore.
> - **Edificio objetivo.** Con unidireccional (H52 V3): 7 360 nudos y 21 840 ecuaciones; compila en 0,44 s (el 34 % del cálculo). Con reticular y ábacos (V2): 52 125 nudos y 142 065 ecuaciones; compila en 2,4 s (el 47 %). Los dos caben en el perfil móvil (200 000 ecuaciones).
>
> **Hallazgos principales:**
> - **C4-6:** aplicar a la maciza con ν = 0,2 las razones de la T (como se haría en SAP2000 con multiplicadores) da un reticular **un 21 % más rígido** que el emparrillado de nervios, por el acoplamiento de Poisson en un recuadro bidireccional. Los multiplicadores de C4-h (ν = 0 y G compensado) quedan a −2,7 %. Es lo que hay que contrastar con el modelo SAP2000 del usuario (S5 #21).
> - **C4-3 y C4-4:** dos fallos latentes de la malla de C2, que aparecían con un ábaco, una zona o una banda que se sale de la losa junto a un pilar de esquina o de fachada. Las bandas de pilar de fachada de D5 serán así. Están corregidos sin cambiar ninguna malla existente.
> - **C4-5:** una carga lineal en una planta sin losas ni muros se perdía en silencio (C2). Ahora es un error.
>
> **Cómo leerlo:** la tabla resume los criterios, que se fijaron al empezar la fase. Cada sección da el detalle y la evidencia. Lo que queda para el usuario está en «Decisiones por defecto» y en «Pendiente».

| # | Criterio | Resultado | Evidencia |
|---|---|---|---|
| 1 | Oráculo a mano del unidireccional (≤ 1e-10) y dos vanos sobre muros frente a 1,25·q·L (≤ 1 %) | **Pasa.** Cinco paños (entre cuatro vigas con vigas paralelas, girado 30°, dos vanos con voladizo, vigueta en la huella de un pilar, hueco sin brochales): u, reacciones y esfuerzos de barra a ≤ 2,0e-14. Dos vanos sobre muros de 5 cm: reacción central 1,242·q·L (−0,63 %); con muros de 3 cm, −0,43 % | `oraculo-c4.test.ts`, `oraculos-c4.test.ts`; `validacion/c4/out_resumen.txt`, `out_oraculos.txt` |
| 2 | Reticular: multiplicadores a mano; Navier ≤ 0,5 % y orden ≈ 2; frente al emparrillado ≤ 3 % en flecha y ≤ 5 % en momento por nervio | **Pasa, con una salvedad.** Multiplicadores de 25+5, 30+5 y 35+10 a ≤ 7e-16 (m12 a ≤ 0,07 % de Roark). Navier: −0,36, −0,088 y −0,022 % con h = 0,5, 0,25 y 0,125. Recuadro apoyado de 8 nervios: −2,7 % y −2,0 % (−1,0 y −0,8 % con 16). Con un pilar central y su ábaco (12 nervios): −2,1 % y −1,4 % con ν = 0 en los dos; con el ν del hormigón, la flecha a −4,5 % (C4-7) | `oraculos-c4.test.ts`; `out_oraculos.txt` |
| 3 | Batería de plantas al azar: validador, «sin pérdidas», equilibrio y sin mecanismos | **Pasa.** 36 modelos (12 semillas mixtas, unidireccionales y reticulares; 1 174 viguetas y 9 626 láminas de ábacos): «sin pérdidas» ≤ 1,1e-14, equilibrio ≤ 3,8e-13, ningún mecanismo | `forjados.test.ts`; `out_resumen.txt` |
| 4 | Metamórficas: reordenar, trasladar y girar, ruido, invertir el contorno y la dirección, partir un paño | **Pasa** en 5 semillas. Reordenar (también los ábacos): idéntico en modelo, mapeo, diagnósticos y huella. Traslación y giros de 90° y 37°: las mismas viguetas y malla, u ≤ 2,5e-12 y reacciones ≤ 4,9e-12. Ruido de 1e-8 m: las mismas viguetas. Invertir el contorno y girar la dirección 180°: 1,8e-14. Partir un paño por su viga secundaria: ≤ 1e-9 | `metamorficas-c4.test.ts`; `out_resumen.txt` |
| 5 | Sin pérdidas (≤ 1e-9) con la resultante física sin viguetas ni malla, y equilibrio | **Pasa.** 36 modelos al azar: ≤ 1,1e-14. Edificio objetivo: 2,1e-13 (V2) y 8,5e-13 (V3) | `forjados.test.ts`; `out_banco.txt` |
| 6 | Entradas no válidas con su id físico, sin lanzar | **Pasa.** 42 entradas de paños, reticulares y cargas sobre paños (y modificadores de viguetas no válidos); ninguna lanza ni llega a `compilador/error-interno` | `invalidos-c4.test.ts` |
| 7 | El mismo modelo en V8 y JSC; la huella no depende del orden | **Pasa.** 14 modelos (los cinco a mano y nueve al azar): topología (con liberaciones y multiplicadores) idéntica y coordenadas a ≤ 1e-12 entre Node y Bun. La huella no depende del orden de los paños ni de los ábacos, y cambia con 1e-9 m en un paño, con su intereje, su dirección o un ábaco | `huella-c4.test.ts`; `validacion/c4/huellas.ts` |
| 8 | Rendimiento: V2 y V3 compilan en una fracción del cálculo y caben en D9 | **Pasa.** V3: 0,44 s, el 34 % del cálculo (1,3 s), 7 360 nudos y 21 840 ecuaciones (H52 estimaba 7 514 nudos). V2: 2,4 s, el 47 % del cálculo (5,0 s), 52 125 nudos y 142 065 ecuaciones: los ábacos añaden un 50 % de nudos a la maciza con rejilla (H52: entre un 19 y un 61 %). Los dos caben en el perfil móvil | `validacion/c4/out_banco.txt` |
| 9 | Referencia congelada | **Pasa.** Paño girado 30°, dos vanos con voladizo, paño con hueco y tres modelos al azar (unidireccional, reticular con ábacos de fachada y mixto): modelo a 1e-12 y resultados a 1e-9 con los dos solvers. Generada con Bun y comprobada en Node | `congelado-c4.test.ts` |

---

## 1. Qué hay nuevo

| Fichero | Qué hace |
|---|---|
| `src/compilador/fisico.ts` | `Losa.reticular` (intereje, nervio, capa, ábacos y multiplicadores), `panos` (paños unidireccionales), la carga de superficie sobre un paño y `modificadores.viguetas` |
| `src/compilador/validar.ts` | Validación de reticulares (nervios, multiplicadores y ábacos) y paños (geometría, dirección, intereje, pp, solapes) y sus datos compilados |
| `src/compilador/reticular.ts` | Multiplicadores de la zona aligerada (C4-h) y su volumen de hormigón |
| `src/compilador/unidireccional.ts` | Contorno unido, grupos y rectas, viguetas con sus apoyos y nudos (C4-a…d), receptores de borde, avisos, y el reparto exacto por la regla de la palanca (C4-e) |
| `src/compilador/losas.ts`, `arreglo.ts` | Ábacos sembrados en la malla y sus láminas; los muros llegan ya ajustados; las cargas puntuales y los lados de las lineales que caen en un paño los reparten los paños |
| `src/compilador/piezas.ts`, `cargas.ts`, `compilar.ts`, `mapeo.ts` | Barras de las viguetas (torsión liberada, zona rígida en las huellas), diafragma con los paños (C4-g), pesos (C4-f, C4-i), cargas sobre paños, multiplicadores y ν de las láminas, mapeo (`panos`, `abaco`, `pano` de cada barra) y versión C4.0 |
| `src/compilador/mallado.ts`, `poligonos.ts`, `geometria2d.ts` | Los dos arreglos de la malla de C2 (C4-3 y C4-4), integrales de orden 2 de polígonos y la cuerda de una huella con holgura |
| `src/pruebas/forjadosAleatorios.ts` | Plantas al azar unidireccionales (paños oblicuos, huecos, balcones) o reticulares (ábacos en todos los pilares) |
| `validacion/c4/` | Paños a mano, oráculos del reticular, resumen, decisiones, huellas, banco, edificios V2 y V3, y referencia congelada |

**Uso:** el de C1–C3. Cada vigueta es una pieza (`<paño>:v<n>`, en orden transversal) en `mapeo.piezas`, así que `EsfuerzosPiezas` da sus esfuerzos por estación desde su primer extremo. `mapeo.panos` da las viguetas de cada paño; `mapeo.barras[i].pano`, el paño de una barra de vigueta; `mapeo.laminas[i].abaco`, las láminas de los ábacos. El momento por nervio de un reticular es M11·s.

## 2. Cómo se hacen los forjados

**Reticular** (D3). La zona aligerada es una lámina maciza de canto h con los multiplicadores del emparrillado de nervios (`reticular.ts`), con ν = 0 y el G del hormigón compensado; los ábacos son macizos. Sus lados se siembran en la malla como las bandas, y cada lámina es de un ábaco si lo es el centroide de su pieza. El peso propio va por lámina y su resultante física, por regiones.

**Unidireccional** (D2):
- **Contorno unido.** Los vértices del paño se llevan a un nudo de C1 o al eje de una viga o de un muro a ≤ ε_snap (C2-b), con aviso.
- **Rectas.** Los paños contiguos con la misma dirección e intereje forman un grupo con un marco (d en [0°, 180°), n); sus rectas se centran en su ancho, n = round(W/s).
- **Viguetas.** Cada recta se recorta a cada paño (sin huecos). Sus apoyos son los extremos y los cruces con vigas, muros y huellas de pilar. Una vigueta que va por el eje de una viga o de un muro paralelos no se crea.
- **Nudos** (C4-d): el del pilar; si no, uno que ya exista a ≤ ε_snap; si no, uno nuevo sobre la viga (que se parte), sobre el muro (en su vértice si lo tiene cerca) o en el borde de la losa; si no, un extremo libre. Se crean antes de las losas, así que son puntos fijos de su malla y estaciones de los muros.
- **Barras.** Una por tramo entre apoyos, con la torsión liberada en el primero si los dos son apoyos (C4-c).
- **Reparto** (C4-e). Por franjas en σ con cortes en los vértices, los nudos de las viguetas y de las vigas de los bordes y, en una zona, sus vértices, la sección del paño son intervalos en η. En cada intervalo:
  - entre receptores consecutivos (viguetas y lados paralelos sobre una viga), la regla de la palanca;
  - entre un lado que no es receptor y el más cercano, a éste entera, con su momento de transporte;
  - cada receptor recibe por franja un trapecio con la fuerza y el momento exactos (integrales de polígonos de orden 2).

  El momento de transporte va a los nudos del receptor por interpolación lineal en el centroide de su densidad (C4-1). Las cargas lineales se cortan por las franjas, las rectas de los receptores y los lados de los paños, y cada trozo va al primer paño que lo contiene.
- **Diafragma** (C4-g): en una planta con paños, los nudos sobre ellos y aquellos a los que llegan sus viguetas, junto con los de las losas.

## 3. Hallazgos de C4

| ID | Hallazgo | Consecuencia |
|---|---|---|
| C4-1 | **El momento de transporte aplicado sobre la vigueta dependía de su sentido.** Con la torsión liberada en su primer extremo, un par torsor sobre la barra va entero al otro: al girar la planta 90° (la dirección pasa de 90° a 180°, que se canoniza a 0°), o al partir un paño, el par iba a otro nudo. Las metamórficas lo vieron como un 5e-4 de diferencia | Va a los nudos del receptor por interpolación lineal en el centroide de su densidad, que es exacto (un vector libre), es la reacción de empotramiento de un par torsor y no depende del sentido ni de cómo se corten las franjas. Los cortes incluyen los nudos de cada receptor |
| C4-2 | **Una vigueta paralela a la cara de un pilar y justo en ella** (un pilar de 55 cm y una vigueta a 27,5 cm de su eje) tenía cuerda en la huella, o no, según el último bit: la zona rígida aparecía o desaparecía al trasladar la planta | La cuerda de una huella admite una holgura: una recta paralela a una cara a ≤ ε_geom de ella no entra |
| C4-3 | **Fallo latente de la rejilla de C2:** una arista de la red de la plantilla de un pilar de esquina o de fachada que va por el borde de la losa no era obligatoria en la triangulación. Con puntos fuera de la losa (un ábaco, una zona o una banda que se salen), los triángulos de fuera la cruzaban y la malla cubría de más. El validador lo paraba con `malla/area`, pero rechazaba modelos válidos | Esa arista es obligatoria. No cambia ninguna malla de C1–C3 (las referencias congeladas siguen igual). Regresión en `forjados.test.ts`, que falla sin el arreglo |
| C4-4 | **Fallo latente de la triangulación de C2:** en algunas plantas giradas, constrainautor no podía restringir un lado entero fuera de la losa (el trozo de una zona que se sale: «no further intersect after non-convex»), aunque no hubiera cruces ni puntos casi alineados. Tampoco con su incircle exacto ni en otro orden | Un lado entero fuera de las losas no se siembra ni es obligatorio: lo de fuera se descarta y, como el borde de la losa sí lo es, la triangulación de dentro no cambia. Regresión que falla sin el arreglo |
| C4-5 | **Una carga lineal en una planta sin losas ni muros se perdía en silencio:** no tenía ni resultante física ni analítica, así que «sin pérdidas» no la veía | Ahora es `carga/fuera-de-losa` (catálogo de entradas no válidas) |
| C4-6 | **La semántica de los multiplicadores importa más de lo esperado.** Con las razones de la T aplicadas a la maciza con ν = 0,2, el recuadro reticular es un 21 % más rígido que el emparrillado de nervios: el acoplamiento D12 = ν·m11·D suma rigidez de dos direcciones que un emparrillado no tiene. Con C4-h, −2,7 %; y la diferencia baja con más nervios por vano (−1,5 % con 12, −1,0 % con 16): es el límite continuo | C4-h (ν = 0 en la zona aligerada) es la que reproduce los nervios. Los multiplicadores dados se aplican como en SAP2000, para comparar con el modelo del usuario (S5 #21) |
| C4-7 | **El emparrillado no es un oráculo para todo:** con ábacos en las esquinas de un recuadro apoyado, −26 %, porque el emparrillado no tiene nudo en la esquina y no puede dar la reacción de torsión que el macizo genera allí. Con un pilar y su ábaco, la flecha a −4,5 % por el efecto Poisson del macizo (con ν = 0 en los dos, −2,1 %) | El criterio 2 se mide con el pilar y su ábaco (el caso real) y con ν = 0 en los dos. En la comparación con SAP2000, las esquinas y los ábacos hay que mirarlos con eso en cuenta |
| C4-8 | **La torsión de las viguetas casi no trabaja:** en un recuadro simétrico sus dos extremos giran igual y no se tuercen; en dos vanos, conservarla (con la J de la T bruta) cambia el momento de la viga de fachada un 1 % | C4-c (liberada) no es una aproximación relevante, y evita los nudos sin rigidez de E2-3 |
| C4-9 | **La continuidad depende de que las viguetas caigan en la misma recta:** desalineadas 15 cm sobre una viga, el momento de la vigueta en el apoyo baja un 12 % y el de vano sube un 5,5 %, y la viga intermedia se tuerce (4,6 kN·m). Sobre muros de 25 cm, el muro empotra la vigueta y la reacción central es 1,08·q·L en vez de 1,25 | C4-a (rectas comunes por grupo). Lo del muro es física: se ve en el modelo |
| C4-10 | **Trozos de carga de barra de redondeo** (2e-15 m) en el reparto: el motor rechaza una carga distribuida con un tramo menor que su tolerancia | Un trozo de ≤ 1e-6 m va como fuerza concentrada en su centro con el momento de su reparto, exacto |
| C4-11 | **Una viga o un muro dentro de un paño y paralelos a sus viguetas no reciben su carga** (las viguetas pasan a su lado sin cruzarlos) | Aviso `pano/viga-paralela-dentro`, que pide partir el paño por ella |

## 4. Decisiones por defecto (de `compilador.md`), con sus medidas

| Decisión | Por defecto | Medida | Para el usuario |
|---|---|---|---|
| C4-a, posición de las viguetas | Rectas comunes por grupo de paños contiguos con la misma dirección e intereje, centradas en su ancho | Desalineadas 15 cm: −12 % de momento en el apoyo y +5,5 % en el vano (C4-9) | Confirmar |
| C4-c, torsión de las viguetas | Liberada en un extremo de cada tramo entre apoyos; los voladizos la conservan | Conservarla cambia ≤ 1 % (C4-8) | Confirmar |
| C4-e, reparto | La palanca entre receptores; la franja junto a un borde sin viga, a la última vigueta con su transporte, que va a sus nudos (C4-1) | En un recuadro de 5 × 6 con s = 0,75, las vigas paralelas reciben el 6,25 % (franjas de 0,1875 m) | Confirmar. Alternativa: que los muros y las losas paralelos también sean receptores |
| C4-h, multiplicadores del reticular | Del emparrillado de nervios, con ν = 0 y G compensado | −2,7 % frente al emparrillado; con las razones y ν = 0,2 (como SAP2000), −21 % (C4-6) | **La más importante:** confirmar, y contrastar con el modelo SAP2000 del usuario (S5 #21) |
| C4-i, peso del reticular | `pp` medio en toda la losa; sin él, γ·volumen (casetón recuperable) y γ·h en los ábacos | 30+5: 3,28 kN/m² en la zona aligerada y 8,75 en los ábacos | Confirmar (con casetones perdidos hay que dar el pp) |
| C4-b, C4-d, C4-f, C4-g y C4-j | Como en el plan, más el aviso de C4-11 | Validadas por los criterios 1 a 6 | — |

## 5. Pendiente

- **Del usuario:**
  - confirmar C4-a, C4-c, C4-e, C4-h (sobre todo) y C4-i;
  - calcular en SAP2000 el reticular con ábacos y el unidireccional con viguetas (`validacion/e6/sap2000/LEEME.md`), para cerrar S5 #21 y comparar las vigas paralelas.
- **Para más adelante:**
  - ábacos automáticos alrededor de los pilares;
  - receptores de borde sobre muros y losas paralelos, y la opción de articular las viguetas en sus apoyos o de dar un momento negativo mínimo;
  - reticular con distinto intereje en cada dirección; placas alveolares y chapa colaborante validadas como tales;
  - el ábaco del criterio 2 frente a un modelo de referencia que tenga efecto Poisson (sólidos o SAP2000), no un emparrillado.
- **Validación externa:** el periodo «en sombra» con proyectos reales reticulares y unidireccionales calculados también en CYPE o SAP2000.

## Cómo reproducir

```sh
bun run test:run                                        # todos los tests (E0–E6, Fase 1 y C1–C4)
bun validacion/c4/oraculos.ts                           # criterio 2 (y la viga continua) → out_oraculos.txt
bun validacion/c4/resumen.ts                            # criterios 1, 3, 4 y 5 → out_resumen.txt
node validacion/c4/banco.ts > validacion/c4/out_banco.txt              # criterio 8
node validacion/c4/decisiones.ts > validacion/c4/out_decisiones.txt    # decisiones C4-a, C4-c, C4-e y C4-h
bun validacion/c4/congelar.ts                           # SÓLO a sabiendas: regenera la referencia congelada de C4
```
