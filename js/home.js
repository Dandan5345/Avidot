// Home page with category buttons.
import { isAdmin, isAhmash, currentUser } from "./auth.js";

export function renderHome(container) {
  const showAdmin = isAdmin();
  const showAhmash = isAhmash() || currentUser.role === "ahmash";

  container.innerHTML = `
    <div class="home-wrapper">
      <div class="home-hero">
        <div class="hero-overlay">
          <div class="hero-content">
            <h2>ברוכים הבאים, ${escapeName(currentUser.name)}</h2>
            <p>מערכת ניהול אבידות ומציאות – ביטחון מלון ממילא</p>
            ${showAdmin ? `<div class="hero-actions"><button id="usersBtn" class="btn btn-outline-light">👥 ניהול משתמשים</button></div>` : ""}
          </div>
        </div>
      </div>
      <div class="home-content">
        <p class="muted center-text" style="font-size:16px; margin: 10px 0 24px;">בחר קטגוריה להמשך פעולה:</p>
        <div class="home-grid">
          <div class="home-card modern-card" data-route="lost-items">
            <div class="icon-wrap"><div class="icon">🎒</div></div>
            <h3>אבידות</h3>
            <p>רישום וניהול אבידות שנמצאו במלון</p>
          </div>
          <div class="home-card modern-card" data-route="pending-pickup">
            <div class="icon-wrap"><div class="icon">📦</div></div>
            <h3>ממתינות לאיסוף</h3>
            <p>אבידות שהבעלים יבוא לאסוף</p>
          </div>
          <div class="home-card modern-card" data-route="awaiting-info">
            <div class="icon-wrap"><div class="icon">⏳</div></div>
            <h3>שמחכות למידע</h3>
            <p>אבידות הממתינות להשלמת פרטים</p>
          </div>
          ${showAhmash ? `
            <div class="home-card modern-card ahmash-card" data-route="manager-actions">
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
}

function escapeName(s) {
  return String(s || "").replace(/[<>&"']/g, (c) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;"
  })[c]);
}
