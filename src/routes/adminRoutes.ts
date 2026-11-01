import { Router, Request, Response } from 'express';
import {
  verifyMasterKey,
  createSessionToken,
  requireAdminAuth,
} from '../services/adminAuthService';
import apiKeyService from '../services/apiKeyService';
import usageTrackerService from '../services/usageTrackerService';
import receiptCache from '../utils/receiptCache';
import logger from '../utils/logger';

const router = Router();

/**
 * 1. Admin Login
 * Checks master admin key or hash from request against .env (or Unkey Root Key)
 */
router.post('/login', (req: Request, res: Response): void => {
  const { key } = req.body;

  if (!key || typeof key !== 'string') {
    res.status(400).json({ success: false, error: 'Please enter the admin master key.' });
    return;
  }

  const isValid = verifyMasterKey(key);
  if (!isValid) {
    logger.warn('[ADMIN] Failed admin login attempt.');
    res.status(401).json({
      success: false,
      error: 'Invalid admin master key. Please verify your secret in .env (ADMIN_KEY / UNKEY_ROOT_KEY).',
    });
    return;
  }

  const token = createSessionToken();
  logger.info('[ADMIN] Admin successfully authenticated.');
  res.json({
    success: true,
    token,
    message: 'Authentication successful.',
  });
});

/**
 * 2. Verify Session / WhoAmI
 */
router.get('/me', requireAdminAuth, (_req: Request, res: Response): void => {
  res.json({
    success: true,
    authenticated: true,
    role: 'admin',
    user: 'Senay Developer / Admin',
    headlessManager: process.env.UNKEY_ROOT_KEY ? 'unkey' : 'local',
  });
});

/**
 * 3. List All App Keys
 */
router.get('/keys', requireAdminAuth, (_req: Request, res: Response): void => {
  const keys = apiKeyService.listKeys();
  res.json({
    success: true,
    keys,
  });
});

/**
 * 4. Generate New App Key
 */
router.post('/keys', requireAdminAuth, async (req: Request, res: Response): Promise<void> => {
  const { name, description, rateLimit } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ success: false, error: 'Application name is required.' });
    return;
  }

  try {
    const result = await apiKeyService.generateKey({
      name: name.trim(),
      description: description ? String(description).trim() : undefined,
      rateLimit: rateLimit ? Number(rateLimit) : undefined,
    });

    res.status(201).json({
      success: true,
      message: 'API key successfully generated. Copy and store it securely.',
      key: result.key,
      rawKey: result.rawKey,
    });
  } catch (err: any) {
    logger.error('Failed to generate API key:', err);
    res.status(500).json({ success: false, error: 'Failed to generate API key' });
  }
});

/**
 * 5. Toggle Key Status (Active <-> Revoked)
 */
router.patch('/keys/:id/toggle', requireAdminAuth, async (req: Request, res: Response): Promise<void> => {
  const id = String(req.params.id);
  const updated = await apiKeyService.toggleKeyStatus(id);

  if (!updated) {
    res.status(404).json({
      success: false,
      error: 'Key not found or cannot be modified (built-in .env keys cannot be revoked through UI).',
    });
    return;
  }

  res.json({
    success: true,
    message: `API key status updated to ${updated.status}.`,
    key: updated,
  });
});

/**
 * 6. Delete App Key
 */
router.delete('/keys/:id', requireAdminAuth, async (req: Request, res: Response): Promise<void> => {
  const id = String(req.params.id);
  const deleted = await apiKeyService.deleteKey(id);

  if (!deleted) {
    res.status(404).json({
      success: false,
      error: 'Key not found or cannot be deleted (built-in .env keys cannot be deleted through UI).',
    });
    return;
  }

  res.json({
    success: true,
    message: 'API key deleted successfully.',
  });
});

/**
 * 7. Usage Statistics & Request Logs
 */
router.get('/usage', requireAdminAuth, (_req: Request, res: Response): void => {
  const stats = usageTrackerService.getUsageStats();
  res.json({
    success: true,
    stats,
    cache: receiptCache.getStats(),
  });
});

/**
 * 8. Reset Usage Statistics
 */
router.post('/usage/reset', requireAdminAuth, (_req: Request, res: Response): void => {
  usageTrackerService.resetStats();
  res.json({
    success: true,
    message: 'Usage statistics have been reset.',
  });
});

export default router;
