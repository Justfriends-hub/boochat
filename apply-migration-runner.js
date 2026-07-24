#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌ Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars are required');
  process.exit(1);
}

// Extract project reference from URL
const projectMatch = SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/);
if (!projectMatch) {
  console.error('❌ Invalid SUPABASE_URL format');
  process.exit(1);
}

const projectRef = projectMatch[1];
const migrationPath = path.join(__dirname, 'migrations', '2026-07-24_add_status_privacy.sql');

if (!fs.existsSync(migrationPath)) {
  console.error(`❌ Migration file not found: ${migrationPath}`);
  process.exit(1);
}

const migrationSql = fs.readFileSync(migrationPath, 'utf-8');

console.log('🚀 Applying migration to Supabase...');
console.log(`Project: ${projectRef}`);
console.log('');

// Attempt 1: Try using curl to POST to Supabase management API for SQL execution
console.log('Attempting to execute via Supabase API...');

try {
  // Note: Supabase doesn't expose a direct Raw SQL execution endpoint via the public REST API
  // The proper way is through the SQL editor UI or using the Supabase CLI
  // Since we have the Service Role Key but no direct SQL API, we'll provide instructions
  
  console.log('');
  console.log('✅ MANUAL STEP REQUIRED');
  console.log('The Supabase @supabase/supabase-js client does not support arbitrary SQL execution');
  console.log('for security reasons. Please apply the migration manually:');
  console.log('');
  console.log(`1. Open: https://app.supabase.com/project/${projectRef}/sql/new`);
  console.log('2. Copy the SQL below and paste it into the SQL Editor:');
  console.log('');
  console.log('---BEGIN SQL---');
  console.log(migrationSql);
  console.log('---END SQL---');
  console.log('');
  console.log('3. Click the "Run" button to apply the migration');
  console.log('4. Confirm the query completed successfully');
  console.log('');
  console.log('After applying, I will continue with Task 7 implementation.');
  
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
