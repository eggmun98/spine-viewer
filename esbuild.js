const fs = require('fs');
const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

// The Spine Runtimes License requires the notice to travel with any redistribution.
// esbuild drops the runtime's own header because it carries no @license marker, so
// prepend it explicitly.
const spineLicense = fs.readFileSync('LICENSE-spine-runtimes.txt', 'utf8').trim();
const banner = `/*!\n@license\n${spineLicense}\n\nPixi.js is MIT licensed. https://github.com/pixijs/pixijs\n*/`;

const options = {
  entryPoints: ['src/runtime.js'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'browser',
  outfile: 'media/runtime.js',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  legalComments: 'inline',
  banner: { js: banner },
  logLevel: 'info',
};

async function main() {
  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    return;
  }

  await esbuild.build(options);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
