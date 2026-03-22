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
  // Get existing hashes from database
  const existingHashes = new Set(
    (await prisma.jobDedupeHash.findMany({})).map((h) => h.hash)
  );

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
