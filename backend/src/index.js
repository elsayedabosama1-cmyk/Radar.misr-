import { createRemoteJWKSet, jwtVerify } from "jose";
import { Client } from "pg";

const ROLE = Object.freeze({ CHAIRMAN: "chairman", EDITOR: "editor_in_chief", REPORTER: "reporter", AUDIENCE: "audience" });
const STATUS = Object.freeze({ DRAFT:"draft", SUBMITTED:"submitted_for_review", REVIEW:"in_review", CHANGES:"changes_requested", APPROVED:"approved", SCHEDULED:"scheduled", PUBLISHED:"published", REJECTED:"rejected", ARCHIVED:"archived" });
let jwksCache;

function json(data, status=200, origin="") {
  return new Response(JSON.stringify(data), { status, headers: {
    "content-type":"application/json; charset=utf-8", "cache-control":"no-store",
    "x-content-type-options":"nosniff", "referrer-policy":"no-referrer",
    ...(origin ? { "access-control-allow-origin":origin, "vary":"Origin", "access-control-allow-headers":"Authorization, Content-Type", "access-control-allow-methods":"GET, POST, PATCH, OPTIONS" } : {})
  }});
}
function fail(message,status=400){ const e=new Error(message); e.status=status; return e; }
function safeText(v,max=5000){ return typeof v==="string" ? v.trim().slice(0,max) : ""; }
function isUuid(v){ return typeof v==="string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v); }
async function bodyJson(request){
  const declared=Number(request.headers.get("content-length")||0);
  if(declared>250000) throw fail("حجم الطلب أكبر من المسموح",413);
  const raw=await request.text();
  if(raw.length>250000) throw fail("حجم الطلب أكبر من المسموح",413);
  try { return JSON.parse(raw); } catch { throw fail("صيغة البيانات غير صحيحة",400); }
}
async function db(env,fn){
  if(!env.HYPERDRIVE?.connectionString) throw fail("قاعدة البيانات غير موصلة بعد",503);
  const client=new Client({connectionString:env.HYPERDRIVE.connectionString});
  try { await client.connect(); return await fn(client); }
  catch(e){ if(e.status) throw e; console.error("Database operation failed",e.message); throw fail("تعذر تنفيذ عملية قاعدة البيانات",503); }
  finally { await client.end().catch(()=>{}); }
}
async function tx(env,fn){
  return db(env,async c=>{
    await c.query("begin");
    try { const result=await fn(c); await c.query("commit"); return result; }
    catch(e){ await c.query("rollback").catch(()=>{}); throw e; }
  });
}
async function identity(request,env){
  const auth=request.headers.get("authorization")||"";
  const token=auth.startsWith("Bearer ")?auth.slice(7):"";
  if(!token) throw fail("يلزم تسجيل الدخول",401);
  if(!env.NEON_AUTH_JWKS_URL||!env.NEON_AUTH_ISSUER||!env.NEON_AUTH_AUDIENCE) throw fail("إعداد المصادقة لم يكتمل",503);
  let payload;
  try {
    if(!jwksCache) jwksCache=createRemoteJWKSet(new URL(env.NEON_AUTH_JWKS_URL));
    const verified=await jwtVerify(token,jwksCache,{issuer:env.NEON_AUTH_ISSUER,audience:env.NEON_AUTH_AUDIENCE,clockTolerance:5});
    payload=verified.payload;
    if(typeof payload.sub!=="string"||!payload.sub) throw fail("رمز الدخول غير صالح",401);
  } catch(e) { if(e.status) throw e; throw fail("تعذر التحقق من جلسة الدخول",401); }
  return db(env,async c=>{
    await c.query("insert into public.profiles(auth_user_id,email,display_name,role) values($1,$2,$3,'audience') on conflict(auth_user_id) do nothing",
      [payload.sub,safeText(payload.email,320),safeText(payload.name||payload.email,120)]);
    const q=await c.query("select id,auth_user_id,email,display_name,avatar_url,role,is_active,suspended_until,suspension_reason from public.profiles where auth_user_id=$1",[payload.sub]);
    const p=q.rows[0];
    if(!p) throw fail("الحساب غير موجود",403);
    if(!p.is_active||(p.suspended_until&&new Date(p.suspended_until)>new Date())) throw fail("الحساب موقوف مؤقتًا أو غير نشط",403);
    return p;
  });
}
function requireStaff(p){ if(![ROLE.CHAIRMAN,ROLE.EDITOR,ROLE.REPORTER].includes(p.role)) throw fail("هذه الصفحة لفريق العمل فقط",403); }
function requireLead(p){ if(![ROLE.CHAIRMAN,ROLE.EDITOR].includes(p.role)) throw fail("الصلاحية غير متاحة",403); }
async function audit(c,actor,action,type,id,beforeData,afterData){
  await c.query("insert into public.audit_logs(actor_id,action,entity_type,entity_id,before_data,after_data) values($1,$2,$3,$4,$5::jsonb,$6::jsonb)",
    [actor,action,type,String(id),beforeData?JSON.stringify(beforeData):null,afterData?JSON.stringify(afterData):null]);
}
async function articleDecision(c,p,id,b){
  if(!isUuid(id)) throw fail("معرّف الخبر غير صحيح");
  const decision=safeText(b.decision,30), note=safeText(b.note,3000);
  const q=await c.query("select * from public.articles where id=$1 for update",[id]);
  const a=q.rows[0]; if(!a) throw fail("الخبر غير موجود",404);
  if(p.role!==ROLE.CHAIRMAN) requireLead(p);
  let next=a.status;
  if(decision==="start_review" && a.status===STATUS.SUBMITTED) next=STATUS.REVIEW;
  else if(decision==="approve" && [STATUS.SUBMITTED,STATUS.REVIEW].includes(a.status)) next=STATUS.APPROVED;
  else if(decision==="request_changes" && [STATUS.SUBMITTED,STATUS.REVIEW].includes(a.status)) next=STATUS.CHANGES;
  else if(decision==="reject" && [STATUS.SUBMITTED,STATUS.REVIEW,STATUS.CHANGES].includes(a.status)) next=STATUS.REJECTED;
  else if(decision==="schedule" && [STATUS.APPROVED,STATUS.SCHEDULED].includes(a.status) && b.scheduled_at && Number.isFinite(Date.parse(b.scheduled_at)) && Date.parse(b.scheduled_at)>Date.now()) next=STATUS.SCHEDULED;
  else if(decision==="publish" && [STATUS.APPROVED,STATUS.SCHEDULED].includes(a.status)) next=STATUS.PUBLISHED;
  else if(decision==="archive" && [STATUS.PUBLISHED,STATUS.REJECTED].includes(a.status)) next=STATUS.ARCHIVED;
  else if(decision==="restore" && a.status===STATUS.ARCHIVED && p.role===ROLE.CHAIRMAN) next=STATUS.DRAFT;
  else throw fail("القرار غير مسموح في حالة الخبر الحالية",409);
  if(p.role===ROLE.EDITOR && a.author_id===p.id && ["approve","publish","reject"].includes(decision)) throw fail("لا يجوز اعتماد المحرر لخبره بنفسه",403);
  const publishedAt=next===STATUS.PUBLISHED?(a.published_at||new Date().toISOString()):a.published_at;
  const scheduledAt=next===STATUS.SCHEDULED?new Date(b.scheduled_at).toISOString():null;
  const upd=await c.query("update public.articles set status=$2,editor_note=$3,scheduled_at=$4,published_at=$5,version=version+1,updated_at=now() where id=$1 returning *",
    [id,next,note||null,scheduledAt,publishedAt]);
  await c.query("insert into public.article_reviews(article_id,reviewer_id,decision,note) values($1,$2,$3,$4)",[id,p.id,decision,note||null]);
  await audit(c,p.id,"editorial_"+decision,"article",id,a,upd.rows[0]);
  return upd.rows[0];
}

export default { async fetch(request,env) {
  const origin=request.headers.get("origin")||"", allowed=env.ALLOWED_ORIGIN||"";
  if(origin && origin!==allowed) return json({error:"Origin not allowed"},403);
  if(request.method==="OPTIONS") return new Response(null,{status:204,headers:{
    "access-control-allow-origin":allowed,"access-control-allow-methods":"GET, POST, PATCH, OPTIONS",
    "access-control-allow-headers":"Authorization, Content-Type","access-control-max-age":"600","vary":"Origin"
  }});
  const url=new URL(request.url), path=url.pathname;
  try {
    if(path==="/health"&&request.method==="GET") return json({ok:true,service:"mirsad-api",database:"not_checked"},200,origin);
    if(path==="/api/v1/articles"&&request.method==="GET"){
      const bearer=(request.headers.get("authorization")||"").startsWith("Bearer ");
      const p=bearer?await identity(request,env):null;
      const staff=p&&[ROLE.CHAIRMAN,ROLE.EDITOR,ROLE.REPORTER].includes(p.role);
      return await db(env,async c=>{
        const q=staff&&p.role!==ROLE.REPORTER
          ? await c.query("select a.id,a.title,a.summary,a.section,a.governorate,a.status,a.author_id,a.assigned_to,a.created_at,a.updated_at,a.published_at,p.display_name as author_name from public.articles a join public.profiles p on p.id=a.author_id order by a.updated_at desc limit 100")
          : staff ? await c.query("select a.id,a.title,a.summary,a.section,a.governorate,a.status,a.author_id,a.created_at,a.updated_at from public.articles a where a.author_id=$1 order by a.updated_at desc limit 100",[p.id])
          : await c.query("select id,title,summary,section,governorate,published_at,created_at from public.articles where status='published' and published_at<=now() order by published_at desc limit 50");
        return json({items:q.rows},200,origin);
      });
    }
    if(path==="/api/v1/me"&&request.method==="GET"){
      const p=await identity(request,env);
      return json({profile:{id:p.id,email:p.email,display_name:p.display_name,avatar_url:p.avatar_url,role:p.role}},200,origin);
    }
    if(path==="/api/v1/articles"&&request.method==="POST"){
      const p=await identity(request,env); requireStaff(p); const b=await bodyJson(request);
      const title=safeText(b.title,300), body=safeText(b.body,200000);
      if(title.length<3) throw fail("عنوان الخبر مطلوب (3 أحرف على الأقل)");
      return await tx(env,async c=>{
        const q=await c.query("insert into public.articles(author_id,title,body,summary,section,governorate,source_name,source_url,image_url,status) values($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft') returning *",
          [p.id,title,body,safeText(b.summary,1000)||null,safeText(b.section,100)||null,safeText(b.governorate,100)||null,safeText(b.source_name,200)||null,safeText(b.source_url,2000)||null,safeText(b.image_url,2000)||null]);
        await audit(c,p.id,"article_created","article",q.rows[0].id,null,q.rows[0]);
        return json({article:q.rows[0]},201,origin);
      });
    }
    const editMatch=path.match(/^\/api\/v1\/articles\/([0-9a-f-]+)$/i);
    if(editMatch&&request.method==="PATCH"){
      const p=await identity(request,env); requireStaff(p); const b=await bodyJson(request), id=editMatch[1];
      return await tx(env,async c=>{
        const q=await c.query("select * from public.articles where id=$1 for update",[id]), a=q.rows[0];
        if(!a) throw fail("الخبر غير موجود",404);
        if(p.role!==ROLE.CHAIRMAN&&(a.author_id!==p.id||![STATUS.DRAFT,STATUS.CHANGES].includes(a.status))) throw fail("لا يمكنك تعديل هذا الخبر في حالته الحالية",403);
        const u=await c.query("update public.articles set title=$2,body=$3,summary=$4,section=$5,governorate=$6,source_name=$7,source_url=$8,image_url=$9,version=version+1,updated_at=now() where id=$1 returning *",
          [id,safeText(b.title??a.title,300),safeText(b.body??a.body,200000),safeText(b.summary??a.summary,1000)||null,safeText(b.section??a.section,100)||null,safeText(b.governorate??a.governorate,100)||null,safeText(b.source_name??a.source_name,200)||null,safeText(b.source_url??a.source_url,2000)||null,safeText(b.image_url??a.image_url,2000)||null]);
        await audit(c,p.id,"article_updated","article",id,a,u.rows[0]);
        return json({article:u.rows[0]},200,origin);
      });
    }
    const submitMatch=path.match(/^\/api\/v1\/articles\/([0-9a-f-]+)\/submit$/i);
    if(submitMatch&&request.method==="POST"){
      const p=await identity(request,env); requireStaff(p);
      return await tx(env,async c=>{
        const q=await c.query("select * from public.articles where id=$1 for update",[submitMatch[1]]), a=q.rows[0];
        if(!a) throw fail("الخبر غير موجود",404);
        if(p.role!==ROLE.CHAIRMAN&&a.author_id!==p.id) throw fail("لا يمكنك إرسال خبر ليس من إعدادك",403);
        if(![STATUS.DRAFT,STATUS.CHANGES].includes(a.status)) throw fail("الخبر ليس في حالة تسمح بإرساله",409);
        const u=await c.query("update public.articles set status='submitted_for_review',version=version+1,updated_at=now() where id=$1 returning *",[a.id]);
        await audit(c,p.id,"article_submitted","article",a.id,a,u.rows[0]);
        return json({article:u.rows[0]},200,origin);
      });
    }
    const decisionMatch=path.match(/^\/api\/v1\/articles\/([0-9a-f-]+)\/decision$/i);
    if(decisionMatch&&request.method==="POST"){
      const p=await identity(request,env); requireLead(p); const b=await bodyJson(request);
      return await tx(env,async c=>json({article:await articleDecision(c,p,decisionMatch[1],b)},200,origin));
    }
    if(path==="/api/v1/profiles"&&request.method==="GET"){
      const p=await identity(request,env); requireLead(p);
      return await db(env,async c=>{
        const q=await c.query("select id,email,display_name,avatar_url,role,is_active,suspended_until,suspension_reason,created_at from public.profiles order by created_at desc limit 300");
        return json({items:q.rows},200,origin);
      });
    }
    if(path==="/api/v1/audit"&&request.method==="GET"){
      const p=await identity(request,env);
      if(p.role!==ROLE.CHAIRMAN) throw fail("سجل التدقيق متاح لرئيس مجلس الإدارة فقط",403);
      return await db(env,async c=>{
        const q=await c.query("select id,actor_id,action,entity_type,entity_id,before_data,after_data,created_at from public.audit_logs order by created_at desc limit 100");
        return json({items:q.rows},200,origin);
      });
    }
    const roleMatch=path.match(/^\/api\/v1\/profiles\/([0-9a-f-]+)\/role$/i);
    if(roleMatch&&request.method==="PATCH"){
      const p=await identity(request,env);
      if(p.role!==ROLE.CHAIRMAN) throw fail("رئيس مجلس الإدارة فقط يغيّر الأدوار",403);
      const b=await bodyJson(request), role=safeText(b.role,30);
      if(![ROLE.EDITOR,ROLE.REPORTER,ROLE.AUDIENCE].includes(role)) throw fail("تعيين رئيس المجلس يتم بإجراء تأسيسي منفصل");
      return await tx(env,async c=>{
        const q=await c.query("select * from public.profiles where id=$1 for update",[roleMatch[1]]), old=q.rows[0];
        if(!old) throw fail("الحساب غير موجود",404);
        if(old.id===p.id) throw fail("لا يمكن تغيير دور حسابك من هذه الواجهة",409);
        if(old.role===ROLE.CHAIRMAN) throw fail("لا يمكن تغيير دور رئيس مجلس الإدارة من هذه الواجهة",403);
        const u=await c.query("update public.profiles set role=$2,updated_at=now() where id=$1 returning *",[old.id,role]);
        await audit(c,p.id,"profile_role_changed","profile",old.id,old,u.rows[0]);
        return json({profile:{id:u.rows[0].id,role:u.rows[0].role}},200,origin);
      });
    }
    const statusMatch=path.match(/^\/api\/v1\/profiles\/([0-9a-f-]+)\/status$/i);
    if(statusMatch&&request.method==="PATCH"){
      const p=await identity(request,env), b=await bodyJson(request);
      return await tx(env,async c=>{
        const q=await c.query("select * from public.profiles where id=$1 for update",[statusMatch[1]]), old=q.rows[0];
        if(!old) throw fail("الحساب غير موجود",404);
        if(old.id===p.id) throw fail("لا يمكن تجميد حسابك بنفسك",409);
        if(p.role===ROLE.EDITOR&&old.role!==ROLE.REPORTER) throw fail("رئيس التحرير يستطيع تجميد المحررين والصحفيين فقط",403);
        if(p.role!==ROLE.CHAIRMAN&&p.role!==ROLE.EDITOR) throw fail("الصلاحية غير متاحة",403);
        if(old.role===ROLE.CHAIRMAN) throw fail("لا يمكن تجميد رئيس مجلس الإدارة",403);
        const active=b.active===true, until=b.suspended_until&&Number.isFinite(Date.parse(b.suspended_until))?new Date(b.suspended_until).toISOString():null;
        const reason=safeText(b.reason,500)||null;
        if(!active&&!until&&!reason) throw fail("حدد سبب الإيقاف أو مدته");
        const u=await c.query("update public.profiles set is_active=$2,suspended_until=$3,suspension_reason=$4,updated_at=now() where id=$1 returning *",[old.id,active,active?null:until,active?null:reason]);
        await audit(c,p.id,active?"profile_reactivated":"profile_suspended","profile",old.id,old,u.rows[0]);
        return json({profile:{id:u.rows[0].id,is_active:u.rows[0].is_active,suspended_until:u.rows[0].suspended_until}},200,origin);
      });
    }
    return json({error:"المسار غير موجود"},404,origin);
  } catch(e) {
    const status=e.status||500;
    if(status===500) console.error("Mirsad API error",e.message);
    return json({error:status===500?"حدث خطأ داخلي":e.message},status,origin);
  }
}};
