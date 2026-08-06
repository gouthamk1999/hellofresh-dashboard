# HelloFresh Account Dashboard

A static dashboard for comparing weekly HelloFresh account costs. It runs entirely in the browser and can be hosted directly on GitHub Pages without a backend, database, or build step.

## What it tracks

- Account display name, such as A, B, C, or D
- Week price, shipping, and account credit balance
- New account yes/no flag, which removes shipping from week 1 when set to Yes
- Free Dessert yes/no flag for each account
- One offer expiry date for the full 4-week cycle
- Four configurable discount amounts, either euros or percentages, one for each week in the cycle
- Combined discount and done controls for each week
- Calculated final price for each of the 4 weeks
- Next available week, average price per meal, best account, priority score, and account status
- Subscribe/unsubscribe account status. Resubscribing resets the account offer values for a new 4-week cycle

Shipping is added to each week before discounts and credit are applied. When New account is set to **Yes**, shipping is ignored for week 1 only.

When discount type is **%**, the percentage discount is calculated from the week price only; shipping is still added in full.

Credit balance is applied to the first available week. If credit remains, it is applied to the next available weeks in order. Weeks marked done are skipped. Accounts are compared by the next available week in serial order, not by a cheaper later week.

When Free Dessert is set to **Yes**, the cheapest-week display shows a dessert marker.

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

Do not commit saved JSON exports or personal pricing details to a public repository. Keep real data in your browser or in a private repository.
