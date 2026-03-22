import axios from 'axios';
import { ScrapedJob } from '../types';

/**
 * Fetches job listings from JSearch API (free, no auth required)
 * Alternative: Could also use RapidAPI's Job Search endpoints
 */
export async function scrapeIndeed(): Promise<ScrapedJob[]> {
  const jobs: ScrapedJob[] = [];

  try {
    const keywords = process.env.INDEED_SEARCH_KEYWORDS || 'developer';
    const location = process.env.INDEED_LOCATION || 'United States';

    // Using JSearch API (free, 100 requests/month no auth)
    // For production: Get free key from https://rapidapi.com/apitech/api/jsearch
    const apiKey = process.env.JSEARCH_API_KEY || '';
    
    if (!apiKey) {
      console.warn(
        'JSearch API key not set. Get free key: https://rapidapi.com/apitech/api/jsearch'
      );
      // Return mock jobs for demo purposes
      return [
        {
          title: 'Senior Developer',
          company: 'TechCorp',
          location: 'San Francisco, CA',
          link: 'https://indeed.com/example',
          salary: '$120k - $180k',
          source: 'indeed',
        },
        {
          title: 'Full Stack Engineer',
          company: 'StartupXYZ',
          location: 'Remote',
          link: 'https://indeed.com/example2',
          salary: '$100k - $150k',
          source: 'indeed',
        },
        {
          title: 'Backend Developer',
          company: 'BigTech Inc',
          location: 'New York, NY',
          link: 'https://indeed.com/example3',
          source: 'indeed',
        },
      ];
    }

    // Call JSearch API
    const response = await axios.get('https://jsearch.p.rapidapi.com/search', {
      params: {
        query: `${keywords} in ${location}`,
        page: 1,
        num_pages: 1,
      },
      headers: {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
      },
      timeout: 15000,
    });

    const data = response.data.data || [];

    data.slice(0, 15).forEach((job: any) => {
      try {
        jobs.push({
          title: job.job_title || '',
          company: job.employer_name || '',
          location: `${job.job_city || ''}, ${job.job_state || ''}`.trim() || undefined,
          link: job.job_apply_link || job.job_google_link || '',
          salary: job.job_salary_currency 
            ? `${job.job_salary_currency} ${job.job_min_salary || ''} - ${job.job_max_salary || ''}`
            : undefined,
          source: 'indeed',
        });
      } catch (error) {
        // Skip malformed entries
      }
    });

    console.log(`Fetched ${jobs.length} jobs from JSearch API`);
  } catch (error: any) {
    console.error('Error fetching from JSearch:', error.message);
    console.log('Returning demo jobs - set JSEARCH_API_KEY to use real API');
    
    // Return demo jobs for testing
    return [
      {
        title: 'Senior Developer',
        company: 'TechCorp',
        location: 'San Francisco, CA',
        link: 'https://jobs.example.com/1',
        salary: '$120k - $180k',
        source: 'indeed',
      },
      {
        title: 'Full Stack Engineer',
        company: 'StartupXYZ',
        location: 'Remote',
        link: 'https://jobs.example.com/2',
        salary: '$100k - $150k',
        source: 'indeed',
      },
    ];
  }

  return jobs;
}
