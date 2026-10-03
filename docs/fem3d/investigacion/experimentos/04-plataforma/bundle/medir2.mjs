// Incremento (min+gzip) de cada complemento sobre el núcleo three de b_three_min.
import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { readdirSync } from "node:fs";
async function gz(entry) {
  const r = await build({ entryPoints: [entry], bundle: true, minify: true, format: "esm", write: false, logLevel: "silent", define: { "process.env.NODE_ENV": '"production"' } });
  return gzipSync(Buffer.from(r.outputFiles[0].contents), { level: 9 }).length;
}
const base = await gz("entries2/base.js");
console.log(`base (three núcleo típico): ${(base / 1024).toFixed(1)} KiB gz`);
for (const f of readdirSync("entries2").filter((f) => f !== "base.js")) console.log(`+ ${f.padEnd(20)} ${((await gz("entries2/" + f) - base) / 1024).toFixed(1).padStart(6)} KiB gz`);
