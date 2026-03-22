export interface ScrapedJob {
  title: string;
  company: string;
  location?: string;
  link: string;
  salary?: string;
  date?: string;
  source: 'adzuna' | 'jooble' | 'google' | 'niche' | 'indeed' | 'linkedin';
}
