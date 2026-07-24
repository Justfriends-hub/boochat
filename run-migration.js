import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars required');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

const sql = readFileSync('./migrations/2026-07-24_add_status_privacy.sql', 'utf-8');

(async () => {
  try {
    const { data, error } = await supabase.rpc('exec_sql', { sql });
    if (error) {
      console.error('Migration error:', error);
      process.exit(1);
    }
    console.log('Migration applied successfully');
  } catch (err) {
    // Supabase doesn't have a built-in exec_sql RPC, so try direct query instead
    console.log('Attempting direct SQL execution...');
    // For now, just read and display the migration file
    console.log('Migration SQL:\n', sql);
    console.log('\nNote: Please run this SQL manually in Supabase SQL Editor or via CLI');
  }
})();
