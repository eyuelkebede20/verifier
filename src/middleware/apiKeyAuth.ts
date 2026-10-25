import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

// Helper to get allowed API keys from environment
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

  return keys;
}

export const apiKeyAuth = (req: Request, res: Response, next: NextFunction): void => {
  // 1. Allow public health & root endpoints
  if (req.path === '/' || req.path === '/health') {
    return next();
  }

  const allowedKeys = getAllowedKeys();

  // If no keys configured at all in .env, allow with warning in development
  if (allowedKeys.size === 0) {
    if (process.env.NODE_ENV !== 'production') {
      logger.warn(`[AUTH] No API_KEYS set in environment. Allowing request in ${process.env.NODE_ENV || 'dev'} mode.`);
      return next();
    }
    res.status(500).json({
      success: false,
      error: 'Server configuration error: No API keys configured in environment.',
    });
    return;
  }

  // 2. Extract API key from headers or query
  const rawAuthHeader = req.headers.authorization;
  const bearerKey = rawAuthHeader?.startsWith('Bearer ') ? rawAuthHeader.slice(7).trim() : null;
  const headerKey = (req.headers['x-api-key'] as string | undefined)?.trim();
  const queryKey = (req.query.apiKey as string | undefined)?.trim();

  const candidateKey = headerKey || bearerKey || queryKey;

  if (!candidateKey) {
    logger.warn(`[AUTH] Unauthorized request to ${req.method} ${req.path} - missing API key`);
    res.status(401).json({
      success: false,
      error: 'API key is required. Pass via x-api-key header or Authorization: Bearer <key>',
    });
    return;
  }

  // 3. Validate against allowed keys
  if (!allowedKeys.has(candidateKey)) {
    logger.warn(`[AUTH] Invalid API key attempt: ${candidateKey.slice(0, 6)}...`);
    res.status(403).json({
      success: false,
      error: 'Forbidden: Invalid API key',
    });
    return;
  }

  (req as any).apiKey = candidateKey;
  next();
};
