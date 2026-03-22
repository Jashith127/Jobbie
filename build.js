#!/usr/bin/env node

// Ensure DATABASE_URL is set for Prisma during build
const fs = require('fs');
const path = require('path');

// Check if .env exists, if not create it with default DATABASE_URL
const envPath = path.join(process.cwd(), '.env');
if (!fs.existsSync(envPath)) {
  const defaultEnv = `DATABASE_URL="file:./prisma/dev.db"\n`;
  fs.writeFileSync(envPath, defaultEnv);
  console.log('✓ Created .env with default DATABASE_URL for build');
}

// Check env var too
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'file:./prisma/dev.db';
  console.log('✓ Set DATABASE_URL environment variable for build');
}

// Run prisma generate
const { execSync } = require('child_process');
try {
  execSync('npx prisma generate', { stdio: 'inherit' });
  console.log('✓ Prisma schema generated');
} catch (error) {
  console.error('✗ Failed to generate Prisma schema:', error.message);
  process.exit(1);
}

// Run prisma migrations to create/update database
try {
  execSync('npx prisma migrate deploy', { stdio: 'inherit' });
  console.log('✓ Prisma migrations applied');
} catch (error) {
  console.warn('⚠ Warning: Prisma migrations failed (may be normal on first build)');
  console.warn('  Error:', error.message);
  // Don't exit on migration failure - database might be created with next step
}

// Run next build
try {
  execSync('npx next build', { stdio: 'inherit' });
  console.log('✓ Next.js build completed');
} catch (error) {
  console.error('✗ Failed to build Next.js:', error.message);
  process.exit(1);
}
