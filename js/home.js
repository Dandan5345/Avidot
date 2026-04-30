// Home page with category buttons.
import { isAdmin, isAhmash, currentUser } from "./auth.js";

export function renderHome(container) {
  const showAdmin = isAdmin();
  const showAhmash = isAhmash() || currentUser.role === "ahmash";

  container.innerHTML = `
    <div class="page-title">
      <h2>ברוכים הבאים, ${escapeName(currentUser.name)}</h2>
      <div class="home-actions">
        ${showAdmin ? `<button id="usersBtn" class="btn btn-outline">👥 ניהול משתמשים</button>` : ""}
      </div>
    </div>
    <p class="muted">בחר קטגוריה להמשך:</p>
    <div class="home-grid">
      <div class="home-card" data-route="lost-items">
        <div class="icon">🎒</div>
        <h3>אבידות</h3>
        <p>רישום וניהול אבידות שנמצאו במלון.</p>
      </div>
      <div class="home-card" data-route="pending-pickup">
        <div class="icon">📦</div>
        <h3>אבידות ממתינות לאיסוף</h3>
        <p>אבידות שהבעלים יבוא לאסוף.</p>
      </div>
      <div class="home-card" data-route="awaiting-info">
        <div class="icon">⏳</div>
        <h3>אבידות שמחכות למידע</h3>
        <p>אבידות הממתינות להשלמת פרטים.</p>
      </div>
      ${showAhmash ? `
        <div class="home-card" data-route="manager-actions" style="border-color:#d97706">
          <div class="icon">🗂️</div>
          <h3>משיכת / מחיקת אבידות</h3>
          <p>פעולות אחמ"ש: תרומה / מחיקה לפי תאריכים.</p>
        </div>` : ""}
    </div>
  `;

  container.querySelectorAll(".home-card").forEach((c) => {
    c.addEventListener("click", () => {
      location.hash = "#/" + c.dataset.route;
    });
  });

  const usersBtn = container.querySelector("#usersBtn");
  if (usersBtn) usersBtn.addEventListener("click", () => { location.hash = "#/users"; });
}

function escapeName(s) {
  return String(s || "").replace(/[<>&"']/g, (c) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;"
  })[c]);
}
