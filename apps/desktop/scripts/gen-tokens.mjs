// Regenerates the theme token blocks in src/styles/index.css from
// scripts/tokens/config.mjs. Usage: node scripts/gen-tokens.mjs [--check]
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { themes } from './tokens/config.mjs';
import { validateTheme, renderTokens } from './tokens/lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cssPath = path.resolve(__dirname, '../src/styles/index.css');
const check = process.argv.includes('--check');

const errors = themes.flatMap(validateTheme);
if (errors.length > 0) {
  console.error('Token validation failed:');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

const current = readFileSync(cssPath, 'utf8');
let next = current;
for (const theme of themes) {
  const re = new RegExp(
    `(/\\* @generated:tokens ${theme.name} [^*]*\\*/)[\\s\\S]*?(\\n\\s*/\\* @generated:tokens end \\*/)`
  );
  if (!re.test(next)) {
    console.error(`Marker block for theme "${theme.name}" not found in ${cssPath}`);
    process.exit(1);
  }
  next = next.replace(re, `$1\n${renderTokens(theme)}$2`);
}

if (check) {
  if (next !== current) {
    console.error('gen-tokens --check: index.css is out of date. Run `pnpm gen:tokens`.');
    process.exit(1);
  }
  console.log('gen-tokens --check: clean.');
} else if (next !== current) {
  writeFileSync(cssPath, next);
  console.log('index.css theme tokens regenerated.');
} else {
  console.log('index.css already up to date.');
}
