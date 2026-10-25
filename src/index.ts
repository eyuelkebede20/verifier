import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();

import { runSmartVerify } from './services/verifyUniversal';
import { verifyTelebirr } from './services/verifyTelebirr';
import { verifyCBE } from './services/verifyCBE';
import { verifyDashen } from './services/verifyDashen';
import { verifyAbyssinia } from './services/verifyAbyssinia';
import { verifyCBEBirr } from './services/verifyCBEBirr';
import { verifyMpesa } from './services/verifyMpesa';
import { apiKeyAuth } from './middleware/apiKeyAuth';
import { rateLimiter } from './middleware/rateLimiter';
import logger from './utils/logger';

const app = express();
const PORT = process.env.PORT || 3001;

// Global Middleware
app.use(cors());
app.use(express.json());

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

app.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'Senay Payment Verification API',
    version: '3.1.0-standalone',
    description: 'Central Ethiopian bank & mobile money receipt verification microservice',
    endpoints: [
      { method: 'POST', path: '/verify', description: 'Smart universal verifier (auto-detects provider)' },
      { method: 'POST', path: '/verify-telebirr', description: 'Ethio Telecom Telebirr receipt verification' },
      { method: 'POST', path: '/verify-cbe', description: 'Commercial Bank of Ethiopia (CBE) verification' },
      { method: 'POST', path: '/verify-dashen', description: 'Dashen Bank transaction verification' },
      { method: 'POST', path: '/verify-abyssinia', description: 'Bank of Abyssinia transaction verification' },
      { method: 'POST', path: '/verify-cbebirr', description: 'CBE Birr mobile wallet verification' },
      { method: 'POST', path: '/verify-mpesa', description: 'Safaricom M-Pesa receipt verification' },
      { method: 'GET', path: '/health', description: 'Health check' },
    ],
  });
});

// 2. Authentication & Rate Limiting for all verification endpoints
app.use(apiKeyAuth);
app.use(rateLimiter);

// 3. Smart Universal Verification (Auto-detects bank from reference)
app.post('/verify', async (req: Request, res: Response): Promise<void> => {
  const { reference, suffix, phoneNumber } = req.body;
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
    const result = await runSmartVerify({ reference, suffix, phoneNumber });
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

// 4. Provider-specific Endpoints
app.post('/verify-telebirr', async (req: Request, res: Response): Promise<void> => {
  const { reference } = req.body;
  if (!reference) {
    res.status(400).json({ success: false, error: 'Missing reference.' });
    return;
  }

  if (reference.toUpperCase().startsWith('TEST') || reference.toUpperCase().startsWith('MOCK')) {
    res.json({
      success: true,
      data: {
        payerName: 'Test Client',
        creditedPartyName: 'Test Receiver',
        creditedPartyAccountNo: '0911234567',
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
    const result = await verifyTelebirr(reference);
    if (!result) {
      res.status(404).json({ success: false, error: 'Receipt not found or could not be processed.' });
      return;
    }
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

// 5. Global Error Handler
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
