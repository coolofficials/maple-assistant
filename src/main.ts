import { effectiveCooldown, isValidCharacterName, loadData, parseAppData, saveData, todoIsDone, validateAppData, validSkill, validTodo, type AppData, type Skill, type Todo, type TodoFrequency } from './model';

declare global {
  interface Window {
    desktop: {
      listSources(): Promise<{ id: string; name: string }[]>;
      selectSource(id: string): Promise<boolean>;
      openObserver(): Promise<boolean>;
      publishFrame(dataUrl: string): Promise<boolean>;
      closeObserver(): Promise<boolean>;
      scheduleNotification(title: string, body: string, delayMs: number, repeatMs?: number): Promise<{ id: string; scheduledAt: number } | null>;
      cancelNotification(id: string): Promise<boolean>;
      onFrame(callback: (dataUrl: string) => void): () => void;
    };
  }
}

type CaptureState = 'idle' | 'starting' | 'running';
const app = document.querySelector<HTMLDivElement>('#app')!;
const observerMode = new URLSearchParams(location.search).has('observer');
let data: AppData = loadData(localStorage);
let capture: MediaStream | null = null;
let captureState: CaptureState = 'idle';
let captureVersion = 0;
let frameTimer = 0;
let todoRefreshTimer = 0;
let skillTimer = 0;
let cleanupFrame: (() => void) | undefined;
let crop = 'wide';
let timerGeneration = 0;
let timerEndsAt = 0;
let timerNotificationId: string | null = null;
let activeSkillId: string | null = null;
let activeSkillSnapshot: Skill | null = null;
let timerRemainingMs = 0;
let timerPaused = false;
let timerMuted = false;
let timerSchedulePending = false;
const store = localStorage;
let stopTimer: (cancelNotification?: boolean) => void = () => {};
const saveCandidate = (candidate: AppData): boolean => {
  if (!validateAppData(candidate)) { showDataStatus('최대 개수 제한 또는 데이터 참조를 확인하세요. 기존 저장은 유지했습니다.'); return false; }
  try { saveData(store, candidate); data = candidate; return true; }
  catch { showDataStatus('저장 공간이 부족하거나 데이터를 저장할 수 없습니다. 기존 데이터는 유지했습니다.'); return false; }
};
if (observerMode) renderObserver(); else renderApp();

function renderObserver() {
  document.body.classList.add('observer-body');
  app.innerHTML = '<main class="observer"><img alt="선택한 화면 미리보기"><p>화면은 이 기기에서만 표시됩니다 · 관찰 전용</p></main>';
  const image = app.querySelector('img')!;
  cleanupFrame = window.desktop.onFrame(src => { image.src = src; });
  window.addEventListener('beforeunload', () => cleanupFrame?.(), { once: true });
}
function stopPageWork() {
  stopTimer();
  stopCapture();
  clearInterval(todoRefreshTimer);
  todoRefreshTimer = 0;
}
function renderApp() {
  stopPageWork();
  window.removeEventListener('beforeunload', cleanup); window.removeEventListener('focus', refreshVisibleState); document.removeEventListener('visibilitychange', refreshVisibleState);
  app.innerHTML = `<header><div><span class="eyebrow">LOCAL DESKTOP COMPANION</span><h1>메이플 어시스턴트</h1></div><div class="character"><label for="character">캐릭터</label><select id="character" aria-label="현재 캐릭터"></select><button id="add-character" class="subtle">＋ 추가</button></div></header>
  <nav aria-label="기능"><a href="#timer">재획 알림</a><a href="#todos">메할일</a><a href="#pip">화면 PiP</a><a href="#data">데이터</a></nav>
  <main><section id="timer" class="panel"><div class="section-heading"><div><span class="eyebrow">MANUAL REMINDERS</span><h2>재획 알림</h2></div><span class="pill">자동 입력 없음</span></div><p class="hint">검증되지 않은 쿨타임 감소 공식은 적용하지 않습니다. 실행 중 캐릭터/스킬 선택을 바꿔도 현재 실행은 시작 시점 스킬로 계속됩니다. 중지 후 시작하면 화면에서 선택한 스킬을 사용합니다.</p><form id="skill-form" class="form-grid"><label>스킬 이름<input name="name" required maxlength="50" placeholder="예: 스킬 이름"></label><label>기본 쿨타임 (초)<input name="cooldown" type="number" min="1" max="86400" value="60" required></label><label>쿨타임 감소 설정 (%)<input name="reduction" type="number" min="0" max="100" value="0" required></label><label>실효 쿨타임 보정 (초, 선택)<input name="override" type="number" min="1" max="86400" placeholder="설정 시 우선 적용"></label><label>사용할 캐릭터 (복수 선택)<select name="characters" multiple required></select></label><button class="primary">스킬 추가</button></form><div id="skills" class="list"></div><label>반복 알림 스킬<select id="active-skill" aria-label="반복 알림 스킬"></select></label><div class="timer-controls"><button id="start-timer" class="primary">알림 타이머 시작</button><button id="pause-timer" class="subtle" disabled>일시정지</button><button id="mute-timer" class="subtle" disabled>음소거</button><button id="resync-timer" class="subtle" disabled>지금부터 재동기화</button><button id="stop-timer" class="subtle" disabled>중지</button><output id="countdown" aria-live="polite">대기 중</output></div></section><section class="panel"><h2>현재 캐릭터 쿨타임 감소 기록</h2><p class="hint">기록용 설정이며 공식 계산에 적용하지 않습니다. 알림은 선택 스킬의 실효 보정 또는 기본 쿨타임을 사용합니다.</p><div class="form-grid"><label>감소율 기록 (%)<input id="character-reduction-pct" type="number" min="0" max="100"></label><label>감소 초 기록<input id="character-reduction-sec" type="number" min="0" max="86400"></label><button id="save-character-spec" class="subtle">현재 캐릭터 설정 저장</button></div></section>
  <section id="todos" class="panel"><div class="section-heading"><div><span class="eyebrow">KOREA STANDARD TIME</span><h2>메할일</h2></div><span class="pill">초기화: 한국 시간</span></div><form id="todo-form" class="form-grid"><label>할 일<input name="title" required maxlength="100" placeholder="예: 주간 보스"></label><label>대상<select name="scope"><option value="account">계정 공통</option><option value="character">현재 캐릭터</option></select></label><label>주기<select name="frequency"><option value="daily">일일</option><option value="weekly">주간</option><option value="custom">사용자 지정</option></select></label><label>초기화 요일 (주간)<select name="weekday"><option value="1">월요일</option><option value="2">화요일</option><option value="3">수요일</option><option value="4">목요일</option><option value="5">금요일</option><option value="6">토요일</option><option value="0">일요일</option></select></label><label>초기화 시각 (KST)<input name="resetTime" type="time" value="00:00" required></label><label>사용자 지정 주기 (일)<input name="days" type="number" min="1" max="365" value="7" required></label><button class="primary">할 일 추가</button></form><div id="todos-list" class="list"></div></section>
  <section id="pip" class="panel"><div class="section-heading"><div><span class="eyebrow">LOCAL SCREEN PREVIEW</span><h2>게임 화면 PiP</h2></div><span class="pill">선택 후 직접 시작</span></div><p class="hint">OS에서 제공하는 창/화면 목록에서 대상을 명시적으로 선택합니다. 작은 observer 창은 비포커스·항상 위 표시를 요청하며 조작/입력 전달은 하지 않습니다. 가려짐·최소화 캡처, 게임 호환성, 다른 영상 창 배치는 보장하지 않습니다.</p><div class="form-grid"><label>캡처할 창/화면<select id="source"><option value="">화면 목록 불러오기</option></select></label><label>자르기 프리셋<select id="crop"><option value="wide">중앙 와이드 (16:9)</option><option value="square">중앙 정사각형</option><option value="full">전체 화면</option></select></label><div class="button-row"><button id="refresh-sources" class="subtle">화면 목록 불러오기</button><button id="start-capture" class="primary" disabled>선택한 화면 미리보기 시작</button><button id="stop-capture" class="subtle" disabled>중지</button></div></div><video id="preview" muted autoplay playsinline aria-label="선택 화면 미리보기"></video><p id="capture-status" class="status" role="status">캡처를 시작하지 않았습니다.</p></section>
  <section id="data" class="panel"><div class="section-heading"><div><span class="eyebrow">LOCAL DATA</span><h2>데이터 백업</h2></div></div><p class="hint">데이터는 이 브라우저 프로필의 로컬 저장소에만 보관됩니다. 캡처 영상은 저장/전송하지 않습니다.</p><div class="button-row"><button id="export" class="subtle">JSON 내보내기</button><label class="file-button">JSON 가져오기<input id="import" type="file" accept="application/json,.json"></label></div><p id="data-status" class="status" role="status" aria-live="polite"></p></section><footer>비공식 보조 도구 · 게임 규칙/실환경 동작을 보증하지 않습니다.</footer></main>
  <dialog id="character-dialog" aria-labelledby="character-dialog-title"><form id="character-form"><h2 id="character-dialog-title">캐릭터 추가</h2><label>캐릭터 이름<input name="name" required maxlength="60" autocomplete="off"></label><p id="character-error" class="status" role="alert"></p><div class="button-row"><button class="primary" type="submit">추가</button><button id="cancel-character" class="subtle" type="button">취소</button></div></form></dialog>`;
  populateCharacters(); bind(); renderSkills(); populateSkillChoices(); renderCharacterSpec(); renderTodos();
  todoRefreshTimer = window.setInterval(renderTodos, 1000);
}
function populateCharacters() {
  const select = app.querySelector<HTMLSelectElement>('#character')!;
  select.replaceChildren(...data.characters.map(name => { const option = document.createElement('option'); option.value = name; option.textContent = name; option.selected = name === data.selectedCharacter; return option; }));
}
function bind() {
  app.onclick = event => {
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest<HTMLAnchorElement>('a[href^="#"]');
    const sectionId = link?.getAttribute('href')?.slice(1);
    if (!sectionId || !['timer','todos','pip','data'].includes(sectionId)) return;
    const section = document.getElementById(sectionId); if (!section) return;
    event.preventDefault(); section.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };
  app.querySelector<HTMLSelectElement>('#character')!.onchange = e => {
    const next = { ...data, selectedCharacter: (e.target as HTMLSelectElement).value };
    if (saveCandidate(next)) { renderTodos(); renderCharacterSpec(); populateSkillChoices(); } else populateCharacters();
  };
  const dialog = app.querySelector<HTMLDialogElement>('#character-dialog')!;
  app.querySelector('#add-character')!.addEventListener('click', () => { app.querySelector<HTMLInputElement>('#character-form input')!.value = ''; app.querySelector('#character-error')!.textContent = ''; dialog.showModal(); });
  app.querySelector('#cancel-character')!.addEventListener('click', () => dialog.close());
  app.querySelector<HTMLFormElement>('#character-form')!.onsubmit = e => {
    e.preventDefault(); const input = new FormData(e.currentTarget as HTMLFormElement).get('name');
    const name = typeof input === 'string' ? input.trim() : '';
    const duplicate = data.characters.some(c => c.toLocaleLowerCase('en-US') === name.toLocaleLowerCase('en-US'));
    if (!isValidCharacterName(name) || duplicate) { app.querySelector('#character-error')!.textContent = !isValidCharacterName(name) ? '이름은 1~60자이며 account는 사용할 수 없습니다.' : '이미 등록된 캐릭터 이름입니다.'; return; }
    const next = { ...data, characters: [...data.characters, name], selectedCharacter: name, characterCooldownSpecs: [...data.characterCooldownSpecs, { characterName: name, reductionPct: 0, reductionSec: 0 }] };
    if (saveCandidate(next)) { dialog.close(); renderApp(); }
  };
  app.querySelector<HTMLFormElement>('#skill-form')!.onsubmit = e => {
    e.preventDefault(); const f = new FormData(e.currentTarget as HTMLFormElement);
    const skill: Skill = { id: crypto.randomUUID(), name: String(f.get('name')).trim(), cooldownSec: Number(f.get('cooldown')), reductionPct: Number(f.get('reduction')), characterNames: f.getAll('characters').map(String), ...(f.get('override') ? { effectiveOverrideSec: Number(f.get('override')) } : {}) };
    if (!validSkill(skill)) { showDataStatus('스킬 입력값 또는 최대 개수 제한을 확인해 주세요.'); return; }
    if (saveCandidate({ ...data, skills: [...data.skills, skill] })) { renderSkills(); populateSkillChoices(); (e.currentTarget as HTMLFormElement).reset(); }
  };
  app.querySelector('#start-timer')!.addEventListener('click', startSkillTimer);
  app.querySelector('#stop-timer')!.addEventListener('click', () => stopTimer());
  app.querySelector<HTMLSelectElement>('#active-skill')!.onchange = e => { activeSkillId = (e.target as HTMLSelectElement).value || null; };
  app.querySelector('#pause-timer')!.addEventListener('click', togglePause);
  app.querySelector('#mute-timer')!.addEventListener('click', toggleMute);
  app.querySelector('#resync-timer')!.addEventListener('click', () => { if (activeSkillSnapshot) resyncTimer(); });
  app.querySelector('#save-character-spec')!.addEventListener('click', saveCharacterSpec);
  app.querySelector('#skills')!.addEventListener('click', e => { const button = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-delete-skill]'); if (!button) return; const id = button.dataset.deleteSkill!; const runningSkillDeleted = activeSkillSnapshot?.id === id; if (runningSkillDeleted) stopTimer(); if (saveCandidate({ ...data, skills: data.skills.filter(s => s.id !== id) })) { if (activeSkillId === id) activeSkillId = null; renderSkills(); populateSkillChoices(); } });
  app.querySelector<HTMLFormElement>('#todo-form')!.onsubmit = e => {
    e.preventDefault(); const f = new FormData(e.currentTarget as HTMLFormElement);
    const todo: Todo = { id: crypto.randomUUID(), title: String(f.get('title')).trim(), scope: f.get('scope') === 'account' ? 'account' : data.selectedCharacter, frequency: String(f.get('frequency')) as TodoFrequency, resetWeekday: Number(f.get('weekday')), resetTime: String(f.get('resetTime')), customDays: Number(f.get('days')) };
    if (!validTodo(todo)) { showDataStatus('할 일 입력값을 확인해 주세요.'); return; }
    if (saveCandidate({ ...data, todos: [...data.todos, todo] })) { renderTodos(); (e.currentTarget as HTMLFormElement).reset(); }
  };
  app.querySelector('#todos-list')!.addEventListener('click', e => {
    const input = (e.target as HTMLElement).closest<HTMLInputElement>('[data-action="toggle"]');
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-action="delete"]');
    const id = input?.dataset.id ?? button?.dataset.id; const todo = data.todos.find(t => t.id === id); if (!todo) return;
    const nextTodo = input ? { ...todo, doneAt: todoIsDone(todo, new Date()) ? undefined : new Date().toISOString() } : null;
    const next = { ...data, todos: input ? data.todos.map(t => t.id === id ? nextTodo! : t) : data.todos.filter(t => t.id !== id) };
    if (saveCandidate(next)) renderTodos();
  });
  app.querySelector('#refresh-sources')!.addEventListener('click', refreshSources);
  app.querySelector<HTMLSelectElement>('#source')!.onchange = e => { app.querySelector<HTMLButtonElement>('#start-capture')!.disabled = true; void selectCaptureSource((e.target as HTMLSelectElement).value); };
  app.querySelector<HTMLSelectElement>('#crop')!.onchange = e => { crop = (e.target as HTMLSelectElement).value; };
  app.querySelector('#start-capture')!.addEventListener('click', startCapture);
  app.querySelector('#stop-capture')!.addEventListener('click', stopCapture);
  app.querySelector('#export')!.addEventListener('click', exportData);
  app.querySelector<HTMLInputElement>('#import')!.onchange = importData;
  window.addEventListener('beforeunload', cleanup, { once: true });
  window.addEventListener('focus', refreshVisibleState);
  document.addEventListener('visibilitychange', refreshVisibleState);
  setCaptureControls();
}
function renderSkills() {
  const formSelect = app.querySelector<HTMLSelectElement>('#skill-form select[name="characters"]'); if (formSelect) { formSelect.replaceChildren(...data.characters.map(name => new Option(name, name, name === data.selectedCharacter, name === data.selectedCharacter))); }
  const list = app.querySelector('#skills')!; list.replaceChildren();
  if (!data.skills.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = '등록된 스킬이 없습니다.'; list.append(empty); return; }
  for (const skill of data.skills) {
    const row = document.createElement('article'); row.className = 'list-item'; const details = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = skill.name;
    const small = document.createElement('small'); small.textContent = `${skill.characterNames.join(', ')} · 기본 ${skill.cooldownSec}초 · 스킬 감소 설정 ${skill.reductionPct}% · ${skill.effectiveOverrideSec !== undefined ? `실효 보정 ${skill.effectiveOverrideSec}초` : '기본값 알림 (감소율 계산 미적용)'}`;
    details.append(title, small); const remove = document.createElement('button'); remove.className = 'icon-button'; remove.textContent = '삭제'; remove.setAttribute('aria-label', `${skill.name} 삭제`); remove.dataset.deleteSkill = skill.id; row.append(details, remove); list.append(row);
  }
}
function populateSkillChoices() {
 const select = app.querySelector<HTMLSelectElement>('#active-skill'); if (!select) return;
 const available = data.skills.filter(skill => skill.characterNames.includes(data.selectedCharacter));
 if (!available.some(skill => skill.id === activeSkillId)) activeSkillId = available[0]?.id ?? null;
 select.replaceChildren(...available.map(skill => new Option(skill.name, skill.id, false, skill.id === activeSkillId))); select.disabled = available.length === 0;
}
function renderCharacterSpec() {
 const spec = data.characterCooldownSpecs.find(item => item.characterName === data.selectedCharacter);
 const pct = app.querySelector<HTMLInputElement>('#character-reduction-pct'); const sec = app.querySelector<HTMLInputElement>('#character-reduction-sec');
 if (pct && sec && spec) { pct.value = String(spec.reductionPct); sec.value = String(spec.reductionSec); }
}
function saveCharacterSpec() {
 const pct = Number(app.querySelector<HTMLInputElement>('#character-reduction-pct')?.value); const sec = Number(app.querySelector<HTMLInputElement>('#character-reduction-sec')?.value);
 const specs = data.characterCooldownSpecs.map(spec => spec.characterName === data.selectedCharacter ? { ...spec, reductionPct: pct, reductionSec: sec } : spec);
 if (saveCandidate({ ...data, characterCooldownSpecs: specs })) showDataStatus('캐릭터별 감소 설정을 기록했습니다. 알림 계산에는 적용하지 않습니다.');
}
function createTodoRow(id: string): HTMLElement {
  const row = document.createElement('article'); row.className = 'list-item'; row.dataset.todoId = id;
  const label = document.createElement('label'); label.className = 'todo-label';
  const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.dataset.action = 'toggle'; checkbox.dataset.id = id;
  const text = document.createElement('span'); text.append(document.createElement('strong'), document.createElement('small')); label.append(checkbox, text);
  const remove = document.createElement('button'); remove.className = 'icon-button'; remove.textContent = '삭제'; remove.dataset.action = 'delete'; remove.dataset.id = id;
  row.append(label, remove); return row;
}
function updateTodoRow(row: HTMLElement, todo: Todo, done: boolean) {
  row.classList.toggle('done', done);
  const checkbox = row.querySelector<HTMLInputElement>('[data-action="toggle"]')!; checkbox.checked = done;
  row.querySelector('strong')!.textContent = todo.title;
  const period = todo.frequency === 'daily' ? '일일' : todo.frequency === 'weekly' ? '주간' : `${todo.customDays}일 주기`;
  row.querySelector('small')!.textContent = `${todo.scope === 'account' ? '계정 공통' : todo.scope} · ${period} · ${todo.resetTime} KST`;
  const remove = row.querySelector<HTMLButtonElement>('[data-action="delete"]')!; remove.setAttribute('aria-label', `${todo.title} 삭제`);
}
function renderTodos() {
  const list = app.querySelector('#todos-list'); if (!list) return;
  const visible = data.todos.filter(t => t.scope === 'account' || t.scope === data.selectedCharacter);
  const existing = new Map(Array.from(list.children).flatMap(child => child instanceof HTMLElement && child.dataset.todoId ? [[child.dataset.todoId, child] as const] : []));
  if (!visible.length) {
    for (const child of Array.from(list.children)) child.remove();
    const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = '표시할 할 일이 없습니다.'; list.append(empty); return;
  }
  list.querySelector('.empty')?.remove();
  const rows = visible.map(todo => existing.get(todo.id) ?? createTodoRow(todo.id));
  rows.forEach((row, index) => {
    if (list.children[index] !== row) list.insertBefore(row, list.children[index] ?? null);
    updateTodoRow(row, visible[index], todoIsDone(visible[index], new Date()));
  });
  while (list.children.length > rows.length) list.lastElementChild?.remove();
}
async function startSkillTimer() {
  if (activeSkillSnapshot) return;
  const skill = data.skills.find(item => item.id === activeSkillId && item.characterNames.includes(data.selectedCharacter));
  if (!skill) { showDataStatus('현재 캐릭터에서 사용할 스킬을 선택해 주세요.'); return; }
  activeSkillSnapshot = structuredClone(skill); timerMuted = false; timerPaused = false;
  startNotificationSession(effectiveCooldown(skill) * 1000);
}
function startCycle(duration: number, deadline = Date.now() + duration) {
  if (!activeSkillSnapshot || duration <= 0) return;
  timerRemainingMs = duration; timerEndsAt = deadline; clearInterval(skillTimer); skillTimer = window.setInterval(setCountdown, 100);
  updateTimerControls(); setCountdown();
}
function startNotificationSession(firstDelay: number) {
  if (!activeSkillSnapshot || timerPaused) return;
  const period = effectiveCooldown(activeSkillSnapshot) * 1000;
  timerSchedulePending = !timerMuted; startCycle(firstDelay);
  if (!timerMuted) { const generation = ++timerGeneration; void scheduleNotificationSession(generation, firstDelay, period); }
}
async function scheduleNotificationSession(generation: number, firstDelay: number, period: number) {
  const skill = activeSkillSnapshot; if (!skill) return;
  const scheduled = await window.desktop.scheduleNotification(skill.name, `${skill.name} 쿨타임이 끝났습니다.`, firstDelay, period).catch(() => null);
  if (generation !== timerGeneration || timerMuted || timerPaused || activeSkillSnapshot?.id !== skill.id) {
    if (scheduled?.id) void window.desktop.cancelNotification(scheduled.id).catch(() => {}); return;
  }
  timerSchedulePending = false; timerNotificationId = scheduled?.id ?? null;
  if (scheduled) { const deadline = scheduled.scheduledAt + firstDelay; startCycle(firstDelay, deadline); }
  else showDataStatus('시스템 알림을 사용할 수 없습니다. 앱 안의 타이머만 표시합니다.');
}
function invalidateNotificationSession() {
  timerGeneration++; timerSchedulePending = false;
  const id = timerNotificationId; timerNotificationId = null;
  if (id) void window.desktop.cancelNotification(id).catch(() => {});
}
function setCountdown() {
  const output = app.querySelector<HTMLOutputElement>('#countdown');
  if (timerPaused && activeSkillSnapshot) { if (output) output.value = `${activeSkillSnapshot.name}: 일시정지 · 남은 ${Math.ceil(timerRemainingMs / 1000)}초`; return; }
  if (!timerEndsAt || !activeSkillSnapshot) return;
  if (timerSchedulePending && timerEndsAt <= Date.now()) { if (output) output.value = `${activeSkillSnapshot.name}: 시스템 알림 예약 중`; return; }
  const period = effectiveCooldown(activeSkillSnapshot) * 1000; const now = Date.now();
  if (now >= timerEndsAt) { do { timerEndsAt += period; } while (timerEndsAt <= now); timerRemainingMs = timerEndsAt - now; }
  const left = Math.max(0, Math.ceil((timerEndsAt - now) / 1000));
  if (output) output.value = `${activeSkillSnapshot.name}: ${left}초${timerMuted ? ' · 음소거' : ''}`;
}
function togglePause() {
 if (!activeSkillSnapshot) return;
 if (!timerPaused) { setCountdown(); timerRemainingMs = Math.max(1, timerEndsAt - Date.now()); timerPaused = true; timerEndsAt = 0; invalidateNotificationSession(); clearInterval(skillTimer); skillTimer = 0; }
 else { timerPaused = false; startNotificationSession(timerRemainingMs); }
 updateTimerControls(); setCountdown();
}
function toggleMute() {
 if (!activeSkillSnapshot) return;
 if (!timerMuted) { timerMuted = true; invalidateNotificationSession(); }
 else { timerMuted = false; const remaining = timerPaused ? timerRemainingMs : Math.max(1, timerEndsAt - Date.now()); startNotificationSession(remaining); }
 updateTimerControls(); setCountdown();
}
function resyncTimer() {
 if (!activeSkillSnapshot) return;
 invalidateNotificationSession(); timerPaused = false;
 const duration = effectiveCooldown(activeSkillSnapshot) * 1000; startCycle(duration);
 if (!timerMuted) startNotificationSession(duration);
 updateTimerControls();
}
function updateTimerControls() {
 const running = Boolean(activeSkillSnapshot); const start = app.querySelector<HTMLButtonElement>('#start-timer'); const stop = app.querySelector<HTMLButtonElement>('#stop-timer');
 if (start) start.disabled = running; if (stop) stop.disabled = !running;
 const pause = app.querySelector<HTMLButtonElement>('#pause-timer'); if (pause) { pause.disabled = !running; pause.textContent = timerPaused ? '재개' : '일시정지'; }
 const mute = app.querySelector<HTMLButtonElement>('#mute-timer'); if (mute) { mute.disabled = !running; mute.textContent = timerMuted ? '음소거 해제' : '음소거'; }
 const resync = app.querySelector<HTMLButtonElement>('#resync-timer'); if (resync) resync.disabled = !running;
}
stopTimer = () => {
 const active = Boolean(activeSkillSnapshot); invalidateNotificationSession(); timerEndsAt = 0; timerRemainingMs = 0; timerPaused = false; activeSkillSnapshot = null; clearInterval(skillTimer); skillTimer = 0;
 updateTimerControls(); if (active) { const output = app.querySelector<HTMLOutputElement>('#countdown'); if (output) output.value = '중지됨'; }
};
async function refreshSources() {
  try {
    const sources = await window.desktop.listSources(); const select = app.querySelector<HTMLSelectElement>('#source')!; select.replaceChildren(new Option('캡처할 창/화면 선택', ''));
    for (const source of sources) { const option = document.createElement('option'); option.value = source.id; option.textContent = source.name; select.append(option); }
  } catch { captureStatus('화면 목록을 불러오지 못했습니다. 앱을 다시 시작해 주세요.'); }
}
async function selectCaptureSource(id: string) {
  try { const accepted = await window.desktop.selectSource(id); app.querySelector<HTMLButtonElement>('#start-capture')!.disabled = !accepted || captureState !== 'idle'; if (!accepted) captureStatus('화면 선택을 확인할 수 없습니다. 목록을 새로고침해 주세요.'); }
  catch { captureStatus('화면 선택을 적용하지 못했습니다.'); }
}
async function startCapture() {
  if (captureState !== 'idle') return;
  const source = app.querySelector<HTMLSelectElement>('#source')!.value; if (!source) return captureStatus('먼저 화면 목록을 불러온 뒤 캡처 대상을 선택하세요.');
  captureState = 'starting'; const attempt = ++captureVersion; setCaptureControls(); captureStatus('선택한 화면 연결 중…');
  let stream: MediaStream | null = null;
  try {
    const request = navigator.mediaDevices.getDisplayMedia({ audio: false, video: { frameRate: { ideal: 10, max: 15 } } });
    stream = await request;
    if (attempt !== captureVersion) { stream.getTracks().forEach(track => track.stop()); return; }
    capture = stream; const video = app.querySelector<HTMLVideoElement>('#preview')!; video.srcObject = stream; await video.play();
    if (attempt !== captureVersion) { stream.getTracks().forEach(track => track.stop()); return; }
    await window.desktop.openObserver();
    if (attempt !== captureVersion) { stream.getTracks().forEach(track => track.stop()); return; }
    captureState = 'running'; frameTimer = window.setInterval(publishCrop, 350); setCaptureControls(); captureStatus('캡처 중 — 영상은 기기 안에서만 처리됩니다.');
    stream.getVideoTracks()[0]?.addEventListener('ended', () => stopCapture(), { once: true });
  } catch {
    if (stream) stream.getTracks().forEach(track => track.stop());
    if (attempt === captureVersion) { capture = null; const video = app.querySelector<HTMLVideoElement>('#preview'); if (video) video.srcObject = null; captureState = 'idle'; void window.desktop.closeObserver().catch(() => {}); setCaptureControls(); captureStatus('캡처를 시작하지 못했습니다. 대상 선택/OS 권한을 확인하세요.'); }
  }
}
function setCaptureControls() {
  const start = app.querySelector<HTMLButtonElement>('#start-capture'); const stop = app.querySelector<HTMLButtonElement>('#stop-capture'); const select = app.querySelector<HTMLSelectElement>('#source');
  if (start) start.disabled = captureState !== 'idle' || !select?.value;
  if (stop) stop.disabled = captureState === 'idle'; if (select) select.disabled = captureState !== 'idle';
}
function publishCrop() {
  const video = app.querySelector<HTMLVideoElement>('#preview'); if (!video || !capture || video.readyState < 2) return;
  const canvas = document.createElement('canvas'); let sx = 0, sy = 0, sw = video.videoWidth, sh = video.videoHeight;
  if (crop === 'wide') { const ratio = 16 / 9; if (sw / sh > ratio) { const width = sh * ratio; sx = (sw - width) / 2; sw = width; } else { const height = sw / ratio; sy = (sh - height) / 2; sh = height; } }
  else if (crop === 'square') { const side = Math.min(sw, sh); sx = (sw - side) / 2; sy = (sh - side) / 2; sw = side; sh = side; }
  canvas.width = 480; canvas.height = Math.max(1, Math.round(480 * sh / sw)); canvas.getContext('2d')?.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  void window.desktop.publishFrame(canvas.toDataURL('image/jpeg', .62)).catch(() => captureStatus('observer 창 연결이 끊겼습니다.'));
}
function refreshVisibleState() { renderTodos(); setCountdown(); }
function stopCapture() {
  const wasActive = captureState !== 'idle'; captureVersion++; const stream = capture; capture = null; captureState = 'idle'; clearInterval(frameTimer); frameTimer = 0; stream?.getTracks().forEach(track => track.stop());
  const video = app.querySelector<HTMLVideoElement>('#preview'); if (video) video.srcObject = null;
  void window.desktop.closeObserver().catch(() => {}); setCaptureControls(); if (wasActive) captureStatus('캡처를 중지했습니다. 미리보기 연결과 영상 트랙을 정리했습니다.');
}
function captureStatus(text: string) { const el = app.querySelector('#capture-status'); if (el) el.textContent = text; }
function showDataStatus(text: string) { const el = app.querySelector('#data-status'); if (el) el.textContent = text; }
function exportData() {
  try { const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'maple-assistant-backup.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 0); }
  catch { showDataStatus('백업 파일을 만들지 못했습니다.'); }
}
async function importData(event: Event) {
  const input = event.currentTarget as HTMLInputElement;
  try {
    const file = input.files?.[0]; if (!file || file.size > 2_000_000) throw new Error('파일이 없거나 너무 큽니다.');
    const candidate = parseAppData(await file.text());
    try { saveData(store, candidate); } catch { throw new Error('로컬 저장 공간에 기록할 수 없습니다. 기존 데이터는 유지했습니다.'); }
    const wasCapturing = captureState !== 'idle'; stopPageWork(); data = candidate; renderApp(); showDataStatus('가져오기를 완료했습니다.'); if (wasCapturing) captureStatus('가져오기로 캡처를 중지하고 영상 트랙/observer를 정리했습니다.');
  } catch (error) { showDataStatus(error instanceof Error ? `가져오기 실패: ${error.message}` : '가져오기에 실패했습니다. 기존 데이터를 유지했습니다.'); }
  finally { input.value = ''; }
}
function cleanup() {
  stopPageWork(); cleanupFrame?.(); void window.desktop.closeObserver().catch(() => {});
  window.removeEventListener('focus', refreshVisibleState); document.removeEventListener('visibilitychange', refreshVisibleState);
}
