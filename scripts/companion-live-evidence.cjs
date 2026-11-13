'use strict';
// Private, read-only acceptance collector. No SocialStore construction, vault
// access, model call, network request or account action is performed here.
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const profiles = {
  whale: {relativeRoot: 'work/api-preview-home', output: 'companion-nine-live-local.json', label: 'whale-companion'},
  ju: {relativeRoot: 'work/qq-trio/claude/home', output: 'companion-nine-ju-live-local.json', label: 'ju-companion'},
  dragon: {relativeRoot: 'work/qq-trio/codex/home', output: 'companion-nine-dragon-live-local.json', label: 'dragon-companion'}
};
const defaultSince = '2026-11-05T08:50:00Z';
const hash = value => createHash('sha256').update(String(value)).digest('hex');
const iso = value => Number.isFinite(value) ? new Date(value).toISOString() : null;
const redact = value => String(value ?? '')
  .replace(/\b(?:sk-[\w-]{12,}|Bearer\s+[\w.~-]{12,})\b/gi, '[redacted-secret]')
  .replace(/\b\d{5,12}\b/g, '[redacted-number]');
const ids = value => JSON.parse(value || '[]').map(hash);
const stateCounts = rows => rows.reduce((counts, row) => {
  const key = row.state || row.role || 'record';
  counts[key] = (counts[key] || 0) + 1;
  return counts;
}, {});

function readNonsecretConfig(dataRoot) {
  const read = name => {
    const file = path.join(dataRoot, name);
    if (fs.statSync(file).size > 65536) throw Error('Unexpected configuration size.');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  };
  const bot = read('bot-config.json'), social = read('social-config.json');
  const known = (value, allowed) => allowed.includes(value) ? value : null;
  const boolean = value => typeof value === 'boolean' ? value : null;
  return {
    mode: known(bot.mode, ['api', 'claude', 'native', 'codex', 'gpt', 'deepseek']),
    channel: known(bot.channel, ['qq', 'wechat']),
    social: {
      enabled: boolean(social.enabled),
      characterId: typeof social.characterId === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(social.characterId) ? social.characterId : null,
      proactiveMessages: boolean(social.proactiveMessages),
      qzonePosts: boolean(social.qzonePosts)
    },
    source: 'Fixed nonsecret configuration fields only; no vault or credential files read.'
  };
}

function readRecovery(cutoff, scopeHash, observedScopes, {recoveryPath, scopePath}) {
  // The metadata DB has no relationship column. Guard its profile against the
  // current stored scope and any other social scope in this same test window.
  if (fs.statSync(scopePath).size > 4096) throw Error('Unexpected scope metadata size.');
  const savedScope = JSON.parse(fs.readFileSync(scopePath, 'utf8')).scope;
  if (typeof savedScope !== 'string' || !/^[a-f0-9]{64}$/.test(savedScope) || hash(savedScope) !== scopeHash) throw Error('The current relationship differs from this evidence scope.');
  if (observedScopes.some(value => value !== scopeHash)) throw Error('Another relationship appears in this test window; do not mix its recovery metadata.');
  const capturedAt = new Date().toISOString(), db = new DatabaseSync(recoveryPath, {readOnly: true});
  let rows;
  try {
    db.exec('BEGIN');
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='inbound'").get()) throw Error('Recovery inbound table is absent.');
    rows = db.prepare('SELECT id,mode,state,created_at,updated_at,task_id FROM inbound WHERE created_at>=? ORDER BY created_at,rowid LIMIT 501').all(cutoff);
    if (rows.length > 500) throw Error('Recovery evidence exceeds 500 rows; narrow a new test window.');
  } finally { try { db.exec('ROLLBACK'); } finally { db.close(); } }
  const inbound = rows.map(row => ({idHash: hash(row.id),mode: row.mode,state: row.state,receivedAt: iso(row.created_at),updatedAt: iso(row.updated_at),taskId: row.task_id || null,taskIdHash: row.task_id ? hash(row.task_id) : null}));
  const groups = new Map();
  for (const row of inbound) if (row.taskId) {
    const group = groups.get(row.taskId) || []; group.push(row); groups.set(row.taskId, group);
  }
  const taskGroups = [...groups].map(([taskId, entries]) => {
    const times = entries.map(row => Date.parse(row.receivedAt));
    return {taskId,taskIdHash: hash(taskId),inboundCount: entries.length,inboundIdHashes: entries.map(row => row.idHash),states: [...new Set(entries.map(row => row.state))],firstReceivedAt: iso(times[0]),lastReceivedAt: iso(times.at(-1)),arrivalSpanMs: times.at(-1) - times[0],sameTaskMultipleInputs: entries.length > 1,maxAdjacentArrivalGapMs: entries.length > 1 ? Math.max(...times.slice(1).map((time,index) => time - times[index])) : null};
  });
  return {
    capturedAt,currentScopeMatches: true,otherSocialScopesInWindow: 0,
    scopeBoundary: 'Recovery is profile-level metadata filtered by receive time. The current relationship hash matches, and no different social scope appears in this window. Control/rejected records have no direct social-message link.',
    databasesReadInSeparateTransactions: true,inbound,taskGroups,
    summary: {received: inbound.length,states: stateCounts(inbound),taskGroups: taskGroups.length,sharedTaskGroups: taskGroups.filter(group => group.sameTaskMultipleInputs).length,cancelledTaskGroups: taskGroups.filter(group => group.states.includes('cancelled')).length},
    limits: ['Task grouping proves controller association, not the number of provider HTTP requests.','Terminal state is persisted; queued/running transitions require earlier observations to prove when interruption happened.','Task UUIDs are private here; public evidence may include hashes or same-task booleans only.','A restarted app can replace unfinished states with interrupted_unknown; this collector never invokes that recovery.']
  };
}

function main() {
  const options = {};
  for (let index = 2; index < process.argv.length; index += 2) {
    const name = process.argv[index], value = process.argv[index + 1];
    if (!['--since', '--scope-hash', '--profile'].includes(name) || !value) {
      throw Error('Usage: node scripts/companion-live-evidence.cjs [--profile whale|ju|dragon] [--since ISO_TIME] [--scope-hash SHA256]');
    }
    options[name] = value;
  }
  const profile = profiles[options['--profile'] || 'whale'];
  if (!profile) throw Error('Only the explicitly configured whale, ju or dragon test profile is allowed.');
  const dataRoot = path.join(root, profile.relativeRoot), databasePath = path.join(dataRoot, 'social-memory.sqlite');
  const recoveryPath = path.join(dataRoot, 'bot-recovery.sqlite'), scopePath = path.join(dataRoot, 'social-scope.json');
  const outputPath = path.join(root, 'outputs', profile.output);
  const since = options['--since'] || defaultSince, cutoff = Date.parse(since);
  if (!Number.isFinite(cutoff) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(since)) throw Error('The cutoff must include a time zone.');
  let previous = null;
  if (fs.existsSync(outputPath)) {
    if (fs.statSync(outputPath).size > 20 * 1024 * 1024) throw Error('Private evidence exceeds the 20 MiB bound; archive it before collecting more.');
    previous = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    if (Date.parse(previous.since) !== cutoff) throw Error('Existing evidence has a different cutoff; archive it before changing the test window.');
  }
  const db = new DatabaseSync(databasePath, {readOnly: true});
  let scopeHash, records, schema, observedScopes;
  try {
    // A coherent read snapshot; rollback ends only this read transaction.
    db.exec('BEGIN');
    schema = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name);
    for (const table of ['messages', 'actions', 'facts', 'followups', 'public_journal']) {
      if (!schema.includes(table)) throw Error(`Required source table is absent: ${table}`);
    }
    scopeHash = options['--scope-hash'] || previous?.scope?.databaseScopeHash;
    if (scopeHash && !/^[a-f0-9]{64}$/.test(scopeHash)) throw Error('Only a stored SHA-256 scope is accepted; do not pass account numbers.');
    if (!scopeHash) {
      const candidates = db.prepare('SELECT DISTINCT scope FROM messages WHERE at>=?').all(cutoff);
      if (candidates.length !== 1) throw Error('Expected one active test scope; specify its stored hash explicitly.');
      scopeHash = candidates[0].scope;
    }
    if (previous?.scope?.databaseScopeHash && previous.scope.databaseScopeHash !== scopeHash) throw Error('Do not mix another relationship into the existing private receipt.');
    if (!db.prepare('SELECT 1 FROM scopes WHERE id=?').get(scopeHash)) throw Error('The selected relationship scope does not exist.');
    observedScopes = db.prepare('SELECT DISTINCT scope FROM messages WHERE at>=?').all(cutoff).map(row => row.scope);
    const read = (table, timestamp, secondary) => {
      // Table/column names come only from these static calls, never CLI input.
      const filter = secondary ? `(${timestamp}>=? OR ${secondary}>=?)` : `${timestamp}>=?`;
      const rows = db.prepare(`SELECT * FROM ${table} WHERE scope=? AND ${filter} ORDER BY ${timestamp},rowid LIMIT 501`).all(scopeHash, cutoff, ...(secondary ? [cutoff] : []));
      if (rows.length > 500) throw Error(`The ${table} evidence window exceeds 500 rows; narrow it in a new receipt.`);
      return rows;
    };
    const common = row => ({idHash: hash(row.id), text: redact(row.text), textSha256: hash(row.text)});
    const receipt = value => ({hasReceipt: !!value, receiptSha256: value ? hash(value) : null, receiptIsGenericAcceptance: value === 'accepted'});
    records = {
      messages: read('messages', 'at').map(row => ({...common(row), role: row.role, at: iso(row.at), replyActionHash: row.id.startsWith('out:') ? hash(row.id.slice(4)) : null})),
      actions: read('actions', 'at', 'updated_at').map(row => ({...common(row), kind: row.kind, state: row.state, at: iso(row.at), updatedAt: iso(row.updated_at), ...receipt(row.receipt)})),
      facts: read('facts', 'created_at', 'updated_at').map(row => ({...common(row), key: redact(row.fact_key), sourceIdHashes: ids(row.source_ids), sourceAt: iso(row.source_at), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), revision: row.revision})),
      followups: read('followups', 'created_at', 'updated_at').map(row => ({...common(row), state: row.state, dueAt: iso(row.due_at), expiresAt: iso(row.expires_at), timeZone: row.time_zone, sourceIdHashes: ids(row.source_ids), factIdHashes: ids(row.fact_ids), createdAt: iso(row.created_at), updatedAt: iso(row.updated_at), revision: row.revision, ...receipt(row.receipt)})),
      publicEntries: read('public_journal', 'at', 'updated_at').map(row => ({...common(row), state: row.state, at: iso(row.at), updatedAt: iso(row.updated_at), ...receipt(row.post_id)}))
    };
  } finally {
    try { db.exec('ROLLBACK'); } finally { db.close(); }
  }
  const capturedAt = new Date().toISOString();
  const recovery = readRecovery(cutoff, scopeHash, observedScopes, {recoveryPath, scopePath});
  const nonsecretConfig = readNonsecretConfig(dataRoot);
  const summary = Object.fromEntries(Object.entries(records).map(([key, rows]) => [key, {count: rows.length, states: stateCounts(rows)}]));
  const linkedReplies = records.messages.filter(row => row.role === 'assistant' && records.actions.some(action => action.idHash === row.replyActionHash && action.textSha256 === row.textSha256 && action.state === 'sent' && action.hasReceipt));
  summary.assistantRowsWithMatchingSentReceipt = linkedReplies.length;
  const manual = previous?.manual || {
    qqScreens: [],
    note: 'Root must record actual QQ screen observations here. This collector never infers them from SQLite or screenshot file existence.'
  };
  summary.recovery = recovery.summary;
  const observations = [...(previous?.observations || []), {capturedAt, summary, records, recovery, nonsecretConfig}].slice(-40);
  const output = {
    kind: 'private-live-companion-evidence', private: true, publishable: false,
    source: manual.qqScreens?.some(item => item.confirmed === true) ? 'real-qq-owner-ui+real-model+sqlite' : 'sqlite-read-only',
    provenance: {
      database: 'Actual running profile, opened through node:sqlite readOnly; no SocialStore recovery or mutation.',
      recovery: 'Actual profile recovery.inbound metadata read through a separate read-only transaction; no MessageJournal constructor or state recovery.',
      qqScreen: 'Only separately recorded root/manual observations verify visible QQ content; DB sent means interface acceptance.',
      model: 'Assistant content is stored by the live app; this collector does not inspect provider requests, model version, billing or authentication.',
      synthetic: false, collectorSendsMessages: false, collectorWritesRuntimeDatabase: false,
      credentialsRead: false, rawAccountIdsAndReceiptsExported: false
    },
    since: new Date(cutoff).toISOString(), capturedAt,
    scope: {label: profile.label, databaseScopeHash: scopeHash},
    databaseRelativePath: `${profile.relativeRoot}/social-memory.sqlite`,
    schemaTables: schema,
    tableMapping: {publicEntries: 'public_journal'},
    retention: 'At most 40 local observations. Earlier test text may remain in this private evidence after it is forgotten in app memory.',
    summary, records, recovery, nonsecretConfig, manual, observations,
    limits: [
      'This receipt covers only this scope and rows created or updated since the stated cutoff.',
      'No QQ-screen, human-audibility, microphone, multi-account or Qzone-audience success is inferred from database rows.',
      'A sent/published row does not establish account visibility; a reply does not prove task success.',
      'Recovery metadata has no scope column; its profile/time binding and scope guard are stated separately. Task UUIDs must remain private.',
      'This file may contain private test conversations and must not be committed, published or used as an unredacted public receipt.'
    ]
  };
  fs.mkdirSync(path.dirname(outputPath), {recursive: true});
  const tempPath = `${outputPath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(output, null, 2) + '\n');
  fs.renameSync(tempPath, outputPath);
  console.log(JSON.stringify({output: path.relative(root, outputPath), source: output.source, capturedAt, summary, qqScreenObservations: manual.qqScreens?.length || 0}));
}

try { main(); } catch (error) { console.error(redact(error.message)); process.exitCode = 1; }
