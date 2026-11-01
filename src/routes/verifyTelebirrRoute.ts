import { Router, Request, Response } from 'express';
import { verifyTelebirr, scrapeTelebirrReceipt, isValidReceipt } from '../services/verifyTelebirr';
import receiptCache from '../utils/receiptCache';
import logger from '../utils/logger';

const router = Router();

interface VerifyTelebirrRequestBody {
    reference: string;
    html?: string;
}

router.post<{}, {}, VerifyTelebirrRequestBody>(
    '/',
    async (req: Request<{}, {}, VerifyTelebirrRequestBody>, res: Response): Promise<void> => {
        const { reference, html } = req.body;

        if (!reference || typeof reference !== 'string') {
            res.status(400).json({ success: false, error: 'Missing reference.' });
            return;
        }

        const cleanRef = reference.trim();
        if (cleanRef.length < 6 || !/^[A-Za-z0-9_-]{6,32}$/.test(cleanRef)) {
            res.status(400).json({
                success: false,
                error: 'Invalid Telebirr reference format. Must be an alphanumeric code (e.g. CJT8R50V28 or TB...).'
            });
            return;
        }

        // Fast path 1: Instant parse if client-provided HTML is present
        if (html && typeof html === 'string' && html.trim().length > 0) {
            try {
                const parsed = scrapeTelebirrReceipt(html);
                if (parsed && isValidReceipt(parsed)) {
                    logger.info(`⚡ Telebirr parsed instantly from provided HTML for: ${cleanRef}`);
                    receiptCache.set('telebirr', cleanRef, parsed);
                    res.json({
                        success: true,
                        data: parsed,
                        details: { source: 'client_bounce' }
                    });
                    return;
                }
            } catch (err: any) {
                logger.warn('Failed parsing provided Telebirr HTML; falling back to upstream inquiry.', { error: err.message });
            }
        }

        // Fast path 2: High-speed in-memory cache hit (< 1ms)
        const cached = receiptCache.get<any>('telebirr', cleanRef);
        if (cached) {
            logger.info(`⚡ Telebirr cache HIT for reference: ${cleanRef}`);
            res.json({
                success: true,
                data: cached,
                details: { cached: true }
            });
            return;
        }

        try {
            const result = await verifyTelebirr(cleanRef);
            if (!result) {
                res.status(404).json({ success: false, error: 'Receipt not found or could not be processed.' });
                return;
            }

            // Cache immutable verified receipt
            receiptCache.set('telebirr', cleanRef, result);

            res.json({ success: true, data: result });
        } catch (err: any) {
            logger.error('Telebirr verification error:', err);

            if (err.name === 'TelebirrVerificationError') {
                res.status(502).json({
                    success: false,
                    error: err.message,
                    details: err.details
                });
                return;
            }

            res.status(500).json({ 
                success: false, 
                error: 'Server error verifying Telebirr receipt.',
                message: err instanceof Error ? err.message : 'Unknown error'
            });
        }
    }
);

export default router;
