// Vue Router accepts trailing slashes and matches routes without case sensitivity.
// Apply the same rules to both router paths and browser paths under the Pages base.
export function isGameRoute(pathname: string, base = '/'): boolean {
  const normalize = (value: string) => value.split(/[?#]/, 1)[0].replace(/\/+$/, '').toLowerCase()
  let path = normalize(pathname)
  const prefix = normalize(base)
  if (prefix && path.startsWith(prefix + '/')) path = path.slice(prefix.length)
  return path === '/local' || path === '/room' || path.startsWith('/room/')
}
