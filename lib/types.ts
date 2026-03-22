export interface ScrapedJob {
  title: string;
  company: string;
  location?: string;
  link: string;
  salary?: string;
  source: 'indeed' | 'linkedin';
}
