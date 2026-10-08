import { readFileSync, writeFileSync } from 'node:fs';
const path = new URL('../apps/client/android/app/build.gradle',import.meta.url);
let text=readFileSync(path,'utf8');
text=text.replace(/versionCode \d+/,`versionCode ${Number(process.env.YAMIDE_VERSION_CODE??1)}`).replace(/versionName "[^"]+"/,'versionName "0.1.0-alpha.1"');
writeFileSync(path,text);
