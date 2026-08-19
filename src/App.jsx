import React, { useState, useEffect, useMemo } from 'react';
import { Clock, CloudSun, MapPin, Users, Settings, BellRing, LogOut, CheckCircle2, AlertTriangle, UserCheck, ChevronLeft, Timer, Shield, UserCog, Check, X, Lock, KeyRound, CalendarDays, BookOpen, TrendingUp, LayoutDashboard, Filter, Download, Search, GraduationCap, Plus, Trash2, PlusCircle, Upload, Trash } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, doc, setDoc, deleteDoc, writeBatch } from 'firebase/firestore';

// --- YOUR REAL FIREBASE CREDENTIALS ---
const MY_FIREBASE_CONFIG = {
  apiKey: "AIzaSyAevekloybpwUc-PjVi6XD6yUFlJFJ24I0",
  authDomain: "upper-grade-building-manager.firebaseapp.com",
  projectId: "upper-grade-building-manager",
  storageBucket: "upper-grade-building-manager.firebasestorage.app",
  messagingSenderId: "955440472191",
  appId: "1:955440472191:web:f481a2c69178b1b81b1f4a"
};

// --- SMART ENVIRONMENT SWITCHER ---
const isSandbox = false; 
const firebaseConfig = MY_FIREBASE_CONFIG;
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = 'production';

const getColRef = (colName) => collection(db, colName); 
const getDocumentRef = (colName, docId) => doc(db, colName, docId);

// --- HELPER FOR GRADE BADGES ---
const getGradeBadgeClass = (grade) => {
  const colors = {
    '7th': 'bg-teal-100 text-teal-700',
    '8th': 'bg-cyan-100 text-cyan-700',
    'Fr': 'bg-green-100 text-green-700',
    'So': 'bg-blue-100 text-blue-700',
    'Ju': 'bg-purple-100 text-purple-700',
    'Sr': 'bg-orange-100 text-orange-700',
  };
  return colors[grade] || 'bg-slate-100 text-slate-700';
};

const DESTINATIONS = [
  { id: 'bathroom', label: 'Bathroom', icon: '🚽' },
  { id: 'locker', label: 'Locker', icon: '🎒' },
  { id: 'office', label: 'Main Office', icon: '🏢' },
  { id: 'nurse', label: 'Nurse', icon: '⚕️' },
  { id: 'library', label: 'Library', icon: '📚' },
  { id: 'other', label: 'Other', icon: '❓' },
];

export default function App() {
  const [currentRole, setCurrentRole] = useState(null);
  const [currentTeacher, setCurrentTeacher] = useState(null); 
  
  const [user, setUser] = useState(null);
  const [dbError, setDbError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const [teachers, setTeachers] = useState([]);
  const [students, setStudents] = useState([]);
  const [classes, setClasses] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [calendarOverrides, setCalendarOverrides] = useState([]);

  const [passes, setPasses] = useState([]);
  const globalPasses = passes.filter(p => p.status === 'active');
  const pendingPasses = passes.filter(p => p.status === 'pending');
  const passHistory = passes.filter(p => p.status === 'completed');

  // 1. Firebase Authentication
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (isSandbox && typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (e) {
        console.warn("Auth warning:", e.message);
      }
    };
    initAuth();
    
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser || null);
    });
    return () => unsubscribe();
  }, []);

  // 2. Firestore Data Syncing
  useEffect(() => {
    if (!user) return; 
    
    const collections = ['teachers', 'students', 'classes', 'schedules', 'calendarDays', 'passes'];
    const unsubscribes = collections.map(colName => {
      const colRef = getColRef(colName);
      return onSnapshot(colRef, 
        (snapshot) => {
          setDbError(false);
          const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          if (colName === 'teachers') setTeachers(data);
          if (colName === 'students') setStudents(data);
          if (colName === 'classes') setClasses(data);
          if (colName === 'schedules') setSchedules(data);
          if (colName === 'calendarDays') setCalendarOverrides(data);
          if (colName === 'passes') setPasses(data.map(p => ({
             ...p, 
             startTime: p.startTime ? new Date(p.startTime) : null,
             requestTime: p.requestTime ? new Date(p.requestTime) : null,
             endTime: p.endTime ? new Date(p.endTime) : null
          })));
        },
        (err) => {
          console.error(`Error fetching ${colName}:`, err);
          if (err.code === 'permission-denied' || err.message.includes('permission')) {
            setDbError(true);
          }
        }
      );
    });
    return () => unsubscribes.forEach(unsub => unsub());
  }, [user, retryCount]);

  const activeCalendar = useMemo(() => {
    const days = [];
    let current = new Date();
    current.setHours(0, 0, 0, 0); 

    while (days.length < 10) {
      const dayOfWeek = current.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) { 
        const dateStr = current.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const dayName = current.toLocaleDateString('en-US', { weekday: 'long' });
        
        const y = current.getFullYear();
        const m = String(current.getMonth() + 1).padStart(2, '0');
        const d = String(current.getDate()).padStart(2, '0');
        const id = `cal_${y}_${m}_${d}`;
        
        days.push({ id, date: dateStr, day: dayName });
      }
      current.setDate(current.getDate() + 1);
    }

    return days.map(baseDay => {
      const override = calendarOverrides.find(o => o.id === baseDay.id);
      if (override) {
        return { ...baseDay, scheduleIds: override.scheduleIds, isOverride: true };
      }

      const defaultScheduleIds = schedules
        .filter(sch => sch.defaultDays && sch.defaultDays.includes(baseDay.day))
        .map(sch => sch.id);
      
      return { ...baseDay, scheduleIds: defaultScheduleIds, isOverride: false };
    });
  }, [calendarOverrides, schedules]);

  const todayScheduleData = useMemo(() => {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    const todayId = `cal_${y}_${m}_${d}`;

    const todayCal = activeCalendar.find(c => c.id === todayId);
    if (!todayCal) return { activeSchedules: [], allPeriods: [] };

    const activeSchedules = todayCal.scheduleIds.map(id => schedules.find(s => s.id === id)).filter(Boolean);
    
    let allPeriods = [];
    activeSchedules.forEach(sch => {
      if (sch.periods) allPeriods = [...allPeriods, ...sch.periods];
    });

    allPeriods.sort((a, b) => a.startTime.localeCompare(b.startTime));

    return { activeSchedules, allPeriods };
  }, [activeCalendar, schedules]);

  const isHallwayBusy = globalPasses.some(
    pass => pass.destination && pass.destination.id !== 'office'
  );

  const handleRequestPass = async (student, destination, requestingTeacher) => {
    if (!user) return { pass: null, status: 'error' };
    
    const needsApproval = isHallwayBusy;
    const newPassId = 'pass_' + Date.now();
    const newPass = {
      student: student,
      teacher: requestingTeacher,
      destination: destination,
      requestTime: new Date().toISOString(),
      startTime: needsApproval ? null : new Date().toISOString(),
      status: needsApproval ? 'pending' : 'active'
    };

    await setDoc(getDocumentRef('passes', newPassId), newPass);
    
    return { 
      pass: { id: newPassId, ...newPass, startTime: newPass.startTime ? new Date(newPass.startTime) : null }, 
      status: newPass.status 
    };
  };

  const handleTeacherInitiatePass = async (student, destination, requestingTeacher) => {
    if (!user) return { pass: null, status: 'error' };
    
    const newPassId = 'pass_' + Date.now();
    const newPass = {
      student: student,
      teacher: requestingTeacher,
      destination: destination,
      requestTime: new Date().toISOString(),
      startTime: new Date().toISOString(), // Automatically active, bypassing pending
      status: 'active'
    };

    await setDoc(getDocumentRef('passes', newPassId), newPass);
    return { pass: { id: newPassId, ...newPass, startTime: new Date(newPass.startTime) }, status: 'active' };
  };

  const handleEndPass = async (passId) => {
    if (!user) return;
    const passRef = getDocumentRef('passes', passId);
    await setDoc(passRef, { status: 'completed', endTime: new Date().toISOString() }, { merge: true });
  };

  const handleApprovePass = async (passId) => {
    if (!user) return;
    const passRef = getDocumentRef('passes', passId);
    await setDoc(passRef, { status: 'active', startTime: new Date().toISOString() }, { merge: true });
  };

  const handleDenyPass = async (passId) => {
     if (!user) return;
     await deleteDoc(getDocumentRef('passes', passId));
  };

  const saveDoc = async (col, id, data) => setDoc(getDocumentRef(col, id), data);
  const delDoc = async (col, id) => deleteDoc(getDocumentRef(col, id));

  const handleBulkAddStudents = async (newStudents) => {
    if (!user) return;
    const batch = writeBatch(db);
    newStudents.forEach(student => {
      const docRef = doc(collection(db, 'students'), student.id || 's' + Date.now() + Math.random().toString(36).substring(7));
      batch.set(docRef, student);
    });
    await batch.commit();
  };

  const handleMassDeleteStudents = async () => {
    if (!user) return;
    const batch = writeBatch(db);
    students.forEach(student => {
      batch.delete(doc(db, 'students', student.id));
    });
    classes.forEach(c => {
      if (c.roster && c.roster.length > 0) {
        batch.update(doc(db, 'classes', c.id), { roster: [] });
      }
    });
    await batch.commit();
  };

  const handleClearPassHistory = async () => {
    if (!user) return;
    const batch = writeBatch(db);
    passHistory.forEach(pass => {
      batch.delete(doc(db, 'passes', pass.id));
    });
    await batch.commit();
  };

  if (dbError && user) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-6 font-sans">
        <div className="bg-white p-8 rounded-3xl shadow-xl w-full max-w-3xl border-4 border-red-500">
          <div className="flex items-center gap-4 mb-6 text-red-600">
            <Shield className="w-12 h-12" />
            <h1 className="text-3xl font-bold">Database Setup Required</h1>
          </div>
          <p className="text-slate-600 text-lg mb-6 leading-relaxed">
            Your application successfully connected to your Google Firebase project, but your database is currently rejecting all read/write attempts because of its Security Rules.
          </p>
          <div className="bg-slate-50 p-6 rounded-xl border border-slate-200 mb-8">
            <h3 className="font-bold text-slate-800 mb-3 text-lg">How to fix this right now:</h3>
            <ol className="list-decimal list-inside space-y-4 text-slate-700 font-medium">
              <li>Open your <a href="https://console.firebase.google.com/" target="_blank" rel="noreferrer" className="text-blue-600 font-bold hover:underline">Firebase Console</a> in a new tab.</li>
              <li>Click on <strong>Firestore Database</strong> in the left sidebar menu.</li>
              <li>Click on the <strong>Rules</strong> tab at the top of the database view.</li>
              <li>Delete everything in the editor and paste the code below:</li>
            </ol>
            <pre className="bg-slate-900 text-green-400 p-6 rounded-xl mt-4 font-mono text-sm overflow-x-auto shadow-inner">
{`rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}`}
            </pre>
            <p className="mt-6 text-base text-slate-800 font-bold">5. Click the "Publish" button.</p>
          </div>
          <button 
            onClick={() => { setDbError(false); setRetryCount(c => c + 1); }} 
            className="w-full py-4 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-xl transition-colors shadow-md flex items-center justify-center gap-2 active:scale-95"
          >
            I have published the new rules (Retry)
          </button>
        </div>
      </div>
    );
  }

  // --- Screens ---
  if (!currentRole) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-6 font-sans relative">
        <h1 className="text-4xl font-bold text-slate-800 mb-2 tracking-tight">Hall Pass Manager</h1>
        <p className="text-slate-500 mb-8">Select your portal to begin</p>
        
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 w-full max-w-4xl">
          <RoleButton icon={<Users />} title="Student Kiosk" desc="Classroom touch screen" color="blue" onClick={() => setCurrentRole('login_kiosk')} />
          <RoleButton icon={<Settings />} title="Teacher Login" desc="Manage your classroom" color="purple" onClick={() => setCurrentRole('login_teacher')} />
          <RoleButton icon={<Shield />} title="Admin Dashboard" desc="School-wide overview" color="emerald" onClick={() => setCurrentRole('login_admin')} />
        </div>
      </div>
    );
  }

  if (currentRole === 'login_admin') {
    return (
      <PinLogin 
        title="Admin Access"
        subtitle="Enter Admin PIN"
        expectedPin="8631"
        onCancel={() => setCurrentRole(null)}
        onLogin={() => setCurrentRole('admin')}
      />
    );
  }

  if (currentRole === 'login_kiosk' || currentRole === 'login_teacher') {
    return (
      <PinLogin 
        title={currentRole === 'login_kiosk' ? "Unlock Kiosk" : "Teacher Login"}
        subtitle="Enter your Teacher PIN"
        teachers={teachers}
        onCancel={() => setCurrentRole(null)}
        onLogin={(teacher) => {
          setCurrentTeacher(teacher);
          setCurrentRole(currentRole === 'login_kiosk' ? 'student' : 'teacher');
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {currentRole === 'student' && (
        <StudentView 
          onSwitchRole={() => { setCurrentRole(null); setCurrentTeacher(null); }} 
          teacher={currentTeacher}
          globalPasses={globalPasses}
          pendingPasses={pendingPasses}
          onRequestPass={(student, dest) => handleRequestPass(student, dest, currentTeacher)}
          onEndPass={handleEndPass}
          isHallwayBusy={isHallwayBusy}
          classes={classes}
          todayPeriods={todayScheduleData.allPeriods}
        />
      )}
      {currentRole === 'teacher' && (
        <TeacherView 
          onSwitchRole={() => { setCurrentRole(null); setCurrentTeacher(null); }} 
          teacher={currentTeacher}
          globalPasses={globalPasses}
          pendingPasses={pendingPasses.filter(p => p.teacher.id === currentTeacher.id)}
          onApprove={handleApprovePass}
          onDeny={handleDenyPass}
          onEndPass={handleEndPass} 
          onTeacherInitiatePass={(s, d) => handleTeacherInitiatePass(s, d, currentTeacher)}
          isHallwayBusy={isHallwayBusy}
          classes={classes}
          todayScheduleData={todayScheduleData}
        />
      )}
      {currentRole === 'admin' && (
        <AdminView 
          onSwitchRole={() => setCurrentRole(null)} 
          globalPasses={globalPasses}
          passHistory={passHistory}
          onEndPass={handleEndPass}
          onClearPassHistory={handleClearPassHistory}
          teachers={teachers}
          onSaveTeacher={(t) => saveDoc('teachers', t.id || 't' + Date.now(), t)}
          onDeleteTeacher={(id) => delDoc('teachers', id)}
          students={students}
          onSaveStudent={(s) => saveDoc('students', s.id || 's' + Date.now(), s)}
          onDeleteStudent={(id) => delDoc('students', id)}
          onBulkAddStudents={handleBulkAddStudents}
          onMassDeleteStudents={handleMassDeleteStudents}
          classes={classes}
          onSaveClass={(c) => saveDoc('classes', c.id || 'c' + Date.now(), c)}
          onDeleteClass={(id) => delDoc('classes', id)}
          schedules={schedules}
          onSaveSchedule={(s) => saveDoc('schedules', s.id || 'sch_' + Date.now(), s)}
          onDeleteSchedule={(id) => delDoc('schedules', id)}
          calendarDays={activeCalendar}
          onSaveCalendarDay={(d) => {
            if (!d.isOverride) {
              delDoc('calendarDays', d.id);
            } else {
              saveDoc('calendarDays', d.id, d);
            }
          }}
        />
      )}
    </div>
  );
}

function PinLogin({ title, subtitle, onLogin, onCancel, expectedPin, teachers = [] }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  const handleKeyPress = (num) => {
    setError(false);
    setPin(prev => prev + num);
  };

  const handleEnter = () => {
    if (expectedPin !== undefined) {
      if (pin === expectedPin) {
        onLogin();
      } else {
        setError(true);
        setPin('');
      }
    } else {
      const teacher = teachers.find(t => t.pin === pin);
      if (teacher) {
        onLogin(teacher);
      } else {
        setError(true);
        setPin('');
      }
    }
  };

  const handleDelete = () => setPin(prev => prev.slice(0, -1));

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (/^[0-9]$/.test(e.key)) {
        handleKeyPress(e.key);
      } else if (e.key === 'Backspace') {
        handleDelete();
      } else if (e.key === 'Enter') {
        handleEnter();
      } else if (e.key === 'Escape') {
        onCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pin, expectedPin, teachers, onLogin, onCancel]);

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm bg-white p-8 rounded-[2rem] shadow-xl border border-slate-200 text-center relative">
        <button onClick={onCancel} className="absolute top-6 left-6 text-slate-400 hover:text-slate-700">
          <ChevronLeft className="w-8 h-8" />
        </button>
        
        <div className="mx-auto w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4 mt-4">
          <KeyRound className="w-8 h-8 text-slate-600" />
        </div>
        <h2 className="text-2xl font-bold text-slate-800">{title}</h2>
        <p className="text-slate-500 mb-8">{subtitle}</p>

        <div className="mb-8 flex justify-center gap-3 h-12">
          {pin.length === 0 && !error && <span className="text-slate-300 text-3xl font-mono tracking-[1em]">****</span>}
          {error && <span className="text-red-500 font-bold animate-pulse">INVALID PIN</span>}
          {!error && pin.split('').map((_, i) => (
            <div key={i} className="w-6 h-6 bg-slate-800 rounded-full"></div>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-4 mb-6">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
            <button key={num} onClick={() => handleKeyPress(num.toString())} className="h-16 text-2xl font-bold text-slate-700 bg-slate-50 rounded-2xl active:bg-slate-200 transition-colors">
              {num}
            </button>
          ))}
          <button onClick={handleDelete} className="h-16 text-lg font-bold text-slate-500 bg-slate-50 rounded-2xl active:bg-slate-200 transition-colors">
            DEL
          </button>
          <button onClick={() => handleKeyPress('0')} className="h-16 text-2xl font-bold text-slate-700 bg-slate-50 rounded-2xl active:bg-slate-200 transition-colors">
            0
          </button>
          <button onClick={handleEnter} className="h-16 text-lg font-bold text-white bg-blue-600 rounded-2xl active:bg-blue-700 transition-colors shadow-md">
            ENTER
          </button>
        </div>
      </div>
    </div>
  );
}

function RoleButton({ icon, title, desc, color, onClick }) {
  const colorMap = {
    blue: 'bg-blue-100 text-blue-600 hover:border-blue-500',
    purple: 'bg-purple-100 text-purple-600 hover:border-purple-500',
    orange: 'bg-orange-100 text-orange-600 hover:border-orange-500',
    emerald: 'bg-emerald-100 text-emerald-600 hover:border-emerald-500',
  };

  return (
    <button 
      onClick={onClick}
      className={`bg-white p-6 rounded-2xl shadow-md hover:shadow-xl transition-all border-2 border-transparent flex flex-col items-center justify-center gap-4 group ${colorMap[color].split(' ')[2]}`}
    >
      <div className={`w-16 h-16 rounded-full flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform ${colorMap[color].split(' ').slice(0,2).join(' ')}`}>
        {React.cloneElement(icon, { className: 'w-8 h-8' })}
      </div>
      <div className="text-center">
        <span className="block text-xl font-bold text-slate-800">{title}</span>
        <span className="text-slate-500 text-sm">{desc}</span>
      </div>
    </button>
  );
}

function StudentView({ onSwitchRole, teacher, globalPasses, pendingPasses, onRequestPass, onEndPass, isHallwayBusy, classes, todayPeriods }) {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [viewingPass, setViewingPass] = useState(null);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [isUnlocking, setIsUnlocking] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const timeString = currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const currentMins = currentTime.getHours() * 60 + currentTime.getMinutes();
  const activePeriod = todayPeriods.find(p => {
    const [sh, sm] = p.startTime.split(':').map(Number);
    const [eh, em] = p.endTime.split(':').map(Number);
    return currentMins >= (sh * 60 + sm) && currentMins <= (eh * 60 + em);
  });

  let activeClass = null;
  if (activePeriod) {
    activeClass = classes.find(c => c.teacherId === teacher.id && activePeriod.classIds.includes(c.id));
  }

  const isFallback = !activeClass;
  if (!activeClass) {
    activeClass = classes.find(c => c.teacherId === teacher.id) || { roster: [], name: 'No Class Assigned' };
  }

  const localActivePasses = globalPasses.filter(p => p.teacher.id === teacher.id);
  const localPendingPasses = pendingPasses.filter(p => p.teacher.id === teacher.id);

  const availableStudents = activeClass.roster.filter(
    student => !localActivePasses.some(pass => pass.student.id === student.id) &&
               !localPendingPasses.some(pass => pass.student.id === student.id)
  );

  if (isUnlocking) {
    return (
      <PinLogin
        title="Exit Kiosk Mode"
        subtitle={`Enter PIN for ${teacher.name} to exit`}
        expectedPin={teacher.pin}
        onCancel={() => setIsUnlocking(false)}
        onLogin={() => {
          setIsUnlocking(false);
          onSwitchRole();
        }}
      />
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      <header className="bg-slate-900 text-white p-4 flex justify-between items-center shadow-md">
        <div className="flex items-center gap-4">
          <Clock className="w-8 h-8 text-blue-400" />
          <div>
            <h2 className="text-2xl font-bold tracking-wider">{timeString}</h2>
            <p className="text-slate-400 text-sm">Room {teacher.room} Kiosk</p>
          </div>
        </div>

        <div className="flex flex-col items-center">
          <span className="text-sm font-bold text-slate-400 uppercase tracking-wider">{activePeriod ? activePeriod.name : 'Passing Period'}</span>
          <span className={`text-lg font-black ${isFallback ? 'text-slate-500 italic' : 'text-emerald-400'}`}>{activeClass.name}</span>
        </div>

        <button onClick={() => setIsUnlocking(true)} className="p-2 bg-slate-800 rounded-lg text-slate-400 hover:text-white flex items-center gap-2">
          <Lock className="w-4 h-4" /> Exit Kiosk
        </button>
      </header>

      <main className="flex-1 flex flex-col p-6 items-center justify-center relative overflow-y-auto">
        
        {viewingPass && (
          <ActivePassTimer 
            pass={viewingPass} 
            onEndPass={() => { onEndPass(viewingPass.id); setViewingPass(null); }} 
            onBack={() => setViewingPass(null)}
          />
        )}

        {!viewingPass && selectedStudent && (
          <div className="w-full max-w-4xl animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-4xl font-bold text-slate-800">
                Where are you going, <span className="text-blue-600">{selectedStudent.name}</span>?
              </h2>
              <button 
                onClick={() => setSelectedStudent(null)}
                className="px-6 py-3 bg-slate-200 text-slate-700 font-semibold rounded-xl text-xl active:bg-slate-300"
              >
                Cancel
              </button>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
              {DESTINATIONS.map(dest => (
                <button
                  key={dest.id}
                  onClick={() => { 
                    const result = onRequestPass(selectedStudent, dest); 
                    setSelectedStudent(null); 
                    if (result.status === 'active') {
                      setViewingPass(result.pass);
                    }
                  }}
                  className="bg-white p-8 rounded-3xl shadow-sm border-2 border-slate-100 hover:border-blue-400 hover:shadow-lg transition-all flex flex-col items-center justify-center gap-4 active:scale-95 relative overflow-hidden"
                >
                  {isHallwayBusy && dest.id !== 'office' && (
                    <div className="absolute top-0 right-0 bg-orange-100 text-orange-700 text-xs px-3 py-1 rounded-bl-xl font-semibold">
                      Requires Override
                    </div>
                  )}
                  <span className="text-6xl">{dest.icon}</span>
                  <span className="text-2xl font-bold text-slate-700">{dest.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {!viewingPass && !selectedStudent && (
          <div className="w-full max-w-6xl animate-in fade-in duration-300">
            
            <div className={`w-full p-4 rounded-2xl mb-8 flex items-center justify-center gap-3 shadow-sm ${isHallwayBusy ? 'bg-orange-100 text-orange-800 border-2 border-orange-200' : 'bg-emerald-100 text-emerald-800 border-2 border-emerald-200'}`}>
               {isHallwayBusy ? <AlertTriangle className="w-7 h-7" /> : <CheckCircle2 className="w-7 h-7" />}
               <span className="text-xl font-bold">
                 Hallway Status: {isHallwayBusy ? 'Busy (Teacher Override Required)' : 'Clear (Passes Auto-Approve)'}
               </span>
            </div>

            {(localActivePasses.length > 0 || localPendingPasses.length > 0) && (
              <div className="mb-8">
                <h3 className="text-xl font-semibold text-slate-600 mb-4 flex items-center gap-2">
                  <Timer className="w-5 h-5" /> From This Room ({localActivePasses.length + localPendingPasses.length})
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {localPendingPasses.map(pass => (
                    <div key={pass.id} className="flex items-center justify-between p-4 rounded-2xl border-2 border-yellow-200 bg-yellow-50 text-yellow-800 shadow-sm opacity-80 animate-pulse">
                       <div>
                        <p className="font-bold text-lg">{pass.student.name}</p>
                        <p className="text-sm opacity-80 flex items-center gap-1">
                          {pass.destination.icon} {pass.destination.label}
                        </p>
                      </div>
                      <div className="text-sm font-bold bg-yellow-200 px-3 py-1 rounded-lg">
                        Waiting for Teacher...
                      </div>
                    </div>
                  ))}
                  {localActivePasses.map(pass => (
                    <MiniPassBanner key={pass.id} pass={pass} onClick={() => setViewingPass(pass)} />
                  ))}
                </div>
              </div>
            )}

            <h2 className="text-3xl font-semibold text-slate-700 mb-8 text-center border-t border-slate-200 pt-8 mt-4">
              Tap your name to leave the room
            </h2>
            <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {availableStudents.map(student => (
                <button
                  key={student.id}
                  onClick={() => setSelectedStudent(student)}
                  className="bg-white p-3 rounded-xl shadow-sm border-2 border-slate-100 text-left hover:border-blue-500 hover:shadow-md active:bg-blue-50 transition-all min-h-[4.5rem] flex items-center justify-center"
                >
                  <span className="text-lg font-semibold text-slate-800 text-center leading-tight">{student.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function ActivePassTimer({ pass, onEndPass, onBack }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      const diff = Math.floor((new Date() - pass.startTime) / 1000);
      setElapsed(diff);
    }, 1000);
    return () => clearInterval(timer);
  }, [pass.startTime]);

  const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const seconds = (elapsed % 60).toString().padStart(2, '0');

  let timerColorClass = "text-emerald-500";
  let bgPulseClass = "bg-emerald-50";
  if (elapsed >= 300 && elapsed < 600) { timerColorClass = "text-orange-500"; bgPulseClass = "bg-orange-50 animate-pulse"; } 
  else if (elapsed >= 600) { timerColorClass = "text-red-600"; bgPulseClass = "bg-red-50 animate-pulse"; }

  return (
    <div className={`w-full max-w-3xl ${bgPulseClass} border-4 border-white shadow-2xl rounded-[3rem] p-12 flex flex-col items-center justify-center transition-colors duration-500 relative`}>
      <button onClick={onBack} className="absolute top-8 left-8 px-6 py-3 bg-white/60 hover:bg-white rounded-2xl transition-all shadow-sm flex items-center gap-2 text-slate-700 font-bold text-xl active:scale-95">
        <ChevronLeft className="w-6 h-6" /> Back to Roster
      </button>
      <div className="text-center mb-8">
        <h2 className="text-4xl font-bold text-slate-800">{pass.student.name}</h2>
        <p className="text-2xl text-slate-500 mt-2 flex items-center justify-center gap-2">
          <MapPin className="w-6 h-6" /> {pass.destination.label}
        </p>
      </div>
      <div className={`text-[10rem] leading-none font-black tracking-tighter ${timerColorClass} font-mono mb-12 tabular-nums drop-shadow-sm`}>
        {minutes}:{seconds}
      </div>
      <button onClick={onEndPass} className="w-full max-w-md py-6 bg-slate-900 text-white rounded-2xl text-3xl font-bold hover:bg-slate-800 active:scale-95 transition-all shadow-xl flex items-center justify-center gap-3">
        <CheckCircle2 className="w-8 h-8" /> Student Returned
      </button>
    </div>
  );
}

function MiniPassBanner({ pass, onClick }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(Math.floor((new Date() - pass.startTime) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [pass.startTime]);

  const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const seconds = (elapsed % 60).toString().padStart(2, '0');

  let timerColorClass = "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (elapsed >= 300 && elapsed < 600) timerColorClass = "bg-orange-100 text-orange-800 border-orange-200";
  else if (elapsed >= 600) timerColorClass = "bg-red-100 text-red-800 border-red-200 animate-pulse";

  return (
    <button onClick={onClick} className={`flex items-center justify-between p-4 rounded-2xl border-2 shadow-sm hover:shadow-md transition-all active:scale-95 text-left ${timerColorClass}`}>
      <div>
        <p className="font-bold text-lg">{pass.student.name}</p>
        <p className="text-sm opacity-80 flex items-center gap-1">
          {pass.destination.icon} {pass.destination.label}
        </p>
      </div>
      <div className="font-mono text-2xl font-black tabular-nums tracking-tighter">{minutes}:{seconds}</div>
    </button>
  );
}

function TeacherView({ onSwitchRole, teacher, globalPasses, pendingPasses, onApprove, onDeny, onEndPass, onTeacherInitiatePass, isHallwayBusy, classes, todayScheduleData }) {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [currentTime, setCurrentTime] = useState(new Date());

  const [showCreatePassModal, setShowCreatePassModal] = useState(false);
  const [selectedStudentForPass, setSelectedStudentForPass] = useState(null);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  
  const myActivePasses = globalPasses.filter(p => p.teacher.id === teacher.id);
  const otherActivePasses = globalPasses.filter(p => p.teacher.id !== teacher.id);
  
  const currentMins = currentTime.getHours() * 60 + currentTime.getMinutes();
  const activePeriod = todayScheduleData.allPeriods.find(p => {
    const [sh, sm] = p.startTime.split(':').map(Number);
    const [eh, em] = p.endTime.split(':').map(Number);
    return currentMins >= (sh * 60 + sm) && currentMins <= (eh * 60 + em);
  });

  let activeClass = null;
  if (activePeriod) {
    activeClass = classes.find(c => c.teacherId === teacher.id && activePeriod.classIds.includes(c.id));
  }
  
  const isFallback = !activeClass;
  if (!activeClass) {
    activeClass = classes.find(c => c.teacherId === teacher.id) || { roster: [], name: 'No Class Assigned' };
  }

  const availableStudents = activeClass.roster.filter(
    student => !myActivePasses.some(pass => pass.student.id === student.id) &&
               !pendingPasses.some(pass => pass.student.id === student.id)
  );

  const formatTimeStr = (time24) => {
    const [h, m] = time24.split(':');
    const d = new Date();
    d.setHours(h, m);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col md:flex-row">
      <aside className="w-full md:w-64 bg-slate-900 text-white flex flex-col">
        <div className="p-6">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Users className="w-5 h-5 text-purple-400"/> {teacher.name}
          </h2>
          <p className="text-slate-400 text-sm mt-1">Room {teacher.room}</p>
        </div>
        
        <nav className="flex-1 px-4 space-y-2">
          <TeacherNavLink icon={<MapPin />} label="Dashboard" isActive={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
          <TeacherNavLink icon={<UserCheck />} label="Roster & History" isActive={activeTab === 'roster'} onClick={() => setActiveTab('roster')} />
          <TeacherNavLink icon={<BellRing />} label="Bell Settings" isActive={activeTab === 'bells'} onClick={() => setActiveTab('bells')} />
        </nav>

        <div className="p-4 border-t border-slate-800">
          <button onClick={onSwitchRole} className="flex items-center gap-3 w-full p-3 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors">
            <LogOut className="w-5 h-5" /> Back to Portals
          </button>
        </div>
      </aside>

      <main className="flex-1 p-8 overflow-y-auto relative">
        {/* TEACHER INITIATED PASS MODAL */}
        {showCreatePassModal && (
          <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-3xl shadow-xl w-full max-w-4xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
              <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-slate-50">
                <h3 className="font-bold text-2xl text-slate-800">
                  {selectedStudentForPass ? `Where is ${selectedStudentForPass.name} going?` : 'Select Student to Leave Room'}
                </h3>
                <button onClick={() => { setShowCreatePassModal(false); setSelectedStudentForPass(null); }} className="text-slate-400 hover:text-slate-600">
                  <X className="w-6 h-6"/>
                </button>
              </div>
              <div className="p-6 max-h-[60vh] overflow-y-auto">
                {!selectedStudentForPass ? (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {availableStudents.length === 0 && <p className="col-span-full text-center text-slate-500 py-4">No available students.</p>}
                    {availableStudents.map(student => (
                      <button
                        key={student.id}
                        onClick={() => setSelectedStudentForPass(student)}
                        className="bg-white p-4 rounded-xl shadow-sm border-2 border-slate-100 hover:border-purple-500 hover:shadow-md transition-all font-semibold text-slate-700 text-center"
                      >
                        {student.name}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div>
                    <button onClick={() => setSelectedStudentForPass(null)} className="mb-6 text-sm font-bold text-slate-500 hover:text-purple-600 flex items-center gap-1">
                      <ChevronLeft className="w-4 h-4" /> Back to Students
                    </button>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {DESTINATIONS.map(dest => (
                        <button
                          key={dest.id}
                          onClick={() => { 
                            onTeacherInitiatePass(selectedStudentForPass, dest); 
                            setShowCreatePassModal(false); 
                            setSelectedStudentForPass(null); 
                          }}
                          className="bg-white p-6 rounded-2xl shadow-sm border-2 border-slate-100 hover:border-purple-500 transition-all flex flex-col items-center gap-3 relative overflow-hidden"
                        >
                          {isHallwayBusy && dest.id !== 'office' && (
                            <div className="absolute top-0 right-0 bg-orange-100 text-orange-700 text-[10px] px-2 py-1 rounded-bl-lg font-bold">
                              Override Auto-Applied
                            </div>
                          )}
                          <span className="text-4xl">{dest.icon}</span>
                          <span className="font-bold text-slate-700">{dest.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {pendingPasses.length > 0 && (
          <div className="mb-8 bg-yellow-50 border-2 border-yellow-400 rounded-2xl p-6 shadow-md animate-in fade-in slide-in-from-top-4">
            <h3 className="text-xl font-bold text-yellow-800 flex items-center gap-2 mb-4">
              <AlertTriangle className="w-6 h-6" /> Pending Pass Approvals ({pendingPasses.length})
            </h3>
            <div className="space-y-3">
              {pendingPasses.map(pass => (
                <div key={pass.id} className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm border border-yellow-200">
                  <div className="flex items-center gap-4">
                    <span className="text-3xl">{pass.destination.icon}</span>
                    <div>
                      <p className="font-bold text-lg text-slate-800">{pass.student.name}</p>
                      <p className="text-slate-500">Requested to go to the <span className="font-semibold">{pass.destination.label}</span></p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => onDeny(pass.id)} className="px-4 py-2 bg-slate-100 hover:bg-red-100 hover:text-red-700 text-slate-600 font-semibold rounded-lg flex items-center gap-2 transition-colors">
                      <X className="w-5 h-5" /> Deny
                    </button>
                    <button onClick={() => onApprove(pass.id)} className="px-6 py-2 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-lg flex items-center gap-2 shadow-sm transition-colors">
                      <Check className="w-5 h-5" /> Approve
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <header className="mb-8 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-slate-800">Dashboard</h1>
            <p className="text-slate-500 mt-1">Overview of your class and hallway activity.</p>
          </div>
          <button 
            onClick={() => setShowCreatePassModal(true)} 
            className="px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl shadow-sm flex items-center gap-2 transition-colors"
          >
            <Plus className="w-5 h-5" /> Start Pass
          </button>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-8">
            
            <div className={`p-6 rounded-2xl border-2 flex justify-between items-center ${isFallback ? 'bg-slate-50 border-slate-200' : 'bg-purple-50 border-purple-200 shadow-sm'}`}>
              <div>
                <p className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-1">{activePeriod ? activePeriod.name : 'Passing Period / Outside Hours'}</p>
                <h2 className="text-3xl font-black text-slate-800">{activeClass.name}</h2>
              </div>
              <div className="text-right hidden sm:block">
                <p className="text-xl font-bold text-slate-700">{currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                {activePeriod && <p className="text-sm text-slate-500">Ends at {formatTimeStr(activePeriod.endTime)}</p>}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <StatCard title="Present" value={activeClass.roster.length - myActivePasses.length} subtitle="Students in room" color="blue" />
              <StatCard title="Out on Pass" value={myActivePasses.length} subtitle="From your class" color="emerald" />
              <StatCard title="Hall Traffic" value={globalPasses.length} subtitle="School-wide active" color="orange" />
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
              <h3 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2">
                <AlertTriangle className="text-orange-500 w-6 h-6" /> School-Wide Hallway Traffic
              </h3>
              
              {globalPasses.length === 0 && (
                <p className="text-slate-500 text-center py-4 bg-slate-50 rounded-xl border border-slate-100">Hallways are clear.</p>
              )}

              <div className="space-y-3">
                {myActivePasses.map(pass => (
                  <TeacherDashboardPassRow key={pass.id} pass={pass} isMine={true} onEndPass={onEndPass} />
                ))}
                {otherActivePasses.map(pass => (
                  <TeacherDashboardPassRow key={pass.id} pass={pass} isMine={false} />
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-8">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
              <h3 className="text-xl font-bold text-slate-800 mb-4 flex items-center gap-2">
                <BellRing className="w-5 h-5 text-purple-600" /> Active Schedule
              </h3>
              <div className="bg-purple-50 text-purple-800 p-4 rounded-xl border border-purple-100 mb-6">
                <p className="text-sm font-semibold uppercase tracking-wider mb-1">Subscribed To:</p>
                <p className="text-xl font-bold">
                  {todayScheduleData.activeSchedules.map(s => s.name).join(', ') || 'No Schedule Today'}
                </p>
              </div>
              
              <div className="space-y-4 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-200 before:to-transparent">
                {todayScheduleData.allPeriods.length === 0 && (
                   <p className="text-center text-slate-500 italic mt-8">No periods defined for today.</p>
                )}
                {todayScheduleData.allPeriods.map((period) => {
                  const [sh, sm] = period.startTime.split(':').map(Number);
                  const [eh, em] = period.endTime.split(':').map(Number);
                  const startMins = sh * 60 + sm;
                  const endMins = eh * 60 + em;

                  const isPast = currentMins > endMins;
                  const isActive = currentMins >= startMins && currentMins <= endMins;

                  return (
                    <TimelineItem 
                      key={period.id} 
                      time={`${formatTimeStr(period.startTime)} - ${formatTimeStr(period.endTime)}`} 
                      label={period.name} 
                      isActive={isActive} 
                      isPast={isPast} 
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function TeacherDashboardPassRow({ pass, isMine, onEndPass }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(Math.floor((new Date() - pass.startTime) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [pass.startTime]);

  const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const seconds = (elapsed % 60).toString().padStart(2, '0');

  let colorClasses = {
    bg: "bg-emerald-50", border: "border-emerald-100", text: "text-emerald-900",
    sub: "text-emerald-700", badgeBg: "bg-emerald-200", badgeText: "text-emerald-800",
    btn: "bg-emerald-600 hover:bg-emerald-700"
  };

  if (elapsed >= 300 && elapsed < 600) {
    colorClasses = {
      bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-900",
      sub: "text-orange-700", badgeBg: "bg-orange-200", badgeText: "text-orange-800",
      btn: "bg-orange-600 hover:bg-orange-700"
    };
  } else if (elapsed >= 600) {
    colorClasses = {
      bg: "bg-red-50", border: "border-red-200", text: "text-red-900",
      sub: "text-red-700", badgeBg: "bg-red-200", badgeText: "text-red-800",
      btn: "bg-red-600 hover:bg-red-700"
    };
  }

  return (
    <div className={`flex justify-between items-center p-4 rounded-xl border ${colorClasses.bg} ${colorClasses.border} transition-colors duration-500`}>
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-xl shadow-sm">
          {pass.destination.icon}
        </div>
        <div>
          <p className={`font-semibold flex items-center gap-2 ${colorClasses.text}`}>
            {pass.student.name}
            {isMine && <span className={`text-xs px-2 py-0.5 rounded-full ${colorClasses.badgeBg} ${colorClasses.badgeText}`}>Your Class</span>}
            {isMine && <span className="font-mono font-bold tracking-tighter ml-1">{minutes}:{seconds}</span>}
          </p>
          <p className={`text-sm ${colorClasses.sub}`}>
            {isMine ? `To: ${pass.destination.label}` : `${pass.teacher.name} (Rm ${pass.teacher.room}) • ${pass.destination.label}`}
          </p>
        </div>
      </div>
      {isMine && (
        <button onClick={() => onEndPass(pass.id)} className={`px-4 py-2 text-white rounded-lg text-sm font-bold shadow-sm transition-colors ${colorClasses.btn}`}>
          Mark Returned
        </button>
      )}
    </div>
  );
}

function AdminView({ onSwitchRole, globalPasses, passHistory, onEndPass, teachers, onSaveTeacher, onDeleteTeacher, students, onSaveStudent, onDeleteStudent, onBulkAddStudents, onMassDeleteStudents, onClearPassHistory, classes, onSaveClass, onDeleteClass, schedules, onSaveSchedule, onDeleteSchedule, calendarDays, onSaveCalendarDay }) {
  const [activeTab, setActiveTab] = useState('live');

  const [showTeacherModal, setShowTeacherModal] = useState(false);
  const [editingTeacher, setEditingTeacher] = useState(null);
  
  const [showStudentModal, setShowStudentModal] = useState(false);
  const [editingStudent, setEditingStudent] = useState(null);
  const [studentModalDefaultGrade, setStudentModalDefaultGrade] = useState('Fr');
  const [showBulkAddModal, setShowBulkAddModal] = useState(false);
  
  const [showClassModal, setShowClassModal] = useState(false);
  const [editingClass, setEditingClass] = useState(null);

  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(null);

  const [showCalendarModal, setShowCalendarModal] = useState(false);
  const [editingCalendarDay, setEditingCalendarDay] = useState(null);

  const [showDangerZone, setShowDangerZone] = useState(false);

  const handleSaveTeacher = (teacherData) => {
    onSaveTeacher(teacherData);
    setShowTeacherModal(false);
  };

  const handleSaveStudent = (studentData) => {
    onSaveStudent(studentData);
    setShowStudentModal(false);
  };

  const handleSaveClass = (classData) => {
    onSaveClass({ ...classData, roster: classData.roster || [] });
    setShowClassModal(false);
  };

  const handleSaveSchedule = (scheduleData) => {
    onSaveSchedule(scheduleData);
    setShowScheduleModal(false);
  };

  const handleSaveCalendarOverride = (calendarData) => {
    onSaveCalendarDay(calendarData);
    setShowCalendarModal(false);
  };

  const handleDeleteTeacher = (id) => { onDeleteTeacher(id); setShowTeacherModal(false); };
  const handleDeleteStudent = (id) => { onDeleteStudent(id); setShowStudentModal(false); };
  const handleDeleteClass = (id) => { onDeleteClass(id); setShowClassModal(false); };
  const handleDeleteSchedule = (id) => { onDeleteSchedule(id); setShowScheduleModal(false); };

  const gradeOrder = { '7th': 1, '8th': 2, 'Fr': 3, 'So': 4, 'Ju': 5, 'Sr': 6 };
  const sortedStudents = [...students].sort((a, b) => {
    const gradeDiff = (gradeOrder[a.grade] || 99) - (gradeOrder[b.grade] || 99);
    if (gradeDiff !== 0) return gradeDiff;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col md:flex-row">
      <aside className="w-full md:w-64 bg-emerald-950 text-white flex flex-col shadow-xl z-10">
        <div className="p-6">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Shield className="w-6 h-6 text-emerald-400"/> Office Admin
          </h2>
          <p className="text-emerald-400/60 text-sm mt-1">System Management</p>
        </div>
        
        <nav className="flex-1 px-4 space-y-2 mt-4">
          <AdminNavLink icon={<LayoutDashboard />} label="Live Traffic" isActive={activeTab === 'live'} onClick={() => setActiveTab('live')} />
          <AdminNavLink icon={<Users />} label="Staff Directory" isActive={activeTab === 'staff'} onClick={() => setActiveTab('staff')} />
          <AdminNavLink icon={<BookOpen />} label="Classes & Rosters" isActive={activeTab === 'classes'} onClick={() => setActiveTab('classes')} />
          <AdminNavLink icon={<GraduationCap />} label="Student Directory" isActive={activeTab === 'students'} onClick={() => setActiveTab('students')} />
          <AdminNavLink icon={<CalendarDays />} label="Bell Schedules" isActive={activeTab === 'schedule'} onClick={() => setActiveTab('schedule')} />
          <AdminNavLink icon={<TrendingUp />} label="Analytics & Reports" isActive={activeTab === 'reports'} onClick={() => setActiveTab('reports')} />
        </nav>

        <div className="p-4 border-t border-emerald-900/50">
          <button onClick={onSwitchRole} className="flex items-center gap-3 w-full p-3 text-emerald-400 hover:text-white hover:bg-emerald-900/50 rounded-lg transition-colors font-medium">
            <LogOut className="w-5 h-5" /> Back to Portals
          </button>
        </div>
      </aside>

      <main className="flex-1 p-8 overflow-y-auto">
        
        {/* TAB 1: LIVE TRAFFIC */}
        {activeTab === 'live' && (
          <div className="animate-in fade-in duration-300">
            <h2 className="text-3xl font-bold text-slate-800 mb-6">Live School Status</h2>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
              <StatCard title="Total Students Out" value={globalPasses.length} subtitle="Across all classrooms" color="blue" />
              <StatCard title="In Office" value={globalPasses.filter(p => p.destination.id === 'office').length} subtitle="Currently in main office" color="emerald" />
              <StatCard title="In Bathrooms" value={globalPasses.filter(p => p.destination.id === 'bathroom').length} subtitle="School-wide" color="orange" />
              <StatCard title="Other Destinations" value={globalPasses.filter(p => !['office', 'bathroom'].includes(p.destination.id)).length} subtitle="Lockers, Nurse, etc." color="purple" />
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
               <h3 className="text-xl font-bold text-slate-800 mb-6">All Active Passes</h3>
               {globalPasses.length === 0 ? (
                 <p className="text-slate-500 p-4 bg-slate-50 rounded-xl text-center">No active passes currently logged in the school.</p>
               ) : (
                 <table className="w-full text-left">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-200">
                      <th className="pb-3 font-medium px-4">Student</th>
                      <th className="pb-3 font-medium px-4">Teacher / Room</th>
                      <th className="pb-3 font-medium px-4">Destination</th>
                      <th className="pb-3 font-medium px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {globalPasses.map(pass => (
                      <tr key={pass.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors">
                        <td className="py-4 font-semibold text-slate-800 px-4">{pass.student.name}</td>
                        <td className="py-4 text-slate-600 px-4">{pass.teacher.name} <span className="text-sm bg-slate-200 px-2 rounded-md ml-2">Rm {pass.teacher.room}</span></td>
                        <td className="py-4 px-4">
                          <span className="bg-slate-100 text-slate-700 px-3 py-1 rounded-full text-sm font-medium flex items-center gap-2 w-max">
                            {pass.destination.icon} {pass.destination.label}
                          </span>
                        </td>
                        <td className="py-4 text-right px-4">
                           <button onClick={() => onEndPass(pass.id)} className="text-sm bg-red-100 text-red-700 hover:bg-red-200 px-4 py-2 rounded-lg font-bold transition-colors">Force End</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                 </table>
               )}
            </div>
          </div>
        )}

        {/* TAB 2: STAFF */}
        {activeTab === 'staff' && (
          <div className="animate-in fade-in duration-300">
            <header className="mb-8">
              <h2 className="text-3xl font-bold text-slate-800">Staff Directory</h2>
              <p className="text-slate-500 mt-1">Manage personnel and teacher accounts.</p>
            </header>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col h-[600px] max-w-4xl">
              <div className="flex justify-between items-center mb-6 shrink-0">
                <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2"><Users className="w-5 h-5 text-blue-500"/> Teachers</h3>
                <button onClick={() => { setEditingTeacher(null); setShowTeacherModal(true); }} className="text-sm font-bold text-blue-600 bg-blue-50 px-3 py-1 rounded-lg hover:bg-blue-100">+ Add Teacher</button>
              </div>
              <div className="space-y-3 overflow-y-auto flex-1 pr-2">
                {teachers.map(t => (
                  <div key={t.id} className="flex justify-between items-center p-4 hover:bg-slate-50 rounded-xl border border-slate-100 transition-colors">
                    <div>
                      <p className="font-bold text-slate-700 text-lg">{t.name}</p>
                      <p className="text-sm text-slate-500">{t.email || 'No email'} • Room {t.room}</p>
                    </div>
                    <button onClick={() => { setEditingTeacher(t); setShowTeacherModal(true); }} className="text-slate-400 hover:text-blue-600"><Settings className="w-5 h-5" /></button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: CLASSES */}
        {activeTab === 'classes' && (
          <div className="animate-in fade-in duration-300">
            <header className="mb-8">
              <h2 className="text-3xl font-bold text-slate-800">Classes & Rosters</h2>
              <p className="text-slate-500 mt-1">Manage master class lists and student assignments.</p>
            </header>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col h-[600px] max-w-4xl">
              <div className="flex justify-between items-center mb-6 shrink-0">
                <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2"><BookOpen className="w-5 h-5 text-purple-500"/> Master Class List</h3>
                <button onClick={() => { setEditingClass(null); setShowClassModal(true); }} className="text-sm font-bold text-purple-600 bg-purple-50 px-3 py-1 rounded-lg hover:bg-purple-100">+ Add Class</button>
              </div>
              <div className="space-y-3 overflow-y-auto flex-1 pr-2">
                {classes.map(c => {
                  const assignedTeacher = teachers.find(t => t.id === c.teacherId);
                  return (
                    <div key={c.id} className="p-4 rounded-xl border bg-slate-50 border-slate-100 flex justify-between items-center group">
                      <div>
                        <p className="font-bold text-slate-800 text-lg">{c.name}</p>
                        <p className="text-sm text-slate-500">Instructor: {assignedTeacher ? assignedTeacher.name : 'Unassigned'} • {c.roster?.length || 0} Students</p>
                      </div>
                      <button onClick={() => { setEditingClass(c); setShowClassModal(true); }} className="text-slate-400 hover:text-purple-600 transition-colors"><Settings className="w-5 h-5" /></button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: STUDENT DIRECTORY */}
        {activeTab === 'students' && (
          <div className="animate-in fade-in duration-300 flex flex-col h-[calc(100vh-6rem)]">
            <header className="mb-6 shrink-0 flex justify-between items-end">
              <div>
                <h2 className="text-3xl font-bold text-slate-800">Student Directory</h2>
                <p className="text-slate-500 mt-1">Master database of all registered students by grade.</p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowDangerZone(true)} className="px-4 py-2 bg-red-100 text-red-700 hover:bg-red-200 font-bold rounded-lg transition-colors flex items-center gap-2">
                  <Trash className="w-4 h-4" /> Danger Zone
                </button>
                <button onClick={() => setShowBulkAddModal(true)} className="px-4 py-2 bg-slate-800 text-white hover:bg-slate-900 font-bold rounded-lg transition-colors flex items-center gap-2">
                  <Upload className="w-4 h-4" /> Bulk Import
                </button>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto pr-4 space-y-6 pb-12">
              {[
                { key: '7th', label: '7th Grade' },
                { key: '8th', label: '8th Grade' },
                { key: 'Fr', label: 'Freshmen' },
                { key: 'So', label: 'Sophomores' },
                { key: 'Ju', label: 'Juniors' },
                { key: 'Sr', label: 'Seniors' }
              ].map(gradeGroup => {
                const gradeStudents = sortedStudents.filter(s => s.grade === gradeGroup.key);
                return (
                  <div key={gradeGroup.key} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                      <h3 className="font-bold text-slate-700 flex items-center gap-3">
                        <span className={`text-xs px-2.5 py-1 rounded-md font-bold uppercase tracking-wider ${getGradeBadgeClass(gradeGroup.key)}`}>
                          {gradeGroup.key}
                        </span>
                        {gradeGroup.label} ({gradeStudents.length})
                      </h3>
                      <button onClick={() => { setEditingStudent(null); setStudentModalDefaultGrade(gradeGroup.key); setShowStudentModal(true); }} className="text-sm font-bold text-emerald-600 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors border border-emerald-200 hover:border-emerald-300">
                        <Plus className="w-4 h-4" /> Add
                      </button>
                    </div>
                    {gradeStudents.length === 0 ? (
                      <p className="text-slate-400 italic text-sm p-6 text-center bg-white">No students added to this grade yet.</p>
                    ) : (
                      <table className="w-full text-left border-collapse bg-white">
                        <tbody>
                          {gradeStudents.map(s => (
                            <tr key={s.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors">
                              <td className="p-3 pl-6 font-bold text-slate-800">{s.name}</td>
                              <td className="p-3 text-slate-500 font-mono text-sm w-1/3">ID: {s.idNum || 'N/A'}</td>
                              <td className="p-3 pr-6 text-right">
                                <button onClick={() => { setEditingStudent(s); setShowStudentModal(true); }} className="text-slate-400 hover:text-emerald-600 transition-colors bg-white border border-slate-200 hover:border-emerald-200 p-2 rounded-lg shadow-sm">
                                  <Settings className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 5: SCHEDULES & CALENDAR */}
        {activeTab === 'schedule' && (
          <div className="animate-in fade-in duration-300">
            <header className="mb-8">
              <h2 className="text-3xl font-bold text-slate-800">Bell Schedules</h2>
              <p className="text-slate-500 mt-1">Manage bell templates and the school-wide calendar overrides.</p>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Master Calendar */}
              <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col h-[600px]">
                <h3 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2 shrink-0"><CalendarDays className="w-5 h-5 text-blue-500"/> The "When": Active Calendar</h3>
                
                <div className="space-y-2 overflow-y-auto pr-2 flex-1">
                  {calendarDays.map((day) => {
                    return (
                      <div key={day.id} className={`flex items-center justify-between p-4 rounded-xl border ${day.isOverride ? 'bg-orange-50 border-orange-200' : 'bg-slate-50 border-slate-100'}`}>
                        <div className="flex items-center gap-4 w-1/4 min-w-[120px]">
                          <div className={`w-12 h-12 rounded-lg flex flex-col items-center justify-center shrink-0 ${day.isOverride ? 'bg-orange-100 text-orange-800' : 'bg-white text-slate-700 shadow-sm'}`}>
                            <span className="text-xs uppercase font-bold">{day.date.split(' ')[0]}</span>
                            <span className="text-lg font-black leading-none">{day.date.split(' ')[1]}</span>
                          </div>
                          <span className="font-bold text-slate-700 hidden sm:block">{day.day}</span>
                        </div>
                        
                        <div className="flex-1 px-4">
                          <div className="flex items-center gap-2 flex-wrap">
                            {day.scheduleIds.length === 0 ? (
                              <span className="text-slate-400 italic text-sm">No schedules assigned</span>
                            ) : (
                              day.scheduleIds.map(id => {
                                const assignedSchedule = schedules.find(s => s.id === id);
                                return (
                                  <span key={id} className={`font-bold px-3 py-1 rounded-full text-sm ${day.isOverride ? 'bg-orange-200 text-orange-900' : 'bg-slate-200 text-slate-800'}`}>
                                    {assignedSchedule ? assignedSchedule.name : 'Unknown Schedule'}
                                  </span>
                                );
                              })
                            )}
                          </div>
                        </div>

                        <div className="flex flex-col items-end shrink-0 gap-2">
                          {day.isOverride && (
                            <span className="text-orange-600 text-xs font-bold flex items-center gap-1 uppercase tracking-wider"><AlertTriangle className="w-3 h-3"/> Override Active</span>
                          )}
                          <button onClick={() => { setEditingCalendarDay(day); setShowCalendarModal(true); }} className="text-slate-500 hover:text-blue-600 hover:bg-blue-50 px-3 py-1 rounded-lg text-sm font-bold transition-colors">
                            {day.isOverride ? 'Edit Override' : 'Edit'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Bell Templates / Schedules */}
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col h-[600px]">
                <div className="flex justify-between items-center mb-6 shrink-0">
                  <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2"><BellRing className="w-5 h-5 text-purple-500"/> Bell Schedules</h3>
                  <button onClick={() => { setEditingSchedule(null); setShowScheduleModal(true); }} className="text-sm font-bold text-purple-600 bg-purple-50 px-3 py-1 rounded-lg hover:bg-purple-100">+ New</button>
                </div>
                <div className="space-y-4 overflow-y-auto pr-2 flex-1">
                  {schedules.map(sch => (
                    <div key={sch.id} onClick={() => { setEditingSchedule(sch); setShowScheduleModal(true); }} className="p-4 bg-slate-50 rounded-xl border border-slate-100 hover:border-purple-200 transition-colors group cursor-pointer">
                      <p className="font-bold text-slate-800 group-hover:text-purple-700 transition-colors">{sch.name}</p>
                      <p className="text-sm text-slate-500 mt-1">{sch.periods?.length || 0} Periods defined</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 6: ANALYTICS & REPORTS */}
        {activeTab === 'reports' && (
          <div className="animate-in fade-in duration-300 flex flex-col h-[calc(100vh-6rem)]">
            <header className="mb-6 shrink-0 flex justify-between items-end">
              <div>
                <h2 className="text-3xl font-bold text-slate-800">Analytics & Reports</h2>
                <p className="text-slate-500 mt-1">Query historical pass data to find patterns and frequent flyers.</p>
              </div>
              <button onClick={() => setShowDangerZone(true)} className="px-4 py-2 bg-red-100 text-red-700 hover:bg-red-200 font-bold rounded-lg transition-colors flex items-center gap-2">
                <Trash className="w-4 h-4" /> Danger Zone
              </button>
            </header>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex-1 flex flex-col min-h-0">
              <div className="p-4 border-b border-slate-100 flex justify-between items-center shrink-0">
                <h3 className="font-bold text-slate-700">Pass Ledger (Results: {passHistory.length})</h3>
                <button className="text-sm text-emerald-600 font-bold flex items-center gap-2 hover:underline">
                  <Download className="w-4 h-4" /> Export CSV
                </button>
              </div>
              <div className="overflow-y-auto p-0">
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-white shadow-sm z-10">
                    <tr className="text-slate-500 text-sm">
                      <th className="p-4 font-semibold border-b border-slate-200">Date</th>
                      <th className="p-4 font-semibold border-b border-slate-200">Student</th>
                      <th className="p-4 font-semibold border-b border-slate-200">Teacher</th>
                      <th className="p-4 font-semibold border-b border-slate-200">Destination</th>
                      <th className="p-4 font-semibold border-b border-slate-200 text-right">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {passHistory.length === 0 ? (
                       <tr><td colSpan="5" className="p-4 text-center text-slate-500">No pass history recorded yet.</td></tr>
                    ) : (
                      passHistory.map(log => {
                        const startTime = log.startTime ? new Date(log.startTime) : new Date();
                        const endTime = log.endTime ? new Date(log.endTime) : new Date();
                        const durationMs = endTime - startTime;
                        const durationMins = Math.floor(durationMs / 60000);
                        const durationSecs = Math.floor((durationMs % 60000) / 1000).toString().padStart(2, '0');
                        const flag = durationMins >= 10;
                        return (
                          <tr key={log.id} className={`border-b border-slate-50 hover:bg-slate-50 ${flag ? 'bg-red-50/50' : ''}`}>
                            <td className="p-4 text-slate-500 text-sm">{endTime.toLocaleDateString()}</td>
                            <td className="p-4 font-bold text-slate-800">{log.student?.name || 'Unknown'}</td>
                            <td className="p-4 text-slate-600">{log.teacher?.name || 'Unknown'}</td>
                            <td className="p-4 text-slate-600">{log.destination?.label || 'Unknown'}</td>
                            <td className="p-4 text-right">
                              <span className={`font-mono font-bold px-2 py-1 rounded-md ${flag ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'}`}>
                                {durationMins}:{durationSecs}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}

        {/* ADMIN MODALS */}
        {showTeacherModal && (
          <TeacherModal 
            teacher={editingTeacher} 
            onClose={() => setShowTeacherModal(false)} 
            onSave={handleSaveTeacher}
            onDelete={handleDeleteTeacher}
          />
        )}

        {showStudentModal && (
          <StudentModal 
            key={editingStudent ? editingStudent.id : 'new-' + studentModalDefaultGrade}
            student={editingStudent} 
            defaultGrade={studentModalDefaultGrade}
            onClose={() => setShowStudentModal(false)} 
            onSave={handleSaveStudent}
            onDelete={handleDeleteStudent}
          />
        )}

        {showBulkAddModal && (
           <BulkAddModal 
             onClose={() => setShowBulkAddModal(false)}
             onSave={onBulkAddStudents}
           />
        )}

        {showDangerZone && (
           <DangerZoneModal
             onClose={() => setShowDangerZone(false)}
             onMassDelete={onMassDeleteStudents}
             onClearHistory={onClearPassHistory}
           />
        )}

        {showClassModal && (
          <ClassModal 
            classItem={editingClass}
            teachers={teachers}
            students={students}
            onClose={() => setShowClassModal(false)} 
            onSave={handleSaveClass}
            onDelete={handleDeleteClass}
          />
        )}

        {showScheduleModal && (
          <ScheduleModal
            schedule={editingSchedule}
            classes={classes}
            onClose={() => setShowScheduleModal(false)}
            onSave={handleSaveSchedule}
            onDelete={handleDeleteSchedule}
          />
        )}

        {showCalendarModal && (
          <CalendarOverrideModal
            dayItem={editingCalendarDay}
            schedules={schedules}
            onClose={() => setShowCalendarModal(false)}
            onSave={handleSaveCalendarOverride}
          />
        )}
      </main>
    </div>
  );
}

// Custom Nav Link for Admin Sidebar to keep colors distinct from Teacher view
function AdminNavLink({ icon, label, isActive, onClick }) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
        isActive 
          ? 'bg-emerald-500 text-white font-bold shadow-md' 
          : 'text-emerald-400/70 hover:bg-emerald-900/50 hover:text-emerald-200'
      }`}
    >
      {React.cloneElement(icon, { className: 'w-5 h-5' })}
      {label}
    </button>
  );
}

function TeacherNavLink({ icon, label, isActive, onClick }) {
  return (
    <button onClick={onClick} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${isActive ? 'bg-purple-600 text-white font-semibold' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}>
      {React.cloneElement(icon, { className: 'w-5 h-5' })} {label}
    </button>
  );
}

function StatCard({ title, value, subtitle, color }) {
  const colorMap = { blue: 'bg-blue-50 text-blue-700 border-blue-100', emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100', orange: 'bg-orange-50 text-orange-700 border-orange-100', purple: 'bg-purple-50 text-purple-700 border-purple-100' };
  return (
    <div className={`p-5 rounded-2xl border ${colorMap[color]}`}>
      <h4 className="text-sm font-semibold opacity-80 mb-1">{title}</h4>
      <p className="text-4xl font-black mb-1">{value}</p>
      <p className="text-xs opacity-70 font-medium">{subtitle}</p>
    </div>
  );
}

function TimelineItem({ time, label, isActive, isPast }) {
  return (
    <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
      <div className={`flex items-center justify-center w-3 h-3 rounded-full border-2 border-white shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10 ${isActive ? 'bg-purple-600 w-4 h-4' : isPast ? 'bg-slate-400' : 'bg-slate-200'}`}></div>
      <div className={`w-[calc(100%-2rem)] md:w-[calc(50%-1.5rem)] p-3 rounded-lg border ${isActive ? 'bg-purple-600 text-white border-purple-600 shadow-md transform scale-105 transition-transform' : isPast ? 'bg-slate-50 text-slate-400 border-slate-100' : 'bg-white text-slate-600 border-slate-200'}`}>
        <div className="flex justify-between items-center">
          <span className="font-bold">{label}</span>
          <span className={`text-sm ${isActive ? 'text-purple-200' : 'text-slate-400'}`}>{time}</span>
        </div>
      </div>
    </div>
  );
}

// --- ADMIN MODAL COMPONENTS ---

function BulkAddModal({ onClose, onSave }) {
  const [csvText, setCsvText] = useState('');

  const handleProcessCSV = () => {
    const lines = csvText.split('\n');
    const newStudents = lines.map(line => {
       // Now only expects Name and Grade
       const [name, grade] = line.split(',').map(s => s?.trim());
       if(name) return { name, grade: grade || 'Fr' };
       return null;
    }).filter(Boolean);
    
    if(newStudents.length > 0) {
       onSave(newStudents);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="flex justify-between items-center p-4 border-b border-slate-100 bg-slate-50">
          <h3 className="font-bold text-lg text-slate-800">Bulk Import Students</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5"/></button>
        </div>
        <div className="p-6">
          <p className="text-slate-600 mb-4 text-sm">
            Paste your student data below. Format each line as: <strong>Name, Grade</strong>
            <br/><span className="text-xs text-slate-400">(Grades must match exactly: 7th, 8th, Fr, So, Ju, Sr)</span>
          </p>
          <textarea 
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder="John Doe, Fr&#10;Jane Smith, So"
            className="w-full h-64 p-4 font-mono text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-200 rounded-lg transition-colors">Cancel</button>
          <button onClick={handleProcessCSV} className="px-6 py-2 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-700 transition-colors shadow-sm">Import Students</button>
        </div>
      </div>
    </div>
  );
}

function DangerZoneModal({ onClose, onMassDelete, onClearHistory }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  const handleAction = (actionType) => {
     if(pin === '8631') {
        if(actionType === 'deleteStudents') onMassDelete();
        if(actionType === 'clearHistory') onClearHistory();
        onClose();
     } else {
        setError(true);
        setPin('');
     }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200 border-4 border-red-500">
        <div className="flex justify-between items-center p-4 border-b border-red-100 bg-red-50">
          <h3 className="font-bold text-lg text-red-800 flex items-center gap-2"><AlertTriangle className="w-5 h-5"/> Danger Zone</h3>
          <button onClick={onClose} className="text-red-400 hover:text-red-600"><X className="w-5 h-5"/></button>
        </div>
        <div className="p-6">
          <p className="text-slate-600 mb-6 text-sm text-center">
            These actions are permanent. To proceed, please enter the Admin PIN (8631).
          </p>
          <div className="flex justify-center mb-6">
             <input 
               type="password" 
               value={pin} 
               onChange={(e) => { setPin(e.target.value); setError(false); }}
               placeholder="Enter Admin PIN" 
               className={`text-center px-4 py-2 bg-slate-50 border ${error ? 'border-red-500 bg-red-50' : 'border-slate-300'} rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 font-mono tracking-widest`}
             />
          </div>
          <div className="space-y-3">
             <button onClick={() => handleAction('clearHistory')} className="w-full py-3 bg-orange-100 text-orange-700 font-bold rounded-lg hover:bg-orange-200 transition-colors border border-orange-200">
               Clear All Pass History
             </button>
             <button onClick={() => handleAction('deleteStudents')} className="w-full py-3 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition-colors shadow-sm">
               Delete ALL Students & Rosters
             </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TeacherModal({ teacher, onClose, onSave, onDelete }) {
  const [formData, setFormData] = useState(teacher || { name: '', room: '', pin: '' });
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="flex justify-between items-center p-4 border-b border-slate-100 bg-slate-50">
          <h3 className="font-bold text-lg text-slate-800">{teacher ? 'Edit Teacher' : 'Add New Teacher'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5"/></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-bold text-slate-600 mb-1">Name</label>
            <input name="name" value={formData.name} onChange={handleChange} placeholder="e.g. Mr. Davis" className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-bold text-slate-600 mb-1">Room #</label>
              <input name="room" value={formData.room} onChange={handleChange} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-600 mb-1">Login PIN</label>
              <input name="pin" value={formData.pin} onChange={handleChange} placeholder="e.g. 1" className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
        </div>
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-between items-center gap-3">
          <div className="flex-1">
            {teacher && !confirmDelete && (
              <button onClick={() => setConfirmDelete(true)} className="px-4 py-2 text-red-600 font-bold hover:bg-red-50 rounded-lg transition-colors">Delete</button>
            )}
            {teacher && confirmDelete && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-600 font-bold mr-2">Are you sure?</span>
                <button onClick={() => onDelete(teacher.id)} className="px-4 py-2 bg-red-600 text-white font-bold hover:bg-red-700 rounded-lg transition-colors">Yes, Delete</button>
                <button onClick={() => setConfirmDelete(false)} className="px-3 py-2 text-slate-600 font-bold hover:bg-slate-200 rounded-lg transition-colors">Cancel</button>
              </div>
            )}
          </div>
          {!confirmDelete && (
            <div className="flex gap-2">
              <button onClick={onClose} className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-200 rounded-lg transition-colors">Cancel</button>
              <button onClick={() => onSave(formData)} className="px-6 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-colors shadow-sm">Save</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StudentModal({ student, defaultGrade, onClose, onSave, onDelete }) {
  // Removed idNum from initial state
  const [formData, setFormData] = useState(student || { name: '', grade: defaultGrade || 'Fr' });
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="flex justify-between items-center p-4 border-b border-slate-100 bg-slate-50">
          <h3 className="font-bold text-lg text-slate-800">{student ? 'Edit Student' : 'Add New Student'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5"/></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-bold text-slate-600 mb-1">Full Name</label>
            <input name="name" value={formData.name} onChange={handleChange} placeholder="e.g. John Doe" className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500" />
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-600 mb-1">Grade Level</label>
            <select name="grade" value={formData.grade} onChange={handleChange} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500">
              <option value="7th">7th Grade</option>
              <option value="8th">8th Grade</option>
              <option value="Fr">Freshman (Fr)</option>
              <option value="So">Sophomore (So)</option>
              <option value="Ju">Junior (Ju)</option>
              <option value="Sr">Senior (Sr)</option>
            </select>
          </div>
        </div>
        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-between items-center gap-3">
          <div className="flex-1">
            {student && !confirmDelete && (
              <button onClick={() => setConfirmDelete(true)} className="px-4 py-2 text-red-600 font-bold hover:bg-red-50 rounded-lg transition-colors">Delete</button>
            )}
            {student && confirmDelete && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-600 font-bold mr-2">Are you sure?</span>
                <button onClick={() => onDelete(student.id)} className="px-4 py-2 bg-red-600 text-white font-bold hover:bg-red-700 rounded-lg transition-colors">Yes, Delete</button>
                <button onClick={() => setConfirmDelete(false)} className="px-3 py-2 text-slate-600 font-bold hover:bg-slate-200 rounded-lg transition-colors">Cancel</button>
              </div>
            )}
          </div>
          {!confirmDelete && (
            <div className="flex gap-2">
              <button onClick={onClose} className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-200 rounded-lg transition-colors">Cancel</button>
              <button onClick={() => onSave(formData)} className="px-6 py-2 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-700 transition-colors shadow-sm">Save</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ClassModal({ classItem, teachers, students, onClose, onSave, onDelete }) {
  const [formData, setFormData] = useState(classItem || { name: '', teacherId: '', roster: [] });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [gradeFilter, setGradeFilter] = useState('All');

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleAddStudent = (student) => {
    setFormData({ ...formData, roster: [...formData.roster, student] });
  };

  const handleRemoveStudent = (studentId) => {
    setFormData({ ...formData, roster: formData.roster.filter(s => s.id !== studentId) });
  };

  const assignedIds = formData.roster.map(s => s.id);
  const availableStudents = students.filter(s => !assignedIds.includes(s.id));
  const filteredAvailable = gradeFilter === 'All' 
    ? availableStudents 
    : availableStudents.filter(s => s.grade === gradeFilter);

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
        <div className="flex justify-between items-center p-4 border-b border-slate-100 bg-slate-50 shrink-0">
          <h3 className="font-bold text-lg text-slate-800">{classItem ? 'Edit Class & Roster' : 'Add New Class'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5"/></button>
        </div>
        
        <div className="p-6 overflow-y-auto flex-1 flex flex-col">
          <div className="grid grid-cols-2 gap-6 mb-6 shrink-0">
            <div>
              <label className="block text-sm font-bold text-slate-600 mb-1">Class Name</label>
              <input name="name" value={formData.name} onChange={handleChange} placeholder="e.g. Biology 101" className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500" />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-600 mb-1">Assigned Instructor</label>
              <select name="teacherId" value={formData.teacherId} onChange={handleChange} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500">
                <option value="">-- Select Instructor --</option>
                {teachers.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex-1 min-h-[350px] border-t border-slate-100 pt-6 flex flex-col">
            <h4 className="font-bold text-slate-700 mb-4">Roster Management</h4>
            <div className="grid grid-cols-2 gap-8 flex-1 h-full">
              
              {/* Available Students Column */}
              <div className="flex flex-col h-full bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
                <div className="p-3 border-b border-slate-200 bg-white flex justify-between items-center shrink-0">
                  <span className="font-bold text-slate-600 text-sm">Available Students</span>
                  <select value={gradeFilter} onChange={e => setGradeFilter(e.target.value)} className="text-sm px-2 py-1 bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-emerald-500 font-medium">
                    <option value="All">All Grades</option>
                    <option value="7th">7th Grade</option>
                    <option value="8th">8th Grade</option>
                    <option value="Fr">Freshmen (Fr)</option>
                    <option value="So">Sophomores (So)</option>
                    <option value="Ju">Juniors (Ju)</option>
                    <option value="Sr">Seniors (Sr)</option>
                  </select>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {filteredAvailable.map(s => (
                    <button key={s.id} onClick={() => handleAddStudent(s)} className="w-full flex justify-between items-center p-2 bg-white rounded-lg border border-slate-200 hover:border-emerald-400 hover:shadow-md transition-all text-left group">
                      <div>
                        <p className="font-semibold text-slate-700">{s.name}</p>
                        <p className="text-xs text-slate-400 font-mono">ID: {s.idNum || 'N/A'}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase ${getGradeBadgeClass(s.grade)}`}>
                          {s.grade}
                        </span>
                        <div className="w-7 h-7 rounded-full bg-slate-50 group-hover:bg-emerald-100 text-slate-400 group-hover:text-emerald-600 flex items-center justify-center transition-colors">
                           <Plus className="w-4 h-4" />
                        </div>
                      </div>
                    </button>
                  ))}
                  {filteredAvailable.length === 0 && (
                    <p className="text-center text-slate-400 text-sm py-8 font-medium">No available students found.</p>
                  )}
                </div>
              </div>

              {/* Assigned Students Column */}
              <div className="flex flex-col h-full bg-purple-50/30 rounded-xl border border-purple-100 overflow-hidden">
                <div className="p-3 border-b border-purple-100 bg-white flex justify-between items-center shrink-0">
                  <span className="font-bold text-purple-800 text-sm">Assigned to Class</span>
                  <span className="text-xs font-bold bg-purple-100 text-purple-700 px-3 py-1 rounded-full">{formData.roster.length} Students</span>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {formData.roster.map(s => (
                    <button key={s.id} onClick={() => handleRemoveStudent(s.id)} className="w-full flex justify-between items-center p-2 bg-white rounded-lg border border-purple-100 hover:border-red-300 hover:bg-red-50 transition-all text-left group">
                       <div>
                        <p className="font-semibold text-slate-700 group-hover:text-red-700">{s.name}</p>
                        <p className="text-xs text-slate-400 group-hover:text-red-400 font-mono">ID: {s.idNum || 'N/A'}</p>
                      </div>
                      <div className="w-7 h-7 rounded-full bg-slate-50 group-hover:bg-red-200 text-slate-400 group-hover:text-red-600 flex items-center justify-center transition-colors">
                         <X className="w-4 h-4" />
                      </div>
                    </button>
                  ))}
                  {formData.roster.length === 0 && (
                    <p className="text-center text-purple-400 text-sm py-8 font-medium">Roster is currently empty.</p>
                  )}
                </div>
              </div>

            </div>
          </div>
        </div>

        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-between items-center gap-3 shrink-0">
          <div className="flex-1">
            {classItem && !confirmDelete && (
              <button onClick={() => setConfirmDelete(true)} className="px-4 py-2 text-red-600 font-bold hover:bg-red-50 rounded-lg transition-colors">Delete Class</button>
            )}
            {classItem && confirmDelete && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-600 font-bold mr-2">Are you sure?</span>
                <button onClick={() => onDelete(classItem.id)} className="px-4 py-2 bg-red-600 text-white font-bold hover:bg-red-700 rounded-lg transition-colors">Yes, Delete</button>
                <button onClick={() => setConfirmDelete(false)} className="px-3 py-2 text-slate-600 font-bold hover:bg-slate-200 rounded-lg transition-colors">Cancel</button>
              </div>
            )}
          </div>
          {!confirmDelete && (
            <div className="flex gap-2">
              <button onClick={onClose} className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-200 rounded-lg transition-colors">Cancel</button>
              <button onClick={() => onSave(formData)} className="px-6 py-2 bg-purple-600 text-white font-bold rounded-lg hover:bg-purple-700 transition-colors shadow-sm">Save Roster</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ScheduleModal({ schedule, classes, onClose, onSave, onDelete }) {
  const [formData, setFormData] = useState(schedule || { name: '', defaultDays: [], periods: [] });
  const [confirmDelete, setConfirmDelete] = useState(false);

  const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleToggleDay = (day) => {
    const currentDays = formData.defaultDays || [];
    if (currentDays.includes(day)) {
      setFormData({ ...formData, defaultDays: currentDays.filter(d => d !== day) });
    } else {
      setFormData({ ...formData, defaultDays: [...currentDays, day] });
    }
  };

  const handleAddPeriod = () => {
    const newPeriod = {
      id: 'p_' + Date.now(),
      name: `Period ${formData.periods.length + 1}`,
      startTime: '08:00',
      endTime: '09:00',
      classIds: []
    };
    setFormData({ ...formData, periods: [...formData.periods, newPeriod] });
  };

  const handleRemovePeriod = (periodId) => {
    setFormData({ ...formData, periods: formData.periods.filter(p => p.id !== periodId) });
  };

  const handlePeriodChange = (periodId, field, value) => {
    setFormData({
      ...formData,
      periods: formData.periods.map(p => p.id === periodId ? { ...p, [field]: value } : p)
    });
  };

  const handleToggleClass = (periodId, classId) => {
    setFormData({
      ...formData,
      periods: formData.periods.map(p => {
        if (p.id === periodId) {
          const isAssigned = p.classIds.includes(classId);
          return {
            ...p,
            classIds: isAssigned ? p.classIds.filter(id => id !== classId) : [...p.classIds, classId]
          };
        }
        return p;
      })
    });
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
        
        <div className="flex justify-between items-center p-4 border-b border-slate-100 bg-slate-50 shrink-0">
          <h3 className="font-bold text-lg text-slate-800">{schedule ? 'Edit Schedule & Periods' : 'Create New Schedule'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5"/></button>
        </div>
        
        <div className="p-6 overflow-y-auto flex-1 flex flex-col">
          <div className="mb-6 shrink-0">
            <label className="block text-sm font-bold text-slate-600 mb-1">Schedule Name</label>
            <input name="name" value={formData.name} onChange={handleChange} placeholder="e.g. Standard Mon/Wed/Fri" className="w-full max-w-md px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500" />
          </div>

          <div className="mb-6 shrink-0">
            <label className="block text-sm font-bold text-slate-600 mb-2">Default Days Active</label>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map(day => {
                const isActive = (formData.defaultDays || []).includes(day);
                return (
                  <button
                    key={day}
                    onClick={() => handleToggleDay(day)}
                    className={`px-4 py-2 rounded-lg text-sm font-bold transition-all border ${
                      isActive 
                        ? 'bg-purple-100 text-purple-700 border-purple-200 shadow-sm' 
                        : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex-1 flex flex-col border-t border-slate-100 pt-6">
            <div className="flex justify-between items-center mb-4 shrink-0">
              <h4 className="font-bold text-slate-700">Class Periods</h4>
              <button onClick={handleAddPeriod} className="text-sm font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100 flex items-center gap-1 transition-colors">
                <PlusCircle className="w-4 h-4" /> Add Period
              </button>
            </div>
            
            <div className="space-y-6">
              {formData.periods.length === 0 ? (
                <div className="p-8 border-2 border-dashed border-slate-200 rounded-xl text-center">
                  <p className="text-slate-500 font-medium">No periods added yet. Click "Add Period" to build your schedule.</p>
                </div>
              ) : (
                formData.periods.map((period, index) => (
                  <div key={period.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                    {/* Period Header / Time Inputs */}
                    <div className="bg-slate-50 p-4 border-b border-slate-200 flex flex-wrap items-end gap-4">
                      <div className="flex-1 min-w-[200px]">
                        <label className="block text-xs font-bold text-slate-500 mb-1">Period Label</label>
                        <input value={period.name} onChange={(e) => handlePeriodChange(period.id, 'name', e.target.value)} placeholder="e.g. Period 1" className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-purple-500 text-sm font-bold text-slate-800" />
                      </div>
                      <div className="w-32">
                        <label className="block text-xs font-bold text-slate-500 mb-1">Start Time</label>
                        <input type="time" value={period.startTime} onChange={(e) => handlePeriodChange(period.id, 'startTime', e.target.value)} className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-purple-500 text-sm" />
                      </div>
                      <div className="w-32">
                        <label className="block text-xs font-bold text-slate-500 mb-1">End Time</label>
                        <input type="time" value={period.endTime} onChange={(e) => handlePeriodChange(period.id, 'endTime', e.target.value)} className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-purple-500 text-sm" />
                      </div>
                      <button onClick={() => handleRemovePeriod(period.id)} className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors h-[34px] flex items-center justify-center" title="Delete Period">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    
                    {/* Assigned Classes Grid */}
                    <div className="p-4">
                      <p className="text-xs font-bold text-slate-500 mb-3 uppercase tracking-wider">Classes happening during this time:</p>
                      <div className="flex flex-wrap gap-2">
                        {classes.length === 0 ? (
                          <span className="text-sm text-slate-400 italic">No classes exist in the system yet.</span>
                        ) : (
                          classes.map(c => {
                            const isAssigned = period.classIds.includes(c.id);
                            return (
                              <button
                                key={c.id}
                                onClick={() => handleToggleClass(period.id, c.id)}
                                className={`text-sm px-3 py-1.5 rounded-lg border font-medium transition-all flex items-center gap-1.5 ${
                                  isAssigned 
                                    ? 'bg-purple-100 border-purple-200 text-purple-800 shadow-sm' 
                                    : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                                }`}
                              >
                                {isAssigned && <Check className="w-3.5 h-3.5" />}
                                {c.name}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-between items-center gap-3 shrink-0">
          <div className="flex-1">
            {schedule && !confirmDelete && (
              <button onClick={() => setConfirmDelete(true)} className="px-4 py-2 text-red-600 font-bold hover:bg-red-50 rounded-lg transition-colors">Delete Schedule</button>
            )}
            {schedule && confirmDelete && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-600 font-bold mr-2">Are you sure?</span>
                <button onClick={() => onDelete(schedule.id)} className="px-4 py-2 bg-red-600 text-white font-bold hover:bg-red-700 rounded-lg transition-colors">Yes, Delete</button>
                <button onClick={() => setConfirmDelete(false)} className="px-3 py-2 text-slate-600 font-bold hover:bg-slate-200 rounded-lg transition-colors">Cancel</button>
              </div>
            )}
          </div>
          {!confirmDelete && (
            <div className="flex gap-2">
              <button onClick={onClose} className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-200 rounded-lg transition-colors">Cancel</button>
              <button onClick={() => onSave(formData)} className="px-6 py-2 bg-purple-600 text-white font-bold rounded-lg hover:bg-purple-700 transition-colors shadow-sm">Save Schedule</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CalendarOverrideModal({ dayItem, schedules, onClose, onSave }) {
  const [selectedIds, setSelectedIds] = useState(dayItem?.scheduleIds || []);

  if (!dayItem) return null;

  const handleToggleSchedule = (scheduleId) => {
    if (selectedIds.includes(scheduleId)) {
      setSelectedIds(selectedIds.filter(id => id !== scheduleId));
    } else {
      setSelectedIds([...selectedIds, scheduleId]);
    }
  };

  const handleSave = () => {
    onSave({ ...dayItem, scheduleIds: selectedIds, isOverride: true });
  };

  const handleReset = () => {
    onSave({ ...dayItem, scheduleIds: [], isOverride: false });
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="flex justify-between items-center p-4 border-b border-slate-100 bg-slate-50">
          <h3 className="font-bold text-lg text-slate-800">Edit Schedule for {dayItem.date}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5"/></button>
        </div>
        
        <div className="p-6">
          <p className="text-slate-500 mb-6">Select which schedules should be actively running on <span className="font-bold text-slate-700">{dayItem.day}, {dayItem.date}</span>. You can select multiple.</p>
          
          <div className="space-y-3 max-h-[40vh] overflow-y-auto pr-2">
            {schedules.length === 0 ? (
              <p className="text-slate-400 italic text-center py-4">No schedules have been created yet.</p>
            ) : (
              schedules.map(sch => {
                const isActive = selectedIds.includes(sch.id);
                return (
                  <button
                    key={sch.id}
                    onClick={() => handleToggleSchedule(sch.id)}
                    className={`w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all text-left ${
                      isActive 
                        ? 'border-blue-500 bg-blue-50' 
                        : 'border-slate-100 bg-white hover:border-slate-200'
                    }`}
                  >
                    <div>
                      <p className={`font-bold ${isActive ? 'text-blue-800' : 'text-slate-700'}`}>{sch.name}</p>
                      <p className={`text-sm ${isActive ? 'text-blue-600/70' : 'text-slate-500'}`}>{sch.periods.length} Periods Defined</p>
                    </div>
                    <div className={`w-6 h-6 rounded-md flex items-center justify-center border-2 ${
                      isActive ? 'bg-blue-500 border-blue-500 text-white' : 'border-slate-300'
                    }`}>
                      {isActive && <Check className="w-4 h-4" />}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-between items-center gap-3">
          <button onClick={handleReset} className="px-4 py-2 text-slate-500 font-bold hover:bg-slate-200 rounded-lg transition-colors text-sm">
            Clear Override (Restore Default)
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-200 rounded-lg transition-colors">Cancel</button>
            <button onClick={handleSave} className="px-6 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 transition-colors shadow-sm">Save Overrides</button>
          </div>
        </div>
      </div>
    </div>
  );
}
