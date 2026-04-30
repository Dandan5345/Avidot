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
import { isAdmin, currentUser } from "./auth.js";
import {
  escapeHtml, openModal, toast, confirmDialog, promptDialog, formatDateTime
} from "./utils.js";
import { logActivity } from "./activityLog.js";

const COLLECTION = "users";
const PASSWORD_RULE = /^(?=.*[A-Z])(?=.*\d).{6,}$/;
const PASSWORD_RULE_TEXT = 'הסיסמה חייבת להכיל לפחות 6 תווים, לפחות מספר אחד ולפחות אות אנגלית גדולה אחת';
const deleteUserCompletelyCall = httpsCallable(functionsClient, "deleteUserCompletely");
const setUserPasswordCall = httpsCallable(functionsClient, "setUserPassword");

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
        <button id="openLogBtn" class="btn btn-outline">📜 log</button>
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
      מנהל יכול לקבוע סיסמה חדשה ישירות מהמערכת וגם למחוק משתמש לגמרי מ-Firebase.
    </p>
  `;

  container.querySelector("#addUserBtn").addEventListener("click", () => openAddUserModal());
  container.querySelector("#openLogBtn").addEventListener("click", () => { location.hash = "#/activity-log"; });

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

  const visibleUsers = allUsers.filter((u) => !isSuperAdminEmail(u.email));

  if (!visibleUsers.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty">אין משתמשים</td></tr>`;
    return;
  }
  const sorted = visibleUsers.slice().sort((a, b) => {
    const aS = a.isAdmin ? 0 : 1;
    const bS = b.isAdmin ? 0 : 1;
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
            <button class="btn btn-sm" data-action="edit">ערוך</button>
            <button class="btn btn-sm btn-outline" data-action="toggleAdmin">${u.isAdmin ? "הורד הרשאת מנהל" : "הפוך למנהל"}</button>
            <button class="btn btn-sm btn-secondary" data-action="setPassword">קבע סיסמה</button>
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
        if (btn.dataset.action === "edit") openEditUserModal(u);
        if (btn.dataset.action === "toggleAdmin") onToggleAdmin(u);
        if (btn.dataset.action === "delete") onDelete(u);
        if (btn.dataset.action === "setPassword") openSetPasswordModal(u);
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
        if (e.code === "auth/email-already-in-use") msg = "האימייל כבר רשום במערכת";
        else if (e.code === "auth/invalid-email") msg = "אימייל לא תקין";
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
        <label class="field full"><span>אימייל</span>
          <input type="email" id="u_email" value="${escapeHtml(user?.email || "")}" ${user ? "disabled" : "required"} />
          ${user ? '<small class="field-note">שינוי אימייל דורש עדכון גם ב-Firebase Authentication ולכן חסום כאן.</small>' : ""}
        </label>
        ${requirePassword ? `
          ${passwordFieldHtml({
    id: "u_pwd",
    label: "סיסמה",
    required: true,
    note: PASSWORD_RULE_TEXT
  })}` : ""}
        <label class="field"><span>תפקיד</span>
          <select id="u_role">
            <option value="kabat" ${user?.role === "kabat" ? "selected" : ""}>קב"ט</option>
            <option value="ahmash" ${user?.role === "ahmash" ? "selected" : ""}>אחמ"ש</option>
          </select></label>
        <label class="checkbox-row">
          <input type="checkbox" id="u_admin" ${user?.isAdmin ? "checked" : ""} />
          <span>סטטוס מנהל</span></label>
      </div>
    </form>`;
}

function readUserForm(body, { requirePassword }) {
  const name = body.querySelector("#u_name").value.trim();
  const employeeNumber = body.querySelector("#u_emp").value.trim();
  const emailField = body.querySelector("#u_email");
  const email = emailField ? emailField.value.trim() : "";
  const role = body.querySelector("#u_role").value;
  const isAdmin = body.querySelector("#u_admin").checked;
  const password = requirePassword ? body.querySelector("#u_pwd").value : "";

  if (!name) throw new Error("יש למלא שם עובד");
  if (!role) throw new Error("יש לבחור תפקיד");
  if (requirePassword) {
    if (!email) throw new Error("יש למלא אימייל");
    if (!password) throw new Error("יש למלא סיסמה");
    assertStrongPassword(password);
  }

  return { name, employeeNumber, email, role, isAdmin, password };
}

function passwordFieldHtml({ id, label, value = "", required = false, note = "" }) {
  return `
    <label class="field full"><span>${label}</span>
      <div class="password-shell">
        <input type="password" id="${id}" value="${escapeHtml(value)}" ${required ? "required" : ""} minlength="6" autocomplete="new-password" />
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

function assertStrongPassword(password) {
  if (!PASSWORD_RULE.test(password)) {
    throw new Error(PASSWORD_RULE_TEXT);
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

function openSetPasswordModal(user) {
  const modal = openModal({
    title: `קביעת סיסמה: ${user.name || user.email}`,
    large: true,
    bodyHtml: `
      <form class="user-form">
        <div class="modal-note">
          <strong>קביעת סיסמה ידנית על ידי מנהל</strong>
          <span>הסיסמה החדשה תעודכן ישירות ב-Firebase Authentication בלי שליחת מייל למשתמש.</span>
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
            const password = body.querySelector("#set_pwd").value;
            const confirmPassword = body.querySelector("#set_pwd_confirm").value;
            if (!password || !confirmPassword) throw new Error("יש למלא את שני שדות הסיסמה");
            if (password !== confirmPassword) throw new Error("אימות הסיסמה לא תואם");
            assertStrongPassword(password);
            await setUserPasswordCall({ targetUid: user.uid, newPassword: password });
            await logActivity({
              action: "user.set_password",
              entityType: "user",
              entityId: user.uid,
              summary: `${actorLabel()} קבע סיסמה חדשה עבור ${user.name || user.email}`,
              detailLines: [`אימייל: ${user.email || "לא ידוע"}`]
            });
            toast("הסיסמה עודכנה בהצלחה", "success");
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
