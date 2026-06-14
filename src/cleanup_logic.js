// ============ CALENDAR CLEANUP ENGINE v3 (layer on engine_core) ============
// Objective: keep a 2-route buffer when load allows. Tiered ladder:
//   1) standard chaining  (PM jobs, free, route optimization — always)
//   2) extra chaining     (AM jobs, customer call, $100 tight / $50 looser)
//   3) day switch         (move date, chain-first, last resort for shortage)
const CLEAN = { maxArrivalHr: 16, pmCutoffHr: 12, windowDays: 7, buffer: 2,
                tightLinkMin: 15, tightLinkMi: 15, discountTight: 100, discountLoose: 50 };

function jobByCode(code){ for(const iso in DATA.days){const arr=DATA.days[iso]||[];for(const j of arr){if(j.code===code)return j;}} return null; }
function shortName(c){ return c? String(c).trim().split(/\s+/)[0] : ''; }
function ptOf(p){ return (p && p.lat!=null && p.lon!=null)? {lat:p.lat, lon:p.lon} : null; }

function cleanWindow(arriveMs, dayIso){
  const ceil = Date.parse(dayIso+'T'+String(CLEAN.maxArrivalHr).padStart(2,'0')+':00');
  let s = new Date(arriveMs); s.setMinutes(0,0,0);
  let sMs = s.getTime(); let eMs = Math.min(ceil, sMs + 2*3600000);
  if (eMs - sMs < 3600000) sMs = eMs - 2*3600000;
  const f = ms => { const d=new Date(ms); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); };
  return { start:f(sMs), end:f(eMs), text:f(sMs)+'\u2013'+f(eMs) };
}

function coreAvailOn(iso){
  const a = DATA.foremen.filter(f=>f.status==='Active');
  const off = new Set();
  const src = (DATA.dayoffs&&DATA.dayoffs.length)?DATA.dayoffs:[];
  for(const [nk,s,e] of src){ if(iso>=s&&iso<=e){const f=matchForeman(nk);if(f&&f.status==='Active')off.add(f.name);} }
  const ta = tripAwayMap(iso).f; Object.keys(ta).forEach(n=>{const f=DATA.foremen.find(x=>x.name===n);if(f&&f.status==='Active')off.add(n);});
  return { avail: a.length-off.size, off:[...off], total:a.length };
}

function _linkFeasible(A, jt){
  if(A.ldDeparture) return {ok:false};
  if(A.legs.length>=CHAIN_RULES.maxJobs) return {ok:false};
  if(A.legs.some(x=>(x.cf||0)>CHAIN_RULES.maxCF)) return {ok:false};
  if((jt.cf||0)>CHAIN_RULES.maxCF) return {ok:false};
  if(!jt.pickup||!jt.delivery||!INREGION(jt.delivery)) return {ok:false};
  const la=[...A.legs].sort((x,y)=>Date.parse(x.start||0)-Date.parse(y.start||0)).slice(-1)[0];
  if(!la.delivery||!INREGION(la.delivery)) return {ok:false};
  const at1=Math.max(...A.legs.map(l=>l._endMs||Date.parse(l.end||l.start||0)));
  const rm=cachedRoadMi(la.delivery, jt.pickup);
  const linkMi=(rm!=null?rm:hav(la.delivery, jt.pickup)*1.15);
  const driveMs=linkMi/35*3600000;
  if(driveMs>CHAIN_RULES.maxDriveMin*60000) return {ok:false};
  const bt0=Date.parse(jt.start); const eta=at1+driveMs;
  const dayIso=String(jt.start).slice(0,10);
  const ceil=Date.parse(dayIso+'T'+String(CLEAN.maxArrivalHr).padStart(2,'0')+':00');
  const normal = eta <= bt0 + CHAIN_RULES.lateMin*60000;
  const arriveMs = normal ? Math.max(eta, bt0) : eta;
  if(eta>ceil) return {ok:false};
  const ws=arriveMs; const p2d=hav(jt.pickup, jt.delivery)/35*3600000*1.15;
  const done=ws+((jt.actH||schedH(jt))*3600000)+p2d;
  if(done>Date.parse(dayIso+'T23:59')) return {ok:false};
  if(Math.max(A.crew, jt.crew||2)>6) return {ok:false};
  return {ok:true, arriveMs, linkMi:Math.round(linkMi), linkMin:Math.round(driveMs/60000), anchorEndMs:at1, normal, anchorLeg:la};
}
function bestAnchorFor(jobObj, routes){ let best=null; for(const A of routes){const f=_linkFeasible(A, jobObj);if(f.ok&&(!best||f.linkMin<best.linkMin))best={A,...f};} return best; }

function recGeo(anchorLeg, jobObj){
  const stops=[];
  if(anchorLeg){const d=ptOf(anchorLeg.delivery)||ptOf(anchorLeg.pickup);if(d)stops.push({lat:d.lat,lon:d.lon,kind:'A',label:'crew finishes \u00b7 '+(anchorLeg.cityTo||anchorLeg.cityFrom||''),customer:anchorLeg.customer||''});}
  const p=ptOf(jobObj.pickup); if(p)stops.push({lat:p.lat,lon:p.lon,kind:'P',label:'pickup \u00b7 '+(jobObj.cityFrom||''),customer:jobObj.customer||''});
  const d=ptOf(jobObj.delivery); if(d)stops.push({lat:d.lat,lon:d.lon,kind:'D',label:'delivery \u00b7 '+(jobObj.cityTo||''),customer:jobObj.customer||''});
  return stops;
}

// classify all single-route chains into standard (PM, free) and calls (AM, paid)
function detectChains(rts, iso){
  const standard=[], calls=[]; const seen=new Set();
  const singles = rts.filter(r=>r.legs.length===1 && !r.legs[0].after && !r.ldDeparture
        && (r.legs[0].cf||0)<=CHAIN_RULES.maxCF && !AUTOOFFLIST.has(r.legs[0].code));
  for(const B of singles){
    const lb=B.legs[0]; let best=null;
    for(const A of rts){ if(A===B)continue; const f=_linkFeasible(A, lb); if(!f.ok)continue; if(!best||f.linkMin<best.linkMin)best={A,...f}; }
    if(!best)continue;
    const base={ tail:lb.code, after:best.anchorLeg.code, anchorRouteId:best.A.id,
      linkMi:best.linkMi, linkMin:best.linkMin, anchorEndMs:best.anchorEndMs, arriveMs:best.arriveMs, normal:best.normal,
      customer:lb.customer||'', city:lb.cityFrom||'', deliveryCity:lb.cityTo||'', cf:lb.cf||0, actH:(lb.actH||schedH(lb)),
      origStartMs:Date.parse(lb.start), anchorCustomer:best.anchorLeg.customer||'',
      anchorCity:best.anchorLeg.cityTo||best.anchorLeg.cityFrom||'', geo:recGeo(best.anchorLeg, lb) };
    const isPM = new Date(lb.start).getHours() >= CLEAN.pmCutoffHr;
    if(isPM){ standard.push(base); }
    else { base.discount=(best.linkMin<=CLEAN.tightLinkMin||best.linkMi<=CLEAN.tightLinkMi)?CLEAN.discountTight:CLEAN.discountLoose;
           base.window=cleanWindow(best.arriveMs, iso); calls.push(base); }
  }
  standard.sort((a,b)=>a.linkMin-b.linkMin);
  calls.sort((a,b)=>a.linkMin-b.linkMin);
  return {standard, calls};
}

// Apply engine auto-chains + all free PM standard chains greedily. Returns final routes + the standard list.
function optimizeStandard(iso){
  const kJ=DATA.jobs,kAC=AUTOCHAINS,kD=currentDay,kOff=new Set(AUTOOFFLIST);
  try{
    DATA.jobs=DATA.days[iso]||[]; currentDay=iso; AUTOCHAINS=[];
    try{computeAutoOff();}catch(e){}
    let rts=buildRoutes();
    for(let g=0;g<2;g++){const det=detectAutoChains(rts);if(!det.length)break;AUTOCHAINS=AUTOCHAINS.concat(det);rts=buildRoutes();}
    const baseCount=rts.length;
    const standardChains=[];
    for(let k=0;k<14;k++){
      const {standard}=detectChains(rts, iso);
      if(!standard.length)break;
      const pick=standard[0];
      AUTOCHAINS.push({tail:pick.tail, after:pick.after});
      const nr=buildRoutes();
      if(nr.length>=rts.length){ AUTOCHAINS.pop(); break; } // safety: must reduce
      rts=nr; standardChains.push(pick);
    }
    const finalCount=rts.length;
    // snapshot routes (plain) for downstream pools, and detect remaining calls
    const {calls}=detectChains(rts, iso);
    const snap=rts.map(r=>({id:r.id,base:r.base,crew:r.crew,legs:r.legs.length,codes:r.legs.map(l=>l.code),
      single:r.legs.length===1&&!r.ldDeparture, code:r.legs[0].code,
      first:r.legs[0], pickup:r.legs[0].pickup, delivery:r.legs[0].delivery}));
    return {routesSnap:snap, standardChains, calls, baseCount, finalCount};
  } finally { DATA.jobs=kJ; AUTOCHAINS=kAC; currentDay=kD; AUTOOFFLIST.clear(); kOff.forEach(x=>AUTOOFFLIST.add(x)); }
}

function dayLoad(iso){
  const opt=optimizeStandard(iso); const core=coreAvailOn(iso);
  const target=core.avail-CLEAN.buffer; const routes=opt.finalCount;
  const status = routes<=target?'ok':(routes<=core.avail?'tight':'short');
  return {iso, routes, base:opt.baseCount, availableCore:core.avail, coreOff:core.off, target,
          spare:core.avail-routes, status, standardCount:opt.standardChains.length, _opt:opt};
}

function slotOnTarget(jobObj, targetIso){
  const kJ=DATA.jobs,kAC=AUTOCHAINS,kD=currentDay,kOff=new Set(AUTOOFFLIST);
  try{
    DATA.jobs=DATA.days[targetIso]||[]; currentDay=targetIso; AUTOCHAINS=[];
    try{computeAutoOff();}catch(e){}
    let rts=buildRoutes();
    for(let g=0;g<2;g++){const det=detectAutoChains(rts);if(!det.length)break;AUTOCHAINS=AUTOCHAINS.concat(det);rts=buildRoutes();}
    const probe=Object.assign({}, jobObj, {start: targetIso+' '+String(jobObj.start).slice(11)});
    const anchor=bestAnchorFor(probe, rts);
    if(anchor){
      return { fresh:false, anchorCode:anchor.anchorLeg.code, anchorCustomer:anchor.anchorLeg.customer||'',
               anchorCity:anchor.anchorLeg.cityTo||anchor.anchorLeg.cityFrom||'', arriveMs:anchor.arriveMs,
               anchorEndMs:anchor.anchorEndMs, linkMin:anchor.linkMin, linkMi:anchor.linkMi,
               city:probe.cityFrom||'', deliveryCity:probe.cityTo||'', actH:(probe.actH||schedH(probe)),
               customer:probe.customer||'', window:cleanWindow(anchor.arriveMs, targetIso), geo:recGeo(anchor.anchorLeg, probe) };
    }
    const ms=Date.parse(probe.start);
    return { fresh:true, origStartMs:ms, customer:probe.customer||'', city:probe.cityFrom||'', deliveryCity:probe.cityTo||'', geo:recGeo(null, probe) };
  } finally { DATA.jobs=kJ; AUTOCHAINS=kAC; currentDay=kD; AUTOOFFLIST.clear(); kOff.forEach(x=>AUTOOFFLIST.add(x)); }
}

// ranked move candidates for singles that remain after standard (AM or unchainable PM)
function buildMovePool(iso, opt, horizon, callTails){
  const day=DATA.days[iso]||[];
  const singleCodes=new Set(opt.routesSnap.filter(r=>r.single).map(r=>r.code));
  const movable=day.filter(j=>{
    if(!singleCodes.has(j.code))return false;
    if(/long/i.test(j.movingType||''))return false;
    if(j._confirmed)return false;
    if(j.delivery && !INREGION(j.delivery))return false;
    return true;
  }).sort((a,b)=>(a.cf||0)-(b.cf||0));
  const base=Date.parse(iso+'T12:00');
  const targets=horizon.filter(t=>t.iso!==iso && t.iso>=TODAY_ISO && t.spare>=1)
    .sort((x,y)=>(y.spare-x.spare)||(Math.abs(Date.parse(x.iso+'T12:00')-base)-Math.abs(Date.parse(y.iso+'T12:00')-base)));
  const out=[];
  for(const j of movable){
    if(!targets.length)break;
    const t=targets[0];
    const slot=slotOnTarget(j, t.iso);
    out.push({ code:j.code, customer:j.customer||'', city:j.cityFrom||'', cf:j.cf||0, from:iso, to:t.iso,
               targetSpare:t.spare, slot, isAM:new Date(j.start).getHours()<CLEAN.pmCutoffHr });
  }
  return out;
}

function cleanupPlan(iso, horizon){
  const load=dayLoad(iso); const opt=load._opt;
  const callPool=opt.calls.map(c=>Object.assign({}, c, {window:c.window||cleanWindow(c.arriveMs, iso),
      discount:c.discount||((c.linkMin<=CLEAN.tightLinkMin||c.linkMi<=CLEAN.tightLinkMi)?CLEAN.discountTight:CLEAN.discountLoose)}));
  const movePool=buildMovePool(iso, opt, horizon||[], new Set(callPool.map(c=>c.tail)));
  const gapToBuffer=Math.max(0, load.routes-load.target);
  const gapToCover =Math.max(0, load.routes-load.availableCore);
  return { iso, availableCore:load.availableCore, coreOff:load.coreOff, target:load.target,
           baseRoutes:load.base, routes:load.routes, routesSnap:load._opt.routesSnap, status:load.status, spare:load.spare,
           standardChains:opt.standardChains, callPool, movePool, gapToBuffer, gapToCover };
}

function scanHorizon(fromIso, nDays){
  const days=[]; const start=Date.parse(fromIso+'T12:00');
  for(let i=0;i<nDays;i++){
    const d=new Date(start+i*86400000);
    const iso=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    if(!DATA.days[iso])continue;
    const l=dayLoad(iso);
    days.push({iso, routes:l.routes, base:l.base, availableCore:l.availableCore, target:l.target, spare:l.spare, status:l.status, standardCount:l.standardCount});
  }
  return days;
}


// Given a plan + a set of declined ids, return the recommended non-conflicting active set.
// Strategy: free crews with calls first (cheaper than moving a customer's date), up to the
// buffer gap; if calls can't even clear the shortage, add date-moves until the shortage clears.
function solvePlan(plan, declined){
  declined = declined || new Set();
  const used = new Set();        // job codes consumed as tail or anchor
  const activeCalls=[], activeMoves=[];
  const needCover=plan.gapToCover, needBuffer=plan.gapToBuffer;
  let freed=0;
  for(const c of plan.callPool){
    if(freed>=needBuffer)break;
    if(declined.has('call|'+c.tail))continue;
    if(used.has(c.tail)||used.has(c.after))continue;
    const purpose = freed<needCover ? 'cover' : 'buffer';
    activeCalls.push(Object.assign({purpose}, c)); used.add(c.tail); used.add(c.after); freed++;
  }
  if(freed<needCover){
    const spareLeft={};
    for(const m of plan.movePool){
      if(freed>=needCover)break;
      if(declined.has('move|'+m.code))continue;
      if(used.has(m.code))continue;
      const k=m.to; const cap=(spareLeft[k]!=null?spareLeft[k]:m.targetSpare);
      if(cap<1)continue;
      activeMoves.push(Object.assign({purpose:'cover'}, m)); used.add(m.code); spareLeft[k]=cap-1; freed++;
    }
  }
  const projectedRoutes=plan.routes-freed;
  return { activeCalls, activeMoves, freed,
           clearedShortage: freed>=needCover,
           reachedBuffer: projectedRoutes<=plan.target,
           projectedRoutes,
           // remaining bench alternatives (for the cascade UI to know more exist)
           moreCalls: plan.callPool.filter(c=>!activeCalls.find(a=>a.tail===c.tail) && !declined.has('call|'+c.tail)).length,
           moreMoves: plan.movePool.filter(m=>!activeMoves.find(a=>a.code===m.code) && !declined.has('move|'+m.code)).length };
}


// Full route objects for the day's timeline (build + chains + assignAll so rows show foreman/truck like the dispatcher).
function timelineData(iso){
  const kJ=DATA.jobs,kAC=AUTOCHAINS,kD=currentDay,kOff=new Set(AUTOOFFLIST);
  try{
    DATA.jobs=DATA.days[iso]||[]; currentDay=iso; AUTOCHAINS=[];
    try{computeAutoOff();}catch(e){}
    let rts=buildRoutes();
    for(let g=0;g<2;g++){const det=detectAutoChains(rts);if(!det.length)break;AUTOCHAINS=AUTOCHAINS.concat(det);rts=buildRoutes();}
    for(let k=0;k<14;k++){const r=detectChains(rts,iso).standard;if(!r.length)break;const p=r[0];AUTOCHAINS.push({tail:p.tail,after:p.after});const nr=buildRoutes();if(nr.length>=rts.length){AUTOCHAINS.pop();break;}rts=nr;}
    try{assignAll(rts);}catch(e){}
    const core=coreAvailOn(iso);
    // shortage rows = the routes beyond core capacity (the last (routes-core) by latest start get flagged)
    const over=Math.max(0, rts.length-core.avail);
    const shortIds=new Set([...rts].sort((a,b)=>(b.t0||0)-(a.t0||0)).slice(0,over).map(r=>r.id));
    return {routes:rts, availableCore:core.avail, off:core.off, shortIds:[...shortIds]};
  } finally { DATA.jobs=kJ; AUTOCHAINS=kAC; currentDay=kD; AUTOOFFLIST.clear(); kOff.forEach(x=>AUTOOFFLIST.add(x)); }
}

// Per-crew-slot ordered options for the resolve flow + decline cascade.
// declined = Set of keys 'slot<i>|call|<tail>' / 'slot<i>|move|<code>'. Recompute on every action.
function resolveSlots(plan, declined){
  declined = declined || new Set();
  const cover=plan.gapToCover, gap=Math.max(plan.gapToBuffer, plan.gapToCover);
  const used=new Set(); const slots=[];
  for(let i=0;i<gap;i++){
    const cand=[];
    for(const c of plan.callPool){
      if(used.has(c.tail)||used.has(c.after))continue;
      if(declined.has('slot'+i+'|call|'+c.tail))continue;
      cand.push({kind:'call', key:'call|'+c.tail, rec:c});
    }
    for(const m of plan.movePool){
      if(used.has(m.code))continue;
      if(declined.has('slot'+i+'|move|'+m.code))continue;
      cand.push({kind:'move', key:'move|'+m.code, rec:m});
    }
    const cur=cand[0]||null;
    if(cur){ if(cur.kind==='call'){used.add(cur.rec.tail);used.add(cur.rec.after);} else used.add(cur.rec.code); }
    slots.push({index:i, must:i<cover, current:cur, altCount:Math.max(0,cand.length-1), exhausted:!cur});
  }
  return {slots, cover, gap};
}

if(typeof module!=='undefined'){ Object.assign(module.exports, {CLEAN, coreAvailOn, dayLoad, detectChains, optimizeStandard, cleanupPlan, scanHorizon, cleanWindow, jobByCode, slotOnTarget, buildMovePool, solvePlan, timelineData, resolveSlots}); }
