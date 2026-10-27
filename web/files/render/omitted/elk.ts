// Stands in for elkjs (1.4 MB raw) so the build doesn't ship it (vite.config.ts aliases it here):
// Mermaid still holds a dynamic import of it for the `elk` layout. `layout` is a `secure` key
// locked to dagre (mermaid.ts), so a document asking for ELK is drawn with dagre and never reaches this.
export default function ELK(): never {
  throw new Error("The ELK layout is not included.");
}
