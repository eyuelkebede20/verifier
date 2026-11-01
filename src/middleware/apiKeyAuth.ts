import { Request, Response, NextFunction } from 'express';
import apiKeyService from '../services/apiKeyService';
import logger from '../utils/logger';

// Helper to get allowed API keys from environment (legacy fallback)
function getAllowedKeys(): Set<string> {
  const keys = new Set<string>();

  if (process.env.API_KEYS) {
    process.env.API_KEYS.split(',')
      .map((k) => k.trim())
      .filter(Boolean)
      .forEach((k) => keys.add(k));
  }

  if (process.env.VERIFIER_API_KEY?.trim()) {
    keys.add(process.env.VERIFIER_API_KEY.trim());
  }

  if (process.env.STATIC_API_KEY?.trim()) {
    keys.add(process.env.STATIC_API_KEY.trim());
  }

  if (process.env.ADMIN_SECRET?.trim()) {
    keys.add(process.env.ADMIN_SECRET.trim());
  }

  if (process.env.ADMIN_KEY?.trim()) {
    keys.add(process.env.ADMIN_KEY.trim());
  }

  return keys;
}

export const apiKeyAuth = (req: Request, res: Response, next: NextFunction): void => {
  // 1. Allow public health, root, admin UI & APIs, static assets, and public web verify endpoints
  if (
    req.path === '/' ||
    req.path === '/health' ||
    req.path === '/api/public-verify' ||
    req.path === '/admin' ||
    req.path.startsWith('/admin/') ||
    req.path.startsWith('/api/admin') ||
    (req.path.startsWith('/verify') && req.method === 'GET') ||
    req.path.startsWith('/static') ||
    req.path.endsWith('.html') ||
    req.path.endsWith('.css') ||
    req.path.endsWith('.js') ||
    req.path.endsWith('.svg') ||
    req.path.endsWith('.ico') ||
    req.path.endsWith('.png')
  ) {
    return next();
  }

  // 2. Extract API key from headers or query
  const rawAuthHeader = req.headers.authorization;
  const bearerKey = rawAuthHeader?.startsWith('Bearer ') ? rawAuthHeader.slice(7).trim() : null;
  const headerKey = (req.headers['x-api-key'] as string | undefined)?.trim();
  const queryKey = (req.query.apiKey as string | undefined)?.trim();

  const candidateKey = headerKey || bearerKey || queryKey;

  if (!candidateKey) {
    // If no keys configured at all and in development mode, allow with warning
    const allowedKeys = getAllowedKeys();
    if (allowedKeys.size === 0 && process.env.NODE_ENV !== 'production') {
      logger.warn(`[AUTH] No API_KEYS set in environment. Allowing request in ${process.env.NODE_ENV || 'dev'} mode.`);
      (req as any).appContext = { appName: 'Development Unauthenticated Client' };
      return next();
    }

    logger.warn(`[AUTH] Unauthorized request to ${req.method} ${req.path} - missing API key`);
    res.status(401).json({
      success: false,
      error: 'API key is required. Pass via x-api-key header or Authorization: Bearer <key>',
    });
    return;
  }

  // 3. Validate against apiKeyService (dynamic app keys + environment keys)
  const validation = apiKeyService.validateKey(candidateKey);
  if (validation.valid) {
    (req as any).apiKey = candidateKey;
    (req as any).appContext = {
      appName: validation.appName || 'Client Application',
      keyId: validation.keyId,
    };
    return next();
  }

  // 4. Secondary fallback: check static allowed keys
  const allowedKeys = getAllowedKeys();
  if (allowedKeys.has(candidateKey)) {
    (req as any).apiKey = candidateKey;
    (req as any).appContext = {
      appName: 'Master / Env Key',
    };
    return next();
  }

  logger.warn(`[AUTH] Invalid API key attempt: ${candidateKey.slice(0, 6)}...`);
  res.status(403).json({
    success: false,
    error: 'Forbidden: Invalid API key',
  });
};
