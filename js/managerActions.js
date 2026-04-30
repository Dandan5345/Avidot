// Page 4: פעולות אחמ"ש — משיכת / מחיקת אבידות
// Operates only on regular lostItems that are not yet returned.
import { fetchAllItems, deleteItem } from "./itemsCommon.js";
import { isAhmash } from "./auth.js";
import { escapeHtml, formatDateTime, formatDate, toast, confirmDialog } from "./utils.js";

const COLLECTION = "lostItems";
let lastFiltered = [];
let lastSortBy = "department";

export function renderManagerActions(container) {
  if (!isAhmash()) {
    container.innerHTML = `
      <div class="page-title"><h2>פעולות אחמ"ש</h2></div>
      <div class="section-card"><p>אין לך הרשאה לדף זה.</p></div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-title">
      <h2>🗂️ משיכת / מחיקת אבידות</h2>
    </div>
    <div class="section-card">
      <div class="form-grid">
        <label class="field"><span>מתאריך</span>
          <input type="date" id="fromDate" /></label>
        <label class="field"><span>עד תאריך</span>
          <input type="date" id="toDate" /></label>
        <label class="checkbox-row full">
          <input type="checkbox" id="includeValuable" /><span>כלול אבידות יקרות ערך</span></label>
        <label class="field"><span>סוג פעולה</span>
          <select id="actionType">
            <option value="donation">תרומת אבידות</option>
            <option value="delete">מחיקת אבידות</option>
          </select></label>
        <label class="field"><span>&nbsp;</span>
          <button class="btn" id="runBtn">משיכה</button></label>
      </div>
    </div>

    <div id="resultArea"></div>
  `;

  container.querySelector("#runBtn").addEventListener("click", () => onRun(container));
}

async function onRun(container) {
  const fromStr = container.querySelector("#fromDate").value;
  const toStr = container.querySelector("#toDate").value;
  const includeValuable = container.querySelector("#includeValuable").checked;
  const action = container.querySelector("#actionType").value;

  if (!fromStr || !toStr) { toast("יש לבחור תאריך מ- ועד תאריך", "error"); return; }
  const from = new Date(fromStr + "T00:00:00");
  const to = new Date(toStr + "T23:59:59");
  if (from > to) { toast("טווח תאריכים לא תקין", "error"); return; }

  let items;
  try { items = await fetchAllItems(COLLECTION); }
  catch (e) { toast("שגיאה בטעינת אבידות", "error"); return; }

  const filtered = items.filter((it) => {
    if (it.returned) return false;                  // only non-returned
    if (!includeValuable && it.valuable) return false;
    if (!it.dateTime) return false;
    const d = new Date(it.dateTime);
    if (isNaN(d)) return false;
    return d >= from && d <= to;
  });

  lastFiltered = filtered;

  if (action === "donation") renderDonationView(container, filtered, { from, to, includeValuable });
  else renderDeleteView(container, filtered, { from, to, includeValuable });
}

function renderDonationView(container, items, opts) {
  const area = container.querySelector("#resultArea");
  if (!items.length) {
    area.innerHTML = `<div class="section-card"><p>לא נמצאו אבידות התואמות לסינון.</p></div>`;
    return;
  }
  area.innerHTML = `
    <div class="section-card">
      <div class="flex gap-12 wrap center">
        <strong>סדר מיון:</strong>
        <select id="sortBy">
          <option value="department">לפי מחלקות</option>
          <option value="date">לפי תאריך</option>
          <option value="finderDept">לפי שם המוצא ומחלקות</option>
        </select>
        <span class="spacer"></span>
        <button class="btn btn-warn" id="printBtn">🖨️ הדפס</button>
      </div>
    </div>
    <div class="print-area" id="printArea"></div>
  `;

  const sortSel = area.querySelector("#sortBy");
  sortSel.value = lastSortBy;
  sortSel.addEventListener("change", () => {
    lastSortBy = sortSel.value;
    renderPrintList(area.querySelector("#printArea"), items, opts, lastSortBy);
  });
  area.querySelector("#printBtn").addEventListener("click", () => window.print());

  renderPrintList(area.querySelector("#printArea"), items, opts, lastSortBy);
}

function renderPrintList(host, items, opts, sortBy) {
  let sorted = items.slice();

  if (sortBy === "date") {
    sorted.sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));
    host.innerHTML = `
      <h2>רשימת אבידות לתרומה</h2>
      <p>טווח: ${escapeHtml(formatDate(opts.from))} עד ${escapeHtml(formatDate(opts.to))} ${opts.includeValuable ? "(כולל יקרות ערך)" : ""}</p>
      ${tableHtml(sorted)}`;
    return;
  }

  // group by some key
  const keyFn = sortBy === "finderDept"
    ? (it) => `${(it.finderName || "לא ידוע")} – ${(it.finderDept || "ללא מחלקה")}`
    : (it) => (it.finderDept || "ללא מחלקה");

  const groups = {};
  for (const it of sorted) {
    const k = keyFn(it);
    (groups[k] = groups[k] || []).push(it);
  }
  const keys = Object.keys(groups).sort((a, b) => a.localeCompare(b, "he"));

  let html = `<h2>רשימת אבידות לתרומה</h2>
    <p>טווח: ${escapeHtml(formatDate(opts.from))} עד ${escapeHtml(formatDate(opts.to))} ${opts.includeValuable ? "(כולל יקרות ערך)" : ""}</p>
    <p>מיון: ${sortBy === "finderDept" ? "לפי שם המוצא ומחלקות" : "לפי מחלקות"}</p>`;
  for (const k of keys) {
    html += `<h3 style="margin-top:18px;color:#1e3a8a">${escapeHtml(k)} <span class="muted">(${groups[k].length})</span></h3>`;
    html += tableHtml(groups[k]);
  }
  html += `<p style="margin-top:18px"><strong>סה"כ: ${items.length} פריטים</strong></p>`;
  host.innerHTML = html;
}

function tableHtml(items) {
  return `
    <div class="table-wrap" style="margin-top:6px">
      <table class="data">
        <thead><tr>
          <th>מס׳</th><th>תאריך</th><th>תיאור</th><th>איפה נמצא</th>
          <th>אחסון</th><th>שם המוצא</th><th>מחלקה</th><th>קב״ט</th>
        </tr></thead>
        <tbody>
          ${items.map((it) => `
            <tr>
              <td>${escapeHtml(it.number)}</td>
              <td>${escapeHtml(formatDateTime(it.dateTime))}</td>
              <td>${escapeHtml(it.description || "")} ${it.valuable ? '<span class="badge purple">יקרת ערך</span>' : ""}</td>
              <td>${escapeHtml(it.foundLocation || "")}</td>
              <td>${escapeHtml(it.storageLocation === "אחר" ? (it.storageOther || "אחר") : (it.storageLocation || ""))}</td>
              <td>${escapeHtml(it.finderUnknown ? "לא ידוע" : (it.finderName || ""))}</td>
              <td>${escapeHtml(it.finderUnknown ? "" : (it.finderDept || ""))}</td>
              <td>${escapeHtml(it.kabatHandler || "")}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

function renderDeleteView(container, items, opts) {
  const area = container.querySelector("#resultArea");
  if (!items.length) {
    area.innerHTML = `<div class="section-card"><p>לא נמצאו אבידות התואמות לסינון.</p></div>`;
    return;
  }
  area.innerHTML = `
    <div class="section-card" style="background:#fef2f2;border-color:#fecaca">
      <strong style="color:#991b1b">⚠️ עומדות להימחק ${items.length} אבידות מטווח ${escapeHtml(formatDate(opts.from))} עד ${escapeHtml(formatDate(opts.to))} ${opts.includeValuable ? "(כולל יקרות ערך)" : ""}</strong>
    </div>
    ${tableHtml(items)}
    <div style="display:flex;justify-content:flex-end;margin-top:14px">
      <button id="confirmDeleteBtn" class="btn btn-danger">🗑 מחק אבידות</button>
    </div>
  `;
  area.querySelector("#confirmDeleteBtn").addEventListener("click", async () => {
    const ok1 = await confirmDialog({
      title: "אישור מחיקה",
      message: `האם למחוק לצמיתות ${items.length} אבידות?`,
      confirmText: "המשך",
      cancelText: "ביטול",
      danger: true
    });
    if (!ok1) return;
    const ok2 = await confirmDialog({
      title: "אישור סופי",
      message: "פעולה זו אינה הפיכה. למחוק את האבידות מהדאטה בייס?",
      confirmText: "כן, מחק",
      cancelText: "ביטול",
      danger: true
    });
    if (!ok2) return;

    const btn = area.querySelector("#confirmDeleteBtn");
    btn.disabled = true; btn.innerHTML = `<span class="spinner"></span> מוחק...`;
    let failed = 0;
    for (const it of items) {
      try { await deleteItem(COLLECTION, it.id); }
      catch (e) { failed++; console.error(e); }
    }
    if (failed) toast(`נמחקו ${items.length - failed} מתוך ${items.length}. ${failed} נכשלו.`, "error");
    else toast(`נמחקו ${items.length} אבידות`, "success");
    area.innerHTML = `<div class="section-card"><p>הפעולה הסתיימה.</p></div>`;
  });
}
