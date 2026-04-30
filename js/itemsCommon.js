// Helpers shared by all 3 item pages: counter management, item CRUD,
// and the standard "item details" modal.

import {
  ref, push, set, update, remove, get, query, orderByChild, runTransaction
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-database.js";
import { db } from "./firebase.js";
import { openModal, escapeHtml, formatDateTime, detailRows } from "./utils.js";

/**
 * Get the next item number for a given collection. We don't strictly rely
 * on a counter (the counter can be reset to 0 — that's why duplicates are
 * possible) but we still increment based on the current max and counter.
 */
export async function nextItemNumber(collectionName) {
  const counterRef = ref(db, `counters/${collectionName}`);
  const result = await runTransaction(counterRef, (current) => (current || 0) + 1);
  return result.snapshot.val();
}

/**
 * Set the counter explicitly (used for "reset to 0" admin actions if any).
 * Not currently exposed as UI but available.
 */
export async function setCounter(collectionName, value) {
  await set(ref(db, `counters/${collectionName}`), value || 0);
}

export async function fetchAllItems(collectionName) {
  const snap = await get(ref(db, collectionName));
  const val = snap.val() || {};
  return Object.entries(val).map(([id, v]) => ({ id, ...v }));
}

export async function createItem(collectionName, data) {
  const r = push(ref(db, collectionName));
  await set(r, data);
  return r.key;
}

export async function updateItem(collectionName, id, patch) {
  await update(ref(db, `${collectionName}/${id}`), patch);
}

export async function deleteItem(collectionName, id) {
  await remove(ref(db, `${collectionName}/${id}`));
}

export async function findItemsByNumber(collectionName, number) {
  const all = await fetchAllItems(collectionName);
  return all.filter((it) => Number(it.number) === Number(number));
}

// ===== Item details modal =====
export function openItemDetailsModal({ title, item, extraRows = [], footerButtons = [] }) {
  const baseRows = [
    { label: "מספר אבידה", value: item.number },
    { label: "תאריך ושעה",   value: formatDateTime(item.dateTime) },
    { label: "תיאור הפריט",  value: item.description },
    { label: "יקרת ערך",     value: item.valuable ? "כן" : "לא" },
    { label: "איפה נמצא",    value: item.foundLocation },
    { label: "איפה מאוחסן",  value: item.storageLocation === "אחר" ? `${item.storageLocation} – ${item.storageOther || ""}` : item.storageLocation },
    { label: "שם המוצא",     value: item.finderUnknown ? "לא ידוע" : item.finderName },
    { label: "מחלקת המוצא",  value: item.finderUnknown ? "" : item.finderDept },
    { label: "הקב\"ט המטפל", value: item.kabatHandler },
    { label: "מיקום נוכחי",  value: item.currentLocation },
    { label: "פרטים נוספים", value: item.additionalDetails },
    { label: "שם בעל האבידה", value: item.ownerName },
    { label: "טלפון בעלים",   value: item.ownerPhone },
    { label: "סטטוס",         value: item.returned
        ? `<span class="badge green">הוחזרה</span>`
        : `<span class="badge amber">פעילה</span>`,
        html: true }
  ];

  const allRows = baseRows.concat(extraRows);

  let bodyHtml = `<div>${detailRows(allRows)}</div>`;
  if (item.photoUrl) {
    bodyHtml += `
      <div class="detail-photo">
        <a href="${escapeHtml(item.photoUrl)}" target="_blank" rel="noopener">
          <img src="${escapeHtml(item.photoUrl)}" alt="תמונת האבידה" />
        </a>
      </div>`;
  }

  return openModal({
    title: title || "פרטי אבידה",
    bodyHtml,
    footerButtons: footerButtons.length
      ? footerButtons
      : [{ label: "סגור", className: "btn-secondary", onClick: ({ close }) => close() }]
  });
}

// Renders the "return details" sub-modal showing who picked up the item.
export function openReturnDetailsModal(item) {
  const rd = item.returnDetails || {};
  const rows = [
    { label: "שם המקבל",   value: rd.receiverName },
    { label: "טלפון/ת.ז.", value: rd.receiverContact },
    { label: "קב\"ט שטיפל בהחזרה", value: rd.handlerName },
    { label: "תאריך החזרה", value: formatDateTime(rd.returnedAt) }
  ];
  return openModal({
    title: "פרטי החזרה",
    bodyHtml: `<div>${detailRows(rows)}</div>`,
    footerButtons: [{ label: "סגור", className: "btn-secondary", onClick: ({ close }) => close() }]
  });
}
