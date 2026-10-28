export const BUDGETS: Record<"terminalFont" | "symbolsFont" | "shell" | "shellFiles" | "diagrams" | "file" | "embedRaw" | "embedFiles", number>;
export function findCopyViolations(text: string): string[];
export function findColourPrimitiveUses(path: string, text: string): string[];
export function findColourLiterals(path: string, text: string): string[];
/** The startup bundle, gzipped. Recorded, not capped (client-architecture.md §8.4). */
export function initialSizes(
  files: { path: string; bytes: number; gz: number }[],
  manifest: Record<string, { file: string; isEntry?: boolean; imports?: string[]; css?: string[] }>,
): { js: number; css: number };
export function budgetBreaches(
  files: { path: string; bytes: number; gz: number }[],
  manifest: Record<string, { file: string; isEntry?: boolean; imports?: string[]; css?: string[] }>,
): string[];
