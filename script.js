const form = document.getElementById("planForm");
const courseNameEl = document.getElementById("courseName");
const dueDateEl = document.getElementById("dueDate");
const dailyMinutesEl = document.getElementById("dailyMinutes");
const difficultyEl = document.getElementById("difficulty");

const scheduleList = document.getElementById("scheduleList");
const emptyState = document.getElementById("emptyState");
const todayBox = document.getElementById("todayBox");
const daysLeftChip = document.getElementById("daysLeftChip");
const statusEl = document.getElementById("status");

const saveBtn = document.getElementById("saveBtn");
const clearBtn = document.getElementById("clearBtn");

const STORAGE_KEY = "spacedStudyPlanner.v2";

function toDateOnly(d){
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseDateInput(value){
  const [y, m, day] = value.split("-").map(Number);
  return new Date(y, m - 1, day);
}

function formatDate(d){
  return d.toLocaleDateString(undefined, { weekday:"short", year:"numeric", month:"short", day:"numeric" });
}

function daysBetween(a, b){
  const ms = 24 * 60 * 60 * 1000;
  return Math.round((toDateOnly(b) - toDateOnly(a)) / ms);
}

function clamp(n, min, max){
  return Math.max(min, Math.min(max, n));
}

function difficultyProfile(level){
  if(level === "easy") return { sessionsPerWeek: 4, reviewBoost: 0 };
  if(level === "hard") return { sessionsPerWeek: 6, reviewBoost: 1 };
  return { sessionsPerWeek: 5, reviewBoost: 0.5 };
}

function generateSchedule({ courseName, dueDate, dailyMinutes, difficulty }){
  const today = toDateOnly(new Date());
  const due = toDateOnly(dueDate);

  const daysLeft = daysBetween(today, due);
  if(daysLeft < 0) throw new Error("Due date is in the past. Please choose a future date.");

  const totalDays = Math.max(1, daysLeft + 1);
  const profile = difficultyProfile(difficulty);

  const weeks = totalDays / 7;
  const baseSessions = Math.round(weeks * profile.sessionsPerWeek);
  const minSessions = clamp(Math.round(totalDays * 0.6), 1, totalDays);
  const targetSessions = clamp(baseSessions + Math.round(profile.reviewBoost * weeks), minSessions, totalDays);

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

  const dayIndices = Array.from(chosen).sort((a,b)=>a-b);
  const plan = [];

  for(const di of dayIndices){
    const date = new Date(today);
    date.setDate(today.getDate() + di);

    const phase = di / (totalDays - 1 || 1);
    const minutes = Math.round(dailyMinutes * (phase > 0.8 ? 1.15 : 1.0));

    let focus = "";
    if(phase <= 0.35) focus = "Learn: read/lecture + write 5 key takeaways.";
    else if(phase <= 0.75) focus = "Practice: active recall (self-quiz) + fix weak spots.";
    else focus = "Review: quick recall + finalize deliverables, check rubric.";

    plan.push({ dateISO: date.toISOString().slice(0,10), dateLabel: formatDate(date), minutes, focus });
  }

  return { courseName, dailyMinutes, difficulty, dueISO: due.toISOString().slice(0,10), daysLeft, plan };
}

function renderSchedule(data){
  daysLeftChip.textContent = data.daysLeft === 0 ? "Due today" : `${data.daysLeft} days left`;

  scheduleList.innerHTML = "";
  for(const item of data.plan){
    const li = document.createElement("li");
    li.innerHTML = `
      <strong>${item.dateLabel}</strong>
      <div class="meta">
        <span class="badge">${item.minutes} min</span>
        <span class="badge">${data.difficulty}</span>
        <span class="badge">${data.courseName}</span>
      </div>
      <div class="muted" style="margin-top:8px;">${item.focus}</div>
    `;
    scheduleList.appendChild(li);
  }

  emptyState.hidden = true;
  scheduleList.hidden = false;

  const todayISO = toDateOnly(new Date()).toISOString().slice(0,10);
  const todaySession = data.plan.find(p => p.dateISO === todayISO);
  const next = data.plan.find(p => p.dateISO > todayISO);

  if(todaySession){
    todayBox.innerHTML = `
      <p><strong>Today:</strong> ${todaySession.minutes} minutes</p>
      <p class="muted">${todaySession.focus}</p>
      <p class="muted">Tip: Set a timer, then stop. Consistency beats cramming.</p>
    `;
  } else if(next){
    todayBox.innerHTML = `
      <p class="muted">No session scheduled today.</p>
      <p><strong>Next:</strong> ${next.dateLabel} (${next.minutes} minutes)</p>
      <p class="muted">${next.focus}</p>
    `;
  } else {
    todayBox.innerHTML = `<p class="muted">No upcoming sessions found.</p>`;
  }
}

function setStatus(msg){ statusEl.textContent = msg; }

function loadSaved(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function saveData(data){ localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
function clearSaved(){ localStorage.removeItem(STORAGE_KEY); }

(function init(){
  const saved = loadSaved();
  if(saved){
    courseNameEl.value = saved.courseName || "";
    dueDateEl.value = saved.dueISO || "";
    dailyMinutesEl.value = saved.dailyMinutes || 45;
    difficultyEl.value = saved.difficulty || "medium";
    renderSchedule(saved);
    setStatus("Loaded your saved plan.");
    return;
  }
  const d = new Date();
  d.setDate(d.getDate() + 7);
  dueDateEl.value = d.toISOString().slice(0,10);
})();

form.addEventListener("submit", (e)=>{
  e.preventDefault();
  const courseName = courseNameEl.value.trim();
  const dueInput = dueDateEl.value;
  const dailyMinutes = Number(dailyMinutesEl.value);
  const difficulty = difficultyEl.value;

  if(!courseName){ setStatus("Please enter a course/task name."); return; }
  if(!dueInput){ setStatus("Please choose a due date."); return; }
  if(!Number.isFinite(dailyMinutes) || dailyMinutes <= 0){ setStatus("Please enter a valid minutes value."); return; }

  try{
    const data = generateSchedule({ courseName, dueDate: parseDateInput(dueInput), dailyMinutes, difficulty });
    renderSchedule(data);
    setStatus("Schedule generated. You can save it.");
  } catch (err){
    setStatus(err instanceof Error ? err.message : "Something went wrong.");
  }
});

saveBtn.addEventListener("click", ()=>{
  const courseName = courseNameEl.value.trim();
  if(!courseName){ setStatus("Enter a course/task name before saving."); return; }
  try{
    const data = generateSchedule({
      courseName,
      dueDate: parseDateInput(dueDateEl.value),
      dailyMinutes: Number(dailyMinutesEl.value),
      difficulty: difficultyEl.value
    });
    saveData(data);
    setStatus("Saved to this browser (localStorage).");
  } catch (err){
    setStatus(err instanceof Error ? err.message : "Could not save.");
  }
});

clearBtn.addEventListener("click", ()=>{
  courseNameEl.value = "";
  dailyMinutesEl.value = 45;
  difficultyEl.value = "medium";
  const d = new Date();
  d.setDate(d.getDate() + 7);
  dueDateEl.value = d.toISOString().slice(0,10);

  scheduleList.hidden = true;
  emptyState.hidden = false;
  todayBox.innerHTML = `<p class="muted">Generate a schedule to see today’s recommended session.</p>`;
  daysLeftChip.textContent = "—";
  setStatus("Cleared the form. (Saved plan not removed.)");
});
