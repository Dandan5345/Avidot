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

const ROUTES = {
  "": renderHome,
  "/": renderHome,
  "/home": renderHome,
  "/lost-items": renderLostItems,
  "/pending-pickup": renderPendingPickup,
  "/awaiting-info": renderAwaitingInfo,
  "/manager-actions": renderManagerActions,
  "/users": renderUsers
};

const ROUTE_TEARDOWNS = {
  "/lost-items": teardownLostItems,
  "/pending-pickup": teardownPendingPickup,
  "/awaiting-info": teardownAwaitingInfo,
  "/users": teardownUsers
};

function currentRoute() {
  const h = location.hash || "";
  return h.startsWith("#") ? h.slice(1) : h;
}

function navigate() {
  if (!isSignedIn) return; // login screen handles its own rendering
  const rawRoute = currentRoute() || "/home";
  // Use a hard whitelist so user-controlled hash cannot dispatch to anything
  // unexpected (e.g. inherited Object prototype methods).
  const route = Object.prototype.hasOwnProperty.call(ROUTES, rawRoute) ? rawRoute : "/home";

  // Permission gates
  if (route === "/users" && !isAdmin()) { location.hash = "#/home"; return; }
  if (route === "/manager-actions" && !isAhmash()) { location.hash = "#/home"; return; }

  // teardown previous
  if (currentTeardown) { try { currentTeardown(); } catch (_) {} currentTeardown = null; }

  const handler = ROUTES[route];
  handler(appEl);
  currentTeardown = Object.prototype.hasOwnProperty.call(ROUTE_TEARDOWNS, route)
    ? ROUTE_TEARDOWNS[route]
    : null;
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
