const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars required');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false }
});

const migrationSql = fs.readFileSync('./migrations/2026-07-24_add_status_privacy.sql', 'utf-8');

// Split SQL by statements and execute each one
const statements = migrationSql
  .split(';')
  .map(s => s.trim())
  .filter(s => s.length > 0 && !s.startsWith('--'));

(async () => {
  try {
    console.log('Executing migration...');
    
    // Try to execute via Supabase RPC or direct query
    // Since we can't execute arbitrary SQL directly via PostgREST,
    // we'll attempt the migration by calling out to a helper
    const { data, error } = await supabase
      .from('statuses')
      .select('id')
      .limit(1);
    
    if (error) {
      console.error('Connection test failed:', error);
      process.exit(1);
    }
    
    console.log('✓ Database connection successful');
    console.log('');
    console.log('Note: Direct SQL execution not available via Supabase JS client.');
    console.log('Please apply the migration manually:');
    console.log('1. Open: https://app.supabase.com/project/xhdptrlzkibwlrvlyhae/sql/new');
    console.log('2. Copy and paste the SQL from migrations/2026-07-24_add_status_privacy.sql');
    console.log('3. Click Run');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
})();
