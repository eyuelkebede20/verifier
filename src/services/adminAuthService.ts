import crypto from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

// Default development key if none configured in .env
const DEFAULT_DEV_ADMIN_KEY = 'senay_admin_dev_secret_2026';

/**
 * Derives the active secret used for HMAC session signing.
 */
function getSigningSecret(): Buffer {
  const secret = process.env.ADMIN_KEY || process.env.ADMIN_SECRET || DEFAULT_DEV_ADMIN_KEY;
  return crypto.createHash('sha256').update(`${secret}_senay_session_salt_v1`).digest();
}

/**
 * Securely verifies whether the provided key matches the configured admin key or hash.
 * Uses SHA-256 digests and crypto.timingSafeEqual to prevent timing attacks.
 */
export function verifyMasterKey(inputKey: string): boolean {
  if (!inputKey || typeof inputKey !== 'string') {
    return false;
  }

  const trimmedInput = inputKey.trim();
  if (trimmedInput.length === 0) {
    return false;
  }

  const inputHash = crypto.createHash('sha256').update(trimmedInput).digest();

  // 1. Check against ADMIN_KEY_HASH if configured (SHA-256 hex)
  const envKeyHash = process.env.ADMIN_KEY_HASH?.trim();
  if (envKeyHash) {
    try {
      const expectedBuffer = Buffer.from(envKeyHash, 'hex');
      if (expectedBuffer.length === inputHash.length && crypto.timingSafeEqual(inputHash, expectedBuffer)) {
        return true;
      }
    } catch (_) {
      // Ignore hex decode failure
    }
  }

  // 2. Check against ADMIN_KEY or ADMIN_SECRET in .env
  const masterKey = (process.env.ADMIN_KEY || process.env.ADMIN_SECRET || '').trim();
  if (masterKey) {
    const expectedHash = crypto.createHash('sha256').update(masterKey).digest();
    if (crypto.timingSafeEqual(inputHash, expectedHash)) {
      return true;
    }
  }

  // 3. In non-production, allow fallback dev key if no keys set in .env
  if (!masterKey && !envKeyHash && process.env.NODE_ENV !== 'production') {
    const devHash = crypto.createHash('sha256').update(DEFAULT_DEV_ADMIN_KEY).digest();
    if (crypto.timingSafeEqual(inputHash, devHash)) {
      logger.warn('[AUTH] Authenticated using DEFAULT development admin key. Please set ADMIN_KEY in .env for production.');
      return true;
    }
  }

  return false;
}

/**
 * Creates a signed HMAC session token valid for 7 days.
 */
export function createSessionToken(): string {
  const payload = {
    role: 'admin',
    iat: Date.now(),
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
    nonce: crypto.randomBytes(8).toString('hex'),
  };

  const payloadBase64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', getSigningSecret())
    .update(payloadBase64)
    .digest('base64url');

  return `${payloadBase64}.${signature}`;
}

/**
 * Verifies an admin HMAC session token.
 */
export function verifySessionToken(token: string): boolean {
  if (!token || typeof token !== 'string') {
    return false;
  }

  const parts = token.trim().split('.');
  if (parts.length !== 2) {
    return false;
  }

  const [payloadBase64, signature] = parts;

  try {
    const expectedSignature = crypto
      .createHmac('sha256', getSigningSecret())
      .update(payloadBase64)
      .digest('base64url');

    const sigA = Buffer.from(signature);
    const sigB = Buffer.from(expectedSignature);

    if (sigA.length !== sigB.length || !crypto.timingSafeEqual(sigA, sigB)) {
      return false;
    }

    const jsonStr = Buffer.from(payloadBase64, 'base64url').toString('utf8');
    const payload = JSON.parse(jsonStr);

    if (payload.role !== 'admin' || typeof payload.exp !== 'number' || payload.exp < Date.now()) {
      return false;
    }

    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Express middleware to guard all /api/admin/* endpoints.
 */
export function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
  // 1. Check Bearer token or x-admin-token
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const customToken = (req.headers['x-admin-token'] as string | undefined)?.trim();
  const token = bearerToken || customToken;

  if (token && verifySessionToken(token)) {
    return next();
  }

  // 2. Alternatively check direct admin key in x-admin-key header
  const directKey = (req.headers['x-admin-key'] as string | undefined)?.trim();
  if (directKey && verifyMasterKey(directKey)) {
    return next();
  }

  logger.warn(`[ADMIN] Unauthorized admin endpoint access attempt: ${req.method} ${req.path}`);
  res.status(401).json({
    success: false,
    error: 'Unauthorized: Admin authentication required. Provide valid admin session token or admin key.',
  });
}
