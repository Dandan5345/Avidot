// Home page with category buttons.
import { isAdmin, isAhmash, currentUser } from "./auth.js";
import { openModal } from "./utils.js";

const ADD_ITEM_TARGETS = {
  lost: { route: "lost-items", requestKey: "openAddLostItems" },
  pending: { route: "pending-pickup", requestKey: "openAddPendingPickup" },
  awaiting: { route: "awaiting-info", requestKey: "openAddAwaitingInfo" }
};

export function renderHome(container) {
  const showAdmin = isAdmin();
  const showAhmash = isAhmash() || currentUser.role === "ahmash";
  const showUsers = isAhmash(); // admin or ahmash can manage users

  container.innerHTML = `
    <div class="home-wrapper">
      <div class="home-hero">
        <div class="hero-overlay">
          <div class="hero-content">
            <h2>ברוכים הבאים, ${escapeName(currentUser.name)}</h2>
            <p>מערכת ניהול אבידות ומציאות – ביטחון מלון ממילא</p>
            <div class="hero-actions">
              <button id="quickAddItemBtn" class="btn btn-outline-light">➕ הוסף אבידה</button>
              ${showUsers ? `<button id="usersBtn" class="btn btn-outline-light">👥 ניהול משתמשים</button>` : ""}
              ${showAdmin ? `<button id="logBtn" class="btn btn-outline-light">📜 בקרת יומן (LOG)</button>` : ""}
            </div>
          </div>
        </div>
      </div>
      <div class="home-content">
        <p class="home-intro muted center-text">בחר קטגוריה להמשך פעולה:</p>
        <div class="home-grid">
          <div class="home-card modern-card" data-route="lost-items">
            <span class="home-card-tag">תפעול שוטף</span>
            <div class="icon-wrap"><div class="icon">🎒</div></div>
            <h3>אבידות</h3>
            <p>רישום וניהול אבידות שנמצאו במלון</p>
          </div>
          <div class="home-card modern-card" data-route="pending-pickup">
            <span class="home-card-tag">קבלת בעלים</span>
            <div class="icon-wrap"><div class="icon">📦</div></div>
            <h3>ממתינות לאיסוף</h3>
            <p>אבידות שהבעלים יבוא לאסוף</p>
          </div>
          <div class="home-card modern-card" data-route="awaiting-info">
            <span class="home-card-tag">טיפול חסר</span>
            <div class="icon-wrap"><div class="icon">⏳</div></div>
            <h3>שמחכות למידע</h3>
            <p>אבידות הממתינות להשלמת פרטים</p>
          </div>
          ${showAhmash ? `
            <div class="home-card modern-card ahmash-card" data-route="manager-actions">
              <span class="home-card-tag">ניהול אחמ"ש</span>
              <div class="icon-wrap"><div class="icon">🗂️</div></div>
              <h3>משיכת / מחיקת אבידות</h3>
              <p>פעולות אחמ"ש: תרומה / מחיקה</p>
            </div>` : ""}
        </div>
      </div>
    </div>
  `;

  container.querySelectorAll(".home-card").forEach((c) => {
    c.addEventListener("click", () => {
      location.hash = "#/" + c.dataset.route;
    });
  });

  const usersBtn = container.querySelector("#usersBtn");
  if (usersBtn) usersBtn.addEventListener("click", () => { location.hash = "#/users"; });
  const logBtn = container.querySelector("#logBtn");
  if (logBtn) logBtn.addEventListener("click", () => { location.hash = "#/activity-log"; });
  const quickAddItemBtn = container.querySelector("#quickAddItemBtn");
  if (quickAddItemBtn) quickAddItemBtn.addEventListener("click", openQuickAddItemModal);
}

function escapeName(s) {
  return String(s || "").replace(/[<>&"']/g, (c) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

function openQuickAddItemModal() {
  const modal = openModal({
    title: "הוספת אבידה",
    bodyHtml: `
      <div class="upload-source-actions">
        <button type="button" class="upload-choice" data-add-target="lost">
          <strong>אבידה רגילה</strong>
          <small>פתיחת טופס ההוספה הרגיל בדף אבידות.</small>
        </button>
        <button type="button" class="upload-choice" data-add-target="pending">
          <strong>אבידה שממתינה לאיסוף</strong>
          <small>פתיחת טופס ההוספה של ממתינות לאיסוף.</small>
        </button>
        <button type="button" class="upload-choice" data-add-target="awaiting">
          <strong>אבידה שמחכה למידע</strong>
          <small>פתיחת טופס ההוספה של ממתינות למידע.</small>
        </button>
      </div>`,
    footerButtons: [
      { label: "ביטול", className: "btn-secondary", onClick: ({ close }) => close() }
    ]
  });

  modal.body.querySelectorAll("[data-add-target]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = ADD_ITEM_TARGETS[button.dataset.addTarget];
      if (!target) return;
      sessionStorage.setItem(target.requestKey, "1");
      modal.close();
      location.hash = `#/${target.route}`;
    });
  });
}
