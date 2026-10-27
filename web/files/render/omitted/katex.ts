// Stands in for KaTeX, which only a label with `$$ math $$` loads (vite.config.ts).
export default {
  renderToString(): string {
    throw new Error("Math in diagrams is not included.");
  },
};
