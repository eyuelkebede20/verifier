// Phusion Passenger / LiteSpeed / CloudLinux Node.js Selector startup shim
const path = require('node:path');
const fs = require('node:fs');

process.env.NODE_ENV = process.env.NODE_ENV || 'production';
process.env.NODE_OPTIONS = process.env.NODE_OPTIONS || '--disable-wasm-trap-handler';

// 1. Resolve candidate paths for node_modules (support isolated ./app/node_modules and root node_modules)
const appDir = path.resolve(__dirname, 'app');
const appNodeModules = path.join(appDir, 'node_modules');
const rootNodeModules = path.join(__dirname, 'node_modules');
const candidatePaths = [appNodeModules, rootNodeModules];

// Search for CloudLinux nodevenv lib/node_modules if present
try {
  const homeDir = process.env.HOME || '/home/senaycre';
  const nodevenvBase = path.join(homeDir, 'nodevenv', 'api', 'verifier');
  if (fs.existsSync(nodevenvBase)) {
    const versions = fs.readdirSync(nodevenvBase);
    for (const v of versions) {
      const vPath = path.join(nodevenvBase, v, 'lib', 'node_modules');
      if (fs.existsSync(vPath)) candidatePaths.push(vPath);
    }
  }
} catch (_) {}

process.env.NODE_PATH = candidatePaths.concat(process.env.NODE_PATH || '').filter(Boolean).join(path.delimiter);
require('node:module').Module._initPaths();

// 2. Load .env
try {
  const dotenvCandidate = candidatePaths
    .map(p => path.join(p, 'dotenv'))
    .find(p => fs.existsSync(p));
  if (dotenvCandidate) {
    const dotenv = require(dotenvCandidate);
    const envCandidates = [
      path.join(__dirname, '.env'),
      path.join(appDir, '.env'),
      path.resolve(__dirname, '..', '.env')
    ];
    for (const envFile of envCandidates) {
      if (fs.existsSync(envFile)) {
        dotenv.config({ path: envFile, override: true });
        break;
      }
    }
  }
} catch (_) {}

// 3. Ensure logs directory exists
const logsDir = path.join(__dirname, 'logs');
try {
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
} catch (_) {}

// 4. Ensure tmp directory exists
const tmpDir = path.join(__dirname, 'tmp');
try {
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
} catch (_) {}

// 5. Forward to compiled application with error boundary
try {
  const entryCandidates = [
    path.join(appDir, 'dist', 'index.js'),
    path.join(__dirname, 'dist', 'index.js')
  ];
  const targetEntry = entryCandidates.find(p => fs.existsSync(p));
  if (!targetEntry) {
    throw new Error('Could not find compiled dist/index.js in ./app/dist or ./dist');
  }
  require(targetEntry);
} catch (err) {
  const errorLog = path.join(__dirname, 'startup-error.log');
  fs.writeFileSync(errorLog, '[ ' + new Date().toISOString() + ' ] Server startup failed:\n' + (err.stack || err) + '\n', 'utf8');
  console.error('[Fatal Startup Error]', err);
  process.exit(1);
}
