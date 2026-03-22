'use client';

import { useEffect, useState } from 'react';

interface Job {
  id: number;
  title: string;
  company: string;
  location?: string;
  link: string;
  source: string;
  salary?: string;
  createdAt: string;
}

export default function Home() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    loadJobs();
  }, []);

  const loadJobs = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/jobs');
      const data = await response.json();
      setJobs(data.jobs || []);
      setError('');
    } catch (err) {
      setError('Failed to load jobs');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleScrape = async () => {
    setScraping(true);
    setError('');
    try {
      const response = await fetch('/api/scrape', { method: 'POST' });
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Scraping failed');
      }
      
      await loadJobs();
      alert(`Created ${data.newJobs} new jobs`);
    } catch (err: any) {
      setError(err.message || 'Failed to scrape jobs');
    } finally {
      setScraping(false);
    }
  };

  const filteredJobs = jobs.filter(job =>
    job.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    job.company.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <main>
      <h1 style={{ marginBottom: '30px', fontSize: '2.5em', color: '#333' }}>
        Jobbie - Job Listing Aggregator
      </h1>

      <div style={{ marginBottom: '30px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Search jobs..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{
            padding: '10px',
            border: '1px solid #ccc',
            borderRadius: '4px',
            flex: 1,
            minWidth: '200px',
          }}
        />
        <button
          onClick={handleScrape}
          disabled={scraping || loading}
          style={{
            padding: '10px 20px',
            backgroundColor: scraping ? '#ccc' : '#0066cc',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: scraping ? 'not-allowed' : 'pointer',
            fontSize: '1em',
          }}
        >
          {scraping ? 'Scraping...' : 'Scrape Now'}
        </button>
      </div>

      {error && <div style={{ color: '#d00', marginBottom: '20px', padding: '10px', backgroundColor: '#fee' }}>{error}</div>}

      <p style={{ color: '#666', marginBottom: '20px' }}>
        Total jobs: <strong>{jobs.length}</strong> | Showing: <strong>{filteredJobs.length}</strong>
      </p>

      {loading ? (
        <p>Loading jobs...</p>
      ) : filteredJobs.length === 0 ? (
        <p>No jobs found. Click &quot;Scrape Now&quot; to fetch job listings.</p>
      ) : (
        <div style={{ display: 'grid', gap: '15px' }}>
          {filteredJobs.map((job) => (
            <div
              key={job.id}
              style={{
                border: '1px solid #ddd',
                padding: '15px',
                borderRadius: '6px',
                backgroundColor: '#fafafa',
              }}
            >
              <h3 style={{ margin: '0 0 5px 0', color: '#0066cc' }}>{job.title}</h3>
              <p style={{ margin: '3px 0', color: '#666' }}>
                <strong>{job.company}</strong>
                {job.location && <> • {job.location}</>}
              </p>
              {job.salary && <p style={{ margin: '3px 0', color: '#666' }}>💰 {job.salary}</p>}
              <p style={{ margin: '8px 0 3px 0', fontSize: '0.85em', color: '#999' }}>
                Source: {job.source} • {new Date(job.createdAt).toLocaleDateString()}
              </p>
              <a
                href={job.link}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: '#0066cc',
                  textDecoration: 'none',
                  fontSize: '0.9em',
                  wordBreak: 'break-all',
                }}
              >
                View Job →
              </a>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
