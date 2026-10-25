// Path arithmetic on the daemon's `/`-separated canonical paths.

export const parentOf = (path: string): string => path.slice(0, Math.max(1, path.lastIndexOf("/")));
export const baseName = (path: string): string => path.slice(path.lastIndexOf("/") + 1) || "/";
export const join = (dir: string, name: string): string => (dir.endsWith("/") ? dir + name : `${dir}/${name}`);

/** `/a/repo` holds `/a/repo/x` but not `/a/repo2`: compared by component, as fs.md does. */
export function within(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith("/") ? root : `${root}/`);
}
