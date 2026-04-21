# 🎯 حل المشكلة: البيانات تُحذف تلقائياً على Render

## المشكلة الأصلية ❌
- البيانات كانت تُخزّن في **SQLite** على الملف `server/data/app.db`
- عند رفع التطبيق على **Render**، الملفات المحفوظة تُحذف تلقائياً عند إعادة تشغيل السيرفر (Ephemeral Storage)
- فأي مستخدم يُسجّل يُحذف بعد ساعات أو عند إعادة النشر

## الحل النهائي ✅
تحويل من **SQLite** إلى **PostgreSQL** (قاعدة بيانات سحابية دائمة):

1. **PostgreSQL** يُخزّن البيانات على سيرفر منفصل (مش على Render ephemeral storage)
2. البيانات **تبقى محفوظة** حتى لو أعدت تشغيل السيرفر
3. **Render** يوفر PostgreSQL مجاني (limited) أو مدفوع

---

## خطوات التنفيذ

### 1️⃣ إنشاء PostgreSQL على Render

#### أ. في لوحة تحكم Render:
1. اذهب إلى [render.com](https://render.com)
2. اختر **"New +"** → **"PostgreSQL"**
3. املأ البيانات:
   - **Name**: `votes-db` (أو أي اسم)
   - **Database**: `votes_db`
   - **User**: `postgres` (افتراضي)
   - اتركِ الباقي افتراضي
4. اضغط **"Create Database"**
5. **انسخ** رابط الاتصال (Connection String) - يبدو كهكذا:
   ```
   postgresql://postgres:password@dpg-xxxxx.render.internal:5432/votes_db
   ```

#### ب. إضافة PostgreSQL لتطبيقك الموجود:
1. اذهب لتطبيقك على Render
2. اضغط **"Environment"** في القائمة اليسرى
3. أضف متغير جديد:
   - **Key**: `DATABASE_URL`
   - **Value**: (الرابط الذي نسختهِ للتو)
4. أضف أيضاً:
   - **Key**: `NODE_ENV`
   - **Value**: `production`

---

### 2️⃣ الملفات المُحدّثة

تم تحديث الملفات التالية لاستخدام PostgreSQL:

✅ `server/package.json` - إضافة `pg` library
✅ `server/src/db.ts` - تحويل من SQLite إلى PostgreSQL async
✅ `server/src/index.ts` - تطبيق async initialization
✅ `server/src/routes/*.ts` - تحويل جميع الـ routes للـ async
✅ `server/src/audit.ts` - async logging
✅ `server/src/migrate.ts` - async migrations
✅ `server/src/batchFromAreas.ts` - async batch assignment
✅ `server/src/middleware/auth.ts` - async user queries
✅ `server/.env.example` - إضافة DATABASE_URL

---

### 3️⃣ خطوات النشر على Render

#### أ. تحديث الكود محلياً:
```bash
cd c:\Users\ahmad\OneDrive\Desktop\Votes

# تثبيت المكتبات الجديدة
cd server
npm install

cd ../client
npm install

cd ..
```

#### ب. اختبار محلي (اختياري):
إذا أردت اختبار PostgreSQL محلياً:
1. ثبّت PostgreSQL على جهازك أو استخدم Docker
2. أنشئ قاعدة بيانات: `createdb votes_db`
3. في `server/.env`:
   ```
   DATABASE_URL=postgresql://postgres:password@localhost:5432/votes_db
   NODE_ENV=development
   ```
4. شغّل: `npm run dev`

#### ج. Push to Git:
```bash
git add .
git commit -m "fix: migrate from SQLite to PostgreSQL for persistent storage"
git push
```

#### د. Render سيُحدّث تلقائياً
- Render سيشتري الـ build من جديد
- سيشغّل `npm run build` و `npm start`
- التطبيق سيتصل بـ PostgreSQL تلقائياً عبر `DATABASE_URL`

---

### 4️⃣ التحقق من النجاح

بعد الانتظار (2-5 دقائق للبناء والنشر):

1. اذهب لرابط تطبيقك على Render
2. سجّل مستخدم جديد
3. أضفِ بعض الناخبين
4. **أوقف وأعد تشغيل** التطبيق من لوحة تحكم Render
5. **التحقق**: هل البيانات موجودة؟ ✅

---

## ملاحظات مهمة ⚠️

### ماذا حدث للـ `server/data/app.db`؟
- لا تحتاجه أكثر ❌
- يمكنك حذفه من Git

### كيف أضيف بيانات تجريبية؟
**على Render**: استخدم نفس الإجراء - استورد Excel من الواجهة

**محلياً**: 
```bash
cd server
NODE_ENV=development npx tsx scripts/seed-demo.ts
```

### كيف أرى قاعدة البيانات؟
استخدم أي أداة SQL:
- **pgAdmin** (مجاني)
- **DBeaver** (مجاني)
- **VS Code**: PostgreSQL extension

### الأمان?
- غيّر `JWT_SECRET` في Render إلى مفتاح عشوائي قوي
- أضف كلمة مرور قوية للـ admin
- استخدم HTTPS (Render يفعل هذا تلقائياً)

---

## الفرق بين SQLite و PostgreSQL

| الميزة | SQLite | PostgreSQL |
|--------|--------|-----------|
| **التخزين** | ملف محلي | سيرفر منفصل |
| **الاستمرارية** | ❌ (يُحذف على Render) | ✅ دائم |
| **الـ Concurrency** | ❌ ضعيف | ✅ قوي جداً |
| **القدرات** | بسيط | احترافي (triggers, views, etc) |
| **التكلفة** | مجاني | مجاني (limited) على Render |

---

## إذا حدثت مشاكل 🔧

### الخطأ: `DATABASE_URL is required`
→ تأكد أن `DATABASE_URL` موجود في Render Environment

### الخطأ: `Connection refused`
→ قد يكون PostgreSQL في Render لم ينته من الإنشاء (انتظر 5 دقائق)

### الخطأ: `UNIQUE constraint failed`
→ تأكد من عدم محاولة إضافة نفس رقم الناخب مرتين

### البيانات لم تظهر بعد الـ restart
→ ربما لم تُحفظ بشكل صحيح - تحقق من console logs في Render

---

## اختبار سريع ✔️

```bash
# محلياً على PostgreSQL:
cd server
npm run build
NODE_ENV=production DATABASE_URL="postgresql://..." npm start
```

أو على Render:
- Deploy من Git
- انتظر 3-5 دقائق
- اختبر من الرابط المُعطى

---

**الآن:** البيانات لن تُحذف أكثر! 🎉
