# Jobbie - Hybrid Job Listing Aggregator

A production-ready job aggregator that fetches listings from multiple free APIs and niche job boards. Designed for reliability and resilience through a **hybrid multi-source ingestion system**.

## Features

- **Multi-Source Ingestion**: Combines APIs (primary) + niche boards (secondary) for maximum coverage
- **4-Tier Pipeline**: APIs → Legacy Scrapers → Niche Boards → Search Engines
- **Supported Sources**:
  - **APIs** (Primary): Adzuna, Jooble
  - **Legacy** (Fallback): Indeed (via API), LinkedIn (optional)
  - **Niche Boards** (Secondary): StartupSchool, IndieHackers, Internshala
  - **Search Engines** (Optional): Google Jobs (free scraping)
- **Smart Filtering**: Keyword and location-based job filtering
- **Deduplication**: SHA256-based duplicate prevention across sources
- **Clean UI**: Modern dashboard for browsing, searching, and triggering scrapes
- **Database Storage**: SQLite with Prisma ORM for persistence
- **Vercel Ready**: Fully serverless-compatible with built-in cron scheduling
- **Fail-Safe**: Each source fails independently without disrupting the whole pipeline

## Tech Stack

- **Framework**: Next.js 15.5 (App Router) with TypeScript
- **Database**: SQLite with Prisma ORM 5.22
- **HTTP Client**: Axios
- **HTML Parsing**: Cheerio (for niche boards)
- **Hosting**: Vercel (serverless)
- **Language**: 100% TypeScript

## Project Structure

```
.
├── app/
│   ├── layout.tsx           # Root layout
│   ├── page.tsx             # Main UI dashboard
│   └── api/
│       ├── scrape/route.ts  # Unified scraping orchestrator
│       └── jobs/route.ts    # Jobs listing endpoint
├── lib/
│   ├── db.ts                # Database utilities
│   ├── filter.ts            # Job filtering logic
│   ├── dedupe.ts            # Deduplication logic
│   ├── types.ts             # Shared TypeScript types
│   ├── scrapers/            # (Legacy, deprecated)
│   │   ├── indeed.ts        # Indeed legacy scraper
│   │   └── linkedin.ts      # LinkedIn (disabled)
│   └── sources/             # (New, primary)
│       ├── adzuna.ts        # Adzuna API
│       ├── jooble.ts        # Jooble API
│       ├── google.ts        # Google Search (placeholder)
│       └── niche.ts         # Niche boards (StartupSchool, IndieHackers, Internshala)
├── prisma/
│   └── schema.prisma        # Database schema
├── vercel.json              # Vercel serverless config + cron
├── next.config.js           # Next.js config
├── tsconfig.json            # TypeScript config
└── package.json             # Dependencies
```

## Quick Start

### 1. Installation

```bash
npm install
```

### 2. Database Setup

Create `.env.local`:

```bash
cp .env.example .env.local
```

Initialize database:

```bash
npm run prisma:migrate
```

### 3. Start Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Configuration

### Environment Variables

```env
# Database
DATABASE_URL="file:./dev.db"

# Search Parameters
SEARCH_KEYWORDS="developer,engineer,software"
SEARCH_LOCATION="United States"

# Job Filtering
INCLUDE_KEYWORDS="developer,engineer,software"
EXCLUDE_KEYWORDS="senior,lead,manager"
PREFERRED_LOCATIONS="Remote,San Francisco"

# API Keys (get free keys from links below)
ADZUNA_API_ID=""        # Free: https://developer.adzuna.com/
ADZUNA_API_KEY=""       # 1000 API calls/month free tier

JOOBLE_API_KEY=""       # Free: https://jooble.org/api/about
                        # 1000 API calls/month free tier

# LinkedIn (optional, disabled by default)
SCRAPE_LINKEDIN="false"
LINKEDIN_EMAIL=""
LINKEDIN_PASSWORD=""
```

### Getting Free API Keys

#### 1. Adzuna API (Recommended)

- **Sign up**: https://developer.adzuna.com/
- **Free tier**: 1,000 API calls/month
- **Steps**:
  1. Sign up for developer account
  2. Create an application
  3. Copy `App ID` and `API key`
  4. Add to `.env.local`: `ADZUNA_API_ID` and `ADZUNA_API_KEY`

#### 2. Jooble API (Recommended)

- **Sign up**: https://jooble.org/api/about
- **Free tier**: 1,000 API calls/month
- **Steps**:
  1. Request API access
  2. Get your API key via email
  3. Add to `.env.local`: `JOOBLE_API_KEY`

#### 3. Google Jobs (Optional, Free Scraping)

- **Endpoint**: Google Jobs search (no API key needed)
- **Free tier**: Unlimited, but may be rate-limited
- **How it works**: Scrapes job listings from `google.com/search?tbm=lcm`
- **No setup**: Works out of the box!

**Optional upgrade**: Use **Google Custom Search API** for reliable access
- **Sign up**: https://programmablesearchengine.google.com/
- **Free tier**: 100 queries/day
- **Setup** (optional):
  ```env
  GOOGLE_SEARCH_API_KEY="your_api_key"
  GOOGLE_SEARCH_ENGINE_ID="your_engine_id"
  ```

#### 4. LinkedIn (Optional)

⚠️ **Not Recommended**: LinkedIn actively blocks scrapers. Use only if:
- You have official API access (rare, requires company approval)
- You understand ToS violations

Consider instead:
- LinkedIn's [official API](https://developer.linkedin.com/)
- Job board aggregators with legal access

## Data Sources & Coverage

| Source | Type | Coverage | Free Tier | Reliability |
|--------|------|----------|-----------|-------------|
| **Adzuna** | API | US, UK, India, etc. | 1,000 req/mo | ⭐⭐⭐⭐⭐ |
| **Jooble** | API | Global | 1,000 req/mo | ⭐⭐⭐⭐⭐ |
| **Google Jobs** | Web Scrape | Global | Unlimited* | ⭐⭐⭐⭐ |
| **StartupSchool** | Web Scrape | Startup jobs | Unlimited | ⭐⭐⭐⭐ |
| **IndieHackers** | Web Scrape | Indie jobs | Unlimited | ⭐⭐⭐⭐ |
| **Internshala** | Web Scrape | Internships, Asia-focused | Unlimited | ⭐⭐⭐⭐ |
| **Indeed** | Legacy API | US-focused | Limited | ⭐⭐⭐ |
| **LinkedIn** | Disabled | N/A | N/A | ⚠️ Blocked |

*Google may rate-limit aggressive scraping. Use **Google Custom Search API** (100 free/day) for reliable access.

## Architecture: 4-Tier Ingestion Pipeline

```
┌─────────────────────────────────────────────────────────┐
│              Unified Scraping Pipeline                  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Tier 1: API Sources (Primary)                         │
│  ├─ Adzuna (free API)                                 │
│  └─ Jooble (free API)                                 │
│                           ↓                             │
│  Tier 2: Legacy Scrapers (Fallback)                    │
│  ├─ Indeed (legacy, marked as secondary)              │
│  └─ LinkedIn (optional, disabled by default)          │
│                           ↓                             │
│  Tier 3: Niche Boards (Secondary)                      │
│  ├─ StartupSchool (HTML parsing)                      │
│  ├─ IndieHackers (HTML parsing)                       │
│  └─ Internshala (HTML parsing + India focus)          │
│                           ↓                             │
│  Tier 4: Search Engines (Optional)                     │
│  └─ Google Jobs (free scraping, no API key)           │
│                           ↓                             │
│  ┌─ Merge (combine all sources)                        │
│  ├─ Filter (keywords, location)                        │
│  ├─ Dedupe (SHA256 hashing)                            │
│  └─ Save (to SQLite database)                          │
│                                                         │
└─────────────────────────────────────────────────────────┘

Each source fails independently – pipeline continues if one source breaks
```

## API Routes

### POST /api/scrape

Triggers the unified scraping pipeline. Fetches jobs from all configured sources.

**Response** (new format with source breakdown):

```json
{
  "success": true,
  "newJobs": 42,
  "message": "Successfully scraped and saved 42 new jobs from 3 sources",
  "sources": {
    "adzuna": 15,
    "jooble": 12,
    "niche": 15
  },
  "breakdown": {
    "total_attempted": 85,
    "after_filter": 60,
    "after_dedupe": 42,
    "saved": 42
  }
}
```

**Curl example**:

```bash
curl -X POST http://localhost:3000/api/scrape
```

### GET /api/jobs

Fetches stored jobs (up to 100, newest first).

```bash
curl http://localhost:3000/api/jobs
```

**Response**:

```json
{
  "jobs": [
    {
      "id": 1,
      "title": "Senior Software Engineer",
      "company": "TechCorp",
      "location": "San Francisco, CA",
      "link": "https://...",
      "source": "adzuna",
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

### API Key Issues: "API key not set"

If you see warnings about missing API keys in logs:

1. **Get free keys**: See "Getting Free API Keys" section above
2. **Add to `.env.local`** (development):
   ```env
   ADZUNA_API_ID="your_app_id"
   ADZUNA_API_KEY="your_api_key"
   JOOBLE_API_KEY="your_api_key"
   ```
3. **Add to Vercel** (production):
   - Go to Vercel dashboard → Project → Settings → Environment Variables
   - Add each key and redeploy

**Without API keys**: System still works, but only niche boards + legacy scrapers will provide results (limited coverage).

### No Jobs Found: "No new jobs found during scraping"

Likely causes:

1. **All sources failed**: Check application console logs for source-specific errors
2. **All jobs were filtered out**: Adjust `INCLUDE_KEYWORDS` and `EXCLUDE_KEYWORDS` in `.env.local`
3. **All jobs were deduped**: Normal if you re-scrape frequently; database already has those jobs
4. **Network issues**: Niche board sites might be down; try again later

**Debug**: Check scrapiing logs in Vercel dashboard for which sources succeeded/failed.

### Database Error: "SQLITE_CANTOPEN"

Setup steps:

```bash
mkdir -p prisma
npm run prisma:migrate
```

### Niche Board Pages Won't Load

If scraping niche boards returns 0 results:

1. **Network/DNS issue**: Try manually visiting the site in a browser
2. **HTML structure changed**: Job board redesigns break CSS selectors; update `lib/sources/niche.ts`
3. **Rate limiting**: Wait a few minutes before retrying

**Note**: Niche board scraping is best-effort (HTML parsing is fragile). APIs are more reliable.

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
