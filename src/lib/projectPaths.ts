export function normalizeProjectPath(value: string): string {
  const path = value.trim();
  if (/^[A-Za-z]:[\\/]+$/.test(path)) {
    return path.slice(0, 3);
  }
  if (/^[\\/]+$/.test(path)) {
    return path.slice(0, 1);
  }
  return path.replace(/[\\/]+$/, "");
}
