// Readers for the three kinds of documents. Used by the All Uploads page and the Pandora Dashboards page.
// Everything is read in the browser; only the cleaned data is sent to the server.
window.PandoraParse=(function(){
const normalizeRows=rows=>rows.map(r=>{const date=r.date;return {...r,date,net:Number(r.net)||0,gross:Number(r.gross)||0,qty:Number(r.qty)||0}}).filter(r=>r.date&&r.invoice);
function parseCSV(text){const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(x=>x.trim());const rows=lines.map(line=>{let a=[],v='',q=false;for(let i=0;i<line.length;i++){let c=line[i];if(c==='"'&&line[i+1]==='"'&&q){v+='"';i++}else if(c==='"')q=!q;else if(c===','&&!q){a.push(v);v=''}else v+=c}a.push(v);return a});return parseGrid(rows)}
function parseGrid(grid){const headers=grid[0].map(x=>String(x||'').trim().toLowerCase());const find=(...names)=>headers.findIndex(h=>names.includes(h));const ix={invoice:find('invoice'),date:find('posting date'),group:find('item group'),qty:find('stock qty'),net:find('amount'),gross:find('total'),sku:find('sku'),item:find('item name'),desc:find('description'),payment:find('mode of payment'),cost:find('cost center')};if(ix.invoice<0||ix.date<0||ix.net<0||ix.gross<0)throw new Error('Required columns are missing (Invoice, Posting Date, Amount, Total).');const out=[];for(const row of grid.slice(1)){const invoice=row[ix.invoice];if(!invoice||String(invoice).toLowerCase()==='total')continue;let date=parseDate(row[ix.date]);if(!date)continue;const group=String(row[ix.group]||''),low=group.toLowerCase();if(low.includes('packaging'))continue;let category;if(low.includes('maintenance')||low.includes('services'))category='Services';else if(low.includes('jewellery box')||low.includes('utility'))category='Accessories';else if(low.includes('earring'))category='Earrings';else if(low.includes(' ring'))category='Rings';else if(low.includes('bracelet'))category='Bracelets';else if(low.includes('necklace'))category='Necklaces';else if(['charm','clip','dangle','medallion','spacer'].some(x=>low.includes(x)))category='Charms';else category='Other';let net=number(row[ix.net]),gross=number(row[ix.gross]);if(Math.round(net*100)===0&&Math.round(gross*100)===0)continue;let cc=String(row[ix.cost]||'Unspecified');let branch=cc.includes(' - ')?cc.split(' - ').slice(1).join(' - '):cc;branch=branch.replace(/ - AN/g,'').replace(/Pandora /g,'').replace(/ Of /g,' of ').trim()||'Unspecified';let pay=String(row[ix.payment]||'').trim(),pl=pay.toLowerCase(),payment=pl.includes('cash')&&pl.includes('visa')?'Cash + Visa':pl.includes('visa')?'Visa':pl.includes('cash')?'Cash':pay||'Unspecified';let name=String(row[ix.desc]||'').replace(/[|]/g,' ').replace(/---/g,' ').trim()||String(row[ix.item]||'');name=name.replace(/-one size$/i,'').replace(/-\d+\s*cm$/i,'').replace(/-\d{2}$/,'');out.push({date,invoice:String(invoice),qty:category==='Services'?0:number(row[ix.qty]),net,gross,sku:String(row[ix.sku]||''),name,branch,category,payment})}return out}
function number(v){if(typeof v==='number')return v;return Number(String(v||'').replace(/[, EGP$]/g,''))||0}
function parseDate(v){if(typeof v==='number'){const d=new Date(Date.UTC(1899,11,30)+v*86400000);return d.toISOString().slice(0,10)}let s=String(v||'').trim();if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.slice(0,10);const d=new Date(s);return isNaN(d)?'':d.toISOString().slice(0,10)}
// Minimal XLSX reader: reads the first worksheet using browser-native ZIP decompression.
async function parseXLSX(buffer){const files=await unzip(buffer);const read=async name=>files.has(name)?await files.get(name):null;const wbText=await read('xl/workbook.xml');if(!wbText)throw new Error('This does not look like an XLSX workbook.');const wbXml=new DOMParser().parseFromString(wbText,'application/xml');const sheet=wbXml.getElementsByTagNameNS('*','sheet')[0];if(!sheet)throw new Error('No worksheet found.');const relsText=await read('xl/_rels/workbook.xml.rels');const rels=new DOMParser().parseFromString(relsText,'application/xml');const rid=sheet.getAttribute('r:id');let target='worksheets/sheet1.xml';for(const rel of rels.getElementsByTagNameNS('*','Relationship'))if(rel.getAttribute('Id')===rid)target=rel.getAttribute('Target').replace(/^\//,'').replace(/^xl\//,'');const sheetPath=target.startsWith('xl/')?target:'xl/'+target;const sheetText=await read(sheetPath);if(!sheetText)throw new Error('Worksheet XML not found.');let shared=[];const st=await read('xl/sharedStrings.xml');if(st){const sx=new DOMParser().parseFromString(st,'application/xml');shared=Array.from(sx.getElementsByTagNameNS('*','si')).map(si=>Array.from(si.getElementsByTagNameNS('*','t')).map(t=>t.textContent).join(''))}const xml=new DOMParser().parseFromString(sheetText,'application/xml');const grid=[];for(const row of xml.getElementsByTagNameNS('*','row')){const arr=[];for(const cell of row.getElementsByTagNameNS('*','c')){const ref=cell.getAttribute('r'),col=ref.replace(/\d/g,'');let idx=0;for(const ch of col)idx=idx*26+ch.charCodeAt(0)-64;idx--;const v=cell.getElementsByTagNameNS('*','v')[0];let val=v?v.textContent:'';if(cell.getAttribute('t')==='s')val=shared[+val]||'';else if(cell.getAttribute('t')==='inlineStr')val=Array.from(cell.getElementsByTagNameNS('*','t')).map(t=>t.textContent).join('');else if(val!==''&&cell.getAttribute('t')!=='str')val=Number(val);arr[idx]=val}grid.push(arr.map(v=>v??''))}return parseGrid(grid)}
async function unzip(buffer){const bytes=new Uint8Array(buffer),view=new DataView(buffer),files=new Map();let eocd=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65558);i--){if(view.getUint32(i,true)===0x06054b50){eocd=i;break}}if(eocd<0)throw new Error('Could not read ZIP container.');const count=view.getUint16(eocd+10,true),central=view.getUint32(eocd+16,true);let p=central;const decoder=new TextDecoder();for(let i=0;i<count;i++){if(view.getUint32(p,true)!==0x02014b50)throw new Error('Invalid ZIP directory.');const method=view.getUint16(p+10,true),csize=view.getUint32(p+20,true),nlen=view.getUint16(p+28,true),elen=view.getUint16(p+30,true),clen=view.getUint16(p+32,true),off=view.getUint32(p+42,true),name=decoder.decode(bytes.slice(p+46,p+46+nlen));p+=46+nlen+elen+clen;const lnl=view.getUint16(off+26,true),lel=view.getUint16(off+28,true),start=off+30+lnl+lel,compressed=bytes.slice(start,start+csize);files.set(name,(async()=>{if(method===0)return decoder.decode(compressed);if(method!==8)throw new Error('Unsupported compression in XLSX file.');const ds=new DecompressionStream('deflate-raw');const stream=new Blob([compressed]).stream().pipeThrough(ds);return await new Response(stream).text()})())}return files}
async function dash(file){
  const rows=file.name.toLowerCase().endsWith('.csv')?parseCSV(await file.text()):await parseXLSX(await file.arrayBuffer());
  if(!rows.length)throw new Error('No valid sales lines were found. Use the original .xlsx system export with the standard columns.');
  return normalizeRows(rows);
}
const fmtPeriod=(a,b)=>{if(!a||!b)return'';const o={day:'numeric',month:'short'};return `${a.toLocaleDateString('en-GB',o)} – ${b.toLocaleDateString('en-GB',{...o,year:'numeric'})}`};
const sDate=v=>{if(v instanceof Date)return v;const d=new Date(v);return isNaN(d)?null:d};
async function staff(file){
    const buf=await file.arrayBuffer();
    const wb=XLSX.read(buf,{type:'array',cellDates:true});
    const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:null});
    const need=['Sales Invoice','Item Group','Sales Person','Contribution Qty','Contribution Amount','Parent Sales Person'];
    const miss=need.filter(c=>!rows.length||!(c in rows[0]));
    if(miss.length) throw new Error('This file is missing the column'+(miss.length>1?'s':'')+': '+miss.join(', ')+'. Use the Query Report export.');
    const stores=[],people=[],groups=[],invs=[],items=[],sI=new Map(),pI=new Map(),gI=new Map(),iI=new Map(),tI=new Map(),out=[];
    const idx=(m,arr,k)=>{if(!m.has(k)){m.set(k,arr.length);arr.push(k)}return m.get(k)};
    let dmin=null,dmax=null;
    for(const r of rows){
      const pn=r['Sales Person'],sn=r['Parent Sales Person']; if(!pn||!sn) continue;
      const si=idx(sI,stores,String(sn).trim());
      const pk=si+'|'+String(pn).trim();
      if(!pI.has(pk)){pI.set(pk,people.length);people.push([String(pn).trim(),si])}
      const dt=sDate(r['Posting Date']); if(dt){if(!dmin||dt<dmin)dmin=dt;if(!dmax||dt>dmax)dmax=dt}
      const day=dt?Math.round(Date.UTC(dt.getFullYear(),dt.getMonth(),dt.getDate())/86400000):null;
      const icode=String(r['Item Code']||'').trim(), iname=String(r['Item Name']||r['Item']||'').trim();
      let ti=null; if(icode||iname){const tk=icode+'|'+iname; if(!tI.has(tk)){tI.set(tk,items.length);items.push([iname,icode])} ti=tI.get(tk)}
      out.push([pI.get(pk),idx(gI,groups,String(r['Item Group']||'').trim()),idx(iI,invs,r['Sales Invoice']),
        Number(r['Contribution Qty'])||0,Math.round((Number(r['Contribution Amount'])||0)*1000)/1000,day,ti]);
    }
    if(!out.length) throw new Error('No sales rows found in that file.');

    return {file:file.name.replace(/\.[^.]+$/,'').slice(0,70),period:fmtPeriod(dmin,dmax),stores,people,groups,items,rows:out};
}
async function vm(file){
  const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true});
  const iso=v=>v instanceof Date?v.toISOString().slice(0,10):v;
  const sheets=wb.SheetNames.map(n=>{const g=XLSX.utils.sheet_to_json(wb.Sheets[n],{header:1,raw:true,defval:null,blankrows:false});
    const cols=(g[0]||[]).map((c,i)=>c==null||c===''?'Column '+(i+1):String(c));
    return{name:n,columns:cols,rows:g.slice(1).map(r=>cols.map((_,i)=>iso(r[i]===undefined?null:r[i])))}}).filter(s=>s.columns.length);
  if(!sheets.length)throw new Error('The file has no data.');
  return{file:file.name,sheets};
}
return{dash,staff,vm,gzip:async obj=>new Response(new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()};
})();
