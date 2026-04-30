// App entry: hash router and global wiring.
import { auth } from "./firebase.js";
import {
  watchAuth, renderLogin, logout, currentUser, userDisplayLabel
} from "./auth.js";
import { renderHome } from "./home.js";
import { renderLostItems, teardownLostItems } from "./lostItems.js";
import { renderPendingPickup, teardownPendingPickup } from "./pendingPickup.js";
import { renderAwaitingInfo, teardownAwaitingInfo } from "./awaitingInfo.js";
import { renderManagerActions } from "./managerActions.js";
import { renderUsers, teardownUsers, ensureSuperAdminProfile } from "./users.js";
import { isAdmin, isAhmash } from "./auth.js";

const appEl = document.getElementById("app");
const topbarEl = document.getElementById("topbar");
const userInfoEl = document.getElementById("userInfo");
const logoutBtn = document.getElementById("logoutBtn");
const homeBtn = document.getElementById("homeBtn");

let currentTeardown = null;
let isSignedIn = false;

function currentRoute() {
  const h = location.hash || "";
  return h.startsWith("#") ? h.slice(1) : h;
}

function navigate() {
  if (!isSignedIn) return; // login screen handles its own rendering
  const rawRoute = currentRoute() || "/home";

  // Permission gates
  if (rawRoute === "/users" && !isAdmin()) { location.hash = "#/home"; return; }
  if (rawRoute === "/manager-actions" && !isAhmash()) { location.hash = "#/home"; return; }

  // teardown previous
  if (currentTeardown) { try { currentTeardown(); } catch (_) {} currentTeardown = null; }

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
    default:
      renderHome(appEl);
      currentTeardown = null;
  }
}

window.addEventListener("hashchange", navigate);

logoutBtn.addEventListener("click", async () => {
  if (currentTeardown) { try { currentTeardown(); } catch (_) {} currentTeardown = null; }
  await logout();
});
homeBtn.addEventListener("click", () => { location.hash = "#/home"; });

watchAuth(
  async (user) => {
    isSignedIn = true;
    topbarEl.classList.remove("hidden");
    userInfoEl.innerHTML = userDisplayLabel();

    // Auto-provision the super admin's user profile so they always appear
    // in the admin panel and have isAdmin set, even before any /users record.
    if (auth.currentUser) {
      try { await ensureSuperAdminProfile(auth.currentUser); } catch (_) {}
    }

    if (!location.hash || location.hash === "#" || location.hash === "#/login") {
      location.hash = "#/home";
    } else {
      navigate();
    }
  },
  () => {
    isSignedIn = false;
    topbarEl.classList.add("hidden");
    if (currentTeardown) { try { currentTeardown(); } catch (_) {} currentTeardown = null; }
    renderLogin(appEl);
  }
);
