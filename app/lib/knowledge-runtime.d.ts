declare module "virtual:knowledge-runtime" { export const wasmUrl: string; export const workerUrl: string; }
interface ImportMeta { readonly env: { readonly VITE_COSMOGRAPH_LICENSE_KEY?: string } }
