import { describe, expect, it } from 'vitest';
import { hasRealModelAccess, loadConfig } from '../src/core/config.js';

describe('loadConfig', () => {
  it('falls back to documented model defaults when an env var is unset', () => {
    const config = loadConfig({} as unknown as NodeJS.ProcessEnv);
    expect(config.models).toMatchObject({
      siteContext: 'claude-sonnet-5',
      signals: 'claude-sonnet-5',
      diagnostic: 'claude-opus-5',
      fix: 'claude-opus-5',
      qa: 'gpt-5',
      modelConfigVersion: 'mc-v1',
    });
  });

  it('gives the token budget real headroom by default (regression)', () => {
    // A live scan hit "Model budget exceeded: tokens" against the old 250k default well before
    // finishing — the full evidence payload is re-sent on ~15 model calls per analysis.
    const config = loadConfig({} as unknown as NodeJS.ProcessEnv);
    expect(config.budgets.maxTokens).toBeGreaterThanOrEqual(1_000_000);
  });

  it('falls back to documented model defaults when an env var exists but is an empty string (regression)', () => {
    // Reproduces the live incident: Vercel env vars added via the dashboard with no value read back
    // as "", not undefined. `??` does not catch that; `str()` must.
    const config = loadConfig({
      MODEL_SITECONTEXT: '',
      MODEL_SIGNALS: '',
      MODEL_DIAGNOSTIC: '',
      MODEL_FIX: '',
      MODEL_QA: '',
      MODEL_CONFIG_VERSION: '',
      CRAWL_USER_AGENT: '',
      NODE_ENV: '',
    } as unknown as NodeJS.ProcessEnv);
    expect(config.models).toMatchObject({
      siteContext: 'claude-sonnet-5',
      signals: 'claude-sonnet-5',
      diagnostic: 'claude-opus-5',
      fix: 'claude-opus-5',
      qa: 'gpt-5',
      modelConfigVersion: 'mc-v1',
    });
    expect(config.crawl.userAgent).toBe('CROCheckerBot/0.1');
    expect(config.nodeEnv).toBe('development');
  });

  it('still honours a real, non-empty override', () => {
    const config = loadConfig({ MODEL_QA: 'gpt-5-mini' } as unknown as NodeJS.ProcessEnv);
    expect(config.models.qa).toBe('gpt-5-mini');
  });

  it('resolves a database URL from any of the accepted Vercel Postgres var names', () => {
    expect(loadConfig({ DATABASE_URL: 'postgres://a' } as unknown as NodeJS.ProcessEnv).databaseUrl).toBe('postgres://a');
    expect(loadConfig({ POSTGRES_URL: 'postgres://b' } as unknown as NodeJS.ProcessEnv).databaseUrl).toBe('postgres://b');
    expect(loadConfig({ POSTGRES_PRISMA_URL: 'postgres://c' } as unknown as NodeJS.ProcessEnv).databaseUrl).toBe('postgres://c');
    expect(loadConfig({ POSTGRES_URL_NON_POOLING: 'postgres://d' } as unknown as NodeJS.ProcessEnv).databaseUrl).toBe('postgres://d');
    expect(loadConfig({} as unknown as NodeJS.ProcessEnv).databaseUrl).toBeUndefined();
  });

  it('ignores an empty-string database URL var rather than treating it as configured', () => {
    // Same class of bug as the model vars: an env var present with value "" must not count as set.
    const config = loadConfig({ DATABASE_URL: '', POSTGRES_URL: 'postgres://real' } as unknown as NodeJS.ProcessEnv);
    expect(config.databaseUrl).toBe('postgres://real');
  });

  it('requires PERSISTENCE to be exactly "postgres" and defaults to memory otherwise', () => {
    expect(loadConfig({ PERSISTENCE: 'postgres' } as unknown as NodeJS.ProcessEnv).persistence).toBe('postgres');
    expect(loadConfig({ PERSISTENCE: '' } as unknown as NodeJS.ProcessEnv).persistence).toBe('memory');
    expect(loadConfig({ PERSISTENCE: 'Postgres' } as unknown as NodeJS.ProcessEnv).persistence).toBe('memory');
    expect(loadConfig({} as unknown as NodeJS.ProcessEnv).persistence).toBe('memory');
  });
});

describe('hasRealModelAccess', () => {
  it('is false with no provider keys and true with any one of them', () => {
    expect(hasRealModelAccess(loadConfig({} as unknown as NodeJS.ProcessEnv))).toBe(false);
    expect(hasRealModelAccess(loadConfig({ ANTHROPIC_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv))).toBe(true);
    expect(hasRealModelAccess(loadConfig({ OPENAI_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv))).toBe(true);
    expect(hasRealModelAccess(loadConfig({ AI_GATEWAY_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv))).toBe(true);
  });

  it('treats an empty-string key as not configured', () => {
    expect(hasRealModelAccess(loadConfig({ ANTHROPIC_API_KEY: '' } as unknown as NodeJS.ProcessEnv))).toBe(false);
  });
});
