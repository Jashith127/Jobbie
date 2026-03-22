# Jobbie - Job Listing Aggregator

A production-ready job listing aggregator designed for personal use. Automates scraping, filtering, deduplication, and display of job listings from multiple sources.

## Features

- **Multi-source Scraping**: Scrapes job listings from Indeed (LinkedIn support with warnings)
- **Smart Filtering**: User-defined include/exclude keywords and location preferences
- **Deduplication**: Prevents duplicate listings using normalized hashing
- **Clean UI**: Modern, minimal dashboard for browsing jobs
- **Database Storage**: SQLite via Prisma ORM for persistent storage
- **Vercel Ready**: Serverless-compatible, meets all Vercel constraints
- **Scheduled Scraping**: Optional cron-based automation via Vercel or external services

## Tech Stack

- **Framework**: Next.js (App Router) with TypeScript
- **Database**: SQLite with Prisma ORM
- **Scraping**: Playwright (headless Chromium)
- **Hosting**: Vercel (serverless functions)
- **Language**: 100% TypeScript

## Project Structure

```
.
├── app/
│   ├── layout.tsx          # Root layout
│   ├── page.tsx            # Main UI (jobs listing)
│   └── api/
│       ├── scrape/route.ts # Scraping trigger endpoint
│       └── jobs/route.ts   # Jobs listing endpoint
├── lib/
│   ├── db.ts              # Database utilities
│   ├── filter.ts          # Job filtering logic
│   ├── dedupe.ts          # Deduplication logic
│   └── scrapers/
│       └── indeed.ts      # Indeed scraper
├── prisma/
│   └── schema.prisma      # Prisma database schema
├── vercel.json            # Vercel configuration
├── next.config.js         # Next.js configuration
├── tsconfig.json          # TypeScript configuration
└── package.json           # Dependencies
```

## Quick Start

### 1. Installation

Clone or create the project, then install dependencies:

```bash
npm install
```

### 2. Database Setup

Create a `.env.local` file (copy from `.env.example`):

```bash
cp .env.example .env.local
```

Configure environment variables:

```env
DATABASE_URL="file:./dev.db"
INDEED_SEARCH_KEYWORDS="senior developer,full stack engineer,backend"
INDEED_LOCATION="United States"
INCLUDE_KEYWORDS="developer,engineer,software"
EXCLUDE_KEYWORDS="senior,lead,manager"
PREFERRED_LOCATIONS="Remote,San Francisco"
```

Initialize the database:

```bash
npm run prisma:migrate
```

### 3. Development

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

**Scraping from the UI**: Click the "Scrape Now" button to start a scraping job. Results will appear in the job list.

## Configuration

### Environment Variables

- `DATABASE_URL`: SQLite database path (default: `file:./dev.db`)
- `INDEED_SEARCH_KEYWORDS`: Comma-separated keywords for Indeed scraping
- `INDEED_LOCATION`: Location to search for jobs
- `INCLUDE_KEYWORDS`: Comma-separated keywords to include (at least one must match job title)
- `EXCLUDE_KEYWORDS`: Comma-separated keywords to exclude (none should match)
- `PREFERRED_LOCATIONS`: Comma-separated preferred locations (jobs from these locations prioritized)

### Scrapers

#### Indeed Scraper

Located in `lib/scrapers/indeed.ts`:

- Extracts: title, company, location, link, salary (if available)
- Uses Playwright to load pages and extract data
- Limits to 15 job listings per run (configurable)
- Handles missing data gracefully

#### LinkedIn Scraper (Unsupported)

⚠️ **Warning**: LinkedIn actively blocks scrapers. Adding LinkedIn support is NOT recommended because:

- LinkedIn requires authentication and has strong anti-scraping measures
- Terms of service violations
- High risk of account bans
- Unreliable and frequently breaks

For LinkedIn jobs, consider using their official API (requires approval) or RSS feeds.

## API Routes

### POST /api/scrape

Triggers a scraping job. Returns number of new jobs saved.

```bash
curl -X POST http://localhost:3000/api/scrape
```

Response:

```json
{
  "success": true,
  "newJobs": 5,
  "message": "Successfully scraped and saved 5 new jobs"
}
```

### GET /api/jobs

Fetches all stored jobs (up to 100, sorted by newest).

```bash
curl http://localhost:3000/api/jobs
```

Response:

```json
{
  "jobs": [
    {
      "id": 1,
      "title": "Senior Software Engineer",
      "company": "TechCorp",
      "location": "San Francisco, CA",
      "link": "https://...",
      "source": "indeed",
      "salary": "$150k - $200k",
      "createdAt": "2024-01-20T10:30:00Z"
    }
  ]
}
```

## Scheduling Scrapes

### Option 1: Vercel Cron Jobs (Recommended)

Vercel supports cron-triggered functions. The `vercel.json` is already configured:

```json
{
  "crons": [
    {
      "path": "/api/scrape",
      "schedule": "0 0 * * *"  // Daily at midnight UTC
    }
  ]
}
```

**Setup**:
1. Deploy to Vercel
2. Cron jobs execute automatically on the specified schedule
3. Monitor execution in Vercel dashboard

### Option 2: GitHub Actions

Create `.github/workflows/scrape.yml`:

```yaml
name: Scrape Jobs

on:
  schedule:
    - cron: '0 0 * * *'  # Daily at midnight UTC

jobs:
  scrape:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger scrape
        run: |
          curl -X POST ${{ secrets.VERCEL_URL }}/api/scrape
```

### Option 3: External Cron Service

Use services like [cron-job.org](https://cron-job.org) or [EasyCron](https://www.easycron.com):

```
Webhook URL: https://your-vercel-url.vercel.app/api/scrape
Method: POST
Interval: Daily
```

## Deployment to Vercel

### 1. Prepare for Deployment

Ensure all environment variables are set in `vercel.json` or add them via Vercel dashboard.

### 2. Deploy

```bash
npm install -g vercel
vercel login
vercel deploy --prod
```

### 3. Configure Environment Variables

In Vercel dashboard:
1. Go to **Settings** → **Environment Variables**
2. Add all variables from `.env.example`
3. Redeploy

### 4. Configure Database

SQLite works on Vercel but is stored in ephemeral storage (lost on redeploy). For persistent storage:

**Option A**: Use a managed database (PostgreSQL, MySQL)
- Update `prisma/schema.prisma` datasource
- Add connection string to environment variables

**Option B**: Keep SQLite (data resets on deploy)
- Acceptable for personal use
- Re-scrape jobs after each deployment

### 5. Verify Cron Jobs

In Vercel dashboard:
1. Go to **Cron Jobs** section
2. Verify your cron schedules are listed
3. Check **Logs** for execution history

## Database Schema

```prisma
model Job {
  id          Int     @id @default(autoincrement())
  title       String
  company     String
  location    String?
  link        String  @unique
  source      String
  salary      String?
  description String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model JobDedupeHash {
  id        Int     @id @default(autoincrement())
  hash      String  @unique
  jobId     Int
  createdAt DateTime @default(now())
}
```

The `JobDedupeHash` table stores normalized hashes of job title+company pairs to prevent duplicates.

## Performance Considerations

- **Scraping**: 15 jobs per scraper per run (~10-20 seconds total)
- **Filtering**: O(n) complexity, negligible for typical job counts
- **Deduplication**: O(n) with hash lookups, efficient
- **Database**: Indexed on source and createdAt for fast queries
- **Vercel Limits**: Max 60 second execution (set in `vercel.json` functions.maxDuration)

## Troubleshooting

### Browser Error: "Playwright is not installed"

```bash
npm install --save-dev @playwright/test
npx playwright install
```

### Database Error: "SQLITE_CANTOPEN"

Create the database directory:

```bash
mkdir -p prisma
npm run prisma:migrate
```

### Scraping Returns No Jobs

1. Check network connectivity
2. Verify Indeed isn't blocking (check IP, add delays)
3. Ensure CSS selectors match current Indeed HTML structure
4. Check browser console logs in dev environment

### Vercel Deployment Hangs

1. Verify environment variables are set
2. Check function timeout (`maxDuration` in `vercel.json`)
3. Inspect Vercel logs for detailed errors
4. Ensure Playwright chromium is cached (no re-installs per request)

## Customization

### Adding a New Scraper

1. Create `lib/scrapers/newsource.ts`:

```typescript
export interface ScrapedJob {
  title: string;
  company: string;
  location?: string;
  link: string;
  salary?: string;
  source: 'newsource';
}

export async function scrapeNewSource(): Promise<ScrapedJob[]> {
  // Implementation here
}
```

2. Update `app/api/scrape/route.ts`:

```typescript
import { scrapeNewSource } from '@/lib/scrapers/newsource';

const allJobs = [
  ...indeedJobs,
  ...await scrapeNewSource(),
];
```

### Modifying the UI

The main UI is in `app/page.tsx`. Customize:

- Styling (inline styles can be moved to a CSS module)
- Job card layout
- Search/filter interface
- Display columns

### Adjusting Filters

Modify `lib/filter.ts` to add:

- Salary range filtering
- Company size filtering
- Job type filtering (FT, PT, contract, etc.)
- Remote-only mode

## Real-World Maintenance

- **Monitor Indeed changes**: Website HTML updates may break selectors. Test monthly.
- **Update dependencies**: `npm update` every 2-4 weeks.
- **Review database**: Occasionally prune old jobs with: `npx prisma db execute --file=script.sql`
- **Check scraper performance**: Monitor execution logs in Vercel dashboard.

## License

MIT - Use freely for personal or commercial use.

## Support

For issues or questions:
1. Check this README
2. Review environment variables in `.env.local`
3. Inspect logs: `npm run dev` or Vercel dashboard
4. Update dependencies and retry

Happy job hunting! 🚀
