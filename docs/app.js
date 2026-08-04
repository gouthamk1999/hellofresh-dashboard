const storageKey = "hellofresh-dashboard-state-v2";
const legacyStorageKey = "hellofresh-dashboard-state-v1";

const sampleAccounts = [
  createAccount({
    name: "A",
    boxPrice: 55,
    shipping: 8.49,
    currentCycle: 1,
    cycleDiscounts: [50, 40, 20, 0],
    creditBalance: 9.57,
    promoExpiry: "2026-08-15",
    creditExpiry: "2026-08-15",
    notes: "Refund credit"
  }),
  createAccount({
    name: "B",
    boxPrice: 55,
    shipping: 8.49,
    currentCycle: 1,
    cycleDiscounts: [35, 25, 15, 0],
    promoExpiry: "2026-08-30",
    weeksInactive: 1,
    notes: "New customer offer"
  }),
  createAccount({
    name: "C",
    boxPrice: 55,
    shipping: 8.49,
    currentCycle: 1,
    cycleDiscounts: [40, 30, 20, 10],
    creditBalance: 15,
    promoExpiry: "2026-08-10",
    creditExpiry: "2026-08-10",
    notes: "Referral credits"
  }),
  createAccount({
    name: "D",
    boxPrice: 55,
    shipping: 8.49,
    currentCycle: 1,
    cycleDiscounts: [0, 0, 0, 0],
    creditBalance: 5,
    weeksInactive: 4,
    isActive: false,
    notes: "Watch for reactivation offer"
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
  const savedState = localStorage.getItem(storageKey) || localStorage.getItem(legacyStorageKey);

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
      accounts: Array.isArray(parsedState.accounts) ? parsedState.accounts.map(normalizeAccount) : sampleAccounts
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
    .sort((left, right) => Number(right.account.isActive) - Number(left.account.isActive) || left.metrics.finalPrice - right.metrics.finalPrice);

  rowsElement.replaceChildren();

  rankedAccounts.forEach(({ account, metrics }, index) => {
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    const isCheapest = account.isActive && index === 0;
    const displayedPriority = account.isActive ? metrics.priorityScore + (isCheapest ? 10 : 0) : "-";

    row.dataset.id = account.id;
    row.classList.toggle("is-winner", isCheapest);
    row.classList.toggle("is-deactivated", !account.isActive);

    row.querySelectorAll("[data-field]").forEach((field) => {
      const key = field.dataset.field;
      field.value = account[key] ?? "";
      field.addEventListener("change", () => updateAccount(account.id, key, field.value));
    });

    row.querySelectorAll("[data-cycle-index]").forEach((field) => {
      const cycleIndex = Number(field.dataset.cycleIndex);
      field.value = account.cycleDiscounts[cycleIndex] ?? 0;
      field.addEventListener("change", () => updateCycleDiscount(account.id, cycleIndex, field.value));
    });

    const toggleButton = row.querySelector('[data-action="toggle-active"]');
    toggleButton.textContent = account.isActive ? "Deactivate" : "Reactivate";
    toggleButton.setAttribute("aria-label", account.isActive ? "Mark account as deactivated" : "Reactivate account");
    toggleButton.addEventListener("click", () => toggleAccountActive(account.id));

    row.querySelector('[data-action="delete"]').addEventListener("click", () => deleteAccount(account.id));
    row.querySelector('[data-output="finalPrice"]').textContent = formatMoney(metrics.finalPrice);
    row.querySelector('[data-output="pricePerMeal"]').textContent = formatMoney(metrics.pricePerMeal);
    row.querySelector('[data-output="priorityScore"]').textContent = displayedPriority;

    const statusElement = row.querySelector('[data-output="status"]');
    statusElement.textContent = getStatusLabel(account, metrics, isCheapest);
    statusElement.className = `status-pill ${getStatusClass(account, metrics, isCheapest)}`;

    rowsElement.append(row);
  });

  renderSummary(rankedAccounts);
  renderActions(rankedAccounts);
}

function calculateMetrics(account) {
  const boxPrice = toNumber(account.boxPrice, 0);
  const shipping = toNumber(account.shipping, 0);
  const creditBalance = toNumber(account.creditBalance, 0);
  const discount = getDiscountAmount(account, boxPrice);
  const finalPrice = Math.max(0, boxPrice + shipping - discount - creditBalance);
  const pricePerMeal = finalPrice / Math.max(1, state.mealCount);
  const promoDays = daysUntil(account.promoExpiry);
  const creditDays = daysUntil(account.creditExpiry);
  const promoExpiring = promoDays !== null && promoDays <= state.expiryWindowDays;
  const creditExpiring = creditDays !== null && creditDays <= state.expiryWindowDays;
  const referralAvailable = /referral/i.test(account.notes || "");
  const reactivationWatch = toNumber(account.weeksInactive, 0) >= 4;

  let priorityScore = 0;
  if (promoExpiring) priorityScore += 100;
  if (creditExpiring && creditBalance > 0) priorityScore += 50;
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
  const cycleIndex = Math.min(3, Math.max(0, toNumber(account.currentCycle, 1) - 1));
  const discountPercent = toNumber(account.cycleDiscounts[cycleIndex], 0);
  return Math.min(boxPrice, boxPrice * (discountPercent / 100));
}

function renderSummary(rankedAccounts) {
  const activeAccounts = rankedAccounts.filter(({ account }) => account.isActive);
  const best = activeAccounts[0];
  const worst = activeAccounts[activeAccounts.length - 1];

  document.querySelector("#bestAccount").textContent = best ? getAccountLabel(best.account) : "-";
  document.querySelector("#lowestPrice").textContent = best ? formatMoney(best.metrics.finalPrice) : "-";
  document.querySelector("#bestMealPrice").textContent = best ? formatMoney(best.metrics.pricePerMeal) : "-";
  document.querySelector("#savingAmount").textContent = best && worst
    ? formatMoney(Math.max(0, worst.metrics.finalPrice - best.metrics.finalPrice))
    : "-";
}

function renderActions(rankedAccounts) {
  const actionList = document.querySelector("#actionList");
  const activeAccounts = rankedAccounts.filter(({ account }) => account.isActive);
  const deactivatedAccounts = rankedAccounts.filter(({ account }) => !account.isActive);
  const best = activeAccounts[0];
  const actions = [];

  if (best) {
    actions.push(`Order from ${getAccountLabel(best.account)} this week: ${formatMoney(best.metrics.finalPrice)} total.`);
  }

  activeAccounts.slice(1).forEach(({ account }) => {
    actions.push(`Pause ${getAccountLabel(account)} for this week.`);
  });

  deactivatedAccounts.forEach(({ account }) => {
    actions.push(`${getAccountLabel(account)} is deactivated.`);
  });

  activeAccounts
    .filter(({ metrics }) => metrics.promoExpiring || metrics.creditExpiring || metrics.reactivationWatch)
    .forEach(({ account, metrics }) => {
      if (metrics.promoExpiring) actions.push(`${getAccountLabel(account)} has a promo expiring soon.`);
      if (metrics.creditExpiring) actions.push(`${getAccountLabel(account)} has credit expiring soon.`);
      if (metrics.reactivationWatch) actions.push(`${getAccountLabel(account)} has been inactive for 4+ weeks; check for a return offer.`);
    });

  actionList.replaceChildren(...actions.map((action) => {
    const item = document.createElement("li");
    item.textContent = action;
    return item;
  }));
}

function getStatusLabel(account, metrics, isCheapest) {
  if (!account.isActive) return "Deactivated";
  if (isCheapest) return "Cheapest";
  if (metrics.promoExpiring) return "Expiring soon";
  if (metrics.creditExpiring) return "Credit watch";
  return "Pause this week";
}

function getStatusClass(account, metrics, isCheapest) {
  if (!account.isActive) return "status-deactivated";
  if (isCheapest) return "status-order";
  if (metrics.promoExpiring) return "status-expiring";
  if (metrics.creditExpiring) return "status-credit";
  return "status-pause";
}

function updateAccount(id, key, value) {
  const account = state.accounts.find((item) => item.id === id);
  if (!account) return;

  account[key] = ["boxPrice", "shipping", "creditBalance", "weeksInactive", "currentCycle"].includes(key)
    ? toNumber(value, 0)
    : value;
  saveAndRender();
}

function updateCycleDiscount(id, cycleIndex, value) {
  const account = state.accounts.find((item) => item.id === id);
  if (!account) return;

  account.cycleDiscounts[cycleIndex] = Math.min(100, Math.max(0, toNumber(value, 0)));
  saveAndRender();
}

function toggleAccountActive(id) {
  const account = state.accounts.find((item) => item.id === id);
  if (!account) return;

  account.isActive = !account.isActive;
  if (!account.isActive) account.weeksInactive = Math.max(1, toNumber(account.weeksInactive, 0));
  saveAndRender();
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
  state.accounts = sampleAccounts.map((account) => createAccount({ ...account, id: crypto.randomUUID(), cycleDiscounts: [...account.cycleDiscounts] }));
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
    name: "",
    boxPrice: 0,
    shipping: 0,
    currentCycle: 1,
    cycleDiscounts: [0, 0, 0, 0],
    creditBalance: 0,
    promoExpiry: "",
    creditExpiry: "",
    weeksInactive: 0,
    isActive: true,
    notes: "",
    ...overrides
  };
}

function normalizeAccount(account, index) {
  const fallbackDiscount = account.discountType === "percent" ? toNumber(account.discountValue, 0) : 0;
  const cycleDiscounts = Array.isArray(account.cycleDiscounts)
    ? account.cycleDiscounts.slice(0, 4).map((value) => toNumber(value, 0))
    : [fallbackDiscount, 0, 0, 0];

  while (cycleDiscounts.length < 4) cycleDiscounts.push(0);

  return createAccount({
    id: account.id || crypto.randomUUID(),
    name: account.name || String.fromCharCode(65 + index),
    boxPrice: toNumber(account.boxPrice, 0),
    shipping: toNumber(account.shipping, 0),
    currentCycle: Math.min(4, Math.max(1, toNumber(account.currentCycle, 1))),
    cycleDiscounts,
    creditBalance: toNumber(account.creditBalance ?? account.walletCredit, 0),
    promoExpiry: account.promoExpiry || "",
    creditExpiry: account.creditExpiry || "",
    weeksInactive: toNumber(account.weeksInactive, 0),
    isActive: account.isActive !== false,
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

function getAccountLabel(account) {
  return account.name || "Unnamed account";
}

function nextAccountName() {
  return String.fromCharCode(65 + state.accounts.length);
}

function formatMoney(value) {
  return `${state.currency}${Number(value).toFixed(2)}`;
}

function toNumber(value, fallback) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}
