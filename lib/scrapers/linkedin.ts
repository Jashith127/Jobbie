import { chromium } from 'playwright';
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
 * This scraper is provided for reference but is NOT recommended for production use.
 * Prefer using LinkedIn's official API (requires approval) or RSS feeds.
 */
export async function scrapeLinkedIn(): Promise<ScrapedJob[]> {
  console.warn(
    '⚠️  LinkedIn scraping is unreliable and may break. Consider using official APIs instead.'
  );

  // Check for required environment variables
  if (!process.env.LINKEDIN_EMAIL || !process.env.LINKEDIN_PASSWORD) {
    console.warn(
      'Skipping LinkedIn scraping: LINKEDIN_EMAIL and LINKEDIN_PASSWORD not set'
    );
    return [];
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-gpu', '--no-sandbox'],
  });

  const jobs: ScrapedJob[] = [];

  try {
    const page = await browser.newPage();

    // LinkedIn login
    console.log('Attempting LinkedIn login...');
    await page.goto('https://www.linkedin.com/login', {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    await page.fill('input[name="session_key"]', process.env.LINKEDIN_EMAIL!);
    await page.fill('input[name="session_password"]', process.env.LINKEDIN_PASSWORD!);
    await page.click('button[type="submit"]');

    // Wait for login to complete
    await page.waitForURL('https://www.linkedin.com/feed/', {
      timeout: 30000,
    }).catch(() => {
      console.warn('LinkedIn login may have failed (possible CAPTCHA or 2FA)');
      return null;
    });

    // Navigate to jobs page
    const keywords = process.env.LINKEDIN_SEARCH_KEYWORDS || 'developer';
    const searchUrl = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(
      keywords
    )}`;

    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for job listings
    await page
      .waitForSelector('[data-job-id]', { timeout: 5000 })
      .catch(() => {
        console.warn('LinkedIn job listings selector not found');
        return null;
      });

    // Extract job cards
    const jobCards = await page.$$('[data-job-id]');

    for (let i = 0; i < Math.min(jobCards.length, 10); i++) {
      try {
        const card = jobCards[i];

        // Click to load full details
        await card.click();
        await page.waitForTimeout(1000);

        const title = await page
          .$eval('h2.jobs-search__job-title a', (el) =>
            el.textContent?.trim() || ''
          )
          .catch(() => '');

        const company = await page
          .$eval('.t-14 em', (el) => el.textContent?.trim() || '')
          .catch(() => '');

        const location = await page
          .$eval('.job-details-jobs-unified-top-card__location', (el) =>
            el.textContent?.trim() || ''
          )
          .catch(() => undefined);

        const link = await page
          .$eval('h2.jobs-search__job-title a', (el: any) => el.href)
          .catch(() => '');

        if (title && company && link) {
          jobs.push({
            title,
            company,
            location,
            link,
            source: 'linkedin',
          });
        }
      } catch (error) {
        console.error(`Error extracting LinkedIn job card ${i}:`, error);
        continue;
      }
    }

    await page.close();
  } catch (error) {
    console.error('Error scraping LinkedIn:', error);
    console.warn(
      'LinkedIn scraping failed. This is common due to anti-scraping measures.'
    );
  } finally {
    await browser.close();
  }

  console.log(`LinkedIn scraper returned ${jobs.length} jobs (may be unreliable)`);
  return jobs;
}
