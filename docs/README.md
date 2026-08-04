# HelloFresh Account Dashboard

A static dashboard for comparing weekly HelloFresh account costs. It runs entirely in the browser and can be hosted directly on GitHub Pages without a backend, database, or build step.

## What it tracks

- Account email and browser/profile assignment
- Box price, shipping, discount type, discount value, and wallet/refund credit
- Promo and credit expiry dates
- Weeks inactive, useful for watching potential return offers
- Final price, price per meal, cheapest account, priority score, and pause recommendations
- Priority bonuses for expiring promos, expiring credits, referral notes, 4+ inactive weeks, and the cheapest account

Data is saved in your browser with `localStorage`. Use **Export JSON** to keep a backup or move the data to another browser.

## Run locally

Open `index.html` in a browser.

## Host on GitHub Pages

1. Push this `hellofresh-dashboard` folder to a GitHub repository.
2. In GitHub, open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select your branch, then choose `/hellofresh-dashboard` as the folder if GitHub offers it.
5. If GitHub only offers `/root` or `/docs`, move these files into a `docs` folder and select `/docs`.

The dashboard is static, so GitHub Pages is enough.

## Privacy note

Do not commit your real account emails, saved JSON exports, or personal pricing details to a public repository. Keep real data in your browser or in a private repository.
