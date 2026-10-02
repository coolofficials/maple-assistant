import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaults, effectiveCooldown, isValidCharacterName, loadData, parseAppData, saveData, todoIsDone, validateAppData, validSkill, validTodo, type AppData, type Todo } from './model';
const skill = { id: '123e4567-e89b-42d3-a456-426614174000', name: 'Buff', cooldownSec: 40, reductionPct: 80, effectiveOverrideSec: 31, characterNames: ['A'] };
const base: Todo = { id: '123e4567-e89b-42d3-a456-426614174001', title: 'daily', scope: 'account', frequency: 'daily', resetWeekday: 1, resetTime: '04:00', customDays: 7 };
const validData: AppData = { skills: [skill], todos: [{ ...base, doneAt: '2025-01-02T19:30:00.000Z' }], characters: ['A'], selectedCharacter: 'A', characterCooldownSpecs: [{ characterName: 'A', reductionPct: 0, reductionSec: 0 }] };
const testId = (n: number) => `${n.toString(16).padStart(8,'0')}-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
const localMemory = () => { const map = new Map<string,string>(); return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => map.set(key,value) }; };
describe('strict local backup schema', () => {
  it('round-trips and recovers bad storage without throwing', () => {
    const memory = new Map<string, string>(); const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value) };
    expect(loadData(storage)).toEqual(defaults); saveData(storage, validData); expect(loadData(storage)).toEqual(validData);
    memory.set('maple-assistant-data-v1', '{bad'); expect(loadData(storage)).toEqual(defaults);
    expect(loadData({ getItem: () => { throw new Error('storage unavailable'); } })).toEqual(defaults);
  });
  it('migrates legacy string-character backups, round-trips per-character specs, and rejects dangling skill references', () => {
    const legacy = { skills: [{ id: skill.id, name: skill.name, cooldownSec: 40, reductionPct: 80, effectiveOverrideSec: 31 }], todos: [], characters: ['A', 'B'], selectedCharacter: 'A' };
    const migrated = parseAppData(JSON.stringify(legacy)); expect(migrated.skills[0].characterNames).toEqual(['A', 'B']); expect(migrated.characterCooldownSpecs).toHaveLength(2);
    const updated = { ...migrated, characterCooldownSpecs: migrated.characterCooldownSpecs.map(spec => spec.characterName === 'B' ? { ...spec, reductionPct: 15, reductionSec: 4 } : spec) };
    const storage = localMemory(); saveData(storage, updated); expect(loadData(storage)).toEqual(updated); expect(parseAppData(JSON.stringify(updated))).toEqual(updated);
    expect(validateAppData({ ...updated, skills: [{ ...updated.skills[0], characterNames: ['missing'] }] })).toBe(false);
    expect(validateAppData({ ...updated, characterCooldownSpecs: updated.characterCooldownSpecs.filter(spec => spec.characterName !== 'B') })).toBe(false);
  });
  it('rejects unknown fields, mismatched character references, bad dates and duplicate IDs', () => {
    expect(validateAppData({ ...validData, extra: true })).toBe(false);
    expect(validateAppData({ ...validData, selectedCharacter: 'missing' })).toBe(false);
    expect(validateAppData({ ...validData, todos: [{ ...base, doneAt: 'not-a-date' }] })).toBe(false);
    expect(validateAppData({ ...validData, todos: [{ ...base, scope: 'missing-character' }] })).toBe(false);
    expect(validateAppData({ ...validData, todos: [{ ...base, id: skill.id }] })).toBe(false);
    expect(validateAppData({ ...validData, characters: ['A', 'a'] })).toBe(false);
    expect(() => parseAppData(JSON.stringify({ ...validData, selectedCharacter: 'other' }))).toThrow();
  });
  it('requires UUIDs and rejects injected object keys while rendering text fields as arbitrary strings safely', () => {
    expect(validSkill({ ...skill, id: '\"><img src=x onerror=alert(1)>' })).toBe(false);
    expect(validateAppData({ ...validData, todos: [{ ...base, title: '<img src=x onerror=alert(1)>' }] })).toBe(true);
    expect(validTodo({ ...base, resetTime: '99:00' })).toBe(false);
  });
  it('validates character name limits, duplicates are case-insensitive in app validation, and account scope is reserved', () => {
    expect(isValidCharacterName('  account ')).toBe(false); expect(isValidCharacterName(' A ')).toBe(true);
    expect(validateAppData({ ...validData, characters: ['A', 'a'] })).toBe(false);
  });
});
describe('validated save limits and restart round trips', () => {
  const storageKey = 'maple-assistant-data-v1';
  it('persists 100 characters and rejects character 101 without replacing saved state', () => {
    const storage = localMemory(); const existing = Array.from({ length: 99 }, (_, i) => `Character ${i}`);
    const characters = [...existing, 'Character 99']; const data: AppData = { skills: [], todos: [], characters, selectedCharacter: existing[0], characterCooldownSpecs: characters.map(characterName => ({ characterName, reductionPct: 0, reductionSec: 0 })) };
    saveData(storage, data); expect(loadData(storage)).toEqual(data);
    expect(() => saveData(storage, { ...data, characters: [...data.characters, 'Character 100'] })).toThrow(); expect(loadData(storage)).toEqual(data); expect(storage.getItem(storageKey)).toBe(JSON.stringify(data));
  });
  it('persists 500 skills and rejects skill 501 without replacing saved state', () => {
    const storage = localMemory(); const existing = Array.from({ length: 499 }, (_, i) => ({ id: testId(i + 1), name: `Skill ${i}`, cooldownSec: 60, reductionPct: 0, characterNames: ['A'] }));
    const data: AppData = { skills: [...existing, { id: testId(500), name: 'Skill 499', cooldownSec: 60, reductionPct: 0, characterNames: ['A'] }], todos: [], characters: ['A'], selectedCharacter: 'A', characterCooldownSpecs: [{ characterName: 'A', reductionPct: 0, reductionSec: 0 }] }; 
    saveData(storage, data); expect(loadData(storage)).toEqual(data);
    expect(() => saveData(storage, { ...data, skills: [...data.skills, { id: testId(501), name: 'Skill 500', cooldownSec: 60, reductionPct: 0, characterNames: ['A'] }] })).toThrow(); expect(loadData(storage)).toEqual(data);
  });
  it('persists 5000 todos and rejects todo 5001 without replacing saved state', () => {
    const storage = localMemory(); const existing = Array.from({ length: 4999 }, (_, i) => ({ ...base, id: testId(i + 1000), title: `Todo ${i}` }));
    const data: AppData = { skills: [], todos: [...existing, { ...base, id: testId(5999), title: 'Todo 4999' }], characters: ['A'], selectedCharacter: 'A', characterCooldownSpecs: [{ characterName: 'A', reductionPct: 0, reductionSec: 0 }] };
    saveData(storage, data); expect(loadData(storage)).toEqual(data);
    expect(() => saveData(storage, { ...data, todos: [...data.todos, { ...base, id: testId(6000), title: 'Todo 5000' }] })).toThrow(); expect(loadData(storage)).toEqual(data);
  });
});
describe('KST reset periods', () => {
  beforeEach(() => { vi.useRealTimers(); });
  it('daily period changes at configured Korea-local time (UTC crossing)', () => {
    const todo = { ...base, doneAt: '2025-01-02T19:30:00.000Z' };
    expect(todoIsDone(todo, new Date('2025-01-03T18:59:59.999Z'))).toBe(true);
    expect(todoIsDone(todo, new Date('2025-01-03T19:00:00.000Z'))).toBe(false);
  });
  it('weekly reset uses configured weekday and KST time', () => {
    const todo = { ...base, frequency: 'weekly' as const, resetWeekday: 1, doneAt: '2025-01-06T00:00:00.000Z' };
    expect(todoIsDone(todo, new Date('2025-01-12T18:59:59.999Z'))).toBe(true);
    expect(todoIsDone(todo, new Date('2025-01-12T19:00:00.000Z'))).toBe(false);
  });
  it('custom multi-day interval changes exactly at its reset time', () => {
    const todo: Todo = { ...base, frequency: 'custom', customDays: 2, doneAt: '2025-01-01T19:01:00.000Z' };
    expect(todoIsDone(todo, new Date('2025-01-03T18:59:59.999Z'))).toBe(true);
    expect(todoIsDone(todo, new Date('2025-01-03T19:00:00.000Z'))).toBe(false);
  });
  it('uses the manually entered effective cooldown rather than an unverified formula', () => {
    expect(validSkill(skill)).toBe(true); expect(effectiveCooldown(skill)).toBe(31);
    expect(effectiveCooldown({ ...skill, effectiveOverrideSec: undefined })).toBe(40);
  });
});
