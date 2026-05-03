import { isAdmin } from "./auth.js";
import { collectionLabel, subscribeActivityLogs } from "./activityLog.js";
import { escapeHtml, formatDateTime } from "./utils.js";

let unsubscribe = null;
let allLogs = [];
let hasLoadedSnapshot = false;
let loadError = "";
let viewState = { search: "", actor: "", date: "" };
const VISIBLE_LOG_ACTION_PREFIXES = [
    "item.create.",
    "item.delete.",
    "item.return.",
    "item.transfer.",
    "manager.fetch."
];

export function renderActivityLogsPage(container) {
    if (!isAdmin()) {
        container.innerHTML = `
      <div class="page-title"><h2>LOG</h2></div>
      <div class="section-card"><p>אין לך הרשאה לדף זה.</p></div>`;
        return;
    }

    container.innerHTML = `
    <div class="page-title">
      <h2>📜 LOG</h2>
    </div>
    <section class="activity-log-hero section-card">
      <div>
        <span class="activity-log-eyebrow">יומן פעילות ניהולי</span>
        <h3>כל שינוי במערכת, בשפה פשוטה וברורה</h3>
        <p>כאן רואים מי עשה מה, על איזה אבידה או משתמש, מאיזה דף לאיזה דף, ומתי בדיוק. הלוג נשמר ב-Firestore ונמחק אוטומטית אחת לחודש.</p>
      </div>
    </section>
    <div class="toolbar log-toolbar">
      <input type="text" id="logSearch" placeholder="🔍 חפש פעולה, משתמש או מספר אבידה..." />
      <select id="logActorFilter">
        <option value="">כל המשתמשים</option>
      </select>
      <input type="date" id="logDateFilter" />
      <button id="clearLogFilters" class="btn btn-secondary btn-sm">נקה סינון</button>
      <span class="spacer"></span>
      <span class="muted" id="logCountLabel"></span>
    </div>
    <div class="log-summary-grid" id="logSummary"></div>
    <div id="logList" class="activity-log-list">
      <div class="section-card"><p>טוען...</p></div>
    </div>
  `;

    const searchInput = container.querySelector("#logSearch");
    const actorFilter = container.querySelector("#logActorFilter");
    const dateFilter = container.querySelector("#logDateFilter");

    searchInput.addEventListener("input", () => {
        viewState.search = searchInput.value;
        render(container);
    });
    actorFilter.addEventListener("change", () => {
        viewState.actor = actorFilter.value;
        render(container);
    });
    dateFilter.addEventListener("change", () => {
        viewState.date = dateFilter.value;
        render(container);
    });
    container.querySelector("#clearLogFilters").addEventListener("click", () => {
        viewState = { search: "", actor: "", date: "" };
        searchInput.value = "";
        actorFilter.value = "";
        dateFilter.value = "";
        render(container);
    });

    unsubscribe = subscribeActivityLogs((logs) => {
        allLogs = logs.filter(shouldDisplayLog);
        hasLoadedSnapshot = true;
        loadError = "";
        render(container);
    }, (error) => {
        loadError = error?.message || "שגיאה בטעינת הלוג";
        render(container);
    });
}

export function teardownActivityLogsPage() {
    if (unsubscribe) {
        try { unsubscribe(); } catch (_) { }
        unsubscribe = null;
    }
}

function render(container) {
    const actorFilter = container.querySelector("#logActorFilter");
    const countLabel = container.querySelector("#logCountLabel");
    const summaryEl = container.querySelector("#logSummary");
    const listEl = container.querySelector("#logList");

    if (!hasLoadedSnapshot && loadError) {
        listEl.innerHTML = `<div class="section-card"><p>${escapeHtml(loadError)}</p></div>`;
        summaryEl.innerHTML = "";
        countLabel.textContent = "";
        return;
    }

    actorFilter.innerHTML = renderActorOptions(allLogs, viewState.actor);

    const filtered = allLogs.filter((log) => matchesFilters(log));
    countLabel.textContent = `${filtered.length} רשומות`;
    summaryEl.innerHTML = renderSummary(filtered);

    if (!filtered.length) {
        listEl.innerHTML = `
      <div class="section-card log-empty-state">
        <strong>לא נמצאו פעולות שתואמות לסינון</strong>
        <p>נסה לחפש לפי שם משתמש, מספר אבידה, או תאריך אחר.</p>
      </div>`;
        return;
    }

    listEl.innerHTML = filtered.map((log, index) => renderLogCard(log, index)).join("");
}

function renderActorOptions(logs, selectedActor) {
    const names = Array.from(new Set(logs.map((log) => log.actorName).filter(Boolean))).sort((a, b) => a.localeCompare(b, "he"));
    return [
        `<option value="">כל המשתמשים</option>`,
        ...names.map((name) => `<option value="${escapeHtml(name)}" ${selectedActor === name ? "selected" : ""}>${escapeHtml(name)}</option>`)
    ].join("");
}

function renderSummary(logs) {
    const createdCount = logs.filter((log) => String(log.action || "").includes("item.create.")).length;
    const deletedCount = logs.filter((log) => String(log.action || "").includes("item.delete.")).length;
    const returnedCount = logs.filter((log) => String(log.action || "").includes("item.return.")).length;
    const moveChanges = logs.filter((log) => String(log.action || "").includes("item.transfer.")).length;
    const withdrawalsCount = logs.filter((log) => String(log.action || "").includes("manager.fetch.")).length;
    const latest = logs[0]?.createdAt ? formatDateTime(logs[0].createdAt) : "-";

    return `
    <div class="log-summary-card section-card">
      <strong>${logs.length}</strong>
      <span>סה"כ פעולות מוצגות</span>
    </div>
    <div class="log-summary-card section-card">
      <strong>${createdCount}</strong>
      <span>הוספות אבידה</span>
    </div>
    <div class="log-summary-card section-card">
      <strong>${deletedCount}</strong>
      <span>מחיקות אבידה</span>
    </div>
    <div class="log-summary-card section-card">
      <strong>${returnedCount}</strong>
      <span>החזרות אבידה</span>
    </div>
    <div class="log-summary-card section-card">
      <strong>${withdrawalsCount}</strong>
      <span>משיכות</span>
    </div>
    <div class="log-summary-card section-card">
      <strong>${moveChanges}</strong>
      <span>העברות אבידה</span>
    </div>
    <div class="log-summary-card section-card">
      <strong>${escapeHtml(latest)}</strong>
      <span>פעולה אחרונה</span>
    </div>
  `;
}

function matchesFilters(log) {
    const q = (viewState.search || "").trim().toLowerCase();
    const text = [
        log.summary,
        log.actorName,
        log.itemNumber,
        ...(Array.isArray(log.detailLines) ? log.detailLines : [])
    ].join(" ").toLowerCase();
    if (q && !text.includes(q)) return false;
    if (viewState.actor && (log.actorName || "") !== viewState.actor) return false;
    if (viewState.date) {
        const logDate = toDateKey(log.createdAt);
        if (logDate !== viewState.date) return false;
    }
    return true;
}

function toDateKey(value) {
    const date = new Date(value || "");
    if (Number.isNaN(date.getTime())) return "";
    const pad = (num) => String(num).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function renderLogCard(log, index) {
    const meta = log.metadata || {};
    const chips = [
        log.actorName ? `<span class="badge blue">${escapeHtml(log.actorName)}</span>` : "",
        log.itemNumber ? `<span class="log-chip">אבידה ${escapeHtml(log.itemNumber)}</span>` : "",
        meta.sourceCollection ? `<span class="log-chip">מ: ${escapeHtml(collectionLabel(meta.sourceCollection))}</span>` : "",
        meta.targetCollection ? `<span class="log-chip">ל: ${escapeHtml(collectionLabel(meta.targetCollection))}</span>` : "",
        `<span class="log-chip muted-chip">${escapeHtml(entityLabel(log.entityType))}</span>`
    ].filter(Boolean).join("");

    return `
    <article class="log-card section-card" style="animation-delay:${Math.min(index * 40, 240)}ms">
      <div class="log-card-head">
        <div class="log-card-copy">
          <div class="log-card-kicker">${escapeHtml(formatDateTime(log.createdAt))}</div>
          <h3>${escapeHtml(log.summary || "פעולה ללא תיאור")}</h3>
          <div class="log-chip-row">${chips}</div>
        </div>
      </div>
      ${renderLogFacts(log)}
      ${Array.isArray(log.detailLines) && log.detailLines.length ? `
        <ul class="log-detail-list">
          ${log.detailLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
        </ul>` : ""}
    </article>
  `;
}

function renderLogFacts(log) {
    const facts = [
        log.actorEmail ? { label: 'משתמש', value: log.actorEmail } : null,
        log.action ? { label: 'סוג פעולה', value: actionLabel(log.action) } : null
    ].filter(Boolean);

    if (!facts.length) return "";

    return `
    <div class="log-facts-grid">
      ${facts.map((fact) => `
        <div class="log-fact">
          <span>${escapeHtml(fact.label)}</span>
          <strong>${escapeHtml(fact.value)}</strong>
        </div>`).join("")}
    </div>`;
}

function entityLabel(entityType) {
    switch (entityType) {
        case "item":
            return "אבידה";
        case "user":
            return "משתמש";
        case "page":
            return "דף";
        case "report":
            return "דוח";
        default:
            return "מערכת";
    }
}

function actionLabel(action) {
    if (!action) return "פעולה כללית";
    if (action.includes("transfer")) return "העברה בין דפים";
    if (action.includes("return")) return "החזרה / מסירה";
    if (action.includes("delete")) return "מחיקה";
    if (action.includes("create")) return "יצירה";
    if (action.includes("update")) return "עדכון";
    if (action.includes("view")) return "צפייה";
    if (action.includes("fetch")) return "משיכת נתונים";
    if (action.includes("print")) return "הדפסה";
    if (action.includes("sort")) return "מיון";
    return action;
}

function shouldDisplayLog(log) {
    const action = String(log?.action || "");
    return VISIBLE_LOG_ACTION_PREFIXES.some((prefix) => action.startsWith(prefix));
}
