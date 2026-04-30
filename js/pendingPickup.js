// Page 2: אבידות ממתינות לאיסוף
import {
  fetchAllItems, createItem, updateItem,
  findItemsByNumber, openItemDetailsModal, openReturnDetailsModal, deleteItem
} from "./itemsCommon.js";
import { subscribeCollection } from "./firestoreStore.js";
import { currentUser } from "./auth.js";
import {
  escapeHtml, formatDateTime, nowAsLocalInputValue, toIsoFromLocalInput,
  openModal, toast, filterItems, promptDialog, detailRows, confirmDialog
} from "./utils.js";
import { attachImageUpload, imageUploadFieldHtml } from "./imgbb.js";

const COLLECTION = "pendingPickup";
let unsubscribe = null;
let allItems = [];
let hasLoadedSnapshot = false;
let loadError = "";
let initialLoadTimer = null;
let viewState = { search: "", date: "", showReturned: false };

export function renderPendingPickup(container) {
  container.innerHTML = `
    <div class="page-title">
      <h2>📦 אבידות ממתינות לאיסוף</h2>
      <div class="home-actions">
        <button id="addBtn" class="btn">➕ הוסף אבידה</button>
        <button id="returnBtn" class="btn btn-success">↩️ אבידה הוחזרה</button>
      </div>
    </div>
    <div class="toolbar">
      <input type="text" id="searchInput" placeholder="🔍 חיפוש..." />
      <input type="date" id="dateInput" />
      <label class="checkbox-row" style="margin-inline-start:8px">
        <input type="checkbox" id="showReturned" />
        <span>הצג שנאספו</span>
      </label>
      <button id="clearFilters" class="btn btn-secondary btn-sm">נקה סינון</button>
      <span class="spacer"></span>
      <span class="muted" id="countLabel"></span>
    </div>
    <div class="table-wrap">
      <table class="data">
        <thead>
          <tr>
            <th>מס׳</th><th>תאריך</th><th>תיאור</th><th>בעלים</th>
            <th>טלפון</th><th>מיקום נוכחי</th><th>סטטוס</th><th>פעולות</th>
          </tr>
        </thead>
        <tbody id="tbody"><tr><td colspan="8" class="empty">טוען...</td></tr></tbody>
      </table>
    </div>
  `;

  const tbody = container.querySelector("#tbody");
  const countLabel = container.querySelector("#countLabel");
  const searchInput = container.querySelector("#searchInput");
  const dateInput = container.querySelector("#dateInput");
  const showReturnedCb = container.querySelector("#showReturned");
  const canDeleteItems = currentUser.role === "ahmash" || currentUser.isSuperAdmin;

  searchInput.addEventListener("input", () => { viewState.search = searchInput.value; render(); });
  dateInput.addEventListener("change", () => { viewState.date = dateInput.value; render(); });
  showReturnedCb.addEventListener("change", () => { viewState.showReturned = showReturnedCb.checked; render(); });
  container.querySelector("#clearFilters").addEventListener("click", () => {
    searchInput.value = ""; dateInput.value = ""; showReturnedCb.checked = false;
    viewState = { search: "", date: "", showReturned: false }; render();
  });
  container.querySelector("#addBtn").addEventListener("click", () => openAddModal());
  container.querySelector("#returnBtn").addEventListener("click", () => openReturnFlow());

  loadError = "";
  clearTimeout(initialLoadTimer);
  initialLoadTimer = setTimeout(() => {
    if (!hasLoadedSnapshot) {
      loadError = "אין תגובה מ-Firestore. בדוק את ההרשאות והחיבור לפרויקט Firebase.";
      render();
    }
  }, 5000);

  unsubscribe = subscribeCollection(COLLECTION, (items) => {
    clearTimeout(initialLoadTimer);
    allItems = items;
    hasLoadedSnapshot = true;
    loadError = "";
    render();
  }, (error) => {
    clearTimeout(initialLoadTimer);
    loadError = error?.message || "שגיאה בטעינת הנתונים";
    render();
  });

  if (hasLoadedSnapshot) render();

  function render() {
    if (loadError && !hasLoadedSnapshot) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty">${escapeHtml(loadError)}</td></tr>`;
      countLabel.textContent = "";
      return;
    }

    let items = filterItems(allItems, { search: viewState.search, dateFilter: viewState.date });
    if (!viewState.showReturned) items = items.filter((it) => !it.returned);
    items.sort((a, b) => (Number(b.number) || 0) - (Number(a.number) || 0));
    countLabel.textContent = `${items.length} פריטים`;
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty">אין רשומות להצגה</td></tr>`;
      return;
    }
    tbody.innerHTML = items.map((it) => `
      <tr data-id="${escapeHtml(it.id)}" class="${it.returned ? "returned" : ""}">
        <td>${escapeHtml(it.number)}</td>
        <td>${escapeHtml(formatDateTime(it.dateTime))}</td>
        <td>${escapeHtml(it.description || "")} ${it.valuable ? '<span class="badge purple">יקרת ערך</span>' : ""}</td>
        <td>${escapeHtml(it.ownerName || "")}</td>
        <td>${escapeHtml(it.ownerPhone || "")}</td>
        <td>${escapeHtml(it.currentLocation || "")}</td>
        <td>${it.returned ? '<span class="badge green">נאספה</span>' : '<span class="badge amber">ממתינה</span>'}</td>
        <td>
          ${it.returned ? `<button class="btn btn-sm btn-outline" data-action="return-info">פרטי איסוף</button>` : ""}
          ${canDeleteItems ? `<button class="btn btn-sm btn-danger" data-action="delete-item">מחק אבידה</button>` : ""}
        </td>
      </tr>`).join("");

    tbody.querySelectorAll("tr[data-id]").forEach((tr) => {
      const id = tr.getAttribute("data-id");
      tr.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-action]");
        if (btn) {
          e.stopPropagation();
          const it = allItems.find((x) => x.id === id);
          if (btn.dataset.action === "return-info") openReturnDetailsModal(it);
          if (btn.dataset.action === "delete-item") onDeleteItem(it);
          return;
        }
        const it = allItems.find((x) => x.id === id);
        if (it) openItemDetailsModal({ item: it, title: "פרטי אבידה ממתינה" });
      });
    });
  }

  // Pre-fill from transfer flow
  const pending = sessionStorage.getItem("transferToPendingPickup");
  if (pending) {
    sessionStorage.removeItem("transferToPendingPickup");
    try {
      const data = JSON.parse(pending);
      setTimeout(() => openAddModal({ prefill: data }), 100);
    } catch (_) { }
  }
}

export function teardownPendingPickup() {
  clearTimeout(initialLoadTimer);
  if (unsubscribe) {
    try { unsubscribe(); } catch (_) { }
    unsubscribe = null;
  }
}

async function onDeleteItem(item) {
  if (!item) return;
  const ok1 = await confirmDialog({
    title: "מחיקת אבידה",
    message: `למחוק לצמיתות את אבידה מספר ${item.number}?`,
    confirmText: "המשך",
    cancelText: "ביטול",
    danger: true
  });
  if (!ok1) return;

  const ok2 = await promptDialog({
    title: "אישור סופי",
    label: 'הקלד "מחק" כדי לאשר את המחיקה',
    placeholder: "מחק"
  });
  if ((ok2 || "").trim() !== "מחק") {
    toast("המחיקה בוטלה", "error");
    return;
  }

  try {
    await deleteItem(COLLECTION, item.id);
    toast("האבידה נמחקה", "success");
  } catch (e) {
    toast(e.message || "שגיאה במחיקה", "error");
  }
}

async function openAddModal({ prefill = null } = {}) {
  const existingMax = allItems.reduce((m, it) => Math.max(m, Number(it.number) || 0), 0);
  const suggestedNumber = existingMax + 1;

  const m = openModal({
    title: prefill ? "הוסף אבידה ממתינה (מהעברה)" : "הוסף אבידה ממתינה לאיסוף",
    large: true,
    bodyHtml: `
      <form id="addForm">
        <div class="form-grid">
          <label class="field"><span>מספר אבידה</span>
            <input type="number" id="f_number" value="${suggestedNumber}" required />
          </label>
          <label class="field"><span>תאריך ושעה</span>
            <input type="datetime-local" id="f_dateTime" value="${prefill && prefill.dateTime ? toLocalInput(prefill.dateTime) : nowAsLocalInputValue()}" required />
          </label>
          <label class="field full"><span>פירוט</span>
            <textarea id="f_description" required>${escapeHtml(prefill && prefill.description || "")}</textarea>
          </label>
          <label class="checkbox-row full">
            <input type="checkbox" id="f_valuable" ${prefill && prefill.valuable ? "checked" : ""} />
            <span>אבידת יקרת ערך</span>
          </label>
          <label class="field"><span>איפה זה נמצא</span>
            <input type="text" id="f_foundLocation" value="${escapeHtml(prefill && prefill.foundLocation || "")}" required />
          </label>
          <label class="field"><span>הקב"ט המטפל</span>
            <input type="text" id="f_kabatHandler" value="${escapeHtml(prefill && prefill.kabatHandler || currentUser.name || "")}" required />
          </label>
          <label class="field"><span>שם המוצא</span>
            <input type="text" id="f_finderName" value="${escapeHtml(prefill && prefill.finderName || "")}" />
          </label>
          <label class="field"><span>מחלקת המוצא</span>
            <input type="text" id="f_finderDept" value="${escapeHtml(prefill && prefill.finderDept || "")}" />
          </label>
          <label class="field"><span>שם בעל האבידה</span>
            <input type="text" id="f_ownerName" required />
          </label>
          <label class="field"><span>טלפון בעל האבידה</span>
            <input type="tel" id="f_ownerPhone" required />
          </label>
          <label class="field full"><span>איפה האבידה נמצאת כרגע</span>
            <input type="text" id="f_currentLocation" value="${escapeHtml(prefill && prefill.currentLocation || "")}" required />
          </label>
          <label class="field full"><span>פירוט נוסף</span>
            <textarea id="f_additionalDetails">${escapeHtml(prefill && prefill.additionalDetails || "")}</textarea>
          </label>
          ${imageUploadFieldHtml("תמונת אבידה (אופציונלי)")}
        </div>
      </form>`,
    footerButtons: [
      { label: "ביטול", className: "btn-secondary", onClick: ({ close }) => close() },
      {
        label: "שמור", className: "btn-success", id: "saveBtn2", onClick: async ({ body, close }) => {
          await save({ body, close, prefill });
        }
      }
    ]
  });

  const uploader = attachImageUpload(m.body);

  async function save({ body, close, prefill }) {
    const btn = document.getElementById("saveBtn2");
    btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> שומר...`;
    try {
      const number = Number(body.querySelector("#f_number").value);
      if (!Number.isFinite(number) || number <= 0) throw new Error("מספר לא תקין");
      const description = body.querySelector("#f_description").value.trim();
      if (!description) throw new Error("יש להזין פירוט");
      const ownerName = body.querySelector("#f_ownerName").value.trim();
      const ownerPhone = body.querySelector("#f_ownerPhone").value.trim();
      if (!ownerName || !ownerPhone) throw new Error("יש להזין פרטי בעל האבידה");

      let photoUrl = (prefill && prefill.photoUrl) || null;
      try {
        const url = await uploader.getUrl();
        if (url) photoUrl = url;
      } catch (e) {
        toast(e.message || "שגיאה בהעלאת תמונה", "error");
        btn.disabled = false; btn.textContent = "שמור"; return;
      }

      const payload = {
        number,
        dateTime: toIsoFromLocalInput(body.querySelector("#f_dateTime").value) || new Date().toISOString(),
        description,
        valuable: body.querySelector("#f_valuable").checked,
        foundLocation: body.querySelector("#f_foundLocation").value.trim(),
        finderName: body.querySelector("#f_finderName").value.trim(),
        finderDept: body.querySelector("#f_finderDept").value.trim(),
        kabatHandler: body.querySelector("#f_kabatHandler").value.trim(),
        ownerName, ownerPhone,
        currentLocation: body.querySelector("#f_currentLocation").value.trim(),
        additionalDetails: body.querySelector("#f_additionalDetails").value.trim(),
        photoUrl: photoUrl || null,
        returned: false,
        createdAt: new Date().toISOString(),
        createdBy: currentUser.uid || null,
        createdByName: currentUser.name || ""
      };
      await createItem(COLLECTION, payload);

      if (prefill && prefill.__sourceCollection && prefill.__sourceId) {
        try { await deleteItem(prefill.__sourceCollection, prefill.__sourceId); }
        catch (e) { console.warn(e); }
      }

      toast("האבידה נוספה בהצלחה", "success");
      close();
    } catch (e) {
      toast(e.message || "שגיאה בשמירה", "error");
      btn.disabled = false; btn.textContent = "שמור";
    }
  }
}

function toLocalInput(iso) {
  if (!iso) return nowAsLocalInputValue();
  const d = new Date(iso);
  if (isNaN(d)) return nowAsLocalInputValue();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function openReturnFlow() {
  const numStr = await promptDialog({ title: "החזרת אבידה", label: "הזן מספר אבידה" });
  if (numStr === null) return;
  const num = Number(numStr);
  if (!num) { toast("מספר אבידה לא תקין", "error"); return; }

  const matches = (await findItemsByNumber(COLLECTION, num)).filter((it) => !it.returned);
  if (!matches.length) { toast("לא נמצאה רשומה ממתינה במספר הזה", "error"); return; }

  let chosen;
  if (matches.length === 1) chosen = matches[0];
  else {
    chosen = await chooseAmongMatches(matches);
    if (!chosen) return;
  }
  openReturnFormModal(chosen);
}

function chooseAmongMatches(matches) {
  return new Promise((resolve) => {
    const html = `
      <p class="muted">נמצאו מספר רשומות עם אותו המספר. בחר את הרשומה הנכונה:</p>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>תאריך</th><th>בעלים</th><th>תיאור</th><th></th></tr></thead>
        <tbody>${matches.map((it) => `
          <tr><td>${escapeHtml(formatDateTime(it.dateTime))}</td><td>${escapeHtml(it.ownerName || "")}</td><td>${escapeHtml(it.description || "")}</td>
          <td><button class="btn btn-sm" data-id="${escapeHtml(it.id)}">בחר</button></td></tr>`).join("")}
        </tbody></table></div>`;
    const m = openModal({
      title: "פתרון קונפליקט", large: true, bodyHtml: html,
      footerButtons: [{ label: "ביטול", className: "btn-secondary", onClick: ({ close }) => { close(); resolve(null); } }],
      onClose: () => resolve(null)
    });
    m.body.querySelectorAll("button[data-id]").forEach((b) => {
      b.addEventListener("click", () => {
        const it = matches.find((x) => x.id === b.dataset.id);
        m.close(); resolve(it);
      });
    });
  });
}

function openReturnFormModal(item) {
  const summary = detailRows([
    { label: "מספר", value: item.number },
    { label: "תאריך", value: formatDateTime(item.dateTime) },
    { label: "תיאור", value: item.description },
    { label: "בעלים", value: item.ownerName }
  ]);
  openModal({
    title: "פרטי איסוף",
    bodyHtml: `
      <div class="section-card" style="background:#eff6ff;border-color:#bfdbfe">
        <div class="muted" style="margin-bottom:6px;font-weight:600;color:#1e3a8a">פרטי האבידה:</div>
        ${summary}
      </div>
      <div class="form-grid">
        <label class="field full"><span>שם מלא של המקבל</span>
          <input type="text" id="r_receiverName" value="${escapeHtml(item.ownerName || "")}" required />
        </label>
        <label class="field full"><span>טלפון או תעודת זהות</span>
          <input type="text" id="r_receiverContact" value="${escapeHtml(item.ownerPhone || "")}" required />
        </label>
        <label class="field full"><span>שם הקב"ט שטיפל</span>
          <input type="text" id="r_handlerName" value="${escapeHtml(currentUser.name || "")}" required />
        </label>
      </div>`,
    footerButtons: [
      { label: "ביטול", className: "btn-secondary", onClick: ({ close }) => close() },
      {
        label: "אישור איסוף", className: "btn-success", onClick: async ({ body, close }) => {
          const receiverName = body.querySelector("#r_receiverName").value.trim();
          const receiverContact = body.querySelector("#r_receiverContact").value.trim();
          const handlerName = body.querySelector("#r_handlerName").value.trim();
          if (!receiverName || !receiverContact || !handlerName) { toast("יש למלא את כל השדות", "error"); return; }
          try {
            await updateItem(COLLECTION, item.id, {
              returned: true,
              returnDetails: {
                receiverName, receiverContact, handlerName,
                returnedAt: new Date().toISOString(),
                returnedBy: currentUser.uid || null
              }
            });
            toast("האבידה סומנה כנאספה", "success");
            close();
          } catch (e) { toast(e.message || "שגיאה", "error"); }
        }
      }
    ]
  });
}
