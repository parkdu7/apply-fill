// esbuild로 서버(dist/index.js)와 페이지 주입 번들(dist/dom.js)을 만든다.
// --fixtures: 테스트용 MUI 지원서(test/fixtures/mui/bundle.js)도 빌드
import { build } from 'esbuild';

const common = { bundle: true, logLevel: 'warning', legalComments: 'none' };
const jobs = [
  build({
    ...common,
    entryPoints: ['src/index.ts'],
    outfile: 'dist/index.js',
    platform: 'node',
    format: 'esm',
    target: 'node20',
    packages: 'external',
    banner: { js: '#!/usr/bin/env node' },
  }),
  build({
    ...common,
    entryPoints: ['src/dom/index.ts'],
    outfile: 'dist/dom.js',
    platform: 'browser',
    format: 'iife',
    target: 'chrome110',
  }),
];

if (process.argv.includes('--fixtures')) {
  for (const app of ['mui', 'careerlink', 'meritz']) {
    jobs.push(
      build({
        ...common,
        entryPoints: [`test/fixtures/${app}/app.tsx`],
        outfile: `test/fixtures/${app}/bundle.js`,
        platform: 'browser',
        format: 'iife',
        target: 'chrome110',
        jsx: 'automatic',
        minify: true,
        define: { 'process.env.NODE_ENV': '"production"' },
      }),
    );
  }
}

await Promise.all(jobs);
