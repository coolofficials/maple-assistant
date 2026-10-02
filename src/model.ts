export type TodoFrequency = 'daily' | 'weekly' | 'custom';
export interface Skill { id: string; name: string; cooldownSec: number; reductionPct: number; effectiveOverrideSec?: number; characterNames: string[]; }
export interface CharacterCooldownSpec { characterName: string; reductionPct: number; reductionSec: number; }
export interface Todo { id: string; title: string; scope: string; frequency: TodoFrequency; resetWeekday: number; resetTime: string; customDays: number; doneAt?: string; }
export interface AppData { skills: Skill[]; todos: Todo[]; characters: string[]; selectedCharacter: string; characterCooldownSpecs: CharacterCooldownSpec[]; }
export const defaults: AppData = { skills: [], todos: [], characters: ['내 캐릭터'], selectedCharacter: '내 캐릭터', characterCooldownSpecs: [{ characterName: '내 캐릭터', reductionPct: 0, reductionSec: 0 }] };
const storageKey = 'maple-assistant-data-v1';
const uuidPattern = /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const onlyKeys = (value: object, required: string[], optional: string[] = []) => { const keys = Object.keys(value); return required.every(k => keys.includes(k)) && keys.every(k => required.includes(k) || optional.includes(k)); };
export function isValidCharacterName(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 60 && value.trim().toLocaleLowerCase('en-US') !== 'account'; }
export function validSkill(skill: unknown): skill is Skill {
  if (!skill || typeof skill !== 'object') return false; const s = skill as Partial<Skill>;
  return onlyKeys(skill, ['id','name','cooldownSec','reductionPct','characterNames'], ['effectiveOverrideSec']) && typeof s.id === 'string' && uuidPattern.test(s.id) && typeof s.name === 'string' && Boolean(s.name.trim()) && s.name.trim().length <= 50 && Number.isFinite(s.cooldownSec) && s.cooldownSec! > 0 && s.cooldownSec! <= 86400 && Number.isFinite(s.reductionPct) && s.reductionPct! >= 0 && s.reductionPct! <= 100 && Array.isArray(s.characterNames) && s.characterNames.length > 0 && s.characterNames.every(isValidCharacterName) && new Set(s.characterNames).size === s.characterNames.length && (s.effectiveOverrideSec === undefined || (Number.isFinite(s.effectiveOverrideSec) && s.effectiveOverrideSec! > 0 && s.effectiveOverrideSec! <= 86400));
}
export function validCharacterCooldownSpec(spec: unknown): spec is CharacterCooldownSpec { if (!spec || typeof spec !== 'object') return false; const s = spec as Partial<CharacterCooldownSpec>; return onlyKeys(spec, ['characterName','reductionPct','reductionSec']) && isValidCharacterName(s.characterName) && Number.isFinite(s.reductionPct) && s.reductionPct! >= 0 && s.reductionPct! <= 100 && Number.isFinite(s.reductionSec) && s.reductionSec! >= 0 && s.reductionSec! <= 86400; }
export function validTodo(todo: unknown): todo is Todo {
 if (!todo || typeof todo !== 'object') return false; const t = todo as Partial<Todo>;
 const keys = onlyKeys(todo, ['id','title','scope','frequency','resetWeekday','resetTime','customDays'], ['doneAt']);
 const validDoneAt = t.doneAt === undefined || (typeof t.doneAt === 'string' && Number.isFinite(Date.parse(t.doneAt)) && new Date(t.doneAt).toISOString() === t.doneAt);
 return keys && typeof t.id === 'string' && uuidPattern.test(t.id) && typeof t.title === 'string' && Boolean(t.title.trim()) && t.title.trim().length <= 100 && typeof t.scope === 'string' && Boolean(t.scope.trim()) && t.scope.length <= 60 && ['daily','weekly','custom'].includes(t.frequency ?? '') && Number.isInteger(t.resetWeekday) && t.resetWeekday! >= 0 && t.resetWeekday! <= 6 && typeof t.resetTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t.resetTime) && Number.isInteger(t.customDays) && t.customDays! > 0 && t.customDays! <= 365 && validDoneAt;
}
export function validateAppData(value: unknown): value is AppData {
 if (!value || typeof value !== 'object') return false; const d = value as Partial<AppData>;
 if (!onlyKeys(value, ['skills','todos','characters','selectedCharacter','characterCooldownSpecs']) || !Array.isArray(d.skills) || !Array.isArray(d.todos) || !Array.isArray(d.characters) || !Array.isArray(d.characterCooldownSpecs) || d.skills.length > 500 || d.todos.length > 5000 || d.characters.length === 0 || d.characters.length > 100 || typeof d.selectedCharacter !== 'string') return false;
 if (!d.characters.every(isValidCharacterName)) return false; const characterKeys = d.characters.map(c => c.trim().toLocaleLowerCase('en-US'));
 if (new Set(characterKeys).size !== characterKeys.length || !d.characters.includes(d.selectedCharacter)) return false;
 if (!d.skills.every(validSkill) || !d.todos.every(validTodo) || !d.characterCooldownSpecs.every(validCharacterCooldownSpec)) return false;
 if (d.characterCooldownSpecs.length !== d.characters.length || d.characters.some(c => d.characterCooldownSpecs!.filter(s => s.characterName === c).length !== 1)) return false;
 const ids = [...d.skills.map(s => s.id), ...d.todos.map(t => t.id)]; if (new Set(ids).size !== ids.length) return false;
 return d.skills.every(s => s.characterNames.every(c => d.characters!.includes(c))) && d.todos.every(t => t.scope === 'account' || d.characters!.includes(t.scope));
}
function migrate(value: unknown): unknown {
 if (!value || typeof value !== 'object') return value; const d = value as Record<string, unknown>;
 if (Array.isArray(d.characters) && !('characterCooldownSpecs' in d)) {
   const characters = d.characters as string[];
   return { ...d, characterCooldownSpecs: characters.map(characterName => ({ characterName, reductionPct: 0, reductionSec: 0 })), skills: Array.isArray(d.skills) ? d.skills.map(skill => skill && typeof skill === 'object' && !('characterNames' in skill) ? { ...skill, characterNames: [...characters] } : skill) : d.skills };
 }
 return value;
}
export function parseAppData(text: string): AppData { const value = migrate(JSON.parse(text) as unknown); if (!validateAppData(value)) throw new Error('백업 데이터 형식이 올바르지 않습니다.'); return value; }
export function loadData(storage: Pick<Storage, 'getItem'>): AppData { try { const raw = storage.getItem(storageKey); if (!raw) return structuredClone(defaults); const parsed = parseAppData(raw); return parsed; } catch { return structuredClone(defaults); } }
export function saveData(storage: Pick<Storage, 'setItem'>, data: AppData): void { if (!validateAppData(data)) throw new Error('저장할 데이터가 schema 또는 최대 개수 제한을 충족하지 않습니다.'); storage.setItem(storageKey, JSON.stringify(data)); }
export function todoIsDone(todo: Todo, now: Date): boolean { if (!todo.doneAt) return false; const done = new Date(todo.doneAt); if (!Number.isFinite(done.getTime())) return false; return periodKey(todo, done) === periodKey(todo, now); }
function kstParts(date: Date) { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date); return Object.fromEntries(parts.map(p => [p.type, p.value])); }
function periodKey(todo: Todo, date: Date): string { const p = kstParts(date); const day = `${p.year}-${p.month}-${p.day}`; if (todo.frequency === 'daily') { const reset = new Date(`${day}T${todo.resetTime}:00+09:00`); if (date < reset) reset.setTime(reset.getTime() - 86_400_000); return reset.toISOString().slice(0, 10); } if (todo.frequency === 'custom') { const [hour, minute] = todo.resetTime.split(':').map(Number); const anchor = Date.UTC(1970, 0, 1, hour, minute) - 9 * 60 * 60_000; return String(Math.floor((date.getTime() - anchor) / (todo.customDays * 86_400_000))); } const weekday = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(p.weekday); const daysBack = (weekday - todo.resetWeekday + 7) % 7; const reset = new Date(`${day}T${todo.resetTime}:00+09:00`); const anchor = new Date(reset.getTime() - daysBack * 86_400_000); if (date < anchor) anchor.setTime(anchor.getTime() - 7 * 86_400_000); return anchor.toISOString().slice(0, 10); }
export function effectiveCooldown(skill: Skill): number { return skill.effectiveOverrideSec ?? skill.cooldownSec; }
export function todoResetKey(todo: Todo, date: Date): string { return periodKey(todo, date); }
