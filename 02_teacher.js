
/* =========================================================
   TEACHER APP (NEW) — gọn nhẹ, dễ dùng
   - Quản lý lớp & học sinh (thêm tay + import Excel/CSV)
   - Giao bài (bài hệ thống + đề riêng)
   - Xem kết quả (PASS/FAIL, thời gian, số lần, lỗi hay gặp)
   - Quản trị nội dung (ngân hàng câu hỏi + rules/hints)
   - Trợ giúp học sinh (ticket)
   ========================================================= */
(function(){
  const $ = (id)=>document.getElementById(id);
  const esc = (s)=>String(s??"").replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));
  const nowISO = ()=> new Date().toISOString();
  const toast = window.toast || ((m)=>{ try{ alert(m); }catch(e){} });

  // ===== String normalize (for flexible import keys)
  function deaccent(str){
    try{
      return String(str||"").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    }catch(e){
      return String(str||"");
    }
  }
  function normKey(k){
    return deaccent(String(k||"").trim().toLowerCase()).replace(/[^a-z0-9]/g, "");
  }
  function pickByNorm(obj, norms){
    if(!obj || typeof obj !== "object") return "";
    const want = new Set((norms||[]).map(normKey));
    for(const key of Object.keys(obj)){
      if(want.has(normKey(key))){
        const v = obj[key];
        if(v!=null && String(v).trim()!=="") return v;
      }
    }
    return "";
  }

  
// ===== Placement helpers (Mục / Câu) for assignments =====
function normalizePlaceGroup(v){
  const s = String(v||"").trim().toLowerCase();
  if(!s) return "";
  const ss = s
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"") // remove accents
    .replace(/\s+/g," ")
    .trim();
  // Common aliases
  if(ss === "1" || ss === "muc1" || ss === "muc 1" || ss.includes("vao/ra") || ss.includes("vao ra") || ss === "io") return "io";
  if(ss === "2" || ss === "muc2" || ss === "muc 2" || ss.includes("if") || ss.includes("cau lenh if")) return "if";
  if(ss === "3" || ss === "muc3" || ss === "muc 3" || ss.includes("for")) return "for";
  if(ss === "4" || ss === "muc4" || ss === "muc 4" || ss.includes("while")) return "while";
  if(ss === "gv" || ss.includes("giao vien") || ss.includes("giao bai") || ss.includes("bai gv")) return "gv";
  if(["io","if","for","while","gv"].includes(ss)) return ss;
  return "";
}
function normalizePlaceIndex(v){
  const n = parseInt(String(v??"").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
// If teacher imports "Mục" + "Câu" for SYSTEM lesson, infer b01..b21
function inferSystemLessonId(placeGroup, placeIndex){
  const g = normalizePlaceGroup(placeGroup);
  const i = normalizePlaceIndex(placeIndex);
  if(!g || !i) return "";
  let num = 0;
  if(g === "io"){ if(i>5) return ""; num = i; }
  if(g === "if"){ if(i>5) return ""; num = 5 + i; }        // b06..b10
  if(g === "for"){ if(i>4) return ""; num = 10 + i; }      // b11..b14
  if(g === "while"){ if(i>7) return ""; num = 14 + i; }    // b15..b21
  if(!num) return "";
  return "b" + String(num).padStart(2,"0");
}

function parseClipboardTable(text){
    // Parse pasted Excel range (TSV/CSV-ish) -> array of row arrays
    const raw = String(text||"").replace(/\r/g, "").split("\n");
    const lines = raw.map(l=>l.trimEnd()).filter(l=>l.trim().length);
    if(!lines.length) return [];
    const splitLine = (line)=>{
      // Excel copy usually uses TAB. Fallback: comma/semicolon.
      if(line.includes("\t")) return line.split("\t");
      if(line.includes(";")) return line.split(";");
      if(line.includes(",")) return splitCSVLine(line);
      // last resort: multiple spaces
      return line.split(/\s{2,}/g);
    };
    return lines.map(splitLine).map(cols=>cols.map(c=>String(c??"").trim()));
  }

  // ===== Multi-teacher workspaces =====
  // - Mỗi GV có 1 namespace riêng: py10:<teacherId>:roster / assignments / teacherBank / ...
  // - HS cũng có session.teacherId để editor đọc đúng dữ liệu GV giao.
  const SESSION_KEY = "py10:session";
  const DEFAULT_TEACHER_ID = "gv";
  const STUDENT_INDEX_KEY = "py10:studentIndex"; // shared index used by login gate

  function _loadSession(){
    try{ return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); }catch(e){ return null; }
  }
  const __sess = _loadSession();
  const TEACHER_ID = (
    (__sess && __sess.role === "teacher" && __sess.id) ? String(__sess.id).trim() :
    (window.parent && window.parent.__TEACHER && window.parent.__TEACHER.id) ? String(window.parent.__TEACHER.id).trim() :
    DEFAULT_TEACHER_ID
  ) || DEFAULT_TEACHER_ID;

  function tKey(suffix){
    const tid = String(TEACHER_ID||DEFAULT_TEACHER_ID).trim() || DEFAULT_TEACHER_ID;
    return `py10:${tid}:${suffix}`;
  }

  const ROSTER_KEY   = tKey("roster");
  const ASSIGN_KEY   = tKey("assignments");
  const BANK_KEY     = tKey("teacherBank");
  const OVERRIDE_KEY = tKey("lessonOverrides");
  const HELP_KEY     = tKey("helpTickets");
  // Teachers list is global (used for login)
  const TEACHERS_KEY = "py10:teachers";

  // ===== Firebase sync (neu co) =====
  // Firebase sync (nếu có) hiện chỉ hỗ trợ 1 lớp (GV mặc định). Các GV khác dùng LocalStorage riêng.
  const FB = (window.py10Firebase && window.py10Firebase.enabled && TEACHER_ID === DEFAULT_TEACHER_ID) ? window.py10Firebase : null;
  let __fbApplying = { roster:false, teachers:false, help:false, assignments:false };

  function __fbRosterToLocal(map){
    try{
      const students = Object.values(map||{}).map(s=>({
        id: String(s.id||""),
        name: s.name||"",
        class: s.class||"",
        createdAt: s.createdAt||"",
        updatedAt: s.updatedAt||"",
      })).filter(s=>s.id);
      const classes = Array.from(new Set(students.map(s=>String(s.class||"").trim()).filter(Boolean))).sort();
      const r = { classes, students, updatedAt: nowISO() };
      __fbApplying.roster = true;
      saveJSON(ROSTER_KEY, r);
      __fbApplying.roster = false;
    }catch(e){ __fbApplying.roster = false; }
  }

  function __fbTeachersToLocal(map){
    try{
      const list = Object.values(map||{}).map(t=>({
        id: String(t.id||""),
        name: t.name||"",
        pw: t.pw||"",
      })).filter(t=>t.id);
      __fbApplying.teachers = true;
      saveJSON(TEACHERS_KEY, list);
      __fbApplying.teachers = false;
    }catch(e){ __fbApplying.teachers = false; }
  }

  function __fbHelpToLocal(map){
    try{
      const list = Object.values(map||{}).filter(x=>x && x.id).sort((a,b)=>(b.ts||0)-(a.ts||0));
      __fbApplying.help = true;
      saveJSON(HELP_KEY, list);
      __fbApplying.help = false;
    }catch(e){ __fbApplying.help = false; }
  }

  function __fbAssignmentsToLocal(map){
    try{
      const list = Object.values(map||{}).filter(x=>x && x.id);
      list.sort((a,b)=>String(b.createdAt||b.created||"").localeCompare(String(a.createdAt||a.created||"")));
      __fbApplying.assignments = true;
      saveJSON(ASSIGN_KEY, list);
      __fbApplying.assignments = false;
    }catch(e){ __fbApplying.assignments = false; }
  }

  function __fbBankToLocal(map){
    try{
      const list = Object.values(map||{}).filter(x=>x && x.id);
      // newest first for GV bank list
      list.sort((a,b)=>String(b.createdAt||b.created||"").localeCompare(String(a.createdAt||a.created||"")));
      saveJSON(BANK_KEY, list);
    }catch(e){}
  }

  function initFirebaseSync(){
    if(!FB || window.__PY10_FB_TEACHER_SYNC_INIT) return;
    window.__PY10_FB_TEACHER_SYNC_INIT = true;
    try{
      FB.listenStudents((map)=>{
        __fbRosterToLocal(map);
        try{ render("roster"); }catch(_){}
        try{ render("overview"); }catch(_){}
        try{ if((localStorage.getItem("py10:teacher:lastView")||"")==="results") render("results"); }catch(_){}
      });
    }catch(e){}
    try{
      FB.listenTeachers((map)=>{
        __fbTeachersToLocal(map);
        try{ render("roster"); }catch(_){}
      });
    }catch(e){}
    try{
      FB.listenHelpTickets((map)=>{
        __fbHelpToLocal(map);
        try{ render("help"); }catch(_){}
      });
    }catch(e){}

    // GV giao bai (assignments) realtime
    try{
      if(typeof FB.listenAssignments === "function"){
        FB.listenAssignments((map)=>{
          __fbAssignmentsToLocal(map);
          try{ render("assign"); }catch(_){}
          try{ if((localStorage.getItem("py10:teacher:lastView")||"")==="overview") render("overview"); }catch(_){}
        });
      }
    }catch(e){}

    // Ngan hang de tu tao (de bai custom)
    try{
      if(typeof FB.listenBank === "function"){
        FB.listenBank((map)=>{
          __fbBankToLocal(map);
          try{ render("assign"); }catch(_){ }
        });
      }
    }catch(e){}

      }

  // ===========================
  // DISCOVER LESSONS FROM editor_v2.html (for system assignments)
  // (Nếu window.LESSONS chưa có, tự đọc PROBLEMS trong editor_v2 để tạo danh sách)
  // ===========================
  async function ensureLessons(){
    try{
      if(Array.isArray(window.LESSONS) && window.LESSONS.length) return;

      // try parent
      try{
        if(window.parent && Array.isArray(window.parent.LESSONS) && window.parent.LESSONS.length){
          window.LESSONS = window.parent.LESSONS;
          return;
        }
      }catch(e){}

      // Fetch editor_v2.html to discover system lessons (BASE_PROBLEMS)
      let text = "";
      try{
        const res = await fetch("./editor_v2.html", { cache: "no-store" });
        text = await res.text();
      }catch(e){
        text = "";
      }

      let body = "";
      if(text){
        let m = text.match(/const\s+BASE_PROBLEMS\s*=\s*\[([\s\S]*?)\]\s*;/);
        if(!m) m = text.match(/const\s+PROBLEMS\s*=\s*\[([\s\S]*?)\]\s*;/); // legacy
        body = m ? m[1] : text;
      }

      const items = [];
      const reItem = /\{\s*id\s*:\s*["']([^"']+)["'][\s\S]*?title\s*:\s*["']([^"']+)["']/g;
      let mm;
      while(body && (mm = reItem.exec(body))){
        items.push({ id: mm[1], title: mm[2] });
      }

      if(items.length){
        window.LESSONS = items;
        try{ if(window.parent) window.parent.LESSONS = items; }catch(e){}
        return;
      }

      // Fallback hardcoded (tránh dropdown rỗng nếu parse thất bại)
            window.LESSONS = [
        {id:"b01", title:"Bài 1: Hello, world!"},
        {id:"b02", title:"Bài 2: Nhập một số nguyên và in ra"},
        {id:"b03", title:"Bài 3: Tên và tuổi hiện tại"},
        {id:"b04", title:"Bài 4: Hình chữ nhật (chu vi, diện tích)"},
        {id:"b05", title:"Bài 5: Trung bình cộng 3 số (làm tròn 2 chữ số)"},
        {id:"b06", title:"Bài 6: Kiểm tra chẵn hay lẻ"},
        {id:"b07", title:"Bài 7: Kiểm tra số âm hay dương"},
        {id:"b08", title:"Bài 8: Chia hết cho 3 và 5"},
        {id:"b09", title:"Bài 9: Kiểm tra tam giác"},
        {id:"b10", title:"Bài 10: Tính tiền điện (không lũy tiến)"},
        {id:"b11", title:"Bài 11: In 10 lần từ hello"},
        {id:"b12", title:"Bài 12: In các số từ 1 đến 100"},
        {id:"b13", title:"Bài 13: In các số chẵn nhỏ hơn 100"},
        {id:"b14", title:"Bài 14: Chia hết cho 3 và 5 trong đoạn [a, b]"},
        {id:"b15", title:"Bài 15: In các ước của n và số lượng ước"},
        {id:"b16", title:"Bài 16: Kiểm tra số nguyên tố"},
        {id:"b17", title:"Bài 17: Tổng 1+2+3+... cho đến khi > 100"},
        {id:"b18", title:"Bài 18: Số hạng lớn nhất của dãy 1,4,7,... ≤ 100"},
        {id:"b19", title:"Bài 19: Tổng và số lượng số chẵn từ 0 đến 99"},
        {id:"b20", title:"Bài 20: Đếm số chữ số của n"},
        {id:"b21", title:"Bài 21: Số nghịch đảo của n"},
      ];
      try{ if(window.parent) window.parent.LESSONS = window.LESSONS; }catch(e){}
    }catch(e){}
  }

// ===== Seed roster from STUDENTS (nếu chưa có) để các chức năng GV hoạt động ngay
  function seedRosterIfEmpty(){
    try{
      // Legacy compatibility (single-class builds): migrate py10:roster -> py10:gv:roster
      if(TEACHER_ID === DEFAULT_TEACHER_ID){
        try{
          const legacy = localStorage.getItem("py10:roster");
          const scoped = localStorage.getItem(ROSTER_KEY);
          if(legacy != null && scoped == null){
            localStorage.setItem(ROSTER_KEY, legacy);
          }
        }catch(e){}
      }

      const r0 = loadJSON(ROSTER_KEY, { classes: [], students: [], updatedAt: nowISO() });
      if(r0 && Array.isArray(r0.students) && r0.students.length) return r0;

      // ✅ Quan trọng: GV KHÁC (không phải gv mặc định) phải là 1 workspace hoàn toàn mới.
      // Không seed danh sách học sinh built-in để tránh "chung với giáo viên cũ".
      if(TEACHER_ID !== DEFAULT_TEACHER_ID){
        const empty = { classes: [], students: [], updatedAt: nowISO(), seededFrom:"empty", teacherId: TEACHER_ID };
        try{ saveJSON(ROSTER_KEY, empty); }catch(e){}
        return empty;
      }

      // Default teacher: seed từ danh sách STUDENTS built-in (không dùng getStudentList vì bản multi-tenant trả về union nhiều lớp)
      let list = [];
      try{ if(window.parent && Array.isArray(window.parent.STUDENTS)) list = window.parent.STUDENTS; }catch(e){}
      if(!Array.isArray(list) || !list.length){
        try{ if(Array.isArray(window.STUDENTS)) list = window.STUDENTS; }catch(e){}
      }
      // Fallback cuối: getStudentList (chỉ dùng nếu không có STUDENTS)
      if(!Array.isArray(list) || !list.length){
        try{ if(window.parent && typeof window.parent.getStudentList === "function") list = window.parent.getStudentList(); }catch(e){}
      }

      if(Array.isArray(list) && list.length){
        const students = list.map(s=>({
          id: String(s.id||"").trim(),
          name: s.name || "",
          class: String(s.class || s.cls || "").trim()
        })).filter(s=>s.id);
        const classes = Array.from(new Set(students.map(s=>s.class).filter(Boolean))).sort();
        const seeded = { classes, students, updatedAt: nowISO(), seededFrom:"builtin", teacherId: TEACHER_ID };
        saveJSON(ROSTER_KEY, seeded);

        // Update student index (để HS đăng nhập không cần chọn lớp/GV)
        try{ updateStudentIndexFromRoster(seeded); }catch(e){}

        // ✅ If Firebase is enabled, also push seeded roster to Firestore once (chỉ hỗ trợ GV mặc định)
        try{
          const seededFlag = "py10:fb:rosterSeeded";
          if(FB){
            const doSeed = async () => {
              try{
                const already = !!localStorage.getItem(seededFlag);
                const emptyNow = !FB._studentsMap || Object.keys(FB._studentsMap).length === 0;
                if(!already || emptyNow){
                  (students||[]).forEach(s=>{ try{ FB.upsertStudent(s); }catch(e){} });
                  try{ localStorage.setItem(seededFlag, "1"); }catch(e){}
                  try{ localStorage.setItem("py10:fb:studentsSynced", JSON.stringify((students||[]).map(x=>String(x.id||"").trim()).filter(Boolean))); }catch(e){}
                }
              }catch(e){}
            };
            try{ doSeed(); }catch(e){}
          }
        }catch(e){}
        return seeded;
      }

      return r0;
    }catch(e){
      return loadJSON(ROSTER_KEY, { classes: [], students: [], updatedAt: nowISO() });
    }
  }

  function loadJSON(key, fallback){
    try{ const v = JSON.parse(localStorage.getItem(key)||"null"); return (v===null||v===undefined)?fallback:v; }catch(e){ return fallback; }
  }
  function saveJSON(key, val){ localStorage.setItem(key, JSON.stringify(val)); }

  // ===== Student index (HS -> GV) =====
  // Dùng để HS đăng nhập chỉ với mã HS nhưng vẫn vào đúng workspace của GV.
  function updateStudentIndexFromRoster(roster){
    try{
      const raw = loadJSON(STUDENT_INDEX_KEY, null);
      let obj = raw;
      if(obj && typeof obj === "object" && obj.map && typeof obj.map === "object"){
        // ok
      } else if(obj && typeof obj === "object"){
        // old shape: directly a map
        obj = { map: obj, updatedAt: null };
      } else {
        obj = { map: {}, updatedAt: null };
      }
      if(!obj.map || typeof obj.map !== "object") obj.map = {};

      const curIds = new Set(
        (roster && Array.isArray(roster.students) ? roster.students : [])
          .map(s=>String((s && s.id) || "").trim())
          .filter(Boolean)
      );

      // remove stale mappings of this teacher
      Object.keys(obj.map).forEach(sid=>{
        if(String(obj.map[sid]||"") === String(TEACHER_ID) && !curIds.has(sid)){
          delete obj.map[sid];
        }
      });

      // add/update current
      curIds.forEach(sid=>{ obj.map[sid] = TEACHER_ID; });

      obj.updatedAt = nowISO();
      saveJSON(STUDENT_INDEX_KEY, obj);
    }catch(e){}
  }

  // ===== Firebase sync (optional) =====
  function fbEnabled(){ return !!FB; }
  function getSyncedProgress(studentId){
    const sid = String(studentId||'').trim();
    if(!sid) return { passed:{} };
    if(fbEnabled()){
      const d = (FB._progressMap || {})[sid] || null;
      if(d && typeof d === 'object'){
        const passed = (d.passed && typeof d.passed==='object') ? d.passed : {};
        return { passed, _fb: d };
      }
    }
    const p = loadJSON(`py10:progress:${sid}`, {passed:{}});
    if(!p.passed || typeof p.passed!=='object') p.passed = {};
    return p;
  }
  function getSyncedLastMeta(studentId){
    const sid = String(studentId||'').trim();
    if(fbEnabled()){
      const d = (FB._progressMap || {})[sid] || null;
      if(d && typeof d === 'object'){
        const lastAt = d.lastAt ? String(d.lastAt).split('T')[0] : '—';
        const lastErr = d.lastErr ? String(d.lastErr).split('\n')[0].slice(0,70) : '—';
        return { lastAt, lastErr };
      }
    }
    const log = loadJSON(`py10:log:${sid}`, {events:[]});
    const events = Array.isArray(log.events) ? log.events : [];
    const last = events.length ? events[events.length-1] : null;
    const lastErr = last && last.err ? String(last.err).split('\n')[0].slice(0,70) : '—';
    const lastAt = last && last.at ? String(last.at).split('T')[0] : '—';
    return { lastAt, lastErr };
  }


  
  
  // ===== Pretest / Trắc nghiệm (ôn luyện) =====
  const PRETESTS = [
    { id:"b1", title:"Ôn luyện Bài 1" },
    { id:"b2", title:"Ôn luyện Bài 2" },
    { id:"b3", title:"Ôn luyện Bài 3" },
    { id:"b4", title:"Ôn luyện Bài 4" },
    { id:"b5", title:"Ôn luyện Bài 5" },
    // Ôn luyện tổng hợp (nút "Ôn luyện" trong editor): trộn câu hỏi Bài 1–5
    { id:"mix", title:"Ôn luyện tổng hợp (Bài 1–5)" },
  ];

  function loadPretestResult(studentId, testId){
    const sid = String(studentId||"").trim();
    const tid = String(testId||"").trim();
    if(!sid || !tid) return null;

    const resultKey = `py10:pretest:${sid}:${tid}:result`;
    const passKey   = `py10:pretest:${sid}:${tid}:passed`;

    let r = loadJSON(resultKey, null);

    // Backward compatible: bản cũ chỉ lưu key :passed khi ĐẠT
    if(!r){
      let raw = null;
      try{ raw = localStorage.getItem(passKey); }catch(e){ raw = null; }
      if(raw){
        try{
          const obj = JSON.parse(raw);
          if(obj && typeof obj === "object"){
            r = {
              passed: !!obj.passed,
              score: (obj.score===undefined || obj.score===null) ? null : Number(obj.score),
              ts: obj.ts || obj.time || obj.at || null,
              attempts: obj.attempts || 1,
              detail: obj.detail || null
            };
          }
        }catch(e){
          // trường hợp raw là "1"/"true"
          if(raw === "1" || raw === "true"){
            r = { passed:true, score:null, ts:null, attempts:1, detail:null };
          }
        }
      }
    }

    // Normalize ts
    if(r && r.ts){
      if(typeof r.ts === "string"){
        const ms = Date.parse(r.ts);
        if(!isNaN(ms)) r.ts = ms;
      }else{
        r.ts = Number(r.ts)||null;
      }
    }
    if(r && r.score !== null && r.score !== undefined && !Number.isFinite(Number(r.score))){
      r.score = null;
    }
    if(r && (r.attempts===undefined || r.attempts===null)) r.attempts = 0;
    return r;
  }

  function pretestSummary(studentId){
    const items = PRETESTS.map(t=>{
      const r = loadPretestResult(studentId, t.id);
      return { id:t.id, title:t.title, r };
    });

    const attempted = items.filter(x=>x.r && (x.r.score!==null || x.r.passed!==undefined || x.r.ts));
    const passed = items.filter(x=>x.r && (x.r.everPassed || x.r.passed)).length;

    let last = null;
    for(const it of attempted){
      const ts = Number(it.r.ts||0);
      if(ts && (!last || ts > last.ts)){
        last = { ts, score: it.r.score, id: it.id };
      }
    }
    return {
      total: PRETESTS.length,
      attempted: attempted.length,
      passed,
      lastTs: last ? last.ts : null,
      lastScore: last ? last.score : null,
      items
    };
  }

  function fmtDateShort(ts){
    if(!ts) return "—";
    try{ return new Date(Number(ts)).toISOString().split("T")[0]; }catch(e){ return "—"; }
  }

// ===== Teachers =====
  function seedTeachersIfEmpty(){
    const list = loadJSON(TEACHERS_KEY, null);
    if(Array.isArray(list) && list.length) return list;
    let base = [];
    try{ if(Array.isArray(window.TEACHERS)) base = window.TEACHERS; }catch(e){}
    if((!Array.isArray(base) || !base.length)){
      // teacher_dashboard.html thường chạy trong iframe => TEACHERS/getTeacherList nằm ở window.parent
      try{ if(window.parent && typeof window.parent.getTeacherList === "function") base = window.parent.getTeacherList(); }catch(e){}
    }
    if((!Array.isArray(base) || !base.length)){
      try{ if(window.parent && Array.isArray(window.parent.TEACHERS)) base = window.parent.TEACHERS; }catch(e){}
    }
    if(!Array.isArray(base) || !base.length){
      base = [{id:"gv", name:"Giáo viên"}];
    }
    const seeded = base.map(x=>({ id:String(x.id||"").trim(), name:x.name||"Giáo viên", pw:String(x.pw||x.pass||x.password||"").trim() })).filter(x=>x.id);
    saveJSON(TEACHERS_KEY, seeded);

    // ✅ If Firebase is enabled, also push seeded teachers to Firestore once
    // so other machines can see teacher accounts.
    try{
      const FB = (window.py10Firebase && window.py10Firebase.enabled) ? window.py10Firebase : null;
      if(FB && !localStorage.getItem("py10:fb:teachersSeeded")){
        (seeded||[]).forEach(t=>{ try{ FB.upsertTeacher(t); }catch(e){} });
        try{ localStorage.setItem("py10:fb:teachersSeeded", "1"); }catch(e){}
        try{ localStorage.setItem("py10:fb:teachersSynced", JSON.stringify((seeded||[]).map(x=>String(x.id||"").trim()).filter(Boolean))); }catch(e){}
      }
    }catch(e){}
    return seeded;
  }
  function getTeachers(){
    const list = seedTeachersIfEmpty();
    return Array.isArray(list)?list:[];
  }
  function saveTeachers(list){
    saveJSON(TEACHERS_KEY, list);
    try{ syncTeachersToFirebase(list); }catch(e){}
  }

  // Neu bat Firebase, day teachers len server (de may khac thay ngay)
  function syncTeachersToFirebase(list){
    if(!FB || __fbApplying.teachers) return;
    try{
      const curIds = new Set((list||[]).map(t=>String(t.id||"").trim()).filter(Boolean));
      const prev = loadJSON("py10:fb:teachersSynced", []);
      const prevIds = new Set((prev||[]).map(String));
      (list||[]).forEach(t=>{ try{ FB.upsertTeacher(t); }catch(e){} });
      prevIds.forEach(id=>{ if(id && !curIds.has(id)) { try{ FB.deleteTeacher(id); }catch(e){} } });
      saveJSON("py10:fb:teachersSynced", Array.from(curIds));
    }catch(e){}
  }

// ===== Data =====
  function getRoster(){
    const r = seedRosterIfEmpty();
    // Không dùng await ở hàm thường (tránh SyntaxError làm hỏng toàn bộ Teacher Dashboard)
    try{ ensureLessons(); }catch(e){}
    r.classes = Array.isArray(r.classes) ? r.classes : [];
    r.students = Array.isArray(r.students) ? r.students : [];
    return r;
  }
  function saveRoster(r){
    r.updatedAt = nowISO();
    // rebuild classes from students if empty
    if(!r.classes || !r.classes.length){
      r.classes = Array.from(new Set(r.students.map(s=>String(s.class||"").trim()).filter(Boolean))).sort();
    }
    saveJSON(ROSTER_KEY, r);
    // Update index so HS login can auto-detect teacher workspace
    try{ updateStudentIndexFromRoster(r); }catch(e){}

    // Neu bat Firebase, dong bo danh sach HS len Firestore
    if(FB && !__fbApplying.roster){
      try{
        const curIds = new Set((r.students||[]).map(s=>String(s.id||"").trim()).filter(Boolean));
        const prev = loadJSON("py10:fb:studentsSynced", []);
        const prevIds = new Set((prev||[]).map(String));
        (r.students||[]).forEach(s=>{ try{ FB.upsertStudent(s); }catch(e){} });
        prevIds.forEach(id=>{ if(id && !curIds.has(id)) { try{ FB.deleteStudent(id); }catch(e){} } });
        saveJSON("py10:fb:studentsSynced", Array.from(curIds));
      }catch(e){}
    }
  }

  function getAssignments(){ return loadJSON(ASSIGN_KEY, []); }
  function saveAssignments(list){
    saveJSON(ASSIGN_KEY, list);
    try{ syncAssignmentsToFirebase(list); }catch(e){}
  }

  // Neu bat Firebase, dong bo bai giao len server (de HS/may khac thay ngay)
  function syncAssignmentsToFirebase(list){
    if(!FB || __fbApplying.assignments || typeof FB.upsertAssignment !== "function") return;
    try{
      const curIds = new Set((list||[]).map(a=>String(a.id||"").trim()).filter(Boolean));
      const prev = loadJSON("py10:fb:assignSynced", []);
      const prevIds = new Set((prev||[]).map(String));
      (list||[]).forEach(a=>{ try{ FB.upsertAssignment(a); }catch(e){} });
      prevIds.forEach(id=>{ if(id && !curIds.has(id)) { try{ FB.deleteAssignment(id); }catch(e){} } });
      saveJSON("py10:fb:assignSynced", Array.from(curIds));
    }catch(e){}
  }

  function getBank(){ return loadJSON(BANK_KEY, []); }
  function saveBank(list){
    saveJSON(BANK_KEY, list);
    try{ syncBankToFirebase(list); }catch(e){}
  }

  // Dong bo ngan hang de bai tu tao (neu co) sang Firestore
  function syncBankToFirebase(list){
    if(!FB || typeof FB.upsertBankLesson !== "function") return;
    try{
      const curIds = new Set((list||[]).map(l=>String(l.id||"").trim()).filter(Boolean));
      const prev = loadJSON("py10:fb:bankSynced", []);
      const prevIds = new Set((prev||[]).map(String));
      (list||[]).forEach(l=>{ try{ FB.upsertBankLesson(l); }catch(e){} });
      prevIds.forEach(id=>{ if(id && !curIds.has(id)) { try{ FB.deleteBankLesson(id); }catch(e){} } });
      saveJSON("py10:fb:bankSynced", Array.from(curIds));
    }catch(e){}
  }

  function getOverrides(){ return loadJSON(OVERRIDE_KEY, { overrides:{} }); }
  function saveOverrides(o){ saveJSON(OVERRIDE_KEY, o); }

  function getHelpTickets(){ return loadJSON(HELP_KEY, []); }
  function saveHelpTickets(list){
    saveJSON(HELP_KEY, list);
    try{ syncHelpToFirebase(list); }catch(e){}
  }

  // Neu bat Firebase, dong bo ticket len server
  function syncHelpToFirebase(list){
    if(!FB || __fbApplying.help) return;
    try{
      const curIds = new Set((list||[]).map(t=>String(t.id||"").trim()).filter(Boolean));
      const prev = loadJSON("py10:fb:helpSynced", []);
      const prevIds = new Set((prev||[]).map(String));
      (list||[]).forEach(t=>{ try{ FB.upsertHelpTicket(t); }catch(e){} });
      prevIds.forEach(id=>{ if(id && !curIds.has(id)) { try{ FB.deleteHelpTicket(id); }catch(e){} } });
      saveJSON("py10:fb:helpSynced", Array.from(curIds));
    }catch(e){}
  }

  // (duplicate removed)

  // ===== UI Shell =====
  function setView(name){
    // 🔒 Disabled per request: hide "Ngân hàng câu hỏi" entirely.
    if(name === "bank") name = "overview";
    const navs = document.querySelectorAll("#teacherRoot .tNav");
    navs.forEach(b=>b.classList.toggle("active", b.dataset.view===name));
    const views = document.querySelectorAll("#teacherRoot .tView");
    views.forEach(v=>v.style.display="none");
    const el = $("tView_"+name);
    if(el) el.style.display="block";
    localStorage.setItem("py10:teacher:lastView", name);
    render(name);
  }

  // ===== Modal =====
  function modal(html){
    const bd = $("tModalBackdrop"), m = $("tModal");
    if(!bd || !m) return;
    bd.style.display="block";
    m.style.display="block";
    m.innerHTML = html;
    const close = closeModal;
    bd.onclick = close;
    const btn = m.querySelector("[data-close]");
    if(btn) btn.addEventListener("click", close);
  }

  // Exposed close helper (used across many dialogs)
  function closeModal(){
    const bd = $("tModalBackdrop"), m = $("tModal");
    if(bd) bd.style.display = "none";
    if(m){
      m.style.display = "none";
      m.innerHTML = "";
    }
  }

  // ===== Helpers =====
  function uid(prefix){ return (prefix||"ID") + "_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16); }

  // ===== Renderers =====
  function renderOverview(){
    const view = $("tView_overview");
    const roster = getRoster();
    const asg = getAssignments().filter(a=>a && a.active!==false);
    const bank = getBank();
    const tickets = getHelpTickets();

    // quick stats: total students, classes, assignments active
    const clsCount = Array.from(new Set(roster.students.map(s=>s.class).filter(Boolean))).length || roster.classes.length;
    const hsCount = roster.students.length;

    view.innerHTML = `
      <div class="tCard">
        <div class="tRow">
          <div>
            <div class="tLabel">Tổng quan</div>
            <div style="font-size:22px; font-weight:900; color:#0b3b7a;">${hsCount} học sinh • ${clsCount} lớp</div>
            <div class="muted" style="margin-top:6px;">Bài đã giao (đang hoạt động): <b>${asg.length}</b> • Đề riêng: <b>${bank.length}</b> • Ticket hỗ trợ: <b>${tickets.length}</b></div>
          </div>
          <div style="min-width:260px;">
            <div class="tLabel">Mẹo triển khai</div>
            <div class="muted">1) Nhập danh sách HS → 2) Giao bài → 3) Xem kết quả & lỗi hay gặp.</div>
          </div>
        </div>
        <div style="margin-top:12px;" class="tRow">
          <button class="btn primary" id="goRoster">Quản lý lớp & học sinh</button>
          <button class="btn ghost" id="goAssign">Giao bài</button>
          <button class="btn ghost" id="goResults">Xem kết quả</button>
          <button class="btn ghost" id="goHelp">Trợ giúp HS</button>
        </div>
      </div>
    `;
    $("goRoster").onclick = ()=>setView("roster");
    $("goAssign").onclick = ()=>setView("assign");
    $("goResults").onclick = ()=>setView("results");
    $("goHelp").onclick = ()=>setView("help");
  }

  
function renderRoster(){
    const view = $("tView_roster");
    const roster = getRoster();

    // union classes from storage + derived from students
    const derived = Array.from(new Set(roster.students.map(s=>String(s.class||"").trim()).filter(Boolean))).sort();
    const stored = Array.isArray(roster.classes)?roster.classes.map(c=>String(c||"").trim()).filter(Boolean):[];
    roster.classes = Array.from(new Set([...stored, ...derived])).sort();
    try{ saveRoster(roster); }catch(e){}

    const tabKey = "py10:teacher:rosterTab";
    const tab = localStorage.getItem(tabKey) || "students";

    const tabBtn = (k, label)=>`<button class="btn ${tab===k?"primary":"ghost"}" data-tab="${k}" style="margin-right:8px;">${label}</button>`;
    const tabs = `
      <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        ${tabBtn("students","Học sinh")}
        ${tabBtn("classes","Lớp")}
        ${tabBtn("teachers","Giáo viên")}
        <div class="muted" style="margin-left:auto;">Dữ liệu lưu LocalStorage • Có thể Sao lưu/Khôi phục</div>
      </div>
      <div class="hr" style="margin:12px 0;"></div>
    `;

    function renderStudents(){
      const q = (window.__tRosterQ||"").toLowerCase().trim();
      const clsFilter = window.__tRosterCls || "";
      const classes = roster.classes;

      const filtered = roster.students.filter(s=>{
        const okCls = !clsFilter || String(s.class||"").trim()===clsFilter;
        const okQ = !q || String(s.id||"").toLowerCase().includes(q) || String(s.name||"").toLowerCase().includes(q);
        return okCls && okQ;
      });

      const rows = filtered.map(s=>`
        <tr>
          <td><span class="tPill">${esc(s.id)}</span></td>
          <td>${esc(s.name||"")}</td>
          <td>${esc(s.class||"")}</td>
          <td style="white-space:nowrap;">
            <button class="btn ghost" data-act="edit" data-id="${esc(s.id)}">Sửa</button>
            <button class="btn ghost" data-act="del" data-id="${esc(s.id)}">Xóa</button>
            <button class="btn ghost" data-act="asStudent" data-id="${esc(s.id)}" title="Đăng nhập thử như học sinh này">Xem như HS</button>
          </td>
        </tr>
      `).join("");

      const classOpts = ['<option value="">Tất cả lớp</option>'].concat(classes.map(c=>`<option value="${esc(c)}" ${c===clsFilter?"selected":""}>${esc(c)}</option>`)).join("");

      return `
        <div class="tCard">
          <div class="tCardTitle">Danh sách học sinh</div>
          <div class="tRow" style="gap:10px; flex-wrap:wrap;">
            <input class="tInput" id="tRosterSearch" placeholder="Tìm theo mã / tên..." value="${esc(window.__tRosterQ||"")}" style="min-width:220px;">
            <select class="tInput" id="tRosterClassFilter" style="min-width:160px;">${classOpts}</select>

            <button class="btn primary" id="tAddStudent">+ Thêm HS</button>
            <button class="btn ghost" id="tPasteStudents">Dán từ Excel</button>
            <button class="btn ghost" id="tExportStudents">Xuất CSV</button>
          </div>

          <div style="margin-top:12px; overflow:auto;">
            <table class="tTable" id="tRosterTable">
              <thead><tr><th>Mã</th><th>Họ tên</th><th>Lớp</th><th>Thao tác</th></tr></thead>
              <tbody>${rows || `<tr><td colspan="4" class="muted">Không tìm thấy.</td></tr>`}</tbody>
            </table>
          </div>

          <div class="muted" style="margin-top:10px;">Gợi ý: Mã HS nên ngắn, không dấu, không khoảng trắng. Bạn có thể <b>Dán từ Excel</b> (copy 2–3 cột rồi paste).</div>
        </div>
      `;
    }

    function renderClasses(){
      const classes = roster.classes;
      const rows = classes.map(c=>`
        <tr>
          <td><span class="tPill">${esc(c)}</span></td>
          <td>${roster.students.filter(s=>String(s.class||"").trim()===c).length}</td>
          <td style="white-space:nowrap;">
            <button class="btn ghost" data-act="delClass" data-id="${esc(c)}">Xóa</button>
          </td>
        </tr>
      `).join("");

      return `
        <div class="tCard">
          <div class="tCardTitle">Quản lý lớp</div>
          <div class="tRow" style="gap:10px; flex-wrap:wrap;">
            <input class="tInput" id="tNewClass" placeholder="Nhập tên lớp (vd: 10A1)" style="min-width:220px;">
            <button class="btn primary" id="tAddClass">+ Thêm lớp</button>

            <label class="btn ghost" for="tImpClasses" style="cursor:pointer;">Import lớp (CSV/XLSX)</label>
            <input id="tImpClasses" type="file" accept=".csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style="display:none;">
            <button class="btn ghost" id="tExportClasses">Xuất CSV</button>
          </div>

          <div class="muted" style="margin-top:8px;">File lớp chỉ cần 1 cột: <b>Lớp</b> hoặc <b>class</b>. Bạn cũng có thể import từ file HS — hệ thống tự lấy danh sách lớp.</div>

          <div style="margin-top:12px; overflow:auto;">
            <table class="tTable" id="tClassTable">
              <thead><tr><th>Lớp</th><th>Số HS</th><th>Thao tác</th></tr></thead>
              <tbody>${rows || `<tr><td colspan="3" class="muted">Chưa có lớp.</td></tr>`}</tbody>
            </table>
          </div>
        </div>
      `;
    }

    function renderTeachers(){
      const teachers = getTeachers();
      const rows = teachers.map(t=>`
        <tr>
          <td><span class="tPill">${esc(t.id)}</span></td>
          <td>${esc(t.name||"")}</td>
          <td>${t.pw ? "<span class='tPill'>Đã đặt</span>" : "<span class='muted'>Mặc định</span>"}</td>
          <td style="white-space:nowrap;">
            <button class="btn ghost" data-act="editT" data-id="${esc(t.id)}">Sửa</button>
            <button class="btn ghost" data-act="delT" data-id="${esc(t.id)}">Xóa</button>
          </td>
        </tr>
      `).join("");

      return `
        <div class="tCard">
          <div class="tCardTitle">Quản lý giáo viên</div>
          <div class="tRow" style="gap:10px; flex-wrap:wrap;">
            <button class="btn primary" id="tAddTeacher">+ Thêm giáo viên</button>
            <div class="muted">Mật khẩu: nếu không đặt, GV dùng mật khẩu mặc định <b>123456</b>.</div>
          </div>

          <div style="margin-top:12px; overflow:auto;">
            <table class="tTable" id="tTeacherTable">
              <thead><tr><th>Mã GV</th><th>Họ tên</th><th>Mật khẩu</th><th>Thao tác</th></tr></thead>
              <tbody>${rows || `<tr><td colspan="4" class="muted">Chưa có giáo viên.</td></tr>`}</tbody>
            </table>
          </div>
        </div>
      `;
    }

    const content = tab==="classes" ? renderClasses() : (tab==="teachers" ? renderTeachers() : renderStudents());
    view.innerHTML = tabs + content;

    // bind tab clicks
    view.querySelectorAll("button[data-tab]").forEach(b=>{
      b.onclick = ()=>{
        localStorage.setItem(tabKey, b.dataset.tab);
        setView("roster");
      };
    });

    // ===== Students tab actions =====
    if(tab==="students"){
      const sSearch = $("tRosterSearch");
      const sCls = $("tRosterClassFilter");
      if(sSearch) sSearch.oninput = ()=>{ window.__tRosterQ = sSearch.value; setView("roster"); };
      if(sCls) sCls.onchange = ()=>{ window.__tRosterCls = sCls.value; setView("roster"); };

      const _btnAddStudent = $("tAddStudent");
      if(_btnAddStudent) _btnAddStudent.onclick = ()=>{
        const isEdit = false;
        modal(`
          <div class="tModalTitle">Thêm học sinh</div>
          <div class="tRow"><div class="tLabel">Mã HS</div><input class="tInput" id="fId" placeholder="vd: hs41"></div>
          <div class="tRow"><div class="tLabel">Họ tên</div><input class="tInput" id="fName" placeholder="Nguyễn Văn A"></div>
          <div class="tRow"><div class="tLabel">Lớp</div><input class="tInput" id="fClass" placeholder="10A1"></div>
          <div class="tRow" style="justify-content:flex-end; gap:8px; margin-top:12px;">
            <button class="btn primary" id="fSave">Thêm</button>
            <button class="btn ghost" data-close>Hủy</button>
          </div>
          <div class="muted" style="margin-top:8px;">Gợi ý: Mã HS nên ngắn, không dấu, không khoảng trắng.</div>
        `);
        $("fSave").onclick = ()=>{
          const id = String($("fId").value||"").trim();
          const name = String($("fName").value||"").trim();
          const cls = String($("fClass").value||"").trim();
          if(!id){ toast("Thiếu mã HS"); return; }
          const r = getRoster();
          if(r.students.some(x=>String(x.id)===id)){ toast("⚠️ Mã HS đã tồn tại"); return; }
          r.students.unshift({id, name, class:cls, createdAt: nowISO()});
          // keep class list
          const classes = Array.isArray(r.classes)?r.classes:[];
          if(cls && !classes.includes(cls)) classes.push(cls);
          r.classes = Array.from(new Set(classes.map(c=>String(c||"").trim()).filter(Boolean))).sort();
          saveRoster(r);
          toast("✅ Đã thêm học sinh");
          closeModal();
          setView("roster");
        };
      };

      // Export students CSV
      const _btnExportStudents = $("tExportStudents");
      if(_btnExportStudents) _btnExportStudents.onclick = ()=>{
        const r = getRoster();
        const head = "id,name,class\n";
        const body = r.students.map(s=>`${csvSafe(s.id)},${csvSafe(s.name)},${csvSafe(s.class)}`).join("\n");
        downloadText("students.csv", head+body);
      };

      // Paste students from Excel (copy range -> paste)
      const btnPaste = $("tPasteStudents");
      if(btnPaste) btnPaste.onclick = ()=>{
        modal(`
          <div class="tModalTitle">Dán danh sách học sinh từ Excel</div>
          <div class="muted" style="margin-top:6px; line-height:1.4;">
            1) Trong Excel, chọn vùng dữ liệu (có thể gồm cả hàng tiêu đề) → <b>Ctrl+C</b><br>
            2) Dán vào ô bên dưới → bấm <b>Import</b><br>
            Hỗ trợ 2–3 cột theo thứ tự: <b>mã học sinh</b>, <b>Họ tên</b>, <b>Lớp</b>.
          </div>
          <textarea class="tInput" id="tPasteArea" style="margin-top:10px; min-height:220px; font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;" placeholder="mã học sinh\tHọ tên\tLớp\nhs01\tLê Tú Anh\t10A1\nhs02\tTrần Lương Gia Bảo\t10A1"></textarea>
          <div class="tRow" style="justify-content:flex-end; gap:8px; margin-top:12px;">
            <button class="btn primary" id="tPasteDo">Import</button>
            <button class="btn ghost" data-close>Hủy</button>
          </div>
        `);
        const ta = $("tPasteArea");
        if(ta) setTimeout(()=>{ try{ ta.focus(); }catch(e){} }, 50);
        $("tPasteDo").onclick = ()=>{
          try{
            const raw = String($("tPasteArea").value||"").trim();
            if(!raw){ toast("Chưa có dữ liệu để import"); return; }
            const table = parseClipboardTable(raw);
            if(!table.length){ toast("Không đọc được dữ liệu (hãy copy từ Excel rồi paste)"); return; }

            // Detect header row (optional)
            const h0 = table[0] || [];
            const hId = normKey(h0[0]||"");
            const hName = normKey(h0[1]||"");
            const looksLikeHeader = (hId.includes("ma") || hId.includes("id")) && (hName.includes("ten") || hName.includes("name") || hName.includes("hoten") || hName.includes("hovaten"));

            const rows = looksLikeHeader ? table.slice(1) : table;
            const addedRows = [];
            for(const r of rows){
              const id = String(r[0]??"").trim();
              const name = String(r[1]??"").trim();
              const cls = String(r[2]??"").trim();
              if(!id) continue;
              addedRows.push({id, name, class: cls});
            }
            if(!addedRows.length){ toast("Không có dòng hợp lệ (thiếu mã HS)"); return; }

            const r0 = getRoster();
            const byId = new Map(r0.students.map(s=>[String(s.id), s]));
            let added=0, skipped=0;
            addedRows.forEach(s=>{
              if(byId.has(String(s.id))){ skipped++; return; }
              byId.set(String(s.id), {id:s.id, name:s.name, class:s.class, createdAt: nowISO()});
              added++;
            });
            r0.students = Array.from(byId.values());
            // update classes
            const clsSet = new Set((r0.classes||[]).map(c=>String(c||"").trim()).filter(Boolean));
            r0.students.forEach(s=>{ const c=String(s.class||"").trim(); if(c) clsSet.add(c); });
            r0.classes = Array.from(clsSet).sort();
            saveRoster(r0);
            toast(`✅ Dán từ Excel xong: +${added} (bỏ qua ${skipped} trùng mã)`);
            closeModal();
            setView("roster");
          }catch(err){
            console.error(err);
            toast("Import từ Excel lỗi: " + (err?.message||err));
          }
        };
      };

      // delegate student actions
      const tbl = $("tRosterTable");
      if(tbl) tbl.onclick = (e)=>{
        const btn = e.target.closest("button[data-act]");
        if(!btn) return;
        const act = btn.dataset.act;
        const id = btn.dataset.id;
        const r = getRoster();
        const s = r.students.find(x=>String(x.id)===String(id));
        if(!s) return;

        if(act==="asStudent"){
          try{
            const sess = { role:"student", id:String(s.id), name:s.name||"", class:s.class||"", teacherId: String(TEACHER_ID||DEFAULT_TEACHER_ID) };
            localStorage.setItem(SESSION_KEY, JSON.stringify(sess));
            // Teacher dashboard thường chạy trong iframe; cần reload ở top-level để chuyển giao diện sang HS.
            const url = new URL(location.href);
            url.pathname = url.pathname.replace(/[^/]+$/, "index.html");
            url.search = "";
            url.hash = "";
            (window.top || window).location.href = url.toString();
          }catch(e){}
          return;
        }
        if(act==="del"){
          if(!confirm("Xóa học sinh "+s.id+"?")) return;
          r.students = r.students.filter(x=>String(x.id)!==String(id));
          saveRoster(r);
          toast("✅ Đã xóa");
          setView("roster");
          return;
        }
        if(act==="edit"){
          modal(`
            <div class="tModalTitle">Sửa học sinh</div>
            <div class="tRow"><div class="tLabel">Mã HS</div><input class="tInput" id="fId" value="${esc(s.id)}" disabled></div>
            <div class="tRow"><div class="tLabel">Họ tên</div><input class="tInput" id="fName" value="${esc(s.name||"")}"></div>
            <div class="tRow"><div class="tLabel">Lớp</div><input class="tInput" id="fClass" value="${esc(s.class||"")}"></div>
            <div class="tRow" style="justify-content:flex-end; gap:8px; margin-top:12px;">
              <button class="btn primary" id="fSave">Lưu</button>
              <button class="btn ghost" data-close>Hủy</button>
            </div>
          `);
          $("fSave").onclick = ()=>{
            s.name = String($("fName").value||"").trim();
            s.class = String($("fClass").value||"").trim();
            // update class list
            const cls = new Set((r.classes||[]).map(c=>String(c||"").trim()).filter(Boolean));
            if(s.class) cls.add(s.class);
            r.classes = Array.from(cls).sort();
            saveRoster(r);
            toast("✅ Đã lưu");
            closeModal();
            setView("roster");
          };
        }
      };
    }

    // ===== Classes tab actions =====
    if(tab==="classes"){
      $("tAddClass").onclick = ()=>{
        const c = String($("tNewClass").value||"").trim();
        if(!c){ toast("Nhập tên lớp"); return; }
        const r = getRoster();
        const cls = new Set((r.classes||[]).map(x=>String(x||"").trim()).filter(Boolean));
        if(cls.has(c)){ toast("Lớp đã tồn tại"); return; }
        cls.add(c);
        r.classes = Array.from(cls).sort();
        saveRoster(r);
        toast("✅ Đã thêm lớp");
        setView("roster");
      };

      $("tExportClasses").onclick = ()=>{
        const r = getRoster();
        const head = "class\n";
        const body = (r.classes||[]).map(c=>csvSafe(c)).join("\n");
        downloadText("classes.csv", head+body);
      };

      $("tImpClasses").onchange = async (ev)=>{
        const file = ev.target.files && ev.target.files[0];
        if(!file) return;
        try{
          let rows = [];
          if(file.name.toLowerCase().endsWith(".csv")){
            const text = await file.text();
            rows = parseCSVRaw(text);
          }else{
            rows = await parseXLSX(file);
          }
          const classes = extractClassesFromRows(rows);
          if(!classes.length){ toast("Không tìm thấy cột Lớp/class trong file"); return; }
          const r0 = getRoster();
          const cls = new Set((r0.classes||[]).map(c=>String(c||"").trim()).filter(Boolean));
          let added=0;
          classes.forEach(c=>{ if(!cls.has(c)){ cls.add(c); added++; } });
          r0.classes = Array.from(cls).sort();
          saveRoster(r0);
          toast(`✅ Import lớp xong: +${added}`);
          setView("roster");
        }catch(err){
          console.error(err);
          toast("Import lớp lỗi: " + (err?.message||err));
        }finally{
          ev.target.value="";
        }
      };

      const tbl = $("tClassTable");
      if(tbl) tbl.onclick = (e)=>{
        const btn = e.target.closest("button[data-act]");
        if(!btn) return;
        if(btn.dataset.act==="delClass"){
          const c = String(btn.dataset.id||"").trim();
          if(!confirm("Xóa lớp "+c+" khỏi danh sách? (Không xóa học sinh)")) return;
          const r = getRoster();
          r.classes = (r.classes||[]).map(x=>String(x||"").trim()).filter(x=>x && x!==c);
          saveRoster(r);
          toast("✅ Đã xóa lớp");
          setView("roster");
        }
      };
    }

    // ===== Teachers tab actions =====
    if(tab==="teachers"){
      $("tAddTeacher").onclick = ()=>{
        modal(`
          <div class="tModalTitle">Thêm giáo viên</div>
          <div class="tRow"><div class="tLabel">Mã GV</div><input class="tInput" id="tId" placeholder="vd: gv1"></div>
          <div class="tRow"><div class="tLabel">Họ tên</div><input class="tInput" id="tName" placeholder="Giáo viên A"></div>
          <div class="tRow"><div class="tLabel">Mật khẩu</div><input class="tInput" id="tPw" placeholder="Để trống = 123456"></div>
          <div class="tRow" style="justify-content:flex-end; gap:8px; margin-top:12px;">
            <button class="btn primary" id="tSave">Thêm</button>
            <button class="btn ghost" data-close>Hủy</button>
          </div>
        `);
        $("tSave").onclick = ()=>{
          const id = String($("tId").value||"").trim();
          const name = String($("tName").value||"").trim();
          const pw = String($("tPw").value||"").trim();
          if(!id){ toast("Thiếu mã GV"); return; }
          const list = getTeachers();
          if(list.some(x=>String(x.id)===id)){ toast("Mã GV đã tồn tại"); return; }
          list.push({id, name, pw});
          saveTeachers(list);

          // ✅ Mỗi GV có workspace riêng (lớp riêng). Khởi tạo dữ liệu trống để GV mới không dùng chung lớp cũ.
          try{
            const tid = String(id||"").trim();
            if(tid){
              const rk = `py10:${tid}:roster`;
              const ak = `py10:${tid}:assignments`;
              const bk = `py10:${tid}:teacherBank`;
              const ok = `py10:${tid}:lessonOverrides`;
              const hk = `py10:${tid}:helpTickets`;
              if(localStorage.getItem(rk) == null) localStorage.setItem(rk, JSON.stringify({classes:[], students:[], updatedAt: nowISO(), seededFrom:"empty", teacherId: tid}));
              if(localStorage.getItem(ak) == null) localStorage.setItem(ak, "[]");
              if(localStorage.getItem(bk) == null) localStorage.setItem(bk, "[]");
              if(localStorage.getItem(ok) == null) localStorage.setItem(ok, JSON.stringify({overrides:{}}));
              if(localStorage.getItem(hk) == null) localStorage.setItem(hk, "[]");
            }
          }catch(e){}

          toast("✅ Đã thêm giáo viên");
          closeModal();
          setView("roster");
        };
      };

      const tbl = $("tTeacherTable");
      if(tbl) tbl.onclick = (e)=>{
        const btn = e.target.closest("button[data-act]");
        if(!btn) return;
        const id = String(btn.dataset.id||"").trim();
        const list = getTeachers();
        const t0 = list.find(x=>String(x.id)===id);
        if(!t0) return;

        if(btn.dataset.act==="delT"){
          if(!confirm("Xóa giáo viên "+id+"?")) return;
          const next = list.filter(x=>String(x.id)!==id);
          saveTeachers(next);
          toast("✅ Đã xóa giáo viên");
          setView("roster");
        }
        if(btn.dataset.act==="editT"){
          modal(`
            <div class="tModalTitle">Sửa giáo viên</div>
            <div class="tRow"><div class="tLabel">Mã GV</div><input class="tInput" id="tId" value="${esc(t0.id)}" disabled></div>
            <div class="tRow"><div class="tLabel">Họ tên</div><input class="tInput" id="tName" value="${esc(t0.name||"")}"></div>
            <div class="tRow"><div class="tLabel">Mật khẩu</div><input class="tInput" id="tPw" value="${esc(t0.pw||"")}" placeholder="Để trống = 123456"></div>
            <div class="tRow" style="justify-content:flex-end; gap:8px; margin-top:12px;">
              <button class="btn primary" id="tSave">Lưu</button>
              <button class="btn ghost" data-close>Hủy</button>
            </div>
          `);
          $("tSave").onclick = ()=>{
            t0.name = String($("tName").value||"").trim();
            t0.pw = String($("tPw").value||"").trim();
            saveTeachers(list);
            toast("✅ Đã lưu");
            closeModal();
            setView("roster");
          };
        }
      };
    }
  }

  
  function csvSafe(v){
    const s = String(v??"");
    if(/[",\n]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
    return s;
  }
  function downloadText(filename, text){
    const blob = new Blob([text], {type:"text/plain;charset=utf-8"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function parseCSVRaw(text){
    const lines = String(text||"").replace(/\r/g,"").split("\n").filter(l=>l.trim().length);
    if(!lines.length) return [];
    const head = splitCSVLine(lines[0]).map(h=>h.trim());
    const out = [];
    for(let i=1;i<lines.length;i++){
      const cols = splitCSVLine(lines[i]);
      const row = {};
      head.forEach((h,idx)=>row[h]=cols[idx]??"");
      out.push(row);
    }
    return out;
  }
  function extractClassesFromRows(rows){
    const keys = ["class","Class","CLASS","lop","Lop","LỚP","Lớp","lớp","Ten lop","Tên lớp","ten lop","TÊN LỚP","Tên Lop","ClassName","classname"];
    const out = new Set();
    (rows||[]).forEach(r=>{
      if(r==null) return;
      if(typeof r === "string"){ 
        const c = r.trim(); if(c) out.add(c); return;
      }
      if(typeof r !== "object") return;
      let c = "";
      for(const k of keys){
        if(r[k]!=null && String(r[k]).trim()){ c = String(r[k]).trim(); break; }
      }
      if(!c){
        const vals = Object.values(r).map(v=>String(v||"").trim()).filter(Boolean);
        if(vals.length===1) c = vals[0];
      }
      if(c) out.add(c);
    });
    return Array.from(out).map(s=>String(s).trim()).filter(Boolean).sort();
  }

function parseCSV(text){
    const lines = String(text||"").replace(/\r/g,"").split("\n").filter(l=>l.trim().length);
    if(!lines.length) return [];
    const head = splitCSVLine(lines[0]).map(h=>h.trim());
    const out = [];
    for(let i=1;i<lines.length;i++){
      const cols = splitCSVLine(lines[i]);
      const row = {};
      head.forEach((h,idx)=>row[h]=cols[idx]??"");
      // normalize common names
      out.push(row);
    }
    return out.map(r=>{
      // map to canonical (but keep original too)
      const obj = Object.assign({}, r);
      // Be flexible with headers exported from Excel
      // (Ví dụ: "mã học sinh" / "Mã HS" / "ma_hs" / "ID" ...)
      obj.id = r.id || r.ID || r["Mã HS"] || r["mã học sinh"] || r["Mã học sinh"] || r["ma hs"] || r["ma_hs"] ||
               pickByNorm(r, [
                 "mahs","mahocsinh","mahocvien","masinhvien","masv","mhs","id","code"
               ]) || "";
      obj.name = r.name || r["Họ tên"] || r["Họ và tên"] || r["ho ten"] || r["ho va ten"] || r.ten ||
                 pickByNorm(r, ["hoten","hovaten","name","ten"]) || "";
      obj.class = r.class || r["Lớp"] || r["lop"] || r.lop || pickByNorm(r, ["class","lop","tenlop","classname"]) || "";
      return obj;
    });
  }
  function splitCSVLine(line){
    const res = [];
    let cur = "", inQ = false;
    for(let i=0;i<line.length;i++){
      const ch = line[i];
      if(ch === '"'){ inQ = !inQ; continue; }
      if(ch === "," && !inQ){ res.push(cur); cur=""; continue; }
      cur += ch;
    }
    res.push(cur);
    return res.map(s=>s.trim());
  }

  // ===== Header normalization (Excel/CSV import)
  // Excel header thường có dấu/viết hoa khác nhau (vd: "mã học sinh", "Mã HS", "Ho ten", ...)
  // => normalize để map ổn định.
  function normKey(s){
    return String(s||"")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // bỏ dấu
      .replace(/[^a-z0-9]+/g, "");       // bỏ khoảng trắng/ký tự đặc biệt
  }
  function normRow(row){
    const m = {};
    try{
      Object.keys(row||{}).forEach(k=>{ m[normKey(k)] = row[k]; });
    }catch(e){}
    return m;
  }
  function pick(row, directKeys, normKeys){
    // 1) direct
    for(const k of (directKeys||[])){
      if(row && Object.prototype.hasOwnProperty.call(row, k)){
        const v = row[k];
        if(v!==null && v!==undefined && String(v).trim()!=="") return v;
      }
    }
    // 2) normalized
    const m = normRow(row);
    for(const nk of (normKeys||[])){
      const v = m[nk];
      if(v!==null && v!==undefined && String(v).trim()!=="") return v;
    }
    return "";
  }

  async function ensureXLSX(){
    if(window.XLSX) return;
    await new Promise((resolve, reject)=>{
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
      s.onload = resolve;
      s.onerror = ()=>reject(new Error("Không tải được thư viện XLSX (cần mạng)"));
      document.head.appendChild(s);
    });
  }
  async function parseXLSX(file){
    await ensureXLSX();
    const buf = await file.arrayBuffer();
    const wb = window.XLSX.read(buf, {type:"array"});
    const ws = wb.Sheets[wb.SheetNames[0]];
    const json = window.XLSX.utils.sheet_to_json(ws, {defval:""});
    return json;
  }

  // XLSX -> table (array-of-arrays), dùng cho import không có header (ví dụ mẫu 2 cột)
  async function parseXLSXTable(file){
    await ensureXLSX();
    const buf = await file.arrayBuffer();
    const wb = window.XLSX.read(buf, {type:"array"});
    const ws = wb.Sheets[wb.SheetNames[0]];
    const arr = window.XLSX.utils.sheet_to_json(ws, {header:1, defval:""});
    return arr;
  }


  function renderAssign(){
    const view = $("tView_assign");
    const roster = getRoster();
    const bank = getBank();
    const assigns = getAssignments();

    const classes = Array.from(new Set([...(roster.classes||[]).map(c=>String(c||"").trim()).filter(Boolean), ...roster.students.map(s=>String(s.class||"").trim()).filter(Boolean)])).sort();
    const lessonOptions = (window.LESSONS||[]).map(l=>`<option value="${esc(l.id)}">${esc(l.id)} — ${esc(l.title)}</option>`).join("");
    const customOptions = bank.map(l=>`<option value="${esc(l.id)}">${esc(l.id)} — ${esc(l.title)}</option>`).join("");

    const assignRows = assigns.map(a=>{
      const tgt = a.targetType==="class" ? ("Lớp "+a.targetValue) :
                  (a.targetType==="students" ? ("HS: "+(a.targets||[]).length) : "Tất cả");
      const kind = (a.kind==="custom") ? "Đề riêng" : "Bài hệ thống";
      const active = a.active===false ? "<span class='tPill'>Tạm tắt</span>" : "<span class='tPill'>Đang hoạt động</span>";

const place = (()=>{
  const g = normalizePlaceGroup(a.placeGroup || a.group || a.muc || a['Mục'] || a['mục'] || "");
  const idx = normalizePlaceIndex(a.placeIndex || a.cau || a['Câu'] || a['câu'] || "");
  const gl = (g==="io") ? "Mục 1" :
             (g==="if") ? "Mục 2" :
             (g==="for") ? "Mục 3" :
             (g==="while") ? "Mục 4" :
             (g==="gv") ? "GV giao" : "";
  if(gl && idx) return `${gl} • Câu ${idx}`;
  if(gl && !idx) return gl;
  if(!gl && idx) return `Câu ${idx}`;
  return "—";
})();
      return `<tr>
        <td>${esc(a.title||"")}</td>
        <td><span class="tPill">${esc(a.lessonId)}</span></td>
        <td>${esc(kind)}</td>
        <td>${esc(tgt)}</td>
        <td>${a.due?esc(a.due.split("T")[0]):"—"}</td>
        <td>${esc(place)}</td>
        <td>${active}</td>
        <td style="white-space:nowrap;">
          <button class="btn ghost" data-act="toggle" data-id="${esc(a.id)}">${a.active===false?"Bật":"Tắt"}</button>
          <button class="btn ghost" data-act="del" data-id="${esc(a.id)}">Xóa</button>
        </td>
      </tr>`;
    }).join("");

    view.innerHTML = `
      <div class="tCard">
        <div class="tLabel">Giao bài</div>
        <div class="muted">Giao bài hệ thống hoặc đề riêng. Bạn có thể chọn <b>Vị trí (Mục)</b> + <b>Câu số</b> để chèn bài GV vào đúng chỗ trong lộ trình. Nếu để trống, bài sẽ nằm trong nhóm <b>GV giao</b> ở cuối danh sách. <span class="muted">Lưu ý: nếu chèn bài vào giữa lộ trình, học sinh sẽ cần PASS bài đó để mở các bài sau.</span></div>

        <div style="margin-top:12px;" class="tRow">
          <div style="min-width:280px;">
            <div class="tLabel">Chọn loại</div>
            <select class="tIn" id="aKind">
              <option value="system">Bài hệ thống (A1…)</option>
              <option value="custom">Đề riêng (GV tạo)</option>
            </select>
          </div>
          <div style="min-width:340px;">
            <div class="tLabel">Bài/Đề</div>
            <select class="tIn" id="aLesson">
              ${lessonOptions || `<option value="">(Không có)</option>`}
            </select>
            <select class="tIn" id="aCustom" style="display:none; margin-top:8px;">
              ${customOptions || `<option value="">(Chưa có đề riêng)</option>`}
            </select>
          </div>
          <div style="min-width:260px;">
            <div class="tLabel">Tiêu đề hiển thị</div>
            <input class="tIn" id="aTitle" placeholder="VD: BTVN tuần 2 - vòng lặp">
          </div>
        </div>

        <div class="tRow" style="margin-top:10px;">
          <div style="min-width:260px;">
            <div class="tLabel">Giao cho</div>
            <select class="tIn" id="aTargetType">
              <option value="all">Tất cả học sinh</option>
              <option value="class">Theo lớp</option>
              <option value="students">Chọn học sinh</option>
            </select>
          </div>
          <div style="min-width:260px;" id="aTargetValueWrap">
            <div class="tLabel">Lớp</div>
            <select class="tIn" id="aTargetValue">
              ${classes.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("") || `<option value="">(Chưa có lớp)</option>`}
            </select>
          </div>
          <div style="min-width:420px; display:none;" id="aTargetsWrap">
            <div class="tLabel">Danh sách mã HS (ngăn cách bởi dấu phẩy)</div>
            <input class="tIn" id="aTargets" placeholder="hs1, hs2, hs3">
          </div>
          <div style="min-width:220px;">
            <div class="tLabel">Hạn nộp</div>
            <input class="tIn" id="aDue" type="date">
          </div>
<div style="min-width:240px;">
  <div class="tLabel">Vị trí (Mục)</div>
  <select class="tIn" id="aPlaceGroup">
    <option value="">(Mặc định: Nhóm GV giao)</option>
    <option value="io">Mục 1 (Vào/ra)</option>
    <option value="if">Mục 2 (if)</option>
    <option value="for">Mục 3 (for)</option>
    <option value="while">Mục 4 (while)</option>
    <option value="gv">Nhóm GV giao</option>
  </select>
</div>
<div style="min-width:180px;">
  <div class="tLabel">Câu số</div>
  <input class="tIn" id="aPlaceIndex" type="number" min="1" placeholder="VD: 3">
</div>
        </div>

        <div style="margin-top:10px;">
          <div class="tLabel">Ghi chú (tuỳ chọn)</div>
          <textarea class="tIn" id="aNote" placeholder="VD: Không dùng len(), ưu tiên while."></textarea>
        </div>

        <div class="tRow" style="margin-top:10px;">
          <button class="btn primary" id="aCreate">Giao bài</button>
          <button class="btn ghost" id="aGoBank">Tạo đề riêng</button>
          <label class="btn ghost" for="aImportAssign" style="cursor:pointer;">Import giao bài (CSV/XLSX)</label>
          <input id="aImportAssign" type="file" accept=".csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style="display:none;">
        </div>

        <div style="margin-top:14px; overflow:auto;">
          <div class="tLabel">Danh sách bài đã giao</div>
          <table class="tTable" id="aTable">
            <thead><tr><th>Tiêu đề</th><th>Mã</th><th>Loại</th><th>Đối tượng</th><th>Hạn</th><th>Vị trí</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
            <tbody>${assignRows || `<tr><td colspan="7" class="muted">Chưa có bài giao.</td></tr>`}</tbody>
          </table>
        </div>
      </div>
    `;

    // kind switch
    const aKind = $("aKind");
    const selLesson = $("aLesson");
    const selCustom = $("aCustom");
    aKind.onchange = ()=>{
      const isCustom = aKind.value==="custom";
      selLesson.style.display = isCustom ? "none":"block";
      selCustom.style.display = isCustom ? "block":"none";
    };

    // target switch
    const tType = $("aTargetType");
    const wrapVal = $("aTargetValueWrap");
    const wrapTargets = $("aTargetsWrap");

    // mặc định: giao theo lớp đầu tiên (nếu có) để HS nhìn thấy ngay trong Bài tập về nhà
    try{
      if(classes && classes.length){
        tType.value = "class";
        const inp = $("aTargetValue");
        if(inp && !String(inp.value||"").trim()) inp.value = classes[0];
      }else{
        tType.value = "all";
      }
    }catch(e){}
    tType.onchange = ()=>{
      wrapVal.style.display = (tType.value==="class") ? "block":"none";
      wrapTargets.style.display = (tType.value==="students") ? "block":"none";
      if(tType.value==="all"){ wrapVal.style.display="none"; wrapTargets.style.display="none"; }
    };
    try{ tType.onchange(); }catch(e){}
    tType.onchange();

    $("aGoBank").onclick = ()=>{
      // Tạo đề riêng NGAY TẠI trang Giao bài (không cần Ngân hàng câu hỏi).
      const newId = "T" + Date.now().toString().slice(-6);
      modal(`
        <button class="btn ghost tClose" data-close>Đóng</button>
        <h3>Tạo đề giáo viên (đề riêng)</h3>

        <div class="tLabel">Mã đề (ID)</div>
        <input class="tIn" id="cId" value="${esc(newId)}">

        <div class="tLabel">Tiêu đề</div>
        <input class="tIn" id="cTitle" placeholder="Ví dụ: Bài GV tuần 1" value="">

        <div class="tLabel">Đề bài</div>
        <textarea class="tIn" id="cText" placeholder="Mô tả bài toán..." style="min-height:120px;"></textarea>

        <div class="tRow" style="margin-top:10px;">
          <div>
            <div class="tLabel">Sample Input</div>
            <textarea class="tIn" id="cSampleIn" style="min-height:70px;"></textarea>
          </div>
          <div>
            <div class="tLabel">Sample Output (Expected)</div>
            <textarea class="tIn" id="cSampleOut" style="min-height:70px;"></textarea>
          </div>
        </div>

        <div class="tLabel">Starter code (tuỳ chọn)</div>
        <textarea class="tIn" id="cStarter" placeholder="# TODO\n" style="min-height:90px;"></textarea>

        <div class="tRow" style="margin-top:12px;">
          <button class="btn primary" id="cSave">Lưu đề</button>
          <button class="btn ghost" data-close>Hủy</button>
        </div>

        <div class="muted" style="margin-top:10px; line-height:1.5;">
          Sau khi lưu, bạn chọn đề ở mục <b>Đề riêng</b> và bấm <b>Giao bài</b>.
          Học sinh sẽ thấy đề này ở danh sách bài <b>sau 21 bài có sẵn</b> (bắt đầu từ <b>Bài 22</b>).
        </div>
      `);

      $("cSave").onclick = ()=>{
        const id = String($("cId").value||"").trim();
        const title = String($("cTitle").value||"").trim() || ("Đề GV " + id);
        const text = String($("cText").value||"").trim();
        const sampleIn = String($("cSampleIn").value||"");
        const sampleOut = String($("cSampleOut").value||"");
        const starter = String($("cStarter").value||"") || "# TODO\n";

        if(!id){ toast("Thiếu mã đề"); return; }
        if(!text){ toast("Thiếu nội dung đề bài"); return; }
        if(!sampleOut.trim()){
          // Vẫn cho lưu, nhưng cảnh báo (vì chấm PASS/FAIL cần expected)
          if(!confirm("Bạn chưa nhập Sample Output (Expected).\nBài có thể không chấm PASS/FAIL đúng.\nBạn vẫn muốn lưu?") ) return;
        }

        const obj = {
          id,
          title,
          short: "Bài giáo viên",
          skill: "Giáo viên",
          text,
          input: "",
          output: "",
          sampleIn,
          sampleOut,
          starter,
          rules: { require: [], forbid: [] },
          tests: [{ stdin: sampleIn, expected: sampleOut, note: "GV" }],
          createdAt: nowISO(),
          updatedAt: nowISO(),
        };

        const list = getBank();
        const idx = list.findIndex(x=>x && x.id===id);
        if(idx>=0){
          // preserve createdAt if editing same id
          obj.createdAt = list[idx].createdAt || obj.createdAt;
          list[idx] = obj;
        }else{
          list.unshift(obj);
        }
        saveBank(list);

        try{ localStorage.setItem("py10:lastCustomForAssign", id); }catch(e){}
        toast("✅ Đã lưu đề. Chọn đề này rồi bấm 'Giao bài'.");
        $("tModalBackdrop").click();
        setView("assign");
      };
    };

    $("aCreate").onclick = ()=>{
      const kind = aKind.value;
      const lessonId = (kind==="custom" ? String(selCustom.value||"").trim() : String(selLesson.value||"").trim());
      if(!lessonId){ toast("Chưa chọn bài/đề"); return; }
      const title = String($("aTitle").value||"").trim() || (kind==="custom" ? "Đề riêng " + lessonId : "Bài " + lessonId);
      const due = $("aDue").value ? ($("aDue").value + "T23:59:59") : "";
      const note = String($("aNote").value||"").trim();

const placeGroup = normalizePlaceGroup($("aPlaceGroup") ? $("aPlaceGroup").value : "") || "";
const placeIndex = normalizePlaceIndex($("aPlaceIndex") ? $("aPlaceIndex").value : "") || "";
      const targetType = tType.value;
      const targetValue = String($("aTargetValue").value||"").trim();
      if(targetType==="class" && !targetValue){ toast("⚠️ Chọn lớp để giao bài."); return; }
      const targets = String($("aTargets").value||"").split(",").map(s=>s.trim()).filter(Boolean);

      const a = {
        id: uid("AS"),
        kind,
        lessonId,
        title,
        due,
        note,
        targetType: targetType==="students" ? "students" : (targetType==="class" ? "class":"all"),
        targetValue: targetType==="class" ? targetValue : "",
        targets: targetType==="students" ? targets : [],
        placeGroup,
        placeIndex,
        active: true,
        createdAt: nowISO()
      };
      const list = getAssignments();
      list.unshift(a);
      saveAssignments(list);
      toast("✅ Đã giao bài");
      setView("assign");
    };

      // Import assignments (CSV/XLSX)
      $("aImportAssign").onchange = async (ev)=>{
        const file = ev.target.files && ev.target.files[0];
        ev.target.value = "";
        if(!file) return;
        try{
          let rows = [];
          if((file.name||"").toLowerCase().endsWith(".csv")){
            const text = await file.text();
            rows = parseCSV(text);
          }else{
            rows = await parseXLSX(file);
          }

          const lessonIds = new Set((window.LESSONS||[]).map(l=>String(l.id)));
          const customIds = new Set(getBank().map(l=>String(l.id)));

          const pick = (obj, keys)=>{
            for(const k of keys){
              if(obj && Object.prototype.hasOwnProperty.call(obj,k) && String(obj[k]).trim()!=="") return obj[k];
            }
            // also try case-insensitive match
            const lower = {};
            Object.keys(obj||{}).forEach(key=>lower[key.toLowerCase()] = obj[key]);
            for(const k of keys){
              const v = lower[String(k).toLowerCase()];
              if(v!==undefined && String(v).trim()!=="") return v;
            }
            return "";
          };

          const normDate = (v)=>{
            if(!v) return "";
            if(v instanceof Date && !isNaN(v.getTime())){
              const y=v.getFullYear(), m=String(v.getMonth()+1).padStart(2,"0"), d=String(v.getDate()).padStart(2,"0");
              return `${y}-${m}-${d}`;
            }
            // excel serial date
            if(typeof v==="number" && isFinite(v) && v>20000){
              const utcDays = Math.floor(v - 25569);
              const ms = utcDays * 86400 * 1000;
              const dt = new Date(ms);
              if(!isNaN(dt.getTime())){
                const y=dt.getUTCFullYear(), m=String(dt.getUTCMonth()+1).padStart(2,"0"), d=String(dt.getUTCDate()).padStart(2,"0");
                return `${y}-${m}-${d}`;
              }
            }
            const s = String(v).trim();
            // yyyy-mm-dd
            if(/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)){
              const [y,mm,dd]=s.split("-");
              return `${y}-${String(mm).padStart(2,"0")}-${String(dd).padStart(2,"0")}`;
            }
            // dd/mm/yyyy
            if(/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)){
              const [dd,mm,y]=s.split("/");
              return `${y}-${String(mm).padStart(2,"0")}-${String(dd).padStart(2,"0")}`;
            }
            return s; // fallback
          };

          const parseTargets = (v)=>{
            const s = String(v||"").trim();
            if(!s) return [];
            return s.split(/[,;\n]/).map(x=>x.trim()).filter(Boolean);
          };

          const normalizeKind = (v)=>{
            const s = String(v||"").toLowerCase().trim();
            if(["custom","đề riêng","de rieng","derieng","t","teacher"].some(x=>s===x) || s.includes("đề") || s.includes("de")) return "custom";
            return "system";
          };

          const normalizeTargetType = (v)=>{
            const s = String(v||"").toLowerCase().trim();
            if(s.startsWith("class") || s.includes("lớp") || s.includes("lop")) return "class";
            if(s.startsWith("student") || s.includes("hs") || s.includes("học sinh") || s.includes("hoc sinh")) return "students";
            if(s==="all" || s.includes("tất cả") || s.includes("tat ca")) return "all";
            return s || "all";
          };

          const assignsNow = getAssignments();
          const created = [];
          const rejected = [];
          rows.forEach((r, idx)=>{
            const kind = normalizeKind(pick(r, ["kind","loại","Loai","type","Type"]));
            let lessonId = String(pick(r, ["lessonId","lesson","Mã","ma","code","id","ID","bài","Bài","de","Đề"])).trim();
            const title = String(pick(r, ["title","Tiêu đề","tieu de","name","Tên"])).trim();
            const due = normDate(pick(r, ["due","Hạn","han","deadline","Deadline","dueDate"]));
            const note = String(pick(r, ["note","Ghi chú","ghi chu","Note"])).trim();
            const targetType = normalizeTargetType(pick(r, ["targetType","Giao cho","giao cho","Target","Đối tượng","doi tuong"]));
            const targetValue = String(pick(r, ["targetValue","Lớp","lop","class","Class"])).trim();
            const targets = parseTargets(pick(r, ["targets","Danh sách HS","ds hs","students","Students","mã hs","ma hs"]));

const placeGroup = normalizePlaceGroup(pick(r, ["placeGroup","Mục","mục","muc","group","chapter","Chương","chuong"])) || "";
const placeIndex = normalizePlaceIndex(pick(r, ["placeIndex","Câu","câu","cau","question","pos","order","stt","STT"])) || "";
            const activeRaw = String(pick(r, ["active","Trạng thái","trang thai","status","Status"])).trim().toLowerCase();

// AUTO_CREATE_BANK_FROM_IMPORT:
// Nếu file import có đầy đủ nội dung đề (text/sampleOut...), và là đề riêng,
// thì tự tạo/cập nhật teacherBank để học sinh có thể làm ngay.
const probText = String(pick(r,
  ["text","statement","Đề bài","de bai","noi dung","Nội dung","content","Content","questionText","Question"],
  ["text","statement","debai","noidung","content","questiontext","question"]
) || "");
const probSampleIn = String(pick(r,
  ["sampleIn","Sample Input","stdin","input","Input","SampleIn"],
  ["samplein","sampleinput","stdin","input"]
) || "");
const probSampleOut = String(pick(r,
  ["sampleOut","Sample Output","expected","output","Output","SampleOut"],
  ["sampleout","sampleoutput","expected","output"]
) || "");
const probStarter = String(pick(r,
  ["starter","starterCode","Starter","code","Code"],
  ["starter","startercode","code"]
) || "");

// Optional multi-tests: stdin1/expected1 ... stdin5/expected5
const probTests = [];
for(let ti=1; ti<=5; ti++){
  const tin = String(pick(r,
    [`stdin${ti}`,`input${ti}`,`in${ti}`],
    [`stdin${ti}`,`input${ti}`,`in${ti}`]
  ) || "");
  const tex = String(pick(r,
    [`expected${ti}`,`output${ti}`,`out${ti}`],
    [`expected${ti}`,`output${ti}`,`out${ti}`]
  ) || "");
  if((tin && String(tin).trim()!=="") || (tex && String(tex).trim()!=="")){
    probTests.push({ stdin: tin, expected: tex, note: `T${ti}` });
  }
}

const hasBankContent = !!(String(probText).trim() || String(probSampleOut).trim() || String(probStarter).trim() || probTests.length);
if(kind==="custom" && lessonId && hasBankContent){
  try{
    const bankList = getBank();
    const idxB = bankList.findIndex(x=>x && String(x.id).trim()===lessonId);
    const now = nowISO();
    const bankObj = {
      id: lessonId,
      title: title || (`Đề GV ${lessonId}`),
      short: "Bài giáo viên",
      skill: "Giáo viên",
      text: probText || "Đề bài (import từ Excel)",
      sampleIn: probSampleIn,
      sampleOut: probSampleOut,
      starter: probStarter || "# TODO\n",
      tests: probTests.length ? probTests.map(x=>({ stdin:x.stdin, expected:x.expected, note:x.note })) : [{ stdin: probSampleIn, expected: probSampleOut, note:"GV" }],
      createdAt: now,
      updatedAt: now,
    };
    if(idxB>=0){
      bankObj.createdAt = bankList[idxB].createdAt || bankObj.createdAt;
      bankList[idxB] = Object.assign({}, bankList[idxB], bankObj);
    }else{
      bankList.unshift(bankObj);
    }
    saveBank(bankList);
    // refresh set for validation
    customIds.add(lessonId);
  }catch(e){}
}
            const active = activeRaw==="" ? true : !(activeRaw==="0" || activeRaw==="false" || activeRaw.includes("tắt") || activeRaw.includes("tat"));

// Nếu không có lessonId mà có Mục/Câu (đặc biệt khi import bài hệ thống),
// thử suy ra lessonId theo lộ trình mặc định: io(b01-05), if(b06-10), for(b11-14), while(b15-21)
if(!lessonId && kind==="system"){
  const inferred = inferSystemLessonId(placeGroup, placeIndex);
  if(inferred) lessonId = inferred;
}

            if(!lessonId){
              rejected.push({row: idx+2, reason: "Thiếu mã bài/đề (cột Mã/lessonId) hoặc không suy ra được từ Mục/Câu."});
              return;
            }
            if(kind==="system" && !lessonIds.has(lessonId)){
              rejected.push({row: idx+2, reason: `Không tìm thấy bài hệ thống "${lessonId}".`});
              return;
            }
            if(kind==="custom" && !customIds.has(lessonId)){
              rejected.push({row: idx+2, reason: `Không tìm thấy đề riêng "${lessonId}" (hãy tạo đề trước).`});
              return;
            }

            const tt = (targetType==="students") ? "students" : (targetType==="class" ? "class" : "all");
            if(tt==="class" && !targetValue){
              rejected.push({row: idx+2, reason: "Giao theo lớp nhưng thiếu cột Lớp/targetValue."});
              return;
            }
            if(tt==="students" && (!targets || !targets.length)){
              rejected.push({row: idx+2, reason: "Giao theo học sinh nhưng thiếu danh sách mã HS (targets)." });
              return;
            }

            created.push({
              id: uid("AS"),
              kind,
              lessonId,
              placeGroup,
              placeIndex,
              title: title || (kind==="system" ? (lessonId) : lessonId),
              due,
              note,
              targetType: tt,
              targetValue: tt==="class" ? targetValue : "",
              targets: tt==="students" ? targets : [],
              active
            });
          });

          if(created.length){
            saveAssignments([...assignsNow, ...created]);
          }

          if(created.length && !rejected.length){
            toast(`✅ Đã import ${created.length} bài giao.`);
          }else if(created.length && rejected.length){
            toast(`⚠️ Import ${created.length} dòng OK, ${rejected.length} dòng lỗi.`);
            console.warn("Import assignments rejected:", rejected);
          }else{
            toast(`⚠️ Không import được dòng nào. Kiểm tra file.`);
            console.warn("Import assignments rejected:", rejected);
          }

          renderAssign();
        }catch(err){
          console.error(err);
          toast("❌ Import giao bài thất bại: " + (err && err.message ? err.message : String(err)));
        }
      };


    // table actions
    $("aTable").onclick = (e)=>{
      const btn = e.target.closest("button[data-act]");
      if(!btn) return;
      const id = btn.dataset.id;
      const list = getAssignments();
      const idx = list.findIndex(x=>x && x.id===id);
      if(idx<0) return;
      if(btn.dataset.act==="del"){
        if(!confirm("Xóa bài đã giao?")) return;
        list.splice(idx,1);
        saveAssignments(list);
        setView("assign");
      }
      if(btn.dataset.act==="toggle"){
        list[idx].active = (list[idx].active===false) ? true : false;
        saveAssignments(list);
        setView("assign");
      }
    };
  }

  function renderResults(){
    const view = $("tView_results");
    const roster = getRoster();
    const students = roster.students;
    const assigns = getAssignments().filter(a=>a && a.active!==false);

    // Build quick summary per student from progress/log
    const rows = students.map(s=>{
      const prog = getSyncedProgress(s.id);
      const passedCount = prog && prog.passed ? Object.keys(prog.passed).length : 0;

      const meta = getSyncedLastMeta(s.id);
      const lastErr = meta.lastErr;
      const lastAt = meta.lastAt;

      const pt = pretestSummary(s.id);
      const ptCount = pt.attempted ? `${pt.passed}/${pt.total}` : '—';
      const ptScore = (pt.lastScore===null || pt.lastScore===undefined || !Number.isFinite(Number(pt.lastScore))) ? '—' : Number(pt.lastScore).toFixed(2);

      return `<tr>
        <td><span class="tPill">${esc(s.id)}</span></td>
        <td>${esc(s.name||"")}</td>
        <td>${esc(s.class||"")}</td>
        <td>${passedCount}</td>
        <td>${esc(ptCount)}</td>
        <td>${esc(ptScore)}</td>
        <td>${esc(lastAt)}</td>
        <td class="muted">${esc(lastErr)}</td>
        <td style="white-space:nowrap;">
          <button class="btn ghost" data-act="detail" data-id="${esc(s.id)}">Chi tiết</button>
        </td>
      </tr>`;
    }).join("");

    view.innerHTML = `
      <div class="tCard">
        <div class="tLabel">Kết quả</div>
        <div class="muted">Xem PASS/FAIL (code), kết quả trắc nghiệm (TN), lỗi gần nhất. (Dữ liệu lấy từ log/progress/trắc nghiệm trên máy đang mở.)</div>

        <div style="margin-top:10px;" class="tRow">
          <input class="tIn" id="rSearch" style="max-width:320px" placeholder="Tìm HS theo mã/tên/lớp">
          <button class="btn ghost" id="rExport">Xuất CSV tổng hợp</button>
          <span class="muted">Bài đang giao: <b>${assigns.length}</b></span>
        </div>

        <div style="margin-top:12px; overflow:auto;">
          <table class="tTable" id="rTable">
            <thead><tr><th>Mã</th><th>Họ tên</th><th>Lớp</th><th>PASS</th><th>TN</th><th>Điểm TN</th><th>Gần nhất</th><th>Lỗi gần nhất</th><th></th></tr></thead>
            <tbody>${rows || `<tr><td colspan="9" class="muted">Chưa có học sinh.</td></tr>`}</tbody>
          </table>
        </div>
      </div>
    `;

    $("rSearch").oninput = ()=>{
      const q = $("rSearch").value.trim().toLowerCase();
      const tbody = view.querySelector("#rTable tbody");
      const list = !q ? students : students.filter(s=>{
        return (String(s.id||"").toLowerCase().includes(q) ||
                String(s.name||"").toLowerCase().includes(q) ||
                String(s.class||"").toLowerCase().includes(q));
      });
      tbody.innerHTML = list.map(s=>{
        const prog = getSyncedProgress(s.id);
        const passedCount = prog && prog.passed ? Object.keys(prog.passed).length : 0;
        const meta = getSyncedLastMeta(s.id);
        const lastErr = meta.lastErr;
        const lastAt = meta.lastAt;
        const pt = pretestSummary(s.id);
        const ptCount = pt.attempted ? `${pt.passed}/${pt.total}` : '—';
        const ptScore = (pt.lastScore===null || pt.lastScore===undefined || !Number.isFinite(Number(pt.lastScore))) ? '—' : Number(pt.lastScore).toFixed(2);
        return `<tr>
          <td><span class="tPill">${esc(s.id)}</span></td>
          <td>${esc(s.name||"")}</td>
          <td>${esc(s.class||"")}</td>
          <td>${passedCount}</td>
          <td>${esc(ptCount)}</td>
          <td>${esc(ptScore)}</td>
          <td>${esc(lastAt)}</td>
          <td class="muted">${esc(lastErr)}</td>
          <td style="white-space:nowrap;"><button class="btn ghost" data-act="detail" data-id="${esc(s.id)}">Chi tiết</button></td>
        </tr>`;
      }).join("") || `<tr><td colspan="9" class="muted">Không tìm thấy.</td></tr>`;
    };

    $("rExport").onclick = ()=>{
      const csvHead = "id,name,class,passedCount,pretestPassed,pretestTotal,pretestLastScore,pretestLastDate,lastDate,lastError";
      const csvRows = students.map(s=>{
        const prog = getSyncedProgress(s.id);
        const passedCount = prog && prog.passed ? Object.keys(prog.passed).length : 0;
        const meta = getSyncedLastMeta(s.id);
        const lastErr = (meta.lastErr||"").replace(/,/g," ");
        const lastAt = (meta.lastAt||"");
        const pt = pretestSummary(s.id);
        const ptPassed = pt.passed;
        const ptTotal = pt.total;
        const ptLastScore = (pt.lastScore===null || pt.lastScore===undefined || !Number.isFinite(Number(pt.lastScore))) ? "" : Number(pt.lastScore).toFixed(2);
        const ptLastDate = pt.lastTs ? fmtDateShort(pt.lastTs) : "";
        return `${s.id},${(s.name||"").replace(/,/g," ")},${(s.class||"").replace(/,/g," ")},${passedCount},${ptPassed},${ptTotal},${ptLastScore},${ptLastDate},${lastAt},${lastErr}`;
      });
      const csv = [csvHead, ...csvRows].join("\n");
      const blob = new Blob(["\ufeff", csv], {type:"text/csv;charset=utf-8"});
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "ket_qua_tong_hop.csv";
      a.click();
      setTimeout(()=>{ try{ URL.revokeObjectURL(a.href); }catch(e){} }, 1000);
    };

    $("rTable").onclick = (e)=>{
      const btn = e.target.closest("button[data-act='detail']");
      if(!btn) return;
      const id = btn.dataset.id;
      const s = students.find(x=>String(x.id)===String(id));
      if(!s) return;
      const prog = getSyncedProgress(s.id);
      const log = loadJSON(`py10:log:${s.id}`, {events:[]});
      const events = Array.isArray(log.events) ? log.events.slice(-30).reverse() : [];
      const passList = prog && prog.passed ? Object.keys(prog.passed).sort() : [];
      const pt = pretestSummary(s.id);
      const preRows = (pt.items||[]).map(it=>{
        const r = it.r || null;
        const ok = r ? (r.passed ? "✅" : "❌") : "—";
        const sc = (r && r.score!==null && r.score!==undefined && Number.isFinite(Number(r.score))) ? Number(r.score).toFixed(2) : "—";
        const at = (r && r.ts) ? fmtDateShort(r.ts) : "—";
        const attempts = r ? (Number(r.attempts||0)||0) : 0;
        return `<tr><td><span class="tPill">${esc(it.id)}</span></td><td>${esc(it.title)}</td><td>${esc(ok)}</td><td>${esc(sc)}</td><td>${esc(at)}</td><td>${esc(String(attempts))}</td></tr>`;
      }).join("") || `<tr><td colspan="6" class="muted">Chưa có dữ liệu trắc nghiệm.</td></tr>`;

      modal(`
        <button class="btn ghost tClose" data-close>Đóng</button>
        <h3>Chi tiết: ${esc(s.name||s.id)} <span class="tPill">${esc(s.id)}</span></h3>
        <div class="muted">Lớp: <b>${esc(s.class||"")}</b> • PASS: <b>${passList.length}</b></div>

        <div style="margin-top:10px;" class="tLabel">Danh sách PASS</div>
        <div class="muted" style="line-height:1.6;">${passList.map(x=>`<span class="tPill">${esc(x)}</span>`).join(" ") || "—"}</div>

        <div style="margin-top:12px;" class="tLabel">Kiểm tra trắc nghiệm (ôn luyện)</div>
        <div style="overflow:auto; border:1px solid rgba(10,70,160,.12); border-radius:12px; padding:10px;">
          <table class="tTable">
            <thead><tr><th>ID</th><th>Bài</th><th>Đạt</th><th>Điểm</th><th>Ngày</th><th>Lần</th></tr></thead>
            <tbody>${preRows}</tbody>
          </table>
        </div>

        <div style="margin-top:12px;" class="tLabel">Log gần đây</div>
        <div style="max-height:44vh; overflow:auto; border:1px solid rgba(10,70,160,.12); border-radius:12px; padding:10px;">
          ${events.map(ev=>{
            const at = ev.at ? String(ev.at).replace("T"," ").slice(0,16) : "";
            const act = ev.act || "run";
            const ok = ev.ok ? "✅" : "❌";
            const err = ev.err ? esc(String(ev.err).split("\n")[0]) : "";
            const lid = ev.lessonId ? `<span class="tPill">${esc(ev.lessonId)}</span>` : "";
            return `<div style="margin-bottom:8px;"><b>${ok} ${esc(act)}</b> ${lid} <span class="muted">${esc(at)}</span><div class="muted">${err||"—"}</div></div>`;
          }).join("") || `<div class="muted">Chưa có log.</div>`}
        </div>
      `);
    };
  }

  function renderBank(){
    const view = $("tView_bank");
    const bank = getBank();
    const overrides = getOverrides();
    const sysLessons = (window.LESSONS||[]);

    const customRows = bank.map(l=>`
      <tr>
        <td><span class="tPill">${esc(l.id)}</span></td>
        <td>${esc(l.title||"")}</td>
        <td class="muted">${esc((l.text||"").slice(0,80))}${(l.text||"").length>80?"…":""}</td>
        <td style="white-space:nowrap;">
          <button class="btn ghost" data-act="editCustom" data-id="${esc(l.id)}">Sửa</button>
          <button class="btn ghost" data-act="delCustom" data-id="${esc(l.id)}">Xóa</button>
        </td>
      </tr>
    `).join("");

    const sysRows = sysLessons.slice(0,120).map(l=>{
      const ov = overrides.overrides && overrides.overrides[l.id] ? overrides.overrides[l.id] : null;
      const req = ov?.require?.join(", ") || "";
      const forb = ov?.forbid?.join(", ") || "";
      const hint = ov?.hint || "";
      return `<tr>
        <td><span class="tPill">${esc(l.id)}</span></td>
        <td>${esc(l.title)}</td>
        <td class="muted">${esc(req||"—")}</td>
        <td class="muted">${esc(forb||"—")}</td>
        <td style="white-space:nowrap;"><button class="btn ghost" data-act="editSys" data-id="${esc(l.id)}">Rules/Hints</button></td>
      </tr>`;
    }).join("");

    view.innerHTML = `
      <div class="tCard">
        <div class="tLabel">Ngân hàng câu hỏi</div>
        <div class="muted">Đề riêng chỉ hiển thị trong “Bài tập về nhà”. Với bài hệ thống, GV có thể thêm rules/hints (require/forbid) để chấm sát đề.</div>

        <div style="margin-top:12px;" class="tRow">
          <button class="btn primary" id="bNew">+ Tạo đề riêng</button>
          <label class="btn ghost" for="bImportCustom" style="cursor:pointer;">Import đề riêng (CSV/XLSX)</label>
          <input id="bImportCustom" type="file" accept=".csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style="display:none;">
          <button class="btn ghost" id="bResetOv">Xóa rules/hints đã chỉnh (bài hệ thống)</button>
        </div>

        <div style="margin-top:14px;" class="tLabel">Đề riêng (GV tạo)</div>
        <div style="overflow:auto;">
          <table class="tTable" id="bCustomTable">
            <thead><tr><th>Mã</th><th>Tiêu đề</th><th>Mô tả</th><th></th></tr></thead>
            <tbody>${customRows || `<tr><td colspan="4" class="muted">Chưa có đề riêng.</td></tr>`}</tbody>
          </table>
        </div>

        <div style="margin-top:18px;" class="tLabel">Rules/Hints cho bài hệ thống</div>
        <div style="overflow:auto;">
          <table class="tTable" id="bSysTable">
            <thead><tr><th>Mã</th><th>Tiêu đề</th><th>Require</th><th>Forbid</th><th></th></tr></thead>
            <tbody>${sysRows || `<tr><td colspan="5" class="muted">Không có bài hệ thống.</td></tr>`}</tbody>
          </table>
        </div>
      </div>
    `;

    function openCustomForm(existing){
      const isEdit = !!existing;
      const id = existing?.id || ("T" + Date.now().toString().slice(-6));
      modal(`
        <button class="btn ghost tClose" data-close>Đóng</button>
        <h3>${isEdit?"Sửa đề riêng":"Tạo đề riêng"}</h3>

        <div class="tLabel">Mã đề (ID)</div>
        <input class="tIn" id="cId" ${isEdit?"disabled":""} value="${esc(id)}">

        <div class="tLabel">Tiêu đề</div>
        <input class="tIn" id="cTitle" value="${esc(existing?.title||"")}">

        <div class="tRow" style="margin-top:10px;">
          <div>
            <div class="tLabel">Input mô tả</div>
            <input class="tIn" id="cInputDesc" value="${esc(existing?.input||"")}">
          </div>
          <div>
            <div class="tLabel">Output mô tả</div>
            <input class="tIn" id="cOutputDesc" value="${esc(existing?.output||"")}">
          </div>
        </div>

        <div class="tLabel">Đề bài</div>
        <textarea class="tIn" id="cText" placeholder="Mô tả bài toán...">${esc(existing?.text||"")}</textarea>

        <div class="tRow" style="margin-top:10px;">
          <div>
            <div class="tLabel">Sample Input</div>
            <textarea class="tIn" id="cSampleIn" style="min-height:70px;">${esc(existing?.sampleIn||"")}</textarea>
          </div>
          <div>
            <div class="tLabel">Sample Output</div>
            <textarea class="tIn" id="cSampleOut" style="min-height:70px;">${esc(existing?.sampleOut||"")}</textarea>
          </div>
        </div>

        <div class="tRow" style="margin-top:10px;">
          <div>
            <div class="tLabel">Require (phân tách bằng dấu phẩy)</div>
            <input class="tIn" id="cRequire" placeholder="while, if" value="${esc((existing?.rules?.require||[]).join(", "))}">
          </div>
          <div>
            <div class="tLabel">Forbid (phân tách bằng dấu phẩy)</div>
            <input class="tIn" id="cForbid" placeholder="len, sum" value="${esc((existing?.rules?.forbid||[]).join(", "))}">
          </div>
        </div>

        <div class="tLabel">Starter code (tuỳ chọn)</div>
        <textarea class="tIn" id="cStarter" placeholder="Khung code...">${esc(existing?.starter||"")}</textarea>

        <div class="tRow" style="margin-top:12px;">
          <button class="btn primary" id="cSave">${isEdit?"Lưu":"Tạo"}</button>
          <button class="btn ghost" data-close>Hủy</button>
        </div>
        <div class="muted" style="margin-top:8px;">Gợi ý: Đề riêng chỉ hiện trong “Bài tập về nhà” khi bạn giao bài.</div>
      `);

      $("cSave").onclick = ()=>{
        const l = {
          id: String($("cId").value||"").trim(),
          title: String($("cTitle").value||"").trim() || ("Đề riêng " + id),
          short: "Bài tập về nhà",
          skill: "Giáo viên",
          text: String($("cText").value||"").trim(),
          input: String($("cInputDesc").value||"").trim(),
          output: String($("cOutputDesc").value||"").trim(),
          sampleIn: String($("cSampleIn").value||""),
          sampleOut: String($("cSampleOut").value||""),
          starter: String($("cStarter").value||""),
          rules: {
            require: String($("cRequire").value||"").split(",").map(s=>s.trim()).filter(Boolean),
            forbid: String($("cForbid").value||"").split(",").map(s=>s.trim()).filter(Boolean),
          },
          tests: [{ stdin: String($("cSampleIn").value||""), expected: String($("cSampleOut").value||""), note:"GV" }],
          createdAt: existing?.createdAt || nowISO(),
          updatedAt: nowISO(),
        };
        if(!l.id){ toast("Thiếu mã đề"); return; }
        const list = getBank();
        const idx = list.findIndex(x=>x && x.id===l.id);
        if(idx>=0) list[idx]=l; else list.unshift(l);
        saveBank(list);
        toast("✅ Đã lưu đề riêng");
        $("tModalBackdrop").click();
        setView("bank");
      };
    }

    $("bNew").onclick = ()=>openCustomForm(null);

    // Import đề riêng (teacher bank) từ CSV/XLSX.
    // Hỗ trợ cả file mẫu 2 cột không header: [Câu/ID] | [Nội dung bài]
    $("bImportCustom").onchange = async (ev)=>{
      const file = ev.target.files && ev.target.files[0];
      ev.target.value = "";
      if(!file) return;
      try{
        let table = [];
        if((file.name||"").toLowerCase().endsWith(".csv")){
          const text = await file.text();
          const ls = String(text||"").replace(/\r/g,"").split("\n").filter(l=>l.trim().length);
          table = ls.map(l=>splitCSVLine(l));
        }else{
          table = await parseXLSXTable(file);
        }
        table = (table||[]).map(r=>Array.isArray(r)?r:[]);

        const headerKeys = ["id","mã","ma","code","title","tiêu đề","tieu de","question","câu hỏi","cau hoi","prompt","nội dung","noi dung","text","bài tập","bai tap"];
        const head = (table[0]||[]).map(x=>String(x||"").trim().toLowerCase());
        const hasHeader = head.length && head.some(h=>headerKeys.some(k=>h===k || h.includes(k)));

        const findIdx = (keys)=>{
          const lower = head.map(h=>h.toLowerCase());
          for(const k of keys){
            const i = lower.findIndex(h=>h===k || h.includes(k));
            if(i>=0) return i;
          }
          return -1;
        };

        const idxId = hasHeader ? findIdx(["id","mã","ma","code"]) : -1;
        const idxTitle = hasHeader ? findIdx(["title","tiêu đề","tieu de","name","tên"]) : -1;
        const idxText = hasHeader ? findIdx(["text","question","câu hỏi","cau hoi","prompt","nội dung","noi dung","content"]) : -1;

        const guessTitle = (txt)=>{
          const s = String(txt||"").trim();
          if(!s) return "";
          const m = s.match(/^(.*?)(?:\s+(?:Viết\s+chương\s+trình|Viết\s+program|Hãy\s+viết|hãy\s+viết|Nhập\s+vào))/i);
          if(m && m[1]){
            const t = String(m[1]).trim();
            if(t.length>=4 && t.length<=80) return t;
          }
          const dot = s.indexOf(".");
          if(dot>10 && dot<90) return s.slice(0,dot).trim();
          return "";
        };

        const normId = (raw, fallback)=>{
          let s = String(raw||"").trim();
          if(!s) return fallback;
          try{
            s = s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/đ/g,"d").replace(/Đ/g,"D");
          }catch(e){}
          s = s.replace(/[^a-zA-Z0-9]+/g,"").toUpperCase();
          return s || fallback;
        };

        const existing = getBank();
        const byId = new Map(existing.map(x=>[String(x.id), x]));
        const newIds = new Set();
        const updatedIds = new Set();
        const newItems = [];
        const rejected = [];

        const rows = hasHeader ? table.slice(1) : table;
        rows.forEach((r, ridx)=>{
          const row = Array.isArray(r) ? r : [];
          const rawId = hasHeader ? row[idxId] : row[0];
          const rawTitle = hasHeader ? row[idxTitle] : "";
          const rawText = hasHeader ? row[idxText] : row[1];

          const text = String(rawText ?? "").trim();
          if(!text){
            rejected.push({row: ridx+1 + (hasHeader?1:0), reason:"Thiếu nội dung bài."});
            return;
          }

          const baseFallback = "T" + Date.now().toString().slice(-6) + String(ridx+1);
          let id = normId(rawId || rawTitle || guessTitle(text), baseFallback);
          // tránh trùng ID khi import nhiều dòng giống nhau
          let finalId = id;
          let k = 2;
          while(byId.has(finalId) && !byId.get(finalId)){ k++; finalId = id + "_" + k; }
          // nếu đã có sẵn -> update; nếu chưa -> new
          const title = String(rawTitle||"").trim() || guessTitle(text) || String(rawId||"").trim() || ("Đề riêng " + finalId);

          const obj = {
            id: finalId,
            title,
            short: "Bài tập về nhà",
            skill: "Giáo viên",
            text,
            input: "",
            output: "",
            sampleIn: "",
            sampleOut: "",
            starter: "",
            rules: { require: [], forbid: [] },
            tests: [{ stdin:"", expected:"", note:"GV" }],
            createdAt: nowISO(),
            updatedAt: nowISO(),
          };

          if(byId.has(finalId)){
            const old = byId.get(finalId);
            obj.createdAt = old.createdAt || obj.createdAt;
            byId.set(finalId, Object.assign({}, old, obj, { createdAt: obj.createdAt, updatedAt: nowISO() }));
            updatedIds.add(finalId);
          }else{
            byId.set(finalId, obj);
            newItems.unshift(obj);
            newIds.add(finalId);
          }
        });

        const rest = existing.filter(x=>x && !newIds.has(String(x.id)) && !updatedIds.has(String(x.id)));
        const updatedInOrder = existing.filter(x=>x && updatedIds.has(String(x.id))).map(x=>byId.get(String(x.id)));
        const finalList = [...newItems, ...updatedInOrder, ...rest];

        if(finalList.length){
          saveBank(finalList);
        }

        const ok = newIds.size + updatedIds.size;
        if(ok){
          if(rejected.length){
            toast(`⚠️ Import OK ${ok} dòng (mới:${newIds.size}, cập nhật:${updatedIds.size}), lỗi:${rejected.length}.`);
            console.warn("Import bank rejected:", rejected);
          }else{
            toast(`✅ Đã import ${ok} đề riêng (mới:${newIds.size}, cập nhật:${updatedIds.size}).`);
          }
          setView("bank");
        }else{
          toast("⚠️ Không import được dòng nào. Kiểm tra file.");
          console.warn("Import bank rejected:", rejected);
        }
      }catch(err){
        console.error(err);
        toast("❌ Import đề riêng thất bại: " + (err && err.message ? err.message : String(err)));
      }
    };


    $("bResetOv").onclick = ()=>{
      if(!confirm("Xóa toàn bộ rules/hints đã chỉnh cho bài hệ thống?")) return;
      saveOverrides({overrides:{}});
      toast("🧹 Đã xóa");
      setView("bank");
    };

    // custom actions
    $("bCustomTable").onclick = (e)=>{
      const btn = e.target.closest("button[data-act]");
      if(!btn) return;
      const id = btn.dataset.id;
      const list = getBank();
      const l = list.find(x=>x && x.id===id);
      if(!l) return;
      if(btn.dataset.act==="editCustom") openCustomForm(l);
      if(btn.dataset.act==="delCustom"){
        if(!confirm("Xóa đề riêng?")) return;
        saveBank(list.filter(x=>x && x.id!==id));
        toast("🗑️ Đã xóa");
        setView("bank");
      }
    };

    // system rules/hints
    $("bSysTable").onclick = (e)=>{
      const btn = e.target.closest("button[data-act='editSys']");
      if(!btn) return;
      const id = btn.dataset.id;
      const o = getOverrides();
      const cur = (o.overrides && o.overrides[id]) ? o.overrides[id] : {require:[], forbid:[], hint:""};
      modal(`
        <button class="btn ghost tClose" data-close>Đóng</button>
        <h3>Rules/Hints: ${esc(id)}</h3>
        <div class="muted">Các rule này chỉ nhằm chấm sát đề (require/forbid). Không đổi UI học sinh.</div>

        <div class="tLabel">Require (phân tách bằng dấu phẩy)</div>
        <input class="tIn" id="sReq" value="${esc((cur.require||[]).join(", "))}">

        <div class="tLabel">Forbid (phân tách bằng dấu phẩy)</div>
        <input class="tIn" id="sForb" value="${esc((cur.forbid||[]).join(", "))}">

        <div class="tLabel">Hint bổ sung (tuỳ chọn)</div>
        <textarea class="tIn" id="sHint" placeholder="Gợi ý thêm cho bài này...">${esc(cur.hint||"")}</textarea>

        <div class="tRow" style="margin-top:12px;">
          <button class="btn primary" id="sSave">Lưu</button>
          <button class="btn ghost" id="sClear">Xóa rule/hint</button>
        </div>
      `);
      $("sSave").onclick = ()=>{
        const req = String($("sReq").value||"").split(",").map(s=>s.trim()).filter(Boolean);
        const forb = String($("sForb").value||"").split(",").map(s=>s.trim()).filter(Boolean);
        const hint = String($("sHint").value||"").trim();
        const o2 = getOverrides();
        o2.overrides = o2.overrides || {};
        o2.overrides[id] = { require:req, forbid:forb, hint };
        saveOverrides(o2);
        toast("✅ Đã lưu rule/hint");
        $("tModalBackdrop").click();
        setView("bank");
      };
      $("sClear").onclick = ()=>{
        const o2 = getOverrides();
        if(o2.overrides) delete o2.overrides[id];
        saveOverrides(o2);
        toast("🧹 Đã xóa");
        $("tModalBackdrop").click();
        setView("bank");
      };
    };
  }

  function renderHelp(){
    const view = $("tView_help");
    const tickets = getHelpTickets().slice().sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
    const roster = getRoster();
    const mapS = new Map(roster.students.map(s=>[String(s.id), s]));

    const rows = tickets.map(t=>{
      const s = mapS.get(String(t.studentId||""));
      const cls = t.class || s?.class || "";
      const status = t.status || "open";
      const pill = status==="done" ? "<span class='tPill'>Đã xử lý</span>" : "<span class='tPill'>Mới</span>";
      return `<tr>
        <td>${pill}</td>
        <td><span class="tPill">${esc(t.studentId||"")}</span> ${esc(t.studentName||s?.name||"")}</td>
        <td>${esc(cls)}</td>
        <td><span class="tPill">${esc(t.lessonId||"")}</span></td>
        <td class="muted">${esc(String(t.message||"").slice(0,70))}${String(t.message||"").length>70?"…":""}</td>
        <td>${t.createdAt?esc(String(t.createdAt).replace("T"," ").slice(0,16)):"—"}</td>
        <td style="white-space:nowrap;">
          <button class="btn ghost" data-act="view" data-id="${esc(t.id)}">Xem</button>
          <button class="btn ghost" data-act="done" data-id="${esc(t.id)}">${status==="done"?"Mở lại":"Đánh dấu xong"}</button>
        </td>
      </tr>`;
    }).join("");

    view.innerHTML = `
      <div class="tCard">
        <div class="tLabel">Trợ giúp học sinh</div>
        <div class="muted">Hiển thị ticket học sinh gửi từ nút Trợ giúp. Bạn có thể xem code/lỗi và trả lời.</div>

        <div style="margin-top:12px; overflow:auto;">
          <table class="tTable" id="hTable">
            <thead><tr><th>Trạng thái</th><th>Học sinh</th><th>Lớp</th><th>Bài</th><th>Nội dung</th><th>Thời gian</th><th></th></tr></thead>
            <tbody>${rows || `<tr><td colspan="7" class="muted">Chưa có ticket.</td></tr>`}</tbody>
          </table>
        </div>
        <div class="muted" style="margin-top:10px;">Lưu ý: ticket lưu theo trình duyệt/máy đang mở.</div>
      </div>
    `;

    $("hTable").onclick = (e)=>{
      const btn = e.target.closest("button[data-act]");
      if(!btn) return;
      const id = btn.dataset.id;
      const list = getHelpTickets();
      const idx = list.findIndex(x=>x && x.id===id);
      if(idx<0) return;
      const t = list[idx];

      if(btn.dataset.act==="done"){
        t.status = (t.status==="done") ? "open" : "done";
        t.updatedAt = nowISO();
        list[idx]=t;
        saveHelpTickets(list);
        setView("help");
        return;
      }
      if(btn.dataset.act==="view"){
        const code = t.code || "";
        const err = t.error || "";
        modal(`
          <button class="btn ghost tClose" data-close>Đóng</button>
          <h3>Ticket: ${esc(t.studentName||t.studentId||"")}</h3>
          <div class="muted">Bài: <span class="tPill">${esc(t.lessonId||"")}</span> • Lúc: ${esc(String(t.createdAt||"").replace("T"," ").slice(0,16))}</div>

          <div class="tLabel">Nội dung</div>
          <div style="border:1px solid rgba(10,70,160,.12); border-radius:12px; padding:10px;" class="muted">${esc(t.message||"")}</div>

          <div class="tLabel" style="margin-top:12px;">Lỗi (nếu có)</div>
          <pre style="white-space:pre-wrap; border:1px solid rgba(10,70,160,.12); border-radius:12px; padding:10px; margin:0;">${esc(err||"—")}</pre>

          <div class="tLabel" style="margin-top:12px;">Code</div>
          <pre style="white-space:pre-wrap; border:1px solid rgba(10,70,160,.12); border-radius:12px; padding:10px; margin:0; max-height:36vh; overflow:auto;">${esc(code||"—")}</pre>

          <div class="tLabel" style="margin-top:12px;">Phản hồi cho học sinh (lưu vào ticket)</div>
          <textarea class="tIn" id="hReply" placeholder="Hướng dẫn sửa lỗi...">${esc(t.reply||"")}</textarea>

          <div class="tRow" style="margin-top:12px;">
            <button class="btn primary" id="hSaveReply">Lưu phản hồi</button>
            <button class="btn ghost" data-close>Đóng</button>
          </div>
        `);
        $("hSaveReply").onclick = ()=>{
          const list2 = getHelpTickets();
          const idx2 = list2.findIndex(x=>x && x.id===id);
          if(idx2<0) return;
          list2[idx2].reply = String($("hReply").value||"").trim();
          list2[idx2].repliedAt = nowISO();
          saveHelpTickets(list2);
          toast("✅ Đã lưu phản hồi");
          $("tModalBackdrop").click();
          setView("help");
        };
      }
    };
  }

  function render(viewName){
    switch(viewName){
      case "overview": return renderOverview();
      case "roster": return renderRoster();
      case "assign": return renderAssign();
      case "results": return renderResults();
      case "bank": return renderBank();
      case "help": return renderHelp();
      default: return renderOverview();
    }
  }

  // ===== Backup / Restore =====
  function exportAll(){
    const payload = {
      version: "teacher_app_v1",
      exportedAt: nowISO(),
      roster: getRoster(),
      assignments: getAssignments(),
      bank: getBank(),
      overrides: getOverrides(),
      helpTickets: getHelpTickets(),
    };
    const blob = new Blob([JSON.stringify(payload,null,2)], {type:"application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "backup_giao_vien.json";
    a.click();
    setTimeout(()=>{ try{ URL.revokeObjectURL(a.href); }catch(e){} }, 1000);
  }
  async function importAll(file){
    const text = await file.text();
    const data = JSON.parse(text);
    if(!data || typeof data!=="object"){ toast("File không hợp lệ"); return; }
    if(data.roster) saveRoster(data.roster);
    if(data.assignments) saveAssignments(Array.isArray(data.assignments)?data.assignments:[]);
    if(data.bank) saveBank(Array.isArray(data.bank)?data.bank:[]);
    if(data.overrides) saveOverrides(data.overrides);
    if(data.helpTickets) saveHelpTickets(Array.isArray(data.helpTickets)?data.helpTickets:[]);
    toast("✅ Khôi phục xong");
  }

  // ===== Init =====
  function init(){
    const root = $("teacherRoot");
    if(!root) return;

    // bind nav
    root.querySelectorAll(".tNav").forEach(btn=>{
      btn.addEventListener("click", ()=>setView(btn.dataset.view));
    });

    // top buttons
    const bBackup = $("tBtnBackup");
    const bRefresh = $("tBtnRefresh");
    const fRestore = $("tRestoreFile");

    
    const bLogout = $("tBtnLogout");
    if(bLogout) bLogout.onclick = ()=>{
      try{ localStorage.removeItem("py10:session"); }catch(e){}
      try{ delete window.__TEACHER; }catch(e){}
      try{ document.body.classList.remove("mode-teacher"); }catch(e){}
      if(typeof showLogin === "function"){ showLogin(); }
      else { location.href = location.pathname; }
    };

if(bBackup) bBackup.onclick = exportAll;
    if(bRefresh) bRefresh.onclick = ()=>{
      const last = localStorage.getItem("py10:teacher:lastView") || "overview";
      setView(last);
    };
    if(fRestore) fRestore.onchange = async (ev)=>{
      const file = ev.target.files && ev.target.files[0];
      if(!file) return;
      try{
        await importAll(file);
        const last = localStorage.getItem("py10:teacher:lastView") || "overview";
        setView(last);
      }catch(err){
        console.error(err);
        toast("Khôi phục lỗi: " + (err?.message||err));
      }finally{
        ev.target.value="";
      }
    };

    // default view
    // Firebase: dong bo danh sach HS/GV + ticket tro giup giua cac may
    try{ initFirebaseSync(); }catch(e){}

    const last = localStorage.getItem("py10:teacher:lastView") || "overview";
    setView(last);

    // Firebase realtime: cap nhat ket qua tu may HS khac (neu bat)
    try{
      if(fbEnabled()){
        window.py10Firebase.listenProgress(()=>{
          const cur = localStorage.getItem("py10:teacher:lastView") || "overview";
          if(cur === "results" || cur === "overview") setView(cur);
        });
      }
    }catch(e){}
  }

  // Init on load
  document.addEventListener("DOMContentLoaded", init);
})();
