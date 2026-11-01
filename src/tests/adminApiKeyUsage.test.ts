import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import {
  verifyMasterKey,
  createSessionToken,
  verifySessionToken,
} from '../services/adminAuthService';
import apiKeyService from '../services/apiKeyService';
import usageTrackerService from '../services/usageTrackerService';

test('Admin Auth: verifies plain and hashed master keys securely', () => {
  const testSecret = 'test_admin_super_secret_key_12345';
  process.env.ADMIN_KEY = testSecret;

  // 1. Accepts matching secret
  assert.equal(verifyMasterKey(testSecret), true);

  // 2. Rejects incorrect secret
  assert.equal(verifyMasterKey('wrong_key'), false);
  assert.equal(verifyMasterKey(''), false);

  // 3. Tests SHA-256 hash matching
  const testHashSecret = 'my_hashed_secret_2026';
  const expectedHash = crypto.createHash('sha256').update(testHashSecret).digest('hex');
  process.env.ADMIN_KEY = '';
  process.env.ADMIN_KEY_HASH = expectedHash;

  assert.equal(verifyMasterKey(testHashSecret), true);
  assert.equal(verifyMasterKey('incorrect_secret'), false);

  // Cleanup
  delete process.env.ADMIN_KEY;
  delete process.env.ADMIN_KEY_HASH;
});

test('Admin Auth: issues and verifies tamper-proof HMAC session tokens', () => {
  process.env.ADMIN_KEY = 'unit_test_session_secret';

  const token = createSessionToken();
  assert.ok(token);
  assert.equal(token.includes('.'), true);

  // Valid token passes
  assert.equal(verifySessionToken(token), true);

  // Altered signature fails
  const [payload, sig] = token.split('.');
  const corruptedSig = sig.slice(0, -3) + 'abc';
  assert.equal(verifySessionToken(`${payload}.${corruptedSig}`), false);

  // Malformed token fails
  assert.equal(verifySessionToken('random-string-without-signature'), false);
  assert.equal(verifySessionToken(''), false);

  delete process.env.ADMIN_KEY;
});

test('API Key Service: generates, validates, toggles, and deletes app keys', async () => {
  process.env.API_KEYS = 'test_mentalweg_key_2026,test_shop_key_2026';
  apiKeyService.syncEnvKeys();

  // 1. Env keys are validated
  const envValidation = await apiKeyService.validateKey('test_mentalweg_key_2026');
  assert.equal(envValidation.valid, true);
  assert.ok(envValidation.appName?.includes('MentalWeg'));

  // 2. Generate a new dynamic app key
  const appName = 'My Test Flutter App';
  const generated = await apiKeyService.generateKey({
    name: appName,
    description: 'Mobile client verifier',
    rateLimit: 60,
  });

  assert.ok(generated.rawKey.startsWith('sn_live_'));
  assert.equal(generated.key.name, appName);
  assert.equal(generated.key.status, 'active');

  // 3. Validate newly generated key
  const validCheck = await apiKeyService.validateKey(generated.rawKey);
  assert.equal(validCheck.valid, true);
  assert.equal(validCheck.appName, appName);

  // 4. Revoke key
  const toggled = await apiKeyService.toggleKeyStatus(generated.key.id);
  assert.ok(toggled);
  assert.equal(toggled.status, 'revoked');

  // Should no longer validate when revoked
  const revokedCheck = await apiKeyService.validateKey(generated.rawKey);
  assert.equal(revokedCheck.valid, false);

  // 5. Delete key
  const deleted = await apiKeyService.deleteKey(generated.key.id);
  assert.equal(deleted, true);

  const deletedCheck = await apiKeyService.validateKey(generated.rawKey);
  assert.equal(deletedCheck.valid, false);

  delete process.env.API_KEYS;
});

test('Usage Tracker Service: aggregates verifications and provider stats', () => {
  usageTrackerService.resetStats();

  // Record mock verifications
  usageTrackerService.recordUsage({
    appName: 'MentalWeg Store',
    provider: 'telebirr',
    reference: 'TB12345678',
    success: true,
    statusCode: 200,
    durationMs: 120,
  });

  usageTrackerService.recordUsage({
    appName: 'MentalWeg Store',
    provider: 'cbe',
    reference: 'FT99988877',
    success: true,
    statusCode: 200,
    durationMs: 180,
  });

  usageTrackerService.recordUsage({
    appName: 'Telegram Bot',
    provider: 'dashen',
    reference: 'DASHEN001',
    success: false,
    statusCode: 404,
    durationMs: 95,
  });

  const stats = usageTrackerService.getUsageStats();

  assert.equal(stats.summary.totalRequests, 3);
  assert.equal(stats.summary.successfulRequests, 2);
  assert.equal(stats.summary.failedRequests, 1);
  assert.equal(stats.summary.successRate, 66.7);

  // Provider stats
  assert.equal(stats.byProvider.telebirr?.total, 1);
  assert.equal(stats.byProvider.telebirr?.success, 1);
  assert.equal(stats.byProvider.cbe?.total, 1);
  assert.equal(stats.byProvider.dashen?.failed, 1);

  // App breakdown
  assert.equal(stats.byApp.length, 2);
  const mentalwegApp = stats.byApp.find((a) => a.appName === 'MentalWeg Store');
  assert.ok(mentalwegApp);
  assert.equal(mentalwegApp?.total, 2);
  assert.equal(mentalwegApp?.success, 2);

  // Recent logs
  assert.equal(stats.recentLogs.length, 3);
  assert.equal(stats.recentLogs[0].provider, 'dashen'); // newest first
});
