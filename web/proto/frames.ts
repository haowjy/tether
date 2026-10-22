// Binary frames, daemon-core.md §5.4. Big-endian; the first byte is the kind.

export type Frame =
  | { kind: "output"; watch: number; bytes: Uint8Array }
  | { kind: "snapshot"; watch: number; cols: number; rows: number; restore: Uint8Array };

const OUTPUT = 0x01;
const SNAPSHOT = 0x02;

/** Throws on a short frame or an unknown kind: both are protocol errors. */
export function decodeFrame(buf: ArrayBuffer): Frame {
  const view = new DataView(buf);
  const need = (n: number): void => {
    if (buf.byteLength < n) throw new Error(`short frame: ${String(buf.byteLength)} < ${String(n)}`);
  };
  need(5);
  const kind = view.getUint8(0);
  const watch = view.getUint32(1);
  switch (kind) {
    case OUTPUT:
      return { kind: "output", watch, bytes: new Uint8Array(buf, 5) };
    case SNAPSHOT:
      need(9);
      return {
        kind: "snapshot",
        watch,
        cols: view.getUint16(5),
        rows: view.getUint16(7),
        restore: new Uint8Array(buf, 9),
      };
    default:
      throw new Error(`unknown frame kind 0x${kind.toString(16)}`);
  }
}
