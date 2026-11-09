/**
 * Punto de entrada del servidor MCP en el paquete de Claude Desktop (`scripts/paquete-mcpb.ts`,
 * `docs/fem3d/agente.md` §13.4). `cli/mcp.ts` sólo arranca solo con `import.meta.main`, que el Node
 * que trae Claude Desktop puede no tener; aquí se arranca siempre (`servir` es idempotente).
 */
import { servir } from "./mcp.ts";

servir();
