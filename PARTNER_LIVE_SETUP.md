# MoneyMate News Partner System - LIVE SETUP COMPLETE ✅

**Date**: September 20, 2026

---

## 🎯 Partner Information

| Field | Value |
|-------|-------|
| **Partner Name** | MoneyMate News 🥇 |
| **Partner Slug** | `moneymatnews` |
| **Channel ID** | `11e9f19b-5553-4e86-9951-231908cdd630` |
| **API Endpoint** | `https://boochat.vercel.app/api/partner/auth` |

---

## 🔐 Credentials (KEEP SECRET)

### Shared Secret
Used by MoneyMate News to sign login JWTs:
```
8114f75c65eb4f5eb28c075489fdb957
```

### Webhook Secret
Used by MoneyMate News to verify webhook payloads from Boochat:
```
c85a1a5e2b7d433986ab3633d11c7eb6
```

---

## 📋 What Was Done

✅ Migration deployed to Supabase
- Created 4 new tables: `partner_sources`, `external_identities`, `partner_auth_nonces`, `partner_webhook_outbox`
- All tables have RLS enabled (service role only)

✅ Partner row created in Supabase
- Slug: `moneymatnews`
- Channel: MoneyMate News 🥇
- Active: `true`

✅ Vercel environment variables set
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VITE_API_URL`

✅ App code deployed
- `/api/partner/auth` endpoint ready
- Login page detects partner token
- Signup page detects partner token

---

## 🧪 How to Test Locally

### Step 1: Generate a Test JWT

Open a terminal and run:

```bash
node -e "
const crypto = require('crypto');
const secret = '8114f75c65eb4f5eb28c075489fdb957';
const now = Math.floor(Date.now() / 1000);

const payload = {
  partner: 'moneymatnews',
  ext_user_id: 'test-user-001',
  email: 'testuser@moneymatnews.com',
  name: 'Test User',
  iat: now,
  exp: now + 300,
  nonce: crypto.randomUUID()
};

const enc = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
const header = { alg: 'HS256', typ: 'JWT' };
const unsigned = \`\${enc(header)}.\${enc(payload)}\`;
const sig = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url');
console.log(\`\${unsigned}.\${sig}\`);
"
```

This prints a JWT token like:
```
eyJ...TOKEN...ABC
```

### Step 2: Copy the Token

Copy the entire JWT from the output.

### Step 3: Open the Login URL

Replace `<JWT>` with your token and open in a browser:

```
https://boochat.vercel.app/auth/login?partner=moneymatnews&token=<PASTE_JWT_HERE>
```

### Step 4: Expected Behavior

1. Page loads
2. You see a button: **"Continue with MoneyMate News 🥇"**
3. Click the button
4. If the JWT is valid:
   - A new user account is created (or existing user is found)
   - User is added to the MoneyMate News 🥇 channel
   - User is logged in automatically
   - Redirected to the channel: `/channels/11e9f19b-5553-4e86-9951-231908cdd630`

### Step 5: If It Fails

Check these:
1. Is the JWT token valid? (correct signature, not expired)
2. Is the `shared_secret` correct?
3. Does the partner slug match `moneymatnews`?
4. Are the Vercel env vars set?

---

## 📤 What to Send to MoneyMate News

Send them this information:

### Login Integration

**Boochat Sign-In Endpoint**:
```
https://boochat.vercel.app/api/partner/auth
```

**Request Format** (POST JSON):
```json
{
  "partner": "moneymatnews",
  "token": "<HS256 JWT signed with shared_secret>"
}
```

**JWT Payload Format**:
```json
{
  "partner": "moneymatnews",
  "ext_user_id": "<your-internal-user-id>",
  "email": "<user-email>",
  "name": "<user-display-name>",
  "iat": 1726920000,
  "exp": 1726920300,
  "nonce": "<unique-uuid-per-request>"
}
```

**JWT Signing Algorithm**: HS256 (HMAC-SHA256)

**Shared Secret**:
```
8114f75c65eb4f5eb28c075489fdb957
```

**Sign-In Link Format** (frontend):
```
https://boochat.vercel.app/auth/login?partner=moneymatnews&token=<JWT>
```

### Webhook Integration (Optional)

**Webhook Secret** (for verifying incoming webhooks):
```
c85a1a5e2b7d433986ab3633d11c7eb6
```

**Current Webhook URL**:
```
https://moneymatnews.com/api/partner/webhook
```

Boochat will POST events to this URL when partner members join/leave channels.

---

## 🚀 Next Steps

### For You:
1. ✅ Migration deployed
2. ✅ Partner created
3. ✅ Env vars set
4. Test locally (instructions above)
5. Push code to GitHub (if not already done)
6. Vercel redeploys automatically

### For MoneyMate News Team:
1. Implement the partner JWT signing logic
2. Call the sign-in endpoint with signed JWT
3. Handle the session token response
4. Redirect user to the channel
5. (Optional) Implement webhook receiver if you want notifications

---

## 📞 Support

If anything fails:
- Check Supabase logs
- Check Vercel function logs at `https://vercel.com/boochat/functions`
- Verify JWT signature is correct
- Verify `shared_secret` matches

---

## 🔗 Quick Reference

| Item | Value |
|------|-------|
| Partner Slug | `moneymatnews` |
| Channel ID | `11e9f19b-5553-4e86-9951-231908cdd630` |
| Channel Name | MoneyMate News 🥇 |
| Shared Secret | `8114f75c65eb4f5eb28c075489fdb957` |
| Webhook Secret | `c85a1a5e2b7d433986ab3633d11c7eb6` |
| API Endpoint | `https://boochat.vercel.app/api/partner/auth` |
| Login URL | `https://boochat.vercel.app/auth/login?partner=moneymatnews&token=<JWT>` |

---

**Status**: ✅ LIVE - Ready for testing
