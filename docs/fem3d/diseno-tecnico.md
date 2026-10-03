# Diseño técnico del módulo FEM 3D de Concreta

> Especificación inicial para comenzar la implementación en Claude Code.

**Estado:** propuesta de arquitectura v0.1  
**Producto:** [concreta.tools](https://concreta.tools)  
**Ámbito:** análisis estructural 3D de edificios mediante elementos frame y shell, ejecutado íntegramente en navegador  
**Objetivo de la primera versión:** análisis elástico lineal de edificios formados por pilares, vigas, forjados y muros, con casos de carga, combinaciones, envolventes, visualización y conexión con los módulos de comprobación existentes.

---

## 1. Resumen ejecutivo

El nuevo módulo no debe construirse como una interfaz directa sobre un solver concreto. Concreta debe poseer cuatro capas estables:

1. **PhysicalModel**: el edificio tal como lo entiende el usuario —plantas, pilares, vigas, forjados, muros, huecos, apoyos y cargas—.
2. **AnalyticalModel**: el modelo FEM independiente del proveedor —nudos, frames, shells, restricciones, materiales, secciones y casos de carga—.
3. **SolverAdapter**: contrato intercambiable que traduce el modelo analítico al solver elegido y normaliza sus resultados.
4. **ResultModel**: formato propio de Concreta para desplazamientos, reacciones, esfuerzos de barras, resultantes de shells, diagnósticos y metadatos.

La decisión de producto inicial es utilizar **PyNite como único motor FEM de producción**. Se ejecutará en un Web Worker mediante Pyodide, con Python, NumPy y SciPy compilados para WebAssembly. Esta solución prioriza una API estructural comprensible, frames y placas/shells, rapidez de desarrollo y cercanía al dominio de edificación.

Los demás programas no forman parte de la arquitectura de ejecución:

- **OOFEM, CYPE y SAP2000** se usarán como referencias independientes de validación.
- **Awatif, Kratos y Stabileo** quedan documentados únicamente como antecedentes de la decisión o posibles líneas futuras; no se crearán adaptadores para ellos en el MVP.

El `SolverAdapter` se mantiene porque evita que el modelo, las combinaciones, la visualización y las comprobaciones dependan de la API de PyNite. No implica desarrollar varios motores ni una selección dinámica de solver.

Las combinaciones lineales y envolventes serán responsabilidad de Concreta. El solver resolverá principalmente casos simples; Concreta superpondrá resultados para evitar repetir cientos de análisis lineales.

---

## 2. Objetivos y límites

### 2.1 Objetivos funcionales

El módulo debe permitir:

- crear plantas y niveles con cotas y alturas;
- modelar pilares, vigas, forjados, muros y huecos como objetos constructivos;
- asignar materiales, secciones, espesores, apoyos y liberaciones;
- definir cargas nodales, lineales, superficiales y acciones por planta;
- compilar el edificio a un modelo FEM 3D de frames y shells;
- resolver múltiples casos de carga sin bloquear la interfaz;
- generar combinaciones y envolventes según las reglas ya existentes en Concreta;
- visualizar el modelo analítico, la deformada y las reacciones;
- mostrar diagramas `N`, `Vy`, `Vz`, `T`, `My` y `Mz` en frames;
- mostrar mapas `Nx`, `Ny`, `Nxy`, `Mx`, `My`, `Mxy`, `Qx` y `Qy` en shells;
- devolver resultados a los elementos físicos de origen;
- alimentar los módulos existentes de comprobación de pilares, vigas, muros y forjados;
- guardar un modelo de forma reproducible y recalcularlo en el navegador.

### 2.2 Fuera del MVP

No forman parte de la primera versión:

- no linealidad material o geométrica;
- fisuración no lineal del hormigón;
- plasticidad, contacto o grandes deformaciones;
- análisis de construcción por fases;
- interacción suelo-estructura avanzada;
- sólidos 3D;
- dimensionado automático global iterativo;
- análisis dinámico temporal;
- importación/exportación BIM completa;
- cálculo distribuido o backend obligatorio.

El diseño no debe impedir estas extensiones, pero tampoco debe complicar el MVP para anticiparlas.

### 2.3 Principios no negociables

1. **Browser first:** cálculo local y 100 % web; sin backend para el flujo normal.
2. **UI fluida:** ningún ensamblado o cálculo pesado en el hilo principal.
3. **Aislamiento de PyNite:** ningún componente de dominio importará tipos propios de PyNite o Pyodide.
4. **Trazabilidad:** todo elemento analítico y todo resultado debe poder rastrearse hasta su elemento constructivo.
5. **Reproducibilidad:** unidades, ejes, versiones, tolerancias, mallado y solver deben quedar registrados.
6. **Validación antes que amplitud:** no se incorpora una prestación sin benchmarks y tolerancias definidas.
7. **Resultados de ingeniería, no solo tensiones:** los resultantes de sección y de lámina son datos primarios.
8. **Errores explícitos:** mecanismos, elementos desconectados o matrices singulares nunca se presentarán como resultados válidos.

---

## 3. Decisiones arquitectónicas

| ID | Decisión | Motivo |
|---|---|---|
| ADR-001 | Separar `PhysicalModel` y `AnalyticalModel` | El usuario modela un edificio, no una malla FEM. |
| ADR-002 | Introducir `SolverAdapter` | Permite sustituir, contrastar o ejecutar más de un solver. |
| ADR-003 | Definir un `ResultModel` propio | Evita que visualización, combinaciones y comprobaciones dependan del solver. |
| ADR-004 | Resolver en Web Workers | Mantiene disponible el hilo de UI durante compilación, mallado y solución. |
| ADR-005 | Usar SI internamente | Elimina ambigüedades y reduce errores de conversión. |
| ADR-006 | Resolver casos simples y combinar en Concreta | La superposición lineal reduce drásticamente el número de análisis. |
| ADR-007 | Mantener mappings muchos-a-muchos físico–analítico | Un elemento físico puede generar muchos elementos FEM y un nudo puede pertenecer a varios objetos físicos. |
| ADR-008 | Usar TypedArrays en las fronteras intensivas | Reduce memoria, serialización y copias al comunicar con WASM y Workers. |
| ADR-009 | Fijar la versión del solver y registrar su huella | Garantiza resultados reproducibles y facilita auditoría. |
| ADR-010 | Adoptar PyNite como motor único del MVP | Reduce decisiones abiertas y acelera el desarrollo; su integración y formulaciones se validarán antes de la beta. |

---

## 4. Arquitectura general

```text
┌───────────────────────────────────────────────────────────────┐
│                        CONCRETA UI                            │
│  editor por plantas · propiedades · cargas · resultados 3D  │
└──────────────────────────────┬────────────────────────────────┘
                               │ comandos de dominio
┌──────────────────────────────▼────────────────────────────────┐
│                      PHYSICAL MODEL                           │
│ Storey · Column · Beam · Slab · Wall · Opening · Support     │
│ Material · Section · LoadCase · PhysicalLoad                 │
└──────────────────────────────┬────────────────────────────────┘
                               │ StructuralCompiler
┌──────────────────────────────▼────────────────────────────────┐
│                     ANALYTICAL MODEL                          │
│ Node · Frame · Shell · Constraint · Load · Material · Section│
│ mappings físico↔analítico · diagnósticos · huella del modelo │
└──────────────────────────────┬────────────────────────────────┘
                               │ mensajes versionados
┌──────────────────────────────▼────────────────────────────────┐
│                         WEB WORKER                            │
│  validación → mallado → SolverAdapter → WASM → ResultModel   │
└──────────────────────────────┬────────────────────────────────┘
                               │ resultados normalizados
         ┌─────────────────────┼─────────────────────┐
         ▼                     ▼                     ▼
┌─────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ CombinationEngine│  │ Three.js Results │  │ Check Pipelines  │
│ + envelopes      │  │ model/deformed   │  │ viga/pilar/losa  │
└─────────────────┘  └──────────────────┘  └──────────────────┘
```

### 4.1 Paquetes sugeridos

```text
src/modules/fem3d/
├── domain/                  # modelo físico, reglas e invariantes
├── analytical/              # esquema FEM agnóstico
├── compiler/                # PhysicalModel -> AnalyticalModel
│   ├── topology/
│   ├── frame/
│   ├── shell/
│   ├── loads/
│   └── mapping/
├── solvers/
│   ├── contract/
│   ├── pynite/
│   ├── mock/
│   └── reference/           # herramientas offline, no bundle web
├── results/
│   ├── model/
│   ├── combinations/
│   ├── envelopes/
│   └── queries/
├── workers/
├── visualization/
├── checks/
├── persistence/
└── validation/
```

`domain`, `analytical`, `results/model` y `solvers/contract` no deben importar Three.js, React ni una implementación de solver.

---

## 5. Convenciones globales

### 5.1 Unidades

El almacenamiento y cálculo interno usarán SI coherente:

- longitud: `m`;
- fuerza: `N`;
- momento: `N·m`;
- tensión y módulo elástico: `Pa`;
- masa: `kg`;
- densidad: `kg/m³`;
- carga lineal: `N/m`;
- carga superficial: `N/m²`.

La interfaz podrá mostrar `mm`, `kN`, `kN·m` y `MPa`, pero las conversiones ocurrirán exclusivamente en la capa de presentación o importación/exportación.

### 5.2 Sistema de coordenadas

- sistema global dextrógiro;
- `X` y `Y`: plano de planta;
- `Z`: vertical positiva hacia arriba;
- cada frame tendrá eje local `x` desde `nodeI` a `nodeJ`;
- la orientación local `y/z` se definirá mediante un vector de referencia explícito y normalizado;
- cada shell tendrá orden de nodos y normal coherentes; la cara positiva y los signos de resultantes se documentarán y visualizarán;
- nunca se inferirá silenciosamente una orientación ambigua.

Antes de conectar cualquier solver se implementarán tests que demuestren la transformación entre ejes del solver y la convención de Concreta.

### 5.3 Identidad y tolerancias

- IDs persistentes: UUID o identificadores opacos estables;
- índices densos: solo dentro del paquete enviado al solver;
- tolerancia geométrica configurable, con valor inicial propuesto de `1e-6 m` para coincidencia topológica;
- tolerancia de mallado diferente de la tolerancia de comparación numérica;
- ninguna igualdad geométrica dependerá de comparar `number` de forma exacta.

---

## 6. Modelo físico

El modelo físico representa intención constructiva y debe sobrevivir aunque cambie el mallado o el solver.

```ts
type Id = string;
type Vec3 = readonly [number, number, number];
type Polygon2 = readonly (readonly [number, number])[];

interface PhysicalModel {
  schemaVersion: number;
  projectId: Id;
  revision: number;
  storeys: Storey[];
  materials: MaterialDefinition[];
  sections: SectionDefinition[];
  columns: Column[];
  beams: Beam[];
  slabs: Slab[];
  walls: Wall[];
  supports: PhysicalSupport[];
  loadCases: LoadCase[];
  loads: PhysicalLoad[];
  analysisSettings: AnalysisSettings;
}

interface Storey {
  id: Id;
  name: string;
  elevation: number;
  levelOrder: number;
}

interface Column {
  id: Id;
  name: string;
  fromStoreyId: Id;
  toStoreyId: Id;
  axis: { start: Vec3; end: Vec3 };
  sectionId: Id;
  materialId: Id;
  orientation?: Vec3;
  endReleases?: FrameEndReleases;
}

interface Beam {
  id: Id;
  name: string;
  storeyId: Id;
  axis: readonly Vec3[];       // admite polilínea física
  sectionId: Id;
  materialId: Id;
  orientation?: Vec3;
  endReleases?: FrameEndReleases;
}

interface Slab {
  id: Id;
  name: string;
  storeyId: Id;
  boundary: Polygon2;
  openings: Polygon2[];
  elevation: number;
  thickness: number;
  materialId: Id;
  localXAxis?: readonly [number, number];
  mesh: ShellMeshSettings;
}

interface Wall {
  id: Id;
  name: string;
  fromStoreyId: Id;
  toStoreyId: Id;
  baseline: readonly Vec3[];
  openings: WallOpening[];
  thickness: number;
  materialId: Id;
  mesh: ShellMeshSettings;
}
```

### 6.1 Reglas del dominio

- las plantas tienen elevaciones únicas y ordenadas;
- ningún elemento puede referenciar materiales, secciones o plantas inexistentes;
- vigas y pilares tienen longitud positiva;
- contornos de losas y huecos son polígonos simples y válidos;
- los huecos quedan contenidos en el contorno y no se solapan;
- las liberaciones deben ser físicamente compatibles y generar advertencias ante mecanismos probables;
- cargas y apoyos se asignan a objetos físicos; la compilación decide cómo distribuirlos analíticamente;
- cada edición incrementa `revision`; un resultado pertenece a una revisión y nunca puede mostrarse como vigente sobre otra.

---

## 7. Compilador estructural

El `StructuralCompiler` es el núcleo diferencial de Concreta. Transforma intención constructiva en topología analítica reproducible.

```ts
interface StructuralCompiler {
  compile(
    physical: PhysicalModel,
    options: CompileOptions,
    signal?: AbortSignal,
  ): Promise<CompileOutput>;
}

interface CompileOutput {
  analyticalModel: AnalyticalModel;
  mapping: PhysicalAnalyticalMapping;
  diagnostics: Diagnostic[];
  stats: CompileStats;
}
```

### 7.1 Pipeline propuesto

1. validar esquema y referencias;
2. normalizar geometría y unidades;
3. detectar intersecciones y coincidencias;
4. construir grafo topológico común;
5. dividir ejes físicos en elementos frame;
6. mallar losas y muros respetando bordes, huecos y encuentros;
7. asegurar compatibilidad frame–shell;
8. crear constraints, offsets, releases y diafragmas si proceden;
9. convertir cargas físicas en cargas nodales/frame/shell;
10. construir mappings bidireccionales;
11. ejecutar validaciones previas al solver;
12. calcular huella determinista del modelo analítico.

### 7.2 Reglas esenciales de conectividad

- una viga que cruza un pilar debe generar un nudo común;
- un pilar que llega a un forjado debe conectar con la malla del forjado;
- los extremos y cruces de muros deben compartir nodos cuando geométricamente corresponda;
- las aristas de shell apoyadas en vigas deben ser compatibles con los nodos del frame o usar una constraint explícita;
- cambios de sección, liberaciones, apoyos y cargas puntuales fuerzan subdivisiones de frame;
- bordes, huecos y cargas lineales deben preservarse durante el mallado;
- no se usarán uniones por proximidad opacas: cada fusión se registrará en diagnósticos/mapping.

### 7.3 Mallado shell

El MVP puede utilizar triángulos si ese es el elemento soportado y validado por el solver inicial. El contrato permitirá triángulos y cuadriláteros para no bloquear otro solver.

```ts
interface ShellMeshSettings {
  targetSize: number;
  minSize?: number;
  maxAspectRatio?: number;
  formulationPreference?: "tri" | "quad" | "auto";
  refinementZones?: RefinementZone[];
}
```

El mallador debe ser determinista y producir métricas de calidad. Una malla inválida, invertida, degenerada o fuera de tolerancia será un error; una malla de baja calidad será una advertencia visible.

---

## 8. Modelo analítico independiente

```ts
interface AnalyticalModel {
  schemaVersion: number;
  modelId: Id;
  sourceRevision: number;
  coordinateSystem: "XYZ_Z_UP_RIGHT_HANDED";
  units: "SI";
  nodes: AnalyticalNode[];
  frameElements: FrameElement[];
  shellElements: ShellElement[];
  materials: AnalyticalMaterial[];
  sections: AnalyticalSection[];
  constraints: Constraint[];
  loadCases: AnalyticalLoadCase[];
  nodalLoads: NodalLoad[];
  frameLoads: FrameLoad[];
  shellLoads: ShellLoad[];
  mapping: PhysicalAnalyticalMapping;
  fingerprint: string;
}

interface AnalyticalNode {
  id: Id;
  position: Vec3;
  physicalRefs: PhysicalRef[];
}

interface FrameElement {
  id: Id;
  nodeI: Id;
  nodeJ: Id;
  materialId: Id;
  sectionId: Id;
  localYAxis: Vec3;
  releasesI?: DofRelease;
  releasesJ?: DofRelease;
  physicalElementId: Id;
  physicalStationRange: readonly [number, number]; // 0..1
}

interface ShellElement {
  id: Id;
  nodeIds: readonly [Id, Id, Id] | readonly [Id, Id, Id, Id];
  materialId: Id;
  thickness: number;
  localXAxis: Vec3;
  physicalElementId: Id;
}

interface DofRelease {
  ux: boolean;
  uy: boolean;
  uz: boolean;
  rx: boolean;
  ry: boolean;
  rz: boolean;
}
```

### 8.1 Mapping físico–analítico

```ts
interface PhysicalAnalyticalMapping {
  physicalToNodes: Record<Id, Id[]>;
  physicalToFrames: Record<Id, Id[]>;
  physicalToShells: Record<Id, Id[]>;
  nodeToPhysical: Record<Id, PhysicalRef[]>;
  frameToPhysical: Record<Id, PhysicalRef>;
  shellToPhysical: Record<Id, PhysicalRef>;
}

interface PhysicalRef {
  type: "column" | "beam" | "slab" | "wall" | "support";
  id: Id;
}
```

El mapping forma parte del artefacto de cálculo y se persiste con resultados. No se reconstruirá después mediante proximidad geométrica.

---

## 9. Contrato del solver

```ts
interface SolverAdapter {
  readonly info: SolverInfo;

  supports(request: SolveRequest): CapabilityReport;

  solve(
    request: SolveRequest,
    context: SolverContext,
  ): Promise<SolverRunResult>;
}

interface SolverInfo {
  id: string;
  name: string;
  adapterVersion: string;
  engineVersion: string;
  capabilities: SolverCapabilities;
}

interface SolveRequest {
  runId: Id;
  model: AnalyticalModel;
  caseIds: Id[];
  options: LinearStaticOptions;
}

interface SolverContext {
  signal: AbortSignal;
  onProgress?: (event: SolverProgress) => void;
}

interface SolverRunResult {
  status: "success" | "failed" | "cancelled";
  result?: BaseCaseResultSet;
  diagnostics: Diagnostic[];
  metadata: RunMetadata;
}

interface SolverCapabilities {
  linearStatic: boolean;
  frame3d: boolean;
  shell: boolean;
  multipleRightHandSides: boolean;
  reactions: boolean;
  frameStations: boolean;
  shellResultants: boolean;
  modal: boolean;
  geometricNonlinear: boolean;
}
```

### 9.1 Requisitos del adaptador PyNite

- traducción aislada en `solvers/pynite`;
- Pyodide, PyNite y sus paquetes se inicializan exclusivamente dentro del Worker;
- carga perezosa y cacheada del runtime Python;
- versiones exactas de Pyodide, PyNite, NumPy y SciPy fijadas y registradas;
- script Python del adaptador pequeño, auditable y cubierto por fixtures;
- conversión explícita de signos, ejes, unidades y nombres de grados de libertad;
- extracción de reacciones y de todos los resultados requeridos;
- serialización de entrada/salida mediante estructuras simples y buffers cuando aporte rendimiento;
- eliminación explícita de proxies Python/JavaScript para evitar fugas de memoria;
- funcionamiento offline si esta es una condición del producto, empaquetando los recursos necesarios;
- licencia y avisos de dependencias incluidos en la distribución;
- tests contractuales compartidos con `MockSolverAdapter`.

### 9.2 Estrategia ante capacidades no soportadas

`supports()` devolverá errores o advertencias antes de resolver. Nunca se degradará silenciosamente una placa a membrana, se ignorará una liberación o se descartará una componente de carga.

---

## 10. Decisión de motor y referencias de validación

### 10.1 Motor de producción: PyNite

PyNite es la única implementación prevista para el MVP. Su modelo de nodos, miembros, placas/quads, cargas y combinaciones resulta más cercano a un programa de edificación que un framework FEM generalista. El coste aceptado es cargar Pyodide junto con NumPy/SciPy y asumir un tiempo de inicialización y un bundle mayores que los de un núcleo WASM nativo.

Antes de la beta se fijará y auditará una versión concreta. Deben documentarse las formulaciones empleadas, las convenciones de signos, las limitaciones de los elementos y cualquier prestación no soportada. En particular, no se prometerán efectos no lineales, deformación por cortante o acoplamientos que la versión adoptada no resuelva y valide expresamente.

### 10.2 Papel de los demás programas

| Programa | Papel en el proyecto |
|---|---|
| **OOFEM** | Referencia FEM independiente para benchmarks y comparación offline. |
| **CYPE / SAP2000** | Contraste de modelos completos de edificación y regresión de resultados. |
| **Awatif** | Antecedente browser-native; no se integra en el MVP. |
| **Kratos** | Posible estudio futuro si se requieren análisis avanzados o cálculo remoto. |
| **Stabileo** | Sin papel activo; no se integra. |

No se implementarán adaptadores, pantallas de selección ni abstracciones específicas para estos motores. El único adaptador real será `PyNiteSolverAdapter`; `MockSolverAdapter` existirá exclusivamente para pruebas.

### 10.3 Plan de adopción

1. Implementar el contrato y un `MockSolverAdapter` para desarrollar la vertical inicial.
2. Crear un spike de PyNite/Pyodide con un pórtico 3D, una placa, un muro y un modelo mixto.
3. Verificar que se pueden extraer todos los resultados exigidos por el `ResultModel`.
4. Comparar con soluciones analíticas, OOFEM y modelos equivalentes en CYPE/SAP2000.
5. Fijar versiones y convertir el spike en `PyNiteSolverAdapter` solo tras superar los criterios de precisión, estabilidad, memoria y rendimiento.

---

## 11. Casos de carga, combinaciones y envolventes

### 11.1 Autoridad de combinaciones

Concreta define acciones, coeficientes, concomitancias y combinaciones. El solver no contiene lógica CTE/CE.

```ts
interface LoadCase {
  id: Id;
  name: string;
  actionType: string;
  category?: string;
  selfWeightFactor?: number;
}

interface LinearCombination {
  id: Id;
  name: string;
  limitState: "ULS" | "SLS_CHAR" | "SLS_FREQ" | "SLS_QP";
  terms: readonly { caseId: Id; factor: number }[];
  familyIds: Id[];
}

interface EnvelopeDefinition {
  id: Id;
  name: string;
  combinationIds: Id[];
  mode: "componentwise-min-max" | "signed-extreme-with-concomitants";
}
```

Para análisis lineal:

```text
R(combinación) = Σ factor(caso) · R(caso)
```

Se resolverán todos los casos simples sobre la misma topología. Si el solver permite múltiples vectores de cargas con una factorización reutilizada, el adaptador aprovechará esa capacidad.

### 11.2 Concomitancia

Una envolvente componente a componente no basta para todas las comprobaciones. El motor debe poder recuperar:

- el valor extremo;
- la combinación que lo produce;
- todos los esfuerzos concomitantes de esa combinación;
- la posición o punto de integración correspondiente.

Ejemplo: al seleccionar el máximo `My`, deben conservarse `N`, `Vy`, `Vz`, `T` y `Mz` de la misma combinación y estación, no máximos independientes.

### 11.3 Límite de superposición

La superposición solo es válida para análisis lineales compatibles. P-Delta, elementos solo tracción/compresión, contacto, plasticidad o cualquier rigidez dependiente del estado exigirán resolver cada combinación y usarán otro tipo de petición.

---

## 12. Modelo de resultados

```ts
interface BaseCaseResultSet {
  modelFingerprint: string;
  cases: Record<Id, LoadCaseResult>;
}

interface LoadCaseResult {
  nodeDisplacements: Float64Array; // [ux,uy,uz,rx,ry,rz] por nodo
  nodeReactions: Float64Array;     // misma convención
  frameResults: FrameResultBlock;
  shellResults: ShellResultBlock;
}

interface FrameResultBlock {
  elementIds: Id[];
  stationOffsets: Uint32Array;
  stations: Float64Array;          // coordenada normalizada 0..1
  values: Float64Array;            // [N,Vy,Vz,T,My,Mz] por estación
}

interface ShellResultBlock {
  elementIds: Id[];
  locations: "centroid" | "nodes" | "integration-points";
  locationOffsets: Uint32Array;
  values: Float64Array; // [Nx,Ny,Nxy,Mx,My,Mxy,Qx,Qy]
}

interface RunMetadata {
  runId: Id;
  modelFingerprint: string;
  physicalRevision: number;
  solver: SolverInfo;
  startedAt: string;
  durationMs: number;
  settings: AnalysisSettings;
}
```

### 12.1 Invariantes

- los resultados no se mezclan entre fingerprints distintos;
- todas las componentes se almacenan según signos y unidades de Concreta;
- `NaN` o infinito invalida el run;
- los arrays incluyen índices y offsets verificables;
- toda consulta física usa el mapping persistido;
- se distingue resultado en centroides, nodos o puntos de integración;
- el suavizado visual no sustituye al dato bruto usado para comprobación.

### 12.2 Consultas de alto nivel

El resto de Concreta consumirá servicios, no buffers directamente:

```ts
interface ResultQueryService {
  getFrameDiagram(input: FrameDiagramQuery): FrameDiagram;
  getFrameConcomitantAt(input: FrameExtremeQuery): FrameForceVector;
  getShellField(input: ShellFieldQuery): ShellField;
  getPhysicalElementEnvelope(input: PhysicalEnvelopeQuery): PhysicalEnvelope;
  getNodeReaction(input: ReactionQuery): ReactionVector;
}
```

---

## 13. Integración con comprobaciones existentes

La integración será un pipeline separado del solver:

```text
BaseCaseResultSet
        ↓
CombinationEngine
        ↓
ResultQueryService + physical mapping
        ↓
DesignActionExtractor
        ↓
inputs normalizados por elemento físico
        ↓
módulos existentes de Concreta
        ↓
ratios · errores · armados · informes
```

### 13.1 Frames

Para cada viga o pilar físico se reconstruye una coordenada longitudinal continua a partir de todos sus frames analíticos. Se generan estaciones en:

- extremos;
- discontinuidades;
- puntos de carga;
- máximos/mínimos internos cuando puedan recuperarse;
- puntos adicionales configurables.

Cada vector de esfuerzos tendrá `combinationId`, estación física, elemento analítico origen y convención de ejes.

### 13.2 Losas y muros

Se conservan como resultado primario:

- membrana: `Nx`, `Ny`, `Nxy`;
- flexión: `Mx`, `My`, `Mxy`;
- cortante transversal: `Qx`, `Qy`.

Transformaciones como Wood–Armer, bandas de integración, promediado o diseño de armaduras se implementarán en una capa de diseño identificable y testeada. Nunca se sobrescribirá el resultado FEM original.

---

## 14. Web Worker, WASM y rendimiento

### 14.1 Protocolo del Worker

```ts
type FemWorkerRequest =
  | { type: "init"; requestId: Id }
  | { type: "compile-and-solve"; requestId: Id; payload: SolveJob }
  | { type: "cancel"; requestId: Id; targetRequestId: Id };

type FemWorkerResponse =
  | { type: "ready"; requestId: Id; solver: SolverInfo }
  | { type: "progress"; requestId: Id; event: SolverProgress }
  | { type: "success"; requestId: Id; payload: SolveArtifact }
  | { type: "failure"; requestId: Id; diagnostics: Diagnostic[] }
  | { type: "cancelled"; requestId: Id };
```

Etapas de progreso sugeridas: `validating`, `compiling`, `meshing`, `assembling`, `factorizing`, `solving-cases`, `extracting-results`, `building-envelopes`.

### 14.2 Reglas de ejecución

- el runtime Pyodide y los paquetes Python se cargan bajo demanda dentro del Worker;
- la UI puede cancelar un job mediante `AbortSignal` y mensaje de cancelación;
- si Pyodide/PyNite no puede interrumpir con seguridad un cálculo, se termina el Worker y se crea otro;
- se ignora cualquier respuesta cuyo `requestId` ya no sea vigente;
- los grandes buffers se transfieren con `Transferable`, no se duplican;
- se controla explícitamente el límite de memoria y se muestran diagnósticos comprensibles;
- la compilación puede cachearse por fingerprint;
- combinaciones y visualizaciones deben reutilizar resultados base sin relanzar el solver.

### 14.3 Presupuesto inicial de rendimiento

Estos objetivos deben ajustarse tras medir dispositivos reales:

- la interacción 3D no debe bloquearse más de 50 ms por tarea en el hilo principal;
- el Worker debe emitir progreso o estado al menos por cada etapa relevante;
- la inicialización de WASM se realiza una vez por sesión/Worker;
- un modelo de aceptación de tamaño medio debe completar en menos de 10 s en un portátil moderno;
- la memoria pico se registra automáticamente en benchmarks cuando la plataforma lo permita;
- la visualización no crea un objeto Three.js por elemento si puede usar geometrías agrupadas o instanciadas.

---

## 15. Visualización con Three.js

### 15.1 Capas de escena

1. modelo físico;
2. modelo analítico y numeración;
3. apoyos, liberaciones y cargas;
4. malla shell;
5. deformada;
6. reacciones;
7. diagramas de frame;
8. mapas de shell;
9. incidencias y diagnósticos.

Cada capa podrá activarse, filtrarse por planta y consultarse mediante picking.

### 15.2 Deformada

- escala automática y manual;
- visualización original + deformada;
- interpolación de frames usando desplazamientos/giros cuando exista información suficiente;
- shells deformados con los desplazamientos nodales, sin alterar el resultado almacenado;
- leyenda con factor de amplificación y combinación/caso activo.

### 15.3 Diagramas de frame

Se mostrarán `N`, `Vy`, `Vz`, `T`, `My` y `Mz` con:

- signo y eje local visibles;
- escala común o automática;
- valores en estaciones seleccionables;
- envolvente máxima/mínima;
- identificación de combinación gobernante y concomitantes;
- continuidad sobre el elemento físico aunque esté subdividido analíticamente.

### 15.4 Mapas shell

Se mostrarán `Nx`, `Ny`, `Nxy`, `Mx`, `My`, `Mxy`, `Qx` y `Qy` con:

- paleta perceptualmente uniforme y leyenda numérica;
- rango automático, simétrico o manual;
- dato bruto por elemento como opción de ingeniería;
- suavizado nodal únicamente como representación visual y claramente indicado;
- orientación de ejes locales visible;
- selección de cara/signo cuando sea relevante;
- identificación de combinación gobernante por punto/elemento.

---

## 16. Diagnósticos y experiencia de usuario

```ts
interface Diagnostic {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  physicalRefs?: PhysicalRef[];
  analyticalIds?: Id[];
  details?: Record<string, unknown>;
  suggestedAction?: string;
}
```

Ejemplos obligatorios:

- nudo o elemento desconectado;
- elemento de longitud/área casi nula;
- shell invertido o degenerado;
- material o sección ausente;
- carga sin destino analítico;
- apoyo insuficiente y mecanismo probable;
- matriz singular o mal condicionada;
- capacidad no soportada por el solver;
- resultado no finito;
- modelo modificado después del último cálculo;
- malla que no converge al refinarse dentro de la tolerancia definida.

Los errores deben señalar visualmente el objeto físico afectado. No se debe exponer al usuario únicamente un índice interno del solver.

---

## 17. Persistencia y versionado

Se guardarán por separado:

- `PhysicalModel` como fuente editable;
- ajustes de compilación/mallado;
- `AnalyticalModel` como artefacto regenerable o cache;
- `SolveArtifact` con versión de solver, fingerprint y resultados;
- definiciones de combinaciones y envolventes;
- resultados derivados de comprobaciones.

Cada esquema tendrá `schemaVersion` y migraciones. Los resultados antiguos solo se reutilizarán si coinciden:

- fingerprint analítico;
- versión relevante del compilador;
- solver y versión;
- opciones numéricas;
- conjunto de casos resueltos.

---

## 18. Estrategia de validación

La validación es parte del producto, no una actividad final.

### 18.1 Pirámide de pruebas

**Nivel 1 — Unidades y transformaciones**

- conversión de unidades;
- ejes locales/globales y signos;
- rotación de fuerzas y resultantes;
- mapping de estaciones;
- combinación lineal y concomitancia.

**Nivel 2 — Casos analíticos**

- barra axial;
- voladizo a flexión y torsión;
- viga biapoyada con carga puntual y distribuida;
- pórtico 2D/3D;
- parche de membrana;
- placa simplemente apoyada;
- patch tests de shell;
- equilibrio global de reacciones.

**Nivel 3 — Benchmarks FEM**

- benchmarks publicados compatibles con la formulación utilizada;
- sensibilidad y convergencia de malla;
- pruebas de cuerpos rígidos y energía cuando proceda.

**Nivel 4 — Comparación cruzada**

- OOFEM como referencia FEM independiente;
- modelos equivalentes en CYPE y SAP2000;
- comparación de desplazamientos, reacciones, frecuencias futuras y esfuerzos.

**Nivel 5 — Edificios de regresión**

- pórtico pequeño;
- edificio regular de varias plantas;
- edificio con losa y hueco;
- edificio con muros y acoplamiento frame–shell;
- modelo con cargas horizontales y torsión global.

### 18.2 Tolerancias

Las tolerancias se definirán por caso, magnitud y referencia. Valores iniciales orientativos:

- equilibrio global de fuerzas/momentos: error relativo `≤ 1e-8` en casos bien condicionados;
- casos analíticos de frame: `≤ 0.1 %` para desplazamientos y reacciones;
- esfuerzos de frame comparados en las mismas estaciones: `≤ 0.5 %`;
- shells: tolerancia definida por benchmark y malla, acompañada de estudio de convergencia;
- comparación con programas comerciales: tolerancia explicada teniendo en cuenta formulación, offsets, mallado, rigideces y convenciones.

No se aprobará una diferencia solo porque “parece pequeña”. Todo caso tendrá entrada, referencia, tolerancia, resultado y explicación.

### 18.3 Golden files

Los fixtures versionarán:

- modelo físico mínimo;
- modelo analítico esperado o invariantes estructurales;
- resultado de referencia;
- versión del motor de referencia;
- tolerancias;
- notas de modelado.

Los archivos binarios de resultados no deben ser la única evidencia; se incluirán resúmenes legibles con equilibrio y extremos.

---

## 19. Seguridad y robustez

- validar todos los datos antes de pasarlos a WASM;
- poner límites configurables a nodos, elementos, casos y memoria;
- tratar el solver como un componente que puede fallar;
- capturar panics/excepciones del Worker sin perder el proyecto del usuario;
- no evaluar código de usuario;
- usar hashes para detectar resultados obsoletos, no como frontera de seguridad;
- registrar telemetría técnica solo con la política de privacidad del producto;
- permitir exportar un paquete reproducible de diagnóstico sin datos innecesarios.

---

## 20. Roadmap propuesto

### Fase 0 — Spike de PyNite en navegador (1–2 semanas)

- congelar convenciones de unidades, ejes y signos;
- revisar y fijar las versiones y licencias de Pyodide, PyNite, NumPy y SciPy;
- resolver cuatro modelos mínimos: frame, placa, muro y mixto;
- extraer todas las componentes requeridas por el `ResultModel`;
- medir descarga, inicialización, tiempo de cálculo y memoria;
- verificar cancelación, reinicio del Worker y liberación de proxies;
- contrastar con soluciones analíticas, OOFEM, CYPE o SAP2000;
- documentar limitaciones y condiciones de uso de PyNite.

**Salida:** versión fijada de PyNite, informe de viabilidad y prototipo aislado que demuestre el flujo completo en navegador.

### Fase 1 — Núcleo agnóstico (2–4 semanas)

- esquemas `PhysicalModel`, `AnalyticalModel` y `ResultModel`;
- validadores y convenciones;
- `SolverAdapter` y `MockSolverAdapter`;
- Worker versionado;
- fingerprint, diagnósticos y pruebas unitarias.

**Salida:** pipeline ejecutable con resultados simulados sin dependencia del solver real.

### Fase 2 — Frames 3D lineales (3–5 semanas)

- compilación de pilares y vigas;
- intersecciones, subdivisiones, apoyos y releases;
- materiales y secciones;
- cargas nodales y de barra;
- adaptador de producción;
- desplazamientos, reacciones y diagramas;
- combinaciones y envolventes;
- integración inicial de comprobaciones de vigas/pilares.

### Fase 3 — Shells y modelo mixto (4–7 semanas)

- losas y muros con huecos;
- mallado determinista y métricas de calidad;
- conectividad frame–shell;
- cargas superficiales;
- resultantes de membrana, flexión y cortante;
- mapas Three.js;
- pruebas de convergencia y benchmarks.

### Fase 4 — Flujo de edificio y UX (3–5 semanas)

- edición por plantas;
- filtros, selección y diagnósticos gráficos;
- gestión completa de cargas y combinaciones;
- persistencia/migraciones;
- progreso, cancelación y recuperación de fallos;
- modelos de ejemplo y documentación.

### Fase 5 — Integración de diseño y endurecimiento (4–8 semanas)

- extractores para todos los módulos existentes;
- concomitancia y envolventes de diseño;
- Wood–Armer u otras transformaciones validadas;
- regresión CYPE/SAP2000;
- benchmarks de rendimiento en equipos objetivo;
- auditoría numérica y revisión previa a beta.

### Evolución posterior

- diafragmas rígidos y constraints avanzadas;
- análisis modal y sísmico;
- P-Delta con estrategia explícita de combinaciones;
- offsets/excentricidades y zonas rígidas;
- importación/exportación IFC;
- solver remoto opcional para modelos grandes o análisis no lineales;
- estudio de un motor avanzado o remoto únicamente si aparece una necesidad no cubierta por PyNite.

---

## 21. Criterios de aceptación del MVP

### Arquitectura

- [ ] Ningún paquete de dominio, combinaciones, comprobaciones o visualización importa tipos del solver.
- [ ] Es posible ejecutar los tests con `MockSolverAdapter` y sustituir el adaptador por configuración.
- [ ] Cada resultado incluye fingerprint, revisión física y versión del solver.
- [ ] Todos los frames/shells analíticos tienen trazabilidad a un elemento físico.

### Modelado y compilación

- [ ] Se puede crear un edificio con varias plantas, vigas, pilares, losas, muros y huecos.
- [ ] Intersecciones y encuentros generan conectividad analítica verificable.
- [ ] Las cargas físicas se convierten sin pérdidas ni destinos huérfanos.
- [ ] La compilación es determinista para la misma entrada y opciones.
- [ ] Las mallas inválidas se rechazan con diagnóstico vinculado al objeto físico.

### Cálculo

- [ ] El análisis ocurre fuera del hilo principal y puede cancelarse.
- [ ] Se resuelven varios casos simples en una ejecución lógica.
- [ ] Se obtienen desplazamientos, reacciones y las seis componentes de frame.
- [ ] Se obtienen las ocho resultantes shell requeridas.
- [ ] Una singularidad produce un error comprensible, no resultados parciales presentados como válidos.
- [ ] Se cumplen los benchmarks analíticos y de equilibrio definidos.

### Combinaciones y comprobaciones

- [ ] Concreta combina resultados base sin repetir el análisis lineal.
- [ ] Las envolventes registran combinación gobernante y concomitantes.
- [ ] Un elemento físico subdividido produce un diagrama continuo y consultable.
- [ ] Los módulos existentes reciben entradas normalizadas y trazables.

### Visualización

- [ ] Se alterna entre modelo físico, analítico, original y deformado.
- [ ] Se muestran diagramas `N/V/T/M` con ejes y signos documentados.
- [ ] Se muestran mapas de las ocho resultantes shell con leyenda y unidades.
- [ ] El usuario puede seleccionar un punto/elemento y conocer valor, caso/combinación y origen físico.
- [ ] El suavizado visual está separado del dato de cálculo.

### Rendimiento y estabilidad

- [ ] La UI permanece interactiva durante un cálculo de aceptación.
- [ ] Los buffers grandes se transfieren sin copias innecesarias.
- [ ] Repetir, cancelar y relanzar cálculos no aumenta la memoria de forma continua.
- [ ] Un resultado queda marcado como obsoleto inmediatamente al editar el modelo.
- [ ] Un edificio de aceptación de tamaño medio cumple el presupuesto de tiempo acordado en los dispositivos objetivo.

---

## 22. Primer backlog para Claude Code

Orden recomendado para iniciar el repositorio:

1. localizar la arquitectura actual de Concreta y sus convenciones de estado, IDs, unidades y tests;
2. crear un ADR con las decisiones de este documento;
3. implementar tipos y validadores de `PhysicalModel` mínimos para plantas, vigas y pilares;
4. implementar `AnalyticalModel`, mappings y diagnósticos;
5. definir `SolverAdapter` y su suite de tests contractuales;
6. crear `MockSolverAdapter` con un resultado determinista;
7. crear el Worker y una prueba de cancelación/respuesta obsoleta;
8. implementar un compilador mínimo de un pórtico 3D;
9. conectar un visor Three.js sencillo para nodos, frames y deformada simulada;
10. ejecutar el spike de PyNite/Pyodide en una rama aislada;
11. fijar versiones, documentar limitaciones y convertir el spike validado en el adaptador de producción.

### Prompt de arranque sugerido

```text
Lee este documento y examina primero la arquitectura real del repositorio.
No implementes todavía el solver real. Propón un plan incremental que adapte
PhysicalModel, AnalyticalModel, SolverAdapter y ResultModel a las convenciones
existentes del proyecto. Identifica decisiones incompatibles, dependencias y
riesgos. Después implementa únicamente la primera vertical slice: un pórtico 3D
mínimo, compilado a un modelo analítico, resuelto mediante MockSolverAdapter en
un Web Worker y representado en el visor. Añade tests de unidades, ejes,
trazabilidad, cancelación y resultados obsoletos. No introduzcas todavía PyNite
fuera de un spike aislado ni expongas sus tipos en el dominio.
```

---

## 23. Riesgos abiertos y preguntas que deben resolverse en el spike

1. ¿Qué formulación exacta usan `Member3D`, `Plate3D` y `Quad3D` en la versión fijada de PyNite?
2. ¿Cuál de los elementos de placa/shell se adoptará para losas y muros y qué limitaciones tiene?
3. ¿Entrega `Nx`, `Ny`, `Nxy`, `Mx`, `My`, `Mxy`, `Qx` y `Qy` en los puntos y ejes requeridos o habrá que transformar/derivar componentes?
4. ¿Permite recuperar diagramas internos de frames con suficiente resolución y sus valores concomitantes?
5. ¿Reutiliza ensamblado o factorización para varios casos simples, o conviene crear una capa optimizada alrededor de su API?
6. ¿Cómo representa releases, offsets, orientación de secciones y ejes locales?
7. ¿Qué versiones funcionan de forma reproducible en Pyodide y pueden empaquetarse para uso offline?
8. ¿Qué tiempo de carga, memoria y tamaño de modelo son razonables en los dispositivos objetivo?
9. ¿Se liberan correctamente los proxies y la memoria tras cálculos repetidos o cancelados?
10. ¿Qué estrategia de mallado se adoptará y qué restricciones impone el elemento shell disponible?
11. ¿Cómo se conectarán frame y shell: nodos conformes, constraints multipunto o ambos?
12. ¿Qué partes de los módulos de comprobación actuales esperan signos/unidades distintos?
13. ¿Cuál será el formato de persistencia compatible con el almacenamiento actual de Concreta?

Estas preguntas pueden cambiar la implementación del adaptador, el mallador o el alcance de algunas prestaciones, pero PyNite sigue siendo la decisión de motor del MVP. Si una capacidad no puede validarse, se excluye explícitamente de esa versión en vez de añadir inmediatamente otro solver.

---

## 24. Definición de terminado para una versión beta

La beta estará lista cuando un usuario pueda modelar un edificio pequeño mediante elementos constructivos, inspeccionar el modelo analítico generado, resolver casos lineales en el navegador, obtener combinaciones y envolventes, explorar deformadas/diagramas/mapas, lanzar comprobaciones existentes y reproducir el resultado con una trazabilidad completa. Además, la batería de validación deberá demostrar el comportamiento esperado en casos analíticos, benchmarks y modelos equivalentes de CYPE/SAP2000.

La calidad del módulo no se medirá por el número de tipos de análisis disponibles, sino por la claridad del modelo, la independencia del solver, la estabilidad del cálculo y la confianza que aporten sus pruebas.
