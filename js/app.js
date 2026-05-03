// App entry: hash router and global wiring.
import { auth } from "./firebase.js";
import {
  watchAuth, renderLogin, logout, currentUser, userDisplayLabel, onUserChange
} from "./auth.js";
import { renderHome } from "./home.js";
import { renderLostItems, teardownLostItems } from "./lostItems.js";
import { renderPendingPickup, teardownPendingPickup } from "./pendingPickup.js";
import { renderAwaitingInfo, teardownAwaitingInfo } from "./awaitingInfo.js";
import { renderManagerActions } from "./managerActions.js";
import { renderUsers, teardownUsers, ensureSuperAdminProfile } from "./users.js";
import { renderActivityLogsPage, teardownActivityLogsPage } from "./activityLogsPage.js";
import { isAdmin, isAhmash } from "./auth.js";
import { logActivitySafe } from "./activityLog.js";

const appEl = document.getElementById("app");
const topbarEl = document.getElementById("topbar");
const userInfoEl = document.getElementById("userInfo");
const logoutBtn = document.getElementById("logoutBtn");
const homeBtn = document.getElementById("homeBtn");
const brandLink = document.getElementById("brandLink");
const appFooter = document.getElementById("appFooter");

let currentTeardown = null;
let isSignedIn = false;
let lastRouteLog = { route: "", at: 0 };

registerServiceWorker();

appEl.innerHTML = `<div class="section-card"><p>טוען...</p></div>`;

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(new URL("../sw.js", import.meta.url), { scope: "./" })
      .catch((error) => console.warn("[pwa] service worker registration failed:", error));
  }, { once: true });
}

function currentRoute() {
  const h = location.hash || "";
  return h.startsWith("#") ? h.slice(1) : h;
}

function navigate() {
  if (!isSignedIn) return; // login screen handles its own rendering
  const rawRoute = currentRoute() || "/home";

  // Permission gates
  if (rawRoute === "/users" && !isAdmin()) { location.hash = "#/home"; return; }
  if (rawRoute === "/activity-log" && !isAdmin()) { location.hash = "#/home"; return; }
  if (rawRoute === "/manager-actions" && !isAhmash()) { location.hash = "#/home"; return; }

  // teardown previous
  if (currentTeardown) { try { currentTeardown(); } catch (_) { } currentTeardown = null; }

  // Explicit dispatch: never invoke a function from a user-controlled lookup
  // on a regular object (avoids any prototype-pollution / unexpected-call risks).
  switch (rawRoute) {
    case "":
    case "/":
    case "/home":
      renderHome(appEl);
      currentTeardown = null;
      break;
    case "/lost-items":
      renderLostItems(appEl);
      currentTeardown = teardownLostItems;
      break;
    case "/pending-pickup":
      renderPendingPickup(appEl);
      currentTeardown = teardownPendingPickup;
      break;
    case "/awaiting-info":
      renderAwaitingInfo(appEl);
      currentTeardown = teardownAwaitingInfo;
      break;
    case "/manager-actions":
      renderManagerActions(appEl);
      currentTeardown = null;
      break;
    case "/users":
      renderUsers(appEl);
      currentTeardown = teardownUsers;
      break;
    case "/activity-log":
      renderActivityLogsPage(appEl);
      currentTeardown = teardownActivityLogsPage;
      break;
    default:
      renderHome(appEl);
      currentTeardown = null;
  }

  logRouteVisit(rawRoute);
}

function showRouteError(error) {
  console.error("[router] failed to render route:", error);
  appEl.innerHTML = `<div class="section-card"><h3>שגיאה בטעינת הדף</h3><pre>${(error && error.message) || error}</pre></div>`;
}

function safeNavigate() {
  try {
    navigate();
  } catch (error) {
    showRouteError(error);
  }
}

function logRouteVisit(route) {
  const normalizedRoute = route || "/home";
  if (normalizedRoute === "/login") return;

  const now = Date.now();
  if (lastRouteLog.route === normalizedRoute && now - lastRouteLog.at < 3000) {
    return;
  }
  lastRouteLog = { route: normalizedRoute, at: now };

  void logActivitySafe({
    action: "page.view",
    summary: `${userDisplayLabelText()} פתח את הדף ${routeLabel(normalizedRoute)}`,
    entityType: "page",
    entityId: normalizedRoute,
    detailLines: [`נתיב: ${normalizedRoute}`],
    metadata: { route: normalizedRoute }
  });
}

function routeLabel(route) {
  switch (route) {
    case "/home":
    case "/":
    case "":
      return "דף הבית";
    case "/lost-items":
      return "אבידות רגילות";
    case "/pending-pickup":
      return "ממתינות לאיסוף";
    case "/awaiting-info":
      return "ממתינות למידע";
    case "/manager-actions":
      return 'פעולות אחמ"ש';
    case "/users":
      return "ניהול משתמשים";
    case "/activity-log":
      return "LOG";
    default:
      return route;
  }
}

function userDisplayLabelText() {
  return currentUser.name || currentUser.email || "משתמש";
}

onUserChange(() => {
  userInfoEl.innerHTML = userDisplayLabel();

  if (!isSignedIn || !auth.currentUser) return;

  const route = currentRoute() || "/home";
  if (route === "/home" || route === "/users" || route === "/activity-log" || route === "/manager-actions") {
    safeNavigate();
  }
});

window.addEventListener("hashchange", safeNavigate);

logoutBtn.addEventListener("click", async () => {
  if (currentTeardown) { try { currentTeardown(); } catch (_) { } currentTeardown = null; }
  await logout();
});
homeBtn.addEventListener("click", () => { location.hash = "#/home"; });
if (brandLink) {
  brandLink.addEventListener("click", () => { location.hash = "#/home"; });
}

watchAuth(
  async (user) => {
    console.log("[auth] signed in as", user && user.email);
    isSignedIn = true;
    topbarEl.classList.remove("hidden");
    if (appFooter) appFooter.classList.remove("hidden");
    userInfoEl.innerHTML = userDisplayLabel();

    try {
      if (!location.hash || location.hash === "#" || location.hash === "#/login") {
        location.hash = "#/home";
      }
      safeNavigate();
    } catch (e) {
      showRouteError(e);
    }

    // Auto-provision the super admin profile in the background. This must not
    // block navigation, because a slow database request would leave the app blank.
    if (auth.currentUser) {
      ensureSuperAdminProfile(auth.currentUser)
        .catch((e) => console.warn("[auth] ensureSuperAdminProfile failed:", e));
    }
  },
  () => {
    isSignedIn = false;
    topbarEl.classList.add("hidden");
    if (appFooter) appFooter.classList.add("hidden");
    if (currentTeardown) { try { currentTeardown(); } catch (_) { } currentTeardown = null; }
    renderLogin(appEl);
  }
);
