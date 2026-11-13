'use strict';

// Only a whole, directly typed control message may reach a command handler.
// Keep this predicate shared with the voice/quote gate and receipt journal.
function isControlText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.startsWith('/') || text === '状态' || text === '停止' || text === '恢复会话' || /^(同意|拒绝)(?:\s|$)/.test(text);
}
function normalizeControlText(value) {
  const text = value.trim();
  if (text === '状态') return '/status';
  if (text === '停止') return '/cancel';
  if (text === '恢复会话') return '/resume';
  if (/^同意(?:\s|$)/.test(text)) return text.replace(/^同意/, '/allow');
  if (/^拒绝(?:\s|$)/.test(text)) return text.replace(/^拒绝/, '/deny');
  return text.replace(/^\/[A-Za-z]+/, command => command.toLowerCase());
}
module.exports = {isControlText, normalizeControlText};
