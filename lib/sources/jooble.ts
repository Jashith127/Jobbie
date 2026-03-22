import axios from 'axios';
import { ScrapedJob } from '@/lib/types';

/**
 * Fetches job listings from Jooble API
 * Free tier: 1000 API calls/month
 * Sign up: https://jooble.org/api/about
 */
export async function fetchJoobleJobs(): Promise<ScrapedJob[]> {
  const jobs: ScrapedJob[] = [];

  try {
    const apiKey = process.env.JOOBLE_API_KEY || '';
    
    if (!apiKey) {
      console.warn('⚠️ JOOBLE_API_KEY not set. Get free key: https://jooble.org/api/about');
      return [];
    }

    const keywords = process.env.SEARCH_KEYWORDS || 'developer';
    const location = process.env.SEARCH_LOCATION || 'United States';

    const response = await axios.post(
      'https://us.jooble.org/api/search',
      {
        keywords: keywords,
        location: location,
        pageNum: 1,
        radiusDistance: 0,
        salary: 0,
        employment: [],
        jobCategory: [],
        companySize: [],
      },
      {
        params: { apiKey },
        timeout: 15000,
      }
    );

    const data = response.data.jobs || [];

    data.slice(0, 20).forEach((job: any) => {
      try {
        if (job.title && job.link) {
          jobs.push({
            title: job.title,
            company: job.company || 'Unknown',
            location: job.location || undefined,
            link: job.link,
            salary: job.salary || undefined,
            date: undefined, // Jooble doesn't reliably provide dates
            source: 'jooble',
          });
        }
      } catch (e) {
        // Skip malformed entries
      }
    });

    console.log(`✓ Jooble: fetched ${jobs.length} jobs`);
  } catch (error: any) {
    console.error('❌ Jooble API error:', error.message);
    // Non-critical failure: continue with other sources
  }

  return jobs;
}
