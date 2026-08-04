const storageKey = "hellofresh-dashboard-state-v1";

const sampleAccounts = [
  {
    id: crypto.randomUUID(),
    email: "account-a@example.com",
    browserProfile: "Chrome - HelloFresh A",
    boxPrice: 55,
    shipping: 8.49,
    discountType: "percent",
    discountValue: 50,
    walletCredit: 9.57,
    promoExpiry: "2026-08-15",
    creditExpiry: "2026-08-15",
    weeksInactive: 0,
    notes: "Refund credit"
  },
  {
    id: crypto.randomUUID(),
    email: "account-b@example.com",
    browserProfile: "Edge - HelloFresh B",
    boxPrice: 55,
    shipping: 8.49,
    discountType: "fixed",
    discountValue: 20,
    walletCredit: 0,
    promoExpiry: "2026-08-30",
    creditExpiry: "",
    weeksInactive: 1,
    notes: "New customer offer"
  },
  {
    id: crypto.randomUUID(),
    email: "account-c@example.com",
    browserProfile: "Firefox - HelloFresh C",
    boxPrice: 55,
    shipping: 8.49,
    discountType: "percent",
    discountValue: 40,
    walletCredit: 15,
    promoExpiry: "2026-08-10",
    creditExpiry: "2026-08-10",
    weeksInactive: 0,
    notes: "Referral credits"
  },
  {
    id: crypto.randomUUID(),
    email: "account-d@example.com",
    browserProfile: "Chrome - HelloFresh D",
    boxPrice: 55,
    shipping: 8.49,
    discountType: "none",
    discountValue: 0,
    walletCredit: 5,
    promoExpiry: "",
    creditExpiry: "",
    weeksInactive: 4,
    notes: "Watch for reactivation offer"
  }
];

const state = loadState();

const rowsElement = document.querySelector("#accountRows");
const rowTemplate = document.querySelector("#accountRowTemplate");
const currencyInput = document.querySelector("#currencyInput");
const mealCountInput = document.querySelector("#mealCountInput");
const expiryWindowInput = document.querySelector("#expiryWindowInput");

currencyInput.value = state.currency;
mealCountInput.value = state.mealCount;
expiryWindowInput.value = state.expiryWindowDays;

document.querySelector("#addAccountButton").addEventListener("click", addAccount);
document.querySelector("#resetButton").addEventListener("click", resetData);
document.querySelector("#exportButton").addEventListener("click", exportData);
document.querySelector("#importInput").addEventListener("change", importData);

[currencyInput, mealCountInput, expiryWindowInput].forEach((input) => {
  input.addEventListener("input", () => {
    state.currency = currencyInput.value || "€";
    state.mealCount = toNumber(mealCountInput.value, 1);
    state.expiryWindowDays = toNumber(expiryWindowInput.value, 7);
    saveAndRender();
  });
});

render();

function loadState() {
  const savedState = localStorage.getItem(storageKey);

  if (!savedState) {
    return {
      currency: "€",
      mealCount: 6,
      expiryWindowDays: 7,
      accounts: sampleAccounts
    };
  }

  try {
    const parsedState = JSON.parse(savedState);

    return {
      currency: parsedState.currency || "€",
      mealCount: toNumber(parsedState.mealCount, 6),
      expiryWindowDays: toNumber(parsedState.expiryWindowDays, 7),
      accounts: Array.isArray(parsedState.accounts) ? parsedState.accounts : sampleAccounts
    };
  } catch {
    return {
      currency: "€",
      mealCount: 6,
      expiryWindowDays: 7,
      accounts: sampleAccounts
    };
  }
}

function saveAndRender() {
  localStorage.setItem(storageKey, JSON.stringify(state));
  render();
}

function render() {
  const rankedAccounts = state.accounts
    .map((account) => ({ account, metrics: calculateMetrics(account) }))
    .sort((left, right) => left.metrics.finalPrice - right.metrics.finalPrice);

  rowsElement.replaceChildren();

  rankedAccounts.forEach(({ account, metrics }, index) => {
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    const displayedPriority = metrics.priorityScore + (index === 0 ? 10 : 0);
    row.dataset.id = account.id;
    row.classList.toggle("is-winner", index === 0);

    row.querySelectorAll("[data-field]").forEach((field) => {
      const key = field.dataset.field;
      field.value = account[key] ?? "";
      field.addEventListener("change", () => updateAccount(account.id, key, field.value));
    });

    row.querySelector('[data-action="delete"]').addEventListener("click", () => deleteAccount(account.id));
    row.querySelector('[data-output="finalPrice"]').textContent = formatMoney(metrics.finalPrice);
    row.querySelector('[data-output="pricePerMeal"]').textContent = formatMoney(metrics.pricePerMeal);
    row.querySelector('[data-output="priorityScore"]').textContent = displayedPriority;

    const statusElement = row.querySelector('[data-output="status"]');
    statusElement.textContent = getStatusLabel(metrics, index);
    statusElement.className = `status-pill ${getStatusClass(metrics, index)}`;

    rowsElement.append(row);
  });

  renderSummary(rankedAccounts);
  renderActions(rankedAccounts);
}

function calculateMetrics(account) {
  const boxPrice = toNumber(account.boxPrice, 0);
  const shipping = toNumber(account.shipping, 0);
  const walletCredit = toNumber(account.walletCredit, 0);
  const discount = getDiscountAmount(account, boxPrice);
  const finalPrice = Math.max(0, boxPrice + shipping - discount - walletCredit);
  const pricePerMeal = finalPrice / Math.max(1, state.mealCount);
  const promoDays = daysUntil(account.promoExpiry);
  const creditDays = daysUntil(account.creditExpiry);
  const promoExpiring = promoDays !== null && promoDays <= state.expiryWindowDays;
  const creditExpiring = creditDays !== null && creditDays <= state.expiryWindowDays;
  const referralAvailable = /referral/i.test(account.notes || "");
  const reactivationWatch = toNumber(account.weeksInactive, 0) >= 4;

  let priorityScore = 0;
  if (promoExpiring) priorityScore += 100;
  if (creditExpiring && walletCredit > 0) priorityScore += 50;
  if (referralAvailable) priorityScore += 20;
  if (reactivationWatch) priorityScore += 15;

  return {
    discount,
    finalPrice,
    pricePerMeal,
    promoExpiring,
    creditExpiring,
    reactivationWatch,
    priorityScore
  };
}

function getDiscountAmount(account, boxPrice) {
  const discountValue = toNumber(account.discountValue, 0);

  if (account.discountType === "percent") {
    return Math.min(boxPrice, boxPrice * (discountValue / 100));
  }

  if (account.discountType === "fixed") {
    return Math.min(boxPrice, discountValue);
  }

  return 0;
}

function renderSummary(rankedAccounts) {
  const best = rankedAccounts[0];
  const worst = rankedAccounts[rankedAccounts.length - 1];

  document.querySelector("#bestAccount").textContent = best ? best.account.email || "Unnamed account" : "-";
  document.querySelector("#lowestPrice").textContent = best ? formatMoney(best.metrics.finalPrice) : "-";
  document.querySelector("#bestMealPrice").textContent = best ? formatMoney(best.metrics.pricePerMeal) : "-";
  document.querySelector("#savingAmount").textContent = best && worst
    ? formatMoney(Math.max(0, worst.metrics.finalPrice - best.metrics.finalPrice))
    : "-";
}

function renderActions(rankedAccounts) {
  const actionList = document.querySelector("#actionList");
  const best = rankedAccounts[0];
  const actions = [];

  if (best) {
    actions.push(`Order from ${best.account.email || "the cheapest account"} this week: ${formatMoney(best.metrics.finalPrice)} total.`);
  }

  rankedAccounts.slice(1).forEach(({ account }) => {
    actions.push(`Pause ${account.email || "another account"} for this week.`);
  });

  rankedAccounts
    .filter(({ metrics }) => metrics.promoExpiring || metrics.creditExpiring || metrics.reactivationWatch)
    .forEach(({ account, metrics }) => {
      if (metrics.promoExpiring) actions.push(`${account.email} has a promo expiring soon.`);
      if (metrics.creditExpiring) actions.push(`${account.email} has credit expiring soon.`);
      if (metrics.reactivationWatch) actions.push(`${account.email} has been inactive for 4+ weeks; check for a return offer.`);
    });

  actionList.replaceChildren(...actions.map((action) => {
    const item = document.createElement("li");
    item.textContent = action;
    return item;
  }));
}

function getStatusLabel(metrics, index) {
  if (index === 0) return "Cheapest";
  if (metrics.promoExpiring) return "Expiring soon";
  if (metrics.creditExpiring) return "Credit watch";
  return "Pause this week";
}

function getStatusClass(metrics, index) {
  if (index === 0) return "status-order";
  if (metrics.promoExpiring) return "status-expiring";
  if (metrics.creditExpiring) return "status-credit";
  return "status-pause";
}

function updateAccount(id, key, value) {
  const account = state.accounts.find((item) => item.id === id);
  if (!account) return;

  account[key] = ["boxPrice", "shipping", "discountValue", "walletCredit", "weeksInactive"].includes(key)
    ? toNumber(value, 0)
    : value;
  saveAndRender();
}

function addAccount() {
  state.accounts.push({
    id: crypto.randomUUID(),
    email: "",
    browserProfile: "",
    boxPrice: 0,
    shipping: 0,
    discountType: "none",
    discountValue: 0,
    walletCredit: 0,
    promoExpiry: "",
    creditExpiry: "",
    weeksInactive: 0,
    notes: ""
  });
  saveAndRender();
}

function deleteAccount(id) {
  state.accounts = state.accounts.filter((account) => account.id !== id);
  saveAndRender();
}

function resetData() {
  state.currency = "€";
  state.mealCount = 6;
  state.expiryWindowDays = 7;
  state.accounts = sampleAccounts.map((account) => ({ ...account, id: crypto.randomUUID() }));
  currencyInput.value = state.currency;
  mealCountInput.value = state.mealCount;
  expiryWindowInput.value = state.expiryWindowDays;
  saveAndRender();
}

function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "hellofresh-dashboard-data.json";
  link.click();
  URL.revokeObjectURL(url);
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const importedState = JSON.parse(reader.result);
      state.currency = importedState.currency || "€";
      state.mealCount = toNumber(importedState.mealCount, 6);
      state.expiryWindowDays = toNumber(importedState.expiryWindowDays, 7);
      state.accounts = Array.isArray(importedState.accounts) ? importedState.accounts : state.accounts;
      currencyInput.value = state.currency;
      mealCountInput.value = state.mealCount;
      expiryWindowInput.value = state.expiryWindowDays;
      saveAndRender();
    } catch {
      alert("That file does not look like dashboard JSON.");
    }
  });
  reader.readAsText(file);
  event.target.value = "";
}

function daysUntil(dateValue) {
  if (!dateValue) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateValue}T00:00:00`);

  if (Number.isNaN(target.getTime())) return null;
  return Math.ceil((target - today) / 86400000);
}

function formatMoney(value) {
  return `${state.currency}${Number(value).toFixed(2)}`;
}

function toNumber(value, fallback) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}
