import axios from 'axios';
import { ScrapedJob } from '@/lib/types';

/**
 * Fetches job listings from Adzuna API
 * Free tier: 1000 API calls/month
 * Sign up: https://developer.adzuna.com/
 */
export async function fetchAdzunaJobs(): Promise<ScrapedJob[]> {
  const jobs: ScrapedJob[] = [];

  try {
    const apiKey = process.env.ADZUNA_API_KEY || '';
    
    if (!apiKey) {
      console.warn('⚠️ ADZUNA_API_KEY not set. Get free key: https://developer.adzuna.com/');
      return [];
    }

    const keywords = process.env.SEARCH_KEYWORDS || 'developer';
    const location = process.env.SEARCH_LOCATION || 'United States';
    const countryCode = 'us'; // Support for other countries can be added

    const response = await axios.get('https://api.adzuna.com/v1/api/jobs/us/search/1', {
      params: {
        app_id: process.env.ADZUNA_APP_ID || '',
        app_key: apiKey,
        what: keywords,
        where: location,
        results_per_page: 20,
        content_type: 'application/json',
      },
      timeout: 15000,
    });

    const data = response.data.results || [];

    data.forEach((job: any) => {
      try {
        if (job.title && job.redirect_url) {
          jobs.push({
            title: job.title,
            company: job.company?.display_name || 'Unknown',
            location: job.location?.display_name || undefined,
            link: job.redirect_url,
            salary: job.salary_is_predicted
              ? undefined
              : job.salary_max
              ? `$${job.salary_min || 0} - $${job.salary_max}`
              : undefined,
            date: job.created ? new Date(job.created).toISOString() : undefined,
            source: 'adzuna',
          });
        }
      } catch (e) {
        // Skip malformed entries
      }
    });

    console.log(`✓ Adzuna: fetched ${jobs.length} jobs`);
  } catch (error: any) {
    console.error('❌ Adzuna API error:', error.message);
    // Non-critical failure: continue with other sources
  }

  return jobs;
}
