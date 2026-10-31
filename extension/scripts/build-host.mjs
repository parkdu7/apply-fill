// native host를 파일 하나(host/dist/host.mjs)로 묶는다. ws도 같이 넣어서 node만 있으면 돈다.
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await build({
  entryPoints: [path.join(root, 'host', 'src', 'main.ts')],
  outfile: path.join(root, 'host', 'dist', 'host.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  logLevel: 'warning',
  legalComments: 'none',
  // ws(CommonJS)가 require('events') 등을 쓴다
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
console.log('host/dist/host.mjs');
