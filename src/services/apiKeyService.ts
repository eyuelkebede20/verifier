import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import logger from '../utils/logger';

export interface AppApiKey {
  id: string;
  name: string;
  key: string;
  keyPrefix: string;
  createdAt: string;
  status: 'active' | 'revoked';
  rateLimit?: number;
  description?: string;
  isEnvKey?: boolean;
  provider?: 'unkey' | 'local';
}

export interface AppApiKeySummary {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  status: 'active' | 'revoked';
  rateLimit: number;
  description: string;
  isEnvKey: boolean;
  provider: 'unkey' | 'local';
}

// Storage path configuration
const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
const KEYS_FILE = path.join(DATA_DIR, 'api_keys.json');

class ApiKeyService {
  private dynamicKeys: Map<string, AppApiKey> = new Map();
  private envKeys: Map<string, AppApiKey> = new Map();
  private unkeyClient: any = null;
  private unkeyApiId: string | null = null;
  private initialized = false;

  constructor() {
    this.ensureInitialized();
  }

  private ensureInitialized(): void {
    if (this.initialized) return;
    this.ensureDataDir();
    this.initUnkey();
    this.loadFromDisk();
    this.syncEnvKeys();
    this.initialized = true;
  }

  private initUnkey(): void {
    const rootKey = process.env.UNKEY_ROOT_KEY?.trim();
    const apiId = process.env.UNKEY_API_ID?.trim();

    if (rootKey) {
      try {
        let UnkeyClass: any = null;
        try {
          // Dynamic require so missing optional package on shared hosting does not crash application
          const unkeyPkg = require('@unkey/api');
          UnkeyClass = unkeyPkg.Unkey || unkeyPkg.default?.Unkey || unkeyPkg;
        } catch (pkgErr: any) {
          logger.warn(`[UNKEY] Optional package @unkey/api not found in node_modules, falling back to local keys: ${pkgErr?.message || pkgErr}`);
          this.unkeyClient = null;
          return;
        }

        const options: any = { rootKey };
        if (process.env.UNKEY_BASE_URL?.trim()) {
          options.baseURL = process.env.UNKEY_BASE_URL.trim();
        }
        this.unkeyClient = new UnkeyClass(options);
        this.unkeyApiId = apiId || null;
        logger.info(`[UNKEY] Initialized headless open-source Unkey client (API ID: ${apiId || 'default'}).`);
      } catch (err: any) {
        logger.error('[UNKEY] Failed to initialize Unkey client:', err);
        this.unkeyClient = null;
      }
    }
  }

  private ensureDataDir(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
    } catch (err: any) {
      logger.error('Failed to create data directory for API keys:', err);
    }
  }

  private maskKey(fullKey: string): string {
    if (!fullKey || fullKey.length <= 10) return '***';
    const start = fullKey.slice(0, 8);
    const end = fullKey.slice(-4);
    return `${start}...${end}`;
  }

  /**
   * Synchronizes keys configured in environment variables (API_KEYS, VERIFIER_API_KEY, etc.)
   */
  public syncEnvKeys(): void {
    this.envKeys.clear();

    const envKeysString = process.env.API_KEYS || '';
    const individualKeys = envKeysString
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);

    individualKeys.forEach((key, index) => {
      const id = `env_${index + 1}_${crypto.createHash('sha256').update(key).digest('hex').slice(0, 8)}`;
      let friendlyName = `App Key ${index + 1}`;
      if (key.toLowerCase().includes('mentalweg')) friendlyName = 'MentalWeg Store';
      else if (key.toLowerCase().includes('ecommerce') || key.toLowerCase().includes('shop')) friendlyName = 'E-Commerce Portal';
      else if (key.toLowerCase().includes('client')) friendlyName = 'Client Portal';

      this.envKeys.set(key, {
        id,
        name: `${friendlyName} (.env)`,
        key,
        keyPrefix: this.maskKey(key),
        createdAt: new Date().toISOString(),
        status: 'active',
        rateLimit: Number(process.env.RATE_LIMIT_PER_MINUTE) || 120,
        description: 'Auto-detected from server environment variable API_KEYS',
        isEnvKey: true,
        provider: 'local',
      });
    });

    // Check VERIFIER_API_KEY
    const masterLegacyKey = process.env.VERIFIER_API_KEY?.trim();
    if (masterLegacyKey && !this.envKeys.has(masterLegacyKey)) {
      this.envKeys.set(masterLegacyKey, {
        id: 'env_master_verifier',
        name: 'Master Verifier Key (.env)',
        key: masterLegacyKey,
        keyPrefix: this.maskKey(masterLegacyKey),
        createdAt: new Date().toISOString(),
        status: 'active',
        rateLimit: Number(process.env.RATE_LIMIT_PER_MINUTE) || 120,
        description: 'Legacy master key configured in VERIFIER_API_KEY',
        isEnvKey: true,
        provider: 'local',
      });
    }

    // Check STATIC_API_KEY
    const staticKey = process.env.STATIC_API_KEY?.trim();
    if (staticKey && !this.envKeys.has(staticKey)) {
      this.envKeys.set(staticKey, {
        id: 'env_static_key',
        name: 'Static API Key (.env)',
        key: staticKey,
        keyPrefix: this.maskKey(staticKey),
        createdAt: new Date().toISOString(),
        status: 'active',
        rateLimit: Number(process.env.RATE_LIMIT_PER_MINUTE) || 120,
        description: 'Static key configured in STATIC_API_KEY',
        isEnvKey: true,
        provider: 'local',
      });
    }
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(KEYS_FILE)) {
        const raw = fs.readFileSync(KEYS_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.keys)) {
          this.dynamicKeys.clear();
          for (const item of parsed.keys) {
            if (item && item.id && item.key) {
              this.dynamicKeys.set(item.key, {
                id: item.id,
                name: item.name || 'Unnamed App',
                key: item.key,
                keyPrefix: item.keyPrefix || this.maskKey(item.key),
                createdAt: item.createdAt || new Date().toISOString(),
                status: item.status === 'revoked' ? 'revoked' : 'active',
                rateLimit: Number(item.rateLimit) || 120,
                description: item.description || '',
                isEnvKey: false,
                provider: item.provider || 'local',
              });
            }
          }
        }
      }
    } catch (err: any) {
      logger.error('Failed to read dynamic API keys file, starting with empty dynamic store:', err);
    }
  }

  private saveToDisk(): void {
    try {
      this.ensureDataDir();
      const keysArray = Array.from(this.dynamicKeys.values()).map((k) => ({
        id: k.id,
        name: k.name,
        key: k.key,
        keyPrefix: k.keyPrefix,
        createdAt: k.createdAt,
        status: k.status,
        rateLimit: k.rateLimit,
        description: k.description,
        provider: k.provider,
      }));

      const payload = JSON.stringify({ version: 1, keys: keysArray, updatedAt: new Date().toISOString() }, null, 2);
      const tempPath = `${KEYS_FILE}.tmp.${Date.now()}`;
      fs.writeFileSync(tempPath, payload, 'utf8');
      fs.renameSync(tempPath, KEYS_FILE);
    } catch (err: any) {
      logger.error('Failed to write API keys to disk:', err);
    }
  }

  /**
   * Generates a new API key for a client application.
   * If Unkey is configured, it provisions via Unkey's headless API manager.
   * Otherwise, generates cryptographically secure local keys.
   */
  public async generateKey(params: {
    name: string;
    description?: string;
    rateLimit?: number;
  }): Promise<{ key: AppApiKey; rawKey: string }> {
    this.ensureInitialized();

    const cleanName = (params.name || '').trim() || 'My App';
    const cleanDesc = (params.description || '').trim();
    const rateLimit = Math.max(1, Math.min(10000, Number(params.rateLimit) || 120));

    // 1. If Unkey is configured, provision via Unkey
    if (this.unkeyClient && this.unkeyApiId) {
      try {
        const createResult: any = await this.unkeyClient.keys.createKey({
          apiId: this.unkeyApiId,
          prefix: 'sn_live',
          name: cleanName,
          meta: { description: cleanDesc },
          ratelimits: [
            {
              name: 'default',
              limit: rateLimit,
              duration: 60000,
              autoApply: true,
            },
          ],
        });

        const rawKey = createResult?.key || createResult?.data?.key;
        const keyId = createResult?.keyId || createResult?.data?.keyId || `unkey_${Date.now()}`;

        if (rawKey) {
          const newKey: AppApiKey = {
            id: keyId,
            name: cleanName,
            key: rawKey,
            keyPrefix: this.maskKey(rawKey),
            createdAt: new Date().toISOString(),
            status: 'active',
            rateLimit,
            description: cleanDesc,
            isEnvKey: false,
            provider: 'unkey',
          };

          this.dynamicKeys.set(rawKey, newKey);
          this.saveToDisk();
          logger.info(`[UNKEY] Successfully provisioned new API key via Unkey for "${cleanName}" (${keyId})`);
          return { key: newKey, rawKey };
        }
      } catch (err: any) {
        logger.warn(`[UNKEY] Unkey API creation failed, falling back to local generator: ${err.message}`);
      }
    }

    // 2. Local Fallback Generator
    const randomEntropy = crypto.randomBytes(24).toString('base64url');
    const rawKey = `sn_live_${randomEntropy}`;
    const id = `key_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
    const keyPrefix = this.maskKey(rawKey);

    const newKey: AppApiKey = {
      id,
      name: cleanName,
      key: rawKey,
      keyPrefix,
      createdAt: new Date().toISOString(),
      status: 'active',
      rateLimit,
      description: cleanDesc,
      isEnvKey: false,
      provider: 'local',
    };

    this.dynamicKeys.set(rawKey, newKey);
    this.saveToDisk();

    logger.info(`[API_KEY] Generated new API key for app "${cleanName}" (${id})`);
    return { key: newKey, rawKey };
  }

  /**
   * Toggle key status between active and revoked.
   */
  public async toggleKeyStatus(id: string): Promise<AppApiKey | null> {
    this.ensureInitialized();

    for (const keyObj of this.dynamicKeys.values()) {
      if (keyObj.id === id) {
        const nextStatus = keyObj.status === 'active' ? 'revoked' : 'active';
        keyObj.status = nextStatus;

        // If Unkey, update remote state
        if (keyObj.provider === 'unkey' && this.unkeyClient) {
          try {
            await this.unkeyClient.keys.updateKey({
              keyId: id,
              enabled: nextStatus === 'active',
            });
          } catch (err: any) {
            logger.warn(`[UNKEY] Failed to update key status on Unkey: ${err.message}`);
          }
        }

        this.saveToDisk();
        logger.info(`[API_KEY] Toggled status for key ${id} to ${keyObj.status}`);
        return keyObj;
      }
    }
    return null;
  }

  /**
   * Deletes an API key.
   */
  public async deleteKey(id: string): Promise<boolean> {
    this.ensureInitialized();

    for (const [rawKey, keyObj] of this.dynamicKeys.entries()) {
      if (keyObj.id === id) {
        // If Unkey, delete from remote
        if (keyObj.provider === 'unkey' && this.unkeyClient) {
          try {
            await this.unkeyClient.keys.deleteKey({ keyId: id });
          } catch (err: any) {
            logger.warn(`[UNKEY] Failed to delete key on Unkey: ${err.message}`);
          }
        }

        this.dynamicKeys.delete(rawKey);
        this.saveToDisk();
        logger.info(`[API_KEY] Deleted key ${id} (${keyObj.name})`);
        return true;
      }
    }
    return false;
  }

  /**
   * Validates an incoming API key against active dynamic and environment keys,
   * or verifies via Unkey headless API if configured.
   */
  public async validateKey(candidateKey: string): Promise<{ valid: boolean; appName?: string; keyId?: string }> {
    if (!candidateKey || typeof candidateKey !== 'string') {
      return { valid: false };
    }

    const trimmed = candidateKey.trim();
    this.ensureInitialized();

    // 1. Check in-memory dynamic keys
    const dynamicEntry = this.dynamicKeys.get(trimmed);
    if (dynamicEntry) {
      if (dynamicEntry.status === 'active') {
        return { valid: true, appName: dynamicEntry.name, keyId: dynamicEntry.id };
      }
      return { valid: false };
    }

    // 2. Check environment keys
    const envEntry = this.envKeys.get(trimmed);
    if (envEntry) {
      return { valid: true, appName: envEntry.name, keyId: envEntry.id };
    }

    // 3. If Unkey is configured and key starts with prefix, verify directly via Unkey
    if (this.unkeyClient && this.unkeyApiId && trimmed.startsWith('sn_live_')) {
      try {
        const verifyResult: any = await this.unkeyClient.keys.verifyKey({
          key: trimmed,
        });

        const data = verifyResult?.data || verifyResult;
        if (data?.valid) {
          const appName = data.name || (data.meta as any)?.name || 'Unkey Client App';
          return {
            valid: true,
            appName,
            keyId: data.keyId,
          };
        }
      } catch (err: any) {
        logger.warn(`[UNKEY] Key verification call failed: ${err.message}`);
      }
    }

    return { valid: false };
  }

  /**
   * Returns list of all keys with masked key values for dashboard display.
   */
  public listKeys(): AppApiKeySummary[] {
    this.ensureInitialized();
    this.syncEnvKeys();

    const results: AppApiKeySummary[] = [];

    // Add dynamic keys
    for (const k of this.dynamicKeys.values()) {
      results.push({
        id: k.id,
        name: k.name,
        keyPrefix: k.keyPrefix,
        createdAt: k.createdAt,
        status: k.status,
        rateLimit: k.rateLimit || 120,
        description: k.description || '',
        isEnvKey: false,
        provider: k.provider || 'local',
      });
    }

    // Add env keys
    for (const k of this.envKeys.values()) {
      results.push({
        id: k.id,
        name: k.name,
        keyPrefix: k.keyPrefix,
        createdAt: k.createdAt,
        status: k.status,
        rateLimit: k.rateLimit || 120,
        description: k.description || '',
        isEnvKey: true,
        provider: 'local',
      });
    }

    // Sort newest first
    results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return results;
  }
}

export const apiKeyService = new ApiKeyService();
export default apiKeyService;
