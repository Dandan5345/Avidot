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

const appEl = document.getElementById("app");
const topbarEl = document.getElementById("topbar");
const userInfoEl = document.getElementById("userInfo");
const logoutBtn = document.getElementById("logoutBtn");
const homeBtn = document.getElementById("homeBtn");

let currentTeardown = null;
let isSignedIn = false;

appEl.innerHTML = `<div class="section-card"><p>טוען...</p></div>`;

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

watchAuth(
  async (user) => {
    console.log("[auth] signed in as", user && user.email);
    isSignedIn = true;
    topbarEl.classList.remove("hidden");
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
    if (currentTeardown) { try { currentTeardown(); } catch (_) { } currentTeardown = null; }
    renderLogin(appEl);
  }
);
