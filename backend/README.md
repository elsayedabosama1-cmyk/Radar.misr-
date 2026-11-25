# مِرصد — Backend

هذا مجلد تأسيس الخادم الجديد. الواجهة الحالية لم تُربط به بعد، ولا توجد خدمة منشورة أو قاعدة بيانات متصلة حتى الآن.

## البنية
- Neon PostgreSQL: البيانات والعلاقات.
- Neon Managed Better Auth: تسجيل الدخول والجلسات وإصدار JWT.
- Cloudflare Workers: API والصلاحيات والتحقق من الجلسات.
- Neon Object Storage: تخزين الصور والوسائط ضمن حصة الخطة المجانية (سيضاف مسار الرفع بعد تجهيز bucket).

## إعداد محلي
1. ثبّت Node.js LTS.
2. من هذا المجلد نفّذ `npm install`.
3. جهّز متغيرات البيئة محليًا في `.dev.vars` ولا ترفع الملف إلى Git.
4. يلزم تجهيز Neon Auth وHyperdrive من لوحتي Neon وCloudflare قبل تشغيل API كاملًا.
5. نفّذ `npm run check` ثم `npm run dev`.

## قاعدة البيانات
راجع `db/migrations/0001_core.sql` ثم طبّقها مرة واحدة على مشروع Neon جديد من SQL Editor. أنشئ دور دخول منفصلًا لتطبيق Worker، ثم امنحه عضوية `mirsad_app`؛ لا تستخدم مالك المشروع كبيانات اتصال دائمة للتطبيق.

مثال إنشاء مستخدم تشغيل (نفّذه من جلسة مالك قاعدة البيانات، واستبدل كلمة المرور محليًا بكلمة قوية لا تُحفظ في Git):
```sql
create role mirsad_worker login password 'REPLACE_WITH_A_UNIQUE_PASSWORD';
grant mirsad_app to mirsad_worker;
```

## المصادقة
فعّل Neon Managed Better Auth من إعدادات المشروع. عيّن القيم الدقيقة التالية في إعدادات Worker بعد استخراجها من Neon Auth:
- `NEON_AUTH_ISSUER`: قيمة issuer الدقيقة التي تصدرها خدمة Auth.
- `NEON_AUTH_JWKS_URL`: رابط JWKS الرسمي للفرع.
- `NEON_AUTH_AUDIENCE`: قيمة audience المخصصة للـ API.

لا نخمن عنوان JWKS أو issuer أو audience ولا نستخدم قيمًا افتراضية. يجب ضبط Neon Auth لإصدار JWT بالـ audience المتفق عليها، ثم التحقق من التوقيع وissuer وaudience في Worker. الواجهة الأمامية ستستخدم Neon Auth SDK للحصول على JWT وترسله في `Authorization: Bearer ...`.

## إنشاء أول رئيس مجلس إدارة
1. أنشئ حساب المالك بنفسك من واجهة Neon Auth بعد تفعيلها.
2. سجّل دخولًا من واجهة اختبار موثوقة، ثم استدعِ `GET /api/v1/me` مرة واحدة؛ هذا ينشئ سجل الجمهور الأول تلقائيًا.
3. استخرج قيمة `sub` من JWT بعد التحقق منه، ولا تشارك الرمز نفسه مع أي شخص.
4. نفّذ إجراء التأسيس التالي مرة واحدة فقط من جلسة مالك قاعدة البيانات بعد استبدال القيمة بمعرّف `sub` الحقيقي:
```sql
begin;
do $$
begin
  if exists (select 1 from public.profiles where role='chairman') then
    raise exception 'Chairman already provisioned; refusing bootstrap';
  end if;
  update public.profiles
     set role='chairman', is_active=true, updated_at=now()
   where auth_user_id='REPLACE_WITH_VERIFIED_AUTH_SUB'
     and role='audience';
  if not found then
    raise exception 'No matching audience profile; bootstrap aborted';
  end if;
end $$;
commit;
```
5. تحقق من أن هناك حساب رئيس مجلس إدارة واحدًا فقط. لا يوجد endpoint عام يستطيع إنشاء هذا الدور.

بعد ذلك، يسجل رئيس التحرير والمحررون/الصحفيون حسابات الجمهور أولًا، ثم يعيّن رئيس المجلس أدوارهم من لوحة الإدارة بعد توصيل الواجهة.

## Cloudflare
- أنشئ Hyperdrive config يشير إلى دور `mirsad_worker` واتصال Neon، ثم استبدل `REPLACE_WITH_HYPERDRIVE_CONFIG_ID` في `wrangler.jsonc`.
- أضف `NEON_AUTH_ISSUER` و`NEON_AUTH_JWKS_URL` و`NEON_AUTH_AUDIENCE` كـ Worker variables.
- اضبط `ALLOWED_ORIGIN` على نطاق الموقع الفعلي.
- لا تضف كلمات المرور أو روابط قواعد البيانات أو مفاتيح Auth إلى Git أو إلى المتصفح أو المحادثة.
- إعداد Neon Object Storage وعمليات الرفع سيأتي في مرحلة منفصلة بعد تجهيز bucket وسياسة الملفات. استبعدنا Cloudflare R2 من المسار المجاني دون بطاقة؛ تفعيله قد يتطلب وسيلة دفع، لذلك لن نفعّله.

## API الحالية
| المسار | الغرض |
|---|---|
| `GET /health` | فحص اتصال قاعدة البيانات فعليًا |
| `GET /api/v1/me` | الحساب والدور بعد التحقق من JWT |
| `GET /api/v1/articles` | الأخبار المنشورة للعامة؛ وقوائم داخلية حسب الدور عند إرسال JWT |
| `POST /api/v1/articles` | إنشاء مسودة لفريق العمل |
| `PATCH /api/v1/articles/:id` | تعديل مسودة الكاتب أو تعديل رئيس المجلس |
| `POST /api/v1/articles/:id/submit` | إرسال الخبر للمراجعة |
| `POST /api/v1/articles/:id/decision` | قرارات غرفة التحرير |
| `POST /api/v1/sync` | مزامنة حتى 50 عملية حفظ مسودة، مع منع تكرار العملية |
| `GET /api/v1/profiles` | قائمة فريق العمل لرئيس التحرير ورئيس المجلس |
| `PATCH /api/v1/profiles/:id/role` | تغيير الدور — رئيس المجلس فقط |
| `PATCH /api/v1/profiles/:id/status` | تجميد/إعادة تفعيل وفق قواعد الأدوار |
| `GET /api/v1/audit` | سجل التدقيق — رئيس المجلس فقط |
| `GET /api/v1/sources` | قائمة مصادر الأخبار — القيادة التحريرية |
| `POST /api/v1/sources` | إضافة مصدر أخبار — القيادة التحريرية |

## حدود التنفيذ الحالية
- لا يوجد اتصال حي بـ Neon أو Cloudflare حتى الآن.
- لا توجد واجهة تسجيل دخول موصولة بعد.
- لا توجد واجهات إدارة المهام والتنبيهات والمصادر حتى الآن، رغم وجود جداولها في المخطط.
- لا توجد عمليات Neon Object Storage upload/download حتى الآن.
- يلزم اختبار JWT/JWKS الفعلي وتأكيد claims/issuer/audience من إعداد Neon، واختبارات تكامل قبل أي نشر.
- حساب الجمهور ينشأ كـ audience عند أول طلب موثق؛ لا يقبل API دورًا يرسله المستخدم.
- إنشاء أول رئيس مجلس إدارة إجراء يدوي محدود بمالك قاعدة البيانات، وليس من التسجيل العام.
- يقرأ الزائر الأخبار المنشورة فقط دون تسجيل دخول.

## سياسة التكلفة
استخدم الخطط المجانية فقط. لا تضف بطاقة دفع أو تفعّل خطة مدفوعة. راقب الحصص؛ وإذا وصلت خدمة إلى حدها المجاني، أوقف الوظيفة غير الحرجة بدل إنشاء تكلفة تلقائية.
