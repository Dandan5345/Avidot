// Returned/deleted item history, including legacy returned records that still
// live in their original collections.
import { subscribeCollection } from "./firestoreStore.js";
import { openItemDetailsModal, openReturnDetailsModal } from "./itemsCommon.js";
import { escapeHtml, filterItems, formatDateTime } from "./utils.js";

const SOURCES = ["closedItems", "lostItems", "pendingPickup", "awaitingInfo"];
const SOURCE_LABELS = {
  lostItems: "אבידות",
  pendingPickup: "ממתינות לאיסוף",
  awaitingInfo: "ממתינות למידע"
};

let unsubscribers = [];

export function renderClosedItems(container) {
  const snapshots = new Map(SOURCES.map((name) => [name, []]));
  const loaded = new Set();
  let viewState = { search: "", date: "", status: "all" };

  container.innerHTML = `
    <div class="page-title">
      <h2>🗄️ אבידות שהוחזרו / נמחקו</h2>
    </div>
    <div class="page-guide section-card guide-accent-cyan">
      <strong>היסטוריית אבידות</strong>
      <p>כאן נשמרות אבידות שהוחזרו או נמחקו מכל שלושת סוגי האבידות, כולל סיבת המחיקה ופרטי ההחזרה.</p>
    </div>
    <div class="toolbar">
      <input type="text" id="searchInput" placeholder="🔍 חיפוש..." />
      <input type="date" id="dateInput" title="סינון לפי תאריך סגירה" />
      <select id="statusInput" title="סינון לפי סטטוס">
        <option value="all">הכול</option>
        <option value="returned">הוחזרו</option>
        <option value="deleted">נמחקו</option>
      </select>
      <button id="clearFilters" class="btn btn-secondary btn-sm">נקה סינון</button>
      <span class="spacer"></span>
      <span class="muted" id="countLabel"></span>
    </div>
    <div class="table-wrap">
      <table class="data responsive-table">
        <thead><tr>
          <th>מס׳ אבידה</th><th>תאריך האבידה</th><th>תיאור</th><th>מקור</th>
          <th>סטטוס</th><th>תאריך סגירה</th><th>סיבת מחיקה</th><th>פעולות</th>
        </tr></thead>
        <tbody id="tbody"><tr><td colspan="8" class="empty">טוען...</td></tr></tbody>
      </table>
    </div>`;

  const tbody = container.querySelector("#tbody");
  const countLabel = container.querySelector("#countLabel");
  const searchInput = container.querySelector("#searchInput");
  const dateInput = container.querySelector("#dateInput");
  const statusInput = container.querySelector("#statusInput");

  searchInput.addEventListener("input", () => { viewState.search = searchInput.value; render(); });
  dateInput.addEventListener("change", () => { viewState.date = dateInput.value; render(); });
  statusInput.addEventListener("change", () => { viewState.status = statusInput.value; render(); });
  container.querySelector("#clearFilters").addEventListener("click", () => {
    searchInput.value = "";
    dateInput.value = "";
    statusInput.value = "all";
    viewState = { search: "", date: "", status: "all" };
    render();
  });

  unsubscribers = SOURCES.map((source) => subscribeCollection(source, (items) => {
    snapshots.set(source, items);
    loaded.add(source);
    render();
  }, () => {
    loaded.add(source);
    render();
  }));

  function combinedItems() {
    const archived = snapshots.get("closedItems").map((item) => ({
      ...item,
      _key: `archive:${item.id}`,
      _status: item.terminalStatus || (item.returned ? "returned" : "deleted"),
      _source: item.sourceCollection || "lostItems",
      _closedAt: item.closedAt || item.returnDetails?.returnedAt || item.deletedAt || item.createdAt
    }));
    const archivedSources = new Set(archived.map((item) => `${item._source}:${item.sourceId}`));
    const legacyReturned = SOURCES.filter((source) => source !== "closedItems").flatMap((source) =>
      snapshots.get(source)
        .filter((item) => item.returned && !archivedSources.has(`${source}:${item.id}`))
        .map((item) => ({
          ...item,
          _key: `legacy:${source}:${item.id}`,
          _status: "returned",
          _source: source,
          _closedAt: item.returnDetails?.returnedAt || item.createdAt
        }))
    );
    return archived.concat(legacyReturned);
  }

  function render() {
    if (loaded.size < SOURCES.length) return;
    let items = filterItems(combinedItems(), {
      search: viewState.search,
      dateFilter: viewState.date,
      dateField: "_closedAt"
    });
    if (viewState.status !== "all") items = items.filter((item) => item._status === viewState.status);
    items.sort((a, b) => new Date(b._closedAt || 0) - new Date(a._closedAt || 0));
    countLabel.textContent = `${items.length} פריטים`;

    if (!items.length) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty">אין אבידות להצגה</td></tr>`;
      return;
    }

    tbody.innerHTML = items.map((item) => `
      <tr data-key="${escapeHtml(item._key)}">
        <td data-label="מס׳ אבידה">${escapeHtml(item.number || "—")}</td>
        <td data-label="תאריך האבידה">${escapeHtml(formatDateTime(item.dateTime))}</td>
        <td data-label="תיאור">${escapeHtml(item.description || "")}</td>
        <td data-label="מקור">${escapeHtml(SOURCE_LABELS[item._source] || item._source)}</td>
        <td data-label="סטטוס">${item._status === "returned"
          ? '<span class="badge green">הוחזרה</span>'
          : '<span class="badge red">נמחקה</span>'}</td>
        <td data-label="תאריך סגירה">${escapeHtml(formatDateTime(item._closedAt))}</td>
        <td data-label="סיבת מחיקה">${escapeHtml(item.deletionReason || (item._status === "deleted" ? "לא צוינה" : "—"))}</td>
        <td data-label="פעולות" class="actions-cell">
          <button class="btn btn-sm btn-outline" data-action="details">פרטים</button>
          ${item._status === "returned" ? '<button class="btn btn-sm btn-outline" data-action="return">פרטי החזרה</button>' : ""}
        </td>
      </tr>`).join("");

    tbody.querySelectorAll("tr[data-key]").forEach((row) => {
      row.addEventListener("click", (event) => {
        const item = items.find((candidate) => candidate._key === row.dataset.key);
        if (!item) return;
        const action = event.target.closest("button[data-action]")?.dataset.action;
        if (action === "return") openReturnDetailsModal(item);
        else openItemDetailsModal({
          title: "פרטי אבידה מההיסטוריה",
          item,
          extraRows: [
            { label: "עמוד מקור", value: SOURCE_LABELS[item._source] || item._source },
            { label: "סטטוס סופי", value: item._status === "returned" ? "הוחזרה" : "נמחקה" },
            { label: "תאריך סגירה", value: formatDateTime(item._closedAt) },
            { label: "סיבת מחיקה", value: item.deletionReason }
          ],
          footerButtons: [
            { label: "סגור", className: "btn-secondary", onClick: ({ close }) => close() },
            ...(item._status === "returned" ? [{
              label: "פרטי החזרה והחתימה",
              className: "btn-success",
              onClick: ({ close }) => {
                close();
                openReturnDetailsModal(item);
              }
            }] : [])
          ]
        });
      });
    });
  }
}

export function teardownClosedItems() {
  unsubscribers.forEach((unsubscribe) => {
    try { unsubscribe(); } catch (_) { }
  });
  unsubscribers = [];
}
