#!/usr/bin/env node
import postgres from 'postgres';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL;
const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;

if (!SUPABASE_URL || !DB_PASSWORD) {
  console.error('❌ SUPABASE_URL and SUPABASE_DB_PASSWORD required');
  process.exit(1);
}

const projectMatch = SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/);
if (!projectMatch) {
  console.error('❌ Invalid SUPABASE_URL');
  process.exit(1);
}

const projectRef = projectMatch[1];
const host = `db.${projectRef}.supabase.co`;

console.log('🚀 Applying migration to Supabase...');
console.log(`   Host: ${host}`);
console.log('');

const connString = `postgresql://postgres:${DB_PASSWORD}@${host}:5432/postgres?sslmode=require`;

const sql = postgres(connString, { 
  ssl: 'require',
  max: 1,
  idle_timeout: 10
});

(async () => {
  try {
    console.log('Connecting to database...');
    
    // Test connection
    const result = await sql`SELECT version()`;
    console.log('✅ Connected');
    console.log('');
    
    // Read migration file
    const migrationPath = path.join(__dirname, 'migrations', '2026-07-24_add_status_privacy.sql');
    const migrationSql = fs.readFileSync(migrationPath, 'utf-8');
    
    console.log('Executing migration...');
    
    // Split statements and execute
    const statements = migrationSql
      .split(';')
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('--'));
    
    for (const statement of statements) {
      if (statement) {
        await sql.unsafe(statement);
      }
    }
    
    console.log('✅ Migration applied successfully');
    console.log('');
    
    await sql.end();
    process.exit(0);
    
  } catch (err) {
    console.error('❌ Error:', err.message);
    try {
      await sql.end();
    } catch (e) {}
    process.exit(1);
  }
})();
