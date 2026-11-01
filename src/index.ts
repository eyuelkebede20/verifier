import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
dotenv.config();

import { runSmartVerify } from './services/verifyUniversal';
import { verifyTelebirr, scrapeTelebirrReceipt, isValidReceipt } from './services/verifyTelebirr';
import { verifyCBE } from './services/verifyCBE';
import { verifyDashen } from './services/verifyDashen';
import { verifyAbyssinia } from './services/verifyAbyssinia';
import { verifyCBEBirr } from './services/verifyCBEBirr';
import { verifyMpesa } from './services/verifyMpesa';
import { apiKeyAuth } from './middleware/apiKeyAuth';
import { rateLimiter } from './middleware/rateLimiter';
import adminRoutes from './routes/adminRoutes';
import usageTrackerService from './services/usageTrackerService';
import logger from './utils/logger';
import receiptCache from './utils/receiptCache';

const app = express();
const PORT = process.env.PORT || 3001;

// Resolve public assets directory (supports local dev and cPanel layout)
const candidatePublicPaths = [
  path.join(__dirname, 'public'),
  path.join(__dirname, '..', 'public'),
  path.resolve(__dirname, '..', '..', 'public'),
];
const publicDir = candidatePublicPaths.find((p) => fs.existsSync(p)) || path.join(__dirname, 'public');

// Global Middleware
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Serve static assets from public directory if exists
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
}

// Request logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.info(`[${req.method}] ${req.path}`);
  next();
});

// 1. Health check & Metadata (Public)
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

const getApiSpec = () => ({
  name: 'Senay Payment Verification API',
  version: '3.1.0-standalone',
  description: 'Central Ethiopian bank & mobile money receipt verification microservice',
  endpoints: [
    { method: 'POST', path: '/verify', description: 'Smart universal verifier (auto-detects provider). Accepts { reference, suffix?, phoneNumber?, html? }' },
    { method: 'POST', path: '/verify-telebirr', description: 'Ethio Telecom Telebirr receipt verification. Accepts { reference } or client-bounced { reference?, html } to bypass foreign IP geo-restrictions' },
    { method: 'POST', path: '/verify-cbe', description: 'Commercial Bank of Ethiopia (CBE) verification. Accepts { reference, accountSuffix? }' },
    { method: 'POST', path: '/verify-dashen', description: 'Dashen Bank transaction verification. Accepts { reference }' },
    { method: 'POST', path: '/verify-abyssinia', description: 'Bank of Abyssinia transaction verification. Accepts { reference, suffix } (5-digit account suffix)' },
    { method: 'POST', path: '/verify-cbebirr', description: 'CBE Birr mobile wallet verification. Accepts { receiptNumber, phoneNumber }' },
    { method: 'POST', path: '/verify-mpesa', description: 'Safaricom M-Pesa receipt verification. Accepts { reference }' },
    { method: 'POST', path: '/api/public-verify', description: 'Web receipt verification for landing page UI' },
    { method: 'GET', path: '/admin', description: 'Admin console & API usage monitor' },
    { method: 'GET', path: '/health', description: 'Health check' },
    { method: 'GET', path: '/api', description: 'API specification & endpoints' },
  ],
});

app.get('/api', (_req: Request, res: Response) => {
  res.json(getApiSpec());
});

// 2. Root / Landing Page (HTML for browsers, JSON for API clients)
app.get('/', (req: Request, res: Response) => {
  const acceptsJson = req.headers.accept?.includes('application/json');
  const acceptsHtml = req.headers.accept?.includes('text/html') || (!acceptsJson && req.accepts('html'));

  if (acceptsHtml && !acceptsJson && !req.xhr && !req.headers['x-api-key']) {
    const indexPath = path.join(publicDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      return res.sendFile(indexPath);
    }
  }

  res.json(getApiSpec());
});

// Friendly redirect for /verify and /verify/:bank routes to Landing Page
app.get(['/verify', '/verify/:bank'], (_req: Request, res: Response) => {
  const indexPath = path.join(publicDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    return res.sendFile(indexPath);
  }
  res.redirect('/');
});

// Admin Dashboard UI Route
app.get(['/admin', '/admin/:subpage'], (_req: Request, res: Response) => {
  const adminPath = path.join(publicDir, 'admin', 'index.html');
  if (fs.existsSync(adminPath)) {
    return res.sendFile(adminPath);
  }
  res.redirect('/');
});

// 3. Authentication & Rate Limiting for all verification endpoints
app.use(apiKeyAuth);
app.use(rateLimiter);

// Admin Routes (Key management & usage stats)
app.use('/api/admin', adminRoutes);

// Automatic API Verification Usage Tracking Middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const isVerificationRoute =
    req.path === '/verify' ||
    req.path.startsWith('/verify-') ||
    req.path === '/api/public-verify';

  if (!isVerificationRoute || req.method !== 'POST') {
    return next();
  }

  const startTime = Date.now();
  const provider =
    req.path === '/verify'
      ? 'universal'
      : req.path === '/api/public-verify'
      ? req.body?.bank || 'universal'
      : req.path.replace(/^\/verify-/, '');

  res.on('finish', () => {
    const durationMs = Date.now() - startTime;
    const reference = req.body?.reference || req.body?.receiptNumber || 'N/A';
    const appName =
      (req as any).appContext?.appName ||
      (req.path === '/api/public-verify' ? 'Web Landing Demo' : 'Direct API');
    const keyId = (req as any).appContext?.keyId;
    const isSuccess = res.statusCode >= 200 && res.statusCode < 400;

    usageTrackerService.recordUsage({
      appName,
      keyId,
      provider,
      reference: String(reference),
      success: isSuccess,
      statusCode: res.statusCode,
      durationMs,
      ip: req.ip || req.socket.remoteAddress,
    });
  });

  next();
});

// 4. Public Web Verification (for Landing Page checker UI)
app.post('/api/public-verify', async (req: Request, res: Response): Promise<void> => {
  const { reference, bank, suffix, phoneNumber, accountSuffix, html } = req.body;
  if (!reference || typeof reference !== 'string') {
    res.status(400).json({ success: false, error: 'Please enter a transaction reference or receipt ID.' });
    return;
  }

  const trimmedRef = reference.trim();
  const resolvedSuffix = (suffix || accountSuffix || '').trim();
  const resolvedPhone = (phoneNumber || '').trim();

  // Instant response for sample / mock references
  if (trimmedRef.toUpperCase().startsWith('TEST') || trimmedRef.toUpperCase().startsWith('MOCK')) {
    const selectedBank = bank || 'universal';
    res.json({
      success: true,
      provider: selectedBank === 'universal' ? 'cbe' : selectedBank,
      receipt: {
        reference: trimmedRef,
        status: 'COMPLETED',
        amount: 850,
        amountFormatted: '850.00 ETB',
        payerName: 'Abebe Kebede',
        payerAccount: '1000****1234',
        receiverName: 'Senay Creatives Demo Merchant',
        receiverAccount: '1000****5678',
        paymentDate: new Date().toISOString(),
        reason: 'Online Payment Demo / Sample Verification',
      },
      raw: {
        payerName: 'Abebe Kebede',
        receiverName: 'Senay Creatives Demo Merchant',
        amount: 850,
        reference: trimmedRef,
        status: 'COMPLETED',
      },
    });
    return;
  }

  try {
    const selectedBank = (bank || 'universal').toLowerCase();
    const cacheKeySuffix = resolvedSuffix || resolvedPhone;
    const cached = receiptCache.get<any>(selectedBank, trimmedRef, cacheKeySuffix);
    if (cached) {
      logger.info(`⚡ Public verify cache HIT for [${selectedBank}] ${trimmedRef}`);
      res.json({
        ...cached,
        details: { ...((cached.details as any) || {}), cached: true },
      });
      return;
    }

    let resultData: any = null;
    let detectedProvider = selectedBank;

    if (selectedBank === 'telebirr') {
      if (html && typeof html === 'string' && html.trim().length > 0) {
        const parsed = scrapeTelebirrReceipt(html);
        if (parsed && isValidReceipt(parsed)) {
          resultData = parsed;
        } else {
          throw new Error('Could not parse valid Telebirr receipt from provided HTML.');
        }
      } else {
        const data = await verifyTelebirr(trimmedRef);
        if (!data) throw new Error('Telebirr receipt not found or could not be parsed.');
        resultData = data;
      }
    } else if (selectedBank === 'cbe') {
      const result = await verifyCBE(trimmedRef, resolvedSuffix || undefined);
      if (!result.success) throw new Error(result.error || 'CBE verification failed.');
      resultData = result;
    } else if (selectedBank === 'dashen') {
      const result = await verifyDashen(trimmedRef);
      if (!result.success) throw new Error(result.error || 'Dashen verification failed.');
      resultData = result;
    } else if (selectedBank === 'abyssinia') {
      if (!resolvedSuffix) throw new Error('Bank of Abyssinia requires a 5-digit account suffix.');
      const result = await verifyAbyssinia(trimmedRef, resolvedSuffix);
      if (!result.success) throw new Error(result.error || 'Bank of Abyssinia verification failed.');
      resultData = result;
    } else if (selectedBank === 'cbebirr') {
      if (!resolvedPhone) throw new Error('CBE Birr requires the customer phone number.');
      const result = await verifyCBEBirr(trimmedRef, resolvedPhone);
      resultData = result;
    } else if (selectedBank === 'mpesa') {
      const result = await verifyMpesa(trimmedRef);
      if (!result.success) throw new Error(result.error || 'M-Pesa verification failed.');
      resultData = result;
    } else {
      // Smart universal verify
      const result = await runSmartVerify({
        reference: trimmedRef,
        suffix: resolvedSuffix || undefined,
        phoneNumber: resolvedPhone || undefined,
        html: typeof html === 'string' ? html : undefined,
      });
      if (!result.success) {
        throw new Error(result.error || 'Could not verify transaction with detected bank.');
      }
      resultData = (result.data as any)?.data || result.data;
      if ((result.details as any)?.provider) detectedProvider = (result.details as any).provider;
    }

    // Standardize fields for receipt card
    const payerName = resultData?.payerName || resultData?.payer || resultData?.debitAccountHolder || 'N/A';
    const payerAccount = resultData?.payerAccount || resultData?.debitAccountNo || resultData?.payerPhone || 'N/A';
    const receiverName =
      resultData?.receiverName ||
      resultData?.creditedPartyName ||
      resultData?.receiver ||
      resultData?.creditAccountHolder ||
      'N/A';
    const receiverAccount =
      resultData?.receiverAccount ||
      resultData?.creditedPartyAccountNo ||
      resultData?.creditAccountNo ||
      resultData?.receiverPhone ||
      'N/A';

    let amountNum: number | undefined;
    if (typeof resultData?.amount === 'number') amountNum = resultData.amount;
    else if (typeof resultData?.transactionAmount === 'number') amountNum = resultData.transactionAmount;
    else if (typeof resultData?.totalPaidAmount === 'number') amountNum = resultData.totalPaidAmount;
    else if (typeof resultData?.settledAmount === 'string') {
      const n = parseFloat(resultData.settledAmount.replace(/[^\d.]/g, ''));
      if (!isNaN(n)) amountNum = n;
    } else if (typeof resultData?.amount === 'string') {
      const n = parseFloat(resultData.amount.replace(/[^\d.]/g, ''));
      if (!isNaN(n)) amountNum = n;
    }

    const formattedAmount =
      amountNum != null
        ? `${amountNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETB`
        : 'Verified';

    const paymentDate =
      resultData?.paymentDate || resultData?.date || resultData?.transDate || new Date().toISOString();
    const reason = resultData?.reason || resultData?.paymentDetails?.join(' ') || resultData?.transType || null;
    const refId = resultData?.receiptNo || resultData?.reference || resultData?.id || trimmedRef;
    const status = resultData?.transactionStatus || resultData?.status || 'COMPLETED';

    const responsePayload = {
      success: true,
      provider: detectedProvider,
      receipt: {
        reference: refId,
        status: String(status).toUpperCase(),
        amount: amountNum,
        amountFormatted: formattedAmount,
        payerName,
        payerAccount,
        receiverName,
        receiverAccount,
        paymentDate,
        reason,
      },
      raw: resultData,
    };

    receiptCache.set(selectedBank, trimmedRef, responsePayload, cacheKeySuffix);
    res.json(responsePayload);
  } catch (err: any) {
    logger.warn(`Public verification failed: ${err.message}`);
    res.status(422).json({
      success: false,
      error: err.message || 'Verification could not be completed.',
    });
  }
});

// 5. Smart Universal Verification (Authenticated API)
app.post('/verify', async (req: Request, res: Response): Promise<void> => {
  const { reference, suffix, phoneNumber, html } = req.body;
  if (!reference || typeof reference !== 'string') {
    res.status(400).json({ success: false, error: 'Missing or invalid transaction reference.' });
    return;
  }

  // Handle mock/test references immediately for testing
  if (reference.toUpperCase().startsWith('TEST') || reference.toUpperCase().startsWith('MOCK')) {
    res.json({
      success: true,
      data: {
        payerName: 'Test Client',
        receiverName: 'Test Receiver',
        receiverAccount: '1000234567891',
        amount: 500,
        settledAmount: '500.00 Birr',
        totalPaidAmount: '500.00 Birr',
        transactionStatus: 'COMPLETED',
        receiptNo: reference,
        paymentDate: new Date().toISOString(),
      },
    });
    return;
  }

  try {
    const result = await runSmartVerify({ reference, suffix, phoneNumber, html });
    if (!result.success) {
      res.status(result.httpStatus).json({
        success: false,
        error: result.error,
        ...(result.details ? { details: result.details } : {}),
      });
      return;
    }

    const responseBody =
      (result.data as any)?.success !== undefined ? result.data : { success: true, data: result.data };
    res.json(responseBody);
  } catch (err: any) {
    logger.error('Universal verification error:', err);
    res.status(500).json({ success: false, error: 'Internal verification error', message: err?.message });
  }
});

// 6. Provider-specific Endpoints (Authenticated APIs)
app.post('/verify-telebirr', async (req: Request, res: Response): Promise<void> => {
  const { reference, html } = req.body;
  if (!reference && !html) {
    res.status(400).json({ success: false, error: 'Missing reference or html.' });
    return;
  }

  const cleanRef = typeof reference === 'string' ? reference.trim() : '';

  // Client bounce: parse client-fetched raw HTML
  if (html && typeof html === 'string' && html.trim().length > 0) {
    const parsed = scrapeTelebirrReceipt(html);
    if (parsed && isValidReceipt(parsed)) {
      const refKey = cleanRef || parsed.receiptNo;
      if (refKey) {
        receiptCache.set('telebirr', refKey, parsed);
      }
      res.json({ success: true, data: parsed, source: 'client_bounce' });
      return;
    }
    res.status(400).json({ success: false, error: 'Could not extract valid Telebirr receipt from provided HTML.' });
    return;
  }

  if (cleanRef && (cleanRef.toUpperCase().startsWith('TEST') || cleanRef.toUpperCase().startsWith('MOCK'))) {
    res.json({
      success: true,
      data: {
        payerName: 'Test Client',
        creditedPartyName: 'Test Receiver',
        creditedPartyAccountNo: '0911234567',
        settledAmount: '500.00 Birr',
        totalPaidAmount: '500.00 Birr',
        transactionStatus: 'COMPLETED',
        receiptNo: cleanRef,
        paymentDate: new Date().toISOString(),
      },
    });
    return;
  }

  // Fast path: In-memory cache hit (< 1ms)
  const cached = receiptCache.get<any>('telebirr', cleanRef);
  if (cached) {
    logger.info(`⚡ Telebirr cache HIT for: ${cleanRef}`);
    res.json({ success: true, data: cached, details: { cached: true } });
    return;
  }

  try {
    const result = await verifyTelebirr(cleanRef);
    if (!result) {
      res.status(404).json({ success: false, error: 'Receipt not found or could not be processed.' });
      return;
    }
    receiptCache.set('telebirr', cleanRef, result);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(502).json({ success: false, error: err?.message || 'Telebirr verification failed.' });
  }
});

app.post('/verify-cbe', async (req: Request, res: Response): Promise<void> => {
  const { reference, accountSuffix } = req.body;
  if (!reference) {
    res.status(400).json({ success: false, error: 'Missing reference.' });
    return;
  }

  if (reference.toUpperCase().startsWith('TEST') || reference.toUpperCase().startsWith('MOCK')) {
    res.json({
      success: true,
      payer: 'Test Client',
      receiver: 'Test Receiver',
      receiverAccount: '1000234567891',
      amount: 500,
      reference,
      date: new Date(),
    });
    return;
  }

  try {
    const result = await verifyCBE(reference, accountSuffix);
    res.json(result);
  } catch (err: any) {
    res.status(502).json({ success: false, error: err?.message || 'CBE verification failed.' });
  }
});

app.post('/verify-dashen', async (req: Request, res: Response): Promise<void> => {
  const { reference } = req.body;
  if (!reference) {
    res.status(400).json({ success: false, error: 'Missing reference.' });
    return;
  }

  try {
    const result = await verifyDashen(reference);
    res.json(result);
  } catch (err: any) {
    res.status(502).json({ success: false, error: err?.message || 'Dashen verification failed.' });
  }
});

app.post('/verify-abyssinia', async (req: Request, res: Response): Promise<void> => {
  const { reference, suffix } = req.body;
  if (!reference || !suffix) {
    res.status(400).json({ success: false, error: 'Missing reference or suffix (5 digits).' });
    return;
  }

  try {
    const result = await verifyAbyssinia(reference, suffix);
    res.json(result);
  } catch (err: any) {
    res.status(502).json({ success: false, error: err?.message || 'Abyssinia verification failed.' });
  }
});

app.post('/verify-cbebirr', async (req: Request, res: Response): Promise<void> => {
  const { receiptNumber, phoneNumber } = req.body;
  if (!receiptNumber || !phoneNumber) {
    res.status(400).json({ success: false, error: 'Missing receiptNumber or phoneNumber.' });
    return;
  }

  try {
    const result = await verifyCBEBirr(receiptNumber, phoneNumber);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(502).json({ success: false, error: err?.message || 'CBE Birr verification failed.' });
  }
});

app.post('/verify-mpesa', async (req: Request, res: Response): Promise<void> => {
  const { reference } = req.body;
  if (!reference) {
    res.status(400).json({ success: false, error: 'Missing reference.' });
    return;
  }

  try {
    const result = await verifyMpesa(reference);
    res.json(result);
  } catch (err: any) {
    res.status(502).json({ success: false, error: err?.message || 'M-Pesa verification failed.' });
  }
});

// 7. Global Error Handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled server error:', err);
  res.status(500).json({ success: false, error: 'Internal server error.' });
});

// Start Server
const server = app.listen(PORT, () => {
  logger.info(`🚀 Senay Verifier API running on http://localhost:${PORT}`);
});

process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());
