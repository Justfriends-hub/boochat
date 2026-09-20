# PARTNER SYSTEM LAUNCH — MANUAL STEPS (40-MIN DEADLINE)

**Status**: Core code is ready. You need to manually:

## PHASE 1: Database Setup (5 mins)

### Step 1: Apply the migration
1. Go to Supabase SQL Editor
2. Copy+paste the entire contents of: `migrations/2026-09-19_add_partner_system.sql`
3. Click **Run**
4. Verify: All 4 tables created (`partner_sources`, `external_identities`, `partner_auth_nonces`, `partner_webhook_outbox`)

---

## PHASE 2: Environment Variables (2 mins)

### Required env vars for your Vercel deployment:
```
SUPABASE_URL=<your supabase URL>
SUPABASE_SERVICE_ROLE_KEY=<your service role key - KEEP SECRET>
VITE_API_URL=<your vercel domain, e.g. https://boochat-prod.vercel.app>
```

**Where to set them:**
- Vercel Dashboard → Project Settings → Environment Variables
- Paste all three, deploy

---

## PHASE 3: Seed the "Money mate 9ja" Partner (3 mins)

### Step 3a: Find/Create the Money mate 9ja superadmin user in Boochat

In Supabase SQL Editor, run:
```sql
-- Find or create the superadmin
SELECT id, email FROM auth.users WHERE email = 'admin@moneymate9ja.com' LIMIT 1;
```

If no result, create the user:
```sql
INSERT INTO auth.users (email, email_confirmed_at, encrypted_password, phone_confirmed_at)
VALUES ('admin@moneymate9ja.com', NOW(), '<hash>', NULL)
RETURNING id;
```
*Get the returned UUID for the next step.*

If a user exists with email 'admin@moneymate9ja.com', note their UUID.

### Step 3b: Ensure profile exists
```sql
INSERT INTO public.profiles (id, email, display_name, avatar_url, online, banned)
VALUES ('<superadmin-uuid>', 'admin@moneymate9ja.com', 'Money mate Admin', NULL, false, false)
ON CONFLICT (id) DO NOTHING;
```

### Step 3c: Create the channel
```sql
INSERT INTO public.channels (id, name, description, owner_id, visibility, created_at, updated_at)
VALUES (
  gen_random_uuid(),  -- This will be your partner channel_id, SAVE IT
  'Money mate 9ja',
  'Official Money mate 9ja channel',
  '<superadmin-uuid>',
  'public',
  NOW(),
  NOW()
) RETURNING id;
```
**SAVE the returned `id`** — this is your `channel_id` for the partner row.

### Step 3d: Add superadmin to channel as admin
```sql
INSERT INTO public.channel_members (channel_id, user_id, is_admin, joined_at)
VALUES ('<channel-id-from-3c>', '<superadmin-uuid>', true, NOW());
```

### Step 3e: Create the partner_sources row
In Supabase SQL Editor, run:
```sql
INSERT INTO public.partner_sources (
  id,
  slug,
  name,
  channel_id,
  shared_secret,
  webhook_url,
  webhook_secret,
  allowed_origins,
  active
) VALUES (
  gen_random_uuid(),
  'moneymate9ja',
  'Money mate 9ja',
  '<channel-id-from-3c>',
  'your-super-secret-hs256-key-min-32-chars!!!!',  -- CHANGE THIS to a real secret
  'https://moneymate9ja.com/api/partner/webhook',  -- Replace with Hex United URL later
  'your-webhook-secret-min-32-chars!!!!!',         -- CHANGE THIS
  ARRAY[]::text[],
  true
) RETURNING id, slug, shared_secret, webhook_secret;
```

**SAVE the returned values** — those are your secrets to share with Money mate 9ja.

---

## PHASE 4: Test the Sign-In Flow (Local, 10 mins)

### Step 4a: Generate a test partner token

Use Node.js or your terminal:
```bash
node -e "
const crypto = require('crypto');
const secret = 'your-super-secret-hs256-key-min-32-chars!!!!';  // From Phase 3e
const now = Math.floor(Date.now() / 1000);
const payload = {
  partner: 'moneymate9ja',
  ext_user_id: 'test-user-123',
  email: 'test@moneymate9ja.com',
  name: 'Test User',
  iat: now,
  exp: now + 300,
  nonce: crypto.randomBytes(16).toString('hex')
};

const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
const sig = crypto.createHmac('sha256', secret).update(header + '.' + payloadB64).digest('base64url');
console.log(header + '.' + payloadB64 + '.' + sig);
"
```

This prints a JWT token. Save it as `TEST_TOKEN`.

### Step 4b: Test locally
1. Start your app: `npm run dev` (or `bun run dev`)
2. Navigate to: `http://localhost:5173/auth/login?partner=moneymate9ja&token=TEST_TOKEN`
3. You should see:
   - Title changes to "Join via Partner"
   - One big button: "Continue with moneymate9ja"
4. Click the button
5. **Expected**:
   - Loading state
   - If endpoint is NOT deployed (you haven't pushed to Vercel), you'll get a 404 (endpoint lives on Vercel, not localhost)
   - That's OK—the code is ready

### Step 4c: Deploy to Vercel
```bash
git add .
git commit -m "feat: partner sign-in system"
git push
```

Wait for Vercel to deploy (~2 mins).

### Step 4d: Test in production
1. Go to: `https://<your-boochat-vercel-url>/auth/login?partner=moneymate9ja&token=TEST_TOKEN`
2. Click "Continue with moneymate9ja"
3. **Expected outcome**:
   - ✅ You're signed in (see the channel automatically)
   - OR ❌ Error toast if API key mismatch or server error

If error, check:
- Vercel env vars are set
- DB migration was applied
- Partner secret matches in both places

---

## PHASE 5: Partner Integration (Hand to Money mate 9ja dev, 5 mins)

### What to give them:

**Link format for their mailbox "Join" button:**
```
https://boochat.vercel.app/auth/login?partner=moneymate9ja&token=<JWT>
```

**They need to generate the JWT with:**
- Payload struct: `{ partner, ext_user_id, email, name, iat, exp, nonce }`
- Algorithm: HS256
- Secret: `<shared_secret from Phase 3e>`
- Endpoint to call: `https://boochat.vercel.app/api/partner/auth` (POST, JSON body: `{ partner, token }`)

**Code snippet for them:**
```javascript
// Node.js example to generate the link
const crypto = require('crypto');

function generatePartnerLink(externalUserId, email, name, sharedSecret) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    partner: 'moneymate9ja',
    ext_user_id: externalUserId,
    email,
    name,
    iat: now,
    exp: now + 300,  // Valid for 5 minutes
    nonce: crypto.randomBytes(16).toString('hex')
  };

  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', sharedSecret)
    .update(header + '.' + payloadB64)
    .digest('base64url');

  const token = header + '.' + payloadB64 + '.' + sig;
  return `https://boochat.vercel.app/auth/login?partner=moneymate9ja&token=${encodeURIComponent(token)}`;
}

// Usage
const link = generatePartnerLink(
  'user-123',
  'user@example.com',
  'User Name',
  'your-super-secret-hs256-key-min-32-chars!!!!'
);
console.log(link);
```

---

## PHASE 6: What's NOT yet (defer or manual later)

❌ **Webhook worker** (partner_webhook_outbox → partner mailbox)
  - DB tables ready
  - Endpoint not yet built
  - Needs cron/scheduler on Vercel or Supabase

❌ **Admin DM feature** (send personal messages to channel members)
  - DB schema ready
  - API endpoint needed
  - Webhook trigger for it

❌ **Full history guarantee** (RLS double-check)
  - Verified: RLS allows authenticated users to see all channel posts
  - No join_at gating needed ✅

---

## FINAL CHECKLIST (Before deadline)

- [ ] Migration applied to Supabase
- [ ] Env vars set on Vercel + deployed
- [ ] Money mate 9ja superadmin user exists (UUID noted)
- [ ] Channel created with correct owner (UUID noted)
- [ ] partner_sources row created with secrets (secrets saved)
- [ ] Local test: ✅ button appears, code compiles
- [ ] Production test: ✅ you can sign in with test token
- [ ] Secrets shared securely with Money mate 9ja dev
- [ ] Integration code snippet provided to partner

---

## TROUBLESHOOTING (Quick fixes)

### "Partner not found"error
- Check: Does `partner_sources` row exist with slug `moneymate9ja`?
- Check: Is `active = true`?

### "Invalid or expired token"
- Check: Is secret exactly the same in both places?
- Check: Is token less than 5 mins old?

### "Token already redeemed"
- Each token can only be used once (nonce protection)
- Generate a new token for the next test

### Endpoint 404 on localhost
- ✅ Normal—endpoint lives on Vercel only
- Push + wait for deploy to test

---

**You're 95% done. Just execute the SQL and share secrets. Go! ✅**
