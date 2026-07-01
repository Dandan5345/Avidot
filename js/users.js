// User management (admins only).
// Uses a secondary Firebase Auth instance to create users without
// replacing the current admin's session.
import {
  createUserWithEmailAndPassword, signOut as secondarySignOut
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-functions.js";
import { secondaryAuth, isSuperAdminEmail, functionsClient } from "./firebase.js";
import {
  createDocument,
  deleteDocument,
  getDocument,
  subscribeCollection,
  updateDocument
} from "./firestoreStore.js";
import { isAdmin, isAhmash, currentUser } from "./auth.js";
import {
  escapeHtml, openModal, toast, confirmDialog, promptDialog, formatDateTime, usernameToEmailLocal, usernameFromEmail
} from "./utils.js";
import { logActivity } from "./activityLog.js";

const COLLECTION = "users";
const PASSWORD_RULE_TEXT = 'הסיסמה חייבת להכיל לפחות 6 תווים ולכלול אותיות ומספרים. המלצה: האות m ומספר העובד (לדוגמה: m21000).';
const USERNAME_DOMAIN = "@aovdim.com";
// שם המשתמש חייב להכיל לפחות 5 תווים ולא יכול להכיל רווחים.
// מותר: אנגלית, מספרים בלבד, ועברית.
const USERNAME_MIN_LENGTH = 5;
const deleteUserCompletelyCall = httpsCallable(functionsClient, "deleteUserCompletely");

let unsubscribe = null;
let allUsers = [];

// Table sorting. Default: admins → ahmash → kabat, then by name.
let sortKey = "role";
let sortDir = 1; // 1 = ascending, -1 = descending

// Rank for the default grouping: admin first, then ahmash, then kabat.
function roleRank(u) {
  if (u.isAdmin) return 0;
  if (u.role === "ahmash") return 1;
  return 2;
}

function usernameOf(u) {
  return u.username || usernameFromEmail(u.email);
}

function compareUsers(a, b) {
  let res = 0;
  switch (sortKey) {
    case "name": res = (a.name || "").localeCompare(b.name || "", "he"); break;
    case "employeeNumber": res = (a.employeeNumber || "").localeCompare(b.employeeNumber || "", "he", { numeric: true }); break;
    case "username": res = usernameOf(a).localeCompare(usernameOf(b), "he"); break;
    case "created": res = String(a.createdAt || "").localeCompare(String(b.createdAt || "")); break;
    case "admin": res = (a.isAdmin ? 0 : 1) - (b.isAdmin ? 0 : 1); break;
    case "role":
    default: res = roleRank(a) - roleRank(b); break;
  }
  // Stable tie-break by name so equal groups stay readable.
  if (res === 0 && sortKey !== "name") res = (a.name || "").localeCompare(b.name || "", "he");
  return res * sortDir;
}

function updateSortHeaders(container) {
  container.querySelectorAll("th[data-sort]").forEach((th) => {
    const base = th.textContent.replace(/[▲▼]\s*$/, "").trim();
    th.textContent = th.dataset.sort === sortKey ? `${base} ${sortDir === 1 ? "▲" : "▼"}` : base;
  });
}

// Permissions:
// - Admins / super-admin manage all users.
// - Ahmash (role "ahmash" without admin) can add/remove/manage ONLY kabat users.
function isRestrictedAhmash() {
  return !isAdmin() && currentUser.role === "ahmash";
}
function canManageUsersPage() {
  return isAhmash(); // admin OR ahmash
}
// Whether the current user may act on a specific target user.
function canManageTarget(target) {
  if (!target || isSuperAdminEmail(target.email)) return false;
  if (isAdmin()) return true;
  if (isRestrictedAhmash()) return target.role === "kabat" && !target.isAdmin;
  return false;
}
let hasLoadedSnapshot = false;
let loadError = "";
let initialLoadTimer = null;

export function renderUsers(container) {
  if (!canManageUsersPage()) {
    container.innerHTML = `
      <div class="page-title"><h2>ניהול משתמשים</h2></div>
      <div class="section-card"><p>אין לך הרשאה לדף זה.</p></div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-title">
      <h2>👥 ניהול משתמשים</h2>
      <div class="home-actions">
        ${isAdmin() ? `<button id="openLogBtn" class="btn btn-outline">📜 log</button>` : ""}
        <button id="addUserBtn" class="btn">➕ הוסף משתמש</button>
      </div>
    </div>

    <div class="modal-note" style="margin-bottom:14px">
      <strong>שים לב</strong>
      <span>שינוי סיסמה או שם משתמש נעשה דרך הכפתורים שבשורת המשתמש. המערכת יוצרת מחדש את המשתמש עם אותם פרטים בדיוק (שם, מספר עובד, תפקיד והרשאות) ורק עם השינוי המבוקש. שינוי שם משתמש דורש הזנת סיסמה מחדש (לא ניתן לשחזר סיסמה קיימת).</span>
    </div>

    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th data-sort="name" class="sortable">שם העובד</th><th data-sort="employeeNumber" class="sortable">מס' עובד</th><th data-sort="username" class="sortable">שם משתמש</th>
            <th data-sort="role" class="sortable">תפקיד</th><th data-sort="admin" class="sortable">סטטוס מנהל</th><th data-sort="created" class="sortable">נוצר</th><th>פעולות</th>
          </tr>
        </thead>
        <tbody id="usersTbody"><tr><td colspan="7" class="empty">טוען...</td></tr></tbody>
      </table>
    </div>
    <p class="muted" style="margin-top:10px">
      הערה: סיסמאות נשמרות באופן מאובטח על ידי Firebase Authentication ואינן מוצגות כאן.
      מחיקת משתמש מוחקת אותו לגמרי גם מ-Firebase Authentication.
    </p>
  `;

  container.querySelector("#addUserBtn").addEventListener("click", () => openAddUserModal());
  const logBtn = container.querySelector("#openLogBtn");
  if (logBtn) logBtn.addEventListener("click", () => { location.hash = "#/activity-log"; });

  // Clickable column headers to sort the table.
  container.querySelectorAll("th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (sortKey === key) sortDir = -sortDir;
      else { sortKey = key; sortDir = 1; }
      updateSortHeaders(container);
      renderTable(container.querySelector("#usersTbody"));
    });
  });
  updateSortHeaders(container);

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

  let visibleUsers = allUsers.filter((u) => !isSuperAdminEmail(u.email));
  // Ahmash (non-admin) only sees the kabat users they are allowed to manage.
  if (isRestrictedAhmash()) {
    visibleUsers = visibleUsers.filter((u) => u.role === "kabat" && !u.isAdmin);
  }

  if (!visibleUsers.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty">אין משתמשים</td></tr>`;
    return;
  }
  const sorted = visibleUsers.slice().sort(compareUsers);

  tbody.innerHTML = sorted.map((u) => {
    const superAdmin = isSuperAdminEmail(u.email);
    const isMe = u.uid === currentUser.uid;
    return `
      <tr data-uid="${escapeHtml(u.uid)}">
        <td>${escapeHtml(u.name || "")} ${isMe ? '<span class="badge blue">אתה</span>' : ""}</td>
        <td>${escapeHtml(u.employeeNumber || "")}</td>
        <td>${escapeHtml(usernameOf(u))}</td>
        <td>${u.role === "ahmash" ? '<span class="badge amber">אחמ"ש</span>' : '<span class="badge blue">קב"ט</span>'}</td>
        <td>${superAdmin
        ? '<span class="badge purple">מנהל על</span>'
        : (u.isAdmin ? '<span class="badge green">מנהל</span>' : '<span class="badge red">לא</span>')}
        </td>
        <td>${escapeHtml(u.createdAt ? formatDateTime(u.createdAt) : "")}</td>
        <td>
          ${superAdmin || !canManageTarget(u) ? '<span class="muted">מוגן</span>' : `
            <button class="btn btn-sm" data-action="edit">ערוך</button>
            ${isAdmin() ? `<button class="btn btn-sm btn-outline" data-action="toggleAdmin">${u.isAdmin ? "הורד הרשאת מנהל" : "הפוך למנהל"}</button>` : ""}
            <button class="btn btn-sm btn-secondary" data-action="setPassword">שינוי סיסמה</button>
            <button class="btn btn-sm btn-secondary" data-action="setUsername">שינוי שם משתמש</button>
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
        const action = btn.dataset.action;
        if (action === "toggleAdmin") {
          if (!isAdmin()) { toast("אין לך הרשאה לפעולה זו", "error"); return; }
          onToggleAdmin(u);
          return;
        }
        if (!canManageTarget(u)) { toast("אין לך הרשאה לנהל משתמש זה", "error"); return; }
        if (action === "edit") openEditUserModal(u);
        if (action === "delete") onDelete(u);
        if (action === "setPassword") openSetPasswordModal(u);
        if (action === "setUsername") openSetUsernameModal(u);
      });
    });
  });
}

function openAddUserModal() {
  openUserModal({
    title: "הוסף משתמש חדש",
    submitLabel: "צור משתמש",
    submitId: "createUserBtn",
    requirePassword: true,
    onSubmit: async ({ body, close, button }) => {
      button.disabled = true;
      button.innerHTML = `<span class="spinner"></span> יוצר...`;
      try {
        const form = readUserForm(body, { requirePassword: true });
        const cred = await createUserWithEmailAndPassword(secondaryAuth, form.email, form.password);
        const newUid = cred.user.uid;

        await createDocument(COLLECTION, {
          name: form.name,
          employeeNumber: form.employeeNumber,
          email: form.email,
          username: form.username,
          role: form.role,
          isAdmin: form.isAdmin || isSuperAdminEmail(form.email),
          createdAt: new Date().toISOString(),
          createdBy: currentUser.uid
        }, newUid);

        try { await secondarySignOut(secondaryAuth); } catch (_) { }

        await logActivity({
          action: "user.create",
          entityType: "user",
          entityId: newUid,
          summary: `${actorLabel()} יצר משתמש חדש: ${form.name}`,
          detailLines: [
            `אימייל: ${form.email}`,
            `מספר עובד: ${form.employeeNumber || "לא הוזן"}`,
            `תפקיד: ${form.role === "ahmash" ? 'אחמ"ש' : 'קב"ט'}`,
            `סטטוס מנהל: ${form.isAdmin ? "כן" : "לא"}`
          ]
        });

        toast("המשתמש נוצר בהצלחה", "success");
        close();
      } catch (e) {
        console.error(e);
        let msg = e.message || "שגיאה ביצירת המשתמש";
        if (e.code === "auth/email-already-in-use") msg = "שם המשתמש כבר תפוס במערכת";
        else if (e.code === "auth/invalid-email") msg = "שם משתמש לא תקין";
        else if (e.code === "auth/weak-password") msg = "סיסמה חלשה מדי";
        toast(msg, "error");
        button.disabled = false;
        button.textContent = "צור משתמש";
      }
    }
  });
}

function openEditUserModal(user) {
  openUserModal({
    title: `עריכת משתמש: ${user.name || user.email}`,
    submitLabel: "שמור שינויים",
    submitId: "saveUserBtn",
    requirePassword: false,
    user,
    onSubmit: async ({ body, close, button }) => {
      button.disabled = true;
      button.innerHTML = `<span class="spinner"></span> שומר...`;
      try {
        const form = readUserForm(body, { requirePassword: false });
        const detailLines = buildUserUpdateDetailLines(user, form);
        if (user.isAdmin && !form.isAdmin && adminCount() <= 1 && !currentUser.isSuperAdmin) {
          throw new Error("לא ניתן להוריד את המנהל האחרון במערכת");
        }
        await updateDocument(COLLECTION, user.uid, {
          name: form.name,
          employeeNumber: form.employeeNumber,
          role: form.role,
          isAdmin: form.isAdmin,
          updatedAt: new Date().toISOString(),
          updatedBy: currentUser.uid
        });
        await logActivity({
          action: "user.update",
          entityType: "user",
          entityId: user.uid,
          summary: `${actorLabel()} עדכן את המשתמש ${form.name}`,
          detailLines: detailLines.length ? detailLines : ["לא זוהו שדות שהשתנו בתצוגה"]
        });
        toast("פרטי המשתמש עודכנו", "success");
        if (user.uid === currentUser.uid) {
          toast("שינויים בהרשאות או בתפקיד יופיעו במלואם לאחר התחברות מחדש", "info", 4200);
        }
        close();
      } catch (e) {
        toast(e.message || "שגיאה בעדכון המשתמש", "error");
        button.disabled = false;
        button.textContent = "שמור שינויים";
      }
    }
  });
}

function openUserModal({ title, submitLabel, submitId, requirePassword, user = null, onSubmit }) {
  const modal = openModal({
    title,
    large: true,
    bodyHtml: userFormHtml({ user, requirePassword }),
    footerButtons: [
      { label: "ביטול", className: "btn-secondary", onClick: ({ close }) => close() },
      {
        label: submitLabel,
        className: "btn-success",
        id: submitId,
        onClick: async ({ body, close }) => {
          const button = document.getElementById(submitId);
          await onSubmit({ body, close, button });
        }
      }
    ]
  });

  wirePasswordToggles(modal.body);
  return modal;
}

function userFormHtml({ user = null, requirePassword }) {
  return `
    <form class="user-form">
      <div class="modal-note">
        <strong>${user ? "עדכון פרטי משתמש" : "יצירת משתמש חדש"}</strong>
        <span>${user ? "אפשר לעדכן שם, תפקיד, מספר עובד והרשאות. האימייל נשאר לקריאה בלבד כדי לא לשבור את ההתחברות." : "צור משתמש חדש עם פרטים מלאים והרשאות מתאימות."}</span>
      </div>
      <div class="form-grid compact-grid">
        <label class="field"><span>שם העובד</span>
          <input type="text" id="u_name" value="${escapeHtml(user?.name || "")}" required /></label>
        <label class="field"><span>מספר עובד</span>
          <input type="text" id="u_emp" value="${escapeHtml(user?.employeeNumber || "")}" /></label>
        ${!user ? `
        <label class="field full"><span>שם משתמש</span>
          <input type="text" id="u_username" required autocomplete="off" placeholder="לדוגמה: david123 / 22000 / דוד" />
          <small class="field-note">לפחות 5 תווים — אותיות (אנגלית או עברית) או מספרים, ללא רווחים.</small>
        </label>
        ` : `
        <label class="field full"><span>שם משתמש</span>
          <input type="text" value="${escapeHtml(user?.username || usernameFromEmail(user?.email))}" disabled />
          <input type="hidden" id="u_email" value="${escapeHtml(user?.email || "")}" />
          <small class="field-note">לשינוי שם המשתמש השתמש בכפתור "שינוי שם משתמש" שבשורת המשתמש.</small>
        </label>
        `}
        ${requirePassword ? `
          ${passwordFieldHtml({
    id: "u_pwd",
    label: "סיסמה",
    required: true,
    note: PASSWORD_RULE_TEXT
  })}` : ""}
        ${isRestrictedAhmash() ? `
        <label class="field"><span>תפקיד</span>
          <input type="text" value='קב"ט' disabled />
          <small class="field-note">אחמ"ש יכול להוסיף ולנהל משתמשי קב"ט בלבד.</small>
        </label>
        ` : `
        <label class="field"><span>תפקיד</span>
          <select id="u_role">
            <option value="kabat" ${user?.role === "kabat" ? "selected" : ""}>קב"ט</option>
            <option value="ahmash" ${user?.role === "ahmash" ? "selected" : ""}>אחמ"ש</option>
          </select></label>
        <label class="checkbox-row">
          <input type="checkbox" id="u_admin" ${user?.isAdmin ? "checked" : ""} />
          <span>סטטוס מנהל</span></label>
        `}
      </div>
    </form>`;
}

function readUserForm(body, { requirePassword }) {
  const name = body.querySelector("#u_name").value.trim();
  const employeeNumber = body.querySelector("#u_emp").value.trim();
  const roleField = body.querySelector("#u_role");
  const adminField = body.querySelector("#u_admin");
  // Restricted ahmash has no role/admin controls — force kabat, non-admin.
  const restricted = isRestrictedAhmash();
  const role = restricted ? "kabat" : (roleField ? roleField.value : "kabat");
  const isAdmin = restricted ? false : (adminField ? adminField.checked : false);
  const password = requirePassword ? body.querySelector("#u_pwd").value : "";

  if (!name) throw new Error("יש למלא שם עובד");
  if (!role) throw new Error("יש לבחור תפקיד");
  if (restricted && (role !== "kabat" || isAdmin)) {
    throw new Error("אחמ\"ש רשאי לנהל משתמשי קב\"ט בלבד");
  }

  let email = "";
  let username = "";
  if (requirePassword) {
    const usernameField = body.querySelector("#u_username");
    username = usernameField ? usernameField.value.trim() : "";
    validateUsername(username);
    email = usernameToEmailLocal(username) + USERNAME_DOMAIN;
    if (!password) throw new Error("יש למלא סיסמה");
  } else {
    const emailField = body.querySelector("#u_email");
    email = emailField ? emailField.value.trim() : "";
  }

  return { name, employeeNumber, email, username, role, isAdmin, password };
}

function passwordFieldHtml({ id, label, value = "", required = false, note = "" }) {
  return `
    <label class="field full"><span>${label}</span>
      <div class="password-shell">
        <input type="password" id="${id}" value="${escapeHtml(value)}" ${required ? "required" : ""} minlength="5" autocomplete="new-password" />
        <button type="button" class="password-toggle" data-toggle-password="${id}">הצג</button>
      </div>
      ${note ? `<small class="field-note">${escapeHtml(note)}</small>` : ""}
    </label>`;
}

function wirePasswordToggles(root) {
  root.querySelectorAll("[data-toggle-password]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = root.querySelector(`#${button.dataset.togglePassword}`);
      if (!input) return;
      const shouldShow = input.type === "password";
      input.type = shouldShow ? "text" : "password";
      button.textContent = shouldShow ? "הסתר" : "הצג";
    });
  });
}

function validateUsername(username, excludeUid = null) {
  if (!username) throw new Error("יש למלא שם משתמש");
  if (/\s/.test(username)) throw new Error("שם המשתמש לא יכול להכיל רווחים");
  // מותר: אותיות אנגלית, מספרים, אותיות עברית והתווים . _ -
  if (!/^[a-zA-Z0-9._\-֐-׿]+$/.test(username)) {
    throw new Error("שם המשתמש יכול להכיל אנגלית, מספרים או עברית בלבד (ללא רווחים)");
  }
  if ([...username].length < USERNAME_MIN_LENGTH) {
    throw new Error(`שם המשתמש חייב להכיל לפחות ${USERNAME_MIN_LENGTH} תווים`);
  }
  const emailToCheck = usernameToEmailLocal(username) + USERNAME_DOMAIN;
  if (allUsers.some((u) => u.uid !== excludeUid && u.email?.toLowerCase() === emailToCheck)) {
    throw new Error("שם המשתמש כבר תפוס");
  }
}

function callableErrorMessage(error, fallback) {
  const message = String(error?.message || "").replace(/^FirebaseError:\s*/i, "").trim();
  return message || fallback;
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
    await logActivity({
      action: isPromoting ? "user.promote_admin" : "user.demote_admin",
      entityType: "user",
      entityId: u.uid,
      summary: isPromoting
        ? `${actorLabel()} נתן הרשאת מנהל ל-${u.name || u.email}`
        : `${actorLabel()} הסיר הרשאת מנהל מ-${u.name || u.email}`,
      detailLines: [
        `אימייל: ${u.email || "לא ידוע"}`,
        `תפקיד נוכחי: ${u.role === "ahmash" ? 'אחמ"ש' : 'קב"ט'}`
      ]
    });
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
    await deleteUserCompletelyCall({ targetUid: u.uid });
    await logActivity({
      action: "user.delete",
      entityType: "user",
      entityId: u.uid,
      summary: `${actorLabel()} מחק את המשתמש ${u.name || u.email}`,
      detailLines: [
        `אימייל: ${u.email || "לא ידוע"}`,
        `מספר עובד: ${u.employeeNumber || "לא הוזן"}`
      ]
    });
    toast("המשתמש נמחק לגמרי מ-Firebase", "success", 4000);
  } catch (e) { toast(callableErrorMessage(e, "שגיאה במחיקת המשתמש"), "error"); }
}

// Changing an existing account's password/username by recreating it: build a new
// Firebase Auth user that keeps the same profile (name, employee number, role,
// admin status) plus the requested change, then delete the old account. Firebase
// never exposes the existing password, so a username change requires typing one.
async function recreateUserPreserving(oldUser, { newEmail, newUsername, password }) {
  const preserved = {
    name: oldUser.name || "",
    employeeNumber: oldUser.employeeNumber || "",
    role: oldUser.role || "kabat",
    isAdmin: !!oldUser.isAdmin,
    email: newEmail,
    username: newUsername,
    createdAt: oldUser.createdAt || new Date().toISOString(),
    createdBy: oldUser.createdBy || currentUser.uid || null
  };
  const emailChanged = newEmail.toLowerCase() !== String(oldUser.email || "").toLowerCase();

  if (emailChanged) {
    // New email is free — create the new account first (safe), then remove the old.
    const cred = await createUserWithEmailAndPassword(secondaryAuth, newEmail, password);
    try { await secondarySignOut(secondaryAuth); } catch (_) { }
    await createDocument(COLLECTION, preserved, cred.user.uid);
    await deleteUserCompletelyCall({ targetUid: oldUser.uid });
    return cred.user.uid;
  }

  // Same email (password change) — must delete the old account first to free the email.
  await deleteUserCompletelyCall({ targetUid: oldUser.uid });
  const cred = await createUserWithEmailAndPassword(secondaryAuth, newEmail, password);
  try { await secondarySignOut(secondaryAuth); } catch (_) { }
  await createDocument(COLLECTION, preserved, cred.user.uid);
  return cred.user.uid;
}

function assertCanRecreate(user) {
  if (isSuperAdminEmail(user.email)) throw new Error("לא ניתן לשנות את מנהל העל");
  if (user.uid === currentUser.uid) throw new Error("לא ניתן לשנות סיסמה או שם משתמש לעצמך בדרך זו");
  if (!canManageTarget(user)) throw new Error("אין לך הרשאה לנהל משתמש זה");
}

function assertPasswordOk(password, confirmPassword) {
  if (!password || !confirmPassword) throw new Error("יש למלא את שני שדות הסיסמה");
  if (password !== confirmPassword) throw new Error("אימות הסיסמה לא תואם");
  if (password.length < 6) throw new Error("הסיסמה חייבת להכיל לפחות 6 תווים");
}

function openSetPasswordModal(user) {
  const username = user.username || usernameFromEmail(user.email);
  const modal = openModal({
    title: `שינוי סיסמה: ${user.name || username}`,
    large: true,
    bodyHtml: `
      <form class="user-form">
        <div class="modal-note">
          <strong>שינוי סיסמה למשתמש</strong>
          <span>המשתמש ייווצר מחדש עם אותם פרטים בדיוק (שם, מספר עובד, תפקיד, הרשאות ושם משתמש) — רק הסיסמה תשתנה.</span>
        </div>
        <div class="form-grid compact-grid">
          ${passwordFieldHtml({ id: "set_pwd", label: "סיסמה חדשה", required: true, note: PASSWORD_RULE_TEXT })}
          ${passwordFieldHtml({ id: "set_pwd_confirm", label: "אימות סיסמה חדשה", required: true })}
        </div>
      </form>`,
    footerButtons: [
      { label: "ביטול", className: "btn-secondary", onClick: ({ close }) => close() },
      {
        label: "שמור סיסמה",
        className: "btn-success",
        id: "savePasswordBtn",
        onClick: async ({ body, close }) => {
          const button = document.getElementById("savePasswordBtn");
          button.disabled = true;
          button.innerHTML = `<span class="spinner"></span> שומר...`;
          try {
            assertCanRecreate(user);
            const password = body.querySelector("#set_pwd").value;
            const confirmPassword = body.querySelector("#set_pwd_confirm").value;
            assertPasswordOk(password, confirmPassword);
            await recreateUserPreserving(user, {
              newEmail: user.email,
              newUsername: username,
              password
            });
            await logActivity({
              action: "user.set_password",
              entityType: "user",
              entityId: user.uid,
              summary: `${actorLabel()} שינה סיסמה עבור ${user.name || user.email}`,
              detailLines: [`שם משתמש: ${username}`]
            });
            toast("הסיסמה עודכנה בהצלחה", "success", 4000);
            close();
          } catch (e) {
            toast(callableErrorMessage(e, "שגיאה בעדכון הסיסמה"), "error");
            button.disabled = false;
            button.textContent = "שמור סיסמה";
          }
        }
      }
    ]
  });

  wirePasswordToggles(modal.body);
}

function openSetUsernameModal(user) {
  const currentUsername = user.username || usernameFromEmail(user.email);
  const modal = openModal({
    title: `שינוי שם משתמש: ${user.name || currentUsername}`,
    large: true,
    bodyHtml: `
      <form class="user-form">
        <div class="modal-note">
          <strong>שינוי שם המשתמש (כניסה)</strong>
          <span>המשתמש ייווצר מחדש עם אותם פרטים (שם, מספר עובד, תפקיד, הרשאות). מכיוון שאי אפשר לשחזר את הסיסמה הקיימת מ-Firebase, יש להזין סיסמה חדשה עבור החשבון.</span>
        </div>
        <div class="form-grid">
          <label class="field full"><span>שם משתמש נוכחי</span>
            <input type="text" value="${escapeHtml(currentUsername)}" disabled />
          </label>
          <label class="field full"><span>שם משתמש חדש</span>
            <input type="text" id="new_username" autocomplete="off" placeholder="לדוגמה: david123 / 22000 / דוד" />
            <small class="field-note">לפחות 5 תווים — אותיות (אנגלית או עברית) או מספרים, ללא רווחים.</small>
          </label>
          ${passwordFieldHtml({ id: "uname_pwd", label: "סיסמה לחשבון", required: true, note: PASSWORD_RULE_TEXT })}
          ${passwordFieldHtml({ id: "uname_pwd_confirm", label: "אימות סיסמה", required: true })}
        </div>
      </form>`,
    footerButtons: [
      { label: "ביטול", className: "btn-secondary", onClick: ({ close }) => close() },
      {
        label: "שמור שם משתמש",
        className: "btn-success",
        id: "saveUsernameBtn",
        onClick: async ({ body, close }) => {
          const button = document.getElementById("saveUsernameBtn");
          button.disabled = true;
          button.innerHTML = `<span class="spinner"></span> שומר...`;
          try {
            assertCanRecreate(user);
            const newUsername = body.querySelector("#new_username").value.trim();
            validateUsername(newUsername, user.uid);
            const password = body.querySelector("#uname_pwd").value;
            const confirmPassword = body.querySelector("#uname_pwd_confirm").value;
            assertPasswordOk(password, confirmPassword);
            const newEmail = usernameToEmailLocal(newUsername) + USERNAME_DOMAIN;
            await recreateUserPreserving(user, { newEmail, newUsername, password });
            await logActivity({
              action: "user.set_username",
              entityType: "user",
              entityId: user.uid,
              summary: `${actorLabel()} שינה שם משתמש עבור ${user.name || user.email}`,
              detailLines: [`שם משתמש חדש: ${newUsername}`]
            });
            toast("שם המשתמש עודכן בהצלחה", "success", 4000);
            close();
          } catch (e) {
            toast(callableErrorMessage(e, "שגיאה בעדכון שם המשתמש"), "error");
            button.disabled = false;
            button.textContent = "שמור שם משתמש";
          }
        }
      }
    ]
  });

  wirePasswordToggles(modal.body);
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

function actorLabel() {
  return currentUser.name || currentUser.email || "משתמש";
}

function buildUserUpdateDetailLines(user, form) {
  const details = [];
  if ((user.name || "") !== form.name) details.push(`שם: ${user.name || "-"} -> ${form.name}`);
  if ((user.employeeNumber || "") !== form.employeeNumber) details.push(`מספר עובד: ${user.employeeNumber || "-"} -> ${form.employeeNumber || "-"}`);
  if ((user.role || "") !== form.role) details.push(`תפקיד: ${user.role === "ahmash" ? 'אחמ"ש' : 'קב"ט'} -> ${form.role === "ahmash" ? 'אחמ"ש' : 'קב"ט'}`);
  if (!!user.isAdmin !== !!form.isAdmin) details.push(`סטטוס מנהל: ${user.isAdmin ? "כן" : "לא"} -> ${form.isAdmin ? "כן" : "לא"}`);
  return details;
}
