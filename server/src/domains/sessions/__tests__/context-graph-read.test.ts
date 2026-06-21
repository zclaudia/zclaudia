import Database from 'better-sqlite3';
import { applyMigrations } from '../../../infra/storage/migrations/index.js';
import { buildSessionSubgraph } from '../context-graph-read.js';

function seedProject(db: Database.Database) {
  db.prepare(`INSERT INTO llm_profiles (id, name, provider_type, created_at, updated_at) VALUES ('l','d','anthropic',1,1)`).run();
  db.prepare(`INSERT INTO projects (id, name, created_at, updated_at) VALUES ('p','p',1,1)`).run();
  db.prepare(`INSERT INTO agent_profiles (id, name, llm_profile_id, created_at, updated_at) VALUES ('a','a','l',1,1)`).run();
}
function addSession(db: Database.Database, id: string) {
  db.prepare(`INSERT INTO sessions (id, project_id, agent_profile_id, type, created_at, updated_at) VALUES (?, 'p','a','regular',1,1)`).run(id);
}
function addEntry(db: Database.Database, sid: string, id: string, parent: string | null, type: string, payload: unknown) {
  db.prepare(`INSERT INTO session_entries (id, session_id, parent_id, type, payload, timestamp) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, sid, parent, type, JSON.stringify(payload), new Date(1700000000000).toISOString());
}
function setLeaf(db: Database.Database, sid: string, leaf: string) {
  db.prepare(`INSERT INTO session_leaf (session_id, leaf_id) VALUES (?, ?) ON CONFLICT(session_id) DO UPDATE SET leaf_id=excluded.leaf_id`).run(sid, leaf);
}
function msg(role: string, text: string) {
  return role === 'user' ? { message: { role, content: text } } : { message: { role, content: [{ type: 'text', text }] } };
}

const NO_FORK = { forkBaseEntryId: null, forkPointEntryIds: new Set<string>(), nodeCap: 2000 };

it('linear session: root + leaf nodes, edge counts collapsed user/assistant messages', () => {
  const db = new Database(':memory:'); applyMigrations(db); seedProject(db); addSession(db, 's');
  addEntry(db, 's', 'e1', null, 'message', msg('user', 'u1'));
  addEntry(db, 's', 'e2', 'e1', 'message', msg('assistant', 'a1'));
  addEntry(db, 's', 'e3', 'e2', 'message', msg('user', 'u2'));
  addEntry(db, 's', 'e4', 'e3', 'message', msg('assistant', 'a2'));
  addEntry(db, 's', 'e5', 'e4', 'message', msg('assistant', 'a3'));
  setLeaf(db, 's', 'e5');
  const { nodes, truncated } = buildSessionSubgraph(db, 's', NO_FORK);
  expect(truncated).toBe(false);
  expect(nodes.map((n) => n.entryId).sort()).toEqual(['e1', 'e5']);
  const leaf = nodes.find((n) => n.entryId === 'e5')!;
  expect(leaf.isActiveLeaf).toBe(true);
  expect(leaf.parentNodeId).toBe('s:e1');
  expect(leaf.incomingMessageCount).toBe(3);
  const root = nodes.find((n) => n.entryId === 'e1')!;
  expect(root.isRoot).toBe(true);
  expect(root.parentNodeId).toBeNull();
  expect(root.onActivePath).toBe(true);
  db.close();
});

it('does not count toolResult entries in the collapsed edge', () => {
  const db = new Database(':memory:'); applyMigrations(db); seedProject(db); addSession(db, 's');
  addEntry(db, 's', 'e1', null, 'message', msg('user', 'u1'));
  addEntry(db, 's', 'e2', 'e1', 'message', msg('assistant', 'a1'));
  addEntry(db, 's', 'e3', 'e2', 'message', { message: { role: 'toolResult', toolCallId: 't', content: [{ type: 'text', text: 'r' }] } });
  addEntry(db, 's', 'e4', 'e3', 'message', msg('assistant', 'a2'));
  setLeaf(db, 's', 'e4');
  const { nodes } = buildSessionSubgraph(db, 's', NO_FORK);
  expect(nodes.find((n) => n.entryId === 'e4')!.incomingMessageCount).toBe(1);
  db.close();
});

it('rewind branch: branch point + active leaf + abandoned tip flags', () => {
  const db = new Database(':memory:'); applyMigrations(db); seedProject(db); addSession(db, 's');
  addEntry(db, 's', 'e1', null, 'message', msg('user', 'u1'));
  addEntry(db, 's', 'e2', 'e1', 'message', msg('assistant', 'old'));
  addEntry(db, 's', 'e3', 'e1', 'message', msg('assistant', 'new'));
  setLeaf(db, 's', 'e3');
  const { nodes } = buildSessionSubgraph(db, 's', NO_FORK);
  expect(nodes.find((n) => n.entryId === 'e1')!.isBranchPoint).toBe(true);
  const active = nodes.find((n) => n.entryId === 'e3')!;
  expect(active.isActiveLeaf).toBe(true);
  expect(active.onActivePath).toBe(true);
  const old = nodes.find((n) => n.entryId === 'e2')!;
  expect(old.isBranchTip).toBe(true);
  expect(old.onActivePath).toBe(false);
  db.close();
});

it('compaction + label nodes carry payload and targets', () => {
  const db = new Database(':memory:'); applyMigrations(db); seedProject(db); addSession(db, 's');
  addEntry(db, 's', 'e1', null, 'message', msg('user', 'u1'));
  addEntry(db, 's', 'e2', 'e1', 'compaction', { summary: 'sum', tokensBefore: 4200, details: { source: 'manual' } });
  addEntry(db, 's', 'e3', 'e2', 'label', { targetId: 'e1', label: 'before-refactor' });
  addEntry(db, 's', 'e4', 'e3', 'message', msg('assistant', 'a1'));
  setLeaf(db, 's', 'e4');
  const { nodes } = buildSessionSubgraph(db, 's', NO_FORK);
  const comp = nodes.find((n) => n.entryId === 'e2')!;
  expect(comp.entryType).toBe('compaction');
  expect(comp.compaction).toEqual({ summary: 'sum', tokensBefore: 4200, source: 'manual' });
  expect(comp.jump.compactionId).toBe('e2');
  const lab = nodes.find((n) => n.entryId === 'e3')!;
  expect(lab.label).toBe('before-refactor');
  expect(lab.labelTargetNodeId).toBe('s:e1');
  db.close();
});

it('messageId jump falls back up to nearest projected message row (toolResult leaf)', () => {
  const db = new Database(':memory:'); applyMigrations(db); seedProject(db); addSession(db, 's');
  addEntry(db, 's', 'e1', null, 'message', msg('user', 'u1'));
  addEntry(db, 's', 'e2', 'e1', 'message', msg('assistant', 'a1'));
  addEntry(db, 's', 'e3', 'e2', 'message', { message: { role: 'toolResult', toolCallId: 't', content: [] } });
  setLeaf(db, 's', 'e3');
  db.prepare(`INSERT INTO messages (id, session_id, role, content, created_at, offset, tree_entry_id) VALUES ('m_a','s','assistant','a1',1,2,'e2')`).run();
  db.prepare(`INSERT INTO messages (id, session_id, role, content, created_at, offset, tree_entry_id) VALUES ('m_u','s','user','u1',1,1,'e1')`).run();
  const { nodes } = buildSessionSubgraph(db, 's', NO_FORK);
  expect(nodes.find((n) => n.entryId === 'e3')!.jump.messageId).toBe('m_a');
  db.close();
});

it('fork base entry is always structural even when deep in the chain', () => {
  const db = new Database(':memory:'); applyMigrations(db); seedProject(db); addSession(db, 's');
  addEntry(db, 's', 'e1', null, 'message', msg('user', 'u1'));
  addEntry(db, 's', 'e2', 'e1', 'message', msg('assistant', 'a1'));
  addEntry(db, 's', 'e3', 'e2', 'message', msg('user', 'u2'));
  addEntry(db, 's', 'e4', 'e3', 'message', msg('assistant', 'a2'));
  setLeaf(db, 's', 'e4');
  const { nodes } = buildSessionSubgraph(db, 's', { forkBaseEntryId: 'e2', forkPointEntryIds: new Set(), nodeCap: 2000 });
  const base = nodes.find((n) => n.entryId === 'e2');
  expect(base).toBeTruthy();
  expect(base!.isForkBase).toBe(true);
  db.close();
});

it('respects node cap and reports truncation', () => {
  const db = new Database(':memory:'); applyMigrations(db); seedProject(db); addSession(db, 's');
  let prev: string | null = null;
  for (let i = 1; i <= 6; i++) { addEntry(db, 's', `e${i}`, prev, 'message', msg(i % 2 ? 'user' : 'assistant', `m${i}`)); prev = `e${i}`; }
  setLeaf(db, 's', 'e6');
  const { truncated } = buildSessionSubgraph(db, 's', { forkBaseEntryId: null, forkPointEntryIds: new Set(), nodeCap: 3 });
  expect(truncated).toBe(true);
  db.close();
});
