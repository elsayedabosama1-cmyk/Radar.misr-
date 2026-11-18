const {chromium}=require('playwright');const fs=require('fs');
const mark=fs.readFileSync('mark.svg','utf8');const b64=Buffer.from(mark).toString('base64');
const FONT="'Noto Sans Arabic','Noto Naskh Arabic','DejaVu Sans',sans-serif";
const pages={
 'logo.jpg':[512,512,`<img src="data:image/svg+xml;base64,${b64}" width=512 height=512>`],
 'icon-512.png':[512,512,`<img src="data:image/svg+xml;base64,${b64}" width=512 height=512>`],
 'icon-192.png':[192,192,`<img src="data:image/svg+xml;base64,${b64}" width=192 height=192>`],
 'profile.png':[1080,1080,`<img src="data:image/svg+xml;base64,${b64}" width=1080 height=1080>`],
 'cover-facebook.png':[1640,924,`<div style="width:1640px;height:924px;background:#111E31;position:relative;display:flex;align-items:center;justify-content:center;gap:70px;font-family:${FONT};direction:rtl"><div style="position:absolute;inset:0;background:radial-gradient(circle at 20% 50%,#1d3150,#111E31 60%)"></div><img style="position:relative;border-radius:50%;border:8px solid #C9A968" src="data:image/svg+xml;base64,${b64}" width=380 height=380><div style="position:relative;color:#F4F1E9"><div style="font-size:190px;font-weight:800;line-height:1.1;color:#C9A968">مِرصد</div><div style="font-family:Inter,Arial,sans-serif;letter-spacing:12px;font-size:44px;color:#F4F1E9;direction:ltr;text-align:right">MIRṢAD</div><div style="font-size:54px;margin-top:30px">نرصد المشهد.. ونصنع التأثير</div></div></div>`],
 'logo-primary.png':[1400,460,`<div style="width:1400px;height:460px;background:#F4F1E9;display:flex;align-items:center;justify-content:center;gap:50px;font-family:${FONT};direction:rtl"><img style="border-radius:50%" src="data:image/svg+xml;base64,${b64}" width=300 height=300><div><div style="font-size:170px;font-weight:800;line-height:1.1;color:#111E31">مِرصد</div><div style="font-family:Inter,Arial,sans-serif;letter-spacing:14px;font-size:44px;color:#168C91;direction:ltr;text-align:right">MIRṢAD</div></div></div>`]
};
(async()=>{const b=await chromium.launch();for(const [f,[w,h,html]] of Object.entries(pages)){const p=await b.newPage({viewport:{width:w,height:h}});await p.setContent(`<body style="margin:0">${html}</body>`);await p.waitForTimeout(300);
 await p.screenshot({path:f.endsWith('.jpg')?'tmp.jpg':f,type:f.endsWith('.jpg')?'jpeg':'png',quality:92});if(f.endsWith('.jpg'))fs.renameSync('tmp.jpg','../logo.jpg');else if(f.startsWith('icon-'))fs.renameSync(f,'../'+f);await p.close()}await b.close()})()
