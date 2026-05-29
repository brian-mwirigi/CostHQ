const fs = require('fs');
const path = require('path');
const { minify } = require('terser');

const proDir = path.join(__dirname, '../dist/pro');

async function processDirectory(dir) {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      await processDirectory(fullPath);
    } else if (fullPath.endsWith('.js')) {
      const code = fs.readFileSync(fullPath, 'utf8');
      const result = await minify(code, {
        mangle: {
          toplevel: true,
        },
        compress: {
          drop_console: true,
          passes: 2,
        },
      });
      if (result.code) {
        fs.writeFileSync(fullPath, result.code, 'utf8');
        console.log(`Minified ${path.relative(__dirname, fullPath)}`);
      }
    } else if (fullPath.endsWith('.js.map') || fullPath.endsWith('.d.ts.map')) {
      fs.unlinkSync(fullPath);
      console.log(`Deleted source map ${path.relative(__dirname, fullPath)}`);
    }
  }
}

async function run() {
  console.log('Minifying Pro features...');
  try {
    await processDirectory(proDir);
    console.log('Minification complete.');
  } catch (err) {
    console.error('Minification failed:', err);
    process.exit(1);
  }
}

run();
