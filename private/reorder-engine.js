/* Smart Reorder engine: used by /reorder and by Refill Order (Other view + proposed quantities). Served by api/site.js at /reorder-engine.js. */
/* The thinking part, with no page code in it (it is tested on its own).
   plan(data, opt) -> { A, N, lines, events, catIdx, growth, histMonths ... }
   data = /api/refill?smart=1 ; opt = { order:'YYYY-MM-DD', lead: months, cover: months, safeA: weeks, budget: $ } */
var ReorderEngine=(function(){
const DAY=864e5;
const d0=s=>{const a=String(s).split('-').map(Number);return new Date(Date.UTC(a[0],a[1]-1,a[2]||1))};
const iso=d=>d.toISOString().slice(0,10),mk=d=>d.toISOString().slice(0,7);
const addD=(d,n)=>new Date(+d+n*DAY);
function addM(d,n){const w=Math.trunc(n),fr=n-w,x=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+w,1)),last=new Date(Date.UTC(x.getUTCFullYear(),x.getUTCMonth()+1,0)).getUTCDate();x.setUTCDate(Math.min(d.getUTCDate(),last));return addD(x,Math.round(fr*30))}
const fmt0=n=>Math.round(n).toLocaleString('en-US');
const clip=(v,a,b)=>Math.max(a,Math.min(b,v));
const prevYear=k=>(+k.slice(0,4)-1)+k.slice(4);

/* ---- the calendar of selling seasons in Egypt ---- */
const HFALL={ram:['2026-02-18','2027-02-08','2028-01-28','2029-01-16','2030-01-05'],fitr:['2026-03-20','2027-03-10','2028-02-27','2029-02-14','2030-02-04'],adha:['2026-05-27','2027-05-16','2028-05-05','2029-04-24','2030-04-13']};
function hijriDates(y0,y1){
  const out={ram:[],fitr:[],adha:[]};
  try{const f=new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn',{day:'numeric',month:'numeric',timeZone:'UTC'});
    if(!/islamic/.test(f.resolvedOptions().calendar))throw 0;
    for(let d=new Date(Date.UTC(y0,0,1));d.getUTCFullYear()<=y1;d=addD(d,1)){const p=f.formatToParts(d),m=+p.find(x=>x.type==='month').value,dd=+p.find(x=>x.type==='day').value;
      if(m===9&&dd===1)out.ram.push(iso(d));else if(m===10&&dd===1)out.fitr.push(iso(d));else if(m===12&&dd===10)out.adha.push(iso(d))}
    if(!out.ram.length||!out.fitr.length)throw 0;return out}catch(e){const r={};for(const k in HFALL)r[k]=HFALL[k].filter(s=>+s.slice(0,4)>=y0&&+s.slice(0,4)<=y1);return r}
}
// lead = days before the day when shoppers start buying for it (the goods should be in the stores by then); tail = days it keeps selling after
function seasonEvents(y0,y1){
  const E=[],add=(id,name,date,lead,theme,o)=>E.push(Object.assign({id,name,date:d0(date),lead,theme:theme||'',tail:0},o||{}));
  for(let y=y0;y<=y1;y++){
    add('val',"Valentine's Day",y+'-02-14',35,'love');
    add('mom',"Mother's Day",y+'-03-21',35,'mum');
    add('grad','Graduation season',y+'-06-25',30,'grad');
    add('summer','Summer and Sahel season',y+'-08-01',45,'summer');
    add('hall','Halloween',y+'-10-31',30,'hall',{hard:1,minor:1,tail:1});
    add('egval','Egyptian Valentine (4 November)',y+'-11-04',21,'love');
    let f=new Date(Date.UTC(y,10,1));while(f.getUTCDay()!==5)f=addD(f,1);add('wf','White Friday',iso(addD(f,21)),14,'');
    add('xmas','Christmas and New Year',y+'-12-25',45,'xmas',{hard:1,tail:13});
  }
  const h=hijriDates(y0,y1);
  h.ram.forEach(s=>add('ram','Ramadan starts',s,21,'moon',{moon:1}));h.fitr.forEach(s=>add('fitr','Eid al-Fitr',s,25,'',{moon:1}));h.adha.forEach(s=>add('adha','Eid al-Adha',s,21,'',{moon:1}));
  return E.sort((a,b)=>a.date-b.date);
}
// item names that belong to a season. hard = sells almost only in its season (Christmas, Halloween)
const THEMES=[
  ['xmas','Christmas',/christmas|x-?mas|santa|snowman|snowflake|snow globe|\bsnow\b|reindeer|gingerbread|festive|candy cane|\bholly\b|mistletoe|nutcracker|wreath|sleigh|\belf\b|north pole|stocking|winter/i,1],
  ['hall','Halloween',/halloween|pumpkin|ghost|skull|witch|spider|\bboo\b/i,1],
  ['mum','Mother’s Day',/\bmum\b|\bmom\b|mother|mama|\bfamily\b|daughter|grandm|sister/i,0],
  ['love','Valentine',/valentine|heart|\blove\b|\bkiss|cupid|\broses?\b|romanc|forever|xoxo|couple/i,0],
  ['moon','Ramadan',/ramadan|\beid\b|crescent|\bmoon\b|lantern/i,0],
  ['grad','Graduation',/graduat|diploma|class of/i,0],
  ['summer','Summer',/summer|beach|ocean|\bsea\b|seashell|\bshell\b|\bpalm\b|tropical|starfish|turtle|dolphin|mermaid|flamingo|pineapple|seahorse|ice cream|watermelon|\bwave\b|\bsun\b/i,0]
];
const themeOf=name=>{for(const t of THEMES)if(t[2].test(name||''))return {id:t[0],label:t[1],hard:!!t[3]};return null};
const CATFIX=c=>{c=String(c||'').trim();if(/^charm$/i.test(c))return 'Charms';return c};
const catFromGroup=g=>{const l=String(g||'').toLowerCase();if(l.includes('earring'))return 'Earrings';if(l.includes(' ring')||/^rings?/.test(l))return 'Rings';if(l.includes('bracelet'))return 'Bracelets';if(l.includes('necklace')||l.includes('pendant'))return 'Necklaces & Pendants';if(['charm','clip','dangle','medallion','spacer'].some(x=>l.includes(x)))return 'Charms';return ''};

function plan(data,opt){
  const today=d0(data.today),curKey=data.today.slice(0,7);
  const all=data.months||[],H=all.filter(k=>k<curKey),hi={};all.forEach((k,i)=>hi[k]=i);   // H = full months we have sales for
  const known=new Set(H);
  const D=d0(opt.order||data.today),lead=clip(+opt.lead||2,.5,8),cover=clip(+opt.cover||2,.5,8);
  const A=addM(D,lead),N=addM(A,cover);          // A = arrives in the stores, N = the order after it arrives
  const from=A>today?today:A;                    // stock is counted today
  const EV=seasonEvents(today.getUTCFullYear()-1,N.getUTCFullYear()+2);

  /* items */
  const items=(data.items||[]).map(r=>{const cat=CATFIX(r[4])||catFromGroup(r[16])||'Other';
    const s={};H.forEach(k=>s[k]=r[14][hi[k]]||0);
    return {sku:r[0],avail:!!r[1],dv:r[2]||String(r[0]).split('-')[0],name:r[3]||'',cat,sub:r[5]||'',launch:r[6]||'',fob:+r[7]||0,rrp:+r[8]||0,soh:r[11]||0,pipe:r[12]||0,slow:!!r[13]||!!(r[18]&&r[18].length),slowIn:r[18]||[],s,bought:r[15]||[],wh:r[17]||[],theme:themeOf(r[3])}});

  /* how busy each calendar month is, per category (1 = a normal month), from the last 12 full months */
  const catS={};
  if(data.allCats)for(const c in data.allCats){const m=catS[CATFIX(c)]||(catS[CATFIX(c)]={});H.forEach(k=>m[k]=(m[k]||0)+(data.allCats[c][2][hi[k]]||0))}
  items.forEach(it=>{if(data.allCats&&catS[it.cat])return;const m=catS['~'+it.cat]||(catS['~'+it.cat]={});H.forEach(k=>m[k]=(m[k]||0)+it.s[k])});
  for(const c in catS)if(c[0]==='~'){if(!catS[c.slice(1)])catS[c.slice(1)]=catS[c];delete catS[c]}
  const last12=H.slice(-12),catIdx={};
  for(const c in catS){const v=last12.map(k=>catS[c][k]||0),mean=v.reduce((a,b)=>a+b,0)/(v.length||1),ix={};
    if(last12.length>=9&&mean>0)last12.forEach((k,i)=>{ix[+k.slice(5)]=clip(1+.8*(v[i]/mean-1),.6,2.2)});
    catIdx[c]=ix}
  const idx=(c,key)=>(catIdx[c]&&catIdx[c][+key.slice(5)])||1;
  // is the business bigger than a year ago? (last 3 full months against the same 3 a year before)
  let growth=1;{const r=H.slice(-3);if(r.length===3&&r.every(k=>known.has(prevYear(k)))){let a=0,b=0;for(const c in catS)r.forEach(k=>{a+=catS[c][k]||0;b+=catS[c][prevYear(k)]||0});if(b>0)growth=clip(a/b,.7,1.6)}}

  /* best sellers per category, by design (all sizes of a ring count together): A = the designs that make 70% of the category's pieces, B the next 20%, C the rest */
  const dvT={};items.forEach(it=>{const k=it.cat+'|'+it.dv;it.tot=last12.reduce((a,m)=>a+it.s[m],0);dvT[k]=(dvT[k]||0)+it.tot});
  const byCat={};for(const k in dvT){const c=k.split('|')[0];(byCat[c]||(byCat[c]=[])).push([k,dvT[k]])}
  const cls={},rank={};
  for(const c in byCat){const l=byCat[c].sort((a,b)=>b[1]-a[1]),tot=l.reduce((a,x)=>a+x[1],0);let cum=0;
    l.forEach((x,i)=>{rank[x[0]]=i+1;cls[x[0]]=!x[1]?'C':cum<tot*.7?'A':cum<tot*.9?'B':'C';cum+=x[1]})}

  const softOn=(th,key)=>{const ms=d0(key+'-01'),me=addM(ms,1);return EV.some(e=>e.theme===th&&Math.min(+me,+addD(e.date,1))-Math.max(+ms,+addD(e.date,-e.lead))>=10*DAY)};
  const dem=(it,a,b)=>{if(b<=a)return 0;let t=0;for(let m=new Date(Date.UTC(a.getUTCFullYear(),a.getUTCMonth(),1));m<b;m=addM(m,1)){const e=addM(m,1),ov=(Math.min(+e,+b)-Math.max(+m,+a))/(+e-+m);if(ov>0)t+=ov*it.f(mk(m))}return t};

  const lines=items.map(it=>{
    const k=it.cat+'|'+it.dv;it.cls=cls[k]||'C';it.rank=rank[k]||999;
    // months it was really on sale
    const fs=H.find(m=>it.s[m]>0||(it.bought[hi[m]]||0)>0)||'',lm=it.launch?it.launch.slice(0,7):'';const first=lm&&fs?(lm<fs?lm:fs):(fs||lm);
    const act=first?H.filter(m=>m>=first):[],rec=act.slice(-6);
    let n=0,dn=0;rec.forEach((m,i)=>{const w=i>=rec.length-3?2:1;n+=w*it.s[m];dn+=w*idx(it.cat,m)});
    it.base=dn?n/dn:0;it.months=act.length;it.avg3=act.slice(-3).reduce((a,m)=>a+it.s[m],0)/(Math.min(3,act.length)||1);
    const th=it.theme;
    // forecast for one calendar month
    it.f=key=>{let ly=prevYear(key);for(let i=0;i<2&&!known.has(ly);i++)ly=prevYear(ly);const hasLY=known.has(ly)&&!!first&&ly>=first; // the same month in the newest year we have
      if(th&&th.hard){if(hasLY)return it.s[ly]*growth;return it.base*idx(it.cat,key)*(softOn(th.id,key)?3:.3)}
      let v=it.base*idx(it.cat,key);
      if(th&&softOn(th.id,key)){v*=1.25;if(hasLY)v=(v+it.s[ly]*growth)/2}
      return v};
    const stock=Math.max(0,it.soh)+it.pipe,pre=dem(it,today,A),left=Math.max(0,stock-pre),lost=Math.max(0,pre-stock);
    const win=dem(it,A,N);
    const o={it,stock,pre,left,lost,win,safe:0,need:0,qty:0,tags:[],why:'',season:null};
    if(lost>=1&&A>today){const days=(A-today)/DAY;o.out=addD(today,Math.floor(days*stock/pre))}
    if(th&&th.hard){
      // the next season this order could still serve
      const e=EV.find(x=>x.theme===th.id&&x.date>=addD(D>today?D:today,-1));
      if(e){const S=addD(e.date,-e.lead),end=addD(e.date,e.tail);o.season=e;
        if(A>addD(e.date,-10)){o.verdict='late';o.tags.push(['bad','Too late for '+th.label+' '+e.date.getUTCFullYear()]);o.why='It would arrive '+(A>e.date?'after':'only days before')+' '+e.name+'. Skip it now; order it for next year.';o.win=0}
        else if(A>=addD(S,-45)||N>addD(S,14)){o.verdict=A>S?'mid':A>=addD(S,-45)?'good':'last';
          o.win=dem(it,A>S?A:S,end);o.need=o.win-o.left;
          o.tags.push([o.verdict==='mid'?'warn':'good',o.verdict==='good'?'Perfect timing for '+th.label:o.verdict==='mid'?'Arrives mid-season':'Last order in time for '+th.label]);
          o.why=o.verdict==='good'?(Math.round((S-A)/DAY)>=2?'Arrives '+Math.round((S-A)/DAY)+' days before':'Arrives just as')+' shoppers start buying for '+e.name+'.':o.verdict==='mid'?'The season will already be running when it arrives, so only the rest of the season is ordered.':'It arrives early, but the order after this one would be too late for '+e.name+'.'}
        else{o.verdict='wait';o.tags.push(['soft',th.label+': wait for the next order']);o.why='Too early. The order after this one still arrives before '+e.name+' shopping starts.';o.win=0}
      }
    }else{
      o.safe=it.cls==='A'?(+opt.safeA||0)/4.345*(win/cover):0;
      o.need=win+o.safe-left;
      if(th&&EV.some(e=>e.theme===th.id&&e.date>=addD(A,7)&&addD(e.date,-e.lead)<N)){const e=EV.find(e=>e.theme===th.id&&e.date>=addD(A,7)&&addD(e.date,-e.lead)<N);o.season=e;o.tags.push(['good','In season: '+e.name])}
    }
    let q=o.need>=(it.cls==='C'?1:.5)?Math.max(1,Math.round(o.need)):0;
    o.want=q;
    if(!it.avail){q=0;if(o.want)o.tags.push(['soft','Not available to order'])}
    else if(it.slow&&!(th&&th.hard&&o.verdict&&o.verdict!=='late'&&o.verdict!=='wait')&&!(it.cls==='A'&&it.avg3>=3)){if(q)o.tags.push(['soft','Slow moving'+(it.slowIn.length?' in '+it.slowIn.slice(0,2).join(', '):'')+': move stock first']);q=0}
    if(!it.months&&!it.soh){o.tags.push(['soft','No sales history yet'])}
    if(o.lost>=1&&it.cls!=='C')o.tags.push(['bad','Runs out '+(o.out?'about '+o.out.getUTCDate()+' '+['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][o.out.getUTCMonth()]:'before it arrives')]);
    // why a good seller is NOT in the order
    if(!q){const thr=it.cls==='C'?1:.5,sells=it.avg3>0||it.base>0,rate=win/cover;
      if(!it.avail){if(sells&&!o.want)o.skip='Not on the Available to Order list'}
      else if(!it.months)o.skip='No sales found for it in the months read from ERP';
      else if(o.need<thr&&sells&&!(th&&th.hard&&o.verdict))o.skip='Enough stock: '+Math.round(stock)+' pieces last about '+(rate>0?Math.round(stock/rate*10)/10+' months':'a long time')+' at '+Math.round(rate*10)/10+' a month, so nothing is needed yet';
      if(o.skip&&!o.tags.length)o.tags.push(['soft',o.skip.split(':')[0]])}
    o.qty=q;o.cost=q*it.fob;o.retail=q*it.rrp;
    o.pri=q?(it.cls==='A'?1:it.cls==='B'?2:3):9;
    return o});

  /* a budget bigger than the order the sales need: the rest buys more of the best sellers (A the most, then B, then C), so the order uses the budget */
  let fill=null;const bud=+opt.budget||0,base=lines.reduce((a,o)=>a+o.cost,0);
  if(bud>base*1.01){
    const W={A:1,B:.6,C:.3},el=lines.filter(o=>o.it.avail&&!(o.it.slow&&!o.qty)&&!(o.it.theme&&o.it.theme.hard)&&o.it.base>0&&o.it.fob>0);
    const qAt=(o,e)=>{const nd=o.need+dem(o.it,N,addM(N,e*W[o.it.cls]));return Math.max(o.qty,nd>=(o.it.cls==='C'?1:.5)?Math.max(1,Math.round(nd)):0)};
    const rest=base-el.reduce((a,o)=>a+o.cost,0),costAt=e=>rest+el.reduce((a,o)=>a+qAt(o,e)*o.it.fob,0);
    const CAP=12;let e=CAP,capped=true;
    if(costAt(CAP)>bud){capped=false;let lo=0,hi=CAP;for(let i=0;i<30;i++){const m=(lo+hi)/2;if(costAt(m)<=bud)lo=m;else hi=m}e=lo}
    el.forEach(o=>{const nq=qAt(o,e);o.extra=nq-o.qty;o.qty=nq});
    let spent=rest+el.reduce((a,o)=>a+o.qty*o.it.fob,0);
    if(!capped){ // a few pieces more of the best sellers until the budget is used up
      const ord=el.slice().sort((a,b)=>(a.it.cls>b.it.cls?1:a.it.cls<b.it.cls?-1:0)||a.it.rank-b.it.rank);
      for(let pass=0;pass<6;pass++){let any=false;for(const o of ord){if(o.it.cls==='C'&&!o.qty)continue;if(spent+o.it.fob<=bud){o.qty++;o.extra++;spent+=o.it.fob;any=true}}if(!any)break}}
    el.forEach(o=>{o.cost=o.qty*o.it.fob;o.retail=o.qty*o.it.rrp;if(o.extra>=1)o.tags.push(['soft','+'+fmt0(o.extra)+' for the budget'])});
    fill={e,capped,base,spent,budget:bud,pcs:el.reduce((a,o)=>a+Math.max(0,o.extra||0),0),n:el.filter(o=>o.extra>=1).length};
  }
  // order of importance: best sellers first, inside a class the ones losing sales first, then the bigger value
  lines.sort((a,b)=>a.pri-b.pri||(b.lost>=1)-(a.lost>=1)||b.qty*(b.it.rrp||1)-a.qty*(a.it.rrp||1)||a.it.rank-b.it.rank);
  const budget=+opt.budget||0;let cum=0;lines.forEach(o=>{if(!o.qty)return;cum+=o.cost;o.cum=cum;o.cut=budget>0&&cum>budget});

  /* the seasons against this order */
  const events=EV.filter(e=>!e.minor&&e.date>=today&&e.date<=addD(N,330)&&e.date<=addD(today,720)).map(e=>{const S=addD(e.date,-e.lead),orderBy=addM(S,-lead);
    let st;if(e.date<D)st='past';else if(e.date<addD(A,10))st='late';else if(e.date<addD(N,14))st=A<=S?'good':'mid';else st='next';
    return Object.assign({},e,{start:S,orderBy,st,days:Math.round((e.date-A)/DAY)})});
  // window index per category (how busy the selling window is against a normal month)
  const winIdx={};for(const c in catIdx){let t=0,w=0;for(let m=new Date(Date.UTC(A.getUTCFullYear(),A.getUTCMonth(),1));m<N;m=addM(m,1)){const e=addM(m,1),ov=(Math.min(+e,+N)-Math.max(+m,+A))/(+e-+m);if(ov>0){t+=ov*idx(c,mk(m));w+=ov}}winIdx[c]=w?t/w:1}
  const seasonKnown=last12.length>=9;
  return {today,D,A,N,fill,far:D>addD(today,45),lead,cover,lines,events,catIdx,winIdx,growth,H,last12,seasonKnown,budget,
    tot:{pcs:lines.reduce((a,o)=>a+o.qty,0),n:lines.filter(o=>o.qty).length,cost:lines.reduce((a,o)=>a+(o.cut?0:o.cost),0),costAll:cum,retail:lines.reduce((a,o)=>a+o.retail,0),
      risk:lines.filter(o=>o.lost>=1&&o.it.cls==='A').length,lostEGP:lines.reduce((a,o)=>a+(o.it.cls!=='C'?o.lost*o.it.rrp:0),0),cutN:lines.filter(o=>o.cut).length}};
}
return {plan,seasonEvents,themeOf,addM,iso,d0};
})();
if(typeof module!=='undefined')module.exports=ReorderEngine;
