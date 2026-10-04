# Concreta FEM 3D

Motor de cálculo por elementos finitos 3D para edificios. Se desarrolla para integrarlo después en Concreta, donde sus resultados alimentarán los módulos de comprobación.

- **Estado:** superados el spike E0, la fase E1 (núcleo del motor: GDL, restricciones, ensamblado, diagnósticos y equilibrio), la fase E2 (barras de Timoshenko con offsets, liberaciones, cargas de barra y diagramas), la fase E3 (láminas DKMQ24 con multiplicadores, cargas de lámina y resultantes en ejes de usuario), la fase E4 (worker, memoria y límites por dispositivo) y la fase E5 (cortes por fuerzas nodales, bandas y campos de lámina recuperados por SPR con Q por equilibrio) ([spike-e0.md](docs/fem3d/spike-e0.md), [fase-e1.md](docs/fem3d/fase-e1.md), [fase-e2.md](docs/fem3d/fase-e2.md), [fase-e3.md](docs/fem3d/fase-e3.md), [fase-e4.md](docs/fem3d/fase-e4.md), [fase-e5.md](docs/fem3d/fase-e5.md)); lo siguiente es E6 (endurecimiento).
- **Arquitectura prevista:**
  - en TypeScript: elementos (lámina DKMQ24, barra de Timoshenko), restricciones por transformación, ensamblado y recuperación de esfuerzos;
  - en un núcleo Rust con `faer` compilado a WebAssembly: la factorización LDLᵀ supernodal;
  - todo ello en un Web Worker, con `ClienteMotor` (`src/worker/`) en el hilo principal.
- **Unidades:** kN y m.
- **Uso:** `bun install`, `bun run test:run` y `bun run nucleo:verificar` (el último necesita Rust; los tests, no).
- **Documentos:**
  - [docs/fem3d/investigacion-id.md](docs/fem3d/investigacion-id.md): investigación de I+D con índice. Se lee primero el índice y luego sólo la sección que haga falta;
  - [docs/fem3d/diseno-tecnico.md](docs/fem3d/diseno-tecnico.md): diseño técnico v0.1;
  - [docs/fem3d/spike-e0.md](docs/fem3d/spike-e0.md): resultado del spike E0;
  - [docs/fem3d/fase-e1.md](docs/fem3d/fase-e1.md): resultado de la fase E1 (núcleo del motor);
  - [docs/fem3d/fase-e2.md](docs/fem3d/fase-e2.md): resultado de la fase E2 (barras);
  - [docs/fem3d/fase-e3.md](docs/fem3d/fase-e3.md): resultado de la fase E3 (láminas);
  - [docs/fem3d/fase-e4.md](docs/fem3d/fase-e4.md): resultado de la fase E4 (worker y memoria).
  - [docs/fem3d/fase-e5.md](docs/fem3d/fase-e5.md): resultado de la fase E5 (Q y bandas).

Repositorio público, sin licencia de uso: todos los derechos reservados.
