# Pandora dashboard — static HTML with server-side login on Vercel

This version is for a **plain static HTML/CSS/JavaScript repository**, not Next.js. It does not use Next.js middleware. The dashboard and login page are stored in `private/`, outside Vercel's public static-file root; every page request is rewritten to a Vercel Node.js function, which serves the dashboard only after validating a signed, expiring HttpOnly session cookie.

## Install in your GitHub repository

1. Back up your repository or create a branch first.
2. Copy the contents of this folder into your repository root. Do **not** leave another public `index.html`, duplicate dashboard file, or public copy of the dashboard at the root or in `public/`; public static files can bypass the function. The protected dashboard must live only at `private/index.html`.
3. Confirm your Vercel project uses the repository root as its Root Directory and supports Node.js Serverless Functions.
4. In Vercel → Project → Settings → Environment Variables, add these for Production (and Preview only if you want preview deployments protected too):
   - `PANDORA_USERNAME`: your chosen username
   - `PANDORA_PASSWORD`: a strong, unique password
   - `PANDORA_AUTH_SECRET`: random secret of at least 32 characters
5. Generate the secret on Windows PowerShell:
   `[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))`
   Or macOS/Linux: `openssl rand -base64 48`
6. Save the variables and redeploy. Environment variable changes do not alter an existing deployment until it is redeployed.
7. Test in an incognito/private window: `/` must redirect to `/login.html`; wrong credentials must fail; correct credentials must display the dashboard; opening `/index.html` directly must also require login. Check that the dashboard HTML is not reachable from any other public file URL.

## Important security notes

- Never commit the username, password, or auth secret to GitHub, and do not send them in chat.
- `api/login.js` compares credentials server-side and issues an eight-hour signed cookie with `HttpOnly`, `Secure`, and `SameSite=Lax` attributes. The dashboard-serving function independently verifies that cookie on each request.
- Vercel's rewrite sends requests through the function. If you later add files/assets to the dashboard, update `api/site.js` to serve each required asset deliberately and only after authentication. Do not put sensitive files in a public directory.
- This starter does not implement account recovery, logout, persistent account storage, or distributed rate limiting. Add Vercel Firewall/rate limiting to `/api/login` where available, and use a long unique password. For stronger production-grade identity and brute-force protection, use a dedicated authentication provider or Vercel Deployment Protection.
- The supplied Excel source files are not included or modified.
