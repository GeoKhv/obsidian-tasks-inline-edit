import esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'main.js',
  platform: 'browser',
  format: 'cjs',
  target: 'es2022',
  external: ['obsidian', '@codemirror/view', '@codemirror/state'],
  sourcemap: false,
});

await esbuild.build({
  entryPoints: ['src/line.ts'],
  bundle: true,
  outfile: 'tests/line.mjs',
  platform: 'node',
  format: 'esm',
  target: 'node20',
});

await esbuild.build({
  entryPoints: ['src/tasks-adapter.ts'],
  bundle: true,
  outfile: 'tests/tasks-adapter.mjs',
  platform: 'node',
  format: 'esm',
  target: 'node20',
});
