import type { Ir } from "../ir/index.js";
import type { RequestVariant } from "../variants/index.js";
import type { SupportedTool } from "../constants.js";
import {
  type Exporter,
  type ExportedFile,
  type ExportOptions,
  type ExportContext,
  DEFAULT_BASE_URL,
  DEFAULT_GENERATED_AT,
} from "./types.js";
import { postmanExporter } from "./postman.js";
import { openapiExporter } from "./openapi.js";
import { insomniaExporter } from "./insomnia.js";
import { brunoExporter } from "./bruno.js";
import { hoppscotchExporter } from "./hoppscotch.js";
import { thunderExporter } from "./thunder.js";
import { httpExporter } from "./http.js";

export const EXPORTERS: Record<SupportedTool, Exporter> = {
  postman: postmanExporter,
  openapi: openapiExporter,
  insomnia: insomniaExporter,
  bruno: brunoExporter,
  hoppscotch: hoppscotchExporter,
  "thunder-client": thunderExporter,
  http: httpExporter,
};

export function getExporter(tool: SupportedTool): Exporter {
  return EXPORTERS[tool];
}

export interface ExportRequest {
  ir: Ir;
  variants: RequestVariant[];
  tools: SupportedTool[];
  options?: ExportOptions;
}

/**
 * Run the requested exporters. Each exporter is isolated: if one throws, it
 * yields an error file instead of sinking the rest. Output is deterministic.
 */
export function exportCollections(req: ExportRequest): ExportedFile[] {
  const ctx: ExportContext = {
    ir: req.ir,
    variants: req.variants,
    options: {
      baseUrl: req.options?.baseUrl ?? DEFAULT_BASE_URL,
      generatedAt: req.options?.generatedAt ?? DEFAULT_GENERATED_AT,
    },
  };

  const files: ExportedFile[] = [];
  for (const tool of req.tools) {
    const exporter = EXPORTERS[tool];
    if (!exporter) continue;
    try {
      files.push(...exporter.export(ctx));
    } catch (e) {
      files.push({ path: `errors/${tool}.error.txt`, content: `${(e as Error).message}\n` });
    }
  }
  return files;
}

export * from "./types.js";
