import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { context } from 'esbuild';

const outdir = 'dist';
const uiTemplatePath = 'src/ui.html';
const uiBundlePath = `${outdir}/ui.js`;
const uiHtmlOutPath = `${outdir}/ui.html`;

async function writeInlinedUiHtml() {
  const [template, uiBundle] = await Promise.all([
    readFile(uiTemplatePath, 'utf8'),
    readFile(uiBundlePath, 'utf8')
  ]);

  const html = template.replace('<!-- UI_SCRIPT -->', `<script>${uiBundle}</script>`);
  await writeFile(uiHtmlOutPath, html, 'utf8');
}

await mkdir(outdir, { recursive: true });

const codeContext = await context({
  entryPoints: ['src/code.ts'],
  outfile: `${outdir}/code.js`,
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: ['es2017'],
  define: {
    'process.env.NODE_ENV': '"production"'
  },
  minify: true,
  sourcemap: true,
  logLevel: 'info'
});

const uiContext = await context({
  entryPoints: ['src/ui.tsx'],
  outfile: `${outdir}/ui.js`,
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: ['es2017'],
  define: {
    'process.env.NODE_ENV': '"production"'
  },
  minify: true,
  sourcemap: true,
  logLevel: 'info',
  plugins: [
    {
      name: 'inline-ui-html',
      setup(build) {
        build.onEnd(async (result) => {
          if (result.errors.length > 0) {
            return;
          }
          await writeInlinedUiHtml();
        });
      }
    }
  ]
});

await Promise.all([codeContext.watch(), uiContext.watch()]);

console.log('Watching for changes...');
