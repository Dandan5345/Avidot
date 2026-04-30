// Page 3: אבידות שמחכות למידע
import {
  createItem, updateItem, openItemDetailsModal, deleteItem
} from "./itemsCommon.js";
import { subscribeCollection } from "./firestoreStore.js";
import { currentUser } from "./auth.js";
import {
  escapeHtml, formatDateTime, nowAsLocalInputValue, toIsoFromLocalInput,
  openModal, toast, filterItems, detailRows, confirmDialog, promptDialog
} from "./utils.js";
import { attachImageUpload, imageUploadFieldHtml } from "./imgbb.js";

const COLLECTION = "awaitingInfo";
let unsubscribe = null;
let allItems = [];
let hasLoadedSnapshot = false;
let loadError = "";
let initialLoadTimer = null;
let viewState = { search: "", date: "" };

export function renderAwaitingInfo(container) {
  container.innerHTML = `
    <div class="page-title">
      <h2>⏳ אבידות שמחכות למידע</h2>
      <div class="home-actions">
        <button id="addBtn" class="btn">➕ הוסף אבידה</button>
      </div>
    </div>
    <div class="toolbar">
      <input type="text" id="searchInput" placeholder="🔍 חיפוש..." />
      <input type="date" id="dateInput" />
      <button id="clearFilters" class="btn btn-secondary btn-sm">נקה סינון</button>
      <span class="spacer"></span>
      <span class="muted" id="countLabel"></span>
    </div>
    <div class="table-wrap">
      <table class="data">
        <thead><tr>
          <th>מס׳</th><th>תאריך</th><th>תיאור</th><th>איפה נמצא</th>
          <th>מיקום נוכחי</th><th>קב״ט מטפל</th><th>פעולות</th>
        </tr></thead>
        <tbody id="tbody"><tr><td colspan="7" class="empty">טוען...</td></tr></tbody>
      </table>
    </div>
  `;

  const tbody = container.querySelector("#tbody");
  const countLabel = container.querySelector("#countLabel");
  const searchInput = container.querySelector("#searchInput");
  const dateInput = container.querySelector("#dateInput");
  const canDeleteItems = currentUser.role === "ahmash" || currentUser.isSuperAdmin;

  searchInput.addEventListener("input", () => { viewState.search = searchInput.value; render(); });
  dateInput.addEventListener("change", () => { viewState.date = dateInput.value; render(); });
  container.querySelector("#clearFilters").addEventListener("click", () => {
    searchInput.value = ""; dateInput.value = "";
    viewState = { search: "", date: "" }; render();
  });
  container.querySelector("#addBtn").addEventListener("click", () => openAddModal());

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
      tbody.innerHTML = `<tr><td colspan="7" class="empty">${escapeHtml(loadError)}</td></tr>`;
      countLabel.textContent = "";
      return;
    }

    let items = filterItems(allItems, { search: viewState.search, dateFilter: viewState.date });
    items.sort((a, b) => (Number(b.number) || 0) - (Number(a.number) || 0));
    countLabel.textContent = `${items.length} פריטים`;
    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty">אין רשומות להצגה</td></tr>`;
      return;
    }
    tbody.innerHTML = items.map((it) => `
      <tr data-id="${escapeHtml(it.id)}">
        <td>${escapeHtml(it.number)}</td>
        <td>${escapeHtml(formatDateTime(it.dateTime))}</td>
        <td>${escapeHtml(it.description || "")} ${it.valuable ? '<span class="badge purple">יקרת ערך</span>' : ""}</td>
        <td>${escapeHtml(it.foundLocation || "")}</td>
        <td>${escapeHtml(it.currentLocation || "")}</td>
        <td>${escapeHtml(it.kabatHandler || "")}</td>
        <td>
          <button class="btn btn-sm btn-warn" data-action="transfer">↪️ העבר אבידה</button>
          ${canDeleteItems ? `<button class="btn btn-sm btn-danger" data-action="delete-item">מחק אבידה</button>` : ""}
        </td>
      </tr>
    `).join("");

    tbody.querySelectorAll("tr[data-id]").forEach((tr) => {
      const id = tr.getAttribute("data-id");
      tr.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-action]");
        if (btn) {
          e.stopPropagation();
          const it = allItems.find((x) => x.id === id);
          if (btn.dataset.action === "transfer") openTransferModal(it);
          if (btn.dataset.action === "delete-item") onDeleteItem(it);
          return;
        }
        const it = allItems.find((x) => x.id === id);
        if (it) openItemDetailsModal({ item: it, title: "פרטי אבידה ממתינה למידע" });
      });
    });
  }
}

export function teardownAwaitingInfo() {
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

async function openAddModal() {
  const existingMax = allItems.reduce((m, it) => Math.max(m, Number(it.number) || 0), 0);
  const suggestedNumber = existingMax + 1;

  const m = openModal({
    title: "הוסף אבידה (ממתינה למידע)",
    large: true,
    bodyHtml: `
      <form>
        <div class="form-grid">
          <label class="field"><span>מספר אבידה</span>
            <input type="number" id="f_number" value="${suggestedNumber}" required /></label>
          <label class="field"><span>תאריך ושעה</span>
            <input type="datetime-local" id="f_dateTime" value="${nowAsLocalInputValue()}" required /></label>
          <label class="field full"><span>פירוט</span>
            <textarea id="f_description" required></textarea></label>
          <label class="checkbox-row full">
            <input type="checkbox" id="f_valuable" /><span>אבידת יקרת ערך</span></label>
          <label class="field"><span>איפה זה נמצא</span>
            <input type="text" id="f_foundLocation" required /></label>
          <label class="field"><span>הקב"ט המטפל</span>
            <input type="text" id="f_kabatHandler" value="${escapeHtml(currentUser.name || "")}" required /></label>
          <label class="field"><span>שם המוצא</span>
            <input type="text" id="f_finderName" /></label>
          <label class="field"><span>מחלקת המוצא</span>
            <input type="text" id="f_finderDept" /></label>
          <label class="field full"><span>איפה האבידה כרגע</span>
            <input type="text" id="f_currentLocation" required /></label>
          <label class="field full"><span>פירוט נוסף</span>
            <textarea id="f_additionalDetails"></textarea></label>
          ${imageUploadFieldHtml("תמונת אבידה (אופציונלי)")}
        </div>
      </form>`,
    footerButtons: [
      { label: "ביטול", className: "btn-secondary", onClick: ({ close }) => close() },
      {
        label: "שמור", className: "btn-success", id: "saveBtn3", onClick: async ({ body, close }) => {
          await save({ body, close });
        }
      }
    ]
  });

  const uploader = attachImageUpload(m.body);

  async function save({ body, close }) {
    const btn = document.getElementById("saveBtn3");
    btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> שומר...`;
    try {
      const number = Number(body.querySelector("#f_number").value);
      if (!Number.isFinite(number) || number <= 0) throw new Error("מספר לא תקין");
      const description = body.querySelector("#f_description").value.trim();
      if (!description) throw new Error("יש להזין פירוט");

      let photoUrl = null;
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
        currentLocation: body.querySelector("#f_currentLocation").value.trim(),
        additionalDetails: body.querySelector("#f_additionalDetails").value.trim(),
        photoUrl: photoUrl || null,
        createdAt: new Date().toISOString(),
        createdBy: currentUser.uid || null,
        createdByName: currentUser.name || ""
      };
      await createItem(COLLECTION, payload);
      toast("האבידה נוספה בהצלחה", "success");
      close();
    } catch (e) {
      toast(e.message || "שגיאה בשמירה", "error");
      btn.disabled = false; btn.textContent = "שמור";
    }
  }
}

// ===== Transfer flow =====
function openTransferModal(item) {
  const summary = detailRows([
    { label: "מספר", value: item.number },
    { label: "תאריך", value: formatDateTime(item.dateTime) },
    { label: "תיאור", value: item.description },
    { label: "איפה נמצא", value: item.foundLocation },
    { label: "מיקום נוכחי", value: item.currentLocation }
  ]);

  const m = openModal({
    title: "העברת אבידה",
    bodyHtml: `
      <div class="section-card" style="background:#fef3c7;border-color:#fcd34d">
        <div class="muted" style="font-weight:600;color:#92400e;margin-bottom:6px">פרטי האבידה:</div>
        ${summary}
      </div>
      <p style="margin:14px 0 6px;font-weight:600">לאן להעביר?</p>
      <div class="flex gap-12 wrap">
        <button class="btn" id="toLost">לאבידות</button>
        <button class="btn btn-warn" id="toPending">לאבידות ממתינות לאיסוף</button>
      </div>`,
    footerButtons: [{ label: "ביטול", className: "btn-secondary", onClick: ({ close }) => close() }]
  });

  m.body.querySelector("#toLost").addEventListener("click", () => {
    const data = {
      dateTime: item.dateTime,
      description: item.description,
      valuable: !!item.valuable,
      foundLocation: item.foundLocation,
      finderName: item.finderName,
      finderDept: item.finderDept,
      kabatHandler: item.kabatHandler,
      photoUrl: item.photoUrl,
      __sourceCollection: COLLECTION,
      __sourceId: item.id
    };
    sessionStorage.setItem("transferToLostItems", JSON.stringify(data));
    m.close();
    location.hash = "#/lost-items";
  });
  m.body.querySelector("#toPending").addEventListener("click", () => {
    const data = {
      dateTime: item.dateTime,
      description: item.description,
      valuable: !!item.valuable,
      foundLocation: item.foundLocation,
      finderName: item.finderName,
      finderDept: item.finderDept,
      kabatHandler: item.kabatHandler,
      currentLocation: item.currentLocation,
      additionalDetails: item.additionalDetails,
      photoUrl: item.photoUrl,
      __sourceCollection: COLLECTION,
      __sourceId: item.id
    };
    sessionStorage.setItem("transferToPendingPickup", JSON.stringify(data));
    m.close();
    location.hash = "#/pending-pickup";
  });
}
