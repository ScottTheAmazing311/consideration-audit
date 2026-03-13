import * as cheerio from 'cheerio';
import { crawlSite, type CrawlResult } from './cloudflare-crawl';

// ═══════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════
export interface CheckResult {
  name: string;
  category: string;
  passed: boolean;
  score: number;
  maxPoints: number;
  detail: string;
  headline: string;
}

export interface CategoryScore {
  name: string;
  score: number;
  maxPoints: number;
  percentage: number;
  grade: string;
  checks: CheckResult[];
}

export interface ScanResult {
  url: string;
  domain: string;
  firmName: string;
  overallScore: number;
  grade: string;
  gradeLabel: string;
  categories: {
    onPageSEO: CategoryScore;
    contentDepth: CategoryScore;
    localSEO: CategoryScore;
    conversionConsideration: CategoryScore;
  };
  totalChecks: number;
  passedChecks: number;
  scanDurationMs: number;
  headlineFindings: string[];
  errors: string[];
  crawlEnhanced: boolean;
  crawlPagesUsed: number;
  practiceAreasFound: string[];
}

interface FetchedResource {
  content: string | null;
  status: number | null;
  headers: Record<string, string>;
  error: string | null;
  loadTimeMs: number;
}

interface ParsedPage {
  url: string;
  html: string;
  $: cheerio.CheerioAPI;
  title: string;
  metaDescription: string;
  bodyText: string;
  wordCount: number;
  headings: { tag: string; text: string }[];
  internalLinks: { text: string; href: string }[];
  allLinks: { text: string; href: string }[];
  jsonLd: any[];
  hasViewport: boolean;
  htmlSize: number;
  forms: { action: string }[];
  phoneNumbers: string[];
  hasTelLink: boolean;
  hasSSL: boolean;
  hasCanonical: boolean;
  hasNoindex: boolean;
  imgCount: number;
  imgWithAlt: number;
  hasBreadcrumbSchema: boolean;
  contactPhone: string | null;
  contactAddress: string | null;
}

// Practice area taxonomy for identification
const PRACTICE_AREA_KEYWORDS: { area: string; keywords: string[] }[] = [
  { area: 'Personal Injury', keywords: ['personal injury', 'personal-injury', 'accident', 'injuries'] },
  { area: 'Car Accidents', keywords: ['car accident', 'auto accident', 'vehicle accident', 'car-accident', 'auto-accident'] },
  { area: 'Truck Accidents', keywords: ['truck accident', 'trucking accident', 'semi truck', '18 wheeler', 'truck-accident'] },
  { area: 'Motorcycle Accidents', keywords: ['motorcycle accident', 'motorcycle-accident', 'motorbike'] },
  { area: 'Wrongful Death', keywords: ['wrongful death', 'wrongful-death'] },
  { area: 'Medical Malpractice', keywords: ['medical malpractice', 'medical-malpractice', 'surgical error', 'misdiagnosis'] },
  { area: 'Slip and Fall', keywords: ['slip and fall', 'slip-and-fall', 'premises liability', 'premises-liability', 'trip and fall'] },
  { area: 'Workers Compensation', keywords: ['workers comp', 'workers\' comp', 'work injury', 'workplace injury', 'workers-comp'] },
  { area: 'Product Liability', keywords: ['product liability', 'product-liability', 'defective product'] },
  { area: 'Dog Bites', keywords: ['dog bite', 'dog-bite', 'animal attack'] },
  { area: 'Birth Injury', keywords: ['birth injury', 'birth-injury', 'cerebral palsy', 'erb\'s palsy'] },
  { area: 'Nursing Home Abuse', keywords: ['nursing home', 'nursing-home', 'elder abuse', 'elder-abuse'] },
  { area: 'Brain Injury', keywords: ['brain injury', 'brain-injury', 'traumatic brain', 'tbi'] },
  { area: 'Spinal Cord Injury', keywords: ['spinal cord', 'spinal-cord', 'paralysis'] },
  { area: 'Burn Injury', keywords: ['burn injury', 'burn-injury', 'fire accident'] },
  { area: 'Bicycle Accidents', keywords: ['bicycle accident', 'bicycle-accident', 'bike accident', 'cyclist'] },
  { area: 'Pedestrian Accidents', keywords: ['pedestrian accident', 'pedestrian-accident', 'hit by car'] },
  { area: 'Boating Accidents', keywords: ['boating accident', 'boating-accident', 'maritime', 'boat accident'] },
  { area: 'Aviation Accidents', keywords: ['aviation accident', 'aviation-accident', 'plane crash', 'airplane'] },
  { area: 'Construction Accidents', keywords: ['construction accident', 'construction-accident', 'scaffold', 'construction injury'] },
  { area: 'Rideshare Accidents', keywords: ['uber accident', 'lyft accident', 'rideshare', 'ride-share'] },
  { area: 'Mass Torts', keywords: ['mass tort', 'mass-tort', 'class action', 'class-action', 'multidistrict'] },
  { area: 'Insurance Bad Faith', keywords: ['bad faith', 'bad-faith', 'insurance dispute', 'denied claim'] },
  { area: 'Sexual Abuse', keywords: ['sexual abuse', 'sexual-abuse', 'sexual assault', 'molestation'] },
  { area: 'Catastrophic Injury', keywords: ['catastrophic injury', 'catastrophic-injury', 'severe injury'] },
];

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MAX_RESPONSE_BYTES = 1_500_000;

// ═══════════════════════════════════════════════════════════
// FETCH HELPERS
// ═══════════════════════════════════════════════════════════
async function fetchResource(url: string, timeoutMs = 10000): Promise<FetchedResource> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });

    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });

    const reader = response.body?.getReader();
    if (!reader) return { content: null, status: response.status, headers, error: 'No body', loadTimeMs: Date.now() - start };

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        chunks.push(value.slice(0, MAX_RESPONSE_BYTES - (totalBytes - value.byteLength)));
        reader.cancel();
        break;
      }
      chunks.push(value);
    }

    const decoder = new TextDecoder('utf-8', { fatal: false });
    return { content: decoder.decode(Buffer.concat(chunks)), status: response.status, headers, error: null, loadTimeMs: Date.now() - start };
  } catch (err: any) {
    return { content: null, status: null, headers: {}, error: err.message, loadTimeMs: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}

// ═══════════════════════════════════════════════════════════
// GOOGLE PAGESPEED INSIGHTS (FREE, NO KEY)
// ═══════════════════════════════════════════════════════════
async function fetchPageSpeedScore(url: string): Promise<{ score: number | null; error: string | null }> {
  const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile&category=performance`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(apiUrl, { signal: controller.signal });
    if (!res.ok) return { score: null, error: `PageSpeed API error: ${res.status}` };
    const data = await res.json();
    const score = data?.lighthouseResult?.categories?.performance?.score;
    if (typeof score === 'number') return { score: Math.round(score * 100), error: null };
    return { score: null, error: 'No score in response' };
  } catch (err: any) {
    return { score: null, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

// ═══════════════════════════════════════════════════════════
// PARSE PAGE
// ═══════════════════════════════════════════════════════════
function parsePage(html: string, url: string, isSSL: boolean, baseDomain: string): ParsedPage {
  const $ = cheerio.load(html);
  const htmlSize = html.length;
  const title = $('title').first().text().trim();
  const metaDescription = $('meta[name="description"]').attr('content')?.trim() || '';

  const headings: { tag: string; text: string }[] = [];
  $('h1, h2, h3').each((i, el) => {
    if (headings.length >= 40) return false;
    const tag = (el as any).tagName?.toLowerCase() || '';
    const text = $(el).text().trim().replace(/\s+/g, ' ');
    if (text) headings.push({ tag, text });
  });

  // JSON-LD
  const jsonLd: any[] = [];
  $('script[type="application/ld+json"]').each((i, el) => {
    try {
      const raw = $(el).html();
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) jsonLd.push(...parsed);
        else jsonLd.push(parsed);
      }
    } catch { /* skip */ }
  });

  // All links
  const allLinks: { text: string; href: string }[] = [];
  const internalLinks: { text: string; href: string }[] = [];
  $('a[href]').each((i, el) => {
    if (allLinks.length >= 100) return false;
    const href = $(el).attr('href');
    const text = $(el).text().trim().replace(/\s+/g, ' ');
    if (!href || !text) return;
    try {
      const resolved = new URL(href, url).toString();
      allLinks.push({ text, href: resolved });
      const linkHost = new URL(resolved).hostname.replace(/^www\./, '');
      if (linkHost === baseDomain) {
        internalLinks.push({ text, href: resolved });
      }
    } catch { /* skip */ }
  });

  // Body text and word count
  const $body = cheerio.load(html);
  $body('script, style, nav, footer, header, noscript, iframe, svg').remove();
  const bodyText = $body('body').text().replace(/\s+/g, ' ').trim();
  const wordCount = bodyText.split(/\s+/).filter(Boolean).length;

  // Forms
  const forms: { action: string }[] = [];
  $('form').each((i, el) => {
    const action = $(el).attr('action') || '';
    forms.push({ action });
  });

  // Phone numbers
  const phoneRegex = /(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
  const phoneMatches = html.match(phoneRegex) || [];
  const phoneNumbers = [...new Set(phoneMatches)];
  const hasTelLink = $('a[href^="tel:"]').length > 0;

  // Viewport
  const hasViewport = !!$('meta[name="viewport"][content*="width"]').attr('content');

  // Canonical & noindex
  const hasCanonical = !!$('link[rel="canonical"]').attr('href');
  const hasNoindex = !!$('meta[name="robots"][content*="noindex"]').attr('content');

  // Image alt text
  let imgCount = 0;
  let imgWithAlt = 0;
  $('img').each((i, el) => {
    imgCount++;
    const alt = $(el).attr('alt');
    if (alt && alt.trim().length > 0) imgWithAlt++;
  });

  // Breadcrumb schema
  const hasBreadcrumbSchema = jsonLd.some(item => {
    const type = item?.['@type'];
    return type === 'BreadcrumbList' || (Array.isArray(type) && type.includes('BreadcrumbList'));
  });

  // Contact info
  const contactPhone = phoneNumbers.length > 0 ? phoneNumbers[0] : null;
  const addressRegex = /\d+\s+[\w\s]+(?:street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|lane|ln|way|court|ct|suite|ste|floor|fl)[\s.,]+[\w\s]+,?\s*[A-Z]{2}\s*\d{5}/i;
  const addressMatch = bodyText.match(addressRegex);
  const contactAddress = addressMatch ? addressMatch[0] : null;

  return {
    url, html, $, title, metaDescription, bodyText, wordCount, headings,
    internalLinks, allLinks, jsonLd, hasViewport, htmlSize, forms,
    phoneNumbers, hasTelLink, hasSSL: isSSL, hasCanonical, hasNoindex,
    imgCount, imgWithAlt, hasBreadcrumbSchema, contactPhone, contactAddress,
  };
}

// ═══════════════════════════════════════════════════════════
// SUBPAGE DISCOVERY (expanded for practice area focus)
// ═══════════════════════════════════════════════════════════
function discoverSubpages(homepage: ParsedPage, baseUrl: string, baseDomain: string): string[] {
  const base = new URL(baseUrl);
  const candidates: { url: string; priority: number }[] = [];
  const seen = new Set<string>();
  const keywords = [
    'practice', 'area', 'service', 'attorney', 'lawyer', 'about', 'team',
    'result', 'verdict', 'review', 'testimonial', 'contact', 'blog',
    'personal-injury', 'car-accident', 'truck-accident', 'wrongful-death',
    'medical-malpractice', 'workers-comp', 'slip-and-fall', 'faq',
    'case-result', 'injury', 'accident', 'location', 'office',
    'liability', 'negligence', 'malpractice', 'criminal', 'defense',
    'family-law', 'divorce', 'custody', 'estate', 'bankruptcy',
    'immigration', 'employment', 'discrimination',
  ];

  for (const link of homepage.allLinks) {
    try {
      const linkUrl = new URL(link.href);
      if (linkUrl.hostname.replace(/^www\./, '') !== baseDomain) continue;
      if (linkUrl.pathname === '/' || linkUrl.pathname === '') continue;
      if (linkUrl.pathname.match(/\.(pdf|jpg|png|gif|svg|css|js|zip)$/i)) continue;

      const normalized = linkUrl.origin + linkUrl.pathname.replace(/\/$/, '');
      if (seen.has(normalized)) continue;
      seen.add(normalized);

      const pathAndText = (linkUrl.pathname + ' ' + link.text).toLowerCase();
      let priority = 0;
      for (const k of keywords) {
        if (pathAndText.includes(k)) priority++;
      }
      // Boost practice area pages
      for (const pa of PRACTICE_AREA_KEYWORDS) {
        for (const kw of pa.keywords) {
          if (pathAndText.includes(kw)) { priority += 3; break; }
        }
      }
      if (priority > 0) candidates.push({ url: normalized, priority });
    } catch { /* skip */ }
  }

  // Fallback paths
  const fallbackPaths = [
    '/about', '/about-us', '/practice-areas', '/services',
    '/results', '/case-results', '/testimonials', '/reviews',
    '/attorneys', '/team', '/our-team', '/contact', '/blog',
    '/faq', '/personal-injury', '/car-accidents',
    '/personal-injury-blog', '/injury-blog', '/legal-blog', '/law-blog',
    '/in-the-news', '/media', '/publications', '/updates',
  ];
  for (const path of fallbackPaths) {
    const fallbackUrl = base.origin + path;
    if (!seen.has(fallbackUrl)) {
      candidates.push({ url: fallbackUrl, priority: 0 });
      seen.add(fallbackUrl);
    }
  }

  candidates.sort((a, b) => b.priority - a.priority);
  return candidates.slice(0, 10).map(c => c.url); // Up to 10 subpages (vs 5 in client-acquisition)
}

// ═══════════════════════════════════════════════════════════
// PRACTICE AREA IDENTIFICATION ENGINE
// ═══════════════════════════════════════════════════════════
interface PracticeAreaPage {
  area: string;
  page: ParsedPage;
}

// Broad regex patterns to catch state/city-prefixed practice area URLs
const STATE_PREFIXED_PA_VEHICLE = /[a-z]+-(?:car|truck|motorcycle|bicycle|pedestrian|bus|uber|lyft|rideshare|boat|aviation|drunk-driving|distracted-driving|hit-and-run|company-vehicle|government-vehicle|uninsured)[_-]?(?:accident|crash|collision|injury)[_-]?(?:lawyer|attorney|law)/i;
const STATE_PREFIXED_PA_GENERAL = /[a-z]+-(?:personal-injury|wrongful-death|medical-malpractice|birth-injury|brain-injury|spinal-cord|dog-bite|slip-and-fall|catastrophic-injury|nursing-home|premises-liability|workers-comp)[_-]?(?:lawyer|attorney|law)/i;

function identifyPracticeAreaPages(pages: ParsedPage[]): PracticeAreaPage[] {
  const results: PracticeAreaPage[] = [];
  const seenAreas = new Set<string>();

  for (const page of pages) {
    const urlPath = page.url.toLowerCase();
    const titleLower = page.title.toLowerCase();
    const h1Text = page.headings.filter(h => h.tag === 'h1').map(h => h.text.toLowerCase()).join(' ');
    const searchText = urlPath + ' ' + titleLower + ' ' + h1Text;

    // Check state/city-prefixed URL patterns (e.g. /utah-car-accident-attorneys/)
    if (STATE_PREFIXED_PA_VEHICLE.test(urlPath) || STATE_PREFIXED_PA_GENERAL.test(urlPath)) {
      // Map to most relevant practice area
      for (const pa of PRACTICE_AREA_KEYWORDS) {
        if (seenAreas.has(pa.area)) continue;
        for (const kw of pa.keywords) {
          if (searchText.includes(kw)) {
            results.push({ area: pa.area, page });
            seenAreas.add(pa.area);
            break;
          }
        }
      }
    }

    for (const pa of PRACTICE_AREA_KEYWORDS) {
      if (seenAreas.has(pa.area)) continue;
      for (const kw of pa.keywords) {
        if (searchText.includes(kw)) {
          results.push({ area: pa.area, page });
          seenAreas.add(pa.area);
          break;
        }
      }
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════
// GRADE HELPERS
// ═══════════════════════════════════════════════════════════
function gradeFromScore(score: number): { grade: string; label: string } {
  if (score >= 85) return { grade: 'A+', label: 'Search Dominator' };
  if (score >= 75) return { grade: 'A', label: 'Highly Competitive' };
  if (score >= 65) return { grade: 'B+', label: 'Above the Fold' };
  if (score >= 55) return { grade: 'B', label: 'Middle of the Pack' };
  if (score >= 45) return { grade: 'C+', label: 'Losing Ground' };
  if (score >= 35) return { grade: 'C', label: 'Below the Fold' };
  return { grade: 'D', label: 'Invisible to Searchers' };
}

function categoryGrade(pct: number): string {
  if (pct >= 80) return 'A';
  if (pct >= 65) return 'B';
  if (pct >= 50) return 'C';
  if (pct >= 35) return 'D';
  return 'F';
}

function extractFirmName(page: ParsedPage): string {
  for (const item of page.jsonLd) {
    if (item?.name && typeof item.name === 'string') return item.name;
  }
  if (page.title) {
    return page.title
      .replace(/\s*[-|–—]\s*(home|welcome|attorney|lawyer|law\s*firm|personal\s*injury).*/i, '')
      .replace(/\s*[-|–—]\s*.*$/i, '')
      .trim() || page.title;
  }
  return new URL(page.url).hostname;
}

// ═══════════════════════════════════════════════════════════
// CATEGORY A: ON-PAGE SEO QUALITY (30 pts)
// ═══════════════════════════════════════════════════════════

function checkTitleTagOptimization(pages: ParsedPage[]): CheckResult {
  const maxPoints = 6;
  let score = 0;
  const titles = pages.map(p => p.title);
  const uniqueTitles = new Set(titles.filter(t => t.length > 0));

  // Length check (50-60 chars ideal)
  const homePage = pages[0];
  const titleLen = homePage?.title.length || 0;
  const goodLength = titleLen >= 50 && titleLen <= 60;
  const okLength = titleLen >= 30 && titleLen <= 70;

  // Location + practice keyword in title
  const locationPattern = /\b(?:law\s*firm|attorney|lawyer)\b/i;
  const hasKeywords = locationPattern.test(homePage?.title || '');

  // Unique titles across pages
  const allTitlesUnique = uniqueTitles.size >= Math.min(titles.length, 3);

  if (goodLength) score += 2;
  else if (okLength) score += 1;
  if (hasKeywords) score += 2;
  if (allTitlesUnique && pages.length > 1) score += 2;
  else if (allTitlesUnique) score += 1;

  const passed = score >= 5;
  return {
    name: 'Title Tag Optimization', category: 'onPageSEO', passed,
    score: Math.min(score, maxPoints), maxPoints,
    detail: passed
      ? `Title tags are well optimized. ${uniqueTitles.size} unique titles across ${pages.length} pages scanned.`
      : `Title tag needs work. Length: ${titleLen} chars (ideal: 50-60).${!hasKeywords ? ' Missing practice/attorney keywords.' : ''}${!allTitlesUnique ? ' Some pages share duplicate titles.' : ''}`,
    headline: passed ? 'Title tags optimized' : `Title tag: ${titleLen} chars${!hasKeywords ? ', missing keywords' : ''}`
  };
}

function checkMetaDescriptionQuality(pages: ParsedPage[]): CheckResult {
  const maxPoints = 5;
  let score = 0;

  const homePage = pages[0];
  const desc = homePage?.metaDescription || '';
  const descLen = desc.length;
  const goodLength = descLen >= 120 && descLen <= 160;
  const okLength = descLen >= 80 && descLen <= 200;

  // CTA phrases
  const ctaPattern = /(?:call|contact|free|consultation|schedule|book|get help|speak|learn more)/i;
  const hasCTA = ctaPattern.test(desc);

  // Unique descriptions
  const descriptions = pages.map(p => p.metaDescription).filter(d => d.length > 0);
  const uniqueDescs = new Set(descriptions);
  const allUnique = uniqueDescs.size >= Math.min(descriptions.length, 3);

  if (goodLength) score += 2;
  else if (okLength) score += 1;
  if (hasCTA) score += 1;
  if (allUnique && descriptions.length > 1) score += 2;
  else if (desc.length > 0) score += 1;

  const passed = score >= 4;
  return {
    name: 'Meta Description Quality', category: 'onPageSEO', passed,
    score: Math.min(score, maxPoints), maxPoints,
    detail: passed
      ? `Meta descriptions are well crafted. ${uniqueDescs.size} unique descriptions found.`
      : `Meta description needs improvement. Length: ${descLen} chars (ideal: 120-160).${!hasCTA ? ' No call-to-action phrase.' : ''}${!allUnique ? ' Some pages share duplicate descriptions.' : ''}`,
    headline: passed ? 'Meta descriptions solid' : `Meta desc: ${descLen} chars${!hasCTA ? ', no CTA' : ''}`
  };
}

function checkHeadingStructure(pages: ParsedPage[]): CheckResult {
  const maxPoints = 5;
  let score = 0;

  const homePage = pages[0];
  const h1s = homePage?.headings.filter(h => h.tag === 'h1') || [];
  const h2s = homePage?.headings.filter(h => h.tag === 'h2') || [];
  const h3s = homePage?.headings.filter(h => h.tag === 'h3') || [];

  // One H1 per page
  const hasOneH1 = h1s.length === 1;
  const hasH1 = h1s.length >= 1;

  // H1 contains target keyword
  const h1Text = h1s.map(h => h.text).join(' ').toLowerCase();
  const hasKeyword = /(?:attorney|lawyer|law|injury|accident|firm)/i.test(h1Text);

  // Logical hierarchy
  const hasHierarchy = h2s.length >= 2 || (h2s.length >= 1 && h3s.length >= 1);

  if (hasOneH1) score += 2;
  else if (hasH1) score += 1;
  if (hasKeyword) score += 1;
  if (hasHierarchy) score += 2;

  const passed = score >= 4;
  return {
    name: 'Heading Structure', category: 'onPageSEO', passed,
    score: Math.min(score, maxPoints), maxPoints,
    detail: passed
      ? `Heading structure is well organized. ${h1s.length} H1, ${h2s.length} H2s, ${h3s.length} H3s on homepage.`
      : `Heading structure needs work. ${h1s.length} H1 tag(s) (should be exactly 1).${!hasKeyword ? ' H1 missing target keywords.' : ''}${!hasHierarchy ? ' Flat heading hierarchy — use H2/H3 for subtopics.' : ''}`,
    headline: passed ? 'Heading structure organized' : `${h1s.length} H1(s), needs hierarchy`
  };
}

function checkInternalLinkingDepth(pages: ParsedPage[]): CheckResult {
  const maxPoints = 6;
  let score = 0;

  // Average internal links per page
  const linkCounts = pages.map(p => p.internalLinks.length);
  const avgLinks = linkCounts.length > 0 ? linkCounts.reduce((a, b) => a + b, 0) / linkCounts.length : 0;

  if (avgLinks >= 5) score += 4;
  else if (avgLinks >= 2) score += 2;

  // Breadcrumb schema bonus
  const hasBreadcrumbs = pages.some(p => p.hasBreadcrumbSchema);
  if (hasBreadcrumbs) score += 2;

  const passed = score >= 5;
  return {
    name: 'Internal Linking Depth', category: 'onPageSEO', passed,
    score: Math.min(score, maxPoints), maxPoints,
    detail: passed
      ? `Strong internal linking with avg ${Math.round(avgLinks)} links per page.${hasBreadcrumbs ? ' Breadcrumb schema detected.' : ''}`
      : `Internal linking is thin — avg ${Math.round(avgLinks)} links per page.${avgLinks < 2 ? ' Pages are too isolated; Google can\'t crawl effectively.' : ''}${!hasBreadcrumbs ? ' No breadcrumb schema.' : ''}`,
    headline: passed ? `${Math.round(avgLinks)} avg internal links` : `Only ${Math.round(avgLinks)} avg internal links`
  };
}

function checkCanonicalAndIndexability(pages: ParsedPage[], robotsRes: FetchedResource, sitemapRes: FetchedResource): CheckResult {
  const maxPoints = 4;
  let score = 0;

  // Canonical tags
  const pagesWithCanonical = pages.filter(p => p.hasCanonical);
  const hasCanonicals = pagesWithCanonical.length > 0;

  // No noindex
  const noindexPages = pages.filter(p => p.hasNoindex);
  const noNoindex = noindexPages.length === 0;

  // robots.txt allows Googlebot
  let robotsOk = false;
  if (robotsRes.status === 200 && robotsRes.content) {
    const content = robotsRes.content.toLowerCase();
    // Check if Googlebot is specifically blocked
    const googlebotBlocked = /user-agent:\s*googlebot[\s\S]*?disallow:\s*\//i.test(robotsRes.content);
    robotsOk = !googlebotBlocked;
  } else {
    robotsOk = true; // No robots.txt = allow all
  }

  // Sitemap has practice area URLs
  const hasSitemap = sitemapRes.status === 200 && sitemapRes.content?.includes('<url>');

  if (hasCanonicals) score += 1;
  if (noNoindex) score += 1;
  if (robotsOk) score += 1;
  if (hasSitemap) score += 1;

  const passed = score >= 3;
  return {
    name: 'Canonical & Indexability', category: 'onPageSEO', passed,
    score: Math.min(score, maxPoints), maxPoints,
    detail: passed
      ? `Indexability looks good.${hasCanonicals ? ' Canonical tags present.' : ''}${hasSitemap ? ' XML sitemap found.' : ''}${robotsOk ? ' Googlebot allowed.' : ''}`
      : `Indexability issues found.${!hasCanonicals ? ' No canonical tags.' : ''}${!noNoindex ? ` ${noindexPages.length} page(s) set to noindex.` : ''}${!robotsOk ? ' Googlebot may be blocked.' : ''}${!hasSitemap ? ' No XML sitemap.' : ''}`,
    headline: passed ? 'Indexability clean' : `Indexability issues${!hasSitemap ? ': no sitemap' : ''}`
  };
}

function checkImageAltText(pages: ParsedPage[]): CheckResult {
  const maxPoints = 4;
  const totalImgs = pages.reduce((sum, p) => sum + p.imgCount, 0);
  const totalAlts = pages.reduce((sum, p) => sum + p.imgWithAlt, 0);
  const pct = totalImgs > 0 ? (totalAlts / totalImgs) * 100 : 100;

  let score = 0;
  if (pct > 80) score = 4;
  else if (pct > 50) score = 2;
  else if (pct > 20) score = 1;

  const passed = score >= 3;
  return {
    name: 'Image Alt Text Coverage', category: 'onPageSEO', passed,
    score: Math.min(score, maxPoints), maxPoints,
    detail: passed
      ? `${Math.round(pct)}% of images have alt text (${totalAlts}/${totalImgs}). Good accessibility and SEO.`
      : `Only ${Math.round(pct)}% of images have alt text (${totalAlts}/${totalImgs}). Missing alt text hurts SEO and accessibility.`,
    headline: passed ? `${Math.round(pct)}% image alt coverage` : `Only ${Math.round(pct)}% images have alt text`
  };
}

// ═══════════════════════════════════════════════════════════
// CATEGORY B: CONTENT DEPTH & AUTHORITY (30 pts)
// ═══════════════════════════════════════════════════════════

function checkPracticeAreaCoverage(practiceAreas: PracticeAreaPage[]): CheckResult {
  const maxPoints = 8;
  const count = practiceAreas.length;
  const areas = practiceAreas.map(pa => pa.area);

  let score = 0;
  if (count >= 10) score = 8;
  else if (count >= 6) score = 6;
  else if (count >= 3) score = 4;
  else if (count >= 1) score = 2;

  const passed = score >= 6;
  return {
    name: 'Practice Area Coverage', category: 'contentDepth', passed,
    score: Math.min(score, maxPoints), maxPoints,
    detail: passed
      ? `${count} practice area pages found: ${areas.slice(0, 6).join(', ')}${count > 6 ? `, +${count - 6} more` : ''}. Strong topic coverage for search.`
      : `Only ${count} practice area page(s) detected${count > 0 ? ': ' + areas.join(', ') : ''}. Top-ranking firms typically have 8-15+ dedicated practice area pages.`,
    headline: passed ? `${count} practice area pages` : `Only ${count} practice area page(s)`
  };
}

function checkPracticeAreaContentDepth(practiceAreas: PracticeAreaPage[]): CheckResult {
  const maxPoints = 7;

  if (practiceAreas.length === 0) {
    return {
      name: 'Practice Area Content Depth', category: 'contentDepth', passed: false,
      score: 0, maxPoints,
      detail: 'No practice area pages found to evaluate content depth. Create dedicated pages with 1000+ words for each practice area.',
      headline: 'No PA pages to measure'
    };
  }

  const wordCounts = practiceAreas.map(pa => pa.page.wordCount);
  const avgWords = wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length;

  let score = 0;
  if (avgWords >= 1000) score = 7;
  else if (avgWords >= 600) score = 5;
  else if (avgWords >= 300) score = 3;

  const passed = score >= 5;
  return {
    name: 'Practice Area Content Depth', category: 'contentDepth', passed,
    score: Math.min(score, maxPoints), maxPoints,
    detail: passed
      ? `Practice area pages average ${Math.round(avgWords)} words. Comprehensive content helps you rank for competitive terms.`
      : `Practice area pages average only ${Math.round(avgWords)} words. Google rewards thorough content — aim for 1000+ words per practice area page.`,
    headline: passed ? `${Math.round(avgWords)} avg words on PA pages` : `Only ${Math.round(avgWords)} avg words on PA pages`
  };
}

function checkFAQContent(pages: ParsedPage[]): CheckResult {
  const maxPoints = 5;
  const allJsonLd = pages.flatMap(p => p.jsonLd);

  // FAQPage schema
  const hasFAQSchema = allJsonLd.some(item => {
    const type = item?.['@type'];
    return type === 'FAQPage' || (Array.isArray(type) && type.includes('FAQPage'));
  });

  // FAQ sections in content
  const allText = pages.map(p => p.bodyText + ' ' + p.html).join(' ').toLowerCase();
  const hasFAQSection = /(?:frequently\s*asked|faq|common\s*questions|q\s*&\s*a|questions?\s*(?:and|&)\s*answers?)/i.test(allText);

  // FAQ in headings
  const hasFAQHeading = pages.some(p =>
    p.headings.some(h => /faq|frequently|common\s*question/i.test(h.text))
  );

  let score = 0;
  if (hasFAQSchema) score = 5;
  else if (hasFAQSection || hasFAQHeading) score = 3;

  const passed = score >= 5;
  return {
    name: 'FAQ Content', category: 'contentDepth', passed,
    score: Math.min(score, maxPoints), maxPoints,
    detail: passed
      ? 'FAQ content with structured data (FAQPage schema) found. This can earn rich snippets in Google results.'
      : score > 0
        ? 'FAQ content found but no FAQPage schema markup. Adding schema can earn rich snippets in search results.'
        : 'No FAQ content detected. FAQ pages target long-tail "how" and "what" queries that comparison shoppers search.',
    headline: passed ? 'FAQ with schema markup' : score > 0 ? 'FAQ found, no schema' : 'No FAQ content'
  };
}

function checkBlogFreshness(pages: ParsedPage[]): CheckResult {
  const maxPoints = 5;

  // Look for blog/news pages and date signals
  const allHtml = pages.map(p => p.html).join(' ');
  const allText = pages.map(p => p.bodyText).join(' ');

  // Check for blog URLs
  const hasBlogPage = pages.some(p => /\/([a-z-]*(?:blog|news|article|insight|post|resource)s?)/i.test(p.url));

  // Check JSON-LD for datePublished
  const allJsonLd = pages.flatMap(p => p.jsonLd);
  const dates: Date[] = [];
  for (const item of allJsonLd) {
    if (item?.datePublished) {
      try { dates.push(new Date(item.datePublished)); } catch { /* skip */ }
    }
    if (item?.dateModified) {
      try { dates.push(new Date(item.dateModified)); } catch { /* skip */ }
    }
  }

  // Look for date patterns in content
  const datePatterns = allText.match(/(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+202[3-6]/gi) || [];
  for (const d of datePatterns) {
    try { dates.push(new Date(d)); } catch { /* skip */ }
  }

  const now = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
  const oneYearMs = 365 * 24 * 60 * 60 * 1000;

  const validDates = dates.filter(d => !isNaN(d.getTime()) && d.getTime() < now);
  const mostRecent = validDates.length > 0 ? Math.max(...validDates.map(d => d.getTime())) : 0;
  const daysSince = mostRecent > 0 ? Math.round((now - mostRecent) / (24 * 60 * 60 * 1000)) : Infinity;

  let score = 0;
  if (daysSince <= 30) score = 5;
  else if (daysSince <= 90) score = 3;
  else if (daysSince <= 365) score = 1;

  // Bonus if blog page exists even without dates
  if (score === 0 && hasBlogPage) score = 1;

  const passed = score >= 4;
  return {
    name: 'Blog / Content Freshness', category: 'contentDepth', passed,
    score: Math.min(score, maxPoints), maxPoints,
    detail: passed
      ? `Fresh content detected — most recent content is ${daysSince} days old. Active publishing signals authority to Google.`
      : daysSince < Infinity
        ? `Most recent content is ${daysSince} days old. Google rewards sites that publish regularly — aim for at least monthly.`
        : `No recent content dates found.${hasBlogPage ? ' Blog page exists but appears stale.' : ' No blog or news section detected.'} Fresh content is a key ranking signal.`,
    headline: passed ? `Content updated ${daysSince}d ago` : daysSince < Infinity ? `Content is ${daysSince}d stale` : 'No fresh content'
  };
}

function checkWhyChooseUs(pages: ParsedPage[]): CheckResult {
  const maxPoints = 5;
  const allText = pages.map(p => p.bodyText).join(' ').toLowerCase();
  const allHeadings = pages.flatMap(p => p.headings.map(h => h.text.toLowerCase()));

  // Dedicated page or section
  const whyPatterns = /why\s*choose|why\s*hire|why\s*us|what\s*sets\s*us\s*apart|our\s*difference|what\s*makes\s*us\s*different/i;
  const hasWhyPage = pages.some(p => whyPatterns.test(p.url + ' ' + p.title));
  const hasWhySection = allHeadings.some(h => whyPatterns.test(h));
  const hasWhyMention = whyPatterns.test(allText);

  let score = 0;
  if (hasWhyPage || hasWhySection) score = 5;
  else if (hasWhyMention) score = 2;

  const passed = score >= 4;
  return {
    name: '"Why Choose Us" Content', category: 'contentDepth', passed,
    score: Math.min(score, maxPoints), maxPoints,
    detail: passed
      ? '"Why Choose Us" content found. This directly addresses comparison shoppers evaluating multiple firms.'
      : score > 0
        ? '"Why choose us" mentioned but not prominently featured. Create a dedicated section or page to differentiate your firm.'
        : 'No "Why Choose Us" content found. Comparison shoppers need clear differentiation — tell them why you\'re the right choice.',
    headline: passed ? '"Why Choose Us" content present' : 'No differentiation content'
  };
}

// ═══════════════════════════════════════════════════════════
// CATEGORY C: LOCAL SEO & SEARCH PRESENCE (20 pts)
// ═══════════════════════════════════════════════════════════

function checkLocalBusinessSchema(pages: ParsedPage[]): CheckResult {
  const maxPoints = 5;
  const allJsonLd = pages.flatMap(p => p.jsonLd);
  let score = 0;

  const legalTypes = ['LegalService', 'Attorney', 'LawFirm', 'LocalBusiness', 'ProfessionalService'];
  const localSchema = allJsonLd.find(item => {
    const type = item?.['@type'];
    return legalTypes.includes(type) || (Array.isArray(type) && type.some((t: string) => legalTypes.includes(t)));
  });

  if (localSchema) {
    score += 2;
    // Check for required fields
    if (localSchema.address || localSchema.location) score += 1;
    if (localSchema.telephone || localSchema.phone) score += 1;
    if (localSchema.areaServed || localSchema.serviceArea) score += 1;
  }

  const passed = score >= 4;
  return {
    name: 'Local Business Schema', category: 'localSEO', passed,
    score: Math.min(score, maxPoints), maxPoints,
    detail: passed
      ? 'Local business schema (JSON-LD) found with address, phone, and service area. Google can feature your firm in local results.'
      : score > 0
        ? `Local business schema found but missing fields.${!localSchema?.address ? ' No address.' : ''}${!localSchema?.telephone ? ' No phone.' : ''}${!localSchema?.areaServed ? ' No service area.' : ''}`
        : 'No local business schema (JSON-LD) found. This structured data helps Google show your firm in local search and map results.',
    headline: passed ? 'Local schema complete' : score > 0 ? 'Local schema incomplete' : 'No local schema'
  };
}

function checkNAPConsistency(pages: ParsedPage[]): CheckResult {
  const maxPoints = 4;

  // Collect phone numbers and addresses across pages
  const phoneSets = pages.map(p => p.phoneNumbers).filter(p => p.length > 0);
  const addressSets = pages.map(p => p.contactAddress).filter(Boolean);

  // Count pages with NAP info
  const pagesWithPhone = phoneSets.length;
  const pagesWithAddress = addressSets.length;

  // Check consistency
  const allPhones = phoneSets.flat();
  const primaryPhone = allPhones.length > 0 ? allPhones[0].replace(/\D/g, '') : null;
  const phoneConsistent = primaryPhone ? allPhones.every(p => p.replace(/\D/g, '') === primaryPhone) : true;

  let score = 0;
  if (pagesWithPhone >= 3 && phoneConsistent) score += 2;
  else if (pagesWithPhone >= 1) score += 1;
  if (pagesWithAddress >= 2) score += 2;
  else if (pagesWithAddress >= 1) score += 1;

  const passed = score >= 3;
  return {
    name: 'NAP Consistency', category: 'localSEO', passed,
    score: Math.min(score, maxPoints), maxPoints,
    detail: passed
      ? `Name, Address, Phone consistent across ${pagesWithPhone} pages. Consistent NAP is a core local SEO signal.`
      : `NAP (Name/Address/Phone) found on ${pagesWithPhone} page(s) with phone, ${pagesWithAddress} with address.${!phoneConsistent ? ' Inconsistent phone numbers detected.' : ''} Google uses NAP consistency for local rankings.`,
    headline: passed ? 'NAP consistent' : `NAP on ${pagesWithPhone} page(s)`
  };
}

function checkGeoTargetedContent(pages: ParsedPage[]): CheckResult {
  const maxPoints = 5;

  // Look for location mentions in titles, H1s, and body
  const cityStatePattern = /\b(?:[A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s*,\s*(?:[A-Z]{2}|Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New\s+Hampshire|New\s+Jersey|New\s+Mexico|New\s+York|North\s+Carolina|North\s+Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode\s+Island|South\s+Carolina|South\s+Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West\s+Virginia|Wisconsin|Wyoming)\b/g;

  // Check titles and H1s for location
  const titlesAndH1s = pages.flatMap(p => [
    p.title,
    ...p.headings.filter(h => h.tag === 'h1').map(h => h.text)
  ]).join(' ');
  const locationInTitles = cityStatePattern.test(titlesAndH1s);
  cityStatePattern.lastIndex = 0;

  // Check body text
  const allText = pages.map(p => p.bodyText).join(' ');
  const locationInBody = cityStatePattern.test(allText);
  cityStatePattern.lastIndex = 0;

  // Also check for common geo patterns
  const geoTerms = /\b(?:serving|located\s+in|offices?\s+in|near|area|county|region|metropolitan|metro)\b/i;
  const hasGeoTerms = geoTerms.test(allText);

  let score = 0;
  if (locationInTitles) score += 3;
  if (locationInBody || hasGeoTerms) score += 2;

  const passed = score >= 4;
  return {
    name: 'Geo-Targeted Content', category: 'localSEO', passed,
    score: Math.min(score, maxPoints), maxPoints,
    detail: passed
      ? 'Location targeting found in titles/H1s and body content. Search engines can match you to local queries.'
      : score > 0
        ? `Some location signals found but ${!locationInTitles ? 'not in title tags or H1s — where it matters most' : 'limited body content mentioning your service area'}.`
        : 'No geo-targeted content found. Without city/state mentions in titles and content, you won\'t rank for "lawyer near me" searches.',
    headline: passed ? 'Location-targeted content' : score > 0 ? 'Weak geo targeting' : 'No geo targeting'
  };
}

function checkGoogleBusinessSignals(pages: ParsedPage[]): CheckResult {
  const maxPoints = 3;
  const allHtml = pages.map(p => p.html).join(' ');
  const allText = pages.map(p => p.bodyText).join(' ');

  // Maps embed
  const hasMapsEmbed = /google\.com\/maps|maps\.googleapis\.com|goo\.gl\/maps|g\.page/i.test(allHtml);

  // Review mentions (Google reviews, star ratings)
  const hasReviewMentions = /google\s*review|(\d+)\s*reviews?\s*on\s*google|\d+\.?\d*\s*star/i.test(allText);

  let score = 0;
  if (hasMapsEmbed) score += 2;
  if (hasReviewMentions) score += 1;

  // Both = full points
  if (hasMapsEmbed && hasReviewMentions) score = 3;

  const passed = score >= 2;
  return {
    name: 'Google Business Profile Signals', category: 'localSEO', passed,
    score: Math.min(score, maxPoints), maxPoints,
    detail: passed
      ? `Google Business signals detected.${hasMapsEmbed ? ' Maps embed found.' : ''}${hasReviewMentions ? ' Google review mentions found.' : ''}`
      : `Weak Google Business signals.${!hasMapsEmbed ? ' No Google Maps embed.' : ''}${!hasReviewMentions ? ' No Google review mentions.' : ''} Embedding your GBP map and reviews reinforces local authority.`,
    headline: passed ? 'GBP signals present' : 'Weak GBP signals'
  };
}

function checkServiceAreaPages(pages: ParsedPage[]): CheckResult {
  const maxPoints = 3;

  // Look for city + practice area combination pages
  const cityPracticePages = pages.filter(p => {
    const path = p.url.toLowerCase();
    const title = p.title.toLowerCase();
    const combined = path + ' ' + title;

    // City name + practice area keyword in URL or title
    const hasCity = /(?:houston|dallas|austin|chicago|los-angeles|new-york|miami|atlanta|phoenix|denver|seattle|san-antonio|tampa|orlando|charlotte|columbus|san-diego|jacksonville|indianapolis|san-francisco|fort-worth|nashville|memphis|louisville|baltimore|milwaukee|albuquerque|tucson|fresno|sacramento|mesa|kansas-city|omaha|raleigh|virginia-beach|minneapolis|tulsa|arlington|new-orleans|wichita|cleveland|bakersfield|aurora|anaheim|honolulu|riverside|santa-ana|corpus-christi|lexington|stockton|henderson|pittsburgh|lincoln|greensboro|plano|orlando|irvine|newark|durham|chula-vista|toledo|fort-wayne|st-pete|chandler|laredo|madison|lubbock|scottsdale|reno|glendale|norfolk|gilbert|garland|irving|hialeah|chesapeake|baton-rouge|birmingham|rochester|richmond|spokane|des-moines|montgomery|modesto|fayetteville|tacoma|shreveport|fontana|moreno-valley|akron|yonkers|worcester|aurora|little-rock|huntington|glendale|amarillo|newport-news|knoxville|grand-rapids|columbia|chatanooga|dayton|savannah)\b/i.test(combined);

    const hasPractice = PRACTICE_AREA_KEYWORDS.some(pa =>
      pa.keywords.some(kw => combined.includes(kw))
    );

    return hasCity && hasPractice;
  });

  // Also check for location-specific pages
  const locationPages = pages.filter(p => {
    const path = p.url.toLowerCase();
    return /\/locations?\/|\/offices?\/|\/serving\/|\/areas?-served/i.test(path);
  });

  const totalServicePages = new Set([...cityPracticePages, ...locationPages]).size;

  let score = 0;
  if (totalServicePages >= 3) score = 3;
  else if (totalServicePages >= 1) score = 1;

  const passed = score >= 2;
  return {
    name: 'Service Area Pages', category: 'localSEO', passed,
    score: Math.min(score, maxPoints), maxPoints,
    detail: passed
      ? `${totalServicePages} service area / location pages found. City-specific pages help you rank in multiple local markets.`
      : totalServicePages > 0
        ? `Only ${totalServicePages} service area page(s). Create city + practice area pages (e.g., "Houston Car Accident Lawyer") for each market you serve.`
        : 'No dedicated service area pages found. Firms ranking for "[City] + [Practice Area]" queries have dedicated pages for each combination.',
    headline: passed ? `${totalServicePages} service area pages` : `${totalServicePages} service area page(s)`
  };
}

// ═══════════════════════════════════════════════════════════
// CATEGORY D: CONVERSION AT CONSIDERATION (20 pts)
// ═══════════════════════════════════════════════════════════

function checkCTAsOnPracticePages(practiceAreas: PracticeAreaPage[], pages: ParsedPage[]): CheckResult {
  const maxPoints = 5;

  if (practiceAreas.length === 0) {
    // Fall back to checking all pages for CTAs
    const pagesWithCTA = pages.filter(p =>
      p.forms.length > 0 || p.hasTelLink ||
      /(?:free consultation|contact|call now|get help|schedule|book)/i.test(p.html)
    );
    const pct = pages.length > 0 ? (pagesWithCTA.length / pages.length) * 100 : 0;
    let score = 0;
    if (pct > 75) score = 4;
    else if (pct > 50) score = 2;
    else if (pct > 0) score = 1;
    return {
      name: 'CTAs on Key Pages', category: 'conversionConsideration', passed: score >= 4,
      score, maxPoints,
      detail: `${Math.round(pct)}% of pages have CTAs (${pagesWithCTA.length}/${pages.length}). No practice area pages found to evaluate specifically.`,
      headline: `${Math.round(pct)}% pages have CTAs`
    };
  }

  const paPages = practiceAreas.map(pa => pa.page);
  const paPagesWithCTA = paPages.filter(p =>
    p.forms.length > 0 || p.hasTelLink ||
    /(?:free consultation|contact us|call now|get help|schedule|book a|speak with)/i.test(p.html)
  );
  const pct = (paPagesWithCTA.length / paPages.length) * 100;

  let score = 0;
  if (pct > 75) score = 5;
  else if (pct > 50) score = 3;
  else if (pct > 0) score = 1;

  const passed = score >= 4;
  return {
    name: 'CTAs on Practice Pages', category: 'conversionConsideration', passed,
    score: Math.min(score, maxPoints), maxPoints,
    detail: passed
      ? `${Math.round(pct)}% of practice area pages have CTAs (${paPagesWithCTA.length}/${paPages.length}). Every PA page converts.`
      : `Only ${Math.round(pct)}% of practice area pages have CTAs (${paPagesWithCTA.length}/${paPages.length}). Every practice area page should have a form, phone link, or consultation CTA.`,
    headline: passed ? `${Math.round(pct)}% PA pages have CTAs` : `Only ${Math.round(pct)}% PA pages have CTAs`
  };
}

function checkTrustSignals(pages: ParsedPage[]): CheckResult {
  const maxPoints = 5;
  const allText = pages.map(p => p.bodyText + ' ' + p.html).join(' ');

  const signals: string[] = [];
  if (/(?:award|nationally\s*recognized|top\s*\d+|best\s*(?:law|lawyer|attorney))/i.test(allText)) signals.push('Awards');
  if (/(?:\d+\s*\+?\s*years?\s*(?:of\s*)?experience|\d+\s*years?\s*(?:serving|practicing))/i.test(allText)) signals.push('Experience Years');
  if (/(?:\$[\d,.]+\s*(?:million|billion|M|B)|verdict|settlement|recover)/i.test(allText)) signals.push('Verdicts/Settlements');
  if (/(?:board\s*certified|super\s*lawyer|avvo|martindale|best\s*lawyers|million\s*dollar\s*advocate|j\.d\.|esq)/i.test(allText)) signals.push('Credentials');
  if (/(?:member|fellow|association|bar\s*association|trial\s*lawyer)/i.test(allText)) signals.push('Professional Memberships');

  let score = 0;
  if (signals.length >= 3) score = 5;
  else if (signals.length === 2) score = 3;
  else if (signals.length === 1) score = 2;

  const passed = score >= 4;
  return {
    name: 'Trust Signals on Key Pages', category: 'conversionConsideration', passed,
    score: Math.min(score, maxPoints), maxPoints,
    detail: passed
      ? `${signals.length} trust signal types found: ${signals.join(', ')}. Strong credibility for comparison shoppers.`
      : signals.length > 0
        ? `Only ${signals.length} trust signal type(s): ${signals.join(', ')}. Add more — awards, credentials, years of experience, verdicts — to outshine competitors.`
        : 'No trust signals found (awards, credentials, verdict amounts, experience years). Comparison shoppers need reasons to choose your firm.',
    headline: passed ? `${signals.length} trust signal types` : `Only ${signals.length} trust signal(s)`
  };
}

function checkPageSpeedCWV(pageSpeedScore: number | null, homepageRes: FetchedResource): CheckResult {
  const maxPoints = 4;

  if (pageSpeedScore !== null) {
    let score = 0;
    if (pageSpeedScore >= 80) score = 4;
    else if (pageSpeedScore >= 50) score = 2;
    else score = 1;

    const passed = score >= 3;
    return {
      name: 'Page Speed (Core Web Vitals)', category: 'conversionConsideration', passed,
      score: Math.min(score, maxPoints), maxPoints,
      detail: passed
        ? `PageSpeed score: ${pageSpeedScore}/100 (mobile). Fast sites rank higher and convert more visitors.`
        : `PageSpeed score: ${pageSpeedScore}/100 (mobile).${pageSpeedScore < 50 ? ' Poor performance — 53% of mobile users leave if a page takes over 3 seconds.' : ' Room to improve — aim for 80+.'}`,
      headline: passed ? `PageSpeed: ${pageSpeedScore}/100` : `PageSpeed: ${pageSpeedScore}/100`
    };
  }

  // Fallback to response time heuristic
  const loadTime = homepageRes.loadTimeMs;
  let score = 0;
  if (loadTime < 2000) score = 3;
  else if (loadTime < 4000) score = 2;
  else score = 0;

  const passed = score >= 3;
  return {
    name: 'Page Speed (Core Web Vitals)', category: 'conversionConsideration', passed,
    score: Math.min(score, maxPoints), maxPoints,
    detail: passed
      ? `Page loaded in ${(loadTime / 1000).toFixed(1)}s (server response). Fast sites rank higher and convert more.`
      : `Page loaded in ${(loadTime / 1000).toFixed(1)}s.${loadTime >= 4000 ? ' Slow load times drive away comparison shoppers.' : ' Could be faster — aim for under 2 seconds.'}`,
    headline: `${(loadTime / 1000).toFixed(1)}s load time`
  };
}

function checkMobileOptimization(pages: ParsedPage[]): CheckResult {
  const maxPoints = 3;
  const homepage = pages[0];

  let score = 0;
  // Viewport meta
  if (homepage?.hasViewport) score += 2;

  // Check for responsive signals across pages
  const allHtml = pages.map(p => p.html).join(' ');
  const hasResponsive = /(?:@media|responsive|mobile|bootstrap|tailwind)/i.test(allHtml);
  if (hasResponsive) score += 1;

  const passed = score >= 2;
  return {
    name: 'Mobile Optimization', category: 'conversionConsideration', passed,
    score: Math.min(score, maxPoints), maxPoints,
    detail: passed
      ? `Mobile optimization detected.${homepage?.hasViewport ? ' Viewport meta tag present.' : ''}${hasResponsive ? ' Responsive CSS detected.' : ''} 60%+ of legal searches happen on mobile.`
      : `Mobile optimization issues.${!homepage?.hasViewport ? ' Missing viewport meta tag.' : ''}${!hasResponsive ? ' No responsive CSS signals.' : ''} Your site may look broken on phones.`,
    headline: passed ? 'Mobile optimized' : 'Mobile issues detected'
  };
}

function checkReviewRatingSchema(pages: ParsedPage[]): CheckResult {
  const maxPoints = 3;
  const allJsonLd = pages.flatMap(p => p.jsonLd);

  // Search recursively for AggregateRating or Review
  function findRatingSchema(obj: any): boolean {
    if (!obj || typeof obj !== 'object') return false;
    const type = obj['@type'];
    if (type === 'AggregateRating' || type === 'Review') return true;
    if (obj.aggregateRating || obj.AggregateRating) return true;
    for (const key of Object.keys(obj)) {
      if (findRatingSchema(obj[key])) return true;
    }
    return false;
  }

  const hasRatingSchema = allJsonLd.some(item => findRatingSchema(item));

  let score = hasRatingSchema ? 3 : 0;
  const passed = score >= 3;
  return {
    name: 'Review/Rating Schema', category: 'conversionConsideration', passed,
    score: Math.min(score, maxPoints), maxPoints,
    detail: passed
      ? 'AggregateRating/Review schema found. This can show star ratings in Google search results — a major click-through advantage.'
      : 'No review/rating schema found. Adding AggregateRating JSON-LD can show star ratings in search results, boosting click-through rates by up to 35%.',
    headline: passed ? 'Star ratings in SERPs' : 'No rating schema'
  };
}

// ═══════════════════════════════════════════════════════════
// MAIN SCAN ORCHESTRATOR
// ═══════════════════════════════════════════════════════════
export async function scanWebsite(inputUrl: string): Promise<ScanResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  let url = inputUrl;
  if (!url.startsWith('http')) url = 'https://' + url;
  const origin = new URL(url).origin;
  const domain = new URL(url).hostname.replace(/^www\./, '');
  const isSSL = url.startsWith('https');

  // Parallel fetch: standard resources + Cloudflare crawl + PageSpeed API
  const [homepageRes, robotsRes, sitemapRes, crawlOutcome, pageSpeedResult] = await Promise.all([
    fetchResource(url),
    fetchResource(origin + '/robots.txt', 5000),
    fetchResource(origin + '/sitemap.xml', 5000),
    crawlSite({ url, limit: 75, maxDepth: 3, formats: ['html'], maxAge: 3600 }).catch(() => null),
    fetchPageSpeedScore(url).catch(() => ({ score: null, error: 'Failed' })),
  ]);

  const crawlResult: CrawlResult | null = crawlOutcome ?? null;
  let usedCrawl = false;

  // ── STEP 1: Build page collection, prioritizing crawl data ──
  // Many law firm sites block server-side fetch (Cloudflare WAF), so
  // the Cloudflare Browser Rendering crawl is often the ONLY data source.
  const allPages: ParsedPage[] = [];
  const seenUrls = new Set<string>();

  // Process ALL crawl pages first (they use real browser rendering)
  if (crawlResult) {
    for (const crawlPage of crawlResult.pages) {
      if (crawlPage.status !== 'completed' || !crawlPage.html) continue;
      try {
        const pageUrl = new URL(crawlPage.url);
        if (pageUrl.hostname.replace(/^www\./, '') !== domain) continue;
        const normalized = pageUrl.origin + pageUrl.pathname.replace(/\/$/, '');
        if (seenUrls.has(normalized)) continue;
        seenUrls.add(normalized);
        seenUrls.add(crawlPage.url);
        const parsed = parsePage(crawlPage.html, crawlPage.url, isSSL, domain);
        allPages.push(parsed);
        usedCrawl = true;
      } catch {}
    }
  }

  // Get homepage — prefer crawl version, fall back to direct fetch
  let homepage = allPages.find(p => {
    try { const path = new URL(p.url).pathname; return path === '/' || path === ''; } catch { return false; }
  }) ?? null;

  if (!homepage && homepageRes.content) {
    homepage = parsePage(homepageRes.content, url, isSSL, domain);
    if (!seenUrls.has(url)) {
      allPages.unshift(homepage);
      seenUrls.add(url);
    }
  }

  if (!homepage) errors.push('Could not fetch homepage');

  // ── STEP 2: If crawl had few pages, supplement with direct fetches ──
  if (homepage && allPages.length < 10) {
    const subUrls = discoverSubpages(homepage, url, domain)
      .filter(u => !seenUrls.has(u) && !seenUrls.has(u.replace(/\/$/, '')))
      .slice(0, 10);
    if (subUrls.length > 0) {
      const subResults = await Promise.allSettled(
        subUrls.map(async (subUrl) => {
          const res = await fetchResource(subUrl, 6000);
          if (res.content && res.status === 200) return parsePage(res.content, subUrl, isSSL, domain);
          return null;
        })
      );
      for (const r of subResults) {
        if (r.status === 'fulfilled' && r.value) {
          const normalized = new URL(r.value.url).origin + new URL(r.value.url).pathname.replace(/\/$/, '');
          if (!seenUrls.has(normalized)) {
            allPages.push(r.value);
            seenUrls.add(normalized);
            seenUrls.add(r.value.url);
          }
        }
      }
    }
  }

  // Identify practice area pages
  const practiceAreas = identifyPracticeAreaPages(allPages);

  // Run checks
  const checks: CheckResult[] = [];

  if (homepage) {
    // A: On-Page SEO Quality (30 pts)
    checks.push(checkTitleTagOptimization(allPages));
    checks.push(checkMetaDescriptionQuality(allPages));
    checks.push(checkHeadingStructure(allPages));
    checks.push(checkInternalLinkingDepth(allPages));
    checks.push(checkCanonicalAndIndexability(allPages, robotsRes, sitemapRes));
    checks.push(checkImageAltText(allPages));

    // B: Content Depth & Authority (30 pts)
    checks.push(checkPracticeAreaCoverage(practiceAreas));
    checks.push(checkPracticeAreaContentDepth(practiceAreas));
    checks.push(checkFAQContent(allPages));
    checks.push(checkBlogFreshness(allPages));
    checks.push(checkWhyChooseUs(allPages));

    // C: Local SEO & Search Presence (20 pts)
    checks.push(checkLocalBusinessSchema(allPages));
    checks.push(checkNAPConsistency(allPages));
    checks.push(checkGeoTargetedContent(allPages));
    checks.push(checkGoogleBusinessSignals(allPages));
    checks.push(checkServiceAreaPages(allPages));

    // D: Conversion at Consideration (20 pts)
    checks.push(checkCTAsOnPracticePages(practiceAreas, allPages));
    checks.push(checkTrustSignals(allPages));
    checks.push(checkPageSpeedCWV(pageSpeedResult.score, homepageRes));
    checks.push(checkMobileOptimization(allPages));
    checks.push(checkReviewRatingSchema(allPages));
  }

  // Aggregate
  const categoryMap: Record<string, CheckResult[]> = {
    onPageSEO: [], contentDepth: [], localSEO: [], conversionConsideration: [],
  };
  for (const check of checks) {
    categoryMap[check.category]?.push(check);
  }

  function buildCategory(key: string, name: string): CategoryScore {
    const catChecks = categoryMap[key] || [];
    const score = catChecks.reduce((sum, c) => sum + c.score, 0);
    const maxPoints = catChecks.reduce((sum, c) => sum + c.maxPoints, 0);
    const percentage = maxPoints > 0 ? Math.round((score / maxPoints) * 100) : 0;
    return { name, score, maxPoints, percentage, grade: categoryGrade(percentage), checks: catChecks };
  }

  const categories = {
    onPageSEO: buildCategory('onPageSEO', 'On-Page SEO Quality'),
    contentDepth: buildCategory('contentDepth', 'Content Depth & Authority'),
    localSEO: buildCategory('localSEO', 'Local SEO & Search Presence'),
    conversionConsideration: buildCategory('conversionConsideration', 'Conversion at Consideration'),
  };

  const totalScore = checks.reduce((sum, c) => sum + c.score, 0);
  const totalMax = checks.reduce((sum, c) => sum + c.maxPoints, 0);
  const overallScore = totalMax > 0 ? Math.round((totalScore / totalMax) * 100) : 0;
  const { grade, label: gradeLabel } = gradeFromScore(overallScore);

  // Build headline findings
  const headlines: string[] = [];
  const sortedByImpact = [...checks].sort((a, b) => b.maxPoints - a.maxPoints);
  const topPassing = sortedByImpact.find(c => c.passed);
  const topFailing = sortedByImpact.find(c => !c.passed);
  if (topPassing) headlines.push(topPassing.headline);
  if (topFailing) headlines.push(topFailing.headline);

  const firmName = homepage ? extractFirmName(homepage) : domain;

  return {
    url, domain, firmName, overallScore, grade, gradeLabel,
    categories, totalChecks: checks.length, passedChecks: checks.filter(c => c.passed).length,
    scanDurationMs: Date.now() - startTime, headlineFindings: headlines, errors,
    crawlEnhanced: usedCrawl,
    crawlPagesUsed: allPages.length,
    practiceAreasFound: practiceAreas.map(pa => pa.area),
  };
}
