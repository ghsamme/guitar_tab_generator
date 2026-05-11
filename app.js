// ── Constants ─────────────────────────────────────────────────────────────────
const NN=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const FG='#111', BLUE='#2a5db0', MUTEC='#555';
const CW=120,FH=112,NH=22,SH=172,RH=FH+NH+SH+20,CPR=6,ML=52,MT=16;

// ── State ─────────────────────────────────────────────────────────────────────
let SEQ=[],SEL={},ZONES=[],SONG_TITLE='';
let CHORDS=null, Tonal=null;

// ── DB loader ─────────────────────────────────────────────────────────────────
const ROOT_TO_KEY={'C':'C','C#':'C#','Db':'C#','D':'D','D#':'Eb','Eb':'Eb','E':'E','F':'F','F#':'F#','Gb':'F#','G':'G','G#':'Ab','Ab':'Ab','A':'A','A#':'Bb','Bb':'Bb','B':'B'};
const KEY_PROP={'C':'C','C#':'Csharp','D':'D','Eb':'Eb','E':'E','F':'F','F#':'Fsharp','G':'G','Ab':'Ab','A':'A','Bb':'Bb','B':'B'};
const QUAL_TO_SUFFIX={
  // Internal quality names
  'maj':'major','min':'minor','7':'7','maj7':'maj7','min7':'m7','dim':'dim','dim7':'dim7',
  'aug':'aug','sus2':'sus2','sus4':'sus4','9':'9','m7b5':'m7b5','11':'11','13':'13','6':'6',
  'min6':'m6','7sus4':'7sus4','add9':'add9','min9':'m9','7b9':'7b9','7#9':'7#9','aug7':'aug7','9#11':'9#11',
  // Tonal.js quality names
  '':'major','M':'major','m':'minor','m7':'m7','maj9':'maj9','m9':'m9','m6':'m6',
  'mmaj7':'mmaj7','maj7#11':'maj7#11','7#11':'7#11','6/9':'6/9','b5':'b5','5':'5',
};

async function loadDB(){
  if(CHORDS) return;
  const urls=[
    'https://cdn.jsdelivr.net/npm/@tombatossals/chords-db@0.5.1/lib/guitar.json',
    'https://cdn.jsdelivr.net/npm/chords-db/lib/guitar.json',
  ];
  for(const url of urls){
    try{
      const r=await fetch(url);
      if(!r.ok) continue;
      const data=await r.json();
      CHORDS=data.chords;
      console.log('DB laddad');
      return;
    }catch(e){}
  }
  CHORDS={};
  console.log('DB misslyckades');
}

async function loadTonal(){
  if(Tonal) return;
  const urls=[
    'https://cdn.jsdelivr.net/npm/tonal@4.10.3/browser/tonal.min.js',
    'https://cdn.jsdelivr.net/npm/@tonaljs/tonal@4.10.3/browser/tonal.min.js',
    'https://unpkg.com/tonal@4.10.3/browser/tonal.min.js',
  ];
  for(const url of urls){
    const ok=await new Promise(res=>{
      const s=document.createElement('script');
      s.src=url;
      s.onload=()=>{Tonal=window.Tonal||window.tonal||null;res(!!Tonal)};
      s.onerror=()=>res(false);
      document.head.appendChild(s);
    });
    if(ok){console.log('Tonal laddad');return;}
  }
  console.log('Tonal ej tillgänglig');
}

function getPositions(root,quality){
  if(!CHORDS) return [];
  const key=ROOT_TO_KEY[root]||root;
  const prop=KEY_PROP[key]||key;
  const suffix=QUAL_TO_SUFFIX[quality]||'major';
  const arr=CHORDS[prop]||CHORDS[key];
  if(!arr) return [];
  return (arr.find(c=>c.suffix===suffix)||arr.find(c=>c.suffix==='major')||{}).positions||[];
}

function convertPos(pos){
  const{frets,baseFret,barres}=pos;
  const mute=[],open=[],dots=[];
  frets.forEach((f,i)=>{
    const s=6-i;
    if(f===-1)mute.push(s);
    else if(f===0)open.push(s);
    else dots.push({s,f:baseFret-1+f});
  });
  let barre=null;
  if(barres&&barres.length>0){
    const bv=barres[0];
    if(bv===0){
      const bs=frets.map((f,i)=>f>=0?6-i:null).filter(s=>s!==null);
      if(bs.length>=2){barre={f:baseFret,from:Math.max(...bs),to:Math.min(...bs)};dots.splice(0,dots.length,...dots.filter(d=>d.f>baseFret));}
    }else{
      const actualF=baseFret-1+bv;
      const bs=frets.map((f,i)=>f===bv?6-i:null).filter(s=>s!==null);
      if(bs.length>=2){barre={f:actualF,from:Math.max(...bs),to:Math.min(...bs)};const bset=new Set(bs);dots.splice(0,dots.length,...dots.filter(d=>!bset.has(d.s)));}
    }
  }
  return{mute,open,dots,barre,baseFret,label:baseFret>1?`Pos ${baseFret}`:'Open'};
}

// ── MIDI parser ───────────────────────────────────────────────────────────────
function parseMIDI(buf){
  const u8=new Uint8Array(buf);let p=0;
  const r1=()=>u8[p++];
  const r2=()=>{const v=(u8[p]<<8)|u8[p+1];p+=2;return v};
  const r4=()=>{const v=(u8[p]<<24)|(u8[p+1]<<16)|(u8[p+2]<<8)|u8[p+3];p+=4;return v>>>0};
  const vlq=()=>{let v=0,b;do{b=r1();v=(v<<7)|(b&0x7f)}while(b&0x80);return v};
  const tag=()=>String.fromCharCode(u8[p],u8[p+1],u8[p+2],u8[p+3]);
  while(p<u8.length-4&&tag()!=='MThd')p++;
  if(p>=u8.length-4)throw new Error('Inte en giltig MIDI-fil');
  p+=4;
  const hlen=r4();const fmt=r2(),ntrk=r2(),ppqRaw=r2();
  const ppq=(ppqRaw&0x8000)?480:ppqRaw;
  if(hlen>6)p+=hlen-6;
  const notes=[];
  const meta={title:''};
  for(let t=0;t<ntrk;t++){
    while(p<=u8.length-8&&tag()!=='MTrk')p++;
    if(p>u8.length-8)break;
    p+=4;const end=Math.min(p+r4(),u8.length);
    let tick=0,runSt=0;
    const active=new Map();
    while(p<end){
      tick+=vlq();if(p>=end)break;
      let st=u8[p];
      if(st===0xFF){
        p++;const mtype=r1(),mlen=vlq();
        if((mtype===0x03||mtype===0x00)&&!meta.title){
          let s='';for(let i=0;i<mlen;i++)s+=String.fromCharCode(u8[p+i]);
          const clean=s.replace(/[\x00-\x1F]/g,'').trim();
          if(clean)meta.title=clean;
        }
        p+=mlen;continue;
      }
      if(st===0xF0||st===0xF7){p++;p+=vlq();continue}
      if(st&0x80){runSt=st;p++}else st=runSt;
      if(!st){p++;continue}
      const tp=(st>>4)&0xF;
      const ch=st&0xF;
      if(tp===0x9){const n=r1(),v=r1();
        const key=`${ch}_${n}`;
        if(v>0){
          if(n>=0&&n<=127)active.set(key,{note:n,start:tick,channel:ch});
        }else{
          const on=active.get(key);
          if(on){notes.push({note:on.note,start:on.start,duration:Math.max(1,tick-on.start),channel:ch});active.delete(key)}
        }
      }
      else if(tp===0x8){const n=r1(),v=r1();
        const key=`${ch}_${n}`;
        const on=active.get(key);
        if(on){notes.push({note:on.note,start:on.start,duration:Math.max(1,tick-on.start),channel:ch});active.delete(key)}
      }
      else if(tp===0xA||tp===0xB||tp===0xE){r1();r1()}
      else if(tp===0xC||tp===0xD){r1()}
      else p++;
      if(p>end)p=end;
    }
    const trackEnd=tick;
    active.forEach(on=>notes.push({note:on.note,start:on.start,duration:Math.max(1,trackEnd-on.start),channel:on.channel}));
    p=end;
  }
  notes.sort((a,b)=>a.start-b.start);
  return{notes,ppq,title:meta.title};
}

// ── Chord detection ───────────────────────────────────────────────────────────
const TMPLS=[
  {n:'maj',iv:[0,4,7]},{n:'min',iv:[0,3,7]},{n:'7',iv:[0,4,7,10]},
  {n:'maj7',iv:[0,4,7,11]},{n:'min7',iv:[0,3,7,10]},{n:'dim',iv:[0,3,6]},
  {n:'aug',iv:[0,4,8]},{n:'sus2',iv:[0,2,7]},{n:'sus4',iv:[0,5,7]},
  {n:'dim7',iv:[0,3,6,9]},{n:'m7b5',iv:[0,3,6,10]},{n:'9',iv:[0,4,7,10,14]},
  {n:'6',iv:[0,4,7,9]},{n:'min6',iv:[0,3,7,9]},{n:'7sus4',iv:[0,5,7,10]},
  {n:'add9',iv:[0,4,7,14]},{n:'min9',iv:[0,3,7,10,14]},{n:'11',iv:[0,4,7,10,14,17]},
  {n:'13',iv:[0,4,7,10,14,21]},{n:'7b9',iv:[0,4,7,10,13]},{n:'7#9',iv:[0,4,7,10,15]},
  {n:'9#11',iv:[0,4,7,10,14,18]},{n:'aug7',iv:[0,4,8,10]},
];

function bestChordMatch(notes){
  if(notes.length<2)return null;
  const bassNote=Math.min(...notes);
  const bassPc=bassNote%12;
  const bassName=NN[bassPc];
  const pcs=[...new Set(notes.map(n=>n%12))];
  const noteNames=pcs.map(pc=>NN[pc]);

  if(Tonal){
    const upperNames=noteNames.filter(n=>n!==bassName);
    let upperChord=null;
    if(upperNames.length>=2){
      const res=Tonal.Chord.detect(upperNames);
      if(res.length>0)upperChord=res.sort((a,b)=>a.length-b.length)[0];
    }
    const ordered=[bassName,...upperNames];
    const allRes=Tonal.Chord.detect(ordered);
    const allBest=allRes.length>0?allRes.sort((a,b)=>a.length-b.length)[0]:null;
    if(upperChord){
      const upperRoot=upperChord.replace(/\/.*$/,'').match(/^([A-G][b#]?)/)?.[1];
      if(upperRoot&&upperRoot!==bassName){
        const name=upperChord+'/'+bassName;
        return{name,root:upperRoot,quality:upperChord.replace(/^[A-G][b#]?/,'')};
      }
    }
    if(allBest){
      const root=allBest.replace(/\/.*$/,'').match(/^([A-G][b#]?)/)?.[1]||bassName;
      const quality=allBest.replace(/^[A-G][b#]?/,'').replace(/\/.*$/,'');
      return{name:allBest,root,quality};
    }
  }

  const SIMP={'maj':12,'min':12,'7':11,'maj7':11,'min7':11,'dim':10,'aug':10,'dim7':9,'m7b5':9,'9':8,'sus4':9,'sus2':9,'6':10,'min6':10,'7sus4':9,'add9':9,'min9':8,'11':7,'13':6,'7b9':8,'7#9':8,'9#11':7,'aug7':9};
  let best=null,bs=-1;
  for(let r=0;r<12;r++) for(const t of TMPLS){
    const req=t.iv.map(i=>(r+i)%12);
    const hits=req.filter(p=>pcs.includes(p)).length;
    const extra=pcs.filter(p=>!req.includes(p)).length;
    const missing=req.length-hits;
    const score=(hits/req.length)*10 - extra*2 - missing*1.5 + ((r===bassPc)?1.5:0) + (SIMP[t.n]||5)/10;
    if(score>bs){bs=score;best={r,t}}
  }
  if(!best||bs<5)return null;
  const rn=NN[best.r],q=best.t.n;
  let d=rn;
  if(q==='min')d+='m';else if(q==='min7')d+='m7';else if(q==='7')d+='7';
  else if(q==='maj7')d+='maj7';else if(q==='dim')d+='dim';else if(q==='aug')d+='aug';
  else if(q==='sus2')d+='sus2';else if(q==='sus4')d+='sus4';
  else if(q==='dim7')d+='dim7';else if(q==='m7b5')d+='m7b5';else if(q==='9')d+='9';
  else if(q==='6')d+='6';else if(q==='min6')d+='m6';else if(q==='7sus4')d+='7sus4';
  else if(q==='add9')d+='add9';else if(q==='min9')d+='m9';else if(q==='11')d+='11';
  else if(q==='13')d+='13';else if(q==='7b9')d+='7b9';else if(q==='7#9')d+='7#9';
  else if(q==='9#11')d+='9#11';else if(q==='aug7')d+='aug7';
  if(best.r!==bassPc)d+='/'+bassName;
  return{name:d,root:rn,quality:q};
}

function buildChords(notes,ppq){
  if(!notes.length)return[];
  const maxTick=Math.max(...notes.map(n=>n.start+n.duration));
  const step=Math.max(1,Math.floor(ppq/4));
  const groups=[];
  let current=null;
  for(let tick=0;tick<=maxTick;tick+=step){
    const active=notes.filter(n=>n.start<=tick&&tick<n.start+n.duration).map(n=>n.note);
    if(active.length<2){current=null;continue;}
    const seen=new Map();
    active.sort((a,b)=>a-b).forEach(n=>{const pc=n%12; if(!seen.has(pc)||n<seen.get(pc))seen.set(pc,n)});
    const uniqueNotes=[...seen.values()];
    const pcs=[...new Set(uniqueNotes.map(n=>n%12))].sort((a,b)=>a-b);
    if(pcs.length<2){current=null;continue;}
    const key=pcs.join(',');
    if(!current||current.key!==key){
      current={startTick:tick,key,notes:uniqueNotes};
      groups.push(current);
    }
  }
  const out=[];
  for(const g of groups){
    const ch=bestChordMatch(g.notes);
    if(ch)out.push({...ch,beat:Math.floor(g.startTick/ppq),notes:g.notes});
  }
  return out;
}

// ── Canvas rendering ──────────────────────────────────────────────────────────
function drawFret(ctx,v,x,y,w,h){
  const S=6,F=5,ml=22,mr=5,mt=20;
  const cw=(w-ml-mr)/(S-1),rh=(h-mt-5)/F;
  let mn=99;v.dots.forEach(d=>{if(d.f>0)mn=Math.min(mn,d.f)});
  if(v.barre)mn=Math.min(mn,v.barre.f);if(mn===99)mn=0;
  const sf=mn<=1?0:mn-1,isOpen=sf===0;
  ctx.save();
  if(isOpen){ctx.strokeStyle=FG;ctx.lineWidth=3.5;ctx.beginPath();ctx.moveTo(x+ml,y+mt);ctx.lineTo(x+w-mr,y+mt);ctx.stroke()}
  ctx.font='bold 8px sans-serif';ctx.textAlign='right';ctx.fillStyle=FG;
  for(let f=1;f<=F;f++)ctx.fillText(sf+f,x+ml-3,y+mt+(f-.5)*rh+3);
  for(let f=0;f<=F;f++){ctx.strokeStyle=FG;ctx.lineWidth=f===0?1.2:1;ctx.beginPath();ctx.moveTo(x+ml,y+mt+f*rh);ctx.lineTo(x+w-mr,y+mt+f*rh);ctx.stroke()}
  for(let i=0;i<S;i++){ctx.strokeStyle=FG;ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(x+ml+i*cw,y+mt);ctx.lineTo(x+ml+i*cw,y+mt+F*rh);ctx.stroke()}
  ctx.font='bold 11px sans-serif';ctx.textAlign='center';
  v.mute.forEach(s=>{ctx.fillStyle=MUTEC;ctx.fillText('×',x+ml+(6-s)*cw,y+mt-5)});
  v.open.forEach(s=>{ctx.strokeStyle=FG;ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(x+ml+(6-s)*cw,y+mt-7,4,0,Math.PI*2);ctx.stroke()});
  if(v.barre){const{f,from,to}=v.barre;const by=y+mt+(f-sf-.5)*rh,bx1=x+ml+(6-from)*cw,bx2=x+ml+(6-to)*cw;ctx.fillStyle=BLUE;ctx.beginPath();ctx.roundRect(bx1-4,by-4,bx2-bx1+8,8,4);ctx.fill()}
  v.dots.forEach(d=>{
    if(d.f===0){ctx.strokeStyle=FG;ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(x+ml+(6-d.s)*cw,y+mt-7,4,0,Math.PI*2);ctx.stroke();return}
    const dx=x+ml+(6-d.s)*cw,dy=y+mt+(d.f-sf-.5)*rh;
    ctx.fillStyle=BLUE;ctx.beginPath();ctx.arc(dx,dy,Math.min(cw,rh)*.4,0,Math.PI*2);ctx.fill();
  });
  ctx.restore();
}

const DIA=[0,0,1,1,2,3,3,4,4,5,5,6];
function tY(p,yo){const s=DIA[p%12]+Math.floor(p/12)*7;return yo+(DIA[5]+6*7-s)*4}
function bY(p,yo){const s=DIA[p%12]+Math.floor(p/12)*7;return yo+(DIA[9]+4*7-s)*4}

function drawTrebleClef(ctx,x,y,size){ctx.font=size+'px serif';ctx.fillStyle=FG;ctx.textAlign='center';ctx.fillText('𝄞',x,y)}
function drawBassClef(ctx,x,y,size){ctx.font=size+'px serif';ctx.fillStyle=FG;ctx.textAlign='center';ctx.fillText('𝄢',x,y)}

function render(){
  const canvas=document.getElementById('cv');
  if(!canvas||!SEQ.length)return;
  const titleH=SONG_TITLE?36:0;
  const rows=Math.ceil(SEQ.length/CPR),mc=Math.min(SEQ.length,CPR);
  const W=ML+mc*CW+24,H=MT+titleH+rows*RH+20;
  const dpr=window.devicePixelRatio||1;
  canvas.width=W*dpr;canvas.height=H*dpr;
  canvas.style.width=W+'px';canvas.style.height=H+'px';
  const ctx=canvas.getContext('2d');
  ctx.scale(dpr,dpr);
  ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);
  ZONES=[];
  if(SONG_TITLE){
    ctx.font='bold 18px sans-serif';ctx.fillStyle=FG;ctx.textAlign='center';
    ctx.fillText(SONG_TITLE,W/2,MT+22);
  }
  for(let row=0;row<rows;row++){
    const rc=SEQ.slice(row*CPR,(row+1)*CPR);
    const yo=MT+titleH+row*RH,tyo=yo+FH+NH+20,byo=tyo+68;
    drawTrebleClef(ctx,20,tyo+30,48);
    drawBassClef(ctx,20,byo+20,38);
    const lineW=ML+rc.length*CW;
    ctx.strokeStyle=FG;ctx.lineWidth=1.2;
    for(let l=0;l<5;l++){
      ctx.beginPath();ctx.moveTo(ML,tyo+l*8);ctx.lineTo(lineW,tyo+l*8);ctx.stroke();
      ctx.beginPath();ctx.moveTo(ML,byo+l*8);ctx.lineTo(lineW,byo+l*8);ctx.stroke();
    }
    ctx.lineWidth=1.8;
    const bar=bx=>{ctx.beginPath();ctx.moveTo(bx,tyo);ctx.lineTo(bx,tyo+32);ctx.stroke();ctx.beginPath();ctx.moveTo(bx,byo);ctx.lineTo(bx,byo+32);ctx.stroke()};
    bar(ML);rc.forEach((_,ci)=>bar(ML+(ci+1)*CW));
    rc.forEach((ch,ci)=>{
      const ai=row*CPR+ci,cx=ML+ci*CW,mid=cx+CW/2;
      const vi=SEL[ai]||0;
      const positions=getPositions(ch.root,ch.quality);
      const raw=positions[Math.min(vi,positions.length-1)];
      const v=raw?convertPos(raw):null;
      const delX=cx+CW-18,delY=yo+4;
      if(v){ZONES.push({x:delX,y:delY,w:16,h:16,ci:ai,type:'delete'});const z={x:cx+4,y:yo+2,w:CW-8,h:FH-4,ci:ai,type:'fret'};ZONES.push(z);drawFret(ctx,v,z.x,z.y,z.w,z.h);ctx.font='bold 14px sans-serif';ctx.fillStyle='#bbb';ctx.textAlign='center';ctx.fillText('×',delX+8,delY+12)}
      ctx.font='bold 13px sans-serif';ctx.fillStyle=BLUE;ctx.textAlign='center';
      ctx.fillText(ch.name,mid,yo+FH+NH-4);
      ZONES.push({x:cx+2,y:yo+FH+2,w:CW-4,h:NH-2,ci:ai,type:'name'});
      const dn=(ny,x2)=>{ctx.fillStyle=BLUE;ctx.beginPath();ctx.ellipse(x2,ny,4,2.8,0,0,Math.PI*2);ctx.fill();
        ctx.strokeStyle=BLUE;ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(x2+4,ny);ctx.lineTo(x2+4,ny-22);ctx.stroke();
        ctx.beginPath();ctx.moveTo(x2+4,ny-22);ctx.lineTo(x2+8,ny-17);ctx.stroke();
      };
      const ledg=(ny,top)=>{ctx.strokeStyle=FG;ctx.lineWidth=1.2;
        if(ny<top-2)for(let ly=top-8;ly>=ny-4;ly-=8){ctx.beginPath();ctx.moveTo(mid-10,ly);ctx.lineTo(mid+10,ly);ctx.stroke()}
        if(ny>top+34)for(let ly=top+40;ly<=(ny+4);ly+=8){ctx.beginPath();ctx.moveTo(mid-10,ly);ctx.lineTo(mid+10,ly);ctx.stroke()}
      };
      ch.notes.filter(n=>n>=55).forEach(n=>{const ny=tY(n,tyo);dn(ny,mid);ledg(ny,tyo)});
      ch.notes.filter(n=>n<55).forEach(n=>{const ny=bY(n,byo);dn(ny,mid);ledg(ny,byo)});
    });
  }
}

function fretSVG(v,sz){
  const S=6,F=5,ml=22,mr=5,mt=20;
  const W=sz,H=Math.round(sz*1.35),cw=(W-ml-mr)/(S-1),rh=(H-mt-5)/F;
  let mn=99;v.dots.forEach(d=>{if(d.f>0)mn=Math.min(mn,d.f)});
  if(v.barre)mn=Math.min(mn,v.barre.f);if(mn===99)mn=0;
  const sf=mn<=1?0:mn-1,isO=sf===0;
  let s='<svg viewBox="0 0 '+W+' '+H+'" xmlns="http://www.w3.org/2000/svg" style="width:'+sz+'px;height:'+Math.round(sz*1.35)+'px">';
  if(isO)s+='<line x1="'+ml+'" y1="'+mt+'" x2="'+(W-mr)+'" y2="'+mt+'" stroke="#111" stroke-width="3.5"/>';
  for(let f=1;f<=F;f++)s+='<text x="'+(ml-3)+'" y="'+(mt+(f-.5)*rh+3)+'" font-size="7.5" font-weight="bold" fill="#111" text-anchor="end">'+(sf+f)+'</text>';
  for(let f=0;f<=F;f++)s+='<line x1="'+ml+'" y1="'+(mt+f*rh)+'" x2="'+(W-mr)+'" y2="'+(mt+f*rh)+'" stroke="#111" stroke-width="'+(f===0?1.2:1)+'"/>';
  for(let i=0;i<S;i++)s+='<line x1="'+(ml+i*cw)+'" y1="'+mt+'" x2="'+(ml+i*cw)+'" y2="'+(mt+F*rh)+'" stroke="#111" stroke-width="1.2"/>';
  v.mute.forEach(st=>s+='<text x="'+(ml+(6-st)*cw)+'" y="'+(mt-5)+'" font-size="11" font-weight="bold" fill="#555" text-anchor="middle">×</text>');
  v.open.forEach(st=>s+='<circle cx="'+(ml+(6-st)*cw)+'" cy="'+(mt-7)+'" r="4" fill="none" stroke="#111" stroke-width="1.5"/>');
  if(v.barre){const{f,from,to}=v.barre;const by=mt+(f-sf-.5)*rh,x1=ml+(6-from)*cw,x2=ml+(6-to)*cw;s+='<rect x="'+(x1-4)+'" y="'+(by-4)+'" width="'+(x2-x1+8)+'" height="8" rx="4" fill="'+BLUE+'"/>'}
  v.dots.forEach(d=>{
    if(d.f===0){s+='<circle cx="'+(ml+(6-d.s)*cw)+'" cy="'+(mt-7)+'" r="4" fill="none" stroke="#111" stroke-width="1.5"/>';return}
    const x=ml+(6-d.s)*cw,y=mt+(d.f-sf-.5)*rh;
    s+='<circle cx="'+x+'" cy="'+y+'" r="'+(Math.min(cw,rh)*.4)+'" fill="'+BLUE+'"/>';
  });
  return s+'</svg>';
}

function openModal(ci){
  const ch=SEQ[ci];
  const positions=getPositions(ch.root,ch.quality);
  document.getElementById('mtitle').textContent=ch.name;
  document.getElementById('msub').textContent=`${positions.length} grepp – klicka för att välja`;
  const grid=document.getElementById('mgrid');grid.innerHTML='';
  if(!positions.length){grid.innerHTML='<p style="color:#999">Inga grepp hittades.</p>';document.getElementById('modal').classList.add('open');return}
  const sel=SEL[ci]||0;
  positions.forEach((raw,vi)=>{
    const v=convertPos(raw);
    const el=document.createElement('div');
    el.className='alt-item'+(vi===sel?' selected':'');
    el.innerHTML=fretSVG(v,78)+`<div class="alt-label">${v.label}</div>`;
    el.onclick=()=>{SEL[ci]=vi;closeModal();render()};
    grid.appendChild(el);
  });
  document.getElementById('modal').classList.add('open');
}
function closeModal(){document.getElementById('modal').classList.remove('open')}
document.getElementById('modal').onclick=e=>{if(e.target===document.getElementById('modal'))closeModal()};

// ── Chord picker ──────────────────────────────────────────────────────────────
const PK_ROOTS=['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','Cb'];
const PK_ROOT_KEYS=['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
const PK_TYPES=[{l:'maj',s:'major'},{l:'min',s:'minor'},{l:'dim',s:'dim'},{l:'sus4',s:'sus4'},{l:'sus2',s:'sus2'},{l:'aug',s:'aug'}];
const PK_TENSIONS=[{l:'7',s:'7'},{l:'maj7',s:'maj7'},{l:'b9',s:'7b9'},{l:'9',s:'9'},{l:'#9',s:'7#9'},{l:'11',s:'11'},{l:'b5/#11',s:'9#11'},{l:'#5/b13',s:'aug7'},{l:'6/13',s:'13'}];
const PK_BASS=['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','Cb'];
let pickerCi=null,pkRoot=null,pkType=null,pkTension=null,pkBass=null;

function pickerOpen(ci){
  pickerCi=ci;
  const ch=SEQ[ci];
  pkRoot=ch.root;
  const qmap={
    'maj':{t:'major',n:null},'min':{t:'minor',n:null},'dim':{t:'dim',n:null},
    'aug':{t:'aug',n:null},'sus2':{t:'sus2',n:null},'sus4':{t:'sus4',n:null},
    '7':{t:'major',n:'7'},'maj7':{t:'major',n:'maj7'},'min7':{t:'minor',n:'7'},
    'dim7':{t:'dim',n:null},'m7b5':{t:'dim',n:'7'},'9':{t:'major',n:'9'},
    '11':{t:'major',n:'11'},'13':{t:'major',n:'13'},'7b9':{t:'major',n:'7b9'},
    '7#9':{t:'major',n:'7#9'},'9#11':{t:'major',n:'9#11'},'aug7':{t:'aug',n:'aug7'},
  };
  const q=qmap[ch.quality]||{t:'major',n:null};
  pkType=PK_TYPES.find(t=>t.s===q.t)||PK_TYPES[0];
  pkTension=q.n?PK_TENSIONS.find(t=>t.s===q.n):null;
  const sharpToFlat={'C#':'Db','D#':'Eb','F#':'Gb','G#':'Ab','A#':'Bb'};
  const bassMatch=ch.name.match(/\/([A-G][b#]?)$/);
  const rawBass=bassMatch?bassMatch[1]:null;
  const bass=rawBass?(sharpToFlat[rawBass]||rawBass):null;
  pkBass=PK_BASS.includes(bass)?bass:null;
  buildPicker();
  document.getElementById('picker-modal').classList.add('open');
}
function buildPicker(){
  document.getElementById('pk-roots').innerHTML=PK_ROOTS.map((r,i)=>
    `<button class="picker-btn${pkRoot===PK_ROOT_KEYS[i]?' selected':''}" onclick="pkSelectRoot('${PK_ROOT_KEYS[i]}')">${r}</button>`).join('');
  document.getElementById('pk-types').innerHTML=PK_TYPES.map(t=>
    `<button class="picker-btn${pkType&&pkType.s===t.s?' selected':''}" onclick="pkSelectType('${t.s}')">${t.l}</button>`).join('');
  document.getElementById('pk-tensions').innerHTML=
    `<button class="picker-btn${!pkTension?' selected':''}" onclick="pkSelectTension(null)">—</button>`+
    PK_TENSIONS.map(t=>`<button class="picker-btn${pkTension&&pkTension.s===t.s?' selected':''}" onclick="pkSelectTension('${t.s}')">${t.l}</button>`).join('');
  document.getElementById('pk-bass').innerHTML=
    `<button class="picker-btn${!pkBass?' selected':''}" onclick="pkSelectBass(null)">—</button>`+
    PK_BASS.map(b=>`<button class="picker-btn${pkBass===b?' selected':''}" onclick="pkSelectBass('${b}')">${b}</button>`).join('');
}
function pkSelectRoot(r){pkRoot=r;buildPicker()}
function pkSelectType(s){pkType=PK_TYPES.find(t=>t.s===s)||PK_TYPES[0];pkTension=null;buildPicker()}
function pkSelectTension(s){pkTension=s?PK_TENSIONS.find(t=>t.s===s):null;buildPicker()}
function pkSelectBass(b){pkBass=b;buildPicker()}
function pickerConfirm(){
  if(pickerCi===null||!pkRoot||!pkType)return;
  const suffix=pkTension?pkTension.s:pkType.s;
  let name=pkRoot;
  if(pkType.l==='min')name+='m';
  else if(pkType.l!=='maj')name+=pkType.l;
  if(pkTension)name+=pkTension.l;
  if(pkBass)name+='/'+pkBass;
  const qmap={'major':'maj','minor':'min','7':'7','maj7':'maj7','m7':'min7','dim':'dim','aug':'aug','sus2':'sus2','sus4':'sus4','dim7':'dim7','m7b5':'m7b5','9':'9'};
  const quality=qmap[suffix]||'maj';
  if(pickerCi>=SEQ.length){
    SEQ.push({name,root:pkRoot,quality,beat:SEQ.length,notes:[]});
    SEL[SEQ.length-1]=0;
    document.getElementById('toolbar').style.display='flex';
    document.getElementById('staff-wrap').style.display='block';
  }else{
    SEQ[pickerCi]={...SEQ[pickerCi],name,root:pkRoot,quality};
    SEL[pickerCi]=0;
  }
  pickerClose();render();
}
function pickerClose(){document.getElementById('picker-modal').classList.remove('open');pickerCi=null}
function pickerAdd(){loadDB().then(()=>{pickerCi=SEQ.length;pkRoot='C';pkType=PK_TYPES[0];pkTension=null;pkBass=null;buildPicker();document.getElementById('picker-modal').classList.add('open')})}
document.getElementById('picker-modal').onclick=e=>{if(e.target===document.getElementById('picker-modal'))pickerClose()};

const cv=document.getElementById('cv');
cv.addEventListener('click',e=>{
  const r=cv.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top;
  for(const z of ZONES){
    if(mx>=z.x&&mx<=z.x+z.w&&my>=z.y&&my<=z.y+z.h){
      if(z.type==='delete'){SEQ.splice(z.ci,1);const ns={};Object.entries(SEL).forEach(([k,sv])=>{const ki=parseInt(k);if(ki<z.ci)ns[ki]=sv;else if(ki>z.ci)ns[ki-1]=sv});SEL=ns;if(!SEQ.length){document.getElementById('staff-wrap').style.display='none';document.getElementById('toolbar').style.display='none';}render();return;}
      if(z.type==='name')pickerOpen(z.ci);else openModal(z.ci);return;
    }
  }
});
cv.addEventListener('mousemove',e=>{
  const r=cv.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top;
  cv.style.cursor=ZONES.some(z=>mx>=z.x&&mx<=z.x+z.w&&my>=z.y&&my<=z.y+z.h)?'pointer':'default';
});

function exportPDF(){
  const btn=document.getElementById('pdf-btn');
  btn.textContent='Genererar...';btn.disabled=true;
  const canvas=document.getElementById('cv');
  const exp=document.createElement('canvas');
  exp.width=canvas.width;exp.height=canvas.height;
  const ctx=exp.getContext('2d');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,exp.width,exp.height);
  ctx.drawImage(canvas,0,0);
  function doExport(){
    const{jsPDF}=window.jspdf;
    const dpr=window.devicePixelRatio||1;
    const imgWidthPx=exp.width/dpr;
    const rows=Math.ceil(SEQ.length/CPR);
    const titleH=SONG_TITLE?36:0;
    const rowsPerPage=3;
    const pageWidth=210;
    const pageHeight=297;
    const mmPerPx=25.4/96;
    const pageHeightPx=Math.floor(pageHeight/mmPerPx);
    const rowBlockPx=rowsPerPage*RH;
    const pageCount=Math.ceil(rows/rowsPerPage);
    const pdf=new jsPDF('p','mm','a4');
    for(let page=0;page<pageCount;page++){
      if(page>0)pdf.addPage();
      const startRow=page*rowsPerPage;
      const rowsOnPage=Math.min(rowsPerPage,rows-startRow);
      const sourceY=(MT+titleH+startRow*RH)*dpr;
      const sourceHeight=rowsOnPage*RH*dpr;
      const pageCanvas=document.createElement('canvas');
      pageCanvas.width=imgWidthPx;
      pageCanvas.height=pageHeightPx;
      const pageCtx=pageCanvas.getContext('2d');
      pageCtx.fillStyle='#fff';
      pageCtx.fillRect(0,0,pageCanvas.width,pageCanvas.height);
      if(SONG_TITLE){
        pageCtx.font='bold 18px sans-serif';
        pageCtx.fillStyle=FG;
        pageCtx.textAlign='center';
        pageCtx.fillText(SONG_TITLE,pageCanvas.width/2,MT+22);
      }
      pageCtx.drawImage(exp,0,sourceY,exp.width,sourceHeight,0,MT+titleH,pageCanvas.width,rowsOnPage*RH);
      const pageDataUrl=pageCanvas.toDataURL('image/png');
      pdf.addImage(pageDataUrl,'PNG',0,0,pageWidth,pageHeight);
    }
    pdf.save((SONG_TITLE||'ackord')+'.pdf');
    btn.textContent='⬇ Spara som PDF';btn.disabled=false;
  }
  if(window.jspdf){doExport();}
  else{
    const s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
    s.onload=doExport;
    s.onerror=()=>{btn.textContent='⬇ Spara som PDF';btn.disabled=false;alert('Kunde inte ladda PDF-biblioteket.');};
    document.head.appendChild(s);
  }
}

document.getElementById('title-input').addEventListener('input',function(){
  SONG_TITLE=this.value;render();
});

async function handleFile(file){
  if(!file)return;
  try{
    await loadDB();
    try{await loadTonal();}catch(e){}
    const buf=await file.arrayBuffer();
    const{notes,ppq,title}=parseMIDI(buf);
    if(!notes.length){alert('Inga noter hittades i filen.');return}
    SEQ=buildChords(notes,ppq);
    if(!SEQ.length){alert('Kunde inte identifiera ackord.');return}
    SEL={};
    SONG_TITLE=title||'';
    document.getElementById('title-input').value=SONG_TITLE;
    document.getElementById('toolbar').style.display='flex';
    document.getElementById('staff-wrap').style.display='block';
    render();
  }catch(err){alert('Fel: '+err.message);}
}

document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeModal();pickerClose()}});
document.getElementById('fi').onchange=function(){handleFile(this.files[0])};
const dz=document.getElementById('drop-zone');
dz.ondragover=e=>{e.preventDefault();dz.classList.add('drag')};
dz.ondragleave=()=>dz.classList.remove('drag');
dz.ondrop=e=>{e.preventDefault();dz.classList.remove('drag');handleFile(e.dataTransfer.files[0])};
