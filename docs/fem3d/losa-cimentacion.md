# Fase LC: la losa de cimentación sobre balasto

Plan del 2026-11-14, desde la propuesta de `cimentacion-y-arriostramientos.md` §2 (2026-10-13). El orden lo decidió el usuario el 2026-11-08: DN, luego LC y luego CO. Estado: **plan, con lo medido para CB-b (§3); las decisiones de §5 son del usuario.**

## 1. Qué se pide

Como en CYPECAD: los pilares y los muros caen en una losa «de cimentación» con su coeficiente de balasto, y la losa se calcula sobre muelles en los nudos de su malla (Winkler). Lo que sale es lo de siempre de una losa (franjas de armado, mapas) más lo del terreno: la tensión σ = k·w, los asientos y dónde despega.

Esta fase es **lineal**: un muelle en tracción no se quita, se avisa (`cimentacion/despegue`). Quitarlo es el cálculo no lineal por combinación de `cimentacion-y-arriostramientos.md` §4, que va con las barras sólo a tracción.

## 2. Cómo está hoy

- **El motor ya tiene muelles** (`Muelle`, `src/motor/modelo.ts`): a tierra o entre dos nudos, 6 o 36 rigideces. Sus reacciones entran en las de los apoyos y en el equilibrio de cada cálculo (regla de oro 2). El compilador no genera ninguno.
- **Un pilar con `base: "ninguno"` se apoya en una losa por su huella rígida** (apeo, C2-d; HR), y un muro, por sus nudos de la base (C3-f). Es lo que hace falta.
- **La planta más baja no tiene diafragma** por defecto (C1-d). Con RV-b, la cota de la planta es la cara superior de la losa y el pilar arranca en el nudo.
- **Las franjas y los mapas de armado nombran caras físicas** (`armado-x-inf` es la cara inferior). En una losa de cimentación el armado de los vanos sale arriba y el de bajo los pilares, abajo, pero no hay que cambiar ningún nombre: `cimentacion-y-arriostramientos.md` §2.4 decía mal que había que invertirlos.
- **Un nudo con un apoyo en ux y uy manda su masa sísmica al terreno** (VS2), y el segundo orden toma como nivel sin desplazamientos el más alto bajo el cual nada se mueve (A2-4).

## 3. Lo medido para CB-b (`validacion/lc/`)

**La pregunta:** muelles por nudo (k por el área tributaria, la fila sumada de la matriz consistente; cabe en el motor sin tocarlo) o la matriz consistente ∫ k·Nᵀ·N dA (acopla los nudos de cada lámina y tendría que ir en el motor, con su oráculo).

### 3.1 La viga de Hetényi (`hetenyi.py`, `out_hetenyi.txt`)

Para aislar lo que es del reparto del balasto, una viga de Euler-Bernoulli con elementos de Hermite (exactos sin terreno) sobre Winkler, con una carga puntual, frente a la solución cerrada. l_v = 1/β = (4EI/k_b)^¼.

| h/l_v | w bajo la carga, nudo / consistente | M bajo la carga, nudo / consistente |
|---|---|---|
| 1,00 | −1,03 / −0,41 % | −18,0 / −0,10 % |
| 0,50 | −0,05 / −0,03 % | −4,3 / −0,01 % |
| 0,27 | 0,00 / 0,00 % | −1,23 / 0,00 % |
| 0,10 | 0,00 / 0,00 % | −0,17 / 0,00 % |

Lejos de la carga (2 y 3 l_v), las dos dan lo mismo. **Lo único que pierde el reparto por nudos es el pico de momento bajo una carga concentrada, del lado inseguro, con orden 2: ≤ 1,2 % con h ≤ 0,27·l_v** (con la l de la losa, h ≤ 0,4·l).

### 3.2 La losa frente a Navier–Winkler (`medir.ts`, `out_medir.txt`)

El oráculo es la solución de Navier de Mindlin (`src/pruebas/navier.ts`, con el campo nuevo `balasto`: k suma al término de W). Placa de 12,75 × 12,75 m apoyada «hard», HA-30, con un pilar de 0,75 × 0,75 m en el centro como parche de 1 500 kN (≥ 2,3 l de los bordes). l = (D/k)^¼. Muelles por nudo, mallas regulares.

- **Prueba del parche** (losa libre, carga uniforme): w = q/k en todos los nudos a ≤ 4e-12 y momentos ≤ 1e-10 kN·m/m. El vector de cargas de la lámina y los muelles son coherentes.
- **El pilar** (lámina más cercana a cada punto, frente a Navier en su centroide):

| t, k | l | h | h/l | w junto al centro | Mx centro | Mx a 1,5 m | Mx a 3 m |
|---|---|---|---|---|---|---|---|
| 0,6 m, 10 000 | 2,80 | 0,75 | 0,27 | −0,9 % | −25,9 % | +6,1 % | +12,1 % |
| | | 0,375 | 0,13 | −0,3 % | −7,5 % | +1,7 % | +4,0 % |
| 0,6 m, 50 000 | 1,87 | 0,75 | 0,40 | −1,6 % | −31,7 % | +24,3 % | −7,8 % |
| | | 0,375 | 0,20 | −0,5 % | −9,4 % | +11,0 % | −1,8 % |
| 1,0 m, 50 000 | 2,75 | 0,75 | 0,27 | −0,8 % | −26,4 % | +6,8 % | +16,3 % |
| 0,4 m, 150 000 | 1,05 | 0,75 | 0,71 | −3,9 % | −41,4 % | −31,7 % | −5,1 % |
| | | 0,375 | 0,36 | −1,3 % | −12,7 % | −5,9 % | −1,2 % |
| | | 0,25 | 0,24 | −0,6 % | −5,0 % | −4,4 % | −0,7 % |

(Mx a 1,5 m con k = 50 000 está junto al cero del momento: el tanto por ciento engaña.)

**Lo que sale:**

- **CB-b: los muelles por nudo bastan.** En la losa, el error con h = 0,75 es 20 veces el que la viga atribuye al reparto (−26 % frente a ≈ −1 % con h/l = 0,27): es de la malla de la lámina bajo una carga concentrada, y la matriz consistente no lo arregla. Meterla en el motor, con su oráculo, no compensa.
- **Lo que manda es h/l.** Con la h = 0,75 de los forjados, una losa de cimentación de 0,4 m sobre roca blanda (k = 150 000) queda en h/l = 0,71 y el momento a 1,5 m del pilar sale un 32 % bajo. Hace falta una regla de malla por l (LC-e).
- **Esto no es todavía lo que se dimensiona.** El valor del centroide de la lámina del parche no es el de la cara del pilar, y en el modelo compilado la huella es rígida y lleva las plantillas de F2/F3. La regla de LC-e se fija midiendo en LC1 las estaciones de cara y la σ máxima del modelo compilado frente a una malla fina.

## 4. Propuesta

**En el modelo físico** (`fisico.ts`, con el esquema y A-1):

```ts
/** En una Losa: es de cimentación, sobre el terreno (fase LC). */
cimentacion?: {
  /** Módulo de balasto vertical, kN/m³, ya corregido por tamaño y forma (lo decide el ingeniero). */
  balasto: number;
  /** Lo horizontal (CB-a). Por defecto, "coartado". */
  horizontal?: "coartado" | { kh: number };
  /** Tensión admisible del terreno, kN/m² (opcional): sólo para el aviso de LC-f. */
  tensionAdmisible?: number;
};
```

**En el compilador** (versión nueva, LC1; sin `cimentacion`, la misma salida bit a bit):

1. **Un muelle vertical por nudo** de la losa, k por el área tributaria (la fila sumada de ∫ k·N dA de sus láminas), a tierra y en ejes globales. Los nudos de la huella de un pilar son de la losa y llevan su muelle (su reacción va al enlace). Lo que el ancho de una viga quita de la losa (LV) también apoya: su área va a los nudos de las caras (por defecto, LC-g).
2. **Lo horizontal (CB-a):** con `"coartado"`, ux y uy coartados en todos los nudos de la losa; con `{ kh }`, muelles en ux y uy con kh por el área tributaria. En los dos, rz no es un mecanismo.
3. **La malla (LC-e):** la losa se malla con h_c = min(h, l/n), l = (D/k)^¼ con el E y el espesor de la losa; n sale de lo medido en LC1.
4. **Los pilares y muros que arrancan en la losa (LC-c):** sin `base` escrita, se apoyan en ella (`"ninguno"`); con `"empotrado"` o `"articulado"` escritos y la huella en la losa, error `pilar/apoyo-sobre-cimentacion` (y el del muro). Un pilar que sigue por debajo de una losa de cimentación es un error (`cimentacion/pilar-debajo`).
5. **El diafragma:** un diafragma rígido no puede abarcar los nudos coartados en ux y uy (un GDL no puede ser esclavo y llevar apoyo). La losa de cimentación queda fuera del de su planta; con `diafragma: "rigido"` escrito y sólo la losa en la planta, aviso.
6. **El peso propio** de la losa va a sus muelles (G), como cualquier carga. **Sismo y segundo orden,** sin cambios: con `"coartado"` la masa de la losa va al terreno y su cota es el nivel sin desplazamientos.
7. **La hipótesis** dice el balasto de cada losa, lo horizontal, h_c y que el cálculo es lineal (sin despegue).

**Consultas y salidas:**

- **`terreno`:** σ = k·w por nudo y por combinación (por defecto, la ELS característica, como las reacciones de UI-11), el asiento w y el máximo de cada losa; `fem consultar terreno`.
- **Despegue:** aviso `cimentacion/despegue` si un muelle queda en tracción en alguna combinación, con el área que despega y su fracción de la losa, y la combinación.
- **Tensión admisible (LC-f):** con `tensionAdmisible`, aviso `cimentacion/tension` si σ máx de la ELS característica la pasa. La comprobación geotécnica completa (DB SE-C) es de CO.
- **Distorsión angular** entre pilares que arrancan en la losa (asiento diferencial / distancia), como dato.
- **Sensatez (A3):** la suma de las reacciones de los muelles es la de las cargas (ya está en la regla de oro 2) y la bajada tributaria acaba en la losa.

**Fuera del compilador (LC2):** la columna «balasto» y el tipo «cimentación» en Forjados y en la plantilla de Forjado; Resultados con los mapas de σ y de asiento (planta y 3D) y el despegue; el informe con σ máx, asiento máx y distorsión; la skill con la pregunta del balasto en la lista de datos del encargo (MA1).

**Fuera de LC:** vigas de cimentación y riostras sobre balasto, zapatas como base elástica (`cimentacion-y-arriostramientos.md` §2.6), el balasto por zonas dentro de una losa (LC-d) y el despegue de verdad (§4 de esa propuesta).

## 5. Decisiones del usuario

- **CB-a, lo horizontal.** Recomendado: **`"coartado"` por defecto y `{ kh }` como opción**. Coartado es lo más simple, no deja mecanismos, manda la masa sísmica al terreno y fija el nivel del segundo orden; los esfuerzos de membrana de la losa salen nulos (es lo rígido). Con kh (rozamiento, empuje pasivo) la losa se estira y los pilares de la planta baja se reparten algo distinto el cortante. Qué hace CYPECAD no lo he podido confirmar: se ve en la sombra (LC-h).
- **CB-b, muelles por nudo o matriz consistente.** Recomendado: **por nudo** (§3: lo que pierde es ≤ 1,2 % bajo la carga con h ≤ 0,4·l; lo que pesa es la malla, LC-e). El motor no cambia.
- **LC-c, los pilares sobre la losa.** Recomendado: **sin `base` escrita, se apoyan en la losa; escrita, error**. La alternativa es exigir `"ninguno"` y que el editor lo escriba al dibujar la losa; obliga a tocar todos los pilares y falla en silencio si se olvida uno (quedaría empotrado al terreno a través de la losa).
- **LC-d, balasto por zonas.** Recomendado: **no hay `zonas`**: un balasto distinto bajo un núcleo o en los bordes son dos losas de cimentación que comparten un lado (C2 ya las une y siembra el lado). Menos campos y la misma malla.
- **LC-e, la malla de la losa.** Recomendado: **h_c = min(h, l/n), con n fijado en LC1** midiendo las caras de los pilares y la σ máxima del modelo compilado frente a una malla fina (criterio 4). Con lo de §3, n estará entre 3 y 4. El coste: con h_c = l/4 y l = 1,9 m, la losa de cimentación del edificio objetivo es ~2,5 veces la de un forjado.
- **LC-f, la tensión admisible.** Recomendado: **campo opcional y sólo un aviso** con σ máx de la ELS característica; lo de la norma (σ media, bordes, hundimiento con sus γ) es de CO.
- **LC-g, el ancho de las vigas sobre la losa** (una viga de atado o un murete sobre la losa unidos por sus caras, LV). Recomendado: **el área del ancho reparte su balasto a los nudos de sus caras**, para no perder terreno bajo la viga (con 30 cm cada 6 m, un 5 %).
- **LC-h, la sombra.** Un modelo de CYPECAD del usuario con una losa de cimentación (pilares, algún muro, viento), para comparar σ, asientos, esfuerzos de la losa y de los pilares de la planta baja, y para ver qué hace con lo horizontal.
- **LC-i, el perfil móvil.** El edificio objetivo con losa plana está en 192 066 ecuaciones; con su losa de cimentación pasa de las 200 000 del perfil móvil. Recomendado: **aceptarlo** (como LV2-d con el reticular) y medirlo en LC1.

## 6. Criterios (para fijar con las decisiones)

1. Sin `cimentacion`, la salida del compilador bit a bit en todas las referencias congeladas.
2. **Oráculos analíticos del modelo compilado:** la prueba del parche (losa libre con su peso y una carga uniforme: w = q/k a 1e-9 y momentos nulos); Navier–Winkler con un pilar a ≤ 2 % en w y σ y a ≤ 5 % en el momento de las caras con h_c; la losa rígida (asiento y giro de sólido rígido de la resultante, con una carga excéntrica); flexión cilíndrica frente a Hetényi.
3. **Oráculo externo:** OpenSeesPy con los mismos nudos, ASDShellQ4 y muelles `zeroLength` en una losa con pilares: σ y momentos a ≤ 0,5 % (elementos distintos) y las reacciones de los muelles, idénticas en suma.
4. **LC-e medida:** con h_c, las estaciones de cara de los pilares y la σ máxima a ≤ 5 % y ≤ 2 % de la malla convergida (`referencia-fina-convergida`), en una retícula con pilares de esquina, de borde e interiores y dos balastos.
5. El equilibrio de cada cálculo (regla de oro 2) con los muelles; el despegue sale donde w > 0 y en ningún otro sitio; metamórficas (traslación, giro, orden de las listas) sin cambio.
6. Los errores de §4 en el catálogo de no válidos.
7. El coste en ecuaciones de los edificios objetivo con su losa de cimentación, informado (LC-i).
8. La sombra con CYPECAD (LC-h), cuando el usuario dé el modelo.

## 7. Tramos

- **LC1, el compilador y las consultas:** el campo, los muelles, lo horizontal, la malla por l, los pilares y muros, el diafragma, `terreno`, los avisos, la hipótesis y la referencia congelada, con los criterios 1 a 7.
- **LC2, la app y el agente:** la tabla y la plantilla, los mapas de σ y asiento, el despegue, el informe, la skill y `fem consultar terreno`.
- **LC3:** la sombra (criterio 8).
