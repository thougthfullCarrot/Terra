# Google Sheets: setup

One Google Sheet, four tabs, all filled in by the Website workflow every two
hours:

| Tab | What it is | Who edits it |
| --- | --- | --- |
| **Firms** | The companies the site checks for jobs. Add a row to add a company, delete a row (or set **Active** to `no`) to drop one. The workflow writes **Last check** beside each row: how many jobs it found, or why it failed. **Sector** set to `Homebuilder` files a company's jobs under Homebuilder. | You |
| **Jobs** | Every job on the site right now. | The workflow (rewritten each run) |
| **Market** | The Market data table. | The workflow (rewritten each run) |
| **Sign-ups** | One row per account: joined date, email, access (college, subscriber, not paid), school, grad year, major, last sign-in. No resumes, pictures or profile text. | The workflow (rewritten each run) |

Everything here is free: a Google account, a Google Cloud project with no
billing account, and the Sheets API. Accounts, resumes and payments stay in
Supabase; the sheet only gets copies.

If the sheet ever can't be read (sharing removed, key deleted, tab emptied),
the site keeps running on the built-in firm list in
`backend/supabase/migrations/0002_seed_firms.sql`.

**Keep the sheet private.** Don't use "Anyone with the link": with accounts
on, the Jobs tab is the members-only feed, and Sign-ups has people's emails.

About 10 minutes.

## 1. Make the sheet

1. Go to <https://sheets.new> (signed in to your Google account). A blank sheet opens.
2. Click **Untitled spreadsheet** at the top left and name it `Terra`.
3. Copy the address from the browser bar. It looks like
   `https://docs.google.com/spreadsheets/d/1AbC.../edit`. Keep it for step 3.

Leave it empty; the first run creates the tabs and fills **Firms** with the
current list.

## 2. Make a robot account that can edit it

1. Go to <https://console.cloud.google.com/projectcreate>. Project name `terra`,
   click **Create**. If it asks for a billing account, skip it; none is needed.
2. Go to <https://console.cloud.google.com/apis/library/sheets.googleapis.com>,
   check the project picker at the top says `terra`, click **Enable**.
3. Go to <https://console.cloud.google.com/iam-admin/serviceaccounts/create>.
   Service account name `terra-sheets`, click **Create and continue**, then
   **Done** (skip the role and access steps).
4. In the list, click the new account's email (it ends in
   `iam.gserviceaccount.com`) and copy that email.
5. Open the **Keys** tab > **Add key** > **Create new key** > **JSON** > **Create**.
   A `.json` file downloads. Treat it like a password.
6. Back in your sheet, click **Share**, paste the robot's email, set it to
   **Editor**, untick **Notify people**, click **Share**.

If Google says "Service account key creation is disabled", your Google
account is under an organization (a school account, for example) that blocks
keys. Use a personal Gmail account for steps 1 and 2 instead.

## 3. Give the keys to GitHub

In the repository, **Settings** > **Secrets and variables** > **Actions**:

1. **Secrets** tab > **New repository secret**. Name
   `GOOGLE_SERVICE_ACCOUNT_JSON`. Open the downloaded `.json` file in a text
   editor, copy everything in it, paste it as the value, click **Add secret**.
2. **Variables** tab > **New repository variable**. Name `TERRA_SHEET_ID`,
   value the sheet address from step 1 (the whole URL is fine). Click **Add variable**.

You can delete the downloaded `.json` file once it's saved in GitHub.

## 4. Check it

**Actions** > **Website** > **Run workflow** > **Run workflow**. When it
finishes (green tick), the sheet has all four tabs. **Sign-ups** only fills
once accounts are on (see `accounts-setup.md`).

## Adding a company

Add a row to **Firms**:

| Column | What to put |
| --- | --- |
| Firm | The company's name, as it appears on its job board. |
| Board type | `greenhouse`, `lever`, `workday`, `icims` or `workable`. It's in the careers page's address: `boards.greenhouse.io/...`, `jobs.lever.co/...`, `....myworkdayjobs.com/...`, `....icims.com/...`, `apply.workable.com/...`. |
| Board id | The part of that address that names the company: for `boards.greenhouse.io/lincoln` it's `lincoln`. For Workday it's `<first word of the host>/<site name>`: `jll.wd1.myworkdayjobs.com/en-US/jllcareers` is `jll/jllcareers`. For Workable it's the word after `apply.workable.com/`: `perryhomes`. |
| Workday host | Workday only (optional for iCIMS): the host, e.g. `jll.wd1.myworkdayjobs.com`. |
| Active | Blank or `yes` to check it, `no` to pause it. |
| Sector | Optional. `Homebuilder` (or any sector the site lists) files every job from this company under it. Blank lets the job title decide. |

The next run (at most two hours) checks it and writes the result in **Last
check**. "Failed ... 404" usually means a wrong board id.
