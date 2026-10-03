// Mide min+gzip (y brotli) de cada entrada con esbuild y con rolldown (el
// empaquetador de Vite 8). react/react-dom/scheduler son external (ya están en
// el bundle principal de Concreta). Uso: node medir.mjs
import { build } from "esbuild";
import { rolldown } from "rolldown";
import { gzipSync, brotliCompressSync, constants } from "node:zlib";
import { readdirSync } from "node:fs";

const REACT = ["react", "react-dom", "react-dom/client", "react/jsx-runtime", "scheduler"];
const entries = readdirSync("entries").filter((f) => f.endsWith(".js")).sort();

function kib(n) {
  return (n / 1024).toFixed(1).padStart(7);
}

async function viaEsbuild(entry, external) {
  const r = await build({
    entryPoints: [`entries/${entry}`],
    bundle: true,
    minify: true,
    format: "esm",
    write: false,
    treeShaking: true,
    target: "es2022",
    external,
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
  });
  return Buffer.from(r.outputFiles[0].contents);
}

async function viaRolldown(entry, external) {
  const b = await rolldown({
    input: `entries/${entry}`,
    external: (id) => external.some((e) => id === e || id.startsWith(e + "/")),
    transform: { define: { "process.env.NODE_ENV": '"production"' } },
    logLevel: "silent",
  });
  const out = await b.generate({ format: "esm", minify: true, codeSplitting: false });
  await b.close();
  return Buffer.from(out.output[0].code);
}

const rows = [];
for (const entry of entries) {
  for (const [modo, ext] of [
    ["todo (salvo react)", REACT],
    ["sin three (incremental)", [...REACT, "three"]],
  ]) {
    if (modo.startsWith("sin three") && !/r3f|drei/.test(entry)) continue;
    for (const [tool, fn] of [
      ["esbuild", viaEsbuild],
      ["rolldown", viaRolldown],
    ]) {
      try {
        const buf = await fn(entry, ext);
        const gz = gzipSync(buf, { level: 9 }).length;
        const br = brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
        rows.push({ entry, modo, tool, min: buf.length, gz, br });
      } catch (e) {
        rows.push({ entry, modo, tool, err: String(e.message).slice(0, 160) });
      }
    }
  }
}
console.log("entrada                          modo                      tool      min KiB  gzip KiB  br KiB");
for (const r of rows) {
  if (r.err) console.log(`${r.entry.padEnd(32)} ${r.modo.padEnd(25)} ${r.tool.padEnd(8)} ERROR ${r.err}`);
  else console.log(`${r.entry.padEnd(32)} ${r.modo.padEnd(25)} ${r.tool.padEnd(8)} ${kib(r.min)} ${kib(r.gz)} ${kib(r.br)}`);
}
