import axios from 'axios';
import * as cheerio from 'cheerio';
import { ScrapedJob } from '../types';

export async function scrapeIndeed(): Promise<ScrapedJob[]> {
  const jobs: ScrapedJob[] = [];

  try {
    const keywords = process.env.INDEED_SEARCH_KEYWORDS || 'developer';
    const location = process.env.INDEED_LOCATION || 'United States';

    const searchUrl = `https://www.indeed.com/jobs?q=${encodeURIComponent(
      keywords
    )}&l=${encodeURIComponent(location)}&radius=25`;

    console.log(`Scraping Indeed: ${searchUrl}`);

    // Fetch the page with a realistic user agent
    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 15000,
    });

    const $ = cheerio.load(response.data);

    // Indeed uses different selectors - adjust based on current HTML structure
    const jobCards = $('div[data-job-id]');

    jobCards.each((index, element) => {
      if (index >= 15) return; // Limit to 15 jobs

      try {
        const $card = $(element);

        // Extract job title
        const title = $card.find('h2 a[data-jk]').attr('title') || 
                     $card.find('h2.jobTitle span').text().trim() ||
                     '';

        // Extract company
        const company = $card.find('[data-company-name]').text().trim() ||
                       $card.find('.companyName').text().trim() ||
                       '';

        // Extract location
        const location = $card.find('[data-job-location]').text().trim() ||
                        $card.find('.companyLocation').text().trim() ||
                        '';

        // Extract job link
        const link = $card.find('h2 a[data-jk]').attr('href') || '';
        const fullLink = link ? `https://www.indeed.com${link}` : '';

        // Extract salary if available
        const salary = $card.find('[data-salary-snippet]').text().trim() || '';

        if (title && company && fullLink) {
          jobs.push({
            title,
            company,
            location: location || undefined,
            link: fullLink,
            salary: salary || undefined,
            source: 'indeed',
          });
        }
      } catch (error) {
        console.error(`Error extracting job card ${index}:`, error);
        // Continue to next card
      }
    });
  } catch (error) {
    console.error('Error scraping Indeed:', error);
    // Return empty array instead of throwing - graceful degradation
  }

  console.log(`Successfully scraped ${jobs.length} jobs from Indeed`);
  return jobs;
}
