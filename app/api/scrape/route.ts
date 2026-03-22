import { NextRequest, NextResponse } from 'next/server';
import { scrapeIndeed } from '@/lib/scrapers/indeed';
import { scrapeLinkedIn } from '@/lib/scrapers/linkedin';
import { fetchAdzunaJobs } from '@/lib/sources/adzuna';
import { fetchJoobleJobs } from '@/lib/sources/jooble';
import { fetchGoogleSearchJobs } from '@/lib/sources/google';
import { fetchNicheJobs } from '@/lib/sources/niche';
import { filterJobs } from '@/lib/filter';
import { dedupeJobs } from '@/lib/dedupe';
import { saveJobs } from '@/lib/db';
import type { ScrapedJob } from '@/lib/types';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const allJobs: ScrapedJob[] = [];
    const sourceStats: Record<string, number> = {};

    console.log('🔄 Starting unified job scraping pipeline...');

    // ============================================
    // TIER 1: API-BASED SOURCES (PRIMARY)
    // ============================================
    
    console.log('\n📡 Tier 1: Fetching from API sources...');
    
    // Adzuna (primary)
    const adzunaJobs = await fetchAdzunaJobs().catch(() => []);
    if (adzunaJobs.length > 0) {
      allJobs.push(...adzunaJobs);
      sourceStats['adzuna'] = adzunaJobs.length;
    }

    // Jooble (primary)
    const joobleJobs = await fetchJoobleJobs().catch(() => []);
    if (joobleJobs.length > 0) {
      allJobs.push(...joobleJobs);
      sourceStats['jooble'] = joobleJobs.length;
    }

    // ============================================
    // TIER 2: LEGACY SCRAPERS (FALLBACK)
    // ============================================
    
    console.log('\n🔍 Tier 2: Fetching from legacy scrapers...');
    
    // Indeed (legacy, marked as secondary)
    const indeedJobs = await scrapeIndeed().catch(() => []);
    if (indeedJobs && indeedJobs.length > 0) {
      allJobs.push(...indeedJobs);
      sourceStats['indeed'] = indeedJobs.length;
    }

    // LinkedIn (optional, disabled by default)
    const scrapeLinkedInEnabled =
      process.env.SCRAPE_LINKEDIN === 'true' &&
      process.env.LINKEDIN_EMAIL &&
      process.env.LINKEDIN_PASSWORD;

    if (scrapeLinkedInEnabled) {
      const linkedInJobs = await scrapeLinkedIn().catch(() => []);
      if (linkedInJobs && linkedInJobs.length > 0) {
        allJobs.push(...linkedInJobs);
        sourceStats['linkedin'] = linkedInJobs.length;
      }
    }

    // ============================================
    // TIER 3: NICHE BOARD SCRAPING (SECONDARY)
    // ============================================
    
    console.log('\n🎯 Tier 3: Scraping niche job boards...');
    
    // Niche boards (StartupSchool, IndieHackers, Internshala)
    const nicheJobs = await fetchNicheJobs().catch(() => []);
    if (nicheJobs && nicheJobs.length > 0) {
      allJobs.push(...nicheJobs);
      sourceStats['niche'] = nicheJobs.length;
    }

    // ============================================
    // TIER 4: SEARCH ENGINE SCRAPING (OPTIONAL)
    // ============================================
    
    console.log('\n🔎 Tier 4: Searching via search engines...');
    
    // Google Jobs (free scraping, may be rate-limited)
    const googleJobs = await fetchGoogleSearchJobs().catch(() => []);
    if (googleJobs && googleJobs.length > 0) {
      allJobs.push(...googleJobs);
      sourceStats['google'] = googleJobs.length;
    }

    // ============================================
    // PROCESSING PIPELINE
    // ============================================
    
    console.log('\n📊 Source summary:', sourceStats);
    console.log(`Total jobs from all sources: ${allJobs.length}`);

    if (!allJobs || allJobs.length === 0) {
      console.log('⚠️ No jobs found from any source');
      return NextResponse.json({
        success: true,
        newJobs: 0,
        message: 'No new jobs found during scraping',
        sources: sourceStats,
      });
    }

    // Apply filters (keywords, location, etc.)
    console.log('🔽 Applying filters...');
    const filteredJobs = filterJobs(allJobs);
    console.log(`Jobs after filtering: ${filteredJobs.length}`);

    // Deduplicate based on title + company
    console.log('🧹 Deduplicating...');
    const deduped = await dedupeJobs(filteredJobs);
    console.log(`Jobs after deduplication: ${deduped.length}`);

    // Save to database (handles unique constraint on link)
    console.log('💾 Saving to database...');
    const saved = await saveJobs(deduped);
    console.log(`✅ Successfully saved ${saved} new jobs`);

    return NextResponse.json({
      success: true,
      newJobs: saved,
      message: `Successfully scraped and saved ${saved} new jobs from ${Object.keys(sourceStats).length} sources`,
      sources: sourceStats,
      breakdown: {
        total_attempted: allJobs.length,
        after_filter: filteredJobs.length,
        after_dedupe: deduped.length,
        saved: saved,
      },
    });
  } catch (error: any) {
    console.error('❌ Scraping pipeline error:', error);
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
