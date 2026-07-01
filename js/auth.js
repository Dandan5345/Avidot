// Authentication / current user state and login screen.
//
// Two login paths:
// - Super admin: real Firebase Auth email/password session (unchanged).
// - Everyone else: identity lives in a Firestore `users/{id}` doc
//   (username/usernameLower/passwordHash/passwordSalt). Firestore security
//   rules require `request.auth != null`, so we keep a silent anonymous
//   Firebase Auth session alive at all times to satisfy that — the anonymous
//   uid is unrelated to the app-level user id. See project memory
//   "firestore-auth-migration-plan" for the full rationale.
import {
  browserLocalPersistence,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  setPersistence
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import { auth, isSuperAdminEmail } from "./firebase.js";
import { findDocumentsByField, getDocument } from "./firestoreStore.js";
import { escapeHtml, usernameToEmailLocal, verifyPassword } from "./utils.js";

const FIRESTORE_SESSION_KEY = "avidot_firestore_uid";

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
const authPersistenceReady = ensureAuthPersistence();

let signedInHandler = null;
let signedOutHandler = null;
let anonymousSignInPromise = null;
// Tracks whether the app has already been told "signed out", so the anonymous
// bootstrap's own onAuthStateChanged callback doesn't re-render the login
// screen (and wipe out whatever the user already typed) once it resolves.
let hasNotifiedSignedOut = false;

const listeners = new Set();
export function onUserChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify() { for (const fn of listeners) try { fn(currentUser); } catch (_) { } }

async function ensureAuthPersistence() {
  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch (error) {
    console.warn("[auth] failed to enable local persistence:", error);
  }
}

function ensureAnonymousSession() {
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  if (!anonymousSignInPromise) {
    anonymousSignInPromise = signInAnonymously(auth).catch((error) => {
      anonymousSignInPromise = null; // allow retry on next call
      console.warn("[auth] anonymous sign-in failed:", error);
      throw error;
    });
  }
  return anonymousSignInPromise;
}

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

function applyFirestoreUserState(profile, uid) {
  currentUser.uid = uid;
  currentUser.email = profile.email || null;
  currentUser.name = profile.name || profile.username || "משתמש";
  currentUser.employeeNumber = profile.employeeNumber || "";
  currentUser.role = profile.role || "kabat";
  currentUser.isAdmin = !!profile.isAdmin;
  currentUser.isSuperAdmin = false;
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
      getDocument("users", fbUser.uid),
      PROFILE_LOAD_TIMEOUT_MS,
      "Timed out while loading user profile"
    );
    profile = snap;
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
      getDocument("users", fbUser.uid),
      PROFILE_LOAD_TIMEOUT_MS,
      "Timed out while loading user profile"
    );

    if (expectedVersion !== authStateVersion || auth.currentUser?.uid !== fbUser.uid) {
      return;
    }

    const profile = snap;
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

async function tryRestoreFirestoreSession(uid) {
  try {
    const profile = await withTimeout(
      getDocument("users", uid),
      PROFILE_LOAD_TIMEOUT_MS,
      "Timed out while loading user profile"
    );
    if (!profile || !profile.passwordHash) return false;
    applyFirestoreUserState(profile, uid);
    return true;
  } catch (e) {
    console.warn("[auth] failed to restore Firestore session:", e);
    return false;
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

async function notifySignedIn() {
  try { if (signedInHandler) await signedInHandler(currentUser); } catch (e) { console.error("[auth] signed-in handler failed:", e); }
}
async function notifySignedOut() {
  try { if (signedOutHandler) await signedOutHandler(); } catch (e) { console.error("[auth] signed-out handler failed:", e); }
}

export function watchAuth(onSignedIn, onSignedOut) {
  signedInHandler = onSignedIn;
  signedOutHandler = onSignedOut;

  void authPersistenceReady.finally(() => {
    onAuthStateChanged(auth, async (fbUser) => {
      const currentVersion = ++authStateVersion;

      if (fbUser && !fbUser.isAnonymous) {
        // Real Firebase Auth account — currently only the super admin.
        localStorage.removeItem(FIRESTORE_SESSION_KEY);
        hasNotifiedSignedOut = false;
        applyFallbackProfile(fbUser);
        await notifySignedIn();
        refreshUserProfileInBackground(fbUser, currentVersion);
        return;
      }

      if (fbUser && fbUser.isAnonymous) {
        const savedUid = localStorage.getItem(FIRESTORE_SESSION_KEY);
        if (savedUid) {
          const restored = await tryRestoreFirestoreSession(savedUid);
          if (restored) {
            hasNotifiedSignedOut = false;
            await notifySignedIn();
            return;
          }
          localStorage.removeItem(FIRESTORE_SESSION_KEY);
        }
        // No saved session — logged out. Only (re-)render the login screen on
        // an actual sign-in→sign-out transition, not on every callback this
        // anonymous bootstrap triggers, or the login screen would wipe out
        // whatever the user already typed while the bootstrap was in flight.
        if (!hasNotifiedSignedOut) {
          hasNotifiedSignedOut = true;
          clearCurrentUser();
          await notifySignedOut();
        }
        return;
      }

      // fbUser === null: no session at all yet. Show the login screen and
      // silently bootstrap an anonymous session so the login form (and a
      // restored Firestore session on the next callback) can read Firestore.
      if (!hasNotifiedSignedOut) {
        hasNotifiedSignedOut = true;
        clearCurrentUser();
        await notifySignedOut();
      }
      ensureAnonymousSession().catch(() => { });
    });
  });
}

export async function logout() {
  localStorage.removeItem(FIRESTORE_SESSION_KEY);
  if (auth.currentUser && !auth.currentUser.isAnonymous) {
    await signOut(auth);
  } else {
    hasNotifiedSignedOut = true;
    clearCurrentUser();
    await notifySignedOut();
  }
}

// ===== Login screen =====
export function renderLogin(container) {
  container.innerHTML = `
    <div class="login-wrap">
      <div class="login-shell">
        <section class="login-showcase">
          <span class="login-kicker">Mamilla Hotel Jerusalem</span>
          <h2>מערכת עבודה מלאה למחלקת הביטחון</h2>
          <p>רישום, מעקב ומסירה של אבידות ומציאות בממשק אחיד שמותאם גם לעבודה נוחה ממחשב.</p>
          <div class="login-highlights">
            <article class="login-highlight">
              <strong>מסך עבודה רחב</strong>
              <span>טבלאות, כרטיסים ופעולות מהירות מוצגים נכון גם במסכי דסקטופ.</span>
            </article>
            <article class="login-highlight">
              <strong>תיעוד מהיר</strong>
              <span>שמירת פרטים, צילום פריטים ומעקב שוטף מתוך אפליקציית ווב אחת.</span>
            </article>
            <article class="login-highlight">
              <strong>ממשק ממותג</strong>
              <span>מעטפת חזותית המבוססת על מלון ממילא עם רקע מלא וקונטיינרים נוחים לקריאה.</span>
            </article>
          </div>
        </section>
        <form class="login-card" id="loginForm" autocomplete="on">
          <h1>מערכת אבידות ומציאות</h1>
          <p class="sub">מחלקת ביטחון – מלון ממילא ירושלים</p>
          <div id="loginError" class="login-error" style="display:none"></div>
          <label class="field">
            <span>שם משתמש</span>
            <input type="text" id="loginUsername" required autocomplete="username" />
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
    </div>
  `;

  const form = container.querySelector("#loginForm");
  const errEl = container.querySelector("#loginError");
  const btn = container.querySelector("#loginBtn");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.style.display = "none";
    const username = container.querySelector("#loginUsername").value.trim();
    const usernameLower = username.toLowerCase();
    const password = container.querySelector("#loginPassword").value;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> מתחבר...`;
    try {
      await authPersistenceReady;
      await ensureAnonymousSession();

      // 1) Firestore-based login (everyone except the super admin).
      const matches = await findDocumentsByField("users", "usernameLower", usernameLower);
      const candidate = matches.find((u) => u.passwordHash && u.passwordSalt);
      if (candidate) {
        const ok = await verifyPassword(candidate.passwordSalt, candidate.passwordHash, password);
        if (!ok) throw { code: "firestore/wrong-credential" };
        localStorage.setItem(FIRESTORE_SESSION_KEY, candidate.id);
        hasNotifiedSignedOut = false;
        applyFirestoreUserState(candidate, candidate.id);
        await notifySignedIn();
        return;
      }

      // 2) Fallback: Firebase Auth email/password — super admin only. Any
      // other Auth account that still exists (legacy, not yet migrated) is
      // deliberately rejected here.
      const emailLocal = usernameToEmailLocal(username);
      let lastErr = { code: "firestore/wrong-credential" };
      let signedIn = false;
      for (const domain of ["@aovdim.com", "@gmail.com"]) {
        try {
          const cred = await signInWithEmailAndPassword(auth, emailLocal + domain, password);
          if (!isSuperAdminEmail(cred.user.email)) {
            await signOut(auth);
            throw { code: "auth/legacy-account-not-migrated" };
          }
          signedIn = true;
          lastErr = null;
          break;
        } catch (err) {
          const c = (err && err.code) || "";
          if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found") || c.includes("invalid-login-credentials")) {
            lastErr = err;
          } else {
            throw err;
          }
        }
      }
      if (!signedIn) throw lastErr;
    } catch (err) {
      console.error("[login] sign-in failed:", err);
      let msg = "שגיאה בהתחברות";
      const code = (err && err.code) || "";
      if (code === "firestore/wrong-credential" || code === "auth/legacy-account-not-migrated" ||
        code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found") || code.includes("invalid-login-credentials")) {
        msg = "שם משתמש או סיסמה שגויים";
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
