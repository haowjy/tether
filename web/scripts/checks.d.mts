export const BUDGETS: Record<"initialJs" | "initialCss" | "terminalFont" | "symbolsFont" | "shell" | "shellFiles" | "file", number>;
export function findCopyViolations(text: string): string[];
export function findColourPrimitiveUses(path: string, text: string): string[];
export function budgetBreaches(
  files: { path: string; bytes: number; gz: number }[],
  manifest: Record<string, { file: string; isEntry?: boolean; imports?: string[]; css?: string[] }>,
): string[];
