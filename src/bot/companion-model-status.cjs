'use strict';

const nextSteps = {
  rate_limited:'服务商返回 429。请查看额度、账单或限流状态，恢复后发送新消息。',
  billing:'请检查服务商账户余额和账单，恢复后发送新消息。',
  credentials:'请在「AI 与渠道」检查保存的密钥和模型访问权限，修正后发送新消息。',
  invalid_response:'服务商返回空白或无效结果。请检查所选模型是否可用，再发送新消息。',
  unavailable:'请检查所选模型、服务状态和网络，恢复后发送新消息。',
};

function modelFailure(result) {
  switch (result?.httpStatus) {
    case 429: return 'rate_limited';
    case 402: return 'billing';
    case 401: case 403: case 404: return 'credentials';
    default: return result?.outcome === 'reply_ended' ? 'invalid_response' : 'unavailable';
  }
}

class CompanionModelError extends Error {
  constructor(code) {
    super('The model did not return a reply.');
    this.code = Object.hasOwn(nextSteps, code) ? code : 'unavailable';
  }
}

function groupModelProblem(groupId, issues) {
  const details = issues.map(({phase, code}) => {
    const label = phase === 'gate' ? '群聊接话判断未完成。' : '群聊正式回复未完成。';
    return label + nextSteps[code];
  });
  return `QQ群 ${groupId} · ${details.join(' ')}`;
}

module.exports = {CompanionModelError, modelFailure, groupModelProblem};
