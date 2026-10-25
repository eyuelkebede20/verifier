// Phusion Passenger / LiteSpeed / CloudLinux Node.js Selector startup shim
const path = require('node:path');
const fs = require('node:fs');

process.env.NODE_ENV = process.env.NODE_ENV || 'production';

// 1. Resolve and bind node_modules paths
const rootNodeModules = path.resolve(__dirname, 'node_modules');
const candidatePaths = [rootNodeModules];

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
  const dotenv = require('dotenv');
  dotenv.config({ path: path.join(__dirname, '.env') });
} catch (_) {}

// 3. Ensure logs directory exists
const logsDir = path.join(__dirname, 'logs');
try {
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
} catch (_) {}

// 4. Forward to compiled application
require(path.join(__dirname, 'dist', 'index.js'));
