import axios from 'axios';
import * as cheerio from 'cheerio';
import { ScrapedJob } from '@/lib/types';

/**
 * Fetches jobs from Google Jobs (Google's job search engine)
 * Uses lightweight HTML parsing via cheerio (no Playwright needed)
 * 
 * Endpoint: https://www.google.com/search?tbm=lcm (Local Commerce - Jobs)
 * 
 * Note: Direct Google scraping may be rate-limited.
 * For production, consider:
 * - Google Custom Search API (100 free/day)
 * - SerpAPI (paid, reliable Google scraping)
 * - Algolia Job Search API
 */
export async function fetchGoogleSearchJobs(): Promise<ScrapedJob[]> {
  const jobs: ScrapedJob[] = [];

  try {
    const keywords = process.env.SEARCH_KEYWORDS || 'developer';
    const location = process.env.SEARCH_LOCATION || 'United States';

    // Google Jobs search URL
    const searchQuery = `${keywords} jobs in ${location}`;
    const googleJobsUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}&tbm=lcm`;

    console.log(`🔎 Fetching from Google Jobs: "${searchQuery}"`);

    const response = await axios.get(googleJobsUrl, {
      timeout: 15000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    const $ = cheerio.load(response.data);

    // Google Jobs uses complex nested selectors, try multiple patterns
    $('[jsname], [data-ei], div[role="article"]').slice(0, 20).forEach((elem) => {
      try {
        const $elem = $(elem);
        
        // Extract title - look for multiple possible selectors
        let title =
          $elem.find('h2, h3, .BgJkqf, .vNEEBe').first().text().trim() ||
          $elem.find('a').first().text().trim();

        // Extract company
        let company =
          $elem.find('[data-company], .XjlGGe, .YJF0td').text().trim() ||
          'Unknown';

        // Extract location
        let location =
          $elem.find('[data-location], .lfQaYe').text().trim();

        // Extract link
        let link =
          $elem.find('a[href*="google.com/url"]').attr('href') ||
          $elem.find('a').attr('href');

        // Clean up Google URL redirects
        if (link && link.includes('/url?')) {
          const urlMatch = link.match(/url\?q=([^&]+)/);
          if (urlMatch) {
            link = decodeURIComponent(urlMatch[1]);
          }
        }

        // Validate and add job
        if (title && link && (link.startsWith('http') || link.includes('job'))) {
          jobs.push({
            title,
            company: company.replace(/^\s*-\s*/, '').trim(), // Remove leading dash
            location: location || undefined,
            link,
            source: 'google',
          });
        }
      } catch (e) {
        // Skip malformed entries
      }
    });

    console.log(`✓ Google Jobs: ${jobs.length} jobs`);
  } catch (error: any) {
    // Google may block or rate-limit scraping
    if (error.response?.status === 429) {
      console.warn('⚠️ Google Jobs: Rate limited (429). Try again later.');
    } else if (error.response?.status === 403) {
      console.warn('⚠️ Google Jobs: Forbidden (403). Google may have blocked scraping.');
      console.warn('   Consider using SerpAPI or Google Custom Search API instead.');
    } else {
      console.error('❌ Google Jobs error:', error.message);
    }
  }

  return jobs;
}

/**
 * Alternative: Google Custom Search API (more reliable, but limited free tier)
 * Requires: GOOGLE_SEARCH_API_KEY, GOOGLE_SEARCH_ENGINE_ID
 * 
 * Free tier: 100 queries/day
 * Setup: https://programmablesearchengine.google.com/
 */
export async function fetchGoogleCustomSearchJobs(_apiKey?: string): Promise<ScrapedJob[]> {
  const jobs: ScrapedJob[] = [];

  try {
    const apiKey = _apiKey || process.env.GOOGLE_SEARCH_API_KEY || '';
    const engineId = process.env.GOOGLE_SEARCH_ENGINE_ID || '';

    if (!apiKey || !engineId) {
      console.log('ℹ️ Google Custom Search: API not configured (optional fallback)');
      return [];
    }

    const keywords = process.env.SEARCH_KEYWORDS || 'developer';
    const location = process.env.SEARCH_LOCATION || 'United States';

    const response = await axios.get('https://www.googleapis.com/customsearch/v1', {
      params: {
        key: apiKey,
        cx: engineId,
        q: `${keywords} jobs in ${location}`,
        num: 10,
      },
      timeout: 15000,
    });

    const results = response.data.items || [];

    results.forEach((result: any) => {
      try {
        const jobs_item: ScrapedJob = {
          title: result.title || 'Job',
          company: result.displayLink || 'Unknown',
          link: result.link,
          source: 'google',
        };

        // Try to extract location from snippet
        if (result.snippet) {
          const locationMatch = result.snippet.match(/(?:in|at)\s+([A-Z][^,]+(?:,\s*[A-Z]{2})?)/);
          if (locationMatch) {
            jobs_item.location = locationMatch[1].trim();
          }
        }

        if (jobs_item.title && jobs_item.link) {
          jobs.push(jobs_item);
        }
      } catch (e) {
        // Skip malformed entries
      }
    });

    console.log(`✓ Google Custom Search: ${jobs.length} jobs`);
  } catch (error: any) {
    console.error('❌ Google Custom Search error:', error.message);
  }

  return jobs;
}
