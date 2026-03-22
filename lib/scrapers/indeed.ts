import { chromium } from 'playwright';
import { ScrapedJob } from '../types';

export async function scrapeIndeed(): Promise<ScrapedJob[]> {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-gpu',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--single-process',
    ],
  });

  const jobs: ScrapedJob[] = [];

  try {
    const page = await browser.newPage();

    // Use a simple Indeed search URL
    const keywords = process.env.INDEED_SEARCH_KEYWORDS || 'developer';
    const location = process.env.INDEED_LOCATION || 'United States';

    const searchUrl = `https://www.indeed.com/jobs?q=${encodeURIComponent(
      keywords
    )}&l=${encodeURIComponent(location)}&radius=25`;

    console.log(`Scraping Indeed: ${searchUrl}`);

    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // Wait for job listings to load
    await page.waitForSelector('[data-job-id]', { timeout: 5000 }).catch(() => {
      console.warn('Job listings selector not found, trying alternative...');
    });

    // Extract job cards
    const jobCards = await page.$$('[data-job-id]');

    for (let i = 0; i < Math.min(jobCards.length, 15); i++) {
      try {
        const card = jobCards[i];

        const title = await card.$eval(
          '[rel="job-title-link"]',
          (el) => el.textContent?.trim() || ''
        ).catch(() => '');

        const company = await card.$eval(
          '[data-company-name]',
          (el) => el.textContent?.trim() || ''
        ).catch(() => '');

        const location = await card
          .$eval(
            '[data-job-location]',
            (el) => el.textContent?.trim() || ''
          )
          .catch(() => undefined);

        const link = await card
          .$eval('[rel="job-title-link"]', (el: any) => el.href)
          .catch(() => '');

        const salary = await card
          .$eval(
            '[data-salary-snippet]',
            (el) => el.textContent?.trim() || ''
          )
          .catch(() => undefined);

        if (title && company && link) {
          jobs.push({
            title,
            company,
            location,
            link,
            salary,
            source: 'indeed',
          });
        }
      } catch (error) {
        console.error(`Error extracting job card ${i}:`, error);
        continue;
      }
    }

    await page.close();
  } catch (error) {
    console.error('Error scraping Indeed:', error);
  } finally {
    await browser.close();
  }

  console.log(`Successfully scraped ${jobs.length} jobs from Indeed`);
  return jobs;
}
