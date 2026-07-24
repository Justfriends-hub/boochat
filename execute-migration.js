#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

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
const migrationSql = fs.readFileSync(migrationPath, 'utf-8').replace(/\n/g, '\\n').replace(/"/g, '\\"');

console.log('🚀 Installing postgres client...');

try {
  // Install postgres client temporarily
  execSync('npm install --save-dev postgres', { stdio: 'inherit' });
} catch (e) {
  console.log('Note: postgres client installation attempted');
}

console.log('');
console.log('✅ Migration ready. Attempting to execute...');
console.log('');

// Create a temporary script to execute the migration
const execScript = `
const postgres = require('postgres');
const fs = require('fs');

const projectRef = '${projectRef}';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Construct the PostgreSQL connection string
const host = 'db.' + projectRef + '.supabase.co';
const connString = 'postgresql://postgres:' + serviceRoleKey + '@' + host + ':5432/postgres';

console.log('Connecting to Supabase PostgreSQL...');

const sql = postgres(connString, { 
  ssl: 'require',
  max: 1 
});

(async () => {
  try {
    const migration = fs.readFileSync('./migrations/2026-07-24_add_status_privacy.sql', 'utf-8');
    
    // Execute the migration SQL
    const result = await sql.unsafe(migration);
    
    console.log('✅ Migration applied successfully');
    await sql.end();
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration error:', err.message);
    await sql.end();
    process.exit(1);
  }
})();
`;

fs.writeFileSync(path.join(__dirname, '.migration-exec.js'), execScript);

try {
  execSync('node .migration-exec.js', { 
    stdio: 'inherit',
    env: { ...process.env, SUPABASE_SERVICE_ROLE_KEY }
  });
  fs.unlinkSync(path.join(__dirname, '.migration-exec.js'));
  console.log('✅ Migration complete');
} catch (err) {
  console.error('❌ Execution failed:', err.message);
  fs.unlinkSync(path.join(__dirname, '.migration-exec.js'));
  process.exit(1);
}
