// 1) Compila Patrones.tsx con babel-plugin-react-compiler 1.0.0 y registra, por
//    función, si se compiló o se saltó (y por qué).
// 2) Pasa ESLint con eslint-plugin-react-hooks 7.0.1 `recommended` (la config del repo).
import { transformFileAsync } from "@babel/core";
import { ESLint } from "eslint";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const eventos = [];
await transformFileAsync("compilador/Patrones.tsx", {
  babelrc: false,
  configFile: false,
  parserOpts: { plugins: ["typescript", "jsx"] },
  plugins: [["babel-plugin-react-compiler", {
    panicThreshold: "none",
    logger: { logEvent: (_f, e) => eventos.push(e) },
  }]],
});
console.log("== React Compiler 1.0.0");
for (const e of eventos) {
  if (e.kind === "CompileSuccess") console.log(`  OK      ${e.fnName}`);
  else if (e.kind === "CompileError") {
    const d = e.detail; const msg = (d?.options?.reason || d?.reason || d?.message || JSON.stringify(d)).toString().slice(0, 160);
    console.log(`  SALTADO ${e.fnLoc?.start?.line ?? "?"}: ${msg}`);
  } else if (e.kind === "CompileSkip" || e.kind === "PipelineError") console.log(`  ${e.kind} ${e.fnName ?? ""} ${(e.reason || e.data || "").toString().slice(0, 140)}`);
}

const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [
    { files: ["**/*.tsx"], languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } } },
    reactHooks.configs.flat.recommended,
  ],
});
const [r] = await eslint.lintFiles(["compilador/Patrones.tsx"]);
console.log("\n== eslint-plugin-react-hooks 7.0.1 (recommended)");
for (const m of r.messages) console.log(`  L${m.line} ${m.ruleId}: ${m.message.split("\n")[0].slice(0, 170)}`);
