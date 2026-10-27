export function diagramFiles(manifest: Record<string, { file: string; css?: string[]; imports?: string[]; dynamicImports?: string[]; isEntry?: boolean }>): Set<string>;
