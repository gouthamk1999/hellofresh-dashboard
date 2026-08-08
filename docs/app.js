const storageKey = "hellofresh-dashboard-state-v3";
const cloudMetaKey = "hellofresh-dashboard-cloud-meta-v1";
const legacyStorageKeys = ["hellofresh-dashboard-state-v2", "hellofresh-dashboard-state-v1"];
const boxCount = 4;
const resubscriptionWaitDays = 28;
const supabaseConfig = {
  url: "https://ceypuldrwvrkdacgibjb.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNleXB1bGRyd3Zya2RhY2dpYmpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYwMTU0MTgsImV4cCI6MjEwMTU5MTQxOH0.AS55ouWsSPCXVMfE8BKVEziZfFOuAHksOz_StmSkKLI"
};
const hasSupabaseConfig = !supabaseConfig.url.includes("YOUR_PROJECT_REF") && !supabaseConfig.anonKey.includes("YOUR_SUPABASE_ANON_KEY");
const supabaseClient = hasSupabaseConfig && globalThis.supabase
  ? globalThis.supabase.createClient(supabaseConfig.url, supabaseConfig.anonKey)
  : null;

let currentUser = null;
let cloudSaveTimer = null;
let isApplyingCloudState = false;
let pendingUnsubscribeAccountId = null;
let lastReadyNotificationKey = "";
let pendingCloudConflict = null;
let draggedAccountId = "";

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
const baselineBoxPriceInput = document.querySelector("#baselineBoxPriceInput");
const authStatus = document.querySelector("#authStatus");
const cloudStatus = document.querySelector("#cloudStatus");
const authEmailInput = document.querySelector("#authEmailInput");
const authPasswordInput = document.querySelector("#authPasswordInput");
const signInButton = document.querySelector("#signInButton");
const signOutButton = document.querySelector("#signOutButton");
const recommendationBanner = document.querySelector("#recommendationBanner");
const unsubscribeDialog = document.querySelector("#unsubscribeDialog");
const unsubscribeForm = document.querySelector("#unsubscribeForm");
const unsubscribeDateInput = document.querySelector("#unsubscribeDateInput");
const unsubscribeDialogAccount = document.querySelector("#unsubscribeDialogAccount");
const cancelUnsubscribeButton = document.querySelector("#cancelUnsubscribeButton");
const cloudConflictDialog = document.querySelector("#cloudConflictDialog");
const useLocalStateButton = document.querySelector("#useLocalStateButton");
const useCloudStateButton = document.querySelector("#useCloudStateButton");

currencyInput.value = state.currency;
mealCountInput.value = state.mealCount;
expiryWindowInput.value = state.expiryWindowDays;
baselineBoxPriceInput.value = state.baselineBoxPrice;

document.querySelector("#addAccountButton").addEventListener("click", addAccount);
document.querySelector("#resetButton").addEventListener("click", resetData);
document.querySelector("#exportButton").addEventListener("click", exportData);
document.querySelector("#importInput").addEventListener("change", importData);
signInButton.addEventListener("click", signIn);
signOutButton.addEventListener("click", signOut);
unsubscribeForm.addEventListener("submit", saveUnsubscribeDate);
cancelUnsubscribeButton.addEventListener("click", () => unsubscribeDialog.close());
useLocalStateButton.addEventListener("click", keepLocalCloudConflict);
useCloudStateButton.addEventListener("click", useCloudConflictState);

[currencyInput, mealCountInput, expiryWindowInput, baselineBoxPriceInput].forEach((input) => {
  input.addEventListener("input", () => {
    state.currency = currencyInput.value || "€";
    state.mealCount = toNumber(mealCountInput.value, 1);
    state.expiryWindowDays = toNumber(expiryWindowInput.value, 7);
    state.baselineBoxPrice = toNumber(baselineBoxPriceInput.value, 0);
    saveAndRender();
  });
});

render();
initAuth();
setInterval(render, 60 * 1000);

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
    baselineBoxPrice: toNumber(overrides.baselineBoxPrice, 0),
    updatedAt: overrides.updatedAt || new Date().toISOString(),
    accounts
  };
}

function saveAndRender() {
  state.updatedAt = new Date().toISOString();
  localStorage.setItem(storageKey, JSON.stringify(state));
  render();
  queueCloudSave();
}

async function initAuth() {
  if (!supabaseClient) {
    setAuthStatus("Add your Supabase URL and anon key in app.js to enable cloud sync.");
    setCloudStatus("Local only", "idle");
    return;
  }

  const { data, error } = await supabaseClient.auth.getSession();
  if (error) {
    setAuthStatus(error.message);
    setCloudStatus("Auth error", "error");
    return;
  }

  currentUser = data.session?.user || null;
  renderAuthState();
  if (currentUser) await loadCloudState();

  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    currentUser = session?.user || null;
    renderAuthState();
    if (currentUser) await loadCloudState();
  });
}

async function signIn() {
  const credentials = getAuthCredentials();
  if (!credentials) return;

  const { error } = await supabaseClient.auth.signInWithPassword(credentials);
  setAuthStatus(error ? error.message : "Signed in. Loading saved dashboard...");
  setCloudStatus(error ? "Sign-in failed" : "Loading...", error ? "error" : "saving");
}

async function signOut() {
  if (!supabaseClient) return;

  const { error } = await supabaseClient.auth.signOut();
  if (error) {
    setAuthStatus(error.message);
    setCloudStatus("Sign-out failed", "error");
  }
}

function getAuthCredentials() {
  if (!supabaseClient) {
    setAuthStatus("Supabase is not configured yet.");
    return null;
  }

  const email = authEmailInput.value.trim();
  const password = authPasswordInput.value;
  if (!email || !password) {
    setAuthStatus("Enter an email and password.");
    return null;
  }

  return { email, password };
}

function renderAuthState() {
  const isSignedIn = Boolean(currentUser);
  authEmailInput.disabled = isSignedIn;
  authPasswordInput.disabled = isSignedIn;
  authEmailInput.hidden = isSignedIn;
  authPasswordInput.hidden = isSignedIn;
  signInButton.hidden = isSignedIn;
  signOutButton.hidden = !isSignedIn;
  setAuthStatus(isSignedIn ? currentUser.email : "Cloud sync");
  setCloudStatus(isSignedIn ? "Saved" : "Local only", "idle");
}

function setAuthStatus(message) {
  authStatus.textContent = message;
}

function setCloudStatus(message, status = "idle") {
  cloudStatus.textContent = message;
  cloudStatus.dataset.status = status;
}

function queueCloudSave() {
  if (!supabaseClient || !currentUser || isApplyingCloudState || pendingCloudConflict) return;

  clearTimeout(cloudSaveTimer);
  setCloudStatus("Saving...", "saving");
  cloudSaveTimer = setTimeout(saveCloudState, 600);
}

async function saveCloudState(force = false) {
  if (!supabaseClient || !currentUser) return;
  if (!force && await detectCloudConflictBeforeSave()) return;

  const updatedAt = new Date().toISOString();
  const { error } = await supabaseClient
    .from("dashboards")
    .upsert({ user_id: currentUser.id, state, updated_at: updatedAt }, { onConflict: "user_id" });

  setAuthStatus(error ? error.message : currentUser.email);
  setCloudStatus(error ? "Save failed" : "Saved", error ? "error" : "saved");
  if (!error) rememberCloudSync(updatedAt, state);
}

async function detectCloudConflictBeforeSave() {
  const syncedMeta = getCurrentCloudMeta();
  if (!syncedMeta) return false;

  const { data, error } = await supabaseClient
    .from("dashboards")
    .select("state, updated_at")
    .eq("user_id", currentUser.id)
    .maybeSingle();

  if (error) {
    setAuthStatus(error.message);
    setCloudStatus("Conflict check failed", "error");
    return true;
  }

  if (!data?.state) return false;

  const normalizedCloudState = createState(Array.isArray(data.state.accounts) ? data.state.accounts.map(normalizeAccount) : sampleAccounts, data.state);
  const cloudUpdatedAt = data.updated_at || "";
  if (!hasCloudConflict(normalizedCloudState, cloudUpdatedAt)) return false;

  pendingCloudConflict = { state: normalizedCloudState, updatedAt: cloudUpdatedAt };
  showCloudConflictDialog();
  return true;
}

async function loadCloudState() {
  if (!supabaseClient || !currentUser) return;

  const { data, error } = await supabaseClient
    .from("dashboards")
    .select("state, updated_at")
    .eq("user_id", currentUser.id)
    .maybeSingle();

  if (error) {
    setAuthStatus(error.message);
    setCloudStatus("Load failed", "error");
    return;
  }

  if (!data?.state) {
    await saveCloudState();
    return;
  }

  const normalizedCloudState = createState(Array.isArray(data.state.accounts) ? data.state.accounts.map(normalizeAccount) : sampleAccounts, data.state);
  const cloudUpdatedAt = data.updated_at || "";
  if (hasCloudConflict(normalizedCloudState, cloudUpdatedAt)) {
    pendingCloudConflict = { state: normalizedCloudState, updatedAt: cloudUpdatedAt };
    showCloudConflictDialog();
    return;
  }

  isApplyingCloudState = true;
  applyState(normalizedCloudState);
  localStorage.setItem(storageKey, JSON.stringify(state));
  render();
  isApplyingCloudState = false;
  rememberCloudSync(cloudUpdatedAt, state);
  setAuthStatus(currentUser.email);
  setCloudStatus("Saved", "saved");
}

function getCloudMeta() {
  try {
    return JSON.parse(localStorage.getItem(cloudMetaKey) || "{}");
  } catch {
    return {};
  }
}

function getCurrentCloudMeta() {
  return currentUser ? getCloudMeta()[currentUser.id] : null;
}

function rememberCloudSync(updatedAt, syncedState) {
  if (!currentUser || !updatedAt) return;
  const meta = getCloudMeta();
  meta[currentUser.id] = {
    updatedAt,
    stateSignature: stateSignature(syncedState)
  };
  localStorage.setItem(cloudMetaKey, JSON.stringify(meta));
}

function hasCloudConflict(cloudState, cloudUpdatedAt) {
  const localSignature = stateSignature(state);
  const cloudSignature = stateSignature(cloudState);
  if (localSignature === cloudSignature) return false;

  const syncedMeta = getCurrentCloudMeta();
  if (!syncedMeta) return Boolean(localStorage.getItem(storageKey));

  const localChanged = localSignature !== syncedMeta.stateSignature;
  const cloudChanged = cloudUpdatedAt !== syncedMeta.updatedAt || cloudSignature !== syncedMeta.stateSignature;
  return localChanged && cloudChanged;
}

async function keepLocalCloudConflict() {
  if (!pendingCloudConflict) return;

  pendingCloudConflict = null;
  closeDialog(cloudConflictDialog);
  setCloudStatus("Saving local...", "saving");
  await saveCloudState(true);
}

function useCloudConflictState() {
  if (!pendingCloudConflict) return;

  const cloudState = pendingCloudConflict.state;
  const cloudUpdatedAt = pendingCloudConflict.updatedAt;
  pendingCloudConflict = null;
  isApplyingCloudState = true;
  applyState(cloudState);
  localStorage.setItem(storageKey, JSON.stringify(state));
  render();
  isApplyingCloudState = false;
  rememberCloudSync(cloudUpdatedAt, state);
  closeDialog(cloudConflictDialog);
  setAuthStatus(currentUser.email);
  setCloudStatus("Cloud loaded", "saved");
}

function closeDialog(dialog) {
  if (dialog.open) {
    dialog.close();
  } else {
    dialog.removeAttribute("open");
  }
}

function showCloudConflictDialog() {
  setCloudStatus("Conflict", "error");
  if (typeof cloudConflictDialog.showModal === "function") {
    cloudConflictDialog.showModal();
  } else {
    cloudConflictDialog.setAttribute("open", "");
  }
}

function stateSignature(nextState) {
  return JSON.stringify({
    version: nextState.version,
    currency: nextState.currency,
    mealCount: nextState.mealCount,
    expiryWindowDays: nextState.expiryWindowDays,
    baselineBoxPrice: nextState.baselineBoxPrice,
    accounts: nextState.accounts
  });
}

function applyState(nextState) {
  const normalizedState = createState(Array.isArray(nextState.accounts) ? nextState.accounts.map(normalizeAccount) : sampleAccounts, nextState);
  state.currency = normalizedState.currency;
  state.mealCount = normalizedState.mealCount;
  state.expiryWindowDays = normalizedState.expiryWindowDays;
  state.baselineBoxPrice = normalizedState.baselineBoxPrice;
  state.updatedAt = normalizedState.updatedAt;
  state.accounts = normalizedState.accounts;
  currencyInput.value = state.currency;
  mealCountInput.value = state.mealCount;
  expiryWindowInput.value = state.expiryWindowDays;
  baselineBoxPriceInput.value = state.baselineBoxPrice;
}

function render() {
  const accountEntries = state.accounts.map((account) => ({ account, metrics: calculateMetrics(account) }));
  const rankedAccounts = [...accountEntries]
    .sort((left, right) => Number(right.metrics.isAvailable) - Number(left.metrics.isAvailable) || left.metrics.nextWeekPrice - right.metrics.nextWeekPrice || Number(right.account.freeDessert) - Number(left.account.freeDessert));
  const bestSubscribedId = rankedAccounts.find(({ metrics }) => metrics.isAvailable)?.account.id;

  rowsElement.replaceChildren();

  accountEntries.forEach(({ account, metrics }) => {
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    const isBestSubscribed = account.isSubscribed && account.id === bestSubscribedId;

    row.dataset.id = account.id;
    row.classList.toggle("is-winner", isBestSubscribed);
    row.classList.toggle("is-unsubscribed", !account.isSubscribed);
    row.classList.toggle("is-ready", isReadyForResubscription(account));
    row.classList.toggle("is-inactive", !account.isSubscribed || metrics.remainingBoxCount === 0);

    row.addEventListener("dragover", allowAccountDrop);
    row.addEventListener("dragleave", (event) => event.currentTarget.classList.remove("is-drop-target"));
    row.addEventListener("drop", (event) => dropAccount(event, account.id));
    row.addEventListener("dragend", endAccountDrag);

    const dragHandle = row.querySelector('[data-action="drag"]');
    dragHandle.addEventListener("dragstart", (event) => startAccountDrag(event, account.id));
    dragHandle.addEventListener("keydown", (event) => moveAccountWithKeyboard(event, account.id));

    row.querySelectorAll("[data-field]").forEach((field) => {
      const key = field.dataset.field;
      if (field.type === "checkbox") {
        field.checked = Boolean(account[key]);
      } else {
        field.value = account[key] ?? "";
      }
      field.disabled = !account.isSubscribed;
      field.addEventListener("change", () => updateAccount(account.id, key, field.type === "checkbox" ? field.checked : field.value));
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
    row.querySelector('[data-output="cheapestWeek"]').textContent = withDessert(metrics.nextWeekLabel, account);
    row.querySelector('[data-output="averageMealPrice"]').textContent = formatMoney(metrics.averageMealPrice);

    const statusElement = row.querySelector('[data-output="status"]');
    statusElement.textContent = getStatusLabel(account, metrics, isBestSubscribed);
    statusElement.className = `status-pill ${getStatusClass(account, metrics, isBestSubscribed)}`;
    row.querySelector('[data-output="resubscribeCountdown"]').textContent = getResubscribeCountdown(account);

    rowsElement.append(row);
  });

  renderRecommendation(rankedAccounts);
  renderSummary(rankedAccounts);
  renderActions(rankedAccounts);
  notifyReadyAccounts();
}

function calculateMetrics(account) {
  const boxPrice = toNumber(account.boxPrice, 0);
  const shipping = toNumber(account.shipping, 0);
  let remainingCredit = toNumber(account.creditBalance, 0);

  const cycleFinalPrices = account.cycleDiscounts.map((discountValue, cycleIndex) => {
    const discount = Math.max(0, toNumber(discountValue, 0));
    const cycleShipping = account.isNewAccount && cycleIndex === 0 ? 0 : shipping;
    const grossCyclePrice = boxPrice + cycleShipping;
    const discountedPrice = account.discountMode === "percent"
      ? Math.max(0, boxPrice - (boxPrice * (discount / 100))) + cycleShipping
      : Math.max(0, grossCyclePrice - discount);
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
  const nextWeekIndex = account.completedCycles.findIndex((isDone) => !isDone);
  const nextWeekPrice = nextWeekIndex >= 0 ? cycleFinalPrices[nextWeekIndex] : Number.POSITIVE_INFINITY;
  const averageMealPrice = Number.isFinite(nextWeekPrice) ? nextWeekPrice / Math.max(1, state.mealCount) : 0;
  const expiryDays = daysUntil(account.offerExpiry);
  const offerExpiring = expiryDays !== null && expiryDays <= state.expiryWindowDays;
  const hasConfiguredPrice = toNumber(account.boxPrice, 0) > 0 || toNumber(account.shipping, 0) > 0;
  const isAvailable = account.isSubscribed && remainingBoxCount > 0 && hasConfiguredPrice;

  let priorityScore = 0;
  if (offerExpiring) priorityScore += 100;
  if (toNumber(account.creditBalance, 0) > 0) priorityScore += 30;
  if (!isAvailable) priorityScore = 0;

  return {
    cycleFinalPrices,
    completedCycles: account.completedCycles,
    remainingBoxCount,
    totalPrice,
    cheapestWeekPrice,
    nextWeekPrice,
    nextWeekLabel: Number.isFinite(nextWeekPrice) ? `Week ${nextWeekIndex + 1}: ${formatMoney(nextWeekPrice)}` : "-",
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
  const baselineBoxPrice = toNumber(state.baselineBoxPrice, 0);
  const baselineSaving = best && baselineBoxPrice > 0 ? Math.max(0, baselineBoxPrice - best.metrics.nextWeekPrice) : null;
  const cycleSaving = baselineBoxPrice > 0
    ? subscribedAccounts.reduce((total, { metrics }) => {
      return total + metrics.cycleFinalPrices.reduce((cycleTotal, price, cycleIndex) => {
        return metrics.completedCycles[cycleIndex] ? cycleTotal : cycleTotal + Math.max(0, baselineBoxPrice - price);
      }, 0);
    }, 0)
    : null;

  document.querySelector("#bestAccount").textContent = best ? getAccountLabel(best.account) : "-";
  document.querySelector("#lowestPrice").textContent = best ? withDessert(best.metrics.nextWeekLabel, best.account) : "-";
  document.querySelector("#bestMealPrice").textContent = best ? formatMoney(best.metrics.averageMealPrice) : "-";
  document.querySelector("#savingAmount").textContent = best && worst
    ? formatMoney(Math.max(0, worst.metrics.nextWeekPrice - best.metrics.nextWeekPrice))
    : "-";
  document.querySelector("#baselineSaving").textContent = baselineSaving === null ? "-" : formatMoney(baselineSaving);
  document.querySelector("#cycleSaving").textContent = cycleSaving === null ? "-" : formatMoney(cycleSaving);
}

function renderRecommendation(rankedAccounts) {
  const availableAccounts = rankedAccounts.filter(({ metrics }) => metrics.isAvailable);
  const readyAccounts = rankedAccounts.filter(({ account }) => isReadyForResubscription(account));
  const expiringAccounts = availableAccounts.filter(({ metrics }) => metrics.offerExpiring);
  const best = availableAccounts[0];

  recommendationBanner.className = "recommendation-banner";

  if (readyAccounts.length > 0) {
    const labels = readyAccounts.map(({ account }) => getAccountLabel(account)).join(", ");
    recommendationBanner.classList.add("recommendation-banner--ready");
    setRecommendationContent(
      "Ready to rotate",
      `${labels} ${readyAccounts.length === 1 ? "is" : "are"} ready to resubscribe.`,
      "The 4-week wait is complete. Resubscribe when you want to start a fresh offer cycle."
    );
    return;
  }

  if (!best) {
    setRecommendationContent(
      "No order recommendation yet",
      "Add prices or resubscribe an account.",
      "The dashboard needs at least one subscribed account with a configured box or delivery price."
    );
    return;
  }

  const reasons = [
    `${withDessert(best.metrics.nextWeekLabel, best.account)} is currently the best next box`,
    `${formatMoney(best.metrics.averageMealPrice)} per meal`
  ];
  if (toNumber(best.account.creditBalance, 0) > 0) reasons.push(`${formatMoney(best.account.creditBalance)} credit available`);
  if (best.account.freeDessert) reasons.push("free dessert included");
  if (best.metrics.offerExpiring) reasons.push("offer expires soon");
  if (expiringAccounts.length > 1) reasons.push(`${expiringAccounts.length} active offers are inside the expiry window`);

  setRecommendationContent(
    "Smart recommendation",
    `Order from ${getAccountLabel(best.account)} next.`,
    `${reasons.join(" · ")}.`
  );
}

function setRecommendationContent(label, title, description) {
  const labelElement = document.createElement("span");
  labelElement.textContent = label;
  const titleElement = document.createElement("strong");
  titleElement.textContent = title;
  const descriptionElement = document.createElement("p");
  descriptionElement.textContent = description;
  recommendationBanner.replaceChildren(labelElement, titleElement, descriptionElement);
}

function renderActions(rankedAccounts) {
  const actionList = document.querySelector("#actionList");
  const subscribedAccounts = rankedAccounts.filter(({ metrics }) => metrics.isAvailable);
  const unsubscribedAccounts = rankedAccounts.filter(({ account }) => !account.isSubscribed);
  const completedAccounts = rankedAccounts.filter(({ account, metrics }) => account.isSubscribed && metrics.remainingBoxCount === 0);
  const best = subscribedAccounts[0];
  const actions = [];

  if (best) {
    actions.push(`${getAccountLabel(best.account)} has the best next available week: ${withDessert(best.metrics.nextWeekLabel, best.account)}.`);
  }

  subscribedAccounts
    .filter(({ metrics }) => metrics.offerExpiring)
    .forEach(({ account }) => actions.push(`${getAccountLabel(account)} offer expires soon.`));

  unsubscribedAccounts.forEach(({ account }) => {
    actions.push(`${getAccountLabel(account)} is unsubscribed. ${getResubscribeCountdown(account) || "Choose a date to start the 4-week wait."}`);
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

function startAccountDrag(event, accountId) {
  draggedAccountId = accountId;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", accountId);
  rowsElement.querySelector(`[data-id="${accountId}"]`)?.classList.add("is-dragging");
}

function allowAccountDrop(event) {
  if (!draggedAccountId) return;
  event.preventDefault();
  event.currentTarget.classList.add("is-drop-target");
}

function dropAccount(event, targetAccountId) {
  event.preventDefault();
  event.currentTarget.classList.remove("is-drop-target");
  const sourceAccountId = event.dataTransfer.getData("text/plain") || draggedAccountId;
  moveAccount(sourceAccountId, targetAccountId);
}

function endAccountDrag() {
  draggedAccountId = "";
  rowsElement.querySelectorAll(".is-dragging, .is-drop-target").forEach((row) => row.classList.remove("is-dragging", "is-drop-target"));
}

function moveAccount(sourceAccountId, targetAccountId) {
  if (!sourceAccountId || sourceAccountId === targetAccountId) return;
  const sourceIndex = state.accounts.findIndex((account) => account.id === sourceAccountId);
  const targetIndex = state.accounts.findIndex((account) => account.id === targetAccountId);
  if (sourceIndex < 0 || targetIndex < 0) return;

  const [sourceAccount] = state.accounts.splice(sourceIndex, 1);
  state.accounts.splice(targetIndex, 0, sourceAccount);
  saveAndRender();
}

function moveAccountWithKeyboard(event, accountId) {
  if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  const currentIndex = state.accounts.findIndex((account) => account.id === accountId);
  const targetIndex = event.key === "ArrowUp" ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= state.accounts.length) return;

  const [account] = state.accounts.splice(currentIndex, 1);
  state.accounts.splice(targetIndex, 0, account);
  saveAndRender();
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
  discountInput.disabled = !account.isSubscribed;
  discountInput.setAttribute("aria-label", `Week ${cycleIndex + 1} discount`);
  discountInput.addEventListener("change", () => updateCycleDiscount(account.id, cycleIndex, discountInput.value));

  const doneLabel = document.createElement("label");
  const doneInput = document.createElement("input");
  doneInput.type = "checkbox";
  doneInput.checked = account.completedCycles[cycleIndex];
  doneInput.disabled = !account.isSubscribed;
  doneInput.addEventListener("change", () => updateCycleDone(account.id, cycleIndex, doneInput.checked));
  doneLabel.append(doneInput, " Done");

  wrapper.append(title, discountInput, doneLabel);
  return wrapper;
}

function getStatusLabel(account, metrics, isBestSubscribed) {
  if (!account.isSubscribed && isReadyForResubscription(account)) return "Ready to resubscribe";
  if (!account.isSubscribed) return "Unsubscribed";
  if (metrics.remainingBoxCount === 0) return "Cycle done";
  if (isBestSubscribed) return "Best total";
  if (metrics.offerExpiring) return "Expiring soon";
  return "Subscribed";
}

function getStatusClass(account, metrics, isBestSubscribed) {
  if (!account.isSubscribed && isReadyForResubscription(account)) return "status-ready";
  if (!account.isSubscribed) return "status-unsubscribed";
  if (metrics.remainingBoxCount === 0) return "status-unsubscribed";
  if (isBestSubscribed) return "status-order";
  if (metrics.offerExpiring) return "status-expiring";
  return "status-credit";
}

function updateAccount(id, key, value) {
  const account = state.accounts.find((item) => item.id === id);
  if (!account) return;

  account[key] = ["freeDessert", "isNewAccount"].includes(key)
    ? Boolean(value)
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

  account.completedCycles = account.completedCycles.map((wasDone, index) => {
    if (isDone) return index <= cycleIndex || wasDone;
    return index < cycleIndex ? wasDone : false;
  });
  saveAndRender();
}

function toggleSubscription(id) {
  const account = state.accounts.find((item) => item.id === id);
  if (!account) return;

  if (account.isSubscribed) {
    pendingUnsubscribeAccountId = id;
    unsubscribeDialogAccount.textContent = `${getAccountLabel(account)} will be ready for resubscription four weeks after this date.`;
    unsubscribeDateInput.value = todayIsoDate();
    if (typeof unsubscribeDialog.showModal === "function") {
      unsubscribeDialog.showModal();
    } else if (confirm(`Save today as the unsubscribe date for ${getAccountLabel(account)}?`)) {
      saveUnsubscribeDate();
    }
    return;
  } else {
    resetOfferValues(account);
    account.isSubscribed = true;
    account.unsubscribedAt = "";
  }
  saveAndRender();
}

function saveUnsubscribeDate(event) {
  event?.preventDefault();
  const account = state.accounts.find((item) => item.id === pendingUnsubscribeAccountId);
  if (!account || !unsubscribeDateInput.value) return;

  account.isSubscribed = false;
  account.unsubscribedAt = unsubscribeDateInput.value;
  pendingUnsubscribeAccountId = null;
  unsubscribeDialog.close();
  saveAndRender();
}

function getResubscriptionDate(account) {
  return account.unsubscribedAt ? addDaysIsoDate(account.unsubscribedAt, resubscriptionWaitDays) : "";
}

function isReadyForResubscription(account) {
  const targetDate = getResubscriptionDate(account);
  return !account.isSubscribed && Boolean(targetDate) && daysUntil(targetDate) <= 0;
}

function getResubscribeCountdown(account) {
  if (account.isSubscribed) return "";
  const targetDate = getResubscriptionDate(account);
  if (!targetDate) return "Set an unsubscribe date";
  const daysRemaining = daysUntil(targetDate);
  return daysRemaining <= 0 ? "Ready now" : `Resubscribe in ${daysRemaining} day${daysRemaining === 1 ? "" : "s"}`;
}

function notifyReadyAccounts() {
  const readyAccounts = state.accounts.filter(isReadyForResubscription);
  const notificationRegion = document.querySelector("#notificationRegion");
  if (!readyAccounts.length) {
    notificationRegion.replaceChildren();
    lastReadyNotificationKey = "";
    return;
  }

  const notificationKey = readyAccounts.map((account) => account.id).sort().join(",");
  if (notificationKey === lastReadyNotificationKey) return;
  lastReadyNotificationKey = notificationKey;
  const message = document.createElement("div");
  message.className = "ready-notification";
  message.textContent = `${readyAccounts.map(getAccountLabel).join(", ")} ${readyAccounts.length === 1 ? "is" : "are"} ready to resubscribe.`;
  notificationRegion.replaceChildren(message);
}

function resetOfferValues(account) {
  account.boxPrice = 0;
  account.shipping = 0;
  account.creditBalance = 0;
  account.freeDessert = false;
  account.isNewAccount = false;
  account.offerExpiry = "";
  account.discountMode = "euro";
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
  state.baselineBoxPrice = 0;
  state.accounts = sampleAccounts.map((account) => createAccount({ ...account, id: createId(), cycleDiscounts: [...account.cycleDiscounts], completedCycles: [...account.completedCycles] }));
  currencyInput.value = state.currency;
  mealCountInput.value = state.mealCount;
  expiryWindowInput.value = state.expiryWindowDays;
  baselineBoxPriceInput.value = state.baselineBoxPrice;
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
      state.baselineBoxPrice = toNumber(importedState.baselineBoxPrice, 0);
      state.accounts = Array.isArray(importedState.accounts) ? importedState.accounts.map(normalizeAccount) : state.accounts;
      currencyInput.value = state.currency;
      mealCountInput.value = state.mealCount;
      expiryWindowInput.value = state.expiryWindowDays;
      baselineBoxPriceInput.value = state.baselineBoxPrice;
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
    id: createId(),
    discountMode: "euro",
    name: "",
    boxPrice: 0,
    shipping: 0,
    creditBalance: 0,
    freeDessert: false,
    isNewAccount: false,
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
  const savedDiscounts = ["euro", "percent"].includes(account.discountMode) && Array.isArray(account.cycleDiscounts)
    ? account.cycleDiscounts.slice(0, boxCount).map((value) => toNumber(value, 0))
    : null;
  const oldPercentageDiscounts = Array.isArray(account.cycleDiscounts)
    ? account.cycleDiscounts.slice(0, boxCount).map((value) => boxPrice * (toNumber(value, 0) / 100))
    : [boxPrice * (toNumber(account.discountValue, 0) / 100), 0, 0, 0];
  const cycleDiscounts = Array.isArray(account.discountAmounts)
    ? account.discountAmounts.slice(0, boxCount).map((value) => toNumber(value, 0))
    : savedDiscounts
      ? savedDiscounts
    : oldPercentageDiscounts;

  while (cycleDiscounts.length < boxCount) cycleDiscounts.push(0);

  const completedCycles = Array.isArray(account.completedCycles)
    ? account.completedCycles.slice(0, boxCount).map(Boolean)
    : [false, false, false, false];

  while (completedCycles.length < boxCount) completedCycles.push(false);

  return createAccount({
    id: account.id || createId(),
    discountMode: account.discountMode === "percent" ? "percent" : "euro",
    name: account.name || String.fromCharCode(65 + index),
    boxPrice,
    shipping: toNumber(account.shipping, 0),
    creditBalance: toNumber(account.creditBalance ?? account.walletCredit, 0),
    freeDessert: Boolean(account.freeDessert),
    isNewAccount: Boolean(account.isNewAccount),
    offerExpiry: account.offerExpiry || account.promoExpiry || "",
    cycleDiscounts,
    completedCycles,
    isSubscribed: account.isSubscribed ?? account.isActive ?? true,
    unsubscribedAt: account.unsubscribedAt || "",
    notes: account.notes || ""
  });
}

function addDaysIsoDate(dateValue, days) {
  const date = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
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

function createId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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