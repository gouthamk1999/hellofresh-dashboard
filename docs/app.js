const storageKey = "hellofresh-dashboard-state-v3";
const legacyStorageKeys = ["hellofresh-dashboard-state-v2", "hellofresh-dashboard-state-v1"];
const boxCount = 4;

const sampleAccounts = [
  createAccount({
    name: "A",
    boxPrice: 55,
    shipping: 8.49,
    creditBalance: 9.57,
    freeDessert: true,
    offerExpiry: "2026-08-15",
    cycleDiscounts: [27.5, 22, 11, 0],
    notes: "Refund credit"
  }),
  createAccount({
    name: "B",
    boxPrice: 55,
    shipping: 8.49,
    offerExpiry: "2026-08-30",
    freeDessert: false,
    cycleDiscounts: [20, 15, 10, 0],
    notes: "New account offer"
  }),
  createAccount({
    name: "C",
    boxPrice: 55,
    shipping: 8.49,
    creditBalance: 15,
    freeDessert: true,
    offerExpiry: "2026-08-10",
    cycleDiscounts: [22, 16.5, 11, 5.5],
    notes: "Referral credits"
  }),
  createAccount({
    name: "D",
    boxPrice: 55,
    shipping: 8.49,
    creditBalance: 5,
    freeDessert: false,
    isSubscribed: false,
    unsubscribedAt: "2026-08-04",
    notes: "Ready for next offer"
  })
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
  const savedState = localStorage.getItem(storageKey) || legacyStorageKeys.map((key) => localStorage.getItem(key)).find(Boolean);

  if (!savedState) {
    return createState(sampleAccounts);
  }

  try {
    const parsedState = JSON.parse(savedState);
    return createState(Array.isArray(parsedState.accounts) ? parsedState.accounts.map(normalizeAccount) : sampleAccounts, parsedState);
  } catch {
    return createState(sampleAccounts);
  }
}

function createState(accounts, overrides = {}) {
  return {
    version: 3,
    currency: overrides.currency || "€",
    mealCount: toNumber(overrides.mealCount, 6),
    expiryWindowDays: toNumber(overrides.expiryWindowDays, 7),
    accounts
  };
}

function saveAndRender() {
  localStorage.setItem(storageKey, JSON.stringify(state));
  render();
}

function render() {
  const accountEntries = state.accounts.map((account) => ({ account, metrics: calculateMetrics(account) }));
  const rankedAccounts = [...accountEntries]
    .sort((left, right) => Number(right.metrics.isAvailable) - Number(left.metrics.isAvailable) || left.metrics.cheapestWeekPrice - right.metrics.cheapestWeekPrice);
  const bestSubscribedId = rankedAccounts.find(({ metrics }) => metrics.isAvailable)?.account.id;

  rowsElement.replaceChildren();

  accountEntries.forEach(({ account, metrics }) => {
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    const isBestSubscribed = account.isSubscribed && account.id === bestSubscribedId;
    const displayedPriority = account.isSubscribed ? metrics.priorityScore + (isBestSubscribed ? 10 : 0) : "-";

    row.dataset.id = account.id;
    row.classList.toggle("is-winner", isBestSubscribed);
    row.classList.toggle("is-unsubscribed", !account.isSubscribed);

    row.querySelectorAll("[data-field]").forEach((field) => {
      const key = field.dataset.field;
      field.value = key === "freeDessert" ? String(Boolean(account[key])) : account[key] ?? "";
      field.addEventListener("change", () => updateAccount(account.id, key, field.value));
    });

    row.querySelector(".cycle-controls").replaceChildren(...account.cycleDiscounts.map((discountValue, cycleIndex) => createWeekControl(account, discountValue, cycleIndex)));

    row.querySelector('[data-output="cycleFinals"]').replaceChildren(...metrics.cycleFinalPrices.map((price, cycleIndex) => {
      const item = document.createElement("span");
      item.textContent = `Week ${cycleIndex + 1}: ${formatMoney(price)}`;
      item.classList.toggle("is-cycle-done", account.completedCycles[cycleIndex]);
      return item;
    }));

    const toggleButton = row.querySelector('[data-action="toggle-subscription"]');
    toggleButton.textContent = account.isSubscribed ? "Unsubscribe" : "Resubscribe";
    toggleButton.setAttribute("aria-label", account.isSubscribed ? "Unsubscribe account" : "Resubscribe and reset account values");
    toggleButton.addEventListener("click", () => toggleSubscription(account.id));

    row.querySelector('[data-action="delete"]').addEventListener("click", () => deleteAccount(account.id));
    row.querySelector('[data-output="cheapestWeek"]').textContent = withDessert(metrics.cheapestWeekLabel, account);
    row.querySelector('[data-output="averageMealPrice"]').textContent = formatMoney(metrics.averageMealPrice);
    row.querySelector('[data-output="priorityScore"]').textContent = displayedPriority;

    const statusElement = row.querySelector('[data-output="status"]');
    statusElement.textContent = getStatusLabel(account, metrics, isBestSubscribed);
    statusElement.className = `status-pill ${getStatusClass(account, metrics, isBestSubscribed)}`;

    rowsElement.append(row);
  });

  renderSummary(rankedAccounts);
  renderActions(rankedAccounts);
}

function calculateMetrics(account) {
  const grossCyclePrice = toNumber(account.boxPrice, 0) + toNumber(account.shipping, 0);
  let remainingCredit = toNumber(account.creditBalance, 0);

  const cycleFinalPrices = account.cycleDiscounts.map((discountValue, cycleIndex) => {
    const discountedPrice = Math.max(0, grossCyclePrice - Math.max(0, toNumber(discountValue, 0)));
    if (account.completedCycles[cycleIndex]) {
      return discountedPrice;
    }

    const creditApplied = Math.min(discountedPrice, remainingCredit);
    remainingCredit -= creditApplied;
    const finalPrice = Math.max(0, discountedPrice - creditApplied);
    return finalPrice;
  });

  const remainingPrices = cycleFinalPrices.filter((_, cycleIndex) => !account.completedCycles[cycleIndex]);
  const remainingBoxCount = remainingPrices.length;
  const totalPrice = remainingPrices.reduce((total, price) => total + price, 0);
  const cheapestWeekPrice = remainingPrices.length > 0 ? Math.min(...remainingPrices) : Number.POSITIVE_INFINITY;
  const cheapestWeekIndex = cycleFinalPrices.findIndex((price, cycleIndex) => !account.completedCycles[cycleIndex] && price === cheapestWeekPrice);
  const averageMealPrice = Number.isFinite(cheapestWeekPrice) ? cheapestWeekPrice / Math.max(1, state.mealCount) : 0;
  const expiryDays = daysUntil(account.offerExpiry);
  const offerExpiring = expiryDays !== null && expiryDays <= state.expiryWindowDays;
  const isAvailable = account.isSubscribed && remainingBoxCount > 0;

  let priorityScore = 0;
  if (offerExpiring) priorityScore += 100;
  if (toNumber(account.creditBalance, 0) > 0) priorityScore += 30;
  if (!isAvailable) priorityScore = 0;

  return {
    cycleFinalPrices,
    remainingBoxCount,
    totalPrice,
    cheapestWeekPrice,
    cheapestWeekLabel: Number.isFinite(cheapestWeekPrice) ? `Week ${cheapestWeekIndex + 1}: ${formatMoney(cheapestWeekPrice)}` : "-",
    averageMealPrice,
    isAvailable,
    offerExpiring,
    priorityScore
  };
}

function renderSummary(rankedAccounts) {
  const subscribedAccounts = rankedAccounts.filter(({ metrics }) => metrics.isAvailable);
  const best = subscribedAccounts[0];
  const worst = subscribedAccounts[subscribedAccounts.length - 1];

  document.querySelector("#bestAccount").textContent = best ? getAccountLabel(best.account) : "-";
  document.querySelector("#lowestPrice").textContent = best ? withDessert(best.metrics.cheapestWeekLabel, best.account) : "-";
  document.querySelector("#bestMealPrice").textContent = best ? formatMoney(best.metrics.averageMealPrice) : "-";
  document.querySelector("#savingAmount").textContent = best && worst
    ? formatMoney(Math.max(0, worst.metrics.cheapestWeekPrice - best.metrics.cheapestWeekPrice))
    : "-";
}

function renderActions(rankedAccounts) {
  const actionList = document.querySelector("#actionList");
  const subscribedAccounts = rankedAccounts.filter(({ metrics }) => metrics.isAvailable);
  const unsubscribedAccounts = rankedAccounts.filter(({ account }) => !account.isSubscribed);
  const completedAccounts = rankedAccounts.filter(({ account, metrics }) => account.isSubscribed && metrics.remainingBoxCount === 0);
  const best = subscribedAccounts[0];
  const actions = [];

  if (best) {
    actions.push(`${getAccountLabel(best.account)} has the cheapest remaining week: ${withDessert(best.metrics.cheapestWeekLabel, best.account)}.`);
  }

  subscribedAccounts
    .filter(({ metrics }) => metrics.offerExpiring)
    .forEach(({ account }) => actions.push(`${getAccountLabel(account)} offer expires soon.`));

  unsubscribedAccounts.forEach(({ account }) => {
    actions.push(`${getAccountLabel(account)} is unsubscribed. Resubscribe when you want to start a fresh 4-week offer.`);
  });

  completedAccounts.forEach(({ account }) => {
    actions.push(`${getAccountLabel(account)} has all 4 weeks marked done. Unsubscribe it when the cycle is finished.`);
  });

  actionList.replaceChildren(...actions.map((action) => {
    const item = document.createElement("li");
    item.textContent = action;
    return item;
  }));
}

function createWeekControl(account, discountValue, cycleIndex) {
  const wrapper = document.createElement("div");
  wrapper.className = "week-control";

  const title = document.createElement("span");
  title.textContent = `Week ${cycleIndex + 1}`;

  const discountInput = document.createElement("input");
  discountInput.type = "text";
  discountInput.inputMode = "decimal";
  discountInput.value = discountValue ?? 0;
  discountInput.setAttribute("aria-label", `Week ${cycleIndex + 1} discount`);
  discountInput.addEventListener("change", () => updateCycleDiscount(account.id, cycleIndex, discountInput.value));

  const doneLabel = document.createElement("label");
  const doneInput = document.createElement("input");
  doneInput.type = "checkbox";
  doneInput.checked = account.completedCycles[cycleIndex];
  doneInput.addEventListener("change", () => updateCycleDone(account.id, cycleIndex, doneInput.checked));
  doneLabel.append(doneInput, " Done");

  wrapper.append(title, discountInput, doneLabel);
  return wrapper;
}

function getStatusLabel(account, metrics, isBestSubscribed) {
  if (!account.isSubscribed) return "Unsubscribed";
  if (metrics.remainingBoxCount === 0) return "Cycle done";
  if (isBestSubscribed) return "Best total";
  if (metrics.offerExpiring) return "Expiring soon";
  return "Subscribed";
}

function getStatusClass(account, metrics, isBestSubscribed) {
  if (!account.isSubscribed) return "status-unsubscribed";
  if (metrics.remainingBoxCount === 0) return "status-unsubscribed";
  if (isBestSubscribed) return "status-order";
  if (metrics.offerExpiring) return "status-expiring";
  return "status-credit";
}

function updateAccount(id, key, value) {
  const account = state.accounts.find((item) => item.id === id);
  if (!account) return;

  account[key] = key === "freeDessert"
    ? value === "true"
    : ["boxPrice", "shipping", "creditBalance"].includes(key)
      ? toNumber(value, 0)
      : value;
  saveAndRender();
}

function updateCycleDiscount(id, cycleIndex, value) {
  const account = state.accounts.find((item) => item.id === id);
  if (!account) return;

  account.cycleDiscounts[cycleIndex] = Math.max(0, toNumber(value, 0));
  saveAndRender();
}

function updateCycleDone(id, cycleIndex, isDone) {
  const account = state.accounts.find((item) => item.id === id);
  if (!account) return;

  account.completedCycles[cycleIndex] = isDone;
  saveAndRender();
}

function toggleSubscription(id) {
  const account = state.accounts.find((item) => item.id === id);
  if (!account) return;

  if (account.isSubscribed) {
    account.isSubscribed = false;
    account.unsubscribedAt = todayIsoDate();
  } else {
    resetOfferValues(account);
    account.isSubscribed = true;
    account.unsubscribedAt = "";
  }

  saveAndRender();
}

function resetOfferValues(account) {
  account.boxPrice = 0;
  account.shipping = 0;
  account.creditBalance = 0;
  account.freeDessert = false;
  account.offerExpiry = "";
  account.cycleDiscounts = [0, 0, 0, 0];
  account.completedCycles = [false, false, false, false];
  account.notes = "";
}

function addAccount() {
  state.accounts.push(createAccount({ name: nextAccountName() }));
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
  state.accounts = sampleAccounts.map((account) => createAccount({ ...account, id: crypto.randomUUID(), cycleDiscounts: [...account.cycleDiscounts], completedCycles: [...account.completedCycles] }));
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
      state.accounts = Array.isArray(importedState.accounts) ? importedState.accounts.map(normalizeAccount) : state.accounts;
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

function createAccount(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    discountMode: "euro",
    name: "",
    boxPrice: 0,
    shipping: 0,
    creditBalance: 0,
    freeDessert: false,
    offerExpiry: "",
    cycleDiscounts: [0, 0, 0, 0],
    completedCycles: [false, false, false, false],
    isSubscribed: true,
    unsubscribedAt: "",
    notes: "",
    ...overrides
  };
}

function normalizeAccount(account, index) {
  const boxPrice = toNumber(account.boxPrice, 0);
  const savedEuroDiscounts = account.discountMode === "euro" && Array.isArray(account.cycleDiscounts)
    ? account.cycleDiscounts.slice(0, boxCount).map((value) => toNumber(value, 0))
    : null;
  const oldPercentageDiscounts = Array.isArray(account.cycleDiscounts)
    ? account.cycleDiscounts.slice(0, boxCount).map((value) => boxPrice * (toNumber(value, 0) / 100))
    : [boxPrice * (toNumber(account.discountValue, 0) / 100), 0, 0, 0];
  const cycleDiscounts = Array.isArray(account.discountAmounts)
    ? account.discountAmounts.slice(0, boxCount).map((value) => toNumber(value, 0))
    : savedEuroDiscounts
      ? savedEuroDiscounts
    : oldPercentageDiscounts;

  while (cycleDiscounts.length < boxCount) cycleDiscounts.push(0);

  const completedCycles = Array.isArray(account.completedCycles)
    ? account.completedCycles.slice(0, boxCount).map(Boolean)
    : [false, false, false, false];

  while (completedCycles.length < boxCount) completedCycles.push(false);

  return createAccount({
    id: account.id || crypto.randomUUID(),
    name: account.name || String.fromCharCode(65 + index),
    boxPrice,
    shipping: toNumber(account.shipping, 0),
    creditBalance: toNumber(account.creditBalance ?? account.walletCredit, 0),
    freeDessert: Boolean(account.freeDessert),
    offerExpiry: account.offerExpiry || account.promoExpiry || "",
    cycleDiscounts,
    completedCycles,
    isSubscribed: account.isSubscribed ?? account.isActive ?? true,
    unsubscribedAt: account.unsubscribedAt || "",
    notes: account.notes || ""
  });
}

function daysUntil(dateValue) {
  if (!dateValue) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateValue}T00:00:00`);

  if (Number.isNaN(target.getTime())) return null;
  return Math.ceil((target - today) / 86400000);
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function getAccountLabel(account) {
  return account.name || "Unnamed account";
}

function withDessert(label, account) {
  return account.freeDessert && label !== "-" ? `${label} 🍰` : label;
}

function nextAccountName() {
  return String.fromCharCode(65 + state.accounts.length);
}

function formatMoney(value) {
  return `${state.currency}${Number(value).toFixed(2)}`;
}

function toNumber(value, fallback) {
  const numberValue = Number(String(value).replace(",", "."));
  return Number.isFinite(numberValue) ? numberValue : fallback;
}
