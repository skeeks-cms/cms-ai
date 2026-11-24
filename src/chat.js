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
let sidebarVersion=0,searchTimer,updatingSidebar=false,sidebarTimer;
const closedGroups=new Set();
let sidebarSignature="";
function drawSidebar({chats,projects},query){
 sidebarProjects=projects;
 const signature=JSON.stringify([chats,projects,chatId,query]);
 if(signature===sidebarSignature)return;
 sidebarSignature=signature;
 closeMenu();
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
   const row=document.createElement("div"),button=document.createElement("button"),more=document.createElement("button");
   row.className="sx-ai-chat-row";row.dataset.row=c.id;
   button.type="button";button.dataset.chat=c.id;button.title=c.title;
   const label=document.createElement("span");label.className="sx-ai-chat-title";label.textContent=c.title;button.append(label);
   let mark=null;
   if(c.working || c.waiting){
    // As in the desktop app: the state sits at the right end of the row, "⋯" replaces it on hover.
    mark=document.createElement("span");
    mark.className=c.working?"sx-ai-chat-state is-working":"sx-ai-chat-state is-waiting";
    mark.title=c.working?"Выполняется поручение":"Ждёт подтверждения";mark.setAttribute("role","img");mark.setAttribute("aria-label",mark.title);
    row.classList.add("has-state");
   }
   if(Number(c.id)===chatId)button.setAttribute("aria-current","true");
   more.type="button";more.className="sx-ai-more";more.dataset.more=c.id;
   more.setAttribute("aria-haspopup","menu");more.setAttribute("aria-expanded","false");
   more.setAttribute("aria-label","Действия с чатом «"+c.title+"»");more.textContent="⋯";
   row.append(button,...(mark?[mark]:[]),more);section.append(row);
   chatInfo.set(Number(c.id),{title:c.title,pinned,project:c.project_id?Number(c.project_id):null});
 }
 el("listStatus").textContent=chats.length?"":query?"Совпадений нет":"Чатов пока нет";
 const current=chats.find(c=>Number(c.id)===chatId);
 el("groupLabel").hidden=!current || !projects.length;
 el("groupNote").textContent=!chatId?"Проект выбирается после первого сообщения.":!projects.length?"Нет доступных проектов CRM.":"";
 el("group").replaceChildren(new Option("Без проекта",""),...projects.map(p=>new Option(p.name,p.id)));
 el("group").value=current?.project_id || "";
}
// Menu of a chat row: pin, rename, move to a CRM project, delete with an in-panel confirmation.
let menu=null,sidebarProjects=[];
const chatInfo=new Map();
function closeMenu(){
 if(!menu)return;
 menu.owner?.setAttribute("aria-expanded","false");
 menu.remove();menu=null;
}
function menuItem(label,fn,danger){
 const b=document.createElement("button");b.type="button";b.setAttribute("role","menuitem");b.textContent=label;
 if(danger)b.className="is-danger";
 b.onclick=e=>{e.stopPropagation();fn();};
 return b;
}
function openMenu(id,owner){
 closeMenu();
 const info=chatInfo.get(id);if(!info)return;
 menu=document.createElement("div");menu.className="sx-ai-menu";menu.setAttribute("role","menu");menu.owner=owner;
 owner.setAttribute("aria-expanded","true");
 const fill=(...items)=>{menu.replaceChildren(...items);menu.querySelector("button,select")?.focus();};
 const main=()=>fill(
  menuItem(info.pinned?"Открепить":"Закрепить",()=>{closeMenu();changeSidebar({id,pin:!info.pinned});}),
  menuItem("Переименовать",()=>{closeMenu();startRename(id);}),
  ...(sidebarProjects.length?[menuItem("Перенести в проект",moveTo)]:[]),
  menuItem("Удалить",confirmDelete,true));
 const moveTo=()=>{
  const select=document.createElement("select");select.className="form-control";select.setAttribute("aria-label","Проект CRM");
  select.append(new Option("Без проекта",""),...sidebarProjects.map(p=>new Option(p.name,p.id)));
  select.value=info.project||"";
  select.onchange=()=>{closeMenu();changeSidebar({id,project:Number(select.value)||null});};
  select.onclick=e=>e.stopPropagation();
  fill(select,menuItem("Назад",main));
 };
 const confirmDelete=()=>{
  const text=document.createElement("p");text.textContent="Удалить чат и всю переписку навсегда? Вернуть его будет нельзя.";
  const status=document.createElement("p");status.className="sx-ai-menu-error";
  fill(text,menuItem("Удалить навсегда",async()=>{
   try{
    await call("delete",{chatId:id});
    closeMenu();
    if(id===chatId)el("newChat").click();
    sidebarSignature="";await refreshSidebar();
   }catch(e){status.textContent=e.message;menu?.append(status);}
  },true),menuItem("Отмена",main));
 };
 owner.closest(".sx-ai-chat-row").append(menu);
 main();
}
function startRename(id){
 const row=el("chats").querySelector('[data-row="'+id+'"]');if(!row)return;
 const info=chatInfo.get(id);
 const input=document.createElement("input");input.className="form-control sx-ai-rename";input.maxLength=120;input.value=info.title;
 input.setAttribute("aria-label","Название чата");
 row.replaceChildren(input);input.focus();input.select();
 let done=false;
 const finish=async save=>{
  if(done)return;done=true;
  const title=input.value.trim();
  if(save && title && title!==info.title){
   try{await call("rename",{chatId:id,title});if(id===chatId)el("title").textContent=title;}
   catch(e){el("listStatus").textContent=e.message;}
  }
  sidebarSignature="";refreshSidebar();
 };
 input.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();finish(true);}if(e.key==="Escape"){e.preventDefault();e.stopPropagation();finish(false);}};
 input.onblur=()=>finish(true);
}
async function refreshSidebar(change){
 const version=++sidebarVersion,query=el("search").value.trim();
 try{
   const options=change?{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":yii.getCsrfToken()},body:JSON.stringify(change)}:{};
   const r=await fetch("/ai-panel/sidebar?q="+encodeURIComponent(query),options);
   if(!r.ok)throw Error("Не удалось обновить список чатов.");
   const data=await r.json();
   if(version===sidebarVersion)drawSidebar(data,query);
   // While any chat works, refresh the list so background chats show their state.
   clearTimeout(sidebarTimer);
   if(panel.open && data.chats.some(c=>c.working))sidebarTimer=setTimeout(()=>refreshSidebar(),3000);
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
const stepTypes=new Set(["queued","started","thinking","tool","step","cancel","steer"]);
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
// Numbers for people: 18,2 тыс. токенов, 42 с, ~$0,03.
const fmt={
 tokens:n=>n>=1e6?(n/1e6).toLocaleString("ru-RU",{maximumFractionDigits:1})+" млн":n>=1e3?(n/1e3).toLocaleString("ru-RU",{maximumFractionDigits:1})+" тыс.":String(n),
 seconds:s=>s>=3600?Math.floor(s/3600)+" ч "+Math.round(s%3600/60)+" мин":s>=60?Math.floor(s/60)+" мин "+(s%60)+" с":s+" с",
 usd:v=>v===null||v===undefined?"":"~$"+Number(v).toLocaleString("ru-RU",{minimumFractionDigits:2,maximumFractionDigits:v<1?4:2}),
};
function doneSteps(texts,stat){
 const box=document.createElement("details");box.className="sx-ai-steps-done";
 const summary=document.createElement("summary");
 summary.textContent=["Ход работы · шагов: "+texts.length,...(stat?[stat.seconds?fmt.seconds(stat.seconds):"",stat.tokens?fmt.tokens(stat.tokens)+" токенов":"",fmt.usd(stat.cost)]:[])].filter(Boolean).join(" · ");
 if(stat?.model)summary.title="Модель: "+stat.model;
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
 const step=live?.lastElementChild?.textContent;
 el("job").textContent=pending?"Требуется ваше подтверждение":working?(run.cancelRequested?"Останавливаю…":step||"Работаю…"):"";
 el("job").classList.toggle("sx-ai-working",working);
 el("send").hidden=working;
 el("stop").hidden=!working;
 el("stop").disabled=!!run?.cancelRequested;
 const editor=panel.querySelector("[data-sx-rte-editor]");
 if(editor)editor.dataset.placeholder=working?"Следующее сообщение встанет в очередь…":"Напишите сообщение…";
 renderQueue();
}
// One queued message, as in the desktop app: it is sent when the current run ends.
let queued=null;
function renderQueue(){
 el("queue").hidden=!queued;
 el("queueSend").hidden=!queued || !!queued.uploads.length || !active(run) || !!run?.cancelRequested;
 el("queueText").textContent=queued?(queued.message||"Прикреплённые файлы: "+queued.uploads.length):"";
}
function flushQueue(){
 if(!queued || active(run) || pending || busy)return;
 const next=queued;queued=null;renderQueue();
 sendMessage(next.message,next.uploads);
}
// Send the queued message into the working run: the agent takes it into account at its next step.
el("queueSend").onclick=()=>{
 if(!queued || !active(run))return;
 const next=queued;
 action(async()=>{
  try{await call("steer",{chatId,runId:run.id,message:next.message});queued=null;renderQueue();await open({chat:chatId});}
  catch(e){renderQueue();throw e;}
 });
};
el("queueCancel").onclick=()=>{
 if(!queued)return;
 const editor=panel.querySelector("[data-sx-rte-editor]");
 if(!editor.innerText.trim())editor.textContent=queued.message;
 queued=null;renderQueue();editor.focus();
};
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
 const engineNames={"codex":"Codex","claude-vclaude":"Claude · VClaude","claude-personal":"Claude"};
 el("engineName").hidden=!data.chatId;
 el("engineName").textContent=engineNames[data.engine]||data.engine||"";
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
  if(steps && steps.length)el("messages").append(doneSteps(steps,data.runStats?.[entry.id]));
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
   if(finished){await open({chat:expected});flushQueue();refreshUsage();return;}
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
 const more=e.target.closest("button[data-more]");
 if(more){e.stopPropagation();if(menu && menu.owner===more)closeMenu();else openMenu(Number(more.dataset.more),more);return;}
 if(e.target.closest(".sx-ai-menu,.sx-ai-rename"))return;
 const button=e.target.closest("button[data-chat]");
 if(!button)return;
 if(Number(button.dataset.chat)===chatId)showChats(false);
 else action(async()=>{await open({chat:Number(button.dataset.chat)});showChats(false);});
};
panel.addEventListener("close",()=>{showChats(false);closeMenu();});
panel.addEventListener("click",e=>{if(menu && !e.target.closest(".sx-ai-menu"))closeMenu();});
panel.addEventListener("keydown",e=>{if(e.key==="Escape" && menu){e.preventDefault();const owner=menu.owner;closeMenu();owner?.focus();}});
// Search opens as a field under its row, like the desktop app.
el("searchToggle").onclick=()=>{
 const field=el("search"),open=field.hidden;
 field.hidden=!open;el("searchToggle").setAttribute("aria-expanded",String(open));
 if(open)field.focus();else if(field.value){field.value="";refreshSidebar();}
};
el("search").onkeydown=e=>{if(e.key==="Escape" && el("search").value){e.preventDefault();e.stopPropagation();el("search").value="";refreshSidebar();}};
// Side panel of the chat: project, files, memory; remembered per browser.
const wide=matchMedia("(min-width: 1100px)");
function showSide(open,remember){
 panel.classList.toggle("sx-ai-side-open",open);
 el("toggleSide").setAttribute("aria-expanded",String(open));
 if(remember)try{localStorage.setItem("sx-ai-side",open?"1":"0");}catch{}
}
let sidePref=null;try{sidePref=localStorage.getItem("sx-ai-side");}catch{}
showSide(sidePref===null?wide.matches:sidePref==="1" && wide.matches,false);
wide.addEventListener("change",e=>{if(!e.matches)showSide(false,false);});
el("toggleSide").onclick=()=>showSide(!panel.classList.contains("sx-ai-side-open"),wide.matches);
// Return focus only after a keyboard close: a programmatic focus after typing would draw a stray ring.
el("closeSide").onclick=e=>{showSide(false,wide.matches);if(e.detail===0)el("toggleSide").focus();else panel.querySelector("[data-sx-rte-editor]")?.focus({preventScroll:true});};
// Side panel "Расход": tokens of this chat, mine for the month and, for administrators, the account.
const usageBox=el("usage");
function usageTable(title,rows,label){
 if(!rows || !rows.length)return null;
 const wrap=document.createElement("div");wrap.className="sx-ai-usage-group";
 const h=document.createElement("strong");h.textContent=title;wrap.append(h);
 const table=document.createElement("table");table.className="sx-ai-usage-table";
 for(const r of rows){
  const tr=document.createElement("tr"),name=document.createElement("td"),val=document.createElement("td");
  name.textContent=label(r);name.title=name.textContent;
  val.textContent=fmt.tokens(r.input+r.output)+(r.cost!==null && r.cost!==undefined?" · "+fmt.usd(r.cost):"");
  tr.append(name,val);table.append(tr);
 }
 wrap.append(table);return wrap;
}
function usageTotal(title,t){
 if(!t)return null;
 const wrap=document.createElement("div");wrap.className="sx-ai-usage-total";
 const h=document.createElement("strong");h.textContent=title;
 const p=document.createElement("p");
 p.textContent=t.runs?[ "Поручений: "+t.runs, "вход "+fmt.tokens(t.input)+(t.cached?" (из кеша "+fmt.tokens(t.cached)+")":""), "выход "+fmt.tokens(t.output),
  t.seconds?fmt.seconds(t.seconds):"", t.cost!==null?fmt.usd(t.cost)+(t.unpriced?" без учёта "+t.unpriced+" без цены":""):"цена не указана"].filter(Boolean).join(" · "):"Пока нет поручений.";
 wrap.append(h,p);return wrap;
}
async function refreshUsage(){
 if(!usageBox.open)return;
 const body=usageBox.querySelector(".sx-ai-usage-body");
 try{
  const r=await fetch(endpoint("usage",{chat:chatId}));const d=await r.json();
  if(!r.ok)throw Error(d.error||"Не удалось загрузить расход.");
  const note=document.createElement("p");note.className="sx-ai-note";
  note.textContent="Токены — по данным движков. Сумма в долларах — ориентир по официальным ценам API, не счёт.";
  body.replaceChildren(...[
   chatId?usageTotal("Этот чат",d.chat):null,
   usageTotal("Мои поручения за "+d.month,d.mine),
   usageTable("По моделям",d.mineByModel,r=>r.title),
   usageTable("По проектам",d.mineByProject,r=>r.project||"Без проекта"),
   usageTable("По чатам",d.mineByChat,r=>r.title),
   d.account?usageTotal("Весь аккаунт за "+d.month,d.account):null,
   d.account?usageTable("По сотрудникам",d.accountByUser,r=>r.user):null,
   note].filter(Boolean));
 }catch(e){body.replaceChildren(Object.assign(document.createElement("p"),{className:"sx-ai-note",textContent:e.message}));}
}
usageBox.ontoggle=refreshUsage;
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
 if (!uploads.length && !message)return;
 if (active(run) || pending){
  if(queued){el("status").textContent="В очереди уже есть сообщение. Уберите его или дождитесь ответа.";return;}
  queued={message,uploads};
  panel.querySelector("[data-sx-rte-editor]").replaceChildren();el("message").value="";panel.querySelector("[data-sx-attach-list]").replaceChildren();
  renderQueue();return;
 }
 await sendMessage(message,uploads);
};
// Enter sends, Shift+Enter breaks the line.
panel.querySelector("[data-sx-rte-editor]").addEventListener("keydown",e=>{
 if(e.key!=="Enter" || e.shiftKey || e.isComposing)return;
 e.preventDefault();e.stopPropagation();
 panel.querySelector(".sx-ai-box").requestSubmit();
},true);
// Voice input through the browser's speech recognition (Chrome sends the audio to its own service).
const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
if(Recognition){
 const mic=el("mic");mic.hidden=false;
 let recognizer=null;
 mic.onclick=()=>{
  if(recognizer){recognizer.stop();return;}
  const editor=panel.querySelector("[data-sx-rte-editor]");
  const base=editor.innerText.trim();
  recognizer=new Recognition();recognizer.lang="ru-RU";recognizer.interimResults=true;recognizer.continuous=true;
  recognizer.onresult=e=>{
   let text="";for(const r of e.results)text+=r[0].transcript;
   editor.textContent=(base?base+" ":"")+text.trim();
  };
  recognizer.onerror=e=>{el("status").textContent=e.error==="not-allowed"?"Нет доступа к микрофону.":"Голосовой ввод недоступен.";};
  recognizer.onend=()=>{recognizer=null;mic.setAttribute("aria-pressed","false");mic.classList.remove("is-on");editor.focus();};
  mic.setAttribute("aria-pressed","true");mic.classList.add("is-on");
  try{recognizer.start();}catch{recognizer=null;}
 };
}
el("confirm").onclick=()=>action(async()=>{run=await call("confirm",{chatId,id:pending.id});await open({chat:chatId});});
el("reject").onclick=()=>action(async()=>{await call("reject",{chatId,id:pending.id});await open({chat:chatId});}).then(flushQueue);
el("stop").onclick=()=>action(async()=>{
 run=await call("cancel",{chatId,runId:run.id});
 if(active(run)){renderRun();poll();}else await open({chat:chatId});
});
document.addEventListener("click",event=>{
 const trigger=event.target.closest("[data-sx-ai-open]");
 if(!trigger)return;
 const company=trigger.dataset.sxAiCompany || document.querySelector("[data-sx-ai-company]")?.dataset.sxAiCompany || "";
 if(!panel.open){document.documentElement.classList.add("sx-ai-open");panel.showModal();panel.getBoundingClientRect();panel.classList.add("is-shown");panel.querySelector("[data-sx-rte-editor]")?.focus({preventScroll:true});}
 if(company===context && current){
   if(chatId)open({chat:chatId}).catch(e=>el("status").textContent=e.message);
   return;
 }
 context=company;
 el("status").textContent="Открываю переписку…";
 open({company}).then(()=>el("status").textContent="").catch(e=>el("status").textContent=e.message);
});
panel.addEventListener("close",()=>{stopPolling();document.documentElement.classList.remove("sx-ai-open");});
// Close with the same slide; Esc goes through the same path.
let closing=null;
function closePanel(){
 if(!panel.open || closing)return;
 const reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;
 panel.classList.remove("is-shown");
 const done=()=>{clearTimeout(closing);closing=null;panel.removeEventListener("transitionend",onEnd);panel.close();};
 const onEnd=e=>{if(e.target===panel && e.propertyName==="transform")done();};
 if(reduced){panel.close();return;}
 panel.addEventListener("transitionend",onEnd);
 closing=setTimeout(done,450);
}
// "cancel" also bubbles from a file input when the picker is dismissed; only Esc on the dialog closes it.
panel.addEventListener("cancel",e=>{if(e.target!==panel)return;e.preventDefault();if(!menu)closePanel();});
panel.querySelector("[data-sx-ai-close]").onclick=closePanel;
// Files can be dropped anywhere on the conversation ([data-sx-attach-zone] of the attachments widget).
const conversation=panel.querySelector(".sx-ai-conversation");
let dragDepth=0;
const dragsFiles=e=>Array.prototype.includes.call(e.dataTransfer?.types||[],"Files");
const setDragging=on=>{if(!on)dragDepth=0;conversation.classList.toggle("is-dragging-files",on);};
conversation.addEventListener("dragenter",e=>{if(!dragsFiles(e))return;dragDepth++;setDragging(true);});
conversation.addEventListener("dragleave",e=>{if(!dragsFiles(e))return;if(--dragDepth<=0)setDragging(false);});
conversation.addEventListener("drop",()=>setDragging(false));
document.addEventListener("dragend",()=>setDragging(false));
window.addEventListener("blur",()=>setDragging(false));
})();
