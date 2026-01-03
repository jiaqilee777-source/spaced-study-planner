const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

const form = document.getElementById('planForm');
const statusEl = document.getElementById('status');
const daysLeftChip = document.getElementById('daysLeftChip');
const emptyState = document.getElementById('emptyState');
const scheduleWrap = document.getElementById('scheduleWrap');

const saveBtn = document.getElementById('saveBtn');
const loadBtn = document.getElementById('loadBtn');
const clearBtn = document.getElementById('clearBtn');
const exportBtn = document.getElementById('exportBtn');
const copyBtn = document.getElementById('copyBtn');

const STORAGE_KEY = 'ssp.learning.shifts.v4';

function $(id){ return document.getElementById(id); }
function setStatus(msg){ statusEl.textContent = msg; }

function toDateOnly(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function parseDateInput(value){
  const [y,m,day] = value.split('-').map(Number);
  return new Date(y, m-1, day);
}
function formatDate(d){
  return d.toLocaleDateString(undefined, { weekday:'short', year:'numeric', month:'short', day:'numeric' });
}
function weekdayShort(d){
  return d.toLocaleDateString('en-US', { weekday:'short' }); // Mon...
}
function daysBetween(a,b){
  const ms = 24*60*60*1000;
  return Math.round((toDateOnly(b) - toDateOnly(a))/ms);
}

function timeToMinutes(t){
  const [h,m] = t.split(':').map(Number);
  return h*60 + m;
}
function minutesToTime(mins){
  mins = Math.max(0, Math.min(mins, 24*60));
  const h = Math.floor(mins/60);
  const m = mins%60;
  return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
}
function addMinutes(t, add){ return minutesToTime(timeToMinutes(t) + add); }

function clamp(n,min,max){ return Math.max(min, Math.min(max,n)); }

function difficultyProfile(level){
  if(level === 'easy') return { sessionsPerWeek: 4, reviewBoost: 0 };
  if(level === 'hard') return { sessionsPerWeek: 6, reviewBoost: 1 };
  return { sessionsPerWeek: 5, reviewBoost: 0.5 };
}

function preferredWindows(pref){
  if(pref === 'morning') return [[timeToMinutes('06:00'), timeToMinutes('10:00')]];
  if(pref === 'lunch') return [[timeToMinutes('11:30'), timeToMinutes('13:30')]];
  if(pref === 'evening') return [[timeToMinutes('18:00'), timeToMinutes('22:00')]];
  // any
  return [[timeToMinutes('06:00'), timeToMinutes('22:00')]];
}

function parseBlocks(text){
  // "09:00-13:00, 14:00-18:00"
  const blocks = [];
  const raw = (text || '').split(',').map(s => s.trim()).filter(Boolean);
  for(const part of raw){
    const m = part.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
    if(!m) continue;
    let s = timeToMinutes(m[1]);
    let e = timeToMinutes(m[2]);
    if(e <= s) continue;
    blocks.push([s,e]);
  }
  blocks.sort((a,b)=>a[0]-b[0]);
  const merged = [];
  for(const b of blocks){
    if(!merged.length || b[0] > merged[merged.length-1][1]) merged.push(b);
    else merged[merged.length-1][1] = Math.max(merged[merged.length-1][1], b[1]);
  }
  return merged;
}

function subtractIntervals(windows, busy){
  let free = windows.slice();
  for(const [bs,be] of busy){
    const next = [];
    for(const [fs,fe] of free){
      if(be <= fs || bs >= fe){
        next.push([fs,fe]);
        continue;
      }
      if(bs > fs) next.push([fs, bs]);
      if(be < fe) next.push([be, fe]);
    }
    free = next;
    if(!free.length) break;
  }
  return free;
}

function pickSlot(freeWindows, minutesNeeded){
  for(const [s,e] of freeWindows){
    if(e - s >= minutesNeeded) return [s, s + minutesNeeded];
  }
  return null;
}

function buildTaskBreakdown(phase){
  // Learning-product style: clear objective + steps
  if(phase <= 0.25){
    return [
      'Objective: understand the requirements',
      'Read/watch lesson content (focus on key terms)',
      'Write 5 key takeaways in your own words'
    ];
  }
  if(phase <= 0.55){
    return [
      'Objective: strengthen memory through retrieval',
      'Active recall (self-quiz) for 10 minutes',
      'Fix weak spots (targeted re-read only)'
    ];
  }
  if(phase <= 0.80){
    return [
      'Objective: produce a working draft',
      'Draft the main section (no perfection)',
      'Revise 1–2 items based on rubric'
    ];
  }
  return [
    'Objective: finalize and submit confidently',
    'Final edit (grammar + formatting)',
    'Check submission steps, then submit early'
  ];
}

function buildSpacedIndices(totalDays, targetSessions){
  const chosen = new Set([0, totalDays-1]);
  const gaps = [];
  for(let g=1; g<=10; g++) gaps.push(g,g);

  let idx=0;
  for(let i=0; i<gaps.length && chosen.size<targetSessions; i++){
    idx += gaps[i];
    if(idx >= totalDays-1) break;
    chosen.add(idx);
  }
  if(chosen.size < targetSessions){
    const remaining = targetSessions - chosen.size;
    for(let k=1; k<=remaining; k++){
      const pos = Math.round((k*(totalDays-2))/(remaining+1));
      chosen.add(clamp(pos,1,totalDays-2));
    }
  }
  return Array.from(chosen).sort((a,b)=>a-b);
}

function buildWeekTable(){
  const tbody = $('weekTable');
  tbody.innerHTML = '';
  for(const d of DAYS){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${d}</td>
      <td><input class="schedInput" id="work_${d}" placeholder="e.g., 09:00-17:00" /></td>
      <td><input class="schedInput" id="class_${d}" placeholder="e.g., 18:00-19:15" /></td>
    `;
    tbody.appendChild(tr);
  }
}

function gatherWeekInputs(){
  const week = {};
  for(const d of DAYS){
    const work = parseBlocks($(`work_${d}`).value);
    const cls = parseBlocks($(`class_${d}`).value);
    week[d] = { work, cls };
  }
  return week;
}

function gatherInputs(){
  const courseName = $('courseName').value.trim();
  const dueInput = $('dueDate').value;
  const sessionMinutes = Number($('sessionMinutes').value);
  const difficulty = $('difficulty').value;
  const preference = $('preference').value;
  const timezone = $('timezone').value;

  const gatherDay = $('gatherDay').value || '';
  const gatherStart = $('gatherStart').value || '';
  const gatherMinutes = Number($('gatherMinutes').value || 60);

  if(!courseName) throw new Error('Enter a course/project name.');
  if(!dueInput) throw new Error('Choose a due date.');
  if(!Number.isFinite(sessionMinutes) || sessionMinutes <= 0) throw new Error('Enter valid session minutes.');

  return {
    courseName,
    dueDate: parseDateInput(dueInput),
    sessionMinutes,
    difficulty,
    preference,
    timezone,
    gatherDay,
    gatherStart,
    gatherMinutes,
    week: gatherWeekInputs()
  };
}

function generatePlan(inputs){
  const today = toDateOnly(new Date());
  const due = toDateOnly(inputs.dueDate);
  const daysLeft = daysBetween(today, due);
  if(daysLeft < 0) throw new Error('Due date is in the past. Choose a future date.');

  const totalDays = Math.max(1, daysLeft + 1);
  const profile = difficultyProfile(inputs.difficulty);
  const weeks = totalDays / 7;
  const baseSessions = Math.round(weeks * profile.sessionsPerWeek);
  const minSessions = clamp(Math.round(totalDays * 0.6), 1, totalDays);
  const targetSessions = clamp(baseSessions + Math.round(profile.reviewBoost * weeks), minSessions, totalDays);

  const indices = buildSpacedIndices(totalDays, targetSessions);

  const prefWins = preferredWindows(inputs.preference);
  const fallbackWins = preferredWindows('any');

  const sessions = indices.map(di => {
    const date = new Date(today);
    date.setDate(today.getDate() + di);
    const wd = weekdayShort(date);
    const phase = di / (totalDays - 1 || 1);
    const minutesNeeded = Math.round(inputs.sessionMinutes * (phase > 0.85 ? 1.2 : 1.0));

    // busy blocks: work + class + gathering
    const dayInfo = inputs.week[wd] || { work:[], cls:[] };
    const busy = [...dayInfo.work, ...dayInfo.cls];

    if(inputs.gatherDay && inputs.gatherDay === wd && inputs.gatherStart){
      const gs = timeToMinutes(inputs.gatherStart);
      const ge = gs + Number(inputs.gatherMinutes || 60);
      busy.push([gs, ge]);
    }
    busy.sort((a,b)=>a[0]-b[0]);

    // try preferred window first
    let free = subtractIntervals(prefWins, busy);
    let slot = pickSlot(free, minutesNeeded);

    // fallback anywhere
    if(!slot){
      free = subtractIntervals(fallbackWins, busy);
      slot = pickSlot(free, minutesNeeded);
    }

    // last resort: if still none, place at 22:00 (can happen if day fully booked)
    if(!slot){
      const end = timeToMinutes('22:00');
      const start = Math.max(timeToMinutes('06:00'), end - minutesNeeded);
      slot = [start, start + minutesNeeded];
    }

    const start = minutesToTime(slot[0]);
    const end = minutesToTime(slot[1]);
    const tasks = buildTaskBreakdown(phase);

    return {
      dateISO: date.toISOString().slice(0,10),
      dateLabel: formatDate(date),
      weekday: wd,
      start,
      end,
      minutes: minutesNeeded,
      tasks
    };
  });

  // Build per-date calendar blocks for work/classes (for export)
  const calendarBlocks = [];
  for(let i=0; i<totalDays; i++){
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const wd = weekdayShort(date);
    const dateISO = date.toISOString().slice(0,10);
    const dayInfo = inputs.week[wd] || { work:[], cls:[] };

    for(const [s,e] of dayInfo.work){
      calendarBlocks.push({ type:'Work', dateISO, start: minutesToTime(s), end: minutesToTime(e) });
    }
    for(const [s,e] of dayInfo.cls){
      calendarBlocks.push({ type:'Class', dateISO, start: minutesToTime(s), end: minutesToTime(e) });
    }
    if(inputs.gatherDay && inputs.gatherDay === wd && inputs.gatherStart){
      calendarBlocks.push({
        type:'Gathering',
        dateISO,
        start: inputs.gatherStart,
        end: addMinutes(inputs.gatherStart, Number(inputs.gatherMinutes || 60))
      });
    }
  }

  return { ...inputs, daysLeft, today, due, sessions, calendarBlocks };
}

function render(plan){
  daysLeftChip.textContent = plan.daysLeft === 0 ? 'Due today' : `${plan.daysLeft} days left`;
  scheduleWrap.innerHTML = '';

  for(const s of plan.sessions){
    const card = document.createElement('div');
    card.className = 'dayCard';

    card.innerHTML = `
      <div class="dayHeader">
        <strong>${s.dateLabel}</strong>
        <span>${s.start}–${s.end} (${s.minutes} min)</span>
      </div>
      <div class="meta">
        <span class="badge">${plan.courseName}</span>
        <span class="badge">${plan.difficulty}</span>
        <span class="badge">${plan.preference}</span>
      </div>
    `;

    const ul = document.createElement('ul');
    ul.className = 'taskList';

    const li = document.createElement('li');
    li.className = 'taskItem';
    li.innerHTML = `<strong>Session checklist</strong>`;

    const list = document.createElement('div');
    list.className = 'muted';
    list.style.marginTop = '8px';
    list.innerHTML = s.tasks.map((t, i)=>{
      const id = `${s.dateISO}-t${i}`;
      return `<label style="display:flex; gap:10px; align-items:flex-start; margin:6px 0;">
        <input type="checkbox" id="${id}"/>
        <span>${t}</span>
      </label>`;
    }).join('');

    li.appendChild(list);
    ul.appendChild(li);
    card.appendChild(ul);
    scheduleWrap.appendChild(card);
  }

  emptyState.hidden = true;
  scheduleWrap.hidden = false;
}

function saveInputs(payload){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function loadInputs(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if(!raw) return null;
  try{ return JSON.parse(raw); } catch { return null; }
}

function exportPayloadFromForm(){
  const p = gatherInputs();

  // store week text (not parsed) for fidelity
  const weekText = {};
  for(const d of DAYS){
    weekText[d] = {
      work: $(`work_${d}`).value || '',
      cls: $(`class_${d}`).value || ''
    };
  }

  return {
    courseName: p.courseName,
    dueISO: p.dueDate.toISOString().slice(0,10),
    sessionMinutes: p.sessionMinutes,
    difficulty: p.difficulty,
    preference: p.preference,
    timezone: p.timezone,
    gatherDay: p.gatherDay,
    gatherStart: p.gatherStart,
    gatherMinutes: p.gatherMinutes,
    weekText
  };
}

function fillForm(saved){
  $('courseName').value = saved.courseName || '';
  $('dueDate').value = saved.dueISO || '';
  $('sessionMinutes').value = saved.sessionMinutes || 45;
  $('difficulty').value = saved.difficulty || 'medium';
  $('preference').value = saved.preference || 'evening';
  $('timezone').value = saved.timezone || 'America/Chicago';
  $('gatherDay').value = saved.gatherDay || '';
  $('gatherStart').value = saved.gatherStart || '19:00';
  $('gatherMinutes').value = saved.gatherMinutes || 60;

  const weekText = saved.weekText || {};
  for(const d of DAYS){
    $(`work_${d}`).value = (weekText[d] && weekText[d].work) ? weekText[d].work : '';
    $(`class_${d}`).value = (weekText[d] && weekText[d].cls) ? weekText[d].cls : '';
  }
}

function buildPlanText(plan){
  const lines = [];
  lines.push(`Project: ${plan.courseName}`);
  lines.push(`Due: ${plan.due.toISOString().slice(0,10)} (${plan.daysLeft} days left)`);
  lines.push('');
  for(const s of plan.sessions){
    lines.push(`${s.dateLabel}  ${s.start}-${s.end} (${s.minutes} min)`);
    for(const t of s.tasks) lines.push(`  - ${t}`);
    lines.push('');
  }
  return lines.join('\n');
}

function download(filename, content, mime='text/plain'){
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function icsEscape(s){
  return (s || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g,'\\,')
    .replace(/;/g,'\\;');
}

function toICSDateTime(dateISO, timeHHMM){
  const [y,m,d] = dateISO.split('-');
  const hh = timeHHMM.slice(0,2);
  const mm = timeHHMM.slice(3,5);
  return `${y}${m}${d}T${hh}${mm}00`;
}

function buildICS(plan){
  const lines = [];
  lines.push('BEGIN:VCALENDAR');
  lines.push('VERSION:2.0');
  lines.push('PRODID:-//SpacedStudyPlannerPro//EN');
  lines.push('CALSCALE:GREGORIAN');
  lines.push(`X-WR-TIMEZONE:${plan.timezone}`);

  const dtstamp = new Date().toISOString().replace(/[-:]/g,'').split('.')[0] + 'Z';

  function addEvent({summary, description, dateISO, start, end}){
    const uid = `${dateISO}-${start}-${Math.random().toString(16).slice(2)}@ssp`;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART;TZID=${plan.timezone}:${toICSDateTime(dateISO, start)}`);
    lines.push(`DTEND;TZID=${plan.timezone}:${toICSDateTime(dateISO, end)}`);
    lines.push(`SUMMARY:${icsEscape(summary)}`);
    if(description) lines.push(`DESCRIPTION:${icsEscape(description)}`);
    lines.push('END:VEVENT');
  }

  // Study sessions
  for(const s of plan.sessions){
    const desc = ['Session tasks:', ...s.tasks.map(t => `- ${t}`)].join('\n');
    addEvent({
      summary: `${plan.courseName} — Study Session`,
      description: desc,
      dateISO: s.dateISO,
      start: s.start,
      end: s.end
    });
  }

  // Work / Class / Gathering blocks (so calendar shows everything)
  for(const b of plan.calendarBlocks){
    addEvent({
      summary: b.type === 'Work' ? 'Work Shift' : (b.type === 'Class' ? 'Class' : 'Pathway Gathering'),
      description: b.type === 'Class' ? 'Class block (entered by you)' : '',
      dateISO: b.dateISO,
      start: b.start,
      end: b.end
    });
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

let lastPlan = null;

form.addEventListener('submit', (e)=>{
  e.preventDefault();
  try{
    const inputs = gatherInputs();
    const plan = generatePlan(inputs);
    lastPlan = plan;
    render(plan);
    setStatus('Plan generated. Export calendar to import into Apple/Google/Outlook.');
  } catch (err){
    setStatus(err instanceof Error ? err.message : 'Something went wrong.');
  }
});

saveBtn.addEventListener('click', ()=>{
  try{
    const payload = exportPayloadFromForm();
    saveInputs(payload);
    setStatus('Saved inputs to this browser. Use Load next time.');
  } catch (err){
    setStatus(err instanceof Error ? err.message : 'Could not save.');
  }
});

loadBtn.addEventListener('click', ()=>{
  const saved = loadInputs();
  if(!saved){ setStatus('No saved inputs found.'); return; }
  fillForm(saved);
  setStatus('Loaded saved inputs. Click Generate to rebuild the plan.');
});

clearBtn.addEventListener('click', ()=>{
  form.reset();
  const d = new Date();
  d.setDate(d.getDate() + 7);
  $('dueDate').value = d.toISOString().slice(0,10);
  $('sessionMinutes').value = 45;
  $('difficulty').value = 'medium';
  $('preference').value = 'evening';
  $('timezone').value = 'America/Chicago';
  $('gatherStart').value = '19:00';
  $('gatherMinutes').value = 60;

  for(const day of DAYS){
    $(`work_${day}`).value = '';
    $(`class_${day}`).value = '';
  }

  lastPlan = null;
  scheduleWrap.hidden = true;
  emptyState.hidden = false;
  daysLeftChip.textContent = '—';
  setStatus('Cleared.');
});

exportBtn.addEventListener('click', ()=>{
  if(!lastPlan){ setStatus('Generate a plan first.'); return; }
  const ics = buildICS(lastPlan);
  download('study-plan-with-schedule.ics', ics, 'text/calendar');
  setStatus('Downloaded .ics file (study + work + classes + gathering).');
});

copyBtn.addEventListener('click', async ()=>{
  if(!lastPlan){ setStatus('Generate a plan first.'); return; }
  const text = buildPlanText(lastPlan);
  try{
    await navigator.clipboard.writeText(text);
    setStatus('Copied plan text to clipboard.');
  } catch {
    download('study-plan.txt', text, 'text/plain');
    setStatus('Clipboard blocked—downloaded plan text instead.');
  }
});

(function init(){
  buildWeekTable();
  const d = new Date();
  d.setDate(d.getDate() + 7);
  $('dueDate').value = d.toISOString().slice(0,10);
})();
