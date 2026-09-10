import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import { cdnAdapter } from "@vinext/cloudflare/cache/cdn-adapter";
import { imagesOptimizer } from "@vinext/cloudflare/images/images-optimizer";
import { knowledgeRuntime } from "./scripts/knowledge-runtime.js";

export default defineConfig({
  // gl-bench's browser entry is UMD; Cosmos expects its actual ESM default export.
  resolve: { alias: { "gl-bench": "gl-bench/dist/gl-bench.module.js" } },
  plugins: [
    knowledgeRuntime(),
    vinext({
      cache: { cdn: cdnAdapter() },
      images: { optimizer: imagesOptimizer() },
    }),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
});
