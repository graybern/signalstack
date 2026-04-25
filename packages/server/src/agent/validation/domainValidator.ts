import dns from 'dns/promises';

export interface DomainValidationResult {
  exists: boolean;
  httpStatus: number | null;
  redirectsTo: string | null;
  isParked: boolean;
  responseTimeMs: number;
  error: string | null;
}

const PARKING_PATTERNS = [
  'sedoparking',
  'godaddy parking',
  'parkingcrew',
  'hugedomains',
  'afternic',
  'domain for sale',
  'buy this domain',
  'this domain is for sale',
  'domain is parked',
  'parked by',
  'domain parking',
  'este dominio',
  'dan.com',
  'undeveloped.com',
];

const CONCURRENCY_LIMIT = 5;
const REQUEST_TIMEOUT_MS = 10_000;

function isParkedBody(html: string): boolean {
  const lower = html.toLowerCase();
  return PARKING_PATTERNS.some(pattern => lower.includes(pattern));
}

async function httpCheck(
  domain: string,
  protocol: 'https' | 'http'
): Promise<{ status: number; redirectsTo: string | null; isParked: boolean }> {
  const url = `${protocol}://${domain}`;

  const headResp = await fetch(url, {
    method: 'HEAD',
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const finalUrl = headResp.url;
  const redirectedHost = new URL(finalUrl).hostname;
  const redirectsTo = redirectedHost !== domain ? finalUrl : null;

  let isParked = false;
  try {
    const getResp = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await getResp.text();
    isParked = isParkedBody(body);
  } catch {
    // If GET fails after HEAD succeeded, we just can't determine parking status
  }

  return { status: headResp.status, redirectsTo, isParked };
}

export async function validateDomain(domain: string): Promise<DomainValidationResult> {
  const start = Date.now();

  try {
    await dns.resolve(domain);
  } catch (err: any) {
    return {
      exists: false,
      httpStatus: null,
      redirectsTo: null,
      isParked: false,
      responseTimeMs: Date.now() - start,
      error: err.code === 'ENOTFOUND' ? 'DNS lookup failed — domain does not exist' : `DNS error: ${err.code}`,
    };
  }

  // HTTPS first, fall back to HTTP
  try {
    const result = await httpCheck(domain, 'https');
    return {
      exists: true,
      httpStatus: result.status,
      redirectsTo: result.redirectsTo,
      isParked: result.isParked,
      responseTimeMs: Date.now() - start,
      error: null,
    };
  } catch {
    // HTTPS failed, try HTTP
  }

  try {
    const result = await httpCheck(domain, 'http');
    return {
      exists: true,
      httpStatus: result.status,
      redirectsTo: result.redirectsTo,
      isParked: result.isParked,
      responseTimeMs: Date.now() - start,
      error: null,
    };
  } catch (err: any) {
    // DNS resolved but HTTP unreachable — domain exists but site is down
    const isTimeout = err.name === 'TimeoutError' || err.code === 'UND_ERR_CONNECT_TIMEOUT';
    return {
      exists: true,
      httpStatus: null,
      redirectsTo: null,
      isParked: false,
      responseTimeMs: Date.now() - start,
      error: isTimeout ? 'HTTP request timed out' : `HTTP error: ${err.message}`,
    };
  }
}

export function shouldKeepCandidate(result: DomainValidationResult): boolean {
  return result.exists && !result.isParked;
}

export async function validateCandidateDomains(
  candidates: Array<{ company_name: string; domain?: string }>,
  logger?: any
): Promise<Map<string, DomainValidationResult>> {
  const results = new Map<string, DomainValidationResult>();
  const withDomains = candidates.filter(c => c.domain);

  if (withDomains.length === 0) return results;

  logger?.thinking?.('discover', `Validating ${withDomains.length} candidate domains...`);

  let completed = 0;
  const queue = [...withDomains];

  async function worker() {
    while (queue.length > 0) {
      const candidate = queue.shift()!;
      const domain = candidate.domain!;

      if (results.has(domain)) continue;

      const result = await validateDomain(domain);
      results.set(domain, result);
      completed++;

      if (logger) {
        const status = result.exists
          ? result.isParked
            ? 'parked'
            : 'valid'
          : 'not found';
        logger.thinking?.('discover', `[${completed}/${withDomains.length}] ${domain}: ${status}`);
      }
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY_LIMIT, withDomains.length) }, () => worker());
  await Promise.all(workers);

  const valid = [...results.values()].filter(r => shouldKeepCandidate(r)).length;
  const parked = [...results.values()].filter(r => r.isParked).length;
  const missing = [...results.values()].filter(r => !r.exists).length;

  logger?.thinking?.(
    'discover',
    `Domain validation complete: ${valid} valid, ${parked} parked, ${missing} not found (${withDomains.length} checked)`
  );

  return results;
}
