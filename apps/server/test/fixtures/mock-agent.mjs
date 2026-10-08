import readline from 'node:readline';
const output=m=>process.stdout.write(JSON.stringify(m)+'\n');
let prompt;
readline.createInterface({input:process.stdin}).on('line',line=>{
  const m=JSON.parse(line);
  if(m.method==='initialize')output({jsonrpc:'2.0',id:m.id,result:{protocolVersion:1,agentCapabilities:{},agentInfo:{name:'fixture',version:'1'}}});
  else if(m.method==='session/new')output({jsonrpc:'2.0',id:m.id,result:{sessionId:'test'}});
  else if(m.method==='session/prompt'){
    prompt=m.id;
    output({jsonrpc:'2.0',id:100,method:'session/request_permission',params:{sessionId:'test',toolCall:{toolCallId:'tool1',title:'Fixture approval',status:'pending'},options:[{optionId:'allow',name:'Allow',kind:'allow_once'},{optionId:'reject',name:'Reject',kind:'reject_once'}]}});
  }else if(m.id===100){
    output({jsonrpc:'2.0',method:'session/update',params:{sessionId:'test',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:m.result.outcome.outcome==='selected'?'approved':'cancelled'}}}});
    output({jsonrpc:'2.0',id:prompt,result:{stopReason:'end_turn'}});
  }
});
