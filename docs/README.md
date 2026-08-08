# HelloFresh Account Dashboard

A static dashboard for comparing weekly HelloFresh account costs. It runs entirely in the browser and can be hosted directly on GitHub Pages without a backend, database, or build step.

## What it tracks

- Account display name, such as A, B, C, or D
- Box price, delivery fee, and account credit balance
- New account checkbox, which removes the delivery fee from week 1 when checked
- Free Dessert checkbox for each account
- One offer expiry date for the full 4-week cycle
- Four configurable discount amounts, either euros or percentages, one for each week in the cycle
- Combined discount and done controls for each week
- Calculated final price for each of the 4 weeks
- Next available week, average price per meal, best account, baseline savings, cycle savings, and account status
- Subscribe/unsubscribe account status. Resubscribing resets the account offer values for a new 4-week cycle
- Smart recommendation banner that explains the best next action or account to use
- Manual account ordering with drag-and-drop row handles
- Optional Supabase account sign-in for permanent cloud storage

Delivery fee is added to each week before discounts and credit are applied. When New account is checked, the delivery fee is ignored for week 1 only.

When discount type is **%**, the percentage discount is calculated from the box price only; the delivery fee is still added in full.

Credit balance is applied to the first available week. If credit remains, it is applied to the next available weeks in order. Weeks marked done are skipped. Accounts are compared by the next available week in serial order, not by a cheaper later week.

When Free Dessert is checked, the cheapest-week display shows a dessert marker.

Data is saved in your browser with `localStorage`. When you sign in with Supabase, the same dashboard state is also saved to your account for permanent storage. If another device changes the cloud dashboard while this browser has local edits, the dashboard asks whether to keep the local version or load the cloud version instead of silently overwriting either copy. Use **Export JSON** to keep a manual backup or move the data without signing in.

Use **Baseline box price** to compare the best available account against a normal full-price box. The dashboard shows the saving for the next box and the remaining 4-week cycle. The cloud status indicator shows whether Supabase sync is local-only, saving, saved, or failed.

## Run locally

Open `index.html` in a browser.

## Set up Supabase storage

1. Create a Supabase project at <https://supabase.com>.
2. In Supabase, open **SQL Editor** and run the SQL in `supabase-schema.sql`.
3. Open **Project Settings → API** and copy the project URL and public anon key.
4. In `app.js`, replace `YOUR_PROJECT_REF` and `YOUR_SUPABASE_ANON_KEY` in `supabaseConfig`.
5. Open the dashboard, create an account, then sign in. Your dashboard JSON is saved to the `dashboards` table for that user.

Only use the public anon key in this static app. Never paste the Supabase service role key into browser code.

## Host on GitHub Pages

1. Push this `hellofresh-dashboard` folder to a GitHub repository.
2. In GitHub, open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select your branch, then choose `/hellofresh-dashboard` as the folder if GitHub offers it.
5. If GitHub only offers `/root` or `/docs`, move these files into a `docs` folder and select `/docs`.

The dashboard is static, so GitHub Pages is enough.

## Privacy note

Do not commit saved JSON exports or personal pricing details to a public repository. Keep real data in your browser or in a private repository.