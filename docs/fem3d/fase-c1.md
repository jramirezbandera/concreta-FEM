# Fase C1 — compilador de barras: resultado

> **Fecha:** 2026-10-04. **Plan:** `compilador.md` (fases C1–C5 y criterios de C1), que concreta la Fase 2 de S1: «compilador de barras: dos tolerancias y hash de rejilla, troceado sólo topológico, `seccion3D()`, orientación explícita, validación de liberaciones».
>
> **Veredicto: pasan los ocho criterios.**
> - SAP2000 1-022 descrito como modelo físico da los tres valores publicados del caso LAT y coincide con el modelo hecho a mano de E6 a 1e-14.
> - Cuatro modelos físicos coinciden con su modelo analítico escrito a mano a ≤ 1,2e-14. Cubren zonas rígidas, excentricidades, rótulas, encuentros en T y cruces, pilares apeados y apilados, inserción superior y cargas en zonas rígidas.
> - Siete relaciones metamórficas pasan en 12 modelos aleatorios: reordenar da el mismo modelo bit a bit, y girar 37° da los resultados girados a 3,3e-13.
> - El control «sin pérdidas» queda en ~1e-15. 67 entradas no válidas dan su error con el id físico, y ninguna lanza.
> - La huella es la misma en V8 y en JavaScriptCore. Las barras del edificio objetivo compilan en 47 ms.
>
> **Hallazgo principal (C1-1 y C1-2):** los dos fallos que encontraron las pruebas eran silenciosos y de los que el plan quería evitar.
> - Una viga dibujada encima de otra duplicaba la rigidez sin aviso.
> - Una carga puntual llevada al nudo más cercano era estáticamente exacta, pero no cinemáticamente.
>
> Los dos están corregidos y tienen su test.
>
> **Cómo leerlo:** la tabla resume los criterios, que se fijaron al empezar la fase. Cada sección da el detalle y la evidencia. Los hallazgos que cambian algo del plan están en «Hallazgos de C1».

| # | Criterio | Resultado | Evidencia |
|---|---|---|---|
| 1 | Oráculo publicado: SAP2000 1-022 como modelo físico, dentro del redondeo del caso LAT | **Pasa.** Ux 1,450757 in (1,45076), P 69,9867 k (69,99) y M 2 324,677 k·in (2 324,68). Frente al modelo a mano de E6: u 9,9e-15 y esfuerzos 1,2e-14 | `src/compilador/csi.test.ts`; `validacion/c1/out_resumen.txt` |
| 2 | Oráculo a mano: modelos físicos frente a su modelo analítico escrito a mano, a ≤ 1e-10 | **Pasa.** 4 casos con 38 nudos y 43 barras: el peor error, 1,2e-14. Los avisos son los previstos | `src/compilador/oraculo-mano.test.ts`; `validacion/c1/mano.ts` |
| 3 | Metamórficas: reordenar (bit a bit), trasladar y girar, ruido < ε_geom y < ε_snap, partir e invertir vigas | **Pasa** en 12 semillas, con y sin diafragma. Reordenar: idéntico en modelo, mapeo y diagnósticos. Traslación 1,7e-13; giro de 90°, 2,9e-13; de 37°, 3,3e-13. Ruido de 1e-8 m: misma topología y u a 2,6e-8. Ruido de ±1,5 cm: misma topología, 114 avisos. Partir 306 vigas: 7,6e-13. Invertir: 4,2e-15. Partir cargas: 1,9e-15 | `src/compilador/metamorficas.test.ts`; `src/pruebas/metamorficasFisicas.ts` |
| 4 | Sin pérdidas en cada compilación (≤ 1e-9) y equilibrio del motor | **Pasa.** 24 modelos aleatorios: 1,2e-15 en fuerzas y 1,2e-16 en momentos; equilibrio del motor ≤ 1,2e-14 | `out_resumen.txt`; `estadisticas.sinPerdidas` |
| 5 | Entradas no válidas: error con su código y el id físico, sin lanzar nunca | **Pasa.** 67 entradas, ninguna lanza ni llega a `compilador/error-interno`. Abarcan forma del modelo, plantas, materiales, secciones, pilares, vigas, apoyos, cargas, topología y opciones | `src/compilador/invalidos.test.ts` |
| 6 | Huella: la misma en Node (V8) y en Bun (JSC), sin depender del orden; vectores de SHA-256 | **Pasa.** Coinciden en 13 modelos, la física y la analítica a 12 cifras. Vectores de FIPS 180-4 y 201 textos comparados con `node:crypto` | `src/compilador/huella.test.ts`; `validacion/c1/huellas.ts` |
| 7 | Rendimiento: las barras del edificio objetivo, en una fracción del cálculo | **Pasa.** 7 plantas, 80 pilares, 567 vigas y 1 152 cargas, que dan 1 151 nudos y 2 499 barras: 47 ms de mediana, el 20 % del cálculo con el núcleo (234 ms), con la misma huella en cada repetición | `validacion/c1/out_banco.txt` |
| 8 | Referencia congelada | **Pasa.** 1-022, un edificio reducido y tres modelos aleatorios: modelo analítico a 1e-12, mapeo y resultados a 1e-9 con los dos solvers. Generada con Bun y comprobada en Node | `src/compilador/congelado-c1.test.ts` |

---

## 1. Qué hay nuevo

| Fichero | Qué hace |
|---|---|
| `src/compilador/fisico.ts` | Modelo físico de C1 y sus convenios. Plantas de arriba abajo con su altura, como `lib/edificio`. Pilares, vigas en polilínea, apoyos, casos y cargas puntuales, de viga y de pilar |
| `src/compilador/validar.ts` | Esquema, referencias y cotas. Nada lanza, ni con datos basura |
| `src/compilador/cotas.ts` | `cotasPlantas`, copiada de `cotasEdificio()` de Concreta |
| `src/compilador/topologia.ts` | La topología por planta con dos tolerancias, en 9 pasos (cabecera del fichero) |
| `src/compilador/piezas.ts` | Barras con nudos de dimensión finita, liberaciones, apoyos, diafragmas y las «rectas» de cada pieza para repartir las cargas |
| `src/compilador/cargas.ts` | Cargas físicas → analíticas, peso propio y control «sin pérdidas» |
| `src/compilador/mapeo.ts` | Mapeo físico ↔ analítico serializable y traducción de los diagnósticos del motor a objetos físicos |
| `src/compilador/resultados.ts` | `EsfuerzosPiezas`: esfuerzos en una estación de la pieza física |
| `src/compilador/huella.ts` | Serialización canónica y SHA-256 propio, síncrono (FIPS 180-4) |
| `src/compilador/compilar.ts` | `compilar(fisico, opciones)`: el flujo, la numeración canónica y la huella |
| `src/pruebas/compilador.ts`, `fisicoAleatorio.ts`, `metamorficasFisicas.ts` | Comparador de modelos, generador de modelos físicos y relaciones metamórficas |
| `validacion/c1/` | Modelos a mano, 1-022 físico (y su JSON), huellas, banco, resumen y referencia congelada |

**Uso:**

```ts
const r = compilar(fisico); // { valido, modelo, mapeo, diagnosticos, hipotesis, huella, estadisticas }
if (r.valido) {
  const c = calcular(r.modelo);
  const diags = traducirDiagnosticos(c.diagnosticos, r.modelo, r.mapeo); // ids físicos
  const e = new EsfuerzosPiezas(r.modelo, r.mapeo, c.casos); // e.en("V1", 0, 2.5)
}
```

## 2. Cómo convierte el compilador

- **La geometría dibujada no se mueve nunca.**
  - Las tolerancias deciden qué se une con qué.
  - El hueco entre lo dibujado y el nudo es un offset rígido de la barra.
  - Así las cargas quedan exactamente donde están y el control «sin pérdidas» es exacto.

  Mover vértices habría dejado ese control como una comprobación de sí mismo.
- **Nudo de un pilar = su eje.**
  - Una viga se une a un pilar si un vértice suyo o su recta caen en la huella del pilar, ampliada en ε_snap.
  - Su tramo flexible va sobre su propia recta, desde la proyección del eje más `factorZonaRigida` veces lo que la recta recorre dentro de la huella.
  - El offset lleva a la vez la zona rígida y la excentricidad. No hay penalizaciones.
- **El pilar es rígido en su cabeza** a lo largo del canto de la viga más alta que le llega.
- **Troceado sólo topológico:**
  - las vigas se parten en los vértices, en los pilares que atraviesan, en los encuentros en T, en los cruces y en los apoyos;
  - las cargas nunca parten una barra (COM-13): en un tramo flexible son cargas de barra exactas, y en una zona rígida o fuera de la cadena van al nudo con su momento de transporte.
- **Determinismo:**
  - las listas se procesan ordenadas por `id`;
  - los nudos se numeran por cota, x e y;
  - sus `id` se derivan de la planta y la posición (`P1:6.000,0.000`), y los de las barras, de la pieza (`V1:2`, `A:P1`).

## 3. Hallazgos de C1

| ID | Hallazgo | Consecuencia |
|---|---|---|
| C1-1 | **Una viga dibujada encima de otra duplicaba la rigidez sin aviso.** Sus dos extremos se unían en T a la de debajo, compartían nudos y el control de solape los saltaba | El solape se comprueba antes y aunque compartan nudos, también entre tramos casi paralelos. No cuenta lo que cae dentro de la huella de un pilar: dibujar dos vigas colineales hasta la cara lejana del pilar intermedio es normal y no es un error |
| C1-2 | **Una carga puntual llevada al nudo cercano es estáticamente exacta, pero no cinemáticamente.** Si cae a menos de ε_snap de un nudo, llevarla allí con su momento de transporte trata como rígido el trozo hasta el nudo. Lo detectó la relación «partir una viga» (1e-5) | Una carga que cae sobre una viga va a la viga, exacta. Sólo va a un nudo cercano si no cae sobre ninguna, o al pilar si cae en su huella |
| C1-3 | **`**` también difiere entre V8 y JSC:** `0.0254 ** 4` en 1 ulp. COM-12 había visto `hypot`, `cbrt` y `sin`, y daba `pow` por igual. 133 de 696 propiedades de `seccion3D()` difieren en algún bit | El modelo analítico no es idéntico bit a bit entre navegadores. Su huella va a 12 cifras, y la de compilación se calcula sobre el modelo físico, que son datos. Los modelos de validación construidos con potencias entran como JSON, y el generador aleatorio no usa `**` ni `hypot` |
| C1-4 | **El maestro del diafragma, en el centroide de la planta, puede caer encima de un nudo** (un pórtico simétrico) | No afecta al cálculo. Los comparadores emparejan sólo nudos con barras |
| C1-5 | **Con diafragma rígido, una viga con offset vertical trabaja como una T de ala infinitamente rígida.** Pórtico de 6 m, viga de 30×60: la flecha baja un 21 %, el momento de vano un 15 % y el de la cara sube un 16 %, con un axil de 87 kN que no existe. Sin diafragma, la inserción superior flexibiliza (+13 % de flecha) | Confirma C1-c: el eje va en el plano del forjado por defecto. La inserción superior queda como opción, con aviso, para cuando la losa sea una lámina (C2) |

## 4. Decisiones por defecto (de `compilador.md`)

Los criterios se cumplieron con el nudo entero rígido y sin modificadores. Después, el usuario decidió (2026-10-04) con las medidas de `validacion/c1/decisiones.ts` sobre el edificio objetivo:

| Decisión | Por defecto | Medida que la sostiene |
|---|---|---|
| C1-a | Factor de zona rígida **0,5** (antes 1) | Con 1, la deriva baja un 34 % y el momento de vano un 11 % frente a 0; 0,5 queda en medio. Para comparar con CYPE, 1 |
| D4 (C1-g) | Axil de todos los pilares **×2** y torsión de las vigas de hormigón **×0,1** (`MODIFICADORES_D4`) | Sin la torsión reducida, el vano de una secundaria que acomete a una viga de borde sale un 27 % corto (lado inseguro). Sin el axil ×2, la cara de una viga interior pierde un 6 % por el acortamiento diferencial |
| C1-c | Eje de la viga en el plano del forjado (sin cambios) | C1-5 |
| C1-d | Diafragma rígido salvo en la planta más baja (sin cambios) | Como CYPECAD; el axil de las vigas no sale y habrá que marcarlo en C5 |

- **Cómo se cambian:** con opciones de `compilar`, que entran en la huella. Los modificadores van por tipo de pieza y material, en (0, 100].
- **Qué cambia en el código:** la versión del compilador pasa a `C1.1`. El resultado trae `hipotesis`, en texto, para la memoria de cálculo.
- **Cómo se comprueba:**
  - `opciones.test.ts` comprueba los valores por defecto;
  - los modelos hechos a mano (criterio 2) y 1-022 (criterio 1) se compilan con las opciones con que se escribieron;
  - la referencia congelada se regeneró con los nuevos valores, salvo 1-022, que va sin modificadores como su modelo de SAP2000;
  - las metamórficas, el control «sin pérdidas» y el banco se volvieron a medir con los nuevos valores (tabla de criterios).

## 5. Pendiente

- **Del usuario:** nada que bloquee C2. La licencia ISC, C1-a y D4 se decidieron el 2026-10-04.
- **Para C2:**
  - qué nudos entran en el diafragma según la geometría de la losa (C1-e);
  - los pilares de doble altura;
  - el peso propio de las losas desde `pp`, y el solape viga–losa (H24);
  - las cargas de superficie y de línea.
- **Fuera de C1, sin fase todavía:**
  - vigas inclinadas, rampas y cargas proyectadas;
  - el «punto fijo» de los pilares que cambian de sección;
  - el giro de la sección de las vigas;
  - muelles a tierra en los apoyos físicos.
- **Integración con Concreta:**
  - el modelo físico usa las plantas de `lib/edificio` (con un nivel de cimentación como sótano);
  - las cargas de «Cargas por planta» no tienen geometría (COM-17): llegarán con C2 y C5.

## Cómo reproducir

```sh
bun run test:run                                    # todos los tests (E0–E6, Fase 1 y C1)
bun validacion/c1/resumen.ts > validacion/c1/out_resumen.txt   # criterios 1–4 y C1-5 medidos
node validacion/c1/banco.ts > validacion/c1/out_banco.txt      # edificio objetivo, sólo barras
bun validacion/c1/huellas.ts                        # huellas en JSC (el test las compara con Node)
bun validacion/c1/congelar.ts                       # SÓLO a sabiendas: regenera la referencia congelada de C1
```
