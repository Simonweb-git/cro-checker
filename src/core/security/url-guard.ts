import { promises as dns } from 'node:dns';
import net from 'node:net';

/**
 * SSRF defense. Re-applied before every request AND after every redirect/DNS change (ADR-008).
 * A single check at submission time is defeated by DNS rebinding and redirect chains.
 */

export class UrlBlockedError extends Error {
  constructor(
    readonly url: string,
    readonly reason: string,
  ) {
    super(`Blocked URL ${url}: ${reason}`);
    this.name = 'UrlBlockedError';
  }
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
]);

/** Cloud metadata endpoints, blocked explicitly as well as by range checks. */
const METADATA_IPS = new Set(['169.254.169.254', '169.254.170.2', 'fd00:ec2::254']);

export function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  const [a = 0, b = 0] = parts;
  if (a === 10) return true; // RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 0) return true; // "this network"
  if (a === 169 && b === 254) return true; // link-local + metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT RFC6598
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

export function isPrivateIpv6(ip: string): boolean {
  const addr = ip.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0] ?? '';
  if (addr === '::1' || addr === '::') return true;
  if (addr.startsWith('fe80')) return true; // link-local
  if (addr.startsWith('fc') || addr.startsWith('fd')) return true; // unique local
  if (addr.startsWith('::ffff:')) {
    const mapped = addr.slice('::ffff:'.length);
    return net.isIPv4(mapped) ? isPrivateIpv4(mapped) : true;
  }
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  if (METADATA_IPS.has(ip.toLowerCase())) return true;
  if (net.isIPv4(ip)) return isPrivateIpv4(ip);
  if (net.isIPv6(ip)) return isPrivateIpv6(ip);
  return true; // unparseable ⇒ refuse
}

/** eTLD+1-ish: good enough to keep a crawl on one site without shipping a public-suffix list. */
export function registrableDomain(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  const twoLevelTlds = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu']);
  const secondFromLast = labels[labels.length - 2];
  if (labels.length >= 3 && secondFromLast && twoLevelTlds.has(secondFromLast)) {
    return labels.slice(-3).join('.');
  }
  return labels.slice(-2).join('.');
}

export function sameSite(a: string, b: string): boolean {
  try {
    return registrableDomain(new URL(a).hostname) === registrableDomain(new URL(b).hostname);
  } catch {
    return false;
  }
}

export interface UrlGuardOptions {
  /** When set, requests must stay on this registrable domain (build spec §8). */
  scopeDomain?: string;
  /** Injected in tests so DNS behaviour is deterministic. */
  resolve?: (hostname: string) => Promise<string[]>;
}

async function defaultResolve(hostname: string): Promise<string[]> {
  const records = await dns.lookup(hostname, { all: true });
  return records.map((r) => r.address);
}

/** Synchronous checks: scheme, credentials, hostname, literal IP, port, scope. */
export function assertUrlShape(rawUrl: string, options: UrlGuardOptions = {}): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UrlBlockedError(rawUrl, 'malformed_url');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlBlockedError(rawUrl, 'unsupported_scheme');
  }
  if (url.username || url.password) throw new UrlBlockedError(rawUrl, 'credentials_in_url');

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname) throw new UrlBlockedError(rawUrl, 'empty_host');
  if (BLOCKED_HOSTNAMES.has(hostname)) throw new UrlBlockedError(rawUrl, 'blocked_hostname');
  if (hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new UrlBlockedError(rawUrl, 'blocked_hostname');
  }
  if ((net.isIP(hostname) !== 0 || /^\d+$/.test(hostname)) && isPrivateAddress(hostname)) {
    throw new UrlBlockedError(rawUrl, 'private_address_literal');
  }
  if (url.port && !['80', '443', ''].includes(url.port)) {
    throw new UrlBlockedError(rawUrl, 'non_standard_port');
  }
  if (options.scopeDomain && registrableDomain(hostname) !== options.scopeDomain) {
    throw new UrlBlockedError(rawUrl, 'out_of_scope_domain');
  }
  return url;
}

/** Full check including DNS resolution. Call this for the initial URL and after every redirect. */
export async function assertUrlAllowed(rawUrl: string, options: UrlGuardOptions = {}): Promise<URL> {
  const url = assertUrlShape(rawUrl, options);
  const resolve = options.resolve ?? defaultResolve;
  let addresses: string[];
  try {
    addresses = await resolve(url.hostname);
  } catch {
    throw new UrlBlockedError(rawUrl, 'dns_resolution_failed');
  }
  if (addresses.length === 0) throw new UrlBlockedError(rawUrl, 'dns_no_records');
  for (const address of addresses) {
    if (isPrivateAddress(address)) throw new UrlBlockedError(rawUrl, 'resolves_to_private_address');
  }
  return url;
}

/** Normalizes a submitted root URL: adds https, strips fragments/tracking, drops trailing slash. */
export function normalizeRootUrl(input: string): string {
  const trimmed = input.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  url.hash = '';
  url.search = '';
  if (url.pathname === '/') url.pathname = '';
  return url.toString().replace(/\/$/, '');
}
