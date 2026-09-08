import { describe, expect, it } from 'vitest';
import {
  assertUrlAllowed,
  assertUrlShape,
  isPrivateAddress,
  normalizeRootUrl,
  registrableDomain,
  UrlBlockedError,
} from '../src/core/security/url-guard.js';

/** SSRF corpus from docs/EVALUATION.md §5. Every entry must be rejected. */
const HOSTILE_SHAPES = [
  'http://localhost/',
  'http://localhost.localdomain/',
  'http://127.0.0.1/',
  'http://127.1.2.3/',
  'http://0.0.0.0/',
  'http://10.0.0.5/',
  'http://172.16.4.4/',
  'http://192.168.1.1/',
  'http://169.254.169.254/latest/meta-data/',
  'http://[::1]/',
  'http://[fd00::1]/',
  'http://[fe80::1]/',
  'http://metadata.google.internal/',
  'http://printer.local/',
  'file:///etc/passwd',
  'gopher://example.com/',
  'ftp://example.com/',
  'http://user:pass@example.com/',
  'http://example.com:22/',
];

describe('UrlGuard shape checks', () => {
  for (const url of HOSTILE_SHAPES) {
    it(`blocks ${url}`, () => {
      expect(() => assertUrlShape(url)).toThrow(UrlBlockedError);
    });
  }

  it('allows a normal public https URL', () => {
    expect(() => assertUrlShape('https://www.example.com/pricing')).not.toThrow();
  });

  it('keeps the crawl on the submitted registrable domain', () => {
    expect(() => assertUrlShape('https://evil.test/x', { scopeDomain: 'example.com' })).toThrow(
      /out_of_scope_domain/,
    );
    expect(() => assertUrlShape('https://blog.example.com/x', { scopeDomain: 'example.com' })).not.toThrow();
  });
});

describe('UrlGuard DNS checks', () => {
  it('blocks a public hostname that resolves to a private address (DNS rebinding)', async () => {
    await expect(
      assertUrlAllowed('https://rebind.example.com/', { resolve: async () => ['10.1.2.3'] }),
    ).rejects.toThrow(/resolves_to_private_address/);
  });

  it('blocks a hostname that resolves to the cloud metadata endpoint', async () => {
    await expect(
      assertUrlAllowed('https://meta.example.com/', { resolve: async () => ['169.254.169.254'] }),
    ).rejects.toThrow(/resolves_to_private_address/);
  });

  it('blocks when one of several records is private', async () => {
    await expect(
      assertUrlAllowed('https://mixed.example.com/', { resolve: async () => ['93.184.216.34', '127.0.0.1'] }),
    ).rejects.toThrow(/resolves_to_private_address/);
  });

  it('allows a hostname that resolves to a public address', async () => {
    await expect(
      assertUrlAllowed('https://ok.example.com/', { resolve: async () => ['93.184.216.34'] }),
    ).resolves.toBeInstanceOf(URL);
  });

  it('blocks when DNS fails rather than falling through', async () => {
    await expect(
      assertUrlAllowed('https://nx.example.com/', {
        resolve: async () => {
          throw new Error('ENOTFOUND');
        },
      }),
    ).rejects.toThrow(/dns_resolution_failed/);
  });
});

describe('address classification', () => {
  it.each([
    ['10.0.0.1', true],
    ['172.31.255.255', true],
    ['172.32.0.1', false],
    ['192.168.0.1', true],
    ['100.64.0.1', true],
    ['8.8.8.8', false],
    ['93.184.216.34', false],
    ['::ffff:127.0.0.1', true],
    ['2606:2800:220:1:248:1893:25c8:1946', false],
    ['not-an-ip', true],
  ])('%s private=%s', (ip, expected) => {
    expect(isPrivateAddress(ip)).toBe(expected);
  });
});

describe('helpers', () => {
  it('derives registrable domains', () => {
    expect(registrableDomain('www.example.com')).toBe('example.com');
    expect(registrableDomain('shop.example.co.uk')).toBe('example.co.uk');
    expect(registrableDomain('example.dk')).toBe('example.dk');
  });

  it('normalizes a submitted root URL', () => {
    expect(normalizeRootUrl(' example.com ')).toBe('https://example.com');
    expect(normalizeRootUrl('https://example.com/?utm_source=x#top')).toBe('https://example.com');
  });
});
