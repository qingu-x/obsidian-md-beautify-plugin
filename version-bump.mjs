import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

// 直接从 package.json 读取最新版本号，确保可靠性
const pkgPath = 'package.json';
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const targetVersion = pkg.version;

console.log(`Reading target version ${targetVersion} from package.json`);

// 更新 manifest.json
const manifestPath = 'src/assets/manifest.json';
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.version = targetVersion;
writeFileSync(manifestPath, JSON.stringify(manifest, null, '\t') + '\n');

// 更新 versions.json (Obsidian 用于版本追踪)
const versionsPath = 'versions.json';
let versions = {};
try {
    versions = JSON.parse(readFileSync(versionsPath, 'utf8'));
} catch (e) {}
versions[targetVersion] = manifest.minAppVersion;
writeFileSync(versionsPath, JSON.stringify(versions, null, '\t') + '\n');

console.log(`Version bumped to ${targetVersion} in manifest.json and versions.json`);
