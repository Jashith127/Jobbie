import { ScrapedJob } from './types';
import { prisma } from './db';
import crypto from 'crypto';

function normalizeTitleAndCompany(
  title: string,
  company: string
): string {
  // Normalize by lowercasing, removing special characters, and removing extra spaces
  const normalized =
    `${title} ${company}`
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim() || '';

  return normalized;
}

function generateHash(title: string, company: string): string {
  const normalized = normalizeTitleAndCompany(title, company);
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

export async function dedupeJobs(
  jobs: ScrapedJob[]
): Promise<ScrapedJob[]> {
  let existingHashes = new Set<string>();
  
  try {
    // Get existing hashes from database
    const hashes = await prisma.jobDedupeHash.findMany({});
    existingHashes = new Set(hashes.map((h) => h.hash));
  } catch (error: any) {
    console.warn('⚠️ Could not query existing hashes (database may not be initialized)', 
      error.message);
    // Continue with empty set if database error (all jobs treated as new)
  }

  const deduped: ScrapedJob[] = [];
  const newHashes: string[] = [];

  for (const job of jobs) {
    const hash = generateHash(job.title, job.company);

    if (!existingHashes.has(hash) && !newHashes.includes(hash)) {
      deduped.push(job);
      newHashes.push(hash);
    }
  }

  // Store new hashes for future deduplication
  if (newHashes.length > 0) {
    for (const hash of newHashes) {
      try {
        await prisma.jobDedupeHash.create({
          data: { hash },
        });
      } catch (error) {
        // Hash might already exist, ignore
      }
    }
  }

  console.log(
    `Deduplication: ${jobs.length} jobs -> ${deduped.length} unique jobs`
  );

  return deduped;
}
