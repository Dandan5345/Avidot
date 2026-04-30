// Authentication / current user state and login screen.
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import { ref, get } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-database.js";
import { auth, db, isSuperAdminEmail } from "./firebase.js";
import { escapeHtml } from "./utils.js";

// Current user snapshot used across the app.
// Shape: { uid, email, name, employeeNumber, role, isAdmin, isSuperAdmin }
export const currentUser = {
  uid: null,
  email: null,
  name: "",
  employeeNumber: "",
  role: "kabat",         // "kabat" | "ahmash"
  isAdmin: false,
  isSuperAdmin: false,
  authReady: false
};

const PROFILE_LOAD_TIMEOUT_MS = 8000;
let authStateVersion = 0;

const listeners = new Set();
export function onUserChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify() { for (const fn of listeners) try { fn(currentUser); } catch (_) { } }

export function isAdmin() { return !!(currentUser.isAdmin || currentUser.isSuperAdmin); }
export function isAhmash() { return currentUser.role === "ahmash" || isAdmin(); }

function applyBaseUserState(fbUser) {
  currentUser.uid = fbUser.uid;
  currentUser.email = fbUser.email;
  currentUser.isSuperAdmin = isSuperAdminEmail(fbUser.email);
}

function applyFallbackProfile(fbUser) {
  applyBaseUserState(fbUser);
  currentUser.name = fbUser.displayName || fbUser.email || "משתמש";
  currentUser.employeeNumber = "";
  currentUser.role = currentUser.isSuperAdmin ? "ahmash" : "kabat";
  currentUser.isAdmin = currentUser.isSuperAdmin;
  currentUser.authReady = true;
  notify();
}

function withTimeout(promise, timeoutMs, label) {
  let timerId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timerId = setTimeout(() => reject(new Error(label)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timerId) clearTimeout(timerId);
  });
}

export async function loadUserProfile(fbUser) {
  applyBaseUserState(fbUser);

  let profile = null;
  try {
    const snap = await withTimeout(
      get(ref(db, `users/${fbUser.uid}`)),
      PROFILE_LOAD_TIMEOUT_MS,
      "Timed out while loading user profile"
    );
    profile = snap.val();
  } catch (e) {
    console.warn("Could not read user profile:", e);
  }

  currentUser.name = (profile && profile.name) || fbUser.email;
  currentUser.employeeNumber = (profile && profile.employeeNumber) || "";
  currentUser.role = (profile && profile.role) || (currentUser.isSuperAdmin ? "ahmash" : "kabat");
  currentUser.isAdmin = !!(profile && profile.isAdmin) || currentUser.isSuperAdmin;
  currentUser.authReady = true;
  notify();
}

async function refreshUserProfileInBackground(fbUser, expectedVersion) {
  try {
    const snap = await withTimeout(
      get(ref(db, `users/${fbUser.uid}`)),
      PROFILE_LOAD_TIMEOUT_MS,
      "Timed out while loading user profile"
    );

    if (expectedVersion !== authStateVersion || auth.currentUser?.uid !== fbUser.uid) {
      return;
    }

    const profile = snap.val();
    currentUser.name = (profile && profile.name) || fbUser.email;
    currentUser.employeeNumber = (profile && profile.employeeNumber) || "";
    currentUser.role = (profile && profile.role) || (currentUser.isSuperAdmin ? "ahmash" : "kabat");
    currentUser.isAdmin = !!(profile && profile.isAdmin) || currentUser.isSuperAdmin;
    currentUser.authReady = true;
    notify();
  } catch (e) {
    console.warn("Could not refresh user profile in background:", e);
  }
}

export function clearCurrentUser() {
  currentUser.uid = null;
  currentUser.email = null;
  currentUser.name = "";
  currentUser.employeeNumber = "";
  currentUser.role = "kabat";
  currentUser.isAdmin = false;
  currentUser.isSuperAdmin = false;
  currentUser.authReady = true;
  notify();
}

export function watchAuth(onSignedIn, onSignedOut) {
  onAuthStateChanged(auth, async (fbUser) => {
    const currentVersion = ++authStateVersion;

    if (fbUser) {
      applyFallbackProfile(fbUser);

      try {
        if (onSignedIn) await onSignedIn(currentUser);
      } catch (e) {
        console.error("[auth] signed-in handler failed:", e);
      }

      refreshUserProfileInBackground(fbUser, currentVersion);
    } else {
      clearCurrentUser();
      try {
        if (onSignedOut) onSignedOut();
      } catch (e) {
        console.error("[auth] signed-out handler failed:", e);
      }
    }
  });
}

export async function logout() {
  await signOut(auth);
}

// ===== Login screen =====
export function renderLogin(container) {
  container.innerHTML = `
    <div class="login-wrap">
      <form class="login-card" id="loginForm" autocomplete="on">
        <h1>מערכת אבידות ומציאות</h1>
        <p class="sub">מחלקת ביטחון – מלון</p>
        <div id="loginError" class="login-error" style="display:none"></div>
        <label class="field">
          <span>אימייל</span>
          <input type="email" id="loginEmail" required autocomplete="email" />
        </label>
        <label class="field">
          <span>סיסמה</span>
          <input type="password" id="loginPassword" required autocomplete="current-password" />
        </label>
        <button class="btn btn-block" type="submit" id="loginBtn">התחבר</button>
        <p class="muted" style="margin-top:14px;text-align:center">
          אין הרשמה פתוחה. משתמשים נוצרים על ידי מנהל בלבד.
        </p>
      </form>
    </div>
  `;

  const form = container.querySelector("#loginForm");
  const errEl = container.querySelector("#loginError");
  const btn = container.querySelector("#loginBtn");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.style.display = "none";
    const email = container.querySelector("#loginEmail").value.trim();
    const password = container.querySelector("#loginPassword").value;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> מתחבר...`;
    console.log("[login] attempting sign-in for", email);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      console.log("[login] sign-in succeeded");
    } catch (err) {
      console.error("[login] sign-in failed:", err);
      let msg = "שגיאה בהתחברות";
      const code = (err && err.code) || "";
      if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found") || code.includes("invalid-login-credentials")) {
        msg = "אימייל או סיסמה שגויים";
      } else if (code.includes("too-many-requests")) {
        msg = "יותר מדי ניסיונות התחברות. נסה שוב מאוחר יותר.";
      } else if (code.includes("network")) {
        msg = "שגיאת רשת — בדוק את החיבור לאינטרנט";
      } else if (code.includes("operation-not-allowed")) {
        msg = "התחברות עם אימייל/סיסמה לא מופעלת ב-Firebase. יש להפעיל אותה ב-Firebase Console → Authentication → Sign-in method.";
      } else if (code.includes("configuration-not-found")) {
        msg = "שגיאת תצורה ב-Firebase Authentication. ודא שהאפליקציה מוגדרת נכון ושיטת ההתחברות מאופשרת.";
      } else if (code.includes("invalid-api-key") || code.includes("api-key")) {
        msg = "מפתח API לא תקין";
      } else if (err && err.message) {
        msg = `${code ? `[${code}] ` : ""}${err.message}`;
      }
      errEl.textContent = msg;
      errEl.style.display = "block";
    } finally {
      btn.disabled = false;
      btn.textContent = "התחבר";
    }
  });
}

export function userDisplayLabel() {
  if (!currentUser.uid) return "";
  const role = currentUser.isSuperAdmin
    ? "מנהל על"
    : currentUser.isAdmin
      ? "מנהל"
      : currentUser.role === "ahmash"
        ? "אחמ\"ש"
        : "קב\"ט";
  return `${escapeHtml(currentUser.name)} (${role})`;
}
