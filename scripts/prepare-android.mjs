import { readFileSync, writeFileSync } from 'node:fs';
const path = new URL('../apps/client/android/app/build.gradle', import.meta.url);
const versionCode = Number(process.env.YAMIDE_VERSION_CODE ?? 1);
if (!Number.isInteger(versionCode) || versionCode < 1) throw new Error('Invalid version code');
let text = readFileSync(path, 'utf8');
text = text.replace(/versionCode \d+/, `versionCode ${versionCode}`)
  .replace(/versionName "[^"]+"/, `versionName "0.1.0-alpha.${versionCode}"`);
writeFileSync(path, text);
