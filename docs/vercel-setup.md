# Hosting TERRA on Vercel (free Hobby plan)

The Website workflow (`.github/workflows/site.yml`) builds the site every 2
hours and uploads the finished files to Vercel in the `deploy-vercel` job.
Vercel never builds on push, so the Hobby build limit is not used up.
Vercel Hobby is free and meant for non-commercial use; TERRA is free for
everyone, so it fits. Do not upgrade to Pro (it costs money).

## One-time steps (Rod)

1. **Create the project.** Sign up at https://vercel.com on the free Hobby
   plan. Don't import the GitHub repo (that turns push builds back on).
   Instead, on your computer open a terminal in any empty folder and run
   `npx vercel@latest link`, sign in, pick "Link to a new project", name it
   `terra`. Open the new `.vercel/project.json` file: it holds `orgId` and
   `projectId`.
2. **Make a token.** https://vercel.com/account/tokens > **Create**, scope
   your account, no expiry (or a long one). Copy it once.
3. **Add it to GitHub.** Repo > Settings > Secrets and variables > Actions:
   - Secrets tab: `VERCEL_TOKEN` = the token.
   - Variables tab: `VERCEL_ORG_ID` = `orgId`, `VERCEL_PROJECT_ID` = `projectId`.
4. **Run it.** Actions > Website > Run workflow. The `deploy-vercel` job
   prints the live URL (for example `https://terra-xyz.vercel.app`).
5. **Supabase sign-in.** Supabase dashboard > Authentication > URL
   Configuration:
   - Site URL: your Vercel URL.
   - Redirect URLs > Add URL: `https://<your-vercel-url>/**`. Keep the
     github.io one until Pages is off.
6. **Turn Pages off** (only after the Vercel site works and sign-in emails
   land on it): Settings > Pages > Unpublish site, then remove the `deploy`
   job from site.yml.
