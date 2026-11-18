import { API_URL, REFRESH_SECONDS } from './config.js';
const sessionKey='dashhughes-session';
const params=new URLSearchParams(location.search);
const categories=[
 {id:51,key:'5',short:'Crítico',title:'Prioridade Crítica',color:'#ff5275',names:['5','disaster','critical']},
 {id:53,key:'4',short:'Alta',title:'Prioridade Alta',color:'#ff575e',names:['4','high']},
 {id:55,key:'3',short:'Média',title:'Prioridade Média',color:'#ff8a3b',names:['3','average','medium']},
 {id:14,key:'2',short:'Aviso',title:'Aviso',color:'#f4cd4d',names:['2','warning','warn']},
 {id:52,key:'1',short:'Informação',title:'Informações',color:'#6da9ff',names:['1','information','info']},
];
const periods=[['now-15m','15 min'],['now-1h','1 hora'],['now-6h','6 horas'],['now-24h','24 horas'],['now-30d','30 dias']];
let period=periods.some(([value])=>value===params.get('from'))?params.get('from'):'now-30d';
let panels=[],incidents=[],updated=0,query='',selected='all',limit=10;
let charts=[],timer,activeRequest;
const hiddenLines=new Set();
const detail=document.querySelector('[data-detail]');
const brandPage=document.querySelector('[data-brand]');
const problemPage=document.querySelector('[data-problem]');
const requestedProblem=params.get('problema')??'';
let excludedProblems=[];
try{
 const value=JSON.parse(params.get('excluir')??'[]');
 if(Array.isArray(value)&&value.length<=6&&value.every(item=>typeof item==='string'&&item.length<=500))excludedProblems=value;
}catch{}
const isOtherProblem=params.get('grupo')==='outros'&&excludedProblems.length>0;
const matchesProblem=row=>isOtherProblem
 ? !excludedProblems.includes(simple(row.problema))
 : simple(row.problema)===requestedProblem;
const requestedBrand=params.get('marca')??'';
const brandLogos=new Map([
 ['FARM','farm.jpg'],['ANIMALE','animale.webp'],['NV','nv.webp'],['CAROL BASSI','carol-bassi.webp'],
 ['FOXTON','foxton.webp'],['MARIA FILÓ','maria-filo.png'],['OFF PREMIUM','off-premium.webp'],
 ['FABULA','fabula.jpg'],['CRIS BARROS','cris-barros.jpg'],
]);
const category=categories.find(item=>item.id===Number(params.get('id')));
const format=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:1});
const dates=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const fullDates=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'medium'});
const status=document.querySelector('#status');
const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;};
function out(){sessionStorage.removeItem(sessionKey);location.replace('./login.html');}
async function api(path,options={}){
 const response=await fetch(API_URL+path,{...options,cache:'no-store',signal:options.signal??AbortSignal.timeout(40000)});
 if(response.status===401&&!document.querySelector('#login')){out();throw new Error('Sessão encerrada.');}
 const data=await response.json();
 if(!response.ok)throw new Error(data.error??'Não foi possível atualizar os dados.');
 return data;
}
const login=document.querySelector('#login');
if(login){
 login.addEventListener('submit',async event=>{
  event.preventDefault();const button=login.querySelector('button');button.disabled=true;
  try{
   const data=await api('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:login.elements.user.value,password:login.elements.password.value})});
   sessionStorage.setItem(sessionKey,data.token);location.replace('./?v=9');
  }catch(error){status.textContent=error.message;}finally{button.disabled=false;login.elements.password.value='';}
 });
}
function timestamp(value){
 const text=String(value??'').trim();
 if(/^\d{10}$/.test(text))return Number(text)*1000;
 if(/^\d{13}$/.test(text))return Number(text);
 const parsed=Date.parse(text.replaceAll('/','-').replace(' ','T')+(/Z|[+-]\d\d:\d\d$/.test(text)?'':'-03:00'));
 return Number.isFinite(parsed)?parsed:Infinity;
}
function age(row){
 const time=timestamp(row.horario);if(!Number.isFinite(time))return '—';
 const minutes=Math.max(0,Math.floor((Date.now()-time)/60000));
 if(minutes<60)return minutes+' min';
 if(minutes<1440)return Math.floor(minutes/60)+' h';
 return Math.floor(minutes/1440)+' d';
}
function started(row){const t=timestamp(row.horario);return Number.isFinite(t)?dates.format(t):'—';}
function severity(row){return categories.find(item=>item.names.includes(String(row.severidade).toLowerCase()));}
function rowsFor(cat){return incidents.filter(row=>!cat||severity(row)?.id===cat.id).sort((a,b)=>timestamp(a.horario)-timestamp(b.horario));}
function simple(value){
 const text=String(value??'').trim(),link=text.match(/\bwan\s*([12])\b/i)?.[1],connection=link?'Link '+link:'Uma conexão';
 if(/license not registered/i.test(text))return 'Licença do firewall não cadastrada';
 if(/\brestarted\b|\brebooted\b/i.test(text))return 'Firewall reiniciou';
 if(/\bunreachable\b|\(NoData\)/i.test(text))return 'Firewall não responde ao monitoramento';
 if(/highpktloss|packet loss|pkt\s*loss/i.test(text))return connection+' com perda de dados';
 if(/\blatency\b/i.test(text))return connection+' lenta';
 if(/\bdown\b/i.test(text))return connection+' indisponível';
 return text;
}
function brand(row){
 const text=row.loja.toUpperCase().replaceAll('_',' ');
 return ['CAROL BASSI','CRIS BARROS','MARIAFILO','MARIA FILO','ANIMALE','FOXTON','FABULA','FARM','BYNV','NV','OFF PREMIUM'].find(name=>text.includes(name))?.replace('MARIAFILO','MARIA FILÓ').replace('MARIA FILO','MARIA FILÓ').replace('BYNV','NV')??'OUTRAS';
}
function storeName(row){return row.loja.replace(/\s*\(\s*firewall\s*\)\s*/ig,'').replaceAll('_',' ').replace(/\s+/g,' ').trim();}
function colored(el,cat){el.style.setProperty('--severity',cat?.color??'#a6b3c2');return el;}
function badge(cat){return colored(node('span',cat?.short??'Sem classificação','badge'),cat);}
function panelValue(cat){const p=panels.find(item=>item.id===cat.id);return p?.estado==='ok'?p.series?.[0]?.valor:null;}
function heading(text){return node('h2',text);}
function surface(cls){return node('section',undefined,'surface '+cls);}
function periodControls(){
 const wrap=document.querySelector('#periods');wrap.replaceChildren();
 for(const [value,label]of periods){const b=node('button',label,value===period?'selected':'');b.type='button';b.setAttribute('aria-pressed',String(value===period));
 b.onclick=()=>{period=value;const url=new URL(location.href);url.searchParams.set('from',value);history.replaceState(null,'',url);periodControls();refresh();};wrap.append(b);}
}
function lineSeries(cat){
 const panel=panels.find(item=>item.id===cat.id);
 return (panel?.series??[]).filter(row=>row.historico?.length).map(row=>({label:cat.short,color:cat.color,points:row.historico}));
}
function plot(canvas,series,spark=false){
 if(!window.Chart)return;
 const chart=new window.Chart(canvas,{type:'line',data:{datasets:series.map(item=>({
  label:item.label,data:item.points.map(([x,y])=>({x,y})),borderColor:item.color,backgroundColor:item.color+'20',
  fill:!spark,stepped:true,borderWidth:spark?1.5:2,pointRadius:0,pointHoverRadius:4,hidden:hiddenLines.has(item.label),
 }))},options:{responsive:true,maintainAspectRatio:false,animation:false,parsing:false,interaction:{mode:'nearest',axis:'x',intersect:false},
 scales:{x:{type:'linear',min:Math.min(...series.flatMap(item=>item.points.map(point=>point[0]))),max:Date.now(),display:!spark,grid:{display:false},border:{display:false},ticks:{color:'#8195ab',font:{size:10,family:'Consolas'},maxTicksLimit:period==='now-30d'?12:6,
 callback:value=>period==='now-30d'?dates.format(value).split(',')[0]:dates.format(value).split(',').at(-1)}},
 y:{display:!spark,beginAtZero:true,border:{display:false},grid:{color:'#22313e'},ticks:{color:'#8195ab',precision:0,maxTicksLimit:6,font:{size:10,family:'Consolas'}}}},
 plugins:{legend:{display:!spark&&series.length>1,position:'top',align:'end',labels:{color:'#aebdcc',boxWidth:10,boxHeight:2,font:{size:10}},
 onClick:(_event,item,legend)=>{const visible=legend.chart.isDatasetVisible(item.datasetIndex);if(visible)hiddenLines.add(item.text);else hiddenLines.delete(item.text);legend.chart.setDatasetVisibility(item.datasetIndex,!visible);legend.chart.update();}},
 tooltip:{enabled:!spark,backgroundColor:'#152331',titleColor:'#e3eaf2',bodyColor:'#c7d5e4',callbacks:{title:items=>fullDates.format(items[0].parsed.x),label:item=>item.dataset.label+': '+format.format(item.parsed.y)+' problemas'}}}}});
 charts.push(chart);
}
function chartPanel(cat){
 const box=surface('chart-panel');box.id='historico';const head=node('div',undefined,'panel-heading');
 const group=node('div',undefined,'heading-group');group.append(heading(cat?'Ocorrências de '+cat.title.toLowerCase():'Evolução das ocorrências'));
 group.append(node('span',period==='now-30d'?'últimos 30 dias · 2 médias por dia':'horário de Brasília','subtext'));head.append(group);box.append(head);
 const wrap=node('div',undefined,'chart-wrap'+(cat?' detail-chart':'')),canvas=node('canvas');canvas.setAttribute('aria-label','Número de problemas por data');canvas.setAttribute('role','img');wrap.append(canvas);box.append(wrap);
 const series=cat?lineSeries(cat):categories.flatMap(lineSeries);
 if(series.length)queueMicrotask(()=>plot(canvas,series));else wrap.replaceChildren(node('p','Histórico indisponível no período selecionado.','empty'));
 return box;
}
function statCards(){
 const grid=node('div',undefined,'stats-grid');grid.id='alertas';
 for(const cat of categories){
  const card=colored(node('a',undefined,'stat-card'),cat);card.href='./detalhe.html?id='+cat.id+'&from='+period+'&v=9';
  const label=node('div',undefined,'stat-label');label.append(node('span',undefined,'dot'),node('span',cat.short));
  const value=panelValue(cat),metric=node('div',undefined,'stat-value'+(value===0?' zero':''));metric.append(node('strong',value===null?'—':format.format(value)));
  const spark=node('div',undefined,'spark'),canvas=node('canvas');spark.append(canvas);metric.append(spark);
  const rows=rowsFor(cat);const caption=rows.length?'Mais antigo aberto há '+age(rows[0]):'Nenhum caso aberto';
  card.append(label,metric,node('p',caption,'stat-caption'));grid.append(card);queueMicrotask(()=>plot(canvas,lineSeries(cat),true));
 }return grid;
}
function showProblemList(name,rows){
 const dialog=document.querySelector('#loja-dialog'),content=document.querySelector('#loja-conteudo');
 const title=heading('Lista para a Hughes — '+name);
 title.id='titulo-lista-hughes';
 dialog.setAttribute('aria-labelledby',title.id);
 const instructions=node('p','Você pode ajustar a mensagem antes de copiar.','subtext');
 const label=node('label','Mensagem para copiar','message-label');
 label.htmlFor='mensagem-hughes';
 const message=node('textarea',undefined,'hughes-message');
 message.id='mensagem-hughes';message.rows=14;message.spellcheck=false;
 const entries=rows.map((row,index)=>[
  (index+1)+'. Loja: '+storeName(row),
  'Código: '+(row.host||'Não informado'),
  'Problema: '+simple(row.problema),
 ].join('\n'));
 message.value=[
  'Olá, equipe Hughes.',
  '',
  'Solicitamos a verificação dos casos abaixo.',
  'Tipo de ocorrência: '+name,
  'Levantamento em '+fullDates.format(Date.now())+' (horário de Brasília).',
  'Total: '+rows.length+(rows.length===1?' ocorrência.':' ocorrências.'),
  '',
  entries.join('\n\n'),
 ].join('\n');
 const copy=node('button','Copiar mensagem','primary');
 copy.type='button';
 const feedback=node('p',undefined,'subtext');
 feedback.setAttribute('role','status');
 copy.onclick=async()=>{
  try{
   await navigator.clipboard.writeText(message.value);
   feedback.textContent='Mensagem copiada.';
  }catch{
   message.focus();message.select();
   feedback.textContent='Texto selecionado. Use Ctrl+C ou a opção Copiar do seu dispositivo.';
  }
 };
 message.addEventListener('input',()=>{feedback.textContent='';});
 const footer=node('div',undefined,'message-footer');footer.append(copy,feedback);
 content.replaceChildren(title,instructions,label,message,footer);
 dialog.showModal();
}


function distribution(){
 const box=surface('distribution');box.id='tipos-problemas';const head=node('div',undefined,'panel-heading');head.append(heading('O que está acontecendo'),node('span',incidents.length+' ocorrências','subtext'));box.append(head);
 const grouped=new Map();for(const row of incidents){const key=simple(row.problema);grouped.set(key,(grouped.get(key)??0)+1);}
 const urgent='Firewall não responde ao monitoramento';
 const all=[...grouped].sort((a,b)=>{
  if(a[0]===urgent)return -1;
  if(b[0]===urgent)return 1;
  return b[1]-a[1];
 }),top=all.slice(0,6);if(all.length>6)top.push(['Outros',all.slice(6).reduce((sum,row)=>sum+row[1],0)]);
 const list=node('div',undefined,'distribution-list'),maximum=Math.max(1,...top.map(row=>row[1]));
 for(const [name,count]of top){const item=node('a',undefined,'problem-link');
 item.href='./problema.html?v=13&'+(name==='Outros'
  ? 'grupo=outros&excluir='+encodeURIComponent(JSON.stringify(all.slice(0,6).map(row=>row[0])))
  : 'problema='+encodeURIComponent(name));
 item.setAttribute('aria-label',name+' · '+count+' ocorrências');
 const label=node('div',undefined,'distribution-line');label.append(node('span',name),node('strong',count));const track=node('div',undefined,'bar-track'),bar=node('div',undefined,'bar-fill');bar.style.width=count/maximum*100+'%';if(name.includes('Firewall'))bar.style.background='var(--medium)';track.append(bar);item.append(label,track);
 const line=node('div',undefined,'problem-action-row'),generate=node('button','Gerar lista','quiet generate-list');
 generate.type='button';generate.setAttribute('aria-label','Gerar lista de '+name);
 generate.onclick=()=>{
  const excluded=all.slice(0,6).map(row=>row[0]);
  const rows=rowsFor().filter(row=>name==='Outros'?!excluded.includes(simple(row.problema)):simple(row.problema)===name);
  showProblemList(name,rows);
 };
 line.append(item,generate);list.append(line);}
 box.append(list);return box;
}
function brandPanel(){
 const box=surface('brand-panel');box.id='lojas';box.append(heading('Lojas afetadas por marca'));
 const brands=new Map();for(const row of incidents){const name=brand(row);if(!brands.has(name))brands.set(name,new Set());brands.get(name).add(row.host||row.loja);}
 const grid=node('div',undefined,'brand-grid');grid.style.marginTop='14px';
 for(const [name,stores]of [...brands].sort((a,b)=>b[1].size-a[1].size)){const chip=node('a',undefined,'brand-chip brand-link');
 chip.href='./marca.html?marca='+encodeURIComponent(name)+'&v=11';
 chip.setAttribute('aria-label',name+' · '+stores.size+' lojas afetadas');
 const logoBox=node('span',undefined,'brand-logo-box');
 if(brandLogos.has(name)){
  const logo=node('img');logo.src='./assets/marcas/'+brandLogos.get(name)+'?v=12';logo.alt=name;
  logo.loading='lazy';logo.className='brand-logo';logoBox.append(logo);
 }else logoBox.append(node('span',name,'brand-text'));
 const caption=node('span',undefined,'brand-caption');caption.append(node('span',name),node('strong',stores.size));
 chip.append(logoBox,caption);grid.append(chip);}
 box.append(grid);return box;
}
function oldestPanel(){
 const box=surface('oldest-panel'),head=node('div',undefined,'panel-heading');head.append(heading('Casos mais antigos sem solução'));const all=node('a','Ver todos');all.href='#ocorrencias';head.append(all);box.append(head);
 for(const row of rowsFor().slice(0,5)){
  const item=node('div',undefined,'oldest-row'),copy=node('div',undefined,'oldest-copy'),name=node('strong',storeName(row));name.append(node('small',row.host));
  const problem=node('p',simple(row.problema));problem.title=row.problema;copy.append(name,problem);item.append(node('span',age(row),'age-tag'),copy,badge(severity(row)));box.append(item);
 }return box;
}
function searchControl(label,placeholder,callback){
 const box=node('div',undefined,'search'),input=node('input');const id='search-stores';input.id=id;input.type='search';input.value=query;input.placeholder=placeholder;
 const caption=node('label',label);caption.htmlFor=id;input.oninput=()=>{query=input.value;callback();};box.append(caption,input);return box;
}
function tablePanel(brandFilter,problemFilter){
 const source=rowsFor().filter(row=>(!brandFilter||brand(row)===brandFilter)&&(!problemFilter||problemFilter(row)));
 const box=surface('table-panel');box.id='ocorrencias';const toolbar=node('div',undefined,'table-toolbar'),title=node('div',undefined,'table-title');title.append(heading('Ocorrências abertas'));const tabs=node('div',undefined,'filter-tabs');title.append(tabs);
 const table=node('table'),thead=table.createTHead().insertRow();for(const label of ['Severidade','Loja','Problema','Aberto há','Início'])thead.append(node('th',label));
 const body=table.createTBody(),scroll=node('div',undefined,'table-scroll');scroll.append(table);const footer=node('div',undefined,'table-footer'),count=node('span'),more=node('button','Carregar mais','text-button');more.onclick=()=>{limit+=10;update();};footer.append(count,more);
 function update(){
  tabs.replaceChildren();for(const [key,label,amount]of [['all','Todas',source.length],...categories.map(cat=>[cat.key,cat.short,source.filter(row=>severity(row)?.id===cat.id).length])]){
   const tab=node('button',label+' · '+amount,selected===key?'selected':'');tab.onclick=()=>{selected=key;limit=10;update();};tabs.append(tab);
  }
  const term=query.trim().toLowerCase();const rows=source.filter(row=>(selected==='all'||severity(row)?.key===selected)&&(!term||[row.loja,row.host,row.problema,simple(row.problema)].some(value=>value.toLowerCase().includes(term))));
  body.replaceChildren();for(const row of rows.slice(0,limit)){const tr=body.insertRow(),cat=severity(row),cell=colored(tr.insertCell(),cat);cell.className='severity-cell';cell.append(node('span',undefined,'dot'),node('span',cat?.short??'Outra'));
   const name=tr.insertCell();name.append(node('strong',storeName(row)),node('small',row.host+' · '+brand(row)));
   const problem=tr.insertCell();problem.textContent=simple(row.problema);problem.title=row.problema;
   const duration=tr.insertCell();duration.className='mono';duration.textContent=age(row);
   const start=tr.insertCell();start.className='mono';start.textContent=started(row);const t=timestamp(row.horario);start.title=Number.isFinite(t)?fullDates.format(t):'Início indisponível';
  }
  count.textContent='Mostrando '+Math.min(limit,rows.length)+' de '+rows.length;more.hidden=limit>=rows.length;
 }
 toolbar.append(title,searchControl('Buscar loja, código ou problema','Ex.: SOM078, Iguatemi, link 2',()=>{limit=10;update();}));
 box.append(toolbar,scroll,footer);update();return box;
}
function showStore(row){
 const dialog=document.querySelector('#loja-dialog'),content=document.querySelector('#loja-conteudo');content.replaceChildren(heading(storeName(row)),node('p',row.host+' · '+brand(row)));
 for(const item of incidents.filter(item=>item.host===row.host)){const part=node('div',undefined,'dialog-case');part.append(badge(severity(item)),node('p',simple(item.problema)),node('small','Início: '+(Number.isFinite(timestamp(item.horario))?fullDates.format(timestamp(item.horario)):'—')));content.append(part);}
 dialog.showModal();
}
function detailStores(){
 const box=surface('stores-panel'),toolbar=node('div',undefined,'table-toolbar'),title=node('div',undefined,'heading-group');title.append(heading('Lojas nesta prioridade'),node('span','ordenadas pelo tempo em aberto','subtext'));
 const list=node('div'),feedback=node('p',undefined,'subtext');feedback.setAttribute('role','status');
 function update(){
  const term=query.toLowerCase().trim(),all=rowsFor(category);const rows=all.filter(row=>!term||[row.loja,row.host,row.problema,simple(row.problema)].some(value=>value.toLowerCase().includes(term)));
  list.replaceChildren();
  for(const row of rows){const item=colored(node('div',undefined,'store-row'),category),name=node('div',undefined,'store-name');name.append(node('strong',storeName(row)),node('small',row.host+' · '+brand(row)+' · desde '+started(row)));
   const problem=node('p',simple(row.problema),'store-problem');problem.title=row.problema;
   const elapsed=age(row).replace(/\bd$/,'dias').replace(/\bh$/,'horas').replace(/\bmin$/,'minutos');
   const actions=node('div',undefined,'store-buttons'),copy=node('button','Copiar dados','quiet'),view=node('button','Ver loja','quiet');
   copy.onclick=async()=>{try{await navigator.clipboard.writeText([storeName(row),row.host,simple(row.problema),'Início: '+started(row)].join('\n'));feedback.textContent='Dados da loja copiados.';}catch{feedback.textContent='Não foi possível copiar. Abra Ver loja para consultar os dados.';}};
   view.onclick=()=>showStore(row);actions.append(copy,view);item.append(name,problem,node('span',elapsed,'store-duration'),actions);list.append(item);
  }
  if(!rows.length)list.append(node('p','Nenhuma ocorrência encontrada.','empty'));
 }
 toolbar.append(title,searchControl('Filtrar','Loja ou código',update));box.append(toolbar,list,feedback);update();return box;
}
function render(){
 const focused=document.activeElement?.id,selection=document.activeElement?.selectionStart;
 for(const chart of charts)chart.destroy();charts=[];
 const content=document.querySelector('#conteudo');content.replaceChildren();
 const subtitle=document.querySelector('#subtitulo'),title=document.querySelector('h1');
 const stores=new Set(incidents.map(row=>row.host||row.loja)).size;
 if(brandPage||problemPage){
  const valid=problemPage
   ? isOtherProblem||(requestedProblem.length>0&&requestedProblem.length<=500)
   : brandLogos.has(requestedBrand)||requestedBrand==='OUTRAS';
  title.textContent=problemPage ? (valid?(isOtherProblem?'Outros problemas':requestedProblem):'Problema não encontrado') : (valid?'Casos da marca '+requestedBrand:'Marca não encontrada');
  if(!valid){subtitle.textContent='Selecione um item pela visão geral.';return;}
  const rows=rowsFor().filter(row=>problemPage?matchesProblem(row):brand(row)===requestedBrand);
  subtitle.textContent=new Set(rows.map(row=>row.host||row.loja)).size+' lojas afetadas · '+rows.length+' ocorrências abertas';
  let back=document.querySelector('.back');
  if(!back){back=node('a','‹ Visão geral','back');back.href=problemPage?'./?v=13#tipos-problemas':'./?v=13#lojas';document.querySelector('.page-heading').before(back);}
  const summary=node('div',undefined,'brand-summary');
  for(const [label,value]of [['Ocorrências abertas',rows.length],['Lojas afetadas',new Set(rows.map(row=>row.host||row.loja)).size],['Caso mais antigo',rows.length?age(rows[0]):'—']]){
    const card=surface('detail-kpi');card.append(node('p',label),node('strong',value));summary.append(card);
  }
  content.append(summary,tablePanel(problemPage?undefined:requestedBrand,problemPage?matchesProblem:undefined));
 }else if(detail){
  if(!category){title.textContent='Prioridade indisponível';return;}
  title.textContent=category.title;subtitle.textContent='Ocorrências abertas nas lojas desta prioridade';
  let back=document.querySelector('.back');if(!back){back=node('a','‹ Visão geral','back');back.href='./?from='+period+'&v=9';document.querySelector('.page-heading').before(back);}
  const titleBox=title.parentElement;if(!titleBox.parentElement.classList.contains('detail-title')){const wrapper=colored(node('div',undefined,'detail-title'),category);titleBox.before(wrapper);wrapper.append(node('span','⚠','detail-icon'),titleBox);}
  const rows=rowsFor(category),top=node('div',undefined,'detail-top'),kpis=node('div',undefined,'detail-kpis');
  const counts=[['Ocorrências agora',panelValue(category)??rows.length],['Lojas afetadas',new Set(rows.map(row=>row.host||row.loja)).size],['Mais antiga',rows.length?age(rows[0]):'—'],['Mais recente',rows.length?age(rows.at(-1)):'—']];
  counts.forEach(([label,value],index)=>{const kpi=surface('detail-kpi');const metric=node('strong',value);if(index===2)metric.style.color=category.color;kpi.append(node('p',label),metric);if(index>=2&&rows.length)kpi.append(node('small',storeName(index===2?rows[0]:rows.at(-1))));kpis.append(kpi);});
  top.append(kpis,chartPanel(category));content.append(top,detailStores());
 }else{
  title.textContent='Saúde da rede das lojas';subtitle.textContent=stores+' lojas com ocorrência · '+incidents.length+' ocorrências abertas · Firewalls monitorados via Grafana';
  const chartsRow=node('div',undefined,'chart-layout');chartsRow.append(chartPanel(),distribution());
  const support=node('div',undefined,'support-layout');support.append(brandPanel(),oldestPanel());content.append(statCards(),chartsRow,support,tablePanel());
  const links=node('div');links.id='links';content.append(links);
 }
 if(focused==='search-stores'){const input=document.querySelector('#search-stores');input?.focus();input?.setSelectionRange(selection,selection);}
}
async function refresh(){
 clearTimeout(timer);activeRequest?.abort();const controller=new AbortController();activeRequest=controller;
 try{
  const options={headers:{Authorization:'Bearer '+sessionStorage.getItem(sessionKey)},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(45000)])};
  const [summary,problems]=await Promise.all([api('/api/resumo?from='+period+'&to=now',options),api('/api/problemas',options)]);
  if(controller.signal.aborted)return;panels=summary.paineis;incidents=problems.ocorrencias;updated=Date.parse(summary.atualizadoEm);status.textContent='';render();
 }catch(error){if(!controller.signal.aborted)status.textContent=error.message==='Failed to fetch'?'Não foi possível atualizar. Exibindo os últimos dados.':error.message;}
 finally{if(!controller.signal.aborted)timer=setTimeout(refresh,REFRESH_SECONDS*1000);}
}
if(!login){
 if(!sessionStorage.getItem(sessionKey))out();
 else{
  if(brandPage||problemPage)document.querySelector('#periods').hidden=true;else periodControls();document.querySelector('#sair').onclick=out;
  document.querySelector('#conta').onclick=event=>{const button=document.querySelector('#sair');button.hidden=!button.hidden;event.currentTarget.setAttribute('aria-expanded',String(!button.hidden));};
  const theme=document.querySelector('#tema');theme.setAttribute('aria-label','Tema escuro do centro de operações');theme.title='Tema escuro';theme.disabled=true;
  document.querySelector('#tv').onclick=async()=>{const panel=document.querySelector('#painel');try{if(document.fullscreenElement)await document.exitFullscreen();else await panel.requestFullscreen();}catch{status.textContent='Tela cheia indisponível neste navegador.';}};
  document.addEventListener('fullscreenchange',()=>document.querySelector('#painel').classList.toggle('tv',!!document.fullscreenElement));
  document.querySelector('.nav a[href$="#links"]').onclick=event=>{
    event.preventDefault();
    const content=document.querySelector('#loja-conteudo');content.replaceChildren(heading('Links do monitoramento'));
    for(const [label,url]of [['Visão geral','./?v=9'],['Lojas e ocorrências','./?v=9#ocorrencias'],['Histórico dos problemas','./?v=9#historico']]){
      const link=node('a',label,'dialog-case');link.href=url;link.style.display='block';content.append(link);
    }
    document.querySelector('#loja-dialog').showModal();
  };
  document.querySelector('#fechar-dialog').onclick=()=>document.querySelector('#loja-dialog').close();
  setInterval(()=>{document.querySelector('#live').textContent=updated?'Ao vivo · há '+Math.max(0,Math.floor((Date.now()-updated)/1000))+' s':'Conectando…';},1000);
  refresh();
 }
}







