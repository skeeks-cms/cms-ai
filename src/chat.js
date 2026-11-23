(()=>{
const panel=document.querySelector(".sx-ai-panel");
if(!panel || panel.dataset.ready)return;
panel.dataset.ready="1";

const el=id=>document.getElementById("sx-ai-"+id);
// API v1 of SkeekS AI through the panel endpoint of this site.
const endpoint=(op,params={})=>{
 const url=new URL("/ai-panel/api",location.origin);
 url.searchParams.set("op",op);
 for(const [k,v] of Object.entries(params))if(v!==null && v!==undefined && v!=="")url.searchParams.set(k,v);
 return url;
};
async function call(op,body){
 const r=await fetch(endpoint(op),{method:"POST",headers:{"content-type":"application/json","X-CSRF-Token":yii.getCsrfToken()},body:JSON.stringify(body)});
 const data=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(data.error||data.message||"Запрос не выполнен.");
 return data;
}
let chatId=null,context="",pending=null,run=null,lastEventId=0,pollTimer=null,busy=false,current=null;
const active=r=>r && ["queued","running"].includes(r.status);
const folder=el("folder");
async function saveProjectFile(file, ownerChat){
 const response=await fetch("/ai-panel/project-save",{method:"POST",
  headers:{"Content-Type":"application/json","X-CSRF-Token":yii.getCsrfToken(),"X-Skeeks-AI-Chat":String(ownerChat)},
  body:JSON.stringify({files:[file]})});
 if(!response.ok){
  if(response.status===409)throw Error("Файл уже изменён. Откройте его актуальную версию.");
  if(response.status===403)throw Error("Нет права записи в проект.");
  throw Error("Не удалось сохранить файл в проект.");
 }
}
function actionButton(label,fn){
 const button=document.createElement("button");
 button.type="button";button.className="sx-button sx-button--secondary";button.textContent=label;button.onclick=fn;
 return button;
}
async function editFile(item,file){
 if(item.querySelector("textarea"))return;
 const response=await fetch("/ai-panel/project-download?path="+encodeURIComponent(file.path));
 if(!response.ok)throw Error("Не удалось прочитать файл.");
 const field=document.createElement("textarea");
 field.className="form-control";field.rows=8;field.setAttribute("aria-label",file.path);
 field.value=new TextDecoder("utf-8",{fatal:true}).decode(await response.arrayBuffer());
 const editor=document.createElement("div");
 editor.append(field,actionButton("Сохранить изменения",async()=>{
  try{await saveProjectFile({path:file.path,revision:file.revision,text:field.value},chatId);await refreshFolder();}
  catch(e){folder.querySelector("p").textContent=e.message;}
 }),actionButton("Отмена",()=>editor.remove()));
 item.append(editor);field.focus();
}
async function refreshFolder(){
 const list=folder.querySelector("ul");
 const status=folder.querySelector("p");
 const items=[];
 try{
  let offset=0;
  do{
   const response=await fetch("/ai-panel/project-files?offset="+offset);
   if(!response.ok)throw Error(response.status===403?"Нет доступа к файлам проекта.":"Не удалось открыть папку проекта.");
   const data=await response.json();
   for(const file of data.files){
    const item=document.createElement("li"), link=document.createElement("a");
    link.href="/ai-panel/project-download?path="+encodeURIComponent(file.path);
    link.textContent=file.path;link.download=file.path.split("/").pop();
    item.append(link);
    if(panel.dataset.projectWrite==="1" && /\.(html?|css|txt|md|js|json|svg)$/i.test(file.path)){
     item.append(" ",actionButton("Редактировать",()=>editFile(item,file).catch(e=>status.textContent=e.message)));
    }
    items.push(item);
   }
   offset=data.next_offset;
  }while(offset!==null);
  list.replaceChildren(...items);
  status.textContent=items.length?"":"В проекте пока нет файлов.";
 }catch(error){list.replaceChildren();status.textContent=error.message;}
}
folder.ontoggle=()=>{if(folder.open)refreshFolder();};
let sidebarVersion=0,searchTimer,updatingSidebar=false;
const closedGroups=new Set();
let sidebarSignature="";
function drawSidebar({chats,projects},query){
 const signature=JSON.stringify([chats,projects,chatId,query]);
 if(signature===sidebarSignature)return;
 sidebarSignature=signature;
 const names=new Map(projects.map(p=>[String(p.id),p.name]));
 const list=el("chats"),groups=new Map();
 list.replaceChildren();
 function group(key,title){
   if(groups.has(key))return groups.get(key);
   const details=document.createElement("details"),summary=document.createElement("summary");
   details.open=!!query || !closedGroups.has(key);
   summary.textContent=title;details.append(summary);list.append(details);
   details.ontoggle=()=>{if(!query && details.isConnected){if(details.open)closedGroups.delete(key);else closedGroups.add(key);}};
   groups.set(key,details);return details;
 }
 for(const c of [...chats].sort((a,b)=>Number(b.is_pinned)-Number(a.is_pinned))){
   const pinned=!!Number(c.is_pinned),key=pinned?"pinned":String(c.project_id || "none");
   const section=group(key,pinned?"Закреплённые":names.get(key)||"Без проекта");
   const row=document.createElement("div"),button=document.createElement("button"),pin=document.createElement("button");
   row.className="sx-ai-chat-row";
   button.type="button";button.dataset.chat=c.id;button.textContent=c.title;button.title=c.title;
   if(Number(c.id)===chatId)button.setAttribute("aria-current","true");
   pin.type="button";pin.className="sx-ai-pin";pin.dataset.pin=c.id;
   pin.setAttribute("aria-pressed",String(pinned));pin.title=(pinned?"Открепить":"Закрепить")+" чат «"+c.title+"»";
   pin.setAttribute("aria-label",pin.title);pin.textContent=pinned?"★":"☆";
   row.append(button,pin);section.append(row);
 }
 el("listStatus").textContent=chats.length?"":query?"Совпадений нет":"Чатов пока нет";
 const current=chats.find(c=>Number(c.id)===chatId);
 el("groupLabel").hidden=!current || !projects.length;
 el("group").replaceChildren(new Option("Без проекта",""),...projects.map(p=>new Option(p.name,p.id)));
 el("group").value=current?.project_id || "";
}
async function refreshSidebar(change){
 const version=++sidebarVersion,query=el("search").value.trim();
 try{
   const options=change?{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":yii.getCsrfToken()},body:JSON.stringify(change)}:{};
   const r=await fetch("/ai-panel/sidebar?q="+encodeURIComponent(query),options);
   if(!r.ok)throw Error("Не удалось обновить список чатов.");
   const data=await r.json();
   if(version===sidebarVersion)drawSidebar(data,query);
 }catch(error){if(version===sidebarVersion){sidebarSignature="";el("listStatus").textContent="Не удалось обновить список чатов.";}}
}
async function changeSidebar(change){
 if(updatingSidebar)return;
 updatingSidebar=true;
 try{await refreshSidebar(change);}finally{updatingSidebar=false;await refreshSidebar();}
}
el("search").oninput=()=>{
 ++sidebarVersion;clearTimeout(searchTimer);searchTimer=setTimeout(()=>refreshSidebar(),170);
};
el("group").onchange=()=>changeSidebar({id:chatId,project:Number(el("group").value)||null});
function appendLinks(target,value){
  let cursor=0;
  for(const match of value.matchAll(/\[([^\]\n]+)\]\(((?:https?:\/\/|\/(?!\/))[^\s"<>)]*)\)|(?<![\w/:])(?:\*\*)?((?:https?:\/\/|\/(?!\/))[\w%~?&=#./-]+)(?:\*\*)?/g)){
    const href=match[2] || match[3];
    let url;
    try{url=new URL(href,location.origin);}catch{continue;}
    if(url.origin!==location.origin)continue;
    target.append(document.createTextNode(value.slice(cursor,match.index)));
    const link=document.createElement("a");
    link.href=url.href;link.textContent=match[1] || href;link.target="_blank";link.rel="noopener";
    target.append(link);cursor=match.index+match[0].length;
  }
  target.append(document.createTextNode(value.slice(cursor)));
}
// Steps of the active run inside the conversation, like a desktop agent: the current
// step spins, finished steps get a check mark. Finished runs keep a collapsed list.
const stepTypes=new Set(["queued","started","thinking","tool","step","cancel"]);
const stepText={queued:"В очереди",started:"Начинаю работу"};
let live=null;
function liveList(){
 if(live && live.isConnected)return live;
 live=document.createElement("ol");live.className="sx-ai-steps sx-ai-steps--live";live.setAttribute("aria-label","Ход работы");
 el("messages").append(live);
 return live;
}
function renderActivity(events,reset){
 if(reset){live?.remove();live=null;}
 if(!active(run))return;
 const list=liveList();
 for(const e of events){
  if(!stepTypes.has(e.type))continue;
  const text=stepText[e.type]||e.text;
  const last=list.lastElementChild;
  if(last && last.textContent===text)continue;
  last?.classList.replace("is-running","is-done");
  const li=document.createElement("li");li.className="is-running";li.textContent=text;list.append(li);
 }
 if(!list.childElementCount){const li=document.createElement("li");li.className="is-running";li.textContent="В очереди";list.append(li);}
 const scroll=el("scroll");
 if(scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<120)scroll.scrollTop=scroll.scrollHeight;
}
function doneSteps(texts){
 const box=document.createElement("details");box.className="sx-ai-steps-done";
 const summary=document.createElement("summary");summary.textContent="Ход работы · шагов: "+texts.length;
 const list=document.createElement("ol");list.className="sx-ai-steps";
 for(const t of texts){const li=document.createElement("li");li.className="is-done";li.textContent=t;list.append(li);}
 box.append(summary,list);
 return box;
}
// The pending action in plain words; technical arguments stay under a toggle.
const actionVerbs=[[/_create$/,"Создать"],[/_update$/,"Изменить"],[/_send$/,"Отправить"],[/_transfer$/,"Передать"],[/_add$/,"Добавить"],[/_remove$/,"Убрать"],[/_action$/,"Выполнить действие"]];
const actionNouns=[["cms_ai_site_drafts","черновики страниц сайта"],["cms_ai_task","задачу"],["cms_ai_project_files","файлы проекта"],["page_css","оформление страницы"],
 ["cms_comm_chat_reply","ответ в чат"],["cms_comm_draft","черновик письма"],["cms_comm_campaign","рассылку"],["cms_content_element","публикацию"],
 ["cms_tree","раздел сайта"],["cms_task","задачу"],["cms_company","компанию"],["cms_lead","сделку"],["cms_deal","услугу"],["cms_project","проект"],["cms_proposal","предложение"]];
const argLabels={name:"Название",title:"Название",description:"Описание",cms_company_id:"Компания №",company_id:"Компания №",executor_id:"Исполнитель №",
 cms_project_id:"Проект №",cms_deal_id:"Услуга №",service_id:"Услуга №",cms_lead_id:"Сделка №",plan_start_at:"Начало",plan_end_at:"Срок",status:"Статус",
 text:"Текст",subject:"Тема",id:"Запись №",pid:"Родительский раздел №",parent_id:"Родительский раздел №",code:"Адрес",css:"CSS",
 description_short:"Краткое описание",description_full:"Полное описание",price:"Цена",active:"Активна"};
function describePending(p){
 const verb=actionVerbs.find(([re])=>re.test(p.tool))?.[1]||"Выполнить";
 const noun=actionNouns.find(([prefix])=>p.tool.startsWith(prefix))?.[1]||"действие в CRM";
 const rows=[];
 const add=(key,value)=>{
  if(key==="request_key" || value===null || value===undefined || value==="")return;
  if(typeof value==="object" && !Array.isArray(value)){for(const [k,v] of Object.entries(value))add(k,v);return;}
  const shown=Array.isArray(value)?value.map(v=>typeof v==="object"?JSON.stringify(v):String(v)).join(", "):String(value);
  rows.push([argLabels[key]||key,shown.length>300?shown.slice(0,300)+"…":shown]);
 };
 for(const [k,v] of Object.entries(p.args||{}))add(k,v);
 return {title:verb+" "+noun,rows};
}
const previewBox=document.getElementById("sx-ai-preview");
function renderPending(){
 const box=previewBox;box.hidden=!pending;
 if(!pending)return;
 const {title,rows}=describePending(pending);
 box.querySelector("strong").textContent=title;
 const list=document.createElement("dl");list.className="sx-ai-pending-fields";
 for(const [k,v] of rows){const dt=document.createElement("dt"),dd=document.createElement("dd");dt.textContent=k;dd.textContent=v;list.append(dt,dd);}
 const tech=document.createElement("details"),summary=document.createElement("summary"),pre=document.createElement("pre");
 summary.textContent="Технические подробности";pre.textContent=pending.tool+"\n"+JSON.stringify(pending.args,null,2);tech.append(summary,pre);
 box.querySelector(".sx-ai-pending-body").replaceChildren(list,tech);
 el("messages").append(box);
}
function renderRun(){
 const working=active(run);
 el("job").textContent=pending?"Требуется ваше подтверждение":working&&run.cancelRequested?"Останавливаю…":"";
 el("job").classList.toggle("sx-ai-working",working);
 el("stop").hidden=!working || run.cancelRequested;
 panel.querySelector(".sx-ai-composer form button[type=submit]").disabled=working;
}
// The answer appears progressively, keeping links and formatting.
function typeIn(node){
 if(document.hidden || matchMedia("(prefers-reduced-motion: reduce)").matches)return;
 const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT),parts=[];
 while(walker.nextNode())parts.push([walker.currentNode,walker.currentNode.textContent]);
 const total=parts.reduce((n,[,t])=>n+t.length,0);
 if(!total)return;
 for(const [n] of parts)n.textContent="";
 node.classList.add("is-typing");
 const step=Math.max(2,Math.ceil(total/90));let shown=0;
 const tick=()=>{
  shown=Math.min(total,shown+step);let left=shown;
  for(const [n,t] of parts){const k=Math.min(t.length,Math.max(0,left));n.textContent=t.slice(0,k);left-=t.length;}
  if(shown<total && !document.hidden)setTimeout(tick,16);
  else{for(const [n,t] of parts)n.textContent=t;node.classList.remove("is-typing");}
 };
 setTimeout(tick,16);
}
let seenAnswer=0;
function render(data){
 current=data;
 const picker=el("engine");
 const engines=data.engines || ["codex"];
 const previous=picker.value;
 picker.replaceChildren(...engines.map(id=>new Option(id==="codex"?"Codex":"Claude",id)));
 picker.value=engines.includes(previous)?previous:(data.engine||engines[0]||"");
 el("engineLabel").hidden=engines.length<2 || !!data.chatId;
 const scroll=el("scroll");
 const follow=chatId!==data.chatId || scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<80;
 if(chatId!==data.chatId)seenAnswer=0;
 const newAnswer=chatId===data.chatId && seenAnswer>0;
 chatId=data.chatId;
 el("title").textContent=data.chatId?data.title:"Новый чат";
 refreshSidebar();
 el("messages").replaceChildren();
 for(const entry of data.history){
  const item=document.createElement("article");item.className=entry.role;
  if(entry.role==="assistant"){
    let cursor=0;
    for(const m of entry.text.matchAll(/\*\*([^\n]+?)\*\*|`([^`\n]+)`/g)){
      appendLinks(item,entry.text.slice(cursor,m.index));
      const node=document.createElement(m[1]?"strong":"code");
      if(m[1])appendLinks(node,m[1]);else node.textContent=m[2];
      item.append(node);cursor=m.index+m[0].length;
    }
    appendLinks(item,entry.text.slice(cursor));
  }else appendLinks(item,entry.text);
  for(const f of (data.files||[]).filter(f=>String(f.message_id)===String(entry.id))){
    const link=document.createElement("a");
    link.href=endpoint("file",{chat:chatId,id:f.id});link.textContent=f.name;link.download=f.name;
    if(entry.role==="assistant" && /^preview-\d+-(phone|desktop)\.jpg$/.test(f.name)){
     const image=document.createElement("img");
     image.className="sx-ai-screenshot";image.src=link.href;image.loading="lazy";
     image.alt=f.name.endsWith("-phone.jpg")?"Предпросмотр на телефоне":"Предпросмотр на компьютере";
     link.replaceChildren(image,document.createTextNode(image.alt));
    }
    item.append(document.createElement("br"),link);
    if(panel.dataset.projectWrite==="1"){
     item.append(" ",actionButton("Сохранить в проект",async()=>{
      const path=window.prompt("Путь в общей папке проекта",f.name);
      if(!path)return;
      try{await saveProjectFile({path,attachment_id:Number(f.id)},data.chatId);folder.open=true;await refreshFolder();}
      catch(e){el("status").textContent=e.message;}
     }));
    }
  }
  el("messages").append(item);
  const steps=entry.role==="user" && data.steps?.[entry.id];
  if(steps && steps.length)el("messages").append(doneSteps(steps));
  if(entry.role==="assistant" && newAnswer && Number(entry.id)>seenAnswer)typeIn(item);
 }
 const answers=data.history.filter(e=>e.role==="assistant");
 seenAnswer=answers.length?Number(answers.at(-1).id):0;
 pending=data.pending;
 run=data.run;lastEventId=data.lastEventId||0;
 renderPending();
 renderActivity(data.events||[],true);
 renderRun();
 if(follow)scroll.scrollTop=scroll.scrollHeight;
 const engine=data.engine;
 const profile=!data.chatId?"":engine==="claude-vclaude"?"Claude через VClaude · результаты REST передаются провайдеру":engine==="claude-personal"?"Claude · личное подключение":"Codex";
 el("context").textContent=[data.company?"Компания №"+data.company:"",profile].filter(Boolean).join(" · ");
 if(active(run))poll();
}
async function open(params){
 stopPolling();
 const r=await fetch(endpoint("history",params));
 const data=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(data.error||"Не удалось открыть переписку.");
 render(data);
}
function stopPolling(){clearTimeout(pollTimer);pollTimer=null;}
function poll(){
 stopPolling();
 const expected=chatId;
 pollTimer=setTimeout(async()=>{
  if(!panel.open || chatId!==expected)return;
  try{
   const r=await fetch(endpoint("events",{chat:expected,after:lastEventId}));
   if(!r.ok)throw Error();
   const data=await r.json();
   if(chatId!==expected)return;
   const finished=active(run) && !active(data.run);
   run=data.run;
   if(data.events.length){lastEventId=data.events.at(-1).id;renderActivity(data.events.filter(e=>e.run===run?.id),false);}
   renderRun();
   if(finished){await open({chat:expected});return;}
   if(active(run))poll();
  }catch{el("job").textContent="Не удалось обновить ход работы. Повторяю…";pollTimer=setTimeout(poll,3000);}
 },1000);
}
async function action(fn){
 if(busy)return;
 busy=true;
 for(const b of panel.querySelectorAll("button,select"))b.disabled=true;
 try{await fn();el("status").textContent="";}
 catch(e){el("status").textContent=e.message;}
 finally{busy=false;for(const b of panel.querySelectorAll("button,select"))b.disabled=false;renderRun();}
}
async function sendMessage(message,uploads){
 const editor=panel.querySelector("[data-sx-rte-editor]");
 const bubble=document.createElement("article");bubble.className="user";
 bubble.textContent=message || "Прикреплённые файлы: "+uploads.length;
 el("messages").append(bubble);el("scroll").scrollTop=el("scroll").scrollHeight;
 const clientKey=crypto.randomUUID().replaceAll("-","");
 await action(async()=>{
  try{
   const result=await call("message",{chatId,engine:el("engine").value,company:context||null,clientKey,message,uploads});
   editor.replaceChildren();el("message").value="";panel.querySelector("[data-sx-attach-list]").replaceChildren();
   await open({chat:result.chatId});
  }catch(e){bubble.remove();throw e;}
 });
}
const toggle=el("toggleChats");
function showChats(open){
 panel.classList.toggle("sx-ai-show-chats",open);
 toggle.setAttribute("aria-expanded",String(open));
}
toggle.onclick=()=>showChats(!panel.classList.contains("sx-ai-show-chats"));
el("newChat").onclick=()=>{
 stopPolling();showChats(false);
 render({...current,chatId:null,title:"Новый чат",engine:el("engine").value,history:[],files:[],pending:null,run:null,events:[],lastEventId:0,company:context?Number(context):null});
 panel.querySelector("[data-sx-rte-editor]")?.focus();
};
el("chats").onclick=e=>{
 const pin=e.target.closest("button[data-pin]");
 if(pin){changeSidebar({id:Number(pin.dataset.pin),pin:pin.getAttribute("aria-pressed")!=="true"});return;}
 const button=e.target.closest("button[data-chat]");
 if(!button)return;
 if(Number(button.dataset.chat)===chatId)showChats(false);
 else action(async()=>{await open({chat:Number(button.dataset.chat)});showChats(false);});
};
panel.addEventListener("close",()=>showChats(false));
let revision;
el("project").ontoggle=async()=>{
 if(!el("project").open)return;
 try{
  const r=await fetch(endpoint("settings"));if(!r.ok)throw Error("Не удалось загрузить настройки.");
  const d=await r.json();revision=d.revision;
  el("rules").value=d.instructions;el("skills").value=d.skills;
  el("global").textContent=[d.globalRules,...d.globalSkills].join("\n");
  el("saveRules").hidden=!d.canEdit;el("rules").readOnly=el("skills").readOnly=!d.canEdit;
 }catch(e){el("settingsStatus").textContent=e.message;}
};
el("saveRules").onclick=async()=>{
 try{
  const r=await fetch(endpoint("settings"),{method:"POST",headers:{"content-type":"application/json","X-CSRF-Token":yii.getCsrfToken()},body:JSON.stringify({revision,instructions:el("rules").value,skills:el("skills").value})});
  const d=await r.json();if(!r.ok)throw Error(d.error||"Ошибка сохранения.");
  revision=d.revision;el("settingsStatus").textContent="Настройки сохранены.";
 }catch(e){el("settingsStatus").textContent=e.message;}
};
panel.querySelector("form").onsubmit=async e=>{
 e.preventDefault();
 if (window.sx?.Attachments?.isBusy(e.target)) {el("status").textContent="Дождитесь загрузки файлов.";return;}
 const uploads=Array.from(e.target.querySelectorAll('input[name="uploads[]"]'), input=>input.value);
 if (uploads.length>4) {el("status").textContent="Можно приложить до четырёх файлов.";return;}
 const message=panel.querySelector("[data-sx-rte-editor]").innerText.trim();
 if (message.length>1800){el("status").textContent="Максимальная длина сообщения — 1800 символов.";return;}
 if (uploads.length || message) await sendMessage(message,uploads);
};
el("confirm").onclick=()=>action(async()=>{run=await call("confirm",{chatId,id:pending.id});await open({chat:chatId});});
el("reject").onclick=()=>action(async()=>{await call("reject",{chatId,id:pending.id});await open({chat:chatId});});
el("stop").onclick=()=>action(async()=>{
 run=await call("cancel",{chatId,runId:run.id});
 if(active(run)){renderRun();poll();}else await open({chat:chatId});
});
document.addEventListener("click",event=>{
 const trigger=event.target.closest("[data-sx-ai-open]");
 if(!trigger)return;
 const company=trigger.dataset.sxAiCompany || document.querySelector("[data-sx-ai-company]")?.dataset.sxAiCompany || "";
 if(!panel.open)panel.showModal();
 if(company===context && current){
   if(chatId)open({chat:chatId}).catch(e=>el("status").textContent=e.message);
   return;
 }
 context=company;
 el("status").textContent="Открываю переписку…";
 open({company}).then(()=>el("status").textContent="").catch(e=>el("status").textContent=e.message);
});
panel.addEventListener("close",stopPolling);
panel.querySelector("[data-sx-ai-close]").onclick=()=>panel.close();
})();
