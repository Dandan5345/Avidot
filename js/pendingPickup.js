// Page 2: אבידות ממתינות לאיסוף
import {
  fetchAllItems, createItem, updateItem,
  findItemsByNumber, openItemDetailsModal, openReturnDetailsModal, deleteItem
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
    <div class="page-guide section-card guide-accent-blue">
      <strong>מתי משתמשים בעמוד הזה?</strong>
      <p>כאן יהיו כל האבידות שבעצם יצרנו קשר עם בעלי האבידה והם מתכננים לבוא לאסוף.</p>
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
      <table class="data responsive-table">
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
        <td data-label="מס׳">${escapeHtml(it.number)}</td>
        <td data-label="תאריך">${escapeHtml(formatDateTime(it.dateTime))}</td>
        <td data-label="תיאור">${escapeHtml(it.description || "")} ${it.valuable ? '<span class="badge purple">יקרת ערך</span>' : ""}</td>
        <td data-label="בעלים">${escapeHtml(it.ownerName || "")}</td>
        <td data-label="טלפון">${escapeHtml(it.ownerPhone || "")}</td>
        <td data-label="מיקום נוכחי">${escapeHtml(it.currentLocation || "")}</td>
        <td data-label="סטטוס">${it.returned ? '<span class="badge green">נאספה</span>' : '<span class="badge amber">ממתינה</span>'}</td>
        <td data-label="פעולות" class="actions-cell">
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
    void logActivitySafe({
      action: "item.delete.pending",
      entityType: "item",
      entityId: item.id,
      itemNumber: item.number,
      summary: `${actorLabel()} מחק את אבידה מספר ${item.number} מדף ${collectionLabel(COLLECTION)}`,
      detailLines: [
        `תיאור: ${item.description || "ללא תיאור"}`,
        `בעל האבידה: ${item.ownerName || "לא צוין"}`
      ],
      metadata: { sourceCollection: COLLECTION }
    });
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
        <div class="modal-note">
          <strong>רישום אבידה שממתינה לאיסוף</strong>
          <span>השתמשו במסך הזה רק אחרי שכבר נוצר קשר עם בעל האבידה ויש כוונה ממשית להגיע לקחת את הפריט.</span>
        </div>
        <div class="form-grid">
          <label class="field"><span>מספר אבידה</span>
            <input type="number" id="f_number" value="${escapeHtml(String(prefill && prefill.number ? prefill.number : suggestedNumber))}" required />
            <small class="field-note">מספר הזיהוי הפנימי של האבידה. אפשר להשתמש בהצעה של המערכת.</small>
          </label>
          <label class="field"><span>תאריך ושעה</span>
            <input type="datetime-local" id="f_dateTime" value="${prefill && prefill.dateTime ? toLocalInput(prefill.dateTime) : nowAsLocalInputValue()}" required />
            <small class="field-note">מתי האבידה הגיעה לטיפול או הועברה לסטטוס המתנה לאיסוף.</small>
          </label>
          <label class="field full"><span>פירוט</span>
            <textarea id="f_description" required>${escapeHtml(prefill && prefill.description || "")}</textarea>
            <small class="field-note">מהו הפריט ובמה אפשר לזהות אותו במהירות כשבעליו יגיע.</small>
          </label>
          <label class="checkbox-row full">
            <input type="checkbox" id="f_valuable" ${prefill && prefill.valuable ? "checked" : ""} />
            <span>אבידת יקרת ערך</span>
          </label>
          <label class="field"><span>איפה זה נמצא</span>
            <input type="text" id="f_foundLocation" value="${escapeHtml(prefill && prefill.foundLocation || "")}" required />
            <small class="field-note">המקום שבו הפריט נמצא במקור, כדי לשמר היסטוריה של האירוע.</small>
          </label>
          <label class="field"><span>הקב"ט המטפל</span>
            <input type="text" id="f_kabatHandler" value="${escapeHtml(prefill && prefill.kabatHandler || currentUser.name || "")}" required />
            <small class="field-note">מי מנהל בפועל את התקשורת ואת מסירת האבידה.</small>
          </label>
          <label class="field"><span>שם המוצא</span>
            <input type="text" id="f_finderName" value="${escapeHtml(prefill && prefill.finderName || "")}" />
            <small class="field-note">מי מצא את האבידה, אם המידע ידוע ומסייע לתיעוד.</small>
          </label>
          <label class="field"><span>מחלקת המוצא</span>
            <input type="text" id="f_finderDept" value="${escapeHtml(prefill && prefill.finderDept || "")}" />
            <small class="field-note">לאיזו מחלקה שייך מי שמצא את האבידה.</small>
          </label>
          <label class="field"><span>שם בעל האבידה</span>
            <input type="text" id="f_ownerName" value="${escapeHtml(prefill && prefill.ownerName || "")}" required />
            <small class="field-note">שם האדם שאמור להגיע ולאסוף את הפריט.</small>
          </label>
          <label class="field"><span>טלפון בעל האבידה</span>
            <input type="tel" id="f_ownerPhone" value="${escapeHtml(prefill && prefill.ownerPhone || "")}" required />
            <small class="field-note">מספר הטלפון שבו תיאמתם את האיסוף או שאפשר לחזור אליו.</small>
          </label>
          <label class="field"><span>תעודת זהות בעל האבידה</span>
            <input type="text" id="f_ownerId" value="${escapeHtml(prefill && prefill.ownerId || "")}" required />
            <small class="field-note">מספר מזהה של בעל האבידה, כדי לוודא שהמסירה מתבצעת לאדם הנכון.</small>
          </label>
          <label class="field full"><span>איפה האבידה נמצאת כרגע</span>
            <input type="text" id="f_currentLocation" value="${escapeHtml(prefill && prefill.currentLocation || "")}" required />
            <small class="field-note">המקום המדויק שבו הפריט נשמר עד שבעליו יגיע לאסוף.</small>
          </label>
          <label class="field full"><span>פירוט נוסף</span>
            <textarea id="f_additionalDetails">${escapeHtml(prefill && prefill.additionalDetails || "")}</textarea>
            <small class="field-note">כל מידע שיעזור למסירה חלקה: מתי צפויים להגיע, מי תיאם, או מה הוסבר לבעל האבידה.</small>
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
      const ownerId = body.querySelector("#f_ownerId").value.trim();
      if (!ownerName || !ownerPhone || !ownerId) throw new Error("יש להזין שם, טלפון ותעודת זהות של בעל האבידה");

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
        ownerName, ownerPhone, ownerId,
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
        let sourceDeleteFailed = false;
        try { await deleteItem(prefill.__sourceCollection, prefill.__sourceId); }
        catch (e) {
          sourceDeleteFailed = true;
          console.warn(e);
        }

        void logActivitySafe({
          action: prefill.__sourceCollection === "awaitingInfo"
            ? "item.transfer.awaiting_to_pending"
            : "item.transfer.lost_to_pending",
          entityType: "item",
          itemNumber: number,
          summary: sourceDeleteFailed
            ? `${actorLabel()} יצר רשומת ממתינה לאיסוף עבור אבידה מספר ${number}, אבל המחיקה מ-${collectionLabel(prefill.__sourceCollection)} נכשלה`
            : prefill.__sourceCollection === "awaitingInfo"
              ? `${actorLabel()} העביר את אבידה מספר ${number} מ-${collectionLabel(prefill.__sourceCollection)} ל-${collectionLabel(COLLECTION)}`
              : `${actorLabel()} העביר את אבידה מספר ${number} מ-${collectionLabel(prefill.__sourceCollection)} ל-${collectionLabel(COLLECTION)}`,
          detailLines: [
            `בעל האבידה: ${ownerName}`,
            `טלפון: ${ownerPhone}`,
            `תעודת זהות: ${ownerId}`
          ],
          metadata: {
            sourceCollection: prefill.__sourceCollection,
            sourceId: prefill.__sourceId,
            targetCollection: COLLECTION
          }
        });
      } else {
        void logActivitySafe({
          action: "item.create.pending",
          entityType: "item",
          itemNumber: number,
          summary: `${actorLabel()} יצר אבידה חדשה בדף ${collectionLabel(COLLECTION)}`,
          detailLines: [
            `מספר אבידה: ${number}`,
            `בעל האבידה: ${ownerName}`,
            `טלפון: ${ownerPhone}`,
            `תעודת זהות: ${ownerId}`
          ],
          metadata: { targetCollection: COLLECTION }
        });
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
    let settled = false;
    const finish = (value, closeModal = false) => {
      if (settled) return;
      settled = true;
      resolve(value);
      if (closeModal) m.close();
    };

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
  const summary = detailRows([
    { label: "מספר", value: item.number },
    { label: "תאריך", value: formatDateTime(item.dateTime) },
    { label: "תיאור", value: item.description },
    { label: "בעלים", value: item.ownerName }
  ]);
  const m = openModal({
    title: "פרטי איסוף",
    bodyHtml: `
      <div class="modal-note">
        <strong>אישור מסירת האבידה</strong>
        <span>מלאו את פרטי מקבל האבידה, ציינו מי מסר את הפריט, ואספו חתימה דיגיטלית לפני אישור האיסוף.</span>
      </div>
      <div class="section-card" style="background:#eff6ff;border-color:#bfdbfe">
        <div class="muted" style="margin-bottom:6px;font-weight:600;color:#1e3a8a">פרטי האבידה:</div>
        ${summary}
      </div>
      <div class="form-grid">
        <label class="field full"><span>שם מלא של המקבל</span>
          <input type="text" id="r_receiverName" value="${escapeHtml(item.ownerName || "")}" required />
          <small class="field-note">רשמו את האדם שקיבל את האבידה בפועל, גם אם מישהו אחר תיאם את האיסוף.</small>
        </label>
        <label class="field full"><span>טלפון או תעודת זהות</span>
          <input type="text" id="r_receiverContact" value="${escapeHtml(item.ownerPhone || "")}" required />
          <small class="field-note">מספר מזהה שעוזר לוודא מי אסף את הפריט.</small>
        </label>
        <label class="field full"><span>שם הקב"ט שטיפל</span>
          <input type="text" id="r_handlerName" value="${escapeHtml(currentUser.name || "")}" required />
          <small class="field-note">מי בדק את הפרטים ואישר את המסירה.</small>
        </label>
        ${signaturePadHtml({ idPrefix: "pickupReturnSignature" })}
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
              action: "item.return.pending",
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
            toast("האבידה סומנה כנאספה", "success");
            signatureController?.destroy();
            close();
          } catch (e) { toast(e.message || "שגיאה", "error"); }
        }
      }
    ]
  });

  let signatureController = null;
  createSignaturePadController(m.body, { idPrefix: "pickupReturnSignature" })
    .then((controller) => { signatureController = controller; })
    .catch((error) => toast(error.message || "שגיאה בטעינת החתימה", "error"));

  const baseClose = m.close;
  m.close = () => {
    signatureController?.destroy();
    baseClose();
  };
}

function actorLabel() {
  return currentUser.name || currentUser.email || "משתמש";
}
