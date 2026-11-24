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
// Short value at the right of a side panel row (like the Claude side panel).
const rowValue=(id,...content)=>el(id).querySelector(".sx-ai-row-value").replaceChildren(...content);
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
// File manager of the shared project files: a drawer over the chat with a folder tree, the files of a folder,
// preview and editing. Files live in the central service; the site checks the rights.
const folder=el("folder");
const canWrite=panel.dataset.projectWrite==="1";
const fm={items:[],cwd:"",file:null,box:null,busy:false};
const fmSvg=d=>{const s=document.createElementNS("http://www.w3.org/2000/svg","svg");s.setAttribute("viewBox","0 0 24 24");s.setAttribute("aria-hidden","true");
 const p=document.createElementNS("http://www.w3.org/2000/svg","path");p.setAttribute("d",d);s.append(p);return s;};
const fmIcons={dir:"M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",file:"M7 3h7l5 5v13H7zM14 3v5h5",
 image:"M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4",code:"M9 8l-4 4 4 4M15 8l4 4-4 4",up:"M12 19V5M5 12l7-7 7 7",plus:"M12 5v14M5 12h14",close:"M6 6l12 12M18 6L6 18",more:"M5 12h.01M12 12h.01M19 12h.01"};
const fmKind=p=>/\.(png|jpe?g|webp|gif|svg)$/i.test(p)?"image":/\.(html?|css|js|json|md|txt|xml|svg|php)$/i.test(p)?"code":"file";
const fmText=p=>/\.(html?|css|js|json|md|txt|xml|svg|csv)$/i.test(p);
const fmParent=p=>p.includes("/")?p.slice(0,p.lastIndexOf("/")):"";
const fmName=p=>p.slice(p.lastIndexOf("/")+1);
const fmJoin=(dir,name)=>dir?dir+"/"+name:name;
const fmSize=b=>b<1024?b+" Б":b<1048576?(b/1024).toLocaleString("ru-RU",{maximumFractionDigits:1})+" КБ":(b/1048576).toLocaleString("ru-RU",{maximumFractionDigits:1})+" МБ";
const fmDate=t=>t?new Date(t*1000).toLocaleString("ru-RU",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}):"";
function fmFolders(){
 const set=new Set();
 for(const i of fm.items){let p=i.dir?i.path:fmParent(i.path);while(p){set.add(p);p=fmParent(p);}}
 return set;
}
function fmBtn(label,icon,fn,cls=""){
 const b=document.createElement("button");b.type="button";b.className="sx-ai-iconbtn "+cls;
 if(icon)b.append(fmSvg(fmIcons[icon]));
 const t=document.createElement("span");t.textContent=label;b.append(t);b.onclick=fn;return b;
}
function fmStatus(text,error){const s=fm.box.querySelector(".sx-ai-fm-status");s.textContent=text||"";s.classList.toggle("is-error",!!error);}
async function fmFetch(url,options){
 const r=await fetch(url,options);
 const d=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(r.status===403?"Нет прав на файлы проекта.":d.message||d.error||"Не удалось выполнить действие.");
 return d;
}
async function fmLoad(){
 try{
  fm.items=(await fmFetch("/ai-panel/project-tree")).items;
  rowValue("folder",String(fm.items.filter(i=>!i.dir).length||""));
  if(fm.cwd && !fmFolders().has(fm.cwd))fm.cwd="";
  if(fm.file && !fm.items.some(i=>i.path===fm.file.path))fm.file=null;
  if(fm.box && !fm.box.hidden)fmRender();
 }catch(e){if(fm.box)fmStatus(e.message,true);}
}
async function fmChange(body,done){
 try{fmStatus("Сохраняю…");await fmFetch("/ai-panel/project-change",{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":yii.getCsrfToken()},body:JSON.stringify(body)});
  fmStatus(done);await fmLoad();}
 catch(e){fmStatus(e.message,true);}
}
async function fmUpload(files){
 if(!canWrite){fmStatus("Нет права записи в проект.",true);return;}
 let ok=0;
 for(const file of files){
  const path=fmJoin(fm.cwd,file.name),current=fm.items.find(i=>i.path===path && !i.dir);
  const form=new FormData();form.append("file",file);form.append("path",path);form.append("revision",current?.revision||"");
  try{fmStatus("Загружаю "+file.name+"…");await fmFetch("/ai-panel/project-upload",{method:"POST",headers:{"X-CSRF-Token":yii.getCsrfToken()},body:form});ok++;}
  catch(e){fmStatus(file.name+": "+e.message,true);await fmLoad();return;}
 }
 fmStatus(ok===1?"Файл загружен.":"Загружено файлов: "+ok+".");await fmLoad();
}
// Inline name field in place of a row title: Enter saves, Esc cancels.
function fmAskName(anchor,value,save){
 const input=document.createElement("input");input.className="form-control sx-ai-fm-name";input.value=value;
 const restore=()=>input.replaceWith(anchor);
 input.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();const v=input.value.trim();restore();if(v && v!==value)save(v);}
  if(e.key==="Escape"){e.preventDefault();e.stopPropagation();restore();}};
 // Leaving the browser window keeps the field; a click elsewhere on the page cancels it.
 input.onblur=()=>{setTimeout(()=>{if(input.isConnected && document.hasFocus() && document.activeElement!==input)restore();},0);};
 anchor.replaceWith(input);input.focus();input.select();
}
function fmRowMenu(item,row,title){
 closeMenu();
 menu=document.createElement("div");menu.className="sx-ai-menu";menu.setAttribute("role","menu");menu.owner=row.querySelector(".sx-ai-fm-more");
 const fill=(...items)=>{menu.replaceChildren(...items);menu.querySelector("button")?.focus();};
 const main=()=>fill(
  ...(item.dir?[menuItem("Открыть",()=>{closeMenu();fm.cwd=item.path;fm.file=null;fmRender();})]:[menuItem("Открыть",()=>{closeMenu();fmOpen(item);}),
   menuItem("Скачать",()=>{closeMenu();location.href="/ai-panel/project-download?path="+encodeURIComponent(item.path);})]),
  ...(canWrite?[menuItem("Переименовать",()=>{closeMenu();fmAskName(title,fmName(item.path),v=>fmChange({op:"move",from:item.path,to:fmJoin(fmParent(item.path),v)},"Переименовано."));}),
   menuItem("Переместить в папку…",()=>{closeMenu();fmAskName(title,fmParent(item.path),v=>fmChange({op:"move",from:item.path,to:fmJoin(v.replace(/^\/+|\/+$/g,""),fmName(item.path))},"Перемещено."));}),
   menuItem("Удалить",confirm,true)]:[]));
 const confirm=()=>{
  const text=document.createElement("p");text.textContent=item.dir?"Удалить папку «"+fmName(item.path)+"» со всем содержимым?":"Удалить файл «"+fmName(item.path)+"»?";
  fill(text,menuItem("Удалить",()=>{closeMenu();fmChange({op:"delete",items:[item.dir?{path:item.path}:{path:item.path,revision:item.revision}]},"Удалено.");},true),menuItem("Отмена",main));
 };
 main();row.append(menu);menu.owner?.setAttribute("aria-expanded","true");
}
function fmCrumbs(){
 const nav=document.createElement("nav");nav.className="sx-ai-fm-crumbs";nav.setAttribute("aria-label","Путь");
 const parts=fm.cwd?fm.cwd.split("/"):[];
 const go=(path)=>{const b=document.createElement("button");b.type="button";b.textContent=path===""?"Проект":fmName(path);b.onclick=()=>{fm.cwd=path;fm.file=null;fmRender();};return b;};
 nav.append(go(""));
 parts.forEach((_,i)=>{nav.append(Object.assign(document.createElement("span"),{textContent:"/"}),go(parts.slice(0,i+1).join("/")));});
 if(fm.file)nav.append(Object.assign(document.createElement("span"),{textContent:"/"}),Object.assign(document.createElement("strong"),{textContent:fmName(fm.file.path)}));
 return nav;
}
function fmTree(){
 const folders=[...fmFolders()].sort((a,b)=>a.localeCompare(b,"ru"));
 const list=document.createElement("ul");
 const item=(path,depth)=>{
  const li=document.createElement("li"),b=document.createElement("button");b.type="button";
  b.style.paddingInlineStart=(.5+depth*.9)+"rem";b.append(fmSvg(fmIcons.dir),document.createTextNode(path===""?"Проект":fmName(path)));
  if(path===fm.cwd)b.setAttribute("aria-current","true");
  b.onclick=()=>{fm.cwd=path;fm.file=null;fmRender();};
  li.append(b);return li;
 };
 list.append(item("",0));
 for(const f of folders)list.append(item(f,f.split("/").length));
 return list;
}
function fmList(){
 const folders=[...fmFolders()].filter(f=>fmParent(f)===fm.cwd).sort((a,b)=>a.localeCompare(b,"ru"));
 const files=fm.items.filter(i=>!i.dir && fmParent(i.path)===fm.cwd).sort((a,b)=>a.path.localeCompare(b.path,"ru"));
 const wrap=document.createElement("div");wrap.className="sx-ai-fm-list";
 if(!folders.length && !files.length){
  wrap.append(Object.assign(document.createElement("p"),{className:"sx-ai-note sx-ai-fm-empty",
   textContent:canWrite?"Папка пуста. Перетащите сюда файлы или нажмите «Загрузить».":"Папка пуста."}));
  return wrap;
 }
 const entries=[...folders.map(p=>{const i=fm.items.find(x=>x.path===p);return {path:p,dir:true,size:0,updated_at:i?.updated_at||0};}),...files];
 for(const item of entries){
  const row=document.createElement("div");row.className="sx-ai-fm-row";
  const open=document.createElement("button");open.type="button";open.className="sx-ai-fm-open";
  open.append(fmSvg(fmIcons[item.dir?"dir":fmKind(item.path)]),Object.assign(document.createElement("span"),{textContent:fmName(item.path)}));
  open.onclick=()=>{if(item.dir){fm.cwd=item.path;fm.file=null;fmRender();}else fmOpen(item);};
  const size=Object.assign(document.createElement("span"),{className:"sx-ai-fm-meta",textContent:item.dir?"":fmSize(item.size)});
  const date=Object.assign(document.createElement("span"),{className:"sx-ai-fm-meta",textContent:fmDate(item.updated_at)});
  const more=document.createElement("button");more.type="button";more.className="sx-ai-iconbtn sx-ai-fm-more";more.title="Действия";
  more.setAttribute("aria-haspopup","menu");more.setAttribute("aria-expanded","false");more.append(fmSvg(fmIcons.more));
  more.onclick=e=>{e.stopPropagation();if(menu?.owner===more){closeMenu();return;}fmRowMenu(item,row,open);};
  row.append(open,size,date,more);wrap.append(row);
 }
 return wrap;
}
async function fmOpen(item){
 fm.file=item;fmRender();
 const view=fm.box.querySelector(".sx-ai-fm-main");
 try{
  const r=await fetch("/ai-panel/project-download?path="+encodeURIComponent(item.path));
  if(!r.ok)throw Error("Не удалось открыть файл.");
  const blob=await r.blob();
  if(fm.file!==item)return;
  const body=document.createElement("div");body.className="sx-ai-fm-preview";
  const actions=document.createElement("div");actions.className="sx-ai-fm-actions";
  actions.append(fmBtn("К папке","up",()=>{fm.file=null;fmRender();}),fmBtn("Скачать","",()=>{location.href="/ai-panel/project-download?path="+encodeURIComponent(item.path);}));
  if(fmKind(item.path)==="image" && !/\.svg$/i.test(item.path)){
   const img=document.createElement("img");img.alt=fmName(item.path);img.src=URL.createObjectURL(blob);body.append(img);
  }else if(fmText(item.path)){
   const text=await blob.text();
   if(/\.html?$/i.test(item.path)){
    // Rendered page without scripts or access to the admin: an isolated frame.
    const frame=document.createElement("iframe");frame.setAttribute("sandbox","");frame.title=fmName(item.path);frame.srcdoc=text;
    const code=Object.assign(document.createElement("pre"),{textContent:text});code.hidden=true;
    actions.append(fmBtn("Код","code",e=>{const show=code.hidden;code.hidden=!show;frame.hidden=show;e.currentTarget.querySelector("span").textContent=show?"Страница":"Код";}));
    body.append(frame,code);
   }else body.append(Object.assign(document.createElement("pre"),{textContent:text}));
   if(canWrite)actions.append(fmBtn("Редактировать","",()=>fmEdit(item,text)));
  }else body.append(Object.assign(document.createElement("p"),{className:"sx-ai-note",textContent:"Просмотр этого типа файлов недоступен, его можно скачать."}));
  const info=Object.assign(document.createElement("p"),{className:"sx-ai-note",textContent:fmSize(item.size)+" · изменён "+fmDate(item.updated_at)});
  view.replaceChildren(actions,info,body);
 }catch(e){fmStatus(e.message,true);}
}
function fmEdit(item,text){
 const view=fm.box.querySelector(".sx-ai-fm-main");
 const field=document.createElement("textarea");field.className="form-control sx-ai-fm-editor";field.value=text;field.spellcheck=false;field.setAttribute("aria-label",item.path);
 const actions=document.createElement("div");actions.className="sx-ai-fm-actions";
 actions.append(fmBtn("Сохранить","",async()=>{
  try{fmStatus("Сохраняю…");await saveProjectFile({path:item.path,revision:item.revision,text:field.value},chatId);fmStatus("Сохранено.");
   await fmLoad();const fresh=fm.items.find(i=>i.path===item.path);if(fresh)fmOpen(fresh);}
  catch(e){fmStatus(e.message,true);}
 },"sx-ai-fm-primary"),fmBtn("Отмена","",()=>fmOpen(item)));
 view.replaceChildren(actions,field);field.focus();
}
function fmRender(){
 const box=fm.box;
 box.querySelector(".sx-ai-fm-crumbs").replaceWith(fmCrumbs());
 box.querySelector(".sx-ai-fm-tree").replaceChildren(fmTree());
 if(!fm.file)box.querySelector(".sx-ai-fm-main").replaceChildren(fmList());
}
function fmBuild(){
 const box=document.createElement("section");box.className="sx-ai-fm";box.hidden=true;box.setAttribute("aria-label","Файлы проекта");
 const head=document.createElement("header");head.className="sx-ai-fm-head";
 const input=document.createElement("input");input.type="file";input.multiple=true;input.hidden=true;
 input.onchange=()=>{if(input.files.length)fmUpload([...input.files]);input.value="";};
 // The picker's cancel event must not reach the dialog (it would close the window).
 input.addEventListener("cancel",e=>e.stopPropagation());
 head.append(Object.assign(document.createElement("strong"),{textContent:"Файлы проекта"}),Object.assign(document.createElement("span"),{className:"sx-ai-fm-space"}));
 if(canWrite){
  const newFolder=fmBtn("Новая папка","plus",()=>{
   const anchor=document.createElement("span");fm.box.querySelector(".sx-ai-fm-main").prepend(anchor);
   fmAskName(anchor,"",v=>fmChange({op:"folder",path:fmJoin(fm.cwd,v)},"Папка создана."));
  });
  head.append(newFolder,fmBtn("Загрузить","up",()=>input.click()),input);
 }
 head.append(fmBtn("Закрыть","close",fmClose));
 const body=document.createElement("div");body.className="sx-ai-fm-body";
 body.append(Object.assign(document.createElement("nav"),{className:"sx-ai-fm-tree",ariaLabel:"Папки"}),Object.assign(document.createElement("div"),{className:"sx-ai-fm-main"}));
 const drop=Object.assign(document.createElement("div"),{className:"sx-ai-fm-drop",textContent:"Отпустите, чтобы загрузить в папку"});
 box.append(head,Object.assign(document.createElement("nav"),{className:"sx-ai-fm-crumbs"}),body,Object.assign(document.createElement("p"),{className:"sx-ai-fm-status",role:"status"}),drop);
 let depth=0;
 box.addEventListener("dragenter",e=>{if(!canWrite || !e.dataTransfer?.types.includes("Files"))return;e.preventDefault();e.stopPropagation();depth++;box.classList.add("is-dropping");});
 box.addEventListener("dragover",e=>{if(!canWrite || !e.dataTransfer?.types.includes("Files"))return;e.preventDefault();e.stopPropagation();});
 box.addEventListener("dragleave",e=>{e.stopPropagation();if(--depth<=0){depth=0;box.classList.remove("is-dropping");}});
 box.addEventListener("drop",e=>{if(!e.dataTransfer?.files.length)return;e.preventDefault();e.stopPropagation();depth=0;box.classList.remove("is-dropping");fmUpload([...e.dataTransfer.files]);});
 box.addEventListener("keydown",e=>{if(e.key==="Escape" && !menu){e.preventDefault();e.stopPropagation();fmClose();}});
 panel.querySelector("main").append(box);
 return box;
}
function fmShow(){
 fm.box??=fmBuild();
 fm.box.hidden=false;
 requestAnimationFrame(()=>fm.box.classList.add("is-open"));
 setTimeout(()=>fm.box.classList.add("is-open"),20);
 folder.setAttribute("aria-expanded","true");
 fmStatus("");fmRender();fmLoad();
 fm.box.querySelector(".sx-ai-fm-head button")?.focus({preventScroll:true});
}
function fmClose(){
 if(!fm.box || fm.box.hidden)return;
 closeMenu();
 fm.box.classList.remove("is-open");
 folder.setAttribute("aria-expanded","false");
 setTimeout(()=>{if(!fm.box.classList.contains("is-open"))fm.box.hidden=true;},260);
 folder.focus({preventScroll:true});
}
folder.onclick=()=>{if(fm.box && !fm.box.hidden)fmClose();else fmShow();};
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
 rowValue("sideProject",current?(projects.find(p=>Number(p.id)===Number(current.project_id))?.name||"Без проекта"):"");
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
 summary.textContent=["Ход работы · шагов: "+texts.length,...(stat?[stat.seconds?fmt.seconds(stat.seconds):"",stat.tokens?fmt.tokens(stat.tokens)+" токенов"+(stat.cached?" (из кеша "+fmt.tokens(stat.cached)+")":""):"",fmt.usd(stat.cost)]:[])].filter(Boolean).join(" · ");
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
// Model choice next to the composer: the account's models of the chat engine plus the engine default.
function renderModels(engine,selected,effort){
 const list=(current?.models||{})[engine]||[];
 const picker=el("model");
 picker.replaceChildren(new Option("Модель по умолчанию",""),...list.map(m=>new Option(m.title,m.id)));
 picker.value=list.some(m=>m.id===selected)?selected:"";
 el("modelLabel").hidden=!list.length;
 renderEfforts(engine,effort);
}
// Reasoning depth of the chosen model; "стандартно" keeps the executor default.
const effortTitles={low:"Низкая",medium:"Средняя",high:"Высокая",xhigh:"Очень высокая",max:"Максимальная"};
function renderEfforts(engine,selected){
 const model=el("model").value;
 const levels=model?(((current?.models||{})[engine]||[]).find(m=>m.id===model)?.efforts||[]):((current?.engineEfforts||{})[engine]||[]);
 const picker=el("effort");
 picker.replaceChildren(new Option("Рассуждения: стандартно",""),...levels.map(l=>new Option("Рассуждения: "+effortTitles[l].toLowerCase(),l)));
 picker.value=levels.includes(selected)?selected:"";
 el("effortLabel").hidden=!levels.length;
}
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
 renderModels(data.chatId?data.engine:picker.value,data.chatId?data.model:el("model").value,data.chatId?data.effort:el("effort").value);
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
      try{await saveProjectFile({path,attachment_id:Number(f.id)},data.chatId);fmShow();}
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
 renderContext(data.context);
 if(usageChat!==chatId)refreshUsage();
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
   const result=await call("message",{chatId,engine:el("engine").value,model:el("model").value,effort:el("effort").value,company:context||null,clientKey,message,uploads});
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
el("engine").onchange=()=>{if(!chatId)renderModels(el("engine").value,"","");};
el("model").onchange=()=>renderEfforts(chatId?current.engine:el("engine").value,el("effort").value);
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
// Side panel "Контекст": fill of the engine context after the last run and what it consists of.
const contextColors={rules:"#d97757",catalog:"#5b8def",skills:"#a77bdc",attachments:"#e0a03c",conversation:"#3fa37a",tools:"#c45c8a",engine:"#8a8f98"};
function renderContext(c){
 const body=el("ctx").querySelector(".sx-ai-context-body");
 if(!c)rowValue("ctx");
 else{
  const share=c.window?Math.min(100,Math.round(c.used/c.window*100)):null,meter=document.createElement("span"),fill=document.createElement("i");
  meter.className="sx-ai-row-meter";fill.style.width=(share??0)+"%";meter.append(fill);
  rowValue("ctx",share!==null?share+"%":fmt.tokens(c.used),...(share!==null?[meter]:[]));
 }
 if(!c){body.replaceChildren(Object.assign(document.createElement("p"),{className:"sx-ai-note",textContent:chatId?"Появится после следующего ответа.":"Появится после первого ответа в чате."}));return;}
 const head=document.createElement("div");head.className="sx-ai-context-head";
 const pct=c.window?Math.min(100,Math.round(c.used/c.window*100)):null;
 head.innerHTML="";
 const left=document.createElement("strong");left.textContent=pct!==null?pct+"% занято":"Занято";
 const right=document.createElement("span");right.textContent=fmt.tokens(c.used)+(c.window?" / "+fmt.tokens(c.window):"");
 head.append(left,right);
 const bar=document.createElement("div");bar.className="sx-ai-context-bar";
 const total=c.window||c.used||1;
 for(const p of c.parts){const seg=document.createElement("span");seg.style.width=(p.tokens/total*100)+"%";seg.style.background=contextColors[p.key]||"#888";seg.title=p.title;bar.append(seg);}
 const list=document.createElement("table");list.className="sx-ai-context-table";
 for(const p of c.parts){
  const tr=document.createElement("tr"),name=document.createElement("td"),val=document.createElement("td"),share=document.createElement("td");
  const dot=document.createElement("i");dot.style.background=contextColors[p.key]||"#888";name.append(dot,document.createTextNode(p.title));
  val.textContent="≈ "+fmt.tokens(p.tokens);share.textContent=c.used?(p.tokens/c.used*100).toLocaleString("ru-RU",{maximumFractionDigits:1})+"%":"";
  tr.append(name,val,share);list.append(tr);
 }
 const notes=[];
 if(c.cached)notes.push("Из кеша "+fmt.tokens(c.cached)+" ("+Math.round(c.cached/c.used*100)+"%).");
 if(c.compactAt)notes.push(c.used<c.compactAt?"До сжатия истории ≈ "+fmt.tokens(c.compactAt-c.used)+".":"Движок сжимает историю.");
 if(c.model)notes.push("Модель: "+c.model+".");
 notes.push("Объём — по данным движка на последнем обращении; разбивка — оценка по объёму текста.");
 const note=document.createElement("p");note.className="sx-ai-note";note.textContent=notes.join(" ");
 body.replaceChildren(head,bar,list,note);
}
// Side panel "Расход": tokens of this chat, mine for the month and, for administrators, the account.
const usageBox=el("usage");
// Chat whose figures the open section shows: another chat refreshes it on opening.
let usageChat;
function usageTable(title,rows,label){
 if(!rows || !rows.length)return null;
 const wrap=document.createElement("div");wrap.className="sx-ai-usage-group";
 const h=document.createElement("strong");h.textContent=title;wrap.append(h);
 const table=document.createElement("table");table.className="sx-ai-usage-table";
 for(const r of rows){
  const tr=document.createElement("tr"),name=document.createElement("td"),val=document.createElement("td");
  name.textContent=label(r);name.title=name.textContent;
  val.textContent=fmt.tokens(r.input+r.output)+(r.cached?" (кеш "+fmt.tokens(r.cached)+")":"")+(r.cost!==null && r.cost!==undefined?" · "+fmt.usd(r.cost):"");
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
 const body=usageBox.querySelector(".sx-ai-usage-body"),forChat=chatId;
 try{
  const r=await fetch(endpoint("usage",{chat:forChat}));const d=await r.json();
  if(forChat!==chatId)return;
  if(!r.ok)throw Error(d.error||"Не удалось загрузить расход.");
  usageChat=forChat;
  rowValue("usage",forChat && d.chat?.input?fmt.tokens(d.chat.input):"");
  const note=document.createElement("p");note.className="sx-ai-note";
  note.textContent="Токены — по данным движков. Токены из кеша по ценам API в разы дешевле обычных. Сумма в долларах — ориентир по официальным ценам API, не счёт.";
  body.replaceChildren(...[
   chatId?usageTotal("Этот чат",d.chat):null,
   usageTotal("Мои поручения за "+d.month,d.mine),
   usageTable("По моделям",d.mineByModel,r=>r.title),
   usageTable("По проектам",d.mineByProject,r=>r.project||"Без проекта"),
   usageTable("По чатам",d.mineByChat,r=>r.title),
   d.account?usageTotal("Весь аккаунт за "+d.month,d.account):null,
   d.account?usageTable("По сотрудникам",d.accountByUser,r=>r.user):null,
   note].filter(Boolean));
 }catch(e){if(forChat===chatId)body.replaceChildren(Object.assign(document.createElement("p"),{className:"sx-ai-note",textContent:e.message}));}
}
usageBox.ontoggle=()=>{if(usageBox.open)refreshUsage();};
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
fmLoad();
})();
