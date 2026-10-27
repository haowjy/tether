// Stands in for elkjs (1.4 MB raw), which Mermaid loads only for the `elk` layout; diagrams use
// `dagre`, so a document that asks for `layout: elk` fails with the "couldn't render" note (vite.config.ts).
export default function ELK(): never {
  throw new Error("The ELK layout is not included.");
}
