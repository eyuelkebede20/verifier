import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const stageDir = path.join(rootDir, 'dist-cpanel');
const rootAppDir = path.join(stageDir, 'verifier');
const bundleDir = path.join(rootAppDir, 'app');
const zipFile = path.join(rootDir, 'verifier-cpanel-bundle.zip');

console.log('🚀 Starting Senay Verifier CloudLinux/Passenger Packager for verifier.senaycreatives.com...');

// 1. Build TypeScript application
console.log('🔨 Step 1: Compiling TypeScript microservice (tsc)...');
execSync('npx tsc', { stdio: 'inherit', cwd: rootDir, shell: true });

// 2. Clean previous staging directories and old bundle zip
console.log('🧹 Step 2: Preparing clean staging directories...');
try {
  if (fs.existsSync(stageDir)) {
    fs.rmSync(stageDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
} catch (e) {
  console.warn('⚠️ Staging directory locked, continuing with clean overwrite.');
}

try {
  if (fs.existsSync(zipFile)) {
    fs.rmSync(zipFile, { force: true, maxRetries: 3, retryDelay: 200 });
  }
} catch (e) {}

fs.mkdirSync(bundleDir, { recursive: true });

// 3. Copy compiled dist to bundleDir/dist
console.log('📦 Step 3: Copying compiled backend to app/dist...');
const serverDist = path.join(rootDir, 'dist');
fs.cpSync(serverDist, path.join(bundleDir, 'dist'), { recursive: true });

// 4. Generate clean standalone production package.json
console.log('📦 Step 4: Generating production package.json...');
const rootPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const prodPkg = {
  name: rootPkg.name || 'senay-verifier-api',
  version: rootPkg.version || '3.1.0',
  main: 'dist/index.js',
  scripts: {
    start: 'node dist/index.js'
  },
  dependencies: { ...rootPkg.dependencies }
};
delete prodPkg.dependencies.mentalweg;

fs.writeFileSync(path.join(bundleDir, 'package.json'), JSON.stringify(prodPkg, null, 2), 'utf8');
fs.writeFileSync(path.join(rootAppDir, 'package.json'), JSON.stringify(prodPkg, null, 2), 'utf8');

// 5. Install self-contained production node_modules with Linux x64 binaries inside app/
console.log('📦 Step 5: Installing production node_modules inside app/node_modules (Linux x64)...');
execSync('npm install --omit=dev --no-audit --no-fund --os=linux --cpu=x64', {
  cwd: bundleDir,
  stdio: 'inherit',
  shell: true
});

// 6. Populate Root Directory files (at api/verifier/)
console.log('📦 Step 6: Configuring Passenger shim, logs, and restart trigger...');

// Ensure tmp/restart.txt exists for Passenger restart trigger
const tmpDir = path.join(rootAppDir, 'tmp');
fs.mkdirSync(tmpDir, { recursive: true });
const gitSha = process.env.GITHUB_SHA || '';
fs.writeFileSync(path.join(tmpDir, 'restart.txt'), `restart ${gitSha || Date.now()}\n`, 'utf8');

// Ensure logs directory exists
const logsDir = path.join(rootAppDir, 'logs');
fs.mkdirSync(logsDir, { recursive: true });

// Ensure root .htaccess exists
const htaccessFile = path.join(rootAppDir, '.htaccess');
fs.writeFileSync(htaccessFile, '# CloudLinux Passenger Configuration\nDirectoryIndex disabled\n', 'utf8');

// Copy app.cjs startup shim
const appCjsSource = path.join(rootDir, 'app.cjs');
if (fs.existsSync(appCjsSource)) {
  fs.copyFileSync(appCjsSource, path.join(rootAppDir, 'app.cjs'));
}

// Copy app.js bridge
const appJsSource = path.join(rootDir, 'app.js');
if (fs.existsSync(appJsSource)) {
  fs.copyFileSync(appJsSource, path.join(rootAppDir, 'app.js'));
}

// Copy .env.example
const envExampleSource = path.join(rootDir, '.env.example');
if (fs.existsSync(envExampleSource)) {
  fs.copyFileSync(envExampleSource, path.join(rootAppDir, '.env.example'));
}

// 7. Create Zip Bundle (Optional offline archive for manual cPanel File Manager upload)
console.log('🗜️ Step 7: Generating verifier-cpanel-bundle.zip archive...');
try {
  if (fs.existsSync(zipFile)) {
    fs.rmSync(zipFile, { force: true });
  }
  execSync(`tar -a -c -f "${zipFile}" -C "${stageDir}" "verifier"`, {
    stdio: 'ignore',
    cwd: rootDir,
    shell: true
  });
  console.log(`🎉 SUCCESS: Generated ${zipFile}`);
} catch (err) {
  console.log('ℹ️ Note: Staged directory dist-cpanel/verifier is ready for direct FTP upload.');
}

console.log(`
========================================================================
✅ CLOUDLINUX / CPANEL COMPLIANT BUNDLE READY FOR VERIFIER!
========================================================================
Archive: verifier-cpanel-bundle.zip
Folder:  dist-cpanel/verifier/

On-disk layout inside /api/verifier/:
  /api/verifier/                  ◄── Application Root (CloudLinux owns root node_modules symlink)
  ├── app.cjs                     ◄── Passenger startup shim (boots ./app/dist/index.js)
  ├── app.js                      ◄── Fallback forwarder to app.cjs
  ├── tmp/restart.txt             ◄── Touch to restart app
  ├── logs/                       ◄── Daily rotating logs
  ├── .env.example
  ├── .htaccess
  └── app/                        ◄── Real production bundle in subfolder (NO symlink collisions!)
      ├── package.json
      ├── dist/                   ◄── Compiled verifier microservice
      └── node_modules/           ◄── Real production dependencies with Linux x64 binaries
========================================================================
`);
