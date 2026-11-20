# وسيط مِرصد (Cloudflare Worker)

بيخلّي الدخول بإيميل وباسورد وأدوار حقيقية، وبيكتب في GitHub بدل ما التطبيق يشيل أي مفتاح.

## الإعداد (مرة واحدة، مجاني ومن غير كارت)
1. اعمل حساب على cloudflare.com.
2. Workers & Pages ← Create ← Create Worker ← سمّيه `mirsad-api` ← Deploy.
3. Edit code ← امسح كل اللي فيه والصق محتوى `worker.js` ← Deploy.
4. Storage & Databases ← KV ← Create ← اسمه `mirsad-users`.
5. رجوع للـ Worker ← Settings ← Bindings ← Add ← KV namespace: اسم المتغير `USERS` والمخزن `mirsad-users` ← Deploy.
6. Settings ← Variables and Secrets ← Add (نوع Secret):
   - `GITHUB_TOKEN`: مفتاح GitHub (Contents: Read and write، و Actions: Read and write) على المستودع.
   - `JWT_SECRET`: أي كلام عشوائي طويل (40 حرف أو أكتر).
   - `BOOTSTRAP_KEY`: كلمة سر مؤقتة ليك لإنشاء أول حساب.
   - (بعد تغيير اسم المستودع) متغير عادي `REPO` = `elsayedabosama1-cmyk/Mirsad`.
7. انسخ رابط الـ Worker (https://mirsad-api.xxxx.workers.dev).
8. في التطبيق: أيقونة الإدارة ← الصق الرابط ← حفظ ← "إنشاء حساب رئيس المجلس" ← ادخل بالإيميل.
9. من تبويب "المستخدمين" اعمل حسابات رئيس التحرير والمحررين.

## الأدوار
- رئيس مجلس الإدارة: كل حاجة + المستخدمين.
- رئيس التحرير: كل حاجة ما عدا المستخدمين (اعتماد، نشر، أرشفة، مصادر، علامات).
- محرر/صحفي ومراسل: إنشاء خبر وإرسال للمراجعة وتعديل أخبارهم قبل النشر ورفع الصور.
