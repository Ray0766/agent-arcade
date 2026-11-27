'use strict';

const {createHash}=require('node:crypto');
const {fail,string}=require('./store.cjs');
const taskTextLimit=4000;
const maxTextBytes=4*taskTextLimit+3;

function materialTaskPreview(store,account,chat,body,role){
  if(body.expectedAccount!==account)fail(409,'message_session','账号已切换，请重新打开会话');
  const target=store.writableChat(account,chat);
  if(target.membershipRevision!==body.membershipRevision)
    fail(409,'message_session','角色会话已变化，请重新选择');
  const consent=store.directAiConsent(account,chat);
  if(consent&&(!consent.enabled||consent.ai!==role.number||consent.revision!==body.aiConsentRevision))
    fail(409,'ai_consent_changed','云聊天设置已变化，请重新确认');
  const source=body.taskSource;
  const background=store.checkGroupTaskSource(account,source);
  const group=store.group(account,source.chatId);
  const file=store.groupTaskMaterialFile(source.chatId,source.fileMessageId,group.since);
  if(file.size>maxTextBytes)fail(400,'group_task_file_size','请选择能完整放入交办的小文本文件');
  const bytes=store.messageFile(account,source.chatId,source.fileMessageId).bytes;
  let contents;
  try{contents=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
  catch{fail(400,'group_task_file_encoding','请选择能够完整读取的 UTF-8 文本文件');}
  if(!contents.trim()||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/u.test(contents))
    fail(400,'group_task_file_encoding','请选择能够完整读取的 UTF-8 文本文件');
  const requirement=string(body.requirement,taskTextLimit,'交办要求');
  if(!requirement.isWellFormed()||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/u.test(requirement))
    fail(400,'invalid_text','交办要求含有不可读取的字符');
  const text=string('给你一个任务：'+requirement+'\n\n群消息背景\n'+background.text+
    '\n\n所选文件正文\n'+contents+'\n\n请按上述要求处理。',taskTextLimit,'交办全文');
  const linkRevision=store.one('SELECT revision FROM bothouse_links WHERE account=?',account)?.revision;
  const roleRevision=store.one('SELECT revision FROM conversation_membership_revisions WHERE chat=? AND account=?',chat,role.number)?.revision;
  const review=createHash('sha256').update(JSON.stringify([
    account,chat,target.membershipRevision,role.number,body.taskRole,role.id,roleRevision,linkRevision,consent?.revision,
    source.chatId,source.messageId,background.sender.number,source.fileMessageId,file.sender,file.name,
    source.membershipRevision,file.digest,text
  ])).digest('hex');
  return {text,review,background:{id:background.id,author:background.sender.displayName},
    file:{id:source.fileMessageId,name:file.name,author:store.profile(file.sender).displayName},
    recipient:{number:body.taskRole,displayName:role.displayName}};
}

function confirmedMaterialTask(store,account,chat,body,role){
  const preview=materialTaskPreview(store,account,chat,body,role);
  if(body.materialReview!==preview.review)fail(409,'group_task_material_changed','交办材料或角色已变化，请重新核对');
  const prior=store.one(`SELECT review.review FROM messages m
    LEFT JOIN bothouse_work_order_material_reviews review ON review.prompt=m.id
    WHERE m.chat=? AND m.sender=? AND m.nonce=?`,chat,account,body.clientId??null);
  if(prior&&prior.review!==preview.review)fail(409,'message_conflict','此编号已用于另一项交办');
  return preview.text;
}

module.exports={materialTaskPreview,confirmedMaterialTask};
