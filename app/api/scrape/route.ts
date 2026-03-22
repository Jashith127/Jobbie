import { NextRequest, NextResponse } from 'next/server';
import { scrapeIndeed } from '@/lib/scrapers/indeed';
import { scrapeLinkedIn } from '@/lib/scrapers/linkedin';
import { filterJobs } from '@/lib/filter';
import { dedupeJobs } from '@/lib/dedupe';
import { saveJobs } from '@/lib/db';
import type { ScrapedJob } from '@/lib/types';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const allJobs: ScrapedJob[] = [];

    // Scrape from Indeed (always enabled)
    const indeedJobs = await scrapeIndeed();
    if (indeedJobs && indeedJobs.length > 0) {
      allJobs.push(...indeedJobs);
    }

    // Optionally scrape from LinkedIn (disabled by default due to reliability issues)
    const scrapeLinkedInEnabled =
      process.env.SCRAPE_LINKEDIN === 'true' &&
      process.env.LINKEDIN_EMAIL &&
      process.env.LINKEDIN_PASSWORD;

    if (scrapeLinkedInEnabled) {
      const linkedInJobs = await scrapeLinkedIn();
      if (linkedInJobs && linkedInJobs.length > 0) {
        allJobs.push(...linkedInJobs);
      }
    }

    if (!allJobs || allJobs.length === 0) {
      return NextResponse.json({
        success: true,
        newJobs: 0,
        message: 'No new jobs found during scraping',
      });
    }

    // Apply filters
    const filteredJobs = filterJobs(allJobs);

    // Deduplicate
    const deduped = await dedupeJobs(filteredJobs);

    // Save to database
    const saved = await saveJobs(deduped);

    return NextResponse.json({
      success: true,
      newJobs: saved,
      message: `Successfully scraped and saved ${saved} new jobs`,
    });
  } catch (error: any) {
    console.error('Scraping error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to scrape jobs',
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return NextResponse.json(
    { error: 'Use POST to trigger scraping' },
    { status: 405 }
  );
}
