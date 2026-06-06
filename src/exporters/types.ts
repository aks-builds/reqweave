/** Exporter contract: IR + variants in, tool-native files out. */
import type { Ir } from "../ir/index.js";
import type { RequestVariant } from "../variants/index.js";
import type { SupportedTool } from "../constants.js";

export interface ExportOptions {
  /** Default value written into env templates for {{baseUrl}}. */
  baseUrl?: string;
  /** Stamp for formats that record an export time (kept explicit for determinism). */
  generatedAt?: string;
}

export interface ExportedFile {
  /** Repo/disk-relative path, POSIX separators. */
  path: string;
  content: string;
}

export interface ExportContext {
  ir: Ir;
  variants: RequestVariant[];
  options: Required<ExportOptions>;
}

export interface Exporter {
  id: SupportedTool;
  /** File/dir label used in output messages. */
  label: string;
  export(ctx: ExportContext): ExportedFile[];
}

export const DEFAULT_BASE_URL = "http://localhost:5000";
export const DEFAULT_GENERATED_AT = "1970-01-01T00:00:00Z";
