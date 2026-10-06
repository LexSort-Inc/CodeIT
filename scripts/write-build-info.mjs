// Stamp dist/build-info.json so the app can show which commit it was built from.
// Run as part of `npm run build`. Never committed (dist/ is gitignored).
import { execSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';

let commit = 'dev';
try { commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(); } catch {}
const info = { commit, date: new Date().toISOString() };
mkdirSync('dist', { recursive: true });
writeFileSync('dist/build-info.json', JSON.stringify(info));
console.log(`build-info: ${commit}`);
