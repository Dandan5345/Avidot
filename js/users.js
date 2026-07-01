// User management (admins only).
// Regular users live entirely in Firestore (username/usernameLower/passwordHash/
// passwordSalt on the users/{id} doc) — no Firebase Auth account, no Cloud
// Functions/Admin SDK. Only the super admin still uses Firebase Auth; it never
// appears in this table. See project memory "firestore-auth-migration-plan".
import { isSuperAdminEmail } from "./firebase.js";
import {
  createDocument,
  deleteDocument,
  getDocument,
  subscribeCollection,
  updateDocument
} from "./firestoreStore.js";
import { isAdmin, isAhmash, currentUser } from "./auth.js";
import {
  escapeHtml, openModal, toast, confirmDialog, promptDialog, formatDateTime,
  usernameToEmailLocal, usernameFromEmail, generateSalt, hashPassword
} from "./utils.js";
import { logActivity } from "./activityLog.js";

const COLLECTION = "users";
const PASSWORD_RULE_TEXT = 'הסיסמה חייבת להכיל לפחות 6 תווים ולכלול אותיות ומספרים. המלצה: האות m ומספר העובד (לדוגמה: m21000).';
// Domain kept only to recognize legacy (pre-Firestore) usernames for uniqueness checks.
const USERNAME_DOMAIN = "@aovdim.com";
// שם המשתמש חייב להכיל לפחות 5 תווים ולא יכול להכיל רווחים.
// מותר: אנגלית, מספרים בלבד, ועברית.
const USERNAME_MIN_LENGTH = 5;

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

// A user who has completed the Firestore migration (has a password hash).
function isFirestoreAuth(u) {
  return !!(u && u.passwordHash && u.passwordSalt);
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
      <span>שינוי סיסמה או שם משתמש נעשה דרך הכפתורים שבשורת המשתמש ומעדכן רק את הפרט המבוקש — שאר הפרטים (שם, מספר עובד, תפקיד והרשאות) נשארים ללא שינוי. משתמשים ישנים שטרם הועברו לכניסה דרך פיירסטור מסומנים בכפתור "החלף למשתמש פיירסטור".</span>
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
      הערה: הסיסמאות נשמרות באופן מוצפן (hash) במסד הנתונים ואינן מוצגות כאן.
      מחיקת משתמש מוחקת את כרטיס המשתמש לגמרי.
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
            ${isFirestoreAuth(u) ? `
              <button class="btn btn-sm btn-secondary" data-action="setPassword">שינוי סיסמה</button>
              <button class="btn btn-sm btn-secondary" data-action="setUsername">שינוי שם משתמש</button>
            ` : `
              <button class="btn btn-sm btn-warn" data-action="migrate">החלף למשתמש פיירסטור</button>
            `}
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
        if (action === "migrate") openMigrateUserModal(u);
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
        validateUsername(form.username);
        const salt = generateSalt();
        const passwordHash = await hashPassword(salt, form.password);

        const newUid = await createDocument(COLLECTION, {
          name: form.name,
          employeeNumber: form.employeeNumber,
          username: form.username,
          usernameLower: form.username.toLowerCase(),
          passwordHash,
          passwordSalt: salt,
          firestoreAuth: true,
          role: form.role,
          isAdmin: form.isAdmin,
          createdAt: new Date().toISOString(),
          createdBy: currentUser.uid
        });

        await logActivity({
          action: "user.create",
          entityType: "user",
          entityId: newUid,
          summary: `${actorLabel()} יצר משתמש חדש: ${form.name}`,
          detailLines: [
            `שם משתמש: ${form.username}`,
            `מספר עובד: ${form.employeeNumber || "לא הוזן"}`,
            `תפקיד: ${form.role === "ahmash" ? 'אחמ"ש' : 'קב"ט'}`,
            `סטטוס מנהל: ${form.isAdmin ? "כן" : "לא"}`
          ]
        });

        toast("המשתמש נוצר בהצלחה", "success");
        close();
      } catch (e) {
        console.error(e);
        toast(e.message || "שגיאה ביצירת המשתמש", "error");
        button.disabled = false;
        button.textContent = "צור משתמש";
      }
    }
  });
}

function openEditUserModal(user) {
  openUserModal({
    title: `עריכת משתמש: ${user.name || usernameOf(user)}`,
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
        <span>${user ? "אפשר לעדכן שם, תפקיד, מספר עובד והרשאות. שם המשתמש נשאר לקריאה בלבד כדי לא לשבור את ההתחברות." : "צור משתמש חדש עם פרטים מלאים והרשאות מתאימות."}</span>
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
          <input type="text" value="${escapeHtml(usernameOf(user))}" disabled />
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

  let username = "";
  if (requirePassword) {
    const usernameField = body.querySelector("#u_username");
    username = usernameField ? usernameField.value.trim() : "";
    if (!password) throw new Error("יש למלא סיסמה");
    if (password.length < 6) throw new Error("הסיסמה חייבת להכיל לפחות 6 תווים");
  }

  return { name, employeeNumber, username, role, isAdmin, password };
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
  const usernameLower = username.toLowerCase();
  const legacyEmail = usernameToEmailLocal(username) + USERNAME_DOMAIN;
  const taken = allUsers.some((u) => {
    if (u.uid === excludeUid) return false;
    if (u.usernameLower && u.usernameLower === usernameLower) return true;
    return u.email?.toLowerCase() === legacyEmail;
  });
  if (taken) throw new Error("שם המשתמש כבר תפוס");
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
        `שם משתמש: ${usernameOf(u)}`,
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
    await deleteDocument(COLLECTION, u.uid);
    await logActivity({
      action: "user.delete",
      entityType: "user",
      entityId: u.uid,
      summary: `${actorLabel()} מחק את המשתמש ${u.name || u.email}`,
      detailLines: [
        `שם משתמש: ${usernameOf(u)}`,
        `מספר עובד: ${u.employeeNumber || "לא הוזן"}`
      ]
    });
    toast("המשתמש נמחק", "success", 4000);
  } catch (e) { toast(e.message || "שגיאה במחיקת המשתמש", "error"); }
}

function assertCanManage(user) {
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
  const username = usernameOf(user);
  const modal = openModal({
    title: `שינוי סיסמה: ${user.name || username}`,
    large: true,
    bodyHtml: `
      <form class="user-form">
        <div class="modal-note">
          <strong>שינוי סיסמה למשתמש</strong>
          <span>שאר הפרטים (שם, מספר עובד, תפקיד, הרשאות ושם משתמש) נשארים ללא שינוי — רק הסיסמה תתעדכן.</span>
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
            assertCanManage(user);
            const password = body.querySelector("#set_pwd").value;
            const confirmPassword = body.querySelector("#set_pwd_confirm").value;
            assertPasswordOk(password, confirmPassword);
            const salt = generateSalt();
            const passwordHash = await hashPassword(salt, password);
            await updateDocument(COLLECTION, user.uid, {
              passwordHash,
              passwordSalt: salt,
              passwordUpdatedAt: new Date().toISOString(),
              passwordUpdatedBy: currentUser.uid
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
            toast(e.message || "שגיאה בעדכון הסיסמה", "error");
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
  const currentUsername = usernameOf(user);
  const modal = openModal({
    title: `שינוי שם משתמש: ${user.name || currentUsername}`,
    large: true,
    bodyHtml: `
      <form class="user-form">
        <div class="modal-note">
          <strong>שינוי שם המשתמש (כניסה)</strong>
          <span>שאר הפרטים (שם, מספר עובד, תפקיד, הרשאות והסיסמה) נשארים ללא שינוי.</span>
        </div>
        <div class="form-grid">
          <label class="field full"><span>שם משתמש נוכחי</span>
            <input type="text" value="${escapeHtml(currentUsername)}" disabled />
          </label>
          <label class="field full"><span>שם משתמש חדש</span>
            <input type="text" id="new_username" autocomplete="off" placeholder="לדוגמה: david123 / 22000 / דוד" />
            <small class="field-note">לפחות 5 תווים — אותיות (אנגלית או עברית) או מספרים, ללא רווחים.</small>
          </label>
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
            assertCanManage(user);
            const newUsername = body.querySelector("#new_username").value.trim();
            validateUsername(newUsername, user.uid);
            await updateDocument(COLLECTION, user.uid, {
              username: newUsername,
              usernameLower: newUsername.toLowerCase(),
              usernameUpdatedAt: new Date().toISOString(),
              usernameUpdatedBy: currentUser.uid
            });
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
            toast(e.message || "שגיאה בעדכון שם המשתמש", "error");
            button.disabled = false;
            button.textContent = "שמור שם משתמש";
          }
        }
      }
    ]
  });

  wirePasswordToggles(modal.body);
}

// Migration for legacy (pre-Firestore) users: same doc id, just adds
// username/usernameLower/passwordHash/passwordSalt so Firestore login works.
// Their old Firebase Auth account (if any) is left untouched but is no longer
// reachable via the login form for non-super-admin accounts.
function openMigrateUserModal(user) {
  const currentUsername = usernameOf(user);
  const modal = openModal({
    title: `החלף למשתמש פיירסטור: ${user.name || currentUsername}`,
    large: true,
    bodyHtml: `
      <form class="user-form">
        <div class="modal-note">
          <strong>העברת המשתמש לכניסה דרך פיירסטור</strong>
          <span>הפרטים הקיימים (שם, מספר עובד, תפקיד והרשאות) נשארים בדיוק כפי שהם. יש לבחור שם משתמש וסיסמה לכניסה — לא ניתן לשחזר את הסיסמה הישנה.</span>
        </div>
        <div class="form-grid">
          <label class="field full"><span>שם משתמש נוכחי</span>
            <input type="text" value="${escapeHtml(currentUsername)}" disabled />
          </label>
          <label class="field full"><span>שם משתמש</span>
            <input type="text" id="mig_username" autocomplete="off" value="${escapeHtml(currentUsername)}" placeholder="לדוגמה: david123 / 22000 / דוד" />
            <small class="field-note">לפחות 5 תווים — אותיות (אנגלית או עברית) או מספרים, ללא רווחים.</small>
          </label>
          ${passwordFieldHtml({ id: "mig_pwd", label: "סיסמה חדשה", required: true, note: PASSWORD_RULE_TEXT })}
          ${passwordFieldHtml({ id: "mig_pwd_confirm", label: "אימות סיסמה חדשה", required: true })}
        </div>
      </form>`,
    footerButtons: [
      { label: "ביטול", className: "btn-secondary", onClick: ({ close }) => close() },
      {
        label: "העבר לפיירסטור",
        className: "btn-success",
        id: "migrateUserBtn",
        onClick: async ({ body, close }) => {
          const button = document.getElementById("migrateUserBtn");
          button.disabled = true;
          button.innerHTML = `<span class="spinner"></span> מעביר...`;
          try {
            assertCanManage(user);
            const newUsername = body.querySelector("#mig_username").value.trim();
            validateUsername(newUsername, user.uid);
            const password = body.querySelector("#mig_pwd").value;
            const confirmPassword = body.querySelector("#mig_pwd_confirm").value;
            assertPasswordOk(password, confirmPassword);
            const salt = generateSalt();
            const passwordHash = await hashPassword(salt, password);
            await updateDocument(COLLECTION, user.uid, {
              username: newUsername,
              usernameLower: newUsername.toLowerCase(),
              passwordHash,
              passwordSalt: salt,
              firestoreAuth: true,
              migratedAt: new Date().toISOString(),
              migratedBy: currentUser.uid
            });
            await logActivity({
              action: "user.migrate_to_firestore",
              entityType: "user",
              entityId: user.uid,
              summary: `${actorLabel()} העביר את ${user.name || user.email} לכניסה דרך פיירסטור`,
              detailLines: [`שם משתמש: ${newUsername}`]
            });
            toast("המשתמש הועבר לכניסה דרך פיירסטור בהצלחה", "success", 4000);
            close();
          } catch (e) {
            toast(e.message || "שגיאה בהעברת המשתמש", "error");
            button.disabled = false;
            button.textContent = "העבר לפיירסטור";
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
