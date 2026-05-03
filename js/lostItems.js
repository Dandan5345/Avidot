// Page 1: רגיל — אבידות
import {
  fetchAllItems, createItem, updateItem, deleteItem,
  findItemsByNumber, openItemDetailsModal, openReturnDetailsModal
} from "./itemsCommon.js";
import { subscribeCollection } from "./firestoreStore.js";
import { currentUser } from "./auth.js";
import {
  escapeHtml, formatDateTime, nowAsLocalInputValue, toIsoFromLocalInput,
  openModal, toast, filterItems, promptDialog, detailRows, confirmDialog,
  signaturePadHtml, createSignaturePadController
} from "./utils.js";
import { attachImageUpload, imageUploadFieldHtml, uploadImageToImgBB } from "./imgbb.js";
import { collectionLabel, logActivitySafe } from "./activityLog.js";
import { syncLostItemsFullSnapshotSafe } from "./googleSheetsBackup.js";

const COLLECTION = "lostItems";
const STORAGE_OPTIONS = [
  "ארון אבידות",
  "כספת ארון אבידות",
  "ארון הפקדות",
  "כספת ארון הפקדות",
  "אחר"
];

let unsubscribe = null;
let allItems = [];
let hasLoadedSnapshot = false;
let loadError = "";
let initialLoadTimer = null;
let viewState = { search: "", date: "", showReturned: false };
let hasRequestedSheetsFullSync = false;

export function renderLostItems(container) {
  hasRequestedSheetsFullSync = false;
  container.innerHTML = `
    <div class="page-title">
      <h2>🎒 אבידות</h2>
      <div class="home-actions">
        <button id="addBtn" class="btn">➕ הוסף אבידה</button>
        <button id="returnBtn" class="btn btn-success">↩️ אבידה הוחזרה</button>
      </div>
    </div>

    <div class="page-guide section-card guide-accent-cyan">
      <strong>מתי משתמשים בעמוד הזה?</strong>
      <p>כאן רושמים את כל האבידות שאין דרך לדבר עם בעל האבידה, לדוגמה: אבידות שנמצאו בלובי או בחדר אוכל, אבידות מחדרים שמספר הטלפון לא עובד או שאין מספר טלפון, וכדומה.</p>
    </div>

    <div class="toolbar">
      <input type="text" id="searchInput" placeholder="🔍 חיפוש..." />
      <input type="date" id="dateInput" title="סינון לפי תאריך" />
      <label class="checkbox-row" style="margin-inline-start:8px">
        <input type="checkbox" id="showReturned" />
        <span>הצג אבידות שהוחזרו</span>
      </label>
      <button id="clearFilters" class="btn btn-secondary btn-sm">נקה סינון</button>
      <span class="spacer"></span>
      <span class="muted" id="countLabel"></span>
    </div>

    <div class="table-wrap">
      <table class="data responsive-table">
        <thead>
          <tr>
            <th>מס׳ אבידה</th>
            <th>תאריך</th>
            <th>תיאור</th>
            <th>איפה נמצא</th>
            <th>אחסון</th>
            <th>קב״ט מטפל</th>
            <th>סטטוס</th>
            <th>פעולות</th>
          </tr>
        </thead>
        <tbody id="tbody">
          <tr><td colspan="8" class="empty">טוען...</td></tr>
        </tbody>
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
    viewState = { search: "", date: "", showReturned: false };
    render();
  });

  container.querySelector("#addBtn").addEventListener("click", () => openAddModal());
  container.querySelector("#returnBtn").addEventListener("click", () => openReturnFlow());

  // realtime subscription
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
    if (!hasRequestedSheetsFullSync) {
      hasRequestedSheetsFullSync = true;
      void syncLostItemsFullSnapshotSafe(items);
    }
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
      tbody.innerHTML = `<tr><td colspan="8" class="empty">אין אבידות להצגה</td></tr>`;
      return;
    }
    tbody.innerHTML = items.map((it) => `
      <tr data-id="${escapeHtml(it.id)}" class="${it.returned ? "returned" : ""}">
        <td data-label="מס׳ אבידה">${escapeHtml(it.number)}</td>
        <td data-label="תאריך">${escapeHtml(formatDateTime(it.dateTime))}</td>
        <td data-label="תיאור">${escapeHtml(it.description || "")} ${it.valuable ? '<span class="badge purple">יקרת ערך</span>' : ""}</td>
        <td data-label="איפה נמצא">${escapeHtml(it.foundLocation || "")}</td>
        <td data-label="אחסון">${escapeHtml(it.storageLocation === "אחר" ? (it.storageOther || "אחר") : (it.storageLocation || ""))}</td>
        <td data-label="קב״ט מטפל">${escapeHtml(it.kabatHandler || "")}</td>
        <td data-label="סטטוס">${it.returned ? '<span class="badge green">הוחזרה</span>' : '<span class="badge amber">פעילה</span>'}</td>
        <td data-label="פעולות" class="actions-cell">
          ${it.returned ? `<button class="btn btn-sm btn-outline" data-action="return-info">פרטי החזרה</button>` : ""}
          ${!it.returned ? `<button class="btn btn-sm btn-outline" data-action="move-to-pending">העבר אבידה</button>` : ""}
          ${canDeleteItems ? `<button class="btn btn-sm btn-danger" data-action="delete-item">מחק אבידה</button>` : ""}
        </td>
      </tr>
    `).join("");

    // row click → details. action button click → return info.
    tbody.querySelectorAll("tr[data-id]").forEach((tr) => {
      const id = tr.getAttribute("data-id");
      tr.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-action]");
        if (btn) {
          e.stopPropagation();
          const it = allItems.find((x) => x.id === id);
          if (btn.dataset.action === "return-info") openReturnDetailsModal(it);
          if (btn.dataset.action === "move-to-pending") openTransferToPending(it);
          if (btn.dataset.action === "delete-item") onDeleteItem(it);
          return;
        }
        const it = allItems.find((x) => x.id === id);
        if (it) openItemDetailsModal({ item: it });
      });
    });
  }

  // If we arrived via transfer-from-awaiting-info, open the add modal pre-filled.
  const pending = sessionStorage.getItem("transferToLostItems");
  if (pending) {
    sessionStorage.removeItem("transferToLostItems");
    try {
      const data = JSON.parse(pending);
      setTimeout(() => openAddModal({ prefill: data }), 100);
    } catch (_) { }
  }
}

export function teardownLostItems() {
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
    void logActivitySafe({
      action: "item.delete.lost",
      entityType: "item",
      entityId: item.id,
      itemNumber: item.number,
      summary: `${actorLabel()} מחק את אבידה מספר ${item.number} מדף ${collectionLabel(COLLECTION)}`,
      detailLines: [
        `תיאור: ${item.description || "ללא תיאור"}`,
        `מקום מציאה: ${item.foundLocation || "לא צוין"}`
      ],
      metadata: { sourceCollection: COLLECTION }
    });
    toast("האבידה נמחקה", "success");
  } catch (e) {
    toast(e.message || "שגיאה במחיקה", "error");
  }
}

// ===== Add modal =====
async function openAddModal({ prefill = null } = {}) {
  // Determine next number from existing data — robust even if counter was reset.
  const existingMax = allItems.reduce((m, it) => Math.max(m, Number(it.number) || 0), 0);
  const suggestedNumber = existingMax + 1;

  const storageOpts = STORAGE_OPTIONS.map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join("");

  const m = openModal({
    title: prefill ? "הוסף אבידה (מהעברה)" : "הוסף אבידה",
    large: true,
    bodyHtml: `
      <form id="addForm">
        <div class="modal-note">
          <strong>רישום אבידה חדשה</strong>
          <span>מלאו רק פרטים ידועים ומדויקים. אם אין דרך ליצור קשר עם בעל האבידה, זה המקום הנכון לפתוח את הרשומה.</span>
        </div>
        <div class="form-grid">
          <div class="field-row">
            <label class="field">
              <span>מספר אבידה</span>
              <input type="number" id="f_number" value="${escapeHtml(String(prefill && prefill.number ? prefill.number : suggestedNumber))}" required />
              <small class="field-note">מזהה פנימי.</small>
            </label>
            <label class="field">
              <span>תאריך ושעה</span>
              <input type="datetime-local" id="f_dateTime" value="${prefill && prefill.dateTime ? toLocalInput(prefill.dateTime) : nowAsLocalInputValue()}" required />
              <small class="field-note">מתי האבידה נמצאה.</small>
            </label>
          </div>
          <label class="field full">
            <span>תיאור פריט</span>
            <textarea id="f_description" required>${escapeHtml(prefill && prefill.description || "")}</textarea>
            <small class="field-note">תארו בקצרה אבל בצורה שמאפשרת לזהות את הפריט בקלות: צבע, סוג, מותג או סימן מזהה.</small>
          </label>
          <label class="checkbox-row full">
            <input type="checkbox" id="f_valuable" ${prefill && prefill.valuable ? "checked" : ""} />
            <span>אבידת יקרת ערך</span>
          </label>
          <label class="field">
            <span>איפה נמצא</span>
            <input type="text" id="f_foundLocation" value="${escapeHtml(prefill && prefill.foundLocation || "")}" required />
            <small class="field-note">למשל: לובי, חדר אוכל, מסדרון קומה 4, חדר 512.</small>
          </label>
          <label class="field">
            <span>איפה מאוחסן</span>
            <select id="f_storageLocation" required>${storageOpts}</select>
            <small class="field-note">בחרו את המקום שבו הפריט נשמר כרגע עד להמשך טיפול.</small>
          </label>
          <label class="field full" id="f_storageOtherWrap" style="display:none">
            <span>פירוט מיקום אחסון</span>
            <input type="text" id="f_storageOther" />
            <small class="field-note">אם בחרתם "אחר", ציינו בדיוק איפה הפריט מונח.</small>
          </label>
          <label class="field">
            <span>שם המוצא</span>
            <input type="text" id="f_finderName" value="${escapeHtml(prefill && prefill.finderName || "")}" />
            <small class="field-note">שם העובד או האורח שמצא את האבידה, אם הוא ידוע.</small>
          </label>
          <label class="field">
            <span>מחלקת המוצא</span>
            <input type="text" id="f_finderDept" value="${escapeHtml(prefill && prefill.finderDept || "")}" />
            <small class="field-note">המחלקה או הצוות שאליו שייך מי שמצא את הפריט.</small>
          </label>
          <label class="checkbox-row full">
            <input type="checkbox" id="f_finderUnknown" ${prefill && prefill.finderUnknown ? "checked" : ""} />
            <span>לא ידוע</span>
          </label>
          <label class="field full">
            <span>הקב"ט המטפל</span>
            <input type="text" id="f_kabatHandler" value="${escapeHtml(prefill && prefill.kabatHandler || currentUser.name || "")}" required />
            <small class="field-note">מי אחראי על המשך הטיפול והרישום של האבידה.</small>
          </label>
          ${imageUploadFieldHtml("תמונת אבידה (אופציונלי)")}
        </div>
      </form>
    `,
    footerButtons: [
      { label: "ביטול", className: "btn-secondary", onClick: ({ close }) => close() },
      {
        label: "שמור", className: "btn-success", id: "saveBtn", onClick: async ({ body, close }) => {
          await saveAdd({ body, close, prefill });
        }
      }
    ]
  });

  // Wire storage "other" toggle
  const storageSel = m.body.querySelector("#f_storageLocation");
  const otherWrap = m.body.querySelector("#f_storageOtherWrap");
  storageSel.addEventListener("change", () => {
    otherWrap.style.display = storageSel.value === "אחר" ? "" : "none";
  });
  // finderUnknown toggles the finder fields
  const finderUnknown = m.body.querySelector("#f_finderUnknown");
  const finderName = m.body.querySelector("#f_finderName");
  const finderDept = m.body.querySelector("#f_finderDept");
  function toggleFinder() {
    const dis = finderUnknown.checked;
    finderName.disabled = dis; finderDept.disabled = dis;
    if (dis) { finderName.value = ""; finderDept.value = ""; }
  }
  finderUnknown.addEventListener("change", toggleFinder);
  toggleFinder();

  // Image upload
  const uploader = attachImageUpload(m.body);

  async function saveAdd({ body, close, prefill }) {
    const saveBtn = document.getElementById("saveBtn");
    saveBtn.disabled = true;
    saveBtn.innerHTML = `<span class="spinner"></span> שומר...`;
    try {
      const number = Number(body.querySelector("#f_number").value);
      if (!Number.isFinite(number) || number <= 0) throw new Error("מספר אבידה לא תקין");
      const dateTime = toIsoFromLocalInput(body.querySelector("#f_dateTime").value) || new Date().toISOString();
      const description = body.querySelector("#f_description").value.trim();
      if (!description) throw new Error("תיאור פריט חסר");
      const valuable = body.querySelector("#f_valuable").checked;
      const foundLocation = body.querySelector("#f_foundLocation").value.trim();
      const storageLocation = body.querySelector("#f_storageLocation").value;
      const storageOther = storageLocation === "אחר" ? body.querySelector("#f_storageOther").value.trim() : "";
      if (storageLocation === "אחר" && !storageOther) throw new Error("יש לפרט מיקום אחסון");
      const finderUnknownVal = body.querySelector("#f_finderUnknown").checked;
      const kabatHandler = body.querySelector("#f_kabatHandler").value.trim();
      if (!kabatHandler) throw new Error("שם הקב\"ט המטפל חסר");

      let photoUrl = (prefill && prefill.photoUrl) || null;
      try {
        const url = await uploader.getUrl();
        if (url) photoUrl = url;
      } catch (e) {
        toast(e.message || "שגיאה בהעלאת תמונה", "error");
        saveBtn.disabled = false;
        saveBtn.textContent = "שמור";
        return;
      }

      const payload = {
        number, dateTime, description, valuable, foundLocation,
        storageLocation, storageOther,
        finderName: finderUnknownVal ? "" : body.querySelector("#f_finderName").value.trim(),
        finderDept: finderUnknownVal ? "" : body.querySelector("#f_finderDept").value.trim(),
        finderUnknown: finderUnknownVal,
        kabatHandler,
        photoUrl: photoUrl || null,
        returned: false,
        createdAt: new Date().toISOString(),
        createdBy: currentUser.uid || null,
        createdByName: currentUser.name || ""
      };
      await createItem(COLLECTION, payload);

      // If we arrived from transfer flow, delete the source item.
      if (prefill && prefill.__sourceCollection && prefill.__sourceId) {
        let sourceDeleteFailed = false;
        try {
          await deleteItem(prefill.__sourceCollection, prefill.__sourceId);
        } catch (e) {
          sourceDeleteFailed = true;
          console.warn("Failed to delete source item:", e);
        }

        void logActivitySafe({
          action: prefill.__sourceCollection === "awaitingInfo" ? "item.transfer.awaiting_to_lost" : "item.transfer.other_to_lost",
          entityType: "item",
          itemNumber: number,
          summary: sourceDeleteFailed
            ? `${actorLabel()} יצר את אבידה מספר ${number} בדף ${collectionLabel(COLLECTION)}, אבל המחיקה מ-${collectionLabel(prefill.__sourceCollection)} נכשלה`
            : `${actorLabel()} העביר את אבידה מספר ${number} מ-${collectionLabel(prefill.__sourceCollection)} ל-${collectionLabel(COLLECTION)}`,
          detailLines: [
            `תיאור: ${description}`,
            `מקום מציאה: ${foundLocation || "לא צוין"}`,
            `קב"ט מטפל: ${kabatHandler}`
          ],
          metadata: {
            sourceCollection: prefill.__sourceCollection,
            sourceId: prefill.__sourceId,
            targetCollection: COLLECTION
          }
        });
      } else {
        void logActivitySafe({
          action: "item.create.lost",
          entityType: "item",
          itemNumber: number,
          summary: `${actorLabel()} יצר אבידה חדשה בדף ${collectionLabel(COLLECTION)}`,
          detailLines: [
            `מספר אבידה: ${number}`,
            `תיאור: ${description}`,
            `מקום מציאה: ${foundLocation || "לא צוין"}`
          ],
          metadata: { targetCollection: COLLECTION }
        });
      }

      toast("האבידה נוספה בהצלחה", "success");
      close();
    } catch (e) {
      toast(e.message || "שגיאה בשמירה", "error");
      saveBtn.disabled = false;
      saveBtn.textContent = "שמור";
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

// ===== Return flow =====
async function openReturnFlow() {
  const numStr = await promptDialog({
    title: "החזרת אבידה",
    label: "הזן מספר אבידה",
    placeholder: "מספר אבידה"
  });
  if (numStr === null) return;
  const num = Number(numStr);
  if (!num) { toast("מספר אבידה לא תקין", "error"); return; }

  const matches = (await findItemsByNumber(COLLECTION, num)).filter((it) => !it.returned);
  if (!matches.length) { toast("לא נמצאה אבידה פעילה במספר הזה", "error"); return; }

  let chosen;
  if (matches.length === 1) {
    chosen = matches[0];
  } else {
    chosen = await chooseAmongMatches(matches);
    if (!chosen) return;
  }
  openReturnFormModal(chosen);
}

function chooseAmongMatches(matches) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value, closeModal = false) => {
      if (settled) return;
      settled = true;
      resolve(value);
      if (closeModal) m.close();
    };

    const html = `
      <p class="muted">נמצאו מספר אבידות עם אותו המספר. בחר את האבידה הנכונה:</p>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>תאריך</th><th>איפה נמצא</th><th>תיאור</th><th></th></tr></thead>
          <tbody>
            ${matches.map((it) => `
              <tr>
                <td>${escapeHtml(formatDateTime(it.dateTime))}</td>
                <td>${escapeHtml(it.foundLocation || "")}</td>
                <td>${escapeHtml(it.description || "")}</td>
                <td><button class="btn btn-sm" data-id="${escapeHtml(it.id)}">בחר</button></td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    `;
    const m = openModal({
      title: "פתרון קונפליקט",
      large: true,
      bodyHtml: html,
      footerButtons: [{ label: "ביטול", className: "btn-secondary", onClick: () => finish(null, true) }],
      onClose: () => finish(null)
    });
    m.body.querySelectorAll("button[data-id]").forEach((b) => {
      b.addEventListener("click", () => {
        const it = matches.find((x) => x.id === b.dataset.id);
        finish(it, true);
      });
    });
  });
}

function openReturnFormModal(item) {
  const summaryRows = detailRows([
    { label: "מספר", value: item.number },
    { label: "תאריך", value: formatDateTime(item.dateTime) },
    { label: "תיאור", value: item.description },
    { label: "איפה נמצא", value: item.foundLocation }
  ]);
  const m = openModal({
    title: "פרטי החזרה",
    bodyHtml: `
      <div class="modal-note">
        <strong>השלמת החזרת האבידה</strong>
        <span>מלאו את פרטי המקבל, אשרו מי טיפל בהחזרה, ואספו גם חתימה דיגיטלית של בעל האבידה לפני שמירה.</span>
      </div>
      <div class="section-card" style="background:#eff6ff;border-color:#bfdbfe">
        <div class="muted" style="margin-bottom:6px;font-weight:600;color:#1e3a8a">פרטי האבידה:</div>
        ${summaryRows}
      </div>
      <div class="form-grid">
        <label class="field full">
          <span>שם מלא של המקבל</span>
          <input type="text" id="r_receiverName" required />
          <small class="field-note">רשמו את שם האדם שמקבל פיזית את האבידה לידיים.</small>
        </label>
        <label class="field full">
          <span>טלפון או תעודת זהות של המקבל</span>
          <input type="text" id="r_receiverContact" required />
          <small class="field-note">אפשר להזין טלפון זמין או תעודת זהות לצורך תיעוד ברור של המסירה.</small>
        </label>
        <label class="field full">
          <span>שם הקב"ט שטיפל בהחזרה</span>
          <input type="text" id="r_handlerName" value="${escapeHtml(currentUser.name || "")}" required />
          <small class="field-note">רשמו את שם איש הצוות שאישר ומסר את הפריט.</small>
        </label>
        ${signaturePadHtml({ idPrefix: "lostReturnSignature" })}
      </div>
    `,
    footerButtons: [
      { label: "ביטול", className: "btn-secondary", onClick: ({ close }) => close() },
      {
        label: "אישור החזרה", className: "btn-success", onClick: async ({ body, close }) => {
          const receiverName = body.querySelector("#r_receiverName").value.trim();
          const receiverContact = body.querySelector("#r_receiverContact").value.trim();
          const handlerName = body.querySelector("#r_handlerName").value.trim();
          if (!receiverName || !receiverContact || !handlerName) { toast("יש למלא את כל השדות", "error"); return; }
          try {
            if (!signatureController || signatureController.isEmpty()) {
              toast("יש לאסוף חתימה דיגיטלית של בעל האבידה", "error");
              return;
            }
            const signatureBlob = await signatureController.toBlob();
            const signatureUrl = await uploadImageToImgBB(signatureBlob);
            await updateItem(COLLECTION, item.id, {
              returned: true,
              returnDetails: {
                receiverName, receiverContact, handlerName,
                returnedAt: new Date().toISOString(),
                returnedBy: currentUser.uid || null,
                signatureUrl
              }
            });
            void logActivitySafe({
              action: "item.return.lost",
              entityType: "item",
              entityId: item.id,
              itemNumber: item.number,
              summary: `${actorLabel()} החזיר את אבידה מספר ${item.number} מדף ${collectionLabel(COLLECTION)}`,
              detailLines: [
                `המקבל: ${receiverName}`,
                `זיהוי מקבל: ${receiverContact}`,
                `קב"ט שטיפל: ${handlerName}`
              ],
              metadata: { sourceCollection: COLLECTION }
            });
            toast("האבידה סומנה כהוחזרה", "success");
            signatureController?.destroy();
            close();
          } catch (e) {
            toast(e.message || "שגיאה בשמירה", "error");
          }
        }
      }
    ]
  });

  let signatureController = null;
  createSignaturePadController(m.body, { idPrefix: "lostReturnSignature" })
    .then((controller) => { signatureController = controller; })
    .catch((error) => toast(error.message || "שגיאה בטעינת החתימה", "error"));

  const baseClose = m.close;
  m.close = () => {
    signatureController?.destroy();
    baseClose();
  };
}

function openTransferToPending(item) {
  if (!item || item.returned) return;
  const transferData = {
    number: item.number,
    dateTime: item.dateTime,
    description: item.description,
    valuable: !!item.valuable,
    foundLocation: item.foundLocation,
    finderName: item.finderName,
    finderDept: item.finderDept,
    kabatHandler: item.kabatHandler,
    currentLocation: item.storageLocation === "אחר" ? (item.storageOther || "") : (item.storageLocation || ""),
    additionalDetails: item.additionalDetails || "",
    ownerName: item.ownerName || "",
    ownerPhone: item.ownerPhone || "",
    ownerId: item.ownerId || "",
    photoUrl: item.photoUrl,
    __sourceCollection: COLLECTION,
    __sourceId: item.id
  };
  sessionStorage.setItem("transferToPendingPickup", JSON.stringify(transferData));
  location.hash = "#/pending-pickup";
}

function actorLabel() {
  return currentUser.name || currentUser.email || "משתמש";
}
