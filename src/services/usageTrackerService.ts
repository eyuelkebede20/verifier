import fs from 'node:fs';
import path from 'node:path';
import logger from '../utils/logger';

export interface VerificationLogItem {
  id: string;
  timestamp: string;
  appName: string;
  keyId?: string;
  provider: string;
  reference: string;
  success: boolean;
  statusCode: number;
  durationMs: number;
  ip?: string;
}

export interface ProviderStats {
  total: number;
  success: number;
  failed: number;
}

export interface AppStats {
  appName: string;
  keyId?: string;
  total: number;
  success: number;
  failed: number;
  lastUsedAt: string;
}

export interface DailyStats {
  date: string; // YYYY-MM-DD
  total: number;
  success: number;
  failed: number;
}

export interface UsageSummary {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  successRate: number; // percentage 0-100
  avgDurationMs: number;
  todayRequests: number;
}

// Storage path configuration
const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
const USAGE_FILE = path.join(DATA_DIR, 'api_usage.json');
const MAX_LOGS = 100;

class UsageTrackerService {
  private totalRequests = 0;
  private successfulRequests = 0;
  private failedRequests = 0;
  private totalDurationMs = 0;

  private byProvider: Map<string, ProviderStats> = new Map();
  private byApp: Map<string, AppStats> = new Map();
  private daily: Map<string, DailyStats> = new Map();
  private recentLogs: VerificationLogItem[] = [];

  private isDirty = false;
  private flushTimer: NodeJS.Timeout | null = null;
  private initialized = false;

  constructor() {
    this.ensureInitialized();
    this.setupExitHooks();
  }

  private ensureInitialized(): void {
    if (this.initialized) return;
    this.ensureDataDir();
    this.loadFromDisk();
    this.initialized = true;
  }

  private ensureDataDir(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
    } catch (err: any) {
      logger.error('Failed to create data directory for usage tracking:', err);
    }
  }

  private setupExitHooks(): void {
    const handleExit = () => {
      this.flushSync();
    };

    process.on('SIGINT', handleExit);
    process.on('SIGTERM', handleExit);
    process.on('beforeExit', handleExit);
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(USAGE_FILE)) {
        const raw = fs.readFileSync(USAGE_FILE, 'utf8');
        const parsed = JSON.parse(raw);

        this.totalRequests = Number(parsed.totalRequests) || 0;
        this.successfulRequests = Number(parsed.successfulRequests) || 0;
        this.failedRequests = Number(parsed.failedRequests) || 0;
        this.totalDurationMs = Number(parsed.totalDurationMs) || 0;

        if (parsed.byProvider && typeof parsed.byProvider === 'object') {
          for (const [k, v] of Object.entries(parsed.byProvider)) {
            const val = v as any;
            this.byProvider.set(k, {
              total: Number(val.total) || 0,
              success: Number(val.success) || 0,
              failed: Number(val.failed) || 0,
            });
          }
        }

        if (parsed.byApp && typeof parsed.byApp === 'object') {
          for (const [k, v] of Object.entries(parsed.byApp)) {
            const val = v as any;
            this.byApp.set(k, {
              appName: val.appName || k,
              keyId: val.keyId,
              total: Number(val.total) || 0,
              success: Number(val.success) || 0,
              failed: Number(val.failed) || 0,
              lastUsedAt: val.lastUsedAt || new Date().toISOString(),
            });
          }
        }

        if (parsed.daily && typeof parsed.daily === 'object') {
          for (const [k, v] of Object.entries(parsed.daily)) {
            const val = v as any;
            this.daily.set(k, {
              date: k,
              total: Number(val.total) || 0,
              success: Number(val.success) || 0,
              failed: Number(val.failed) || 0,
            });
          }
        }

        if (Array.isArray(parsed.recentLogs)) {
          this.recentLogs = parsed.recentLogs.slice(0, MAX_LOGS);
        }
      }
    } catch (err: any) {
      logger.error('Failed to read API usage stats file, starting fresh:', err);
    }
  }

  private scheduleFlush(): void {
    this.isDirty = true;
    if (this.flushTimer) return;

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushSync();
    }, 2500);
  }

  private flushSync(): void {
    if (!this.isDirty) return;
    try {
      this.ensureDataDir();

      const byProviderObj: Record<string, ProviderStats> = {};
      for (const [k, v] of this.byProvider.entries()) {
        byProviderObj[k] = v;
      }

      const byAppObj: Record<string, AppStats> = {};
      for (const [k, v] of this.byApp.entries()) {
        byAppObj[k] = v;
      }

      const dailyObj: Record<string, DailyStats> = {};
      for (const [k, v] of this.daily.entries()) {
        dailyObj[k] = v;
      }

      const payload = JSON.stringify(
        {
          version: 1,
          totalRequests: this.totalRequests,
          successfulRequests: this.successfulRequests,
          failedRequests: this.failedRequests,
          totalDurationMs: this.totalDurationMs,
          byProvider: byProviderObj,
          byApp: byAppObj,
          daily: dailyObj,
          recentLogs: this.recentLogs.slice(0, MAX_LOGS),
          updatedAt: new Date().toISOString(),
        },
        null,
        2
      );

      const tempPath = `${USAGE_FILE}.tmp.${Date.now()}`;
      fs.writeFileSync(tempPath, payload, 'utf8');
      fs.renameSync(tempPath, USAGE_FILE);
      this.isDirty = false;
    } catch (err: any) {
      logger.error('Failed to flush API usage stats to disk:', err);
    }
  }

  /**
   * Records a verification request. Non-blocking and thread-safe in Node single-thread event loop.
   */
  public recordUsage(params: {
    appName?: string;
    keyId?: string;
    provider?: string;
    reference?: string;
    success: boolean;
    statusCode: number;
    durationMs: number;
    ip?: string;
  }): void {
    this.ensureInitialized();

    const timestamp = new Date().toISOString();
    const todayStr = timestamp.slice(0, 10); // YYYY-MM-DD
    const appName = params.appName || 'Unknown Consumer';
    const provider = (params.provider || 'universal').toLowerCase();
    const duration = Math.max(0, Math.round(params.durationMs));

    // Global counters
    this.totalRequests++;
    this.totalDurationMs += duration;
    if (params.success) {
      this.successfulRequests++;
    } else {
      this.failedRequests++;
    }

    // Provider breakdown
    let prov = this.byProvider.get(provider);
    if (!prov) {
      prov = { total: 0, success: 0, failed: 0 };
      this.byProvider.set(provider, prov);
    }
    prov.total++;
    if (params.success) prov.success++;
    else prov.failed++;

    // App breakdown
    let app = this.byApp.get(appName);
    if (!app) {
      app = {
        appName,
        keyId: params.keyId,
        total: 0,
        success: 0,
        failed: 0,
        lastUsedAt: timestamp,
      };
      this.byApp.set(appName, app);
    }
    app.total++;
    app.lastUsedAt = timestamp;
    if (params.keyId) app.keyId = params.keyId;
    if (params.success) app.success++;
    else app.failed++;

    // Daily breakdown
    let day = this.daily.get(todayStr);
    if (!day) {
      day = { date: todayStr, total: 0, success: 0, failed: 0 };
      this.daily.set(todayStr, day);
    }
    day.total++;
    if (params.success) day.success++;
    else day.failed++;

    // Recent logs
    const logItem: VerificationLogItem = {
      id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp,
      appName,
      keyId: params.keyId,
      provider,
      reference: params.reference ? params.reference.slice(0, 32) : 'N/A',
      success: params.success,
      statusCode: params.statusCode,
      durationMs: duration,
      ip: params.ip ? params.ip.replace(/:\d+$/, '') : undefined,
    };

    this.recentLogs.unshift(logItem);
    if (this.recentLogs.length > MAX_LOGS) {
      this.recentLogs.pop();
    }

    this.scheduleFlush();
  }

  /**
   * Retrieves aggregated usage statistics for the admin dashboard.
   */
  public getUsageStats(): {
    summary: UsageSummary;
    byProvider: Record<string, ProviderStats>;
    byApp: AppStats[];
    daily: DailyStats[];
    recentLogs: VerificationLogItem[];
  } {
    this.ensureInitialized();

    const todayStr = new Date().toISOString().slice(0, 10);
    const todayStats = this.daily.get(todayStr);

    const successRate =
      this.totalRequests > 0 ? Math.round((this.successfulRequests / this.totalRequests) * 1000) / 10 : 100;
    const avgDurationMs =
      this.totalRequests > 0 ? Math.round(this.totalDurationMs / this.totalRequests) : 0;

    const summary: UsageSummary = {
      totalRequests: this.totalRequests,
      successfulRequests: this.successfulRequests,
      failedRequests: this.failedRequests,
      successRate,
      avgDurationMs,
      todayRequests: todayStats ? todayStats.total : 0,
    };

    const byProviderObj: Record<string, ProviderStats> = {};
    for (const [k, v] of this.byProvider.entries()) {
      byProviderObj[k] = v;
    }

    const byAppList = Array.from(this.byApp.values()).sort((a, b) => b.total - a.total);

    // Get last 14 days sorted ascending
    const dailyList = Array.from(this.daily.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-14);

    return {
      summary,
      byProvider: byProviderObj,
      byApp: byAppList,
      daily: dailyList,
      recentLogs: this.recentLogs.slice(0, 50),
    };
  }

  /**
   * Resets usage statistics (e.g. for testing / fresh start).
   */
  public resetStats(): void {
    this.totalRequests = 0;
    this.successfulRequests = 0;
    this.failedRequests = 0;
    this.totalDurationMs = 0;
    this.byProvider.clear();
    this.byApp.clear();
    this.daily.clear();
    this.recentLogs = [];
    this.isDirty = true;
    this.flushSync();
  }
}

export const usageTrackerService = new UsageTrackerService();
export default usageTrackerService;
