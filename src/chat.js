(()=>{
const panel=document.querySelector(".sx-ai-panel");
if(!panel || panel.dataset.ready)return;
panel.dataset.ready="1";
let tab,auth,context;

const el=id=>document.getElementById("sx-ai-"+id);
let pending,chatId,sending=false;
const endpoint = path => {
 const target = new URL(path.replace(/^\//,""),location.origin);
 const url = new URL("/ai-panel/api",location.origin);
 url.search = target.search;
 url.searchParams.set("op",target.pathname.slice(1));
 url.searchParams.set("tab",tab);
 return url;
};
async function progress(){
 const r=await fetch(endpoint("progress"));
 if(!r.ok)return;
 const {events}=await r.json();
 if(!events.length)return;
 if(sending)el("status").textContent=events.at(-1);
 const list=el("activity").querySelector("ol");
 if(list.childElementCount===events.length)return;
 list.replaceChildren(...events.map(text=>{const li=document.createElement("li");li.textContent=text;return li;}));
 el("activity").hidden=false;
}

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
let jobTimer;
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
function render(data){
 const picker=el("engine");
 const engines=data.engines || ["codex"];
 const previous=picker.value;
 picker.replaceChildren(...engines.map(id=>new Option(id==="codex"?"Codex":"Claude",id)));
 if(engines.includes(previous))picker.value=previous;
 el("engineLabel").hidden=engines.length<2;
 clearTimeout(jobTimer);
 const job=data.draftJob;
 const running=job && !Number(job.done) && ["running","queued","retry_wait"].includes(job.status);
 const stages={running:data.stage || "Воркер выполняет поручение",queued:"В очереди",retry_wait:"Ожидается повторная попытка"};
 el("job").textContent=data.pending?"Требуется ваше подтверждение":running?stages[job.status]+" · №"+job.id:
   job && !Number(job.done)?"Задание №"+job.id+" остановлено ("+job.status+").":"";
 el("job").classList.toggle("sx-ai-working",!!running && !data.pending);
 if(running && panel.open){
  const expected=data.chatId;
  jobTimer=setTimeout(async()=>{
   if(!panel.open || chatId!==expected)return;
   try{const r=await fetch(endpoint("history"));if(r.ok){const updated=await r.json();if(chatId===expected && updated.chatId===expected)render(updated);}}
   catch{el("job").textContent="Не удалось обновить состояние задания.";}
  },2000);
 }
 const scroll=el("scroll");
 const follow=chatId!==data.chatId || scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<80;
 chatId=data.chatId;
 el("title").textContent=data.chats.find(c=>Number(c.id)===chatId)?.title || "Новый чат";
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
    link.href=endpoint("file?chat="+encodeURIComponent(chatId)+"&id="+encodeURIComponent(f.id));link.textContent=f.name;link.download=f.name;
    if(entry.role==="assistant" && /^preview-\d+-(phone|desktop)\.jpg$/.test(f.name)){
     const image=document.createElement("img");
     image.className="sx-ai-screenshot";image.src=link.href;
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
 }
 pending=data.pending;el("preview").hidden=!pending;
 if(pending)el("preview").querySelector("pre").textContent=pending.tool+"\n"+JSON.stringify(pending.args,null,2);
 if(follow)scroll.scrollTop=scroll.scrollHeight;
 const profile=data.engine==="claude-vclaude"?"Claude через VClaude · результаты REST передаются провайдеру":data.engine==="claude-personal"?"Claude · личное подключение":data.chatId?"Codex":"";
 el("context").textContent=[data.company?"Компания №"+data.company:"",profile].filter(Boolean).join(" · ");
}
async function send(path,body){
 if(sending)return;
 sending=true;
 const editor=panel.querySelector("[data-sx-rte-editor]");
 const isMessage=path==="/message";
 let bubble;
 if(isMessage){
   bubble=document.createElement("article");bubble.className="user";
   bubble.textContent=body.message || "Прикреплённые файлы: "+body.uploads.length;
   el("messages").append(bubble);
   el("scroll").scrollTop=el("scroll").scrollHeight;
   editor.replaceChildren();editor.setAttribute("contenteditable","false");
 }
 for(const b of panel.querySelectorAll("button,select"))b.disabled=true;
 el("status").classList.add("sx-ai-working");
 el("status").textContent=isMessage?"Отправляю сообщение…":path==="/confirm"?"Передаю подтверждение…":"Открываю чат…";
 el("activity").hidden=true;el("activity").open=true;el("activity").querySelector("ol").replaceChildren();
 const timer=setInterval(()=>progress().catch(()=>{}),750);
 try{
  const response=await fetch(endpoint(path),{method:"POST",headers:{"content-type":"application/json","X-CSRF-Token":yii.getCsrfToken()},body:JSON.stringify({...body,chatId})});
  if(response.status===401)context=undefined;
  if(!response.ok){const error=await response.json().catch(()=>({}));throw Error(error.error||error.message||"Запрос не выполнен.");}
  const data=await response.json();
  if(path==="/new" || path==="/select"){showChats(false);toggle.focus();}
  render(data);if(folder.open)refreshFolder();panel.querySelector("[data-sx-rte-editor]").replaceChildren();el("message").value="";panel.querySelector("[data-sx-attach-list]").replaceChildren();el("status").textContent="";
 }catch(e){
   clearInterval(timer);
   if(isMessage){
     // The service may already have persisted the user message before a provider error.
     bubble.remove();
     try{const r=await fetch(endpoint("history"));if(r.ok)render(await r.json());}catch{}
     editor.textContent=body.message;
   }
   el("status").textContent=e.message;
 }finally{
   clearInterval(timer);sending=false;
   el("status").classList.remove("sx-ai-working");
   if(isMessage)editor.setAttribute("contenteditable","true");
   el("activity").open=false;
   for(const b of panel.querySelectorAll("button,select"))b.disabled=false;
 }
}
const toggle=el("toggleChats");
function showChats(open){
 panel.classList.toggle("sx-ai-show-chats",open);
 toggle.setAttribute("aria-expanded",String(open));
}
toggle.onclick=()=>showChats(!panel.classList.contains("sx-ai-show-chats"));
el("newChat").onclick=()=>send("/new",{engine:el("engine").value || "codex"});
el("chats").onclick=e=>{
 const pin=e.target.closest("button[data-pin]");
 if(pin){changeSidebar({id:Number(pin.dataset.pin),pin:pin.getAttribute("aria-pressed")!=="true"});return;}
 const button=e.target.closest("button[data-chat]");
 if(!button)return;
 if(Number(button.dataset.chat)===chatId)showChats(false);
 else send("/select",{id:Number(button.dataset.chat)});
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
 if (uploads.length || message) await send("/message",{message,uploads});
};
el("confirm").onclick=()=>send("/confirm",{id:pending.id});
window.addEventListener("message",async event=>{
 if(event.origin!==location.origin || event.source!==auth?.contentWindow || event.data?.tab!==tab)return;
 auth.remove(); auth=null;
 try {
  const response=await fetch(endpoint("history"));
  if(!response.ok)throw Error();
  render(await response.json());el("status").textContent="";
  panel.querySelector("main").inert=false;
 }catch{el("status").textContent="Не удалось открыть переписку.";}
});
document.addEventListener("click",event=>{
 const trigger=event.target.closest("[data-sx-ai-open]");
 if(!trigger)return;
 const company=trigger.dataset.sxAiCompany || document.querySelector("[data-sx-ai-company]")?.dataset.sxAiCompany || "";
 if(!panel.open)panel.showModal();
 if(company===context && !panel.querySelector("main").inert){
   fetch(endpoint("history")).then(r=>r.ok?r.json():null).then(data=>{if(data && data.chatId===chatId)render(data);}).catch(()=>{});
   return;
 }
 context=company;tab=crypto.randomUUID().replaceAll("-","");
 auth?.remove();auth=document.createElement("iframe");auth.title="Авторизация SkeekS AI";
 auth.src="/ai-panel/start?tab="+tab+"&company="+encodeURIComponent(company);
 panel.prepend(auth);panel.querySelector("main").inert=true;el("status").textContent="Подключение…";
});
panel.querySelector("[data-sx-ai-close]").onclick=()=>panel.close();
})();
