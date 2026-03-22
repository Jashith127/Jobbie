import { ScrapedJob } from './types';

export function filterJobs(jobs: ScrapedJob[]): ScrapedJob[] {
  const includeKeywords = (process.env.INCLUDE_KEYWORDS || 'developer,engineer,software')
    .split(',')
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);

  const excludeKeywords = (process.env.EXCLUDE_KEYWORDS || 'senior,lead,manager')
    .split(',')
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);

  const preferredLocations = (process.env.PREFERRED_LOCATIONS || '')
    .split(',')
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);

  return jobs.filter((job) => {
    const titleLower = job.title.toLowerCase();
    const companyLower = job.company.toLowerCase();
    const locationLower = (job.location || '').toLowerCase();

    // Check include keywords (at least one must match)
    if (
      includeKeywords.length > 0 &&
      !includeKeywords.some((keyword) => titleLower.includes(keyword))
    ) {
      return false;
    }

    // Check exclude keywords (none should match)
    if (excludeKeywords.some((keyword) => titleLower.includes(keyword))) {
      return false;
    }

    // If preferred locations are set, filter by location
    if (
      preferredLocations.length > 0 &&
      !preferredLocations.some((loc) => locationLower.includes(loc))
    ) {
      // Allow "remote" if specified
      if (!titleLower.includes('remote') && !locationLower.includes('remote')) {
        return false;
      }
    }

    return true;
  });
}
