import type { Plugin } from "vite";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { gzipSync } from "node:zlib";

// Compressed WASM stays below the hosting asset-size limit. No graph data or
// credentials are sent to a CDN; both runtime files are served with the app.
export function knowledgeRuntime(): Plugin {
  const require = createRequire(import.meta.url);
  const moduleId = "virtual:knowledge-runtime", resolvedId = `\0${moduleId}`;
  let development = false;
  let assets: { name: string; bytes: Buffer; type: string }[] | undefined;
  const files = () => assets ||= [
    { name: "duckdb-mvp.wasm.gz", bytes: gzipSync(readFileSync(require.resolve("@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm")), { level: 9 }), type: "application/octet-stream" },
    { name: "duckdb-browser-mvp.worker.js", bytes: readFileSync(require.resolve("@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js")), type: "text/javascript" },
  ];
  return {
    name: "knowledge-runtime",
    configResolved(config) { development = config.command === "serve"; },
    resolveId(id) { if (id === moduleId) return resolvedId; },
    load(id) {
      if (id !== resolvedId) return;
      return files().map((file, index) => {
        const value = development ? JSON.stringify(`/knowledge-runtime/${file.name}`) : `import.meta.ROLLUP_FILE_URL_${this.emitFile({ type: "asset", name: file.name, source: file.bytes })}`;
        return `export const ${index ? "workerUrl" : "wasmUrl"} = ${value};`;
      }).join("\n");
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith("/knowledge-runtime/")) return next();
        const file = files().find(item => request.url?.split("?")[0] === `/knowledge-runtime/${item.name}`);
        if (!file) return next();
        response.setHeader("Content-Type", file.type); response.end(file.bytes);
      });
    },
  };
}
