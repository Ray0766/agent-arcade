'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),yaml=require('js-yaml');
const {violations,check}=require('../scripts/check-release-workflows.cjs');
test('main/PR verification still builds artifacts without public release permission or steps',()=>{const result=check();assert.equal(result.problems.length,0);const doc=yaml.load(fs.readFileSync(path.resolve(__dirname,'../.github/workflows/ci.yml'),'utf8'));assert(doc.on.push.branches.includes('main'));assert(Object.hasOwn(doc.on,'pull_request'));assert(Object.values(doc.jobs).some(job=>job.steps.some(step=>/^actions\/upload-artifact@/.test(step.uses||''))));});
test('the former main-push prerelease is rejected, so the historical risk cannot silently return', () => {
  // Keep the publishing job from 3edf1ce locally: CI checkouts and source archives may lack that history.
  const before = fs.readFileSync(path.join(__dirname, 'fixtures/main-push-prerelease.yml'), 'utf8');
  const problems = violations(yaml.load(before));
  assert(problems.some(p => p.includes('release-write')));
  assert(problems.some(p => p.includes('release command')));
});
test('a renamed manual job cannot hide an added publishing action or elevated token',()=>{const doc={permissions:{contents:'read'},jobs:{anything:{permissions:'write-all',steps:[{uses:'softprops/action-gh-release@v2'}]}}};assert.equal(violations(doc).length,2);});
