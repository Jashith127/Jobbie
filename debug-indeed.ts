import axios from 'axios';
import * as cheerio from 'cheerio';

async function debugIndeed() {
  try {
    const keywords = 'developer';
    const location = 'United States';

    const searchUrl = `https://www.indeed.com/jobs?q=${encodeURIComponent(
      keywords
    )}&l=${encodeURIComponent(location)}&radius=25`;

    console.log(`Fetching: ${searchUrl}`);

    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      timeout: 15000,
    });

    const $ = cheerio.load(response.data);

    // Try multiple selector approaches
    console.log('\n=== DEBUGGING INDEED SELECTORS ===\n');

    // Method 1: data-job-id
    console.log('1. Looking for [data-job-id]:');
    const method1 = $('div[data-job-id]').length;
    console.log(`   Found: ${method1} elements`);

    // Method 2: job-tile
    console.log('2. Looking for [data-testid="jobMetaDataGroup"]:');
    const method2 = $('[data-testid="jobMetaDataGroup"]').length;
    console.log(`   Found: ${method2} elements`);

    // Method 3: Look for job card patterns
    console.log('3. Looking for .jobCard:');
    const method3 = $('.jobCard').length;
    console.log(`   Found: ${method3} elements`);

    // Method 4: Article elements (common for job listings)
    console.log('4. Looking for article element:');
    const method4 = $('article').length;
    console.log(`   Found: ${method4} elements`);

    // Method 5: Look at divs with aria-label
    console.log('5. Looking for [aria-label*="job"]:');
    const method5 = $('div[aria-label*="job"]').length;
    console.log(`   Found: ${method5} elements`);

    // Print first few job card classes/ids
    console.log('\n=== ANALYZING FIRST CARD ===\n');
    
    let firstCard = null;
    if (method1 > 0) {
      firstCard = $('div[data-job-id]').first();
      console.log('Using method 1 selector');
    } else if (method4 > 0) {
      firstCard = $('article').first();
      console.log('Using article selector');
    }

    if (firstCard && firstCard.length) {
      console.log('Card HTML:');
      console.log(firstCard.html()?.substring(0, 500));
      console.log('...\n');

      // Try to extract title
      console.log('Trying title extraction:');
      const titleVariations = [
        firstCard.find('h2 a[data-jk]').attr('title'),
        firstCard.find('h2.jobTitle span').text(),
        firstCard.find('.jobTitle').text(),
        firstCard.find('a[role="link"]').attr('aria-label'),
        firstCard.find('a').first().attr('aria-label'),
      ];
      
      titleVariations.forEach((title, idx) => {
        if (title) console.log(`  [${idx}] Found: "${title.substring(0, 50)}"`);
      });
    }

    console.log('\n=== PAGE STRUCTURE ===\n');
    console.log(`Total HTML length: ${response.data.length}`);
    console.log(`Page contains "jobTitle": ${response.data.includes('jobTitle')}`);
    console.log(`Page contains "data-job-id": ${response.data.includes('data-job-id')}`);
    
  } catch (error: any) {
    console.error('Error:', error.message);
  }
}

debugIndeed();
