// User management (admins only).
// Uses a secondary Firebase Auth instance to create users without
// replacing the current admin's session.
import {
  createUserWithEmailAndPassword, signOut as secondarySignOut,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import { auth, secondaryAuth, isSuperAdminEmail } from "./firebase.js";
import {
  createDocument,
  deleteDocument,
  getDocument,
  setDocument,
  subscribeCollection,
  updateDocument
} from "./firestoreStore.js";
import { isAdmin, currentUser } from "./auth.js";
import {
  escapeHtml, openModal, toast, confirmDialog, promptDialog, formatDateTime
} from "./utils.js";

const COLLECTION = "users";
let unsubscribe = null;
let allUsers = [];
let hasLoadedSnapshot = false;
let loadError = "";
let initialLoadTimer = null;

export function renderUsers(container) {
  if (!isAdmin()) {
    container.innerHTML = `
      <div class="page-title"><h2>ניהול משתמשים</h2></div>
      <div class="section-card"><p>אין לך הרשאת מנהל לדף זה.</p></div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-title">
      <h2>👥 ניהול משתמשים</h2>
      <div class="home-actions">
        <button id="addUserBtn" class="btn">➕ הוסף משתמש</button>
      </div>
    </div>

    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>שם העובד</th><th>מס' עובד</th><th>אימייל</th>
            <th>תפקיד</th><th>סטטוס מנהל</th><th>נוצר</th><th>פעולות</th>
          </tr>
        </thead>
        <tbody id="usersTbody"><tr><td colspan="7" class="empty">טוען...</td></tr></tbody>
      </table>
    </div>
    <p class="muted" style="margin-top:10px">
      הערה: סיסמאות נשמרות באופן מאובטח על ידי Firebase Authentication ואינן מוצגות כאן.
      ניתן לאפס סיסמה דרך כפתור "אפס סיסמה".
    </p>
  `;

  container.querySelector("#addUserBtn").addEventListener("click", () => openAddUserModal());

  loadError = "";
  clearTimeout(initialLoadTimer);
  initialLoadTimer = setTimeout(() => {
    if (!hasLoadedSnapshot) {
      loadError = "אין תגובה מ-Firestore. בדוק את ההרשאות והחיבור לפרויקט Firebase.";
      renderTable(container.querySelector("#usersTbody"));
    }
  }, 5000);

  unsubscribe = subscribeCollection(COLLECTION, (users) => {
    clearTimeout(initialLoadTimer);
    allUsers = users.map((user) => ({ uid: user.id, ...user }));
    hasLoadedSnapshot = true;
    loadError = "";
    renderTable(container.querySelector("#usersTbody"));
  }, (error) => {
    clearTimeout(initialLoadTimer);
    loadError = error?.message || "שגיאה בטעינת הנתונים";
    renderTable(container.querySelector("#usersTbody"));
  });

  if (hasLoadedSnapshot) renderTable(container.querySelector("#usersTbody"));
}

export function teardownUsers() {
  clearTimeout(initialLoadTimer);
  if (unsubscribe) {
    try { unsubscribe(); } catch (_) { }
    unsubscribe = null;
  }
}

function adminCount() {
  return allUsers.filter((u) => u.isAdmin).length;
}

function renderTable(tbody) {
  if (loadError && !hasLoadedSnapshot) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty">${escapeHtml(loadError)}</td></tr>`;
    return;
  }

  if (!allUsers.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty">אין משתמשים</td></tr>`;
    return;
  }
  // sort: super admin first, then admins, then by name
  const sorted = allUsers.slice().sort((a, b) => {
    const aS = isSuperAdminEmail(a.email) ? 0 : (a.isAdmin ? 1 : 2);
    const bS = isSuperAdminEmail(b.email) ? 0 : (b.isAdmin ? 1 : 2);
    if (aS !== bS) return aS - bS;
    return (a.name || "").localeCompare(b.name || "", "he");
  });

  tbody.innerHTML = sorted.map((u) => {
    const superAdmin = isSuperAdminEmail(u.email);
    const isMe = u.uid === currentUser.uid;
    return `
      <tr data-uid="${escapeHtml(u.uid)}">
        <td>${escapeHtml(u.name || "")} ${isMe ? '<span class="badge blue">אתה</span>' : ""}</td>
        <td>${escapeHtml(u.employeeNumber || "")}</td>
        <td>${escapeHtml(u.email || "")}</td>
        <td>${u.role === "ahmash" ? '<span class="badge amber">אחמ"ש</span>' : '<span class="badge blue">קב"ט</span>'}</td>
        <td>${superAdmin
        ? '<span class="badge purple">מנהל על</span>'
        : (u.isAdmin ? '<span class="badge green">מנהל</span>' : '<span class="badge red">לא</span>')}
        </td>
        <td>${escapeHtml(u.createdAt ? formatDateTime(u.createdAt) : "")}</td>
        <td>
          ${superAdmin ? '<span class="muted">מוגן</span>' : `
            <button class="btn btn-sm btn-outline" data-action="toggleAdmin">${u.isAdmin ? "הורד הרשאת מנהל" : "הפוך למנהל"}</button>
            <button class="btn btn-sm btn-secondary" data-action="resetPwd">אפס סיסמה</button>
            <button class="btn btn-sm btn-danger" data-action="delete">מחק</button>
          `}
        </td>
      </tr>`;
  }).join("");

  tbody.querySelectorAll("tr[data-uid]").forEach((tr) => {
    const uid = tr.getAttribute("data-uid");
    tr.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const u = allUsers.find((x) => x.uid === uid);
        if (!u) return;
        if (btn.dataset.action === "toggleAdmin") onToggleAdmin(u);
        if (btn.dataset.action === "delete") onDelete(u);
        if (btn.dataset.action === "resetPwd") onResetPassword(u);
      });
    });
  });
}

function openAddUserModal() {
  const m = openModal({
    title: "הוסף משתמש חדש",
    bodyHtml: `
      <form>
        <div class="form-grid">
          <label class="field"><span>שם העובד</span>
            <input type="text" id="u_name" required /></label>
          <label class="field"><span>מספר עובד</span>
            <input type="text" id="u_emp" /></label>
          <label class="field"><span>אימייל</span>
            <input type="email" id="u_email" required /></label>
          <label class="field"><span>סיסמה (לפחות 6 תווים)</span>
            <input type="password" id="u_pwd" required minlength="6" /></label>
          <label class="field"><span>תפקיד</span>
            <select id="u_role">
              <option value="kabat">קב"ט</option>
              <option value="ahmash">אחמ"ש</option>
            </select></label>
          <label class="checkbox-row full">
            <input type="checkbox" id="u_admin" /><span>סטטוס מנהל</span></label>
        </div>
      </form>`,
    footerButtons: [
      { label: "ביטול", className: "btn-secondary", onClick: ({ close }) => close() },
      {
        label: "צור משתמש", className: "btn-success", id: "createUserBtn", onClick: async ({ body, close }) => {
          const btn = document.getElementById("createUserBtn");
          btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> יוצר...`;
          try {
            const name = body.querySelector("#u_name").value.trim();
            const employeeNumber = body.querySelector("#u_emp").value.trim();
            const email = body.querySelector("#u_email").value.trim();
            const password = body.querySelector("#u_pwd").value;
            const role = body.querySelector("#u_role").value;
            const wantsAdmin = body.querySelector("#u_admin").checked;
            if (!name || !email || !password) throw new Error("יש למלא את כל שדות החובה");
            if (password.length < 6) throw new Error("סיסמה חייבת להיות לפחות 6 תווים");

            // Create on secondary auth so the current admin stays signed in.
            const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
            const newUid = cred.user.uid;

            const profile = {
              name,
              employeeNumber,
              email,
              role,
              isAdmin: !!wantsAdmin || isSuperAdminEmail(email),
              createdAt: new Date().toISOString(),
              createdBy: currentUser.uid
            };
            await createDocument(COLLECTION, profile, newUid);

            // Sign the secondary instance out so it doesn't keep that session.
            try { await secondarySignOut(secondaryAuth); } catch (_) { }

            toast("המשתמש נוצר בהצלחה", "success");
            close();
          } catch (e) {
            console.error(e);
            let msg = e.message || "שגיאה ביצירת המשתמש";
            if (e.code === "auth/email-already-in-use") msg = "האימייל כבר רשום במערכת";
            else if (e.code === "auth/invalid-email") msg = "אימייל לא תקין";
            else if (e.code === "auth/weak-password") msg = "סיסמה חלשה מדי";
            toast(msg, "error");
            btn.disabled = false; btn.textContent = "צור משתמש";
          }
        }
      }
    ]
  });
}

async function onToggleAdmin(u) {
  if (isSuperAdminEmail(u.email)) { toast("לא ניתן לשנות מנהל על", "error"); return; }
  const isPromoting = !u.isAdmin;
  // Protect last admin (unless super-admin is doing it).
  if (!isPromoting && adminCount() <= 1 && !currentUser.isSuperAdmin) {
    toast("לא ניתן להוריד את המנהל האחרון במערכת", "error");
    return;
  }
  const ok1 = await confirmDialog({
    title: isPromoting ? "הפיכה למנהל" : "הורדת הרשאת מנהל",
    message: isPromoting
      ? `להפוך את ${u.name || u.email} למנהל?`
      : `להוריד הרשאת מנהל מ-${u.name || u.email}?`,
    confirmText: "המשך",
    danger: !isPromoting
  });
  if (!ok1) return;
  const confirmText = await promptDialog({
    title: "אישור כפול",
    label: "הקלד את השם המלא של המשתמש כדי לאשר",
    placeholder: u.name || u.email
  });
  if (confirmText === null) return;
  if ((confirmText || "").trim() !== (u.name || u.email).trim()) {
    toast("האישור לא תואם — הפעולה בוטלה", "error"); return;
  }
  try {
    await updateDocument(COLLECTION, u.uid, { isAdmin: isPromoting });
    toast("בוצע", "success");
  } catch (e) { toast(e.message || "שגיאה", "error"); }
}

async function onDelete(u) {
  if (isSuperAdminEmail(u.email)) { toast("לא ניתן למחוק את מנהל העל", "error"); return; }
  if (u.uid === currentUser.uid) { toast("לא ניתן למחוק את עצמך", "error"); return; }
  if (u.isAdmin && adminCount() <= 1 && !currentUser.isSuperAdmin) {
    toast("לא ניתן למחוק את המנהל האחרון", "error"); return;
  }
  const ok1 = await confirmDialog({
    title: "מחיקת משתמש",
    message: `האם למחוק את ${u.name || u.email}?`,
    confirmText: "המשך", danger: true
  });
  if (!ok1) return;
  const confirmText = await promptDialog({
    title: "אישור כפול",
    label: 'הקלד "מחק" כדי לאשר את המחיקה',
    placeholder: "מחק"
  });
  if ((confirmText || "").trim() !== "מחק") { toast("הפעולה בוטלה", "error"); return; }
  try {
    await deleteDocument(COLLECTION, u.uid);
    toast("הרשומה נמחקה ממסד הנתונים", "success", 4000);
    toast("הערה: יש למחוק את חשבון ה-Auth ידנית מ-Firebase Console", "info", 5000);
  } catch (e) { toast(e.message || "שגיאה", "error"); }
}

async function onResetPassword(u) {
  if (!u.email) { toast("למשתמש אין כתובת אימייל", "error"); return; }
  const ok = await confirmDialog({
    title: "איפוס סיסמה",
    message: `לשלוח אימייל לאיפוס סיסמה אל ${u.email}?`,
    confirmText: "שלח"
  });
  if (!ok) return;
  try {
    await sendPasswordResetEmail(auth, u.email);
    toast("נשלח אימייל לאיפוס סיסמה", "success");
  } catch (e) {
    console.error(e);
    toast(e.message || "שגיאה בשליחת אימייל לאיפוס", "error");
  }
}

// Helper: ensures the super admin has a /users record (auto-created at login).
export async function ensureSuperAdminProfile(fbUser) {
  if (!isSuperAdminEmail(fbUser.email)) return;
  const profile = await getDocument(COLLECTION, fbUser.uid);
  if (!profile) {
    await createDocument(COLLECTION, {
      name: fbUser.displayName || "מנהל על",
      employeeNumber: "",
      email: fbUser.email,
      role: "ahmash",
      isAdmin: true,
      isSuperAdmin: true,
      createdAt: new Date().toISOString()
    }, fbUser.uid);
  } else {
    // Ensure flags are correct
    if (!profile.isAdmin || !profile.isSuperAdmin) {
      await updateDocument(COLLECTION, fbUser.uid, { isAdmin: true, isSuperAdmin: true });
    }
  }
}
