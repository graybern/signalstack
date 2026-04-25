/**
 * Tech Fingerprint Adapter — Wappalyzer-style (FREE — no API key required)
 *
 * Analyzes a company's website HTML for script sources, meta tags, cookies,
 * and CDN URLs to detect the actual tech stack with direct evidence.
 *
 * Unlike DNS fingerprinting (which looks at DNS records) or keyword scanning
 * (which looks at text content), this detects LOADED JAVASCRIPT — meaning
 * we can say "they use Okta" because we literally observed the Okta widget
 * script being loaded, not because a job posting mentioned it.
 *
 * Evidence types by confidence:
 *   HIGH:   Script URL directly from vendor CDN (e.g., cdn.okta.com/js/okta-sign-in.min.js)
 *   MEDIUM: Meta tag, cookie name, or link rel matching known vendor pattern
 *   LOW:    Inline script pattern or CSS class match
 */

import type { DataSourceAdapter, DataSourceConfig, CompanyEnrichment } from '../types.js';

/** Map of CDN/script URL patterns to detected technology */
const SCRIPT_PATTERNS: { pattern: string; tech: string; category: string; confidence: 'high' | 'medium' | 'low' }[] = [
  // Auth & Identity
  { pattern: 'okta.com', tech: 'Okta', category: 'auth', confidence: 'high' },
  { pattern: 'auth0.com', tech: 'Auth0', category: 'auth', confidence: 'high' },
  { pattern: 'cognito-identity', tech: 'AWS Cognito', category: 'auth', confidence: 'high' },
  { pattern: 'login.microsoftonline.com', tech: 'Azure AD / Entra ID', category: 'auth', confidence: 'high' },
  { pattern: 'accounts.google.com', tech: 'Google SSO', category: 'auth', confidence: 'high' },
  { pattern: 'workos.com', tech: 'WorkOS', category: 'auth', confidence: 'high' },
  { pattern: 'stytch.com', tech: 'Stytch', category: 'auth', confidence: 'high' },
  { pattern: 'clerk.dev', tech: 'Clerk', category: 'auth', confidence: 'high' },
  { pattern: 'clerk.com', tech: 'Clerk', category: 'auth', confidence: 'high' },

  // Observability / Monitoring
  { pattern: 'datadoghq.com', tech: 'Datadog', category: 'observability', confidence: 'high' },
  { pattern: 'datadog-browser-agent', tech: 'Datadog RUM', category: 'observability', confidence: 'high' },
  { pattern: 'newrelic.com', tech: 'New Relic', category: 'observability', confidence: 'high' },
  { pattern: 'sentry.io', tech: 'Sentry', category: 'observability', confidence: 'high' },
  { pattern: 'sentry-cdn.com', tech: 'Sentry', category: 'observability', confidence: 'high' },
  { pattern: 'fullstory.com', tech: 'FullStory', category: 'observability', confidence: 'high' },
  { pattern: 'hotjar.com', tech: 'Hotjar', category: 'analytics', confidence: 'high' },
  { pattern: 'logrocket.com', tech: 'LogRocket', category: 'observability', confidence: 'high' },
  { pattern: 'pendo.io', tech: 'Pendo', category: 'analytics', confidence: 'high' },
  { pattern: 'heap.io', tech: 'Heap', category: 'analytics', confidence: 'high' },
  { pattern: 'mixpanel.com', tech: 'Mixpanel', category: 'analytics', confidence: 'high' },
  { pattern: 'amplitude.com', tech: 'Amplitude', category: 'analytics', confidence: 'high' },
  { pattern: 'segment.io', tech: 'Segment CDP', category: 'analytics', confidence: 'high' },
  { pattern: 'segment.com', tech: 'Segment CDP', category: 'analytics', confidence: 'high' },

  // Security & Zero Trust
  { pattern: 'cloudflare.com', tech: 'Cloudflare', category: 'security', confidence: 'high' },
  { pattern: 'cf-ray', tech: 'Cloudflare', category: 'security', confidence: 'high' },
  { pattern: 'recaptcha', tech: 'Google reCAPTCHA', category: 'security', confidence: 'high' },
  { pattern: 'hcaptcha.com', tech: 'hCaptcha', category: 'security', confidence: 'high' },

  // Cloud / CDN
  { pattern: 'amazonaws.com', tech: 'AWS', category: 'cloud', confidence: 'medium' },
  { pattern: 'cloudfront.net', tech: 'AWS CloudFront', category: 'cloud', confidence: 'high' },
  { pattern: 'googletagmanager.com', tech: 'Google Tag Manager', category: 'analytics', confidence: 'high' },
  { pattern: 'google-analytics.com', tech: 'Google Analytics', category: 'analytics', confidence: 'high' },
  { pattern: 'googletagservices.com', tech: 'Google Ads', category: 'marketing', confidence: 'high' },
  { pattern: 'vercel.com', tech: 'Vercel', category: 'infra', confidence: 'medium' },
  { pattern: 'netlify.com', tech: 'Netlify', category: 'infra', confidence: 'medium' },
  { pattern: 'fastly.com', tech: 'Fastly CDN', category: 'infra', confidence: 'high' },
  { pattern: 'akamaihd.net', tech: 'Akamai CDN', category: 'infra', confidence: 'high' },

  // Support & CX
  { pattern: 'intercom.io', tech: 'Intercom', category: 'support', confidence: 'high' },
  { pattern: 'intercomcdn.com', tech: 'Intercom', category: 'support', confidence: 'high' },
  { pattern: 'zendesk.com', tech: 'Zendesk', category: 'support', confidence: 'high' },
  { pattern: 'zopim.com', tech: 'Zendesk Chat', category: 'support', confidence: 'high' },
  { pattern: 'freshdesk.com', tech: 'Freshdesk', category: 'support', confidence: 'high' },
  { pattern: 'drift.com', tech: 'Drift', category: 'support', confidence: 'high' },
  { pattern: 'hubspot.com', tech: 'HubSpot', category: 'crm', confidence: 'high' },
  { pattern: 'salesforce.com', tech: 'Salesforce', category: 'crm', confidence: 'high' },
  { pattern: 'marketo.com', tech: 'Marketo', category: 'marketing', confidence: 'high' },

  // Feature Flags / DevTools
  { pattern: 'launchdarkly.com', tech: 'LaunchDarkly', category: 'devtools', confidence: 'high' },
  { pattern: 'split.io', tech: 'Split.io', category: 'devtools', confidence: 'high' },
  { pattern: 'optimizely.com', tech: 'Optimizely', category: 'devtools', confidence: 'high' },
  { pattern: 'statsig.com', tech: 'Statsig', category: 'devtools', confidence: 'high' },

  // Payments
  { pattern: 'js.stripe.com', tech: 'Stripe', category: 'payments', confidence: 'high' },
  { pattern: 'paypal.com', tech: 'PayPal', category: 'payments', confidence: 'high' },
  { pattern: 'braintree', tech: 'Braintree', category: 'payments', confidence: 'high' },

  // Compliance / Legal
  { pattern: 'cookielaw.org', tech: 'OneTrust', category: 'compliance', confidence: 'high' },
  { pattern: 'onetrust.com', tech: 'OneTrust', category: 'compliance', confidence: 'high' },
  { pattern: 'cookiepro.com', tech: 'CookiePro', category: 'compliance', confidence: 'high' },
  { pattern: 'usercentrics.com', tech: 'Usercentrics', category: 'compliance', confidence: 'high' },

  // Infra signals
  { pattern: 'nginx', tech: 'Nginx', category: 'infra', confidence: 'low' },
  { pattern: 'react', tech: 'React', category: 'frontend', confidence: 'low' },
  { pattern: 'vue.js', tech: 'Vue.js', category: 'frontend', confidence: 'medium' },
  { pattern: 'angular', tech: 'Angular', category: 'frontend', confidence: 'medium' },
  { pattern: 'next.js', tech: 'Next.js', category: 'frontend', confidence: 'medium' },
];

/** Meta tag patterns */
const META_PATTERNS: { namePattern: string; tech: string }[] = [
  { namePattern: 'generator.*wordpress', tech: 'WordPress' },
  { namePattern: 'generator.*drupal', tech: 'Drupal' },
  { namePattern: 'generator.*ghost', tech: 'Ghost' },
  { namePattern: 'generator.*webflow', tech: 'Webflow' },
  { namePattern: 'generator.*squarespace', tech: 'Squarespace' },
  { namePattern: 'generator.*shopify', tech: 'Shopify' },
  { namePattern: 'generator.*hubspot', tech: 'HubSpot CMS' },
  { namePattern: 'application-name.*next', tech: 'Next.js' },
];

export class TechFingerprintAdapter implements DataSourceAdapter {
  id = 'tech_fingerprint' as const;

  async healthCheck(_config: DataSourceConfig) {
    try {
      const res = await fetch('https://www.google.com', { method: 'HEAD', signal: AbortSignal.timeout(5000) });
      return { ok: res.ok, message: 'Tech fingerprinting available (HTTP fetch works)' };
    } catch {
      return { ok: false, message: 'Cannot make outbound HTTP requests' };
    }
  }

  async enrichCompany(_companyName: string, domain: string | null, config: DataSourceConfig): Promise<Partial<CompanyEnrichment>> {
    if (!domain) return {};

    const timeout = config.settings?.timeout_ms || 7000;
    const baseUrl = domain.startsWith('http') ? domain : `https://${domain}`;

    // Fetch the main page + login/signup page (auth tech often only on those)
    const pagesToCheck = [
      baseUrl,
      `${baseUrl}/login`,
      `${baseUrl}/signin`,
      `${baseUrl}/app`,
    ];

    const htmlChunks: string[] = [];
    for (const url of pagesToCheck) {
      const html = await this.fetchPage(url, timeout);
      if (html) htmlChunks.push(html);
      if (htmlChunks.length >= 2) break; // 2 pages is enough
    }

    if (htmlChunks.length === 0) return {};

    const combinedHtml = htmlChunks.join('\n');
    const detectedTech = this.detectTech(combinedHtml);

    if (detectedTech.length === 0) return {};

    // Build tech_signals with source + confidence
    const techSignals: NonNullable<CompanyEnrichment['tech_signals']> = detectedTech.map(d => ({
      signal: d.tech,
      sources: ['tech_fingerprint' as const],
      confidence: d.confidence,
      evidence: `Detected via ${d.evidenceType}: ${d.evidence.substring(0, 100)}`,
    }));

    // Also populate the flat tech_stack list for backwards compat
    const techStack = detectedTech.map(d => d.tech);

    // Build http_tech_stack additions (security/infra relevant ones)
    const infraTech = detectedTech
      .filter(d => ['security', 'auth', 'cloud', 'infra', 'observability'].includes(d.category))
      .map(d => `${d.tech} (script-detected)`);

    const result: Partial<CompanyEnrichment> = {
      tech_signals: techSignals,
      tech_stack: techStack,
    };

    if (infraTech.length > 0) {
      result.http_tech_stack = infraTech;
    }

    return result;
  }

  private detectTech(html: string): DetectedTech[] {
    const detected = new Map<string, DetectedTech>();

    // 1. Script src attribute detection
    const scriptSrcRegex = /<script[^>]+src=["']([^"']+)["']/gi;
    let match;
    while ((match = scriptSrcRegex.exec(html)) !== null) {
      const src = match[1].toLowerCase();
      for (const pattern of SCRIPT_PATTERNS) {
        if (src.includes(pattern.pattern.toLowerCase()) && !detected.has(pattern.tech)) {
          detected.set(pattern.tech, {
            tech: pattern.tech,
            category: pattern.category,
            confidence: pattern.confidence,
            evidenceType: 'script_src',
            evidence: match[1].substring(0, 120),
          });
        }
      }
    }

    // 2. Inline script content detection (lower confidence)
    const inlineScriptRegex = /<script(?:[^>]*)>([\s\S]{0,5000}?)<\/script>/gi;
    while ((match = inlineScriptRegex.exec(html)) !== null) {
      const scriptContent = match[1].toLowerCase();
      // Look for initialization patterns
      if (scriptContent.includes('window.analytics') && !detected.has('Segment CDP')) {
        detected.set('Segment CDP', { tech: 'Segment CDP', category: 'analytics', confidence: 'medium', evidenceType: 'inline_script', evidence: 'window.analytics initialization' });
      }
      if (scriptContent.includes('datadog') && !detected.has('Datadog')) {
        detected.set('Datadog', { tech: 'Datadog', category: 'observability', confidence: 'medium', evidenceType: 'inline_script', evidence: 'Datadog initialization code' });
      }
      if ((scriptContent.includes('okta') || scriptContent.includes('oktaauth')) && !detected.has('Okta')) {
        detected.set('Okta', { tech: 'Okta', category: 'auth', confidence: 'medium', evidenceType: 'inline_script', evidence: 'Okta initialization code' });
      }
      if (scriptContent.includes('auth0') && !detected.has('Auth0')) {
        detected.set('Auth0', { tech: 'Auth0', category: 'auth', confidence: 'medium', evidenceType: 'inline_script', evidence: 'Auth0 initialization code' });
      }
      if (scriptContent.includes('intercomappid') || scriptContent.includes('window.intercomsettings')) {
        if (!detected.has('Intercom')) {
          detected.set('Intercom', { tech: 'Intercom', category: 'support', confidence: 'high', evidenceType: 'inline_script', evidence: 'Intercom app initialization' });
        }
      }
      if (scriptContent.includes('launchdarkly') && !detected.has('LaunchDarkly')) {
        detected.set('LaunchDarkly', { tech: 'LaunchDarkly', category: 'devtools', confidence: 'medium', evidenceType: 'inline_script', evidence: 'LaunchDarkly initialization' });
      }
    }

    // 3. Link href detection (CDN links for fonts, stylesheets)
    const linkHrefRegex = /<link[^>]+href=["']([^"']+)["']/gi;
    while ((match = linkHrefRegex.exec(html)) !== null) {
      const href = match[1].toLowerCase();
      for (const pattern of SCRIPT_PATTERNS) {
        if (href.includes(pattern.pattern.toLowerCase()) && !detected.has(pattern.tech)) {
          detected.set(pattern.tech, {
            tech: pattern.tech,
            category: pattern.category,
            confidence: 'medium', // Lower confidence for CSS links
            evidenceType: 'link_href',
            evidence: match[1].substring(0, 120),
          });
        }
      }
    }

    // 4. Meta tag detection
    const metaRegex = /<meta[^>]+(name|property)=["']([^"']*)["'][^>]*content=["']([^"']*)["']/gi;
    while ((match = metaRegex.exec(html)) !== null) {
      const nameAttr = match[2].toLowerCase();
      const content = match[3].toLowerCase();
      const combined = `${nameAttr}:${content}`;
      for (const mp of META_PATTERNS) {
        if (new RegExp(mp.namePattern).test(combined) && !detected.has(mp.tech)) {
          detected.set(mp.tech, {
            tech: mp.tech,
            category: 'cms',
            confidence: 'high',
            evidenceType: 'meta_tag',
            evidence: `${nameAttr}="${content}"`,
          });
        }
      }
    }

    return Array.from(detected.values());
  }

  private async fetchPage(url: string, timeout: number): Promise<string | null> {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,*/*',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeout),
      });
      if (!res.ok) return null;
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('text/html')) return null;
      const text = await res.text();
      // Only need first 200KB — scripts are in <head> or early <body>
      return text.substring(0, 200000);
    } catch {
      return null;
    }
  }
}

interface DetectedTech {
  tech: string;
  category: string;
  confidence: 'high' | 'medium' | 'low';
  evidenceType: 'script_src' | 'inline_script' | 'link_href' | 'meta_tag';
  evidence: string;
}
