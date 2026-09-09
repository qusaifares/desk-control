import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // Workspace packages are source-only, so they are bundled in. Runtime deps
  // stay external and are installed normally (keeps the ARM64 story simple).
  noExternal: [/^@desk-control\//],
});
