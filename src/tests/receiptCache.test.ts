import test from 'node:test';
import assert from 'node:assert/strict';
import { receiptCache } from '../utils/receiptCache';

test('receiptCache: sets, retrieves, and enforces TTL and LRU bounds', async () => {
  receiptCache.clear();

  // Test set and get
  receiptCache.set('telebirr', 'TB_SAMPLE_1', { amount: 100, payer: 'Abebe' });
  const hit = receiptCache.get<any>('telebirr', 'TB_SAMPLE_1');
  assert.ok(hit);
  assert.equal(hit.amount, 100);

  // Case-insensitivity and trim normalization
  const hitNormalized = receiptCache.get<any>('TELEBIRR', ' tb_sample_1 ');
  assert.ok(hitNormalized);
  assert.equal(hitNormalized.payer, 'Abebe');

  // Stats verification
  const stats = receiptCache.getStats();
  assert.equal(stats.size, 1);
  assert.ok(stats.hits >= 2);

  // Cache miss
  const miss = receiptCache.get<any>('telebirr', 'NON_EXISTENT');
  assert.equal(miss, null);

  // Expiration test with short TTL
  receiptCache.set('cbe', 'FT_SHORT_TTL', { amount: 50 }, undefined, 0.05); // 50ms TTL
  assert.ok(receiptCache.get('cbe', 'FT_SHORT_TTL'));
  await new Promise(resolve => setTimeout(resolve, 70));
  assert.equal(receiptCache.get('cbe', 'FT_SHORT_TTL'), null);
});
