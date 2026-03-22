import { PrismaClient } from '@prisma/client';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export async function saveJobs(
  jobs: Array<{
    title: string;
    company: string;
    location?: string;
    link: string;
    source: string;
    salary?: string;
    description?: string;
  }>
): Promise<number> {
  let savedCount = 0;

  for (const job of jobs) {
    try {
      await prisma.job.create({
        data: {
          title: job.title,
          company: job.company,
          location: job.location,
          link: job.link,
          source: job.source,
          salary: job.salary,
          description: job.description,
        },
      });
      savedCount++;
    } catch (error: any) {
      if (error.code === 'P2002') {
        // Unique constraint violation - job already exists
        continue;
      }
      throw error;
    }
  }

  return savedCount;
}
