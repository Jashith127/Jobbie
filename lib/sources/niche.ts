import axios from 'axios';
import cheerio from 'cheerio';
import { ScrapedJob } from '@/lib/types';

/**
 * Scrapes niche job boards (startups, tech communities, regional boards)
 * Uses static HTML parsing via cheerio (lightweight, serverless-friendly)
 * 
 * Supported boards:
 * - StartupSchool (YC jobs)
 * - Indie Hackers (indie developer jobs)
 * - Internshala (internships + entry-level jobs, popular in India/Asia)
 * 
 * Each scraper is isolated and fail-safe
 */

async function scrapeStartupSchoolJobs(): Promise<ScrapedJob[]> {
  const jobs: ScrapedJob[] = [];

  try {
    // StartupSchool job board (public, regularly updated)
    const response = await axios.get(
      'https://www.startupschool.org/jobs',
      { timeout: 10000 }
    );

    const $ = cheerio.load(response.data);

    $('div[class*="job"], article[class*="job"]').slice(0, 10).forEach((elem) => {
      try {
        const $elem = $(elem);
        const title = $elem.find('h2, h3, [class*="title"]').text().trim();
        const company = $elem.find('[class*="company"]').text().trim() || 'Unknown';
        const location = $elem.find('[class*="location"]').text().trim();
        const link = $elem.find('a').attr('href');

        if (title && link && (link.startsWith('http') || link.startsWith('/'))) {
          jobs.push({
            title,
            company,
            location: location || undefined,
            link: link.startsWith('http')
              ? link
              : `https://www.startupschool.org${link}`,
            source: 'niche',
          });
        }
      } catch (e) {
        // Skip malformed entries
      }
    });

    console.log(`✓ Niche (StartupSchool): ${jobs.length} jobs`);
  } catch (error: any) {
    console.error('❌ StartupSchool scrape error:', error.message);
  }

  return jobs;
}

async function scrapeIndieHackersJobs(): Promise<ScrapedJob[]> {
  const jobs: ScrapedJob[] = [];

  try {
    // Indie Hackers jobs board
    const response = await axios.get(
      'https://www.indiehackers.com/jobs',
      { timeout: 10000 }
    );

    const $ = cheerio.load(response.data);

    $('div[class*="job"], li[class*="job"]').slice(0, 10).forEach((elem) => {
      try {
        const $elem = $(elem);
        const title = $elem.find('h2, h3, [class*="title"]').text().trim();
        const company = $elem.find('[class*="company"]').text().trim() || 'Unknown';
        const link = $elem.find('a').attr('href');

        if (title && link && (link.startsWith('http') || link.startsWith('/'))) {
          jobs.push({
            title,
            company,
            link: link.startsWith('http')
              ? link
              : `https://www.indiehackers.com${link}`,
            source: 'niche',
          });
        }
      } catch (e) {
        // Skip malformed entries
      }
    });

    console.log(`✓ Niche (IndieHackers): ${jobs.length} jobs`);
  } catch (error: any) {
    console.error('❌ IndieHackers scrape error:', error.message);
  }

  return jobs;
}

async function scrapeInternshalaJobs(): Promise<ScrapedJob[]> {
  const jobs: ScrapedJob[] = [];

  try {
    // Internshala jobs board (popular in India/South Asia for internships and entry-level roles)
    const keywords = process.env.SEARCH_KEYWORDS || 'developer';
    
    // Internshala search URL format
    const searchUrl = `https://internshala.com/jobs/search/?query=${encodeURIComponent(keywords)}&location=`;

    const response = await axios.get(searchUrl, {
      timeout: 10000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    const $ = cheerio.load(response.data);

    // Internshala job listing selectors
    $('div.job_card, div.internship_card, article[data-job-id]').slice(0, 15).forEach(
      (elem) => {
        try {
          const $elem = $(elem);
          
          // Extract job details from Internshala structure
          const title =
            $elem.find('.job_heading, .job_title, h3').text().trim() ||
            $elem.find('a[href*="/job/"]').text().trim();
          
          const company =
            $elem.find('.company_name, .company, [class*="company"]').text().trim() ||
            'Unknown';
          
          const location =
            $elem.find('.location, [class*="location"]').text().trim() ||
            undefined;
          
          let link =
            $elem.find('a[href*="/job/"]').attr('href') ||
            $elem.find('a').first().attr('href');

          if (title && link) {
            // Ensure absolute URL
            if (link.startsWith('/')) {
              link = `https://internshala.com${link}`;
            } else if (!link.startsWith('http')) {
              link = `https://internshala.com/jobs/${link}`;
            }

            jobs.push({
              title,
              company,
              location: location || undefined,
              link,
              source: 'niche',
            });
          }
        } catch (e) {
          // Skip malformed entries
        }
      }
    );

    console.log(`✓ Niche (Internshala): ${jobs.length} jobs`);
  } catch (error: any) {
    console.error('❌ Internshala scrape error:', error.message);
  }

  return jobs;
}

/**
 * Main niche scraper orchestrator
 * Calls all niche sources in parallel
 * Each source failure doesn't affect others
 */
export async function fetchNicheJobs(): Promise<ScrapedJob[]> {
  try {
    const [startupSchoolJobs, indieHackersJobs, internshalaJobs] = await Promise.all([
      scrapeStartupSchoolJobs().catch(() => []),
      scrapeIndieHackersJobs().catch(() => []),
      scrapeInternshalaJobs().catch(() => []),
    ]);

    const allJobs = [...startupSchoolJobs, ...indieHackersJobs, ...internshalaJobs];
    console.log(`✓ Niche: total ${allJobs.length} jobs across all boards`);

    return allJobs;
  } catch (error: any) {
    console.error('❌ Niche jobs fetch error:', error.message);
    return [];
  }
}
