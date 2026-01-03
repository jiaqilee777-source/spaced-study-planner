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

const STORAGE_KEY = 'spacedStudyPlanner.pro.v3';

function $(id){ return document.getElementById(id); }

function setStatus(msg){ statusEl.textContent = msg; }

function toDateOnly(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

function parseDateInput(value){
  const [y, m, day] = value.split('-').map(Number);
  return new Date(y, m - 1, day);
}

function formatDate(d){
  return d.toLocaleDateString(undefined, { weekday:'short', year:'numeric', month:'short', day:'numeric' });
}

function daysBetween(a, b){
  const ms = 24 * 60 * 60 * 1000;
  return Math.round((toDateOnly(b) - toDateOnly(a)) / ms);
}

function clamp(n, min, max){ return Math.max(min, Math.min(max, n)); }

function parseOffDays(text){
  const raw = (text || '').split(',').map(s => s.trim()).filter(Boolean);
  const allowed = new Set(['Mon','Tue','Wed','Thu','Fri','Sat','Sun']);
  return new Set(raw.filter(d => allowed.has(d)));
}

function weekdayShort(d){
  return d.toLocaleDateString('en-US', { weekday: 'short' }); // Mon/Tue...
}

function timeToMinutes(t){
  // "HH:MM"
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(mins){
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const hh = String(h).padStart(2,'0');
  const mm = String(m).padStart(2,'0');
  return `${hh}:${mm}`;
}

function addMinutesToTime(t, add){
  return minutesToTime(timeToMinutes(t) + add);
}

function difficultyProfile(level){
  if(level === 'easy') return { sessionsPerWeek: 4, reviewBoost: 0 };
  if(level === 'hard') return { sessionsPerWeek: 6, reviewBoost: 1 };
  return { sessionsPerWeek: 5, reviewBoost: 0.5 };
}

function pickStartTime({ date, preference, isWorkday, workStart, workEnd, offDays, gatherDay, gatherStart, gatherMinutes }){
  const wd = weekdayShort(date);
  const off = offDays.has(wd);
  const hasGather = gatherDay && (gatherDay === wd);

  // Defaults
  let start = '19:00';
  if(preference === 'morning') start = '07:00';
  if(preference === 'lunch') start = '12:00';

  // If workday and not off, schedule after work for evening preference
  if(isWorkday && !off && preference === 'evening' && workStart && workEnd){
    // 30 min buffer after work
    start = addMinutesToTime(workEnd, 30);
  }

  // If gathering conflicts with the chosen start, push study after gathering + 15 min
  if(hasGather){
    const gStart = gatherStart || '19:00';
    const gEnd = addMinutesToTime(gStart, Number(gatherMinutes || 60));
    const startMin = timeToMinutes(start);
    const gStartMin = timeToMinutes(gStart);
    const gEndMin = timeToMinutes(gEnd);

    const overlaps = !(startMin + 15 <= gStartMin || startMin >= gEndMin); // rough overlap check
    if(overlaps || (startMin >= gStartMin && startMin <= gEndMin)){
      start = addMinutesToTime(gEnd, 15);
    }
  }

  return start;
}

function buildTaskBreakdown(phase){
  // Phase: 0..1
  if(phase <= 0.25){
    return [
      'Skim instructions + rubric',
      'Read/Watch lesson content',
      'Write 5 key takeaways'
    ];
  }
  if(phase <= 0.55){
    return [
      'Active recall (self-quiz)',
      'Summarize from memory',
      'Fix weak spots (re-read only what you missed)'
    ];
  }
  if(phase <= 0.80){
    return [
      'Draft: produce a first version',
      'Check requirements (format, length, rubric)',
      'Revise 1–2 sections for clarity'
    ];
  }
  return [
    'Final review: spelling/grammar',
    'Double-check submission requirements',
    'Submit early + backup copy'
  ];
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

  // Choose spaced days (indices)
  const chosen = new Set([0, totalDays - 1]);
  const gaps = [];
  for(let g = 1; g <= 10; g++) gaps.push(g, g);

  let idx = 0;
  for(let i = 0; i < gaps.length && chosen.size < targetSessions; i++){
    idx += gaps[i];
    if(idx >= totalDays - 1) break;
    chosen.add(idx);
  }
  if(chosen.size < targetSessions){
    const remaining = targetSessions - chosen.size;
    for(let k = 1; k <= remaining; k++){
      const pos = Math.round((k * (totalDays - 2)) / (remaining + 1));
      chosen.add(clamp(pos, 1, totalDays - 2));
    }
  }

  const indices = Array.from(chosen).sort((a,b)=>a-b);

  const sessions = indices.map(di => {
    const date = new Date(today);
    date.setDate(today.getDate() + di);

    const phase = di / (totalDays - 1 || 1);
    const minutes = Math.round(inputs.sessionMinutes * (phase > 0.85 ? 1.2 : 1.0));

    const wd = weekdayShort(date);
    const isWorkday = ['Mon','Tue','Wed','Thu','Fri'].includes(wd);

    const start = pickStartTime({
      date,
      preference: inputs.preference,
      isWorkday,
      workStart: inputs.workStart,
      workEnd: inputs.workEnd,
      offDays: inputs.offDays,
      gatherDay: inputs.gatherDay,
      gatherStart: inputs.gatherStart,
      gatherMinutes: inputs.gatherMinutes
    });
    const end = addMinutesToTime(start, minutes);

    const tasks = buildTaskBreakdown(phase);

    return {
      dateISO: date.toISOString().slice(0,10),
      dateLabel: formatDate(date),
      weekday: wd,
      start,
      end,
      minutes,
      phase,
      tasks
    };
  });

  return {
    ...inputs,
    daysLeft,
    sessions
  };
}

function render(plan){
  daysLeftChip.textContent = plan.daysLeft === 0 ? 'Due today' : `${plan.daysLeft} days left`;

  scheduleWrap.innerHTML = '';

  for(const s of plan.sessions){
    const card = document.createElement('div');
    card.className = 'dayCard';

    const title = document.createElement('div');
    title.className = 'dayHeader';
    title.innerHTML = `<strong>${s.dateLabel}</strong><span>${s.start}–${s.end} (${s.minutes} min)</span>`;
    card.appendChild(title);

    const ul = document.createElement('ul');
    ul.className = 'taskList';

    // If gathering day, show it as a separate item (FYI)
    if(plan.gatherDay && plan.gatherDay === s.weekday){
      const gStart = plan.gatherStart || '19:00';
      const gEnd = addMinutesToTime(gStart, Number(plan.gatherMinutes || 60));
      const liG = document.createElement('li');
      liG.className = 'taskItem';
      liG.innerHTML = `<strong>Gathering</strong>
        <div class="meta">
          <span class="badge">${gStart}–${gEnd}</span>
          <span class="badge">Required</span>
        </div>`;
      ul.appendChild(liG);
    }

    // Study session item
    const li = document.createElement('li');
    li.className = 'taskItem';
    li.innerHTML = `<strong>${plan.courseName}</strong>
      <div class="meta">
        <span class="badge">${plan.difficulty}</span>
        <span class="badge">${s.start}–${s.end}</span>
        <span class="badge">${s.minutes} min</span>
      </div>`;

    const tasks = document.createElement('div');
    tasks.style.marginTop = '10px';
    tasks.className = 'muted';

    // Checkboxes (not persisted in v3—simple UI)
    const list = document.createElement('div');
    list.className = 'muted';
    list.innerHTML = s.tasks.map((t, i)=>{
      const id = `${s.dateISO}-t${i}`;
      return `<label style="display:flex; gap:10px; align-items:flex-start; margin:6px 0;">
        <input type="checkbox" id="${id}" />
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

function gatherInputs(){
  const courseName = $('courseName').value.trim();
  const dueInput = $('dueDate').value;
  const sessionMinutes = Number($('sessionMinutes').value);
  const difficulty = $('difficulty').value;
  const preference = $('preference').value;
  const timezone = $('timezone').value;

  const workStart = $('workStart').value || '';
  const workEnd = $('workEnd').value || '';
  const offDays = parseOffDays($('offDays').value);

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
    workStart,
    workEnd,
    offDays,
    gatherDay,
    gatherStart,
    gatherMinutes
  };
}

function save(plan){
  const payload = {
    courseName: plan.courseName,
    dueISO: plan.dueDate.toISOString().slice(0,10),
    sessionMinutes: plan.sessionMinutes,
    difficulty: plan.difficulty,
    preference: plan.preference,
    timezone: plan.timezone,
    workStart: plan.workStart,
    workEnd: plan.workEnd,
    offDays: Array.from(plan.offDays),
    gatherDay: plan.gatherDay,
    gatherStart: plan.gatherStart,
    gatherMinutes: plan.gatherMinutes
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function loadSaved(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if(!raw) return null;
  try{ return JSON.parse(raw); } catch { return null; }
}

function fillForm(saved){
  $('courseName').value = saved.courseName || '';
  $('dueDate').value = saved.dueISO || '';
  $('sessionMinutes').value = saved.sessionMinutes || 45;
  $('difficulty').value = saved.difficulty || 'medium';
  $('preference').value = saved.preference || 'evening';
  $('timezone').value = saved.timezone || 'America/Chicago';
  $('workStart').value = saved.workStart || '09:00';
  $('workEnd').value = saved.workEnd || '17:00';
  $('offDays').value = (saved.offDays || []).join(',');
  $('gatherDay').value = saved.gatherDay || '';
  $('gatherStart').value = saved.gatherStart || '19:00';
  $('gatherMinutes').value = saved.gatherMinutes || 60;
}

function buildPlanText(plan){
  const lines = [];
  lines.push(`Project: ${plan.courseName}`);
  lines.push(`Due: ${plan.dueDate.toISOString().slice(0,10)} (${plan.daysLeft} days left)`);
  lines.push('');
  for(const s of plan.sessions){
    lines.push(`${s.dateLabel}  ${s.start}-${s.end} (${s.minutes} min)`);
    for(const t of s.tasks){
      lines.push(`  - ${t}`);
    }
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

function icsEscape(s){ return (s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g,'\\,').replace(/;/g,'\\;'); }

function toICSDateTime(dateISO, timeHHMM){
  // local datetime (floating). Example: 20260103T190000
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

  const now = new Date();
  const dtstamp = now.toISOString().replace(/[-:]/g,'').split('.')[0] + 'Z';

  for(const s of plan.sessions){
    const uid = `${s.dateISO}-${s.start}-${Math.random().toString(16).slice(2)}@ssp`;
    const dtstart = toICSDateTime(s.dateISO, s.start);
    const dtend = toICSDateTime(s.dateISO, s.end);

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART;TZID=${plan.timezone}:${dtstart}`);
    lines.push(`DTEND;TZID=${plan.timezone}:${dtend}`);
    lines.push(`SUMMARY:${icsEscape(plan.courseName)} (Study Session)`);

    const desc = ['Tasks:', ...s.tasks.map(t => `- ${t}`)].join('\n');
    lines.push(`DESCRIPTION:${icsEscape(desc)}`);
    lines.push('END:VEVENT');

    // Optional Gathering event
    if(plan.gatherDay && plan.gatherDay === s.weekday){
      const gStart = plan.gatherStart || '19:00';
      const gEnd = addMinutesToTime(gStart, Number(plan.gatherMinutes || 60));
      const uidG = `${s.dateISO}-gather-${Math.random().toString(16).slice(2)}@ssp`;
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${uidG}`);
      lines.push(`DTSTAMP:${dtstamp}`);
      lines.push(`DTSTART;TZID=${plan.timezone}:${toICSDateTime(s.dateISO, gStart)}`);
      lines.push(`DTEND;TZID=${plan.timezone}:${toICSDateTime(s.dateISO, gEnd)}`);
      lines.push('SUMMARY:Pathway Gathering');
      lines.push('DESCRIPTION:Weekly Gathering (required)');
      lines.push('END:VEVENT');
    }
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
    setStatus('Plan generated. You can export to calendar (.ics).');
  } catch (err){
    setStatus(err instanceof Error ? err.message : 'Something went wrong.');
  }
});

saveBtn.addEventListener('click', ()=>{
  try{
    const inputs = gatherInputs();
    const plan = generatePlan(inputs);
    save(plan);
    setStatus('Saved. Use Load anytime.');
  } catch (err){
    setStatus(err instanceof Error ? err.message : 'Could not save.');
  }
});

loadBtn.addEventListener('click', ()=>{
  const saved = loadSaved();
  if(!saved){ setStatus('No saved plan found.'); return; }
  fillForm(saved);
  setStatus('Loaded saved inputs. Click Generate to rebuild schedule.');
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
  $('workStart').value = '09:00';
  $('workEnd').value = '17:00';
  $('gatherStart').value = '19:00';
  $('gatherMinutes').value = 60;
  $('offDays').value = '';

  lastPlan = null;
  scheduleWrap.hidden = true;
  emptyState.hidden = false;
  daysLeftChip.textContent = '—';
  setStatus('Cleared.');
});

exportBtn.addEventListener('click', ()=>{
  if(!lastPlan){ setStatus('Generate a plan first.'); return; }
  const ics = buildICS(lastPlan);
  download('spaced-study-plan.ics', ics, 'text/calendar');
  setStatus('Downloaded .ics calendar file.');
});

copyBtn.addEventListener('click', async ()=>{
  if(!lastPlan){ setStatus('Generate a plan first.'); return; }
  const text = buildPlanText(lastPlan);
  try{
    await navigator.clipboard.writeText(text);
    setStatus('Copied plan text to clipboard.');
  } catch {
    download('spaced-study-plan.txt', text, 'text/plain');
    setStatus('Clipboard blocked—downloaded plan text instead.');
  }
});

// Prefill due date + sensible defaults
(function init(){
  const d = new Date();
  d.setDate(d.getDate() + 7);
  $('dueDate').value = d.toISOString().slice(0,10);
})();
