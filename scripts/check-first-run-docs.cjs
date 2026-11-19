'use strict';
// Deliberately scoped to the public first-run documents, not a Markdown validator.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const documents = [
  'README.md', 'README.zh-CN.md', 'docs/RELEASE.md',
  'docs/VALIDATION.md', 'docs/FIRST_RUN.md', 'docs/CANDIDATE_STATUS.md',
];
const allowedNew = new Set(['docs/FIRST_RUN.md']);
const commit = 'e7b58508ffc79a108dc95f20685288ae3ca078d6';
const expectedCommands = [
  'git clone --branch main --single-branch https://github.com/Ray0766/agent-arcade.git agent-arcade-companion',
  'cd agent-arcade-companion',
  `git checkout --detach ${commit}`,
  'git rev-parse HEAD', 'npm ci', 'npm start', '',
].join('\n');

const readText = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

function headingAnchors(text) {
  const used = new Map();
  return new Set([...text.matchAll(/^#{1,6}\s+(.*)$/gm)].map(([, heading]) => {
    const slug = heading.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').toLowerCase()
      .replace(/[\p{P}\p{S}]/gu, character => '-_'.includes(character) ? character : '')
      .replace(/ /g, '-');
    const count = used.get(slug) || 0;
    used.set(slug, count + 1);
    return count ? `${slug}-${count}` : slug;
  }));
}

function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--allow-new') || args.length > 1) {
    throw Error('Usage: node scripts/check-first-run-docs.cjs [--allow-new]');
  }
  const allowNew = args.includes('--allow-new');
  const tracked = new Set(execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0'));
  const errors = [], commandBlocks = [];
  let checkedLinks = 0, checkedAnchors = 0;
  const permitted = relative => tracked.has(relative) || allowNew && allowedNew.has(relative);
  for (const document of documents) {
    if (!permitted(document)) errors.push(`${document}: document is not Git-tracked`);
    const absolute = path.join(root, document);
    if (!fs.existsSync(absolute)) { errors.push(`${document}: document is missing`); continue; }
    const text = readText(absolute);
    const links = [
      ...[...text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map(match => match[1]),
      ...[...text.matchAll(/(?:href|src)="([^"]+)"/g)].map(match => match[1]),
    ];
    for (const link of links) {
      if (/^[a-zA-Z][\w+.-]*:/.test(link)) continue;
      const [name, anchor] = link.split('#', 2);
      const target = name ? path.resolve(path.dirname(absolute), decodeURIComponent(name)) : absolute;
      const relative = path.relative(root, target).split(path.sep).join('/');
      if (name) {
        checkedLinks++;
        if (relative === '..' || relative.startsWith('../') || path.isAbsolute(relative)) {
          errors.push(`${document}: link leaves repository: ${link}`); continue;
        }
        if (!fs.existsSync(target)) { errors.push(`${document}: missing target: ${link}`); continue; }
        if (!permitted(relative)) errors.push(`${document}: target is not Git-tracked: ${link}`);
      }
      if (anchor && fs.existsSync(target) && fs.statSync(target).isFile()) {
        checkedAnchors++;
        if (!headingAnchors(readText(target)).has(decodeURIComponent(anchor))) {
          errors.push(`${document}: missing local anchor: ${link}`);
        }
      }
    }
    if (['README.md', 'README.zh-CN.md', 'docs/RELEASE.md', 'docs/FIRST_RUN.md'].includes(document)) {
      const blocks = [...text.matchAll(/```sh\n([\s\S]*?)```/g)]
        .map(match => match[1]).filter(block => block.includes('git clone'));
      if (blocks.length !== 1) errors.push(`${document}: expected one exact-source command block`);
      commandBlocks.push(...blocks);
      if (blocks.some(block => block !== expectedCommands)) errors.push(`${document}: branch/full-commit source commands changed`);
    }
  }
  if (commandBlocks.length !== 4 || new Set(commandBlocks).size !== 1) errors.push('The four exact-source command sets must match.');
  const result = { checkedLinks, checkedAnchors, commandSets: commandBlocks.length };
  if (errors.length) {
    process.stderr.write(JSON.stringify({ ...result, errors }, null, 2) + '\n');
    process.exitCode = 1;
  } else process.stdout.write(JSON.stringify(result) + '\n');
}
try { main(); } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
