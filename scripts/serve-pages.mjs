import {createServer} from 'node:http'
import {readFile, stat} from 'node:fs/promises'
import {join, resolve, extname, sep} from 'node:path'

const dist = resolve('dist')
const base = '/Poker-Chips-Online/'
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'}
createServer(async (request, response) => {
  const path = new URL(request.url || '/', 'http://localhost').pathname
  if (!path.startsWith(base)) { response.writeHead(404).end(); return }
  const relative = decodeURIComponent(path.slice(base.length)) || 'index.html'
  const file = resolve(join(dist, relative))
  const safe = file.startsWith(dist + sep) || file === dist
  if (!safe) { response.writeHead(400).end(); return }
  let target = file, status = 200
  try { if (!(await stat(target)).isFile()) throw Error('not file') }
  catch { target = join(dist, '404.html'); status = 404 }
  const bytes = await readFile(target)
  response.writeHead(status, {'content-type':types[extname(target)] || 'application/octet-stream','cache-control':'no-store'})
  response.end(bytes)
}).listen(4173, '127.0.0.1', () => console.log('Pages fixture at http://127.0.0.1:4173' + base))
