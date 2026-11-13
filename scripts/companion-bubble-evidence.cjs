'use strict';
// Private acceptance observer. Does not construct stores, run recovery, read
// credentials, call models, send messages, or write any runtime database.
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');

const root = path.resolve(__dirname, '..');
const profiles = {whale:'work/api-preview-home', ju:'work/qq-trio/claude/home', dragon:'work/qq-trio/codex/home'};
const hash = value => createHash('sha256').update(String(value)).digest('hex');
const iso = value => Number.isFinite(value) ? new Date(value).toISOString() : null;
const options = {};
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index], value = process.argv[index + 1];
  if (!['--profile','--since','--observe-ms'].includes(key) || !value || options[key]) throw Error('Usage: --profile whale|ju|dragon --since ISO_WITH_ZONE [--observe-ms 0..180000]');
  options[key] = value;
}
const profile = options['--profile'], cutoff = Date.parse(options['--since'] || '');
const duration = Number(options['--observe-ms'] || 0);
if (!Object.hasOwn(profiles, profile)) throw Error('Only the three fixed acceptance profiles are permitted.');
if (!Number.isFinite(cutoff) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(options['--since'] || '')) throw Error('A cutoff with time zone is required.');
if (!Number.isInteger(duration) || duration < 0 || duration > 180000) throw Error('Observation must be 0..180000 ms.');
const dataRoot = path.join(root, profiles[profile]), scopeFile = path.join(dataRoot, 'social-scope.json');
function scopeHash() {
  if (fs.statSync(scopeFile).size > 4096) throw Error('Unexpected scope metadata size.');
  const scope = JSON.parse(fs.readFileSync(scopeFile, 'utf8')).scope;
  if (typeof scope !== 'string' || !/^[a-f0-9]{64}$/.test(scope)) throw Error('A current relationship hash is required.');
  return hash(scope);
}
const expectedScope = scopeHash();
const social = new DatabaseSync(path.join(dataRoot, 'social-memory.sqlite'), {readOnly:true});
const recovery = new DatabaseSync(path.join(dataRoot, 'bot-recovery.sqlite'), {readOnly:true});
const startedAt = Date.now(), observations = [];
let last = '', finished = false, timer;
function capture() {
  if (scopeHash() !== expectedScope) throw Error('Relationship changed during observation.');
  // Separate read transactions: no cross-database atomicity claim.
  social.exec('BEGIN');
  try {
    if (!social.prepare('SELECT 1 FROM scopes WHERE id=?').get(expectedScope)) throw Error('Current relationship not found.');
    if (social.prepare('SELECT 1 FROM messages WHERE at>=? AND scope<>? LIMIT 1').get(cutoff, expectedScope)) throw Error('Another relationship appears in this window; narrow the cutoff.');
  } finally { social.exec('ROLLBACK'); }
  recovery.exec('BEGIN');
  let rows;
  try {
    if (!recovery.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='companion_delivery'").get()) throw Error('The running profile has no delivery diagnostics; use the corrected build first.');
    rows = recovery.prepare(`SELECT d.*, MIN(i.created_at) AS first_input, MAX(i.created_at) AS last_input,
      COUNT(*) AS input_count, GROUP_CONCAT(DISTINCT i.state) AS input_states
      FROM companion_delivery d JOIN inbound i ON i.task_id=d.task_id
      WHERE i.created_at>=? GROUP BY d.task_id ORDER BY d.created_at LIMIT 101`).all(cutoff);
    if (rows.length > 100) throw Error('More than 100 tasks in evidence window; narrow the cutoff.');
  } finally { recovery.exec('ROLLBACK'); }
  const tasks = rows.map(row => ({
    taskHash:hash(row.task_id), inboundCount:row.input_count,
    firstInputAt:iso(row.first_input), lastInputAt:iso(row.last_input), states:row.input_states.split(',').sort(),
    planned:row.planned, attempted:row.attempted, accepted:row.accepted, unknown:row.unknown,
    inFlight:row.in_flight, unattemptedAtCancel:row.cancel_unattempted, inFlightAtCancel:row.cancel_in_flight,
    countsCreatedAt:iso(row.created_at), countsUpdatedAt:iso(row.updated_at)
  }));
  const key = JSON.stringify(tasks);
  if (key !== last) { last = key; observations.push({capturedAt:new Date().toISOString(), tasks}); }
  if (observations.length > 2000) throw Error('Observation record bound reached.');
}
function finish(error) {
  if (finished) return;
  finished = true; clearInterval(timer);
  if (!error) { try { capture(); } catch (caught) { error = caught; } }
  social.close(); recovery.close();
  const output = {
    kind:'private-real-companion-bubble-observation', private:true, publishable:false,
    source:'actual-profile-sqlite-read-only', profile, since:new Date(cutoff).toISOString(),
    startedAt:new Date(startedAt).toISOString(), endedAt:new Date().toISOString(),
    complete:!error, error:error ? 'Observation stopped: ' + error.message : null,
    currentScopeChecked:true, separateReadTransactions:true, sampleIntervalMs:duration ? 100 : null,
    collectorSendsMessages:false, collectorWritesRuntimeDatabase:false, credentialsRead:false,
    bodyOrRawIdentityExported:false, qqScreenObservedByCollector:false, observations,
    limitations:[
      'Only companion tasks with model output have numeric delivery metadata. A missing row does not prove a task or send did not exist.',
      'An attempted send started before cancellation can be accepted afterwards; acceptance time is not a new-send time.',
      'In-flight recovery is unknown, not accepted or replayed. Snapshot counts do not measure network packets or provider cancellation.',
      'Root must separately match the real QQ inputs and displayed replies. This collector never turns a DB receipt into screen evidence.',
      'Unattempted-at-cancel counts establish a queued model output only for the recorded task; no retrospective count is invented for older tasks.'
    ]
  };
  const target = path.join(root, 'outputs', `companion-${profile}-bubble-delivery-${startedAt}.json`);
  fs.writeFileSync(target, JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({output:path.relative(root,target),complete:output.complete,snapshots:observations.length,latest:observations.at(-1)?.tasks || []}));
  if (error) process.exitCode = 1;
}
try {
  capture();
  if (!duration) finish();
  else {
    timer = setInterval(() => { try { capture(); } catch (error) { finish(error); } }, 100);
    setTimeout(() => finish(), duration).unref();
    console.log('Read-only bubble observation started; no messages or model calls.');
  }
} catch (error) { finish(error); }
