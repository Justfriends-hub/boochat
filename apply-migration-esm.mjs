#!/usr/bin/env node
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  process.exit(1);
}

const projectMatch = SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/);
if (!projectMatch) {
  console.error('❌ Invalid SUPABASE_URL');
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
console.log(`   Project: ${projectRef}`);
console.log('');

// Supabase PostgreSQL connection string
// Default port: 5432, default user: postgres
// Note: The SERVICE_ROLE_KEY is for API auth; database auth needs the actual DB password
// For now, we'll attempt with a standard connection approach

try {
  // Try to connect and execute
  const host = `db.${projectRef}.supabase.co`;
  const connString = `postgresql://postgres@${host}:5432/postgres`;
  
  console.log(`Connecting to: ${host}...`);
  console.log('');
  
  // Since we don't have the database password, we can't connect directly via pg
  console.log('⚠️  Direct database access requires the Postgres password.');
  console.log('');
  console.log('Alternative approaches:');
  console.log('');
  console.log('1️⃣  Apply via SQL Editor (Recommended):');
  console.log(`    Open: https://app.supabase.com/project/${projectRef}/sql/new`);
  console.log('    Copy and paste the migration SQL below, then click Run');
  console.log('');
  console.log('2️⃣  Apply via Supabase CLI (if installed):');
  console.log(`    supabase db pull`);
  console.log(`    supabase db push`);
  console.log('');
  console.log('---BEGIN MIGRATION SQL---');
  console.log(migrationSql);
  console.log('---END MIGRATION SQL---');
  console.log('');
  console.log('After applying the migration manually, continue with: npm run build');
  
} catch (err) {
  console.error('❌ Error:', err.message);
  process.exit(1);
}
