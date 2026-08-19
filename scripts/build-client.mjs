/** Build the client bundle in the module-loader shape the DSH Web shell serves. */
import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'

const ID = 'dsh-better-reasoning-effort'
const BANNER = `window.__ModuleLoader__.load({
\tid: "${ID}",
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
`
const FOOTER = `
\t\treturn module.exports;
\t}
});
`

await build({
  entryPoints: ['src/client/index.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  jsx: 'automatic',
  jsxImportSource: 'react',
  target: 'es2020',
  sourcemap: true,
  minify: true,
  external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
  outfile: 'lib/client.js',
  banner: { js: BANNER },
  footer: { js: FOOTER },
})

const content = await readFile('lib/client.js', 'utf8')
if (!content.startsWith('window.__ModuleLoader__.load({')) {
  throw new Error('client bundle wrapper missing __ModuleLoader__.load preamble')
}
console.log(`built lib/client.js (${content.length} bytes)`)
