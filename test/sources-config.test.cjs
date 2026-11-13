'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {validateSources, loadSources, saveSources, displayTarget} = require('../src/sources/config.cjs');

const DIR = path.join(os.tmpdir(), 'arcade-watch');
const common = {name:'My source', enabled:true, notify:'desktop'};
const feed = (id = 'news', extra = {}) => ({id, kind:'feed', ...common, url:'https://news.example/feed.xml', mode:'feed', ...extra});
const folder = (id = 'inbox', extra = {}) => ({id, kind:'folder', ...common, dir:DIR, ...extra});
const ics = (id = 'cal', extra = {}) => ({id, kind:'ics', ...common, file:path.join(DIR, 'a.ics'), leadMinutes:30, timeZone:'Asia/Shanghai', ...extra});
const wrap = sources => ({version:1, sources});

test('a valid list is normalized and returned as an array', () => {
  const sources = validateSources(wrap([feed('news', {name:'  News  ', intervalMs:600000}), folder(), ics(), ics('cal2', {file:undefined, url:'https://cal.example/a.ics'})].map(x => JSON.parse(JSON.stringify(x)))));
  assert.equal(sources.length, 4);
  assert.equal(sources[0].name, 'News');
  assert.deepEqual(Object.keys(sources[1]), ['id', 'kind', 'name', 'enabled', 'notify', 'dir']);
  assert.deepEqual(validateSources(sources), sources);
  assert.deepEqual(validateSources(wrap([])), []);
  assert.deepEqual(sources.map(displayTarget), ['https://news.example/feed.xml', DIR, 'a.ics', 'https://cal.example/a.ics']);
});

test('unknown keys, bad values and unsafe targets are rejected with a clear message', () => {
  const cases = [
    [{version:1, sources:[], extra:true}, /unknown settings/],
    [{version:2, sources:[]}, /version/],
    [{version:1, sources:{}}, /array/],
    [null, /unknown settings/],
    [wrap([feed('news', {color:'red'})]), /unknown setting "color"/],
    [wrap([feed('news', {dir:DIR})]), /unknown setting "dir"/],
    [wrap([feed('news', {url:'http://news.example/feed.xml'})]), /https/],
    [wrap([feed('news', {url:'https://u:p@news.example/'})]), /user name or password/],
    [wrap([feed('news', {mode:'scrape'})]), /mode/],
    [wrap([feed('news', {intervalMs:1000})]), /interval/],
    [wrap([feed('news', {intervalMs:'600000'})]), /interval/],
    [wrap([folder('inbox', {dir:'relative/dir'})]), /absolute path/],
    [wrap([ics('cal', {file:'calendar.ics'})]), /absolute path/],
    [wrap([ics('cal', {url:'https://cal.example/a.ics'})]), /exactly one/],
    [wrap([ics('cal', {timeZone:'Nowhere/City'})]), /time zone/],
    [wrap([feed('bad id')]), /id must be/],
    [wrap([feed('news', {kind:'mail'})]), /kind must be/],
    [wrap([feed('news', {name:'x'.repeat(61)})]), /name/],
    [wrap([feed('news', {enabled:'yes'})]), /enabled/],
    [wrap([feed('news', {notify:'sms'})]), /notify/],
    [wrap([feed('news', {url:{href:'https://news.example/'}})]), /invalid "url"/],
    [wrap([feed('same'), folder('same')]), /duplicate id "same"/],
    [wrap(Array.from({length:21}, (_, i) => feed(`n${i}`))), /At most 20/],
  ];
  for (const [value, pattern] of cases) assert.throws(() => validateSources(value), {code:'sources_invalid', message:pattern}, String(pattern));
  assert.equal(validateSources(wrap(Array.from({length:20}, (_, i) => feed(`n${i}`)))).length, 20);
});

test('save and load round-trip; missing and damaged files yield an empty list', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-sources-config-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const file = path.join(dir, 'nested', 'sources.json');
  assert.deepEqual(loadSources(file), {sources:[]});
  const saved = saveSources(file, wrap([feed(), folder()]));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), {version:1, sources:saved});
  assert.deepEqual(loadSources(file), {sources:saved});
  assert.throws(() => saveSources(file, wrap([feed('news', {url:'http://x.example/'})])), {code:'sources_invalid'});
  assert.deepEqual(loadSources(file), {sources:saved});
  fs.writeFileSync(file, '{not json');
  let loaded = loadSources(file);
  assert.deepEqual(loaded.sources, []);
  assert.match(loaded.problem, /not valid JSON/);
  fs.writeFileSync(file, JSON.stringify(wrap([feed('news', {script:'rm -rf'})])));
  loaded = loadSources(file);
  assert.deepEqual(loaded.sources, []);
  assert.match(loaded.problem, /unknown setting "script"/);
  loaded = loadSources(dir);
  assert.deepEqual(loaded.sources, []);
  assert.equal(typeof loaded.problem, 'string');
});
