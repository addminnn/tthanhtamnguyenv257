/*
  Firebase Sync (Firestore) — dong bo du lieu giua may HS/GV
  - Khong can dang nhap (HS chi nhap ma hoc sinh)
  - 1 lop mac dinh: 10A1

  Note:
  - Can chay qua HTTP(S) (VD: Live Server). Mo bang file:/// se khong hoat dong.
  - File nay la ES Module (type="module").

  Collections:
    classes/{classId}/progress/{studentId}
    classes/{classId}/logs/{studentId}/events/{autoId}
*/

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.8.0/firebase-app.js";
import {
  getFirestore,
  doc,
  setDoc,
  deleteDoc,
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  limit as qLimit,
  getDocs,
} from "https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js";

// (Optional) Analytics — neu bi loi (VD: local/dev), se tu bo qua.
let getAnalyticsFn = null;
try {
  const m = await import("https://www.gstatic.com/firebasejs/12.8.0/firebase-analytics.js");
  getAnalyticsFn = m.getAnalytics;
} catch (_) {
  getAnalyticsFn = null;
}

// ===== Firebase config (ban cung cap) =====
const firebaseConfig = {
  apiKey: "AIzaSyDwcrsi-4lIVxJuzkkuq7JX05X55mLLcpg",
  authDomain: "hotropython.firebaseapp.com",
  projectId: "hotropython",
  storageBucket: "hotropython.firebasestorage.app",
  messagingSenderId: "960861836985",
  appId: "1:960861836985:web:b66c190ee917efb9d06d68",
  measurementId: "G-S9VT18KPWP"
};

const CLASS_ID = "10A1";

function noop() {}

// Public API (giu nguyen contract cu)
const api = {
  enabled: false,
  classId: CLASS_ID,
  _progressMap: {},
  _studentsMap: {},
  _teachersMap: {},
  _helpMap: {},
  _assignMap: {},
  _bankMap: {},
  init: noop,
  seedRosterToFirestore: noop,
  pushResult: noop,
  pushSubmission: noop,
  listenProgress: noop,
  listenStudents: noop,
  upsertStudent: noop,
  deleteStudent: noop,
  listenTeachers: noop,
  upsertTeacher: noop,
  deleteTeacher: noop,
  listenHelpTickets: noop,
  upsertHelpTicket: noop,
  deleteHelpTicket: noop,
  listenAssignments: noop,
  upsertAssignment: noop,
  deleteAssignment: noop,
  listenBank: noop,
  upsertBankLesson: noop,
  deleteBankLesson: noop,
  getRecentEvents: async () => [],
};
window.py10Firebase = api;

// Khoi tao Firebase
let app = null;
let db = null;
try {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  try { if (getAnalyticsFn) getAnalyticsFn(app); } catch (_) {}

  api.enabled = true;
  api.init = () => true;
} catch (e) {
  console.warn("Firebase init failed", e);
  api.enabled = false;
}

if (!api.enabled) {
  // keep no-op
} else {
  function progressRef(studentId) {
    return doc(db, "classes", CLASS_ID, "progress", String(studentId));
  }
  function eventsCol(studentId) {
    return collection(db, "classes", CLASS_ID, "logs", String(studentId), "events");
  }

  function submissionRef(studentId, lessonId) {
    const sid = String(studentId);
    const lid = String(lessonId || "");
    return doc(db, "classes", CLASS_ID, "submissions", `${sid}_${lid || "unknown"}`);
  }

  // ===== Roster sync (students/teachers) =====
  function studentsCol() {
    return collection(db, "classes", CLASS_ID, "students");
  }
  function studentRef(studentId) {
    return doc(db, "classes", CLASS_ID, "students", String(studentId));
  }
  function teachersCol() {
    return collection(db, "classes", CLASS_ID, "teachers");
  }
  function teacherRef(teacherId) {
    return doc(db, "classes", CLASS_ID, "teachers", String(teacherId));
  }

  // ===== Help tickets =====
  function helpCol() {
    return collection(db, "classes", CLASS_ID, "help");
  }
  function helpRef(ticketId) {
    return doc(db, "classes", CLASS_ID, "help", String(ticketId));
  }

  // ===== Assignments (GV giao bai) =====
  function assignsCol() {
    return collection(db, "classes", CLASS_ID, "assignments");
  }
  function assignRef(assignId) {
    return doc(db, "classes", CLASS_ID, "assignments", String(assignId));
  }

  // ===== Teacher custom bank =====
  function bankCol() {
    return collection(db, "classes", CLASS_ID, "teacherBank");
  }
  function bankRef(lessonId) {
    return doc(db, "classes", CLASS_ID, "teacherBank", String(lessonId));
  }

  api.pushResult = async ({ studentId, lessonId, ok, err, act, at }) => {
    try {
      const sid = String(studentId || "").trim();
      if (!sid) return;
      const lid = String(lessonId || "").trim();
      const now = at || new Date().toISOString();

      const patch = {
        studentId: sid,
        lastAt: now,
        lastLessonId: lid,
        lastOk: !!ok,
        lastErr: err ? String(err).slice(0, 500) : "",
        updatedAt: now,
      };
      if (ok && lid) {
        patch["passed." + lid] = true;
      }

      await setDoc(progressRef(sid), patch, { merge: true });
      await addDoc(eventsCol(sid), {
        at: now,
        act: String(act || "test"),
        ok: !!ok,
        lessonId: lid,
        err: err ? String(err).slice(0, 500) : "",
      });
    } catch (e) {
      console.warn("pushResult failed", e);
    }
  };

  // Luu bai nop / output moi lan bam Test (de GV theo doi)
  // Doc id: {studentId}_{lessonId}
  api.pushSubmission = async ({ studentId, lessonId, ok, err, act, at, code, stdin, stdout }) => {
    try {
      const sid = String(studentId || "").trim();
      const lid = String(lessonId || "").trim();
      if (!sid || !lid) return;
      const now = at || new Date().toISOString();

      const docPatch = {
        studentId: sid,
        lessonId: lid,
        at: now,
        act: String(act || "test"),
        ok: !!ok,
        err: err ? String(err).slice(0, 800) : "",
        code: code ? String(code).slice(0, 20000) : "",
        stdin: stdin ? String(stdin).slice(0, 4000) : "",
        stdout: stdout ? String(stdout).slice(0, 8000) : "",
        updatedAt: now,
      };

      await setDoc(submissionRef(sid, lid), docPatch, { merge: true });
    } catch (e) {
      console.warn("pushSubmission failed", e);
    }
  };

  api.listenProgress = (onUpdate) => {
    try {
      const col = collection(db, "classes", CLASS_ID, "progress");
      return onSnapshot(
        col,
        (snap) => {
          const map = {};
          snap.forEach((d) => {
            map[d.id] = d.data() || {};
          });
          api._progressMap = map;
          try { if (typeof onUpdate === "function") onUpdate(map); } catch (_) {}
        },
        (err) => console.warn("listenProgress error", err)
      );
    } catch (e) {
      console.warn("listenProgress failed", e);
      return null;
    }
  };

  // ===== Students roster =====
  api.upsertStudent = async (student) => {
    try {
      const s = student || {};
      const id = String(s.id || s.studentId || "").trim();
      if (!id) return;
      const now = new Date().toISOString();
      await setDoc(studentRef(id), {
        id,
        name: String(s.name || "").trim(),
        class: String(s.class || "").trim(),
        createdAt: String(s.createdAt || now),
        updatedAt: now,
      }, { merge: true });
    } catch (e) {
      console.warn("upsertStudent failed", e);
    }
  };

  api.deleteStudent = async (studentId) => {
    try {
      const id = String(studentId || "").trim();
      if (!id) return;
      await deleteDoc(studentRef(id));
    } catch (e) {
      console.warn("deleteStudent failed", e);
    }
  };

  // Seed roster (students/teachers) from provided arrays.
  // Usage (DevTools): window.py10Firebase.seedRosterToFirestore({students:[...], teachers:[...]})
  api.seedRosterToFirestore = async ({ students = [], teachers = [] } = {}) => {
    try {
      for (const s0 of (students || [])) {
        try { await api.upsertStudent(s0); } catch (_) {}
      }
      for (const t0 of (teachers || [])) {
        try { await api.upsertTeacher(t0); } catch (_) {}
      }
      return true;
    } catch (e) {
      console.warn("seedRosterToFirestore failed", e);
      return false;
    }
  };

  api.listenStudents = (onUpdate) => {
    try {
      return onSnapshot(
        studentsCol(),
        (snap) => {
          const map = {};
          snap.forEach((d) => (map[d.id] = d.data() || {}));
          api._studentsMap = map;
          try { if (typeof onUpdate === "function") onUpdate(map); } catch (_) {}
        },
        (err) => console.warn("listenStudents error", err)
      );
    } catch (e) {
      console.warn("listenStudents failed", e);
      return null;
    }
  };

  // ===== Teachers roster =====
  api.upsertTeacher = async (teacher) => {
    try {
      const t = teacher || {};
      const id = String(t.id || "").trim();
      if (!id) return;
      const now = new Date().toISOString();
      await setDoc(teacherRef(id), {
        id,
        name: String(t.name || "").trim(),
        pw: t.pw ? String(t.pw) : "",
        updatedAt: now,
      }, { merge: true });
    } catch (e) {
      console.warn("upsertTeacher failed", e);
    }
  };

  api.deleteTeacher = async (teacherId) => {
    try {
      const id = String(teacherId || "").trim();
      if (!id) return;
      await deleteDoc(teacherRef(id));
    } catch (e) {
      console.warn("deleteTeacher failed", e);
    }
  };

  api.listenTeachers = (onUpdate) => {
    try {
      return onSnapshot(
        teachersCol(),
        (snap) => {
          const map = {};
          snap.forEach((d) => (map[d.id] = d.data() || {}));
          api._teachersMap = map;
          try { if (typeof onUpdate === "function") onUpdate(map); } catch (_) {}
        },
        (err) => console.warn("listenTeachers error", err)
      );
    } catch (e) {
      console.warn("listenTeachers failed", e);
      return null;
    }
  };

  // ===== Help tickets sync =====
  api.upsertHelpTicket = async (ticket) => {
    try {
      const t = ticket || {};
      const id = String(t.id || "").trim();
      if (!id) return;
      const now = new Date().toISOString();
      await setDoc(helpRef(id), {
        ...t,
        id,
        updatedAt: now,
      }, { merge: true });
    } catch (e) {
      console.warn("upsertHelpTicket failed", e);
    }
  };

  api.deleteHelpTicket = async (ticketId) => {
    try {
      const id = String(ticketId || "").trim();
      if (!id) return;
      await deleteDoc(helpRef(id));
    } catch (e) {
      console.warn("deleteHelpTicket failed", e);
    }
  };

  api.listenHelpTickets = (onUpdate) => {
    try {
      // order by ts desc if present, else updatedAt
      const q = query(helpCol(), orderBy("ts", "desc"));
      return onSnapshot(
        q,
        (snap) => {
          const map = {};
          snap.forEach((d) => (map[d.id] = d.data() || {}));
          api._helpMap = map;
          try { if (typeof onUpdate === "function") onUpdate(map); } catch (_) {}
        },
        (err) => {
          // fallback if orderBy ts missing (first time)
          console.warn("listenHelpTickets error", err);
          try {
            return onSnapshot(helpCol(), (snap2) => {
              const map = {};
              snap2.forEach((d) => (map[d.id] = d.data() || {}));
              api._helpMap = map;
              try { if (typeof onUpdate === "function") onUpdate(map); } catch (_) {}
            });
          } catch (_) {}
        }
      );
    } catch (e) {
      console.warn("listenHelpTickets failed", e);
      return null;
    }
  };

  // ===== Assignments sync =====
  api.upsertAssignment = async (as) => {
    try {
      const a = as || {};
      const id = String(a.id || "").trim();
      if (!id) return;
      const now = new Date().toISOString();
      await setDoc(assignRef(id), {
        ...a,
        id,
        updatedAt: now,
        createdAt: String(a.createdAt || a.created || now),
      }, { merge: true });
    } catch (e) {
      console.warn("upsertAssignment failed", e);
    }
  };

  api.deleteAssignment = async (assignId) => {
    try {
      const id = String(assignId || "").trim();
      if (!id) return;
      await deleteDoc(assignRef(id));
    } catch (e) {
      console.warn("deleteAssignment failed", e);
    }
  };

  api.listenAssignments = (onUpdate) => {
    try {
      // order newest first (createdAt/created)
      const q = query(assignsCol(), orderBy("createdAt", "desc"));
      return onSnapshot(
        q,
        (snap) => {
          const map = {};
          snap.forEach((d) => (map[d.id] = d.data() || {}));
          api._assignMap = map;
          try { if (typeof onUpdate === "function") onUpdate(map); } catch (_) {}
        },
        (err) => {
          // fallback: no index/field yet
          console.warn("listenAssignments error", err);
          try {
            return onSnapshot(assignsCol(), (snap2) => {
              const map = {};
              snap2.forEach((d) => (map[d.id] = d.data() || {}));
              api._assignMap = map;
              try { if (typeof onUpdate === "function") onUpdate(map); } catch (_) {}
            });
          } catch (_) {}
        }
      );
    } catch (e) {
      console.warn("listenAssignments failed", e);
      return null;
    }
  };

  // ===== Teacher bank sync =====
  api.upsertBankLesson = async (l) => {
    try {
      const o = l || {};
      const id = String(o.id || "").trim();
      if(!id) return;
      const now = new Date().toISOString();
      await setDoc(bankRef(id), {
        ...o,
        id,
        updatedAt: now,
        createdAt: String(o.createdAt || o.created || now),
      }, { merge: true });
    } catch (e) {
      console.warn("upsertBankLesson failed", e);
    }
  };

  api.deleteBankLesson = async (lessonId) => {
    try{
      const id = String(lessonId || "").trim();
      if(!id) return;
      await deleteDoc(bankRef(id));
    } catch(e){
      console.warn("deleteBankLesson failed", e);
    }
  };

  api.listenBank = (onUpdate) => {
    try{
      const q = query(bankCol(), orderBy("createdAt", "desc"));
      return onSnapshot(
        q,
        (snap) => {
          const map = {};
          snap.forEach((d) => (map[d.id] = d.data() || {}));
          api._bankMap = map;
          try{ if(typeof onUpdate === "function") onUpdate(map); }catch(_){ }
        },
        (err) => {
          console.warn("listenBank error", err);
          try{
            return onSnapshot(bankCol(), (snap2) => {
              const map = {};
              snap2.forEach((d) => (map[d.id] = d.data() || {}));
              api._bankMap = map;
              try{ if(typeof onUpdate === "function") onUpdate(map); }catch(_){ }
            });
          }catch(_){ }
        }
      );
    }catch(e){
      console.warn("listenBank failed", e);
      return null;
    }
  };

  api.getRecentEvents = async (studentId, limitN = 30) => {
    try {
      const sid = String(studentId || "").trim();
      if (!sid) return [];
      const q = query(eventsCol(sid), orderBy("at", "desc"), qLimit(limitN));
      const snap = await getDocs(q);
      const out = [];
      snap.forEach((d) => out.push(d.data() || {}));
      return out;
    } catch (e) {
      console.warn("getRecentEvents failed", e);
      return [];
    }
  };
}