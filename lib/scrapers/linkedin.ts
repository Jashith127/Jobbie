import { ScrapedJob } from '../types';

/**
 * ⚠️ WARNING: LinkedIn Scraping is Unreliable
 * 
 * LinkedIn has strong anti-scraping measures:
 * - Requires login and session management
 * - Uses dynamic JavaScript rendering
 * - Frequently updates HTML structure
 * - May block IPs or trigger CAPTCHA
 * - Terms of Service violations
 *
 * This scraper is DISABLED in serverless environments.
 * Use LinkedIn's official API (requires approval) or RSS feeds instead.
 */
export async function scrapeLinkedIn(): Promise<ScrapedJob[]> {
  console.warn(
    '⚠️  LinkedIn scraping is disabled in serverless. It requires authentication and dynamic rendering which are not available on Vercel.'
  );
  console.warn(
    'Alternative: Use LinkedIn API (https://www.linkedin.com/developers/apps) or check https://www.linkedin.com/feed/news/'
  );

  // Always return empty for now - too unreliable in serverless
  return [];
}
