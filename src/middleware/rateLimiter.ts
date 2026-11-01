import { Request, Response, NextFunction } from 'express';

const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_MINUTE = parseInt(process.env.RATE_LIMIT_PER_MINUTE || '120', 10);

const store = new Map<string, { count: number; windowStart: number }>();

// Periodic cleanup of expired rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now - entry.windowStart > WINDOW_MS) {
      store.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

export const rateLimiter = (req: Request, res: Response, next: NextFunction): void => {
  // Allow health, root, admin console, and static assets to bypass verification rate limiter
  if (
    req.path === '/' ||
    req.path === '/health' ||
    req.path === '/admin' ||
    req.path.startsWith('/admin/') ||
    req.path.startsWith('/api/admin')
  ) {
    return next();
  }

  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const apiKey = (req as any).apiKey || '';
  const clientKey = apiKey ? `key:${apiKey}` : `ip:${ip}`;

  const now = Date.now();
  const entry = store.get(clientKey);

  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    store.set(clientKey, { count: 1, windowStart: now });
    return next();
  }

  entry.count++;
  if (entry.count > MAX_REQUESTS_PER_MINUTE) {
    const retryAfter = Math.ceil((entry.windowStart + WINDOW_MS - now) / 1000);
    res.setHeader('Retry-After', retryAfter);
    res.status(429).json({
      success: false,
      error: `Too many verification requests. Rate limit is ${MAX_REQUESTS_PER_MINUTE} req/min. Please retry in ${retryAfter}s.`,
    });
    return;
  }

  next();
};
