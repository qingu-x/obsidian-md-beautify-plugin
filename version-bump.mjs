import { readFileSync, writeFileSync } from 'fs';

const targetVersion = process.env.npm_package_version;

// 更新 manifest.json
const manifest = JSON.parse(readFileSync('src/assets/manifest.json', 'utf8'));
manifest.version = targetVersion;
writeFileSync('src/assets/manifest.json', JSON.stringify(manifest, null, '\t'));

// 更新 versions.json (Obsidian 用于版本追踪)
let versions = {};
try {
    versions = JSON.parse(readFileSync('versions.json', 'utf8'));
} catch (e) {}
versions[targetVersion] = manifest.minAppVersion;
writeFileSync('versions.json', JSON.stringify(versions, null, '\t'));

console.log(`Version bumped to ${targetVersion} in manifest.json and versions.json`);
