/**
 * Build the host half as a bundled ESM: the plugin's own modules (knowledge)
 * are inlined, while harness packages stay external — the profile composer
 * supplies them, so the bundle never pins a harness version.
 */
import { build } from 'esbuild'
await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  sourcemap: true,
  external: ['@deepseek-ai/*'],
  outfile: 'lib/index.js',
})
console.log('built lib/index.js')
