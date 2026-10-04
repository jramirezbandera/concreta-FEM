# Comparar el motor con SAP2000 en tus modelos

Herramientas de E6 para cerrar con SAP2000 lo que la validación no puede cerrar sola:

- la semántica de los multiplicadores de lámina (S5 #21, D3);
- el reticular con ábacos y el unidireccional con viguetas (D2);
- más adelante, el periodo «en sombra» de la regla de oro 7.

El script lee tu modelo y los resultados exportados de SAP2000, calcula el modelo con el motor y compara caso por caso.

## 1. Primer paso: la placa ortótropa de Navier (≈ 10 minutos)

Es la propuesta de `docs/fem3d/fase-e3.md` («Pendiente»):

- placa de 6 × 4 m, t = 0,30 m, E = 3·10⁷ kN/m², ν = 0,2;
- apoyo simple con el giro tangente coartado y q = 10 kN/m²;
- multiplicadores m11 = 1, m22 = 0,3, m12 = 0,2, v13 = 0,5, v23 = 0,15;
- malla de 0,125 m.

Pasos:

1. `bun validacion/e6/sap2000/navier.ts` escribe `validacion/e6/sap2000/navier-ortotropa.$2k`.
2. En SAP2000, importa el modelo con **File > Import > SAP2000 .s2k Text File** y calcula el caso `Q`.
3. Exporta las tablas de resultados **Joint Displacements** y **Element Forces – Area Shells**:
   - **Display > Show Tables > Analysis Results**;
   - en la ventana de tablas, **File > Export All Tables > To Text File**, o a Excel y luego cada hoja como CSV.
4. Lanza la comparación:

   `bun validacion/e6/sap2000/comparar.ts validacion/e6/sap2000/navier-ortotropa.$2k <resultados exportados>`

   Escribe el informe en `navier-ortotropa.comparacion.txt`.

Qué esperar:

- El motor da en el centro w = −8,28·10⁻⁴ m. Coincide con Navier a −0,011 % (`validacion/e3/out_navier.txt`).
- Si SAP2000 aplica los multiplicadores igual que el motor (D' = S·D·S, con el término de Poisson por √(m11·m22)):
  - w y los momentos del centro coinciden al ≲ 1 %;
  - los momentos de los nudos de cada elemento, algo menos, porque cada programa extrapola desde sus puntos de Gauss.
- Si SAP2000 no escala el término de Poisson, los momentos M11 y M22 del centro difieren del orden de ν·(1 − √0,3) ≈ 9 %. Esa diferencia es justo lo que se quiere saber.

## 2. Tus modelos (reticular con ábacos, unidireccional con viguetas)

1. En SAP2000:
   - **File > Export > SAP2000 .s2k Text File** con el modelo;
   - las tablas de resultados de los casos estáticos lineales: **Joint Displacements**, **Joint Reactions**, **Element Forces – Frames** y **Element Forces – Area Shells**.
2. `bun validacion/e6/sap2000/comparar.ts <modelo.$2k> <resultados…>`.

Lo que se traduce y lo que no:

- **Se traduce:**
  - nudos;
  - barras de cualquier sección, con sus propiedades calculadas por SAP2000: A, J, I33, I22, AS2, AS3;
  - ejes locales con giro, liberaciones, zonas rígidas (RZ) y modificadores;
  - láminas de 4 nudos Shell (fina o gruesa), Membrane o Plate, con sus modificadores y el giro de sus ejes;
  - apoyos, muelles desacoplados, diafragmas, cuerpos rígidos y pórticos planos (GDL activos);
  - peso propio, cargas nodales, cargas de barra distribuidas y puntuales, y cargas uniformes de área;
  - casos estáticos lineales.
- **Da un error y no calcula:**
  - áreas de 3 nudos y malla automática de áreas: hay que mallarlas en SAP2000, con **Edit > Edit Areas > Divide Areas**, antes de exportar;
  - puntos de inserción distintos del centroide;
  - cargas «Uniform to Frame» (reparto uni- o bidireccional);
  - temperatura, elementos *link*, muelles acoplados, ejes locales de nudo y casos no lineales.

  Ningún dato se aproxima en silencio.

Qué se compara, por caso:

- desplazamientos y giros de todos los nudos;
- reacciones;
- esfuerzos de las barras en las estaciones de SAP2000, salvo las que caen en una zona rígida;
- esfuerzos F11…V23 de las áreas en sus nudos.

El informe da, por grupo de magnitudes:

- la mayor diferencia frente al mayor valor de SAP2000 y dónde se produce;
- la fracción de valores que difieren ≤ 1 % y ≤ 5 % de ese máximo.

**Aviso:** el lector se escribió a partir de la forma de los ficheros de SAP2000 v14–v24 y se ha probado con modelos escritos así (los ejemplos de CSI de `src/motor/sap2000.test.ts`). Todavía no se ha probado con un fichero exportado por tu versión de SAP2000. Si algo no se lee, el informe lo dirá; el primer modelo real puede pedir algún ajuste del lector.
