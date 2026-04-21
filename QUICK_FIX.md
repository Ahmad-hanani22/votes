# ⚡ خطوات التطبيق السريعة

## 1. تثبيت المكتبات
```bash
cd c:\Users\ahmad\OneDrive\Desktop\Votes
cd server && npm install && cd ../client && npm install && cd ..
```

## 2. إنشاء PostgreSQL على Render
- اذهب إلى [render.com](https://render.com)
- اضغط **New +** → **PostgreSQL**
- احفظ رابط الاتصال (Connection String)

## 3. تحديث متغيرات البيئة على Render
في تطبيقك على Render اضغط **Environment** وأضف:
```
DATABASE_URL=postgresql://postgres:password@...
NODE_ENV=production
```

## 4. رفع التحديثات
```bash
git add .
git commit -m "Migrate to PostgreSQL for persistent storage"
git push
```

## 5. الانتظار للبناء
- انتظر 3-5 دقائق حتى ينتهي Render من البناء
- افتح رابط تطبيقك
- جرّب تسجيل مستخدم وإضافة ناخبين
- **أوقف وأعد تشغيل** من لوحة Render
- تحقق: هل البيانات موجودة؟ ✅

---

## الملفات المُحدّثة:
- ✅ server/package.json
- ✅ server/src/db.ts
- ✅ server/src/index.ts
- ✅ server/src/routes/auth.ts
- ✅ server/src/routes/users.ts
- ✅ server/src/routes/logs.ts
- ✅ server/src/routes/dashboard.ts
- ✅ server/src/routes/batches.ts
- ✅ server/src/routes/voters.ts
- ✅ server/src/audit.ts
- ✅ server/src/migrate.ts
- ✅ server/src/batchFromAreas.ts
- ✅ server/src/middleware/auth.ts
- ✅ server/.env.example

**تم الحل بنجاح!** 🎉
