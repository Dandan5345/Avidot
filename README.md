# Avidot — מערכת אבידות ומציאות

אפליקציית רשת בת עמוד אחד (SPA) לניהול אבידות ומציאות עבור מחלקת ביטחון של מלון.

## טכנולוגיות

- **Vanilla JavaScript** (מודולים של ES6) — ללא תלות ב-bundler.
- **HTML5 + CSS3** — ממשק נקי ומודרני, RTL.
- **Firebase** — Authentication + Realtime Database (CDN, גרסה 12.12.1).
- **ImgBB API** — אחסון תמונות.

## מבנה הפרויקט

```
.
├── index.html
├── database.rules.json     ← Realtime DB security rules
├── css/
│   └── styles.css
└── js/
    ├── app.js              ← נקודת כניסה + ראוטר
    ├── firebase.js         ← אתחול Firebase + מפתח ImgBB
    ├── auth.js             ← מסך התחברות וניהול משתמש נוכחי
    ├── users.js            ← לוח בקרה למנהלים
    ├── home.js             ← דף הבית
    ├── lostItems.js        ← דף 1: אבידות
    ├── pendingPickup.js    ← דף 2: אבידות ממתינות לאיסוף
    ├── awaitingInfo.js     ← דף 3: אבידות שמחכות למידע
    ├── managerActions.js   ← דף 4: משיכת/מחיקת אבידות (אחמ"ש)
    ├── itemsCommon.js      ← פונקציות עזר משותפות לטבלאות אבידות
    ├── imgbb.js            ← העלאת תמונות ל-ImgBB
    └── utils.js            ← מודלים, חיפוש, פורמטים
```

## הרצה מקומית

מאחר ומשתמשים ב-ES Modules ו-Firebase Auth, האתר חייב להיות מוגש מ-HTTP server (לא `file://`).
לדוגמה:

```bash
# מתוך תיקיית הפרויקט:
python3 -m http.server 8080
# ואז גלוש ל http://localhost:8080
```

או באמצעות `npx serve`, IIS, nginx, או כל שרת סטטי אחר.

## פריסה ל-Firebase Hosting (אופציונלי)

```bash
firebase init hosting
firebase deploy --only hosting,database
```

ה-`database.rules.json` כבר מוגדר ויפרס אוטומטית.

## הקמה ראשונית

1. **צור את חשבון מנהל העל** ב-Firebase Console → Authentication → Add user:
   - אימייל: `Doronenakache@gmail.com`
   - סיסמה כרצונך.
   - חשבון זה זוכה אוטומטית להרשאת מנהל ולא ניתן למחוק אותו.
2. בכניסה ראשונה למערכת, פרופיל המשתמש שלו ייווצר אוטומטית בענף `/users` של ה-Realtime DB.
3. דרך לוח בקרת המשתמשים, מנהל העל יכול ליצור את שאר המשתמשים (קב"ט / אחמ"ש / מנהלים).

## הרשאות

| תפקיד     | התחברות | רואה דפי אבידות | פעולות אחמ"ש | ניהול משתמשים |
|-----------|---------|------------------|---------------|----------------|
| קב"ט      | ✓       | ✓                | ✗             | ✗              |
| אחמ"ש     | ✓       | ✓                | ✓             | ✗              |
| מנהל      | ✓       | ✓                | ✓ (אם אחמ"ש)   | ✓              |
| מנהל על   | ✓       | ✓                | ✓ (תמיד)       | ✓ (תמיד)        |

ההרשאות נאכפות גם בצד הקליינט (UI) וגם בצד השרת באמצעות `database.rules.json`.

## תכונות עיקריות

### 1. אימות
- מסך התחברות בלבד; אין הרשמה פתוחה.
- מנהל העל (`Doronenakache@gmail.com`) עוקף בדיקות ההרשאה ולא ניתן למחוק.
- משתמשים חדשים נוצרים על ידי מנהלים בלבד, באמצעות secondary Firebase Auth instance כך שהמנהל לא מנותק.

### 2. דפי אבידות (3 קטגוריות)
- חיפוש גלובלי, סינון לפי תאריך, מיון לפי מספר אבידה (האחרון נמצא למעלה).
- כל אבידה כוללת מודל פרטים + תמונה.
- העלאה אסינכרונית ל-ImgBB עם מצב טעינה.

### 3. דף 1 — אבידות
- מספור אוטומטי, datetime עם ברירת מחדל "עכשיו", תיבת "יקרת ערך", רשימה נפתחת לאחסון (כולל "אחר"), שדה "לא ידוע" למוצא.
- כפתור "הצג אבידות שהוחזרו" (סינון).
- תהליך החזרה כולל פתרון קונפליקטים כשמספר אותו מספר חוזר על עצמו.

### 4. דף 2 — אבידות ממתינות לאיסוף
- שדות נוספים לבעל האבידה (שם, טלפון, מיקום נוכחי, פרטים נוספים).
- מספור עצמאי.

### 5. דף 3 — אבידות שמחכות למידע
- כפתור "העבר אבידה" שמוביל לדף 1 או דף 2 ופותח שם את מודל ההוספה כשהוא ממולא מראש; בעת השמירה, הרשומה המקורית נמחקת.

### 6. פעולות אחמ"ש
- בחירת טווח תאריכים, האם לכלול יקרות ערך, ובחירת פעולה: **תרומה** (רשימה ניתנת להדפסה עם 3 אופציות מיון) או **מחיקה** (אישור כפול).
- פועל אך ורק על אבידות רגילות שלא הוחזרו.

### 7. גיבוי אוטומטי ל-Google Sheets
- כל יצירה, עדכון או מחיקה של רשומה ב-`/lostItems` נשלחים אוטומטית ל-Google Apps Script דרך Cloud Function.
- בנוסף לרשומות בזמן אמת, רצה כל 6 שעות סנכרון מלא של כל דף האבידות כדי לשחזר נתונים חסרים או כשלי רשת נקודתיים.
- המטען שנשלח כולל את כל פרטי האבידה, כולל מזהה מסמך, מספר אבידה, קישור לתמונה, סטטוס, פרטי החזרה, וכתובת החתימה הדיגיטלית.
- כתובת היעד נקראת ממשתנה הסביבה `GOOGLE_SHEETS_SCRIPT_URL`, ויש להגדיר אותו לערך של כתובת ה-Web App שסיפקתם ב-Google Apps Script לפני פריסה.

#### מבנה המטען שנשלח ל-Google Apps Script
- `action: "upsert"` — יצירה/עדכון של אבידה בודדת.
- `action: "delete"` — מחיקה של אבידה; הרשומה נשלחת עם `status: "deleted"` ו-`deletedAt`.
- `action: "full_sync"` — סנכרון מלא של כל אבידות `lostItems`, מחולק ל-chunks של עד 100 רשומות בכל בקשה.
- בכל payload יש רשומה/רשומות עם שדות כגון:
  - `id`, `number`, `dateTime`, `description`, `valuable`, `foundLocation`
  - `storageLocation`, `storageOther`, `storageDisplay`
  - `finderName`, `finderDept`, `finderUnknown`, `kabatHandler`
  - `ownerName`, `ownerPhone`, `ownerId`, `photoUrl`
  - `returned`, `status`, `statusLabel`
  - `returnReceiverName`, `returnReceiverContact`, `returnHandlerName`, `returnReturnedAt`, `returnReturnedBy`, `returnSignatureUrl`
  - `createdAt`, `createdBy`, `createdByName`, `deletedAt`, `syncedAt`

## מבנה הנתונים

```
/users/{uid}: { name, employeeNumber, email, role: "kabat"|"ahmash", isAdmin, createdAt, ... }
/lostItems/{pushId}: { number, dateTime, description, valuable, foundLocation,
                       storageLocation, storageOther, finderName, finderDept,
                       finderUnknown, kabatHandler, photoUrl, returned,
                       returnDetails: { receiverName, receiverContact, handlerName, returnedAt },
                       createdAt, createdBy, createdByName }
/pendingPickup/{pushId}: { ...similar, ownerName, ownerPhone, currentLocation, additionalDetails }
/awaitingInfo/{pushId}:  { ...similar, currentLocation, additionalDetails }
/counters/{collection}:  number   // משמש למספר הבא; ניתן לאיפוס ידני (ולכן יתכנו מספרים חוזרים)
```

## הערות אבטחה

- קוד הקליינט מכיל את `firebaseConfig` ואת מפתח ImgBB, כפי שהוגדר ב-spec — אלו לא סודות מצד השרת.
- אבטחת הקריאה/כתיבה למסד הנתונים נשלטת ע"י `database.rules.json`. כל פעולה ב-`/users` דורשת `isAdmin == true` או את אימייל מנהל העל.
- מחיקת חשבון משתמש מוחקת אותו מ-`/users`. מחיקה מ-Firebase Auth דורשת פעולה ידנית בקונסול או Cloud Function (לא נכלל כאן בשל מגבלות הקליינט).
