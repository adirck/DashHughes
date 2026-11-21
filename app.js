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
   sessionStorage.setItem(sessionKey,data.token);location.replace('./?v=23');
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
const brandPalette=new Map([
 ['FARM',{label:'FARM',color:'#F472B6'}],
 ['FOXTON',{label:'Foxton',color:'#3B82F6'}],
 ['FABULA',{label:'Fábula',color:'#FACC15'}],
 ['NV',{label:'BYNV',color:'#D4AF37'}],
 ['MARIA FILÓ',{label:'Maria Filó',color:'#C0C0C0'}],
 ['CRIS BARROS',{label:'Cris Barros',color:'#5B217A'}],
 ['ANIMALE',{label:'Animale',color:'#8B5E3C'}],
 ['OFF PREMIUM',{label:'Off Premium',color:'#F97316'}],
 ['CAROL BASSI',{label:'Carol Bassi',color:'#22C55E'}],
 ['OUTRAS',{label:'Outras',color:'#64748B'}],
]);
function brandSlices(rows){
 const counts=new Map();
 for(const row of rows){const name=brand(row);counts.set(name,(counts.get(name)??0)+1);}
 return [...brandPalette].filter(([name])=>counts.has(name))
  .map(([name,palette])=>({...palette,count:counts.get(name)}));
}
function drawBrandPie(canvas,slices,unit='ocorrência',plural='ocorrências'){
 if(!window.Chart||!canvas.isConnected)return;
 const chart=new window.Chart(canvas,{
  type:'pie',
  data:{labels:slices.map(slice=>slice.label),datasets:[{
   data:slices.map(slice=>slice.count),
   backgroundColor:slices.map(slice=>slice.color),
   borderColor:'#101923',borderWidth:1.5,
  }]},
  options:{responsive:true,maintainAspectRatio:false,animation:false,
   plugins:{legend:{display:false},tooltip:{callbacks:{
    label:item=>item.label+': '+item.parsed+' '+(item.parsed===1?unit:plural),
   }}},
  },
 });
 charts.push(chart);
}

function statCards(){
 const grid=node('div',undefined,'stats-grid');grid.id='alertas';
 for(const cat of categories){
  const rows=rowsFor(cat),slices=brandSlices(rows),total=rows.length;
  const card=colored(node('a',undefined,'stat-card'),cat);
  card.href='./detalhe.html?id='+cat.id+'&from='+period+'&v=23';
  card.setAttribute('aria-label',cat.title+' · '+total+' ocorrências');
  const label=node('div',undefined,'stat-label');label.append(node('span',undefined,'dot'),node('span',cat.short));
  const metric=node('div',undefined,'stat-value'+(total===0?' zero':''));
  metric.append(node('strong',format.format(total)));
  const graph=node('div',undefined,'brand-pie-wrap');
  if(slices.length&&window.Chart){
   const canvas=node('canvas');
   canvas.setAttribute('role','img');
   canvas.setAttribute('aria-label','Ocorrências de '+cat.short+' por marca: '+slices.map(slice=>slice.label+' '+slice.count).join(', '));
   graph.append(canvas);queueMicrotask(()=>drawBrandPie(canvas,slices));
  }else{
   graph.append(node('span',total===0?'Sem ocorrências':'Por marca','brand-pie-empty'));
  }
  metric.append(graph);
  const caption=rows.length?'Mais antigo aberto há '+age(rows[0]):'Nenhum caso aberto';
  card.append(label,metric,node('p',caption,'stat-caption'));
  if(slices.length){
   const legend=node('ul',undefined,'brand-pie-legend');
   legend.setAttribute('aria-label','Legenda das marcas');
   for(const slice of slices){
    const item=node('li'),swatch=node('span',undefined,'brand-pie-swatch');swatch.style.backgroundColor=slice.color;
    item.append(swatch,node('span',slice.label+' · '+slice.count));legend.append(item);
   }
   card.append(legend);
  }
  grid.append(card);
 }return grid;
}

function showProblemList(name,rows,groups){
 const dialog=document.querySelector('#loja-dialog'),content=document.querySelector('#loja-conteudo');
 const title=heading('Lista para a Hughes — '+name);
 title.id='titulo-lista-hughes';
 dialog.setAttribute('aria-labelledby',title.id);
 const instructions=node('p','Você pode ajustar a mensagem antes de copiar.','subtext');
 const label=node('label','Mensagem para copiar','message-label');
 label.htmlFor='mensagem-hughes';
 const message=node('textarea',undefined,'hughes-message');
 message.id='mensagem-hughes';message.rows=14;message.spellcheck=false;
 const entry=(row,index)=>[
  (index+1)+'. Loja: '+storeName(row),
  'Código: '+(row.host||'Não informado'),
  'Problema: '+simple(row.problema),
  'Início do problema: '+(Number.isFinite(timestamp(row.horario)) ? new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short'}).format(timestamp(row.horario)) : 'Não informado'),
 ].join('\n');
 const entries=groups
  ? groups.map(group=>group.name+' — '+group.rows.length+(group.rows.length===1?' ocorrência':' ocorrências')+'\n'+group.rows.map(entry).join('\n\n'))
  : rows.map(entry);
 message.value=[
  'Olá, equipe Hughes.',
  '',
  'Solicitamos a análise das ocorrências abaixo e o apoio para restabelecer o funcionamento das lojas afetadas.',
  'Ocorrência: '+name,
  'Data do levantamento: '+fullDates.format(Date.now())+' (horário de Brasília).',
  'Total: '+rows.length+(rows.length===1?' ocorrência.':' ocorrências.'),
  '',
  entries.join('\n\n'),
  '',
  'Por favor, confirmem o recebimento e informem o número do chamado, o diagnóstico e a previsão de normalização.',
  '',
  'Obrigado.',
  'Suporte de TI — Lojas',
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
 item.href='./problema.html?v=23&'+(name==='Outros'
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
 const report=node('button','Gerar relatório total','primary total-report');
 report.type='button';
 report.onclick=()=>{
  const excluded=all.slice(0,6).map(row=>row[0]);
  const groups=top.map(([name])=>({
   name,rows:rowsFor().filter(row=>name==='Outros'?!excluded.includes(simple(row.problema)):simple(row.problema)===name),
  })).filter(group=>group.rows.length);
  showProblemList('Relatório consolidado de todos os problemas',rowsFor(),groups);
 };
 report.disabled=incidents.length===0;
 box.append(list,report);return box;
}
function brandPanel(){
 const box=surface('brand-panel');box.id='lojas';box.append(heading('Lojas afetadas por marca'));
 const brands=new Map();for(const row of incidents){const name=brand(row);if(!brands.has(name))brands.set(name,new Set());brands.get(name).add(row.host||row.loja);}
 const grid=node('div',undefined,'brand-grid');grid.style.marginTop='14px';
 for(const [name,stores]of [...brands].sort((a,b)=>b[1].size-a[1].size)){const chip=node('a',undefined,'brand-chip brand-link');
 chip.href='./marca.html?marca='+encodeURIComponent(name)+'&v=23';
 chip.setAttribute('aria-label',name+' · '+stores.size+' lojas afetadas');
 const logoBox=node('span',undefined,'brand-logo-box');
 if(brandLogos.has(name)){
  const logo=node('img');logo.src='./assets/marcas/'+brandLogos.get(name)+'?v=23';logo.alt=name;
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
  name.append(warning(row));const problem=node('p',simple(row.problema));problem.title=row.problema;copy.append(name,problem);item.append(node('span',age(row),'age-tag'),copy,badge(severity(row)));box.append(item);
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
   name.append(warning(row));const actions=trackingActions(row);name.append(actions);const problem=tr.insertCell();problem.textContent=simple(row.problema);problem.title=row.problema;
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
   view.onclick=()=>showStore(row);actions.append(copy,view,...trackingActions(row).children);name.append(warning(row));item.append(name,problem,node('span',elapsed,'store-duration'),actions);list.append(item);
  }
  if(!rows.length)list.append(node('p','Nenhuma ocorrência encontrada.','empty'));
 }
 toolbar.append(title,searchControl('Filtrar','Loja ou código',update));box.append(toolbar,list,feedback);update();return box;
}
// Chamados ficam no serviço compartilhado; nenhum dado operacional é salvo no repositório.
let tracking=null,reportPeriod='30',reportQuery='',logFilter='all',logQuery='';
const trackingPage=params.get('tela');
const authOptions=()=>({headers:{Authorization:'Bearer '+sessionStorage.getItem(sessionKey)}});
function eventFor(row){return tracking?.eventos.find(event=>event.id===row.id);}
function ticketsFor(row){return tracking?.chamados.filter(ticket=>ticket.evento===row.id)??[];}
function overdue(row){return !eventFor(row)?.fim?ticketsFor(row).filter(ticket=>ticket.prazo<Date.now()):[];}
function warning(row){
 const count=overdue(row).length;if(!count)return node('span');
 const button=node('button','⚠ '+count,'overdue-marker');button.title=count+' previsões vencidas para este problema';button.setAttribute('aria-label',button.title);button.onclick=()=>showStoreLog(row);return button;
}
function modal(title){const dialog=document.querySelector('#loja-dialog'),content=document.querySelector('#loja-conteudo');content.replaceChildren(heading(title));if(!dialog.open)dialog.showModal();return content;}
function showForecast(row){
 const content=modal('Previsão para solução');content.append(node('p',storeName(row)+' · '+row.host),node('p',simple(row.problema)));
 const form=node('form',undefined,'forecast-form'),feedback=node('p',undefined,'status-message');feedback.setAttribute('role','status');
 const controls={};
 for(const [key,label,type,max]of [['previsao','Previsão informada pela Hughes','date'],['numero','Número do chamado','text',100],['analista','Analista Hughes','text',120],['observacoes','Informações adicionais (opcional)','textarea',500]]){
  const wrap=node('label',label),input=node(type==='textarea'?'textarea':'input');input.name=key;input.id='previsao-'+key;
  if(type!=='textarea')input.type=type;if(max)input.maxLength=max;input.required=key!=='observacoes';if(type==='date'){const date=new Date(Date.now()-3*3600000).toISOString().slice(0,10);input.min=date;}wrap.append(input);controls[key]=input;form.append(wrap);
 }
 form.append(node('small','A previsão vale até o fim do dia escolhido, no horário de Brasília. O registro será adicionado ao histórico, sem substituir os anteriores.'));
 const save=node('button','Salvar previsão','quiet primary-action');save.type='submit';save.disabled=!tracking;form.append(save,feedback);content.append(form);
 // Uma tentativa repetida do mesmo envio não cria dois chamados.
 const id=crypto.randomUUID();
 form.onsubmit=async event=>{event.preventDefault();save.disabled=true;feedback.textContent='Salvando…';
  try{await api('/api/chamados',{...authOptions(),method:'POST',headers:{...authOptions().headers,'Content-Type':'application/json'},body:JSON.stringify({id,evento:row.id,...Object.fromEntries(Object.entries(controls).map(([key,input])=>[key,input.value]))})});
   tracking=await api('/api/acompanhamento',authOptions());render();showStoreLog(row);
  }catch(error){feedback.textContent=error.message;save.disabled=false;}
 };
}
function ticketState(ticket,event){return event?.fim?(event.fim>ticket.prazo?'Encerrado após a previsão':'Encerrado no monitoramento'):(ticket.prazo<Date.now()?'Previsão vencida · problema ainda aberto':'Aguardando previsão');}
function logEntries(content,events){
 const ids=new Set(events.map(event=>event.id)),tickets=(tracking?.chamados??[]).filter(ticket=>ids.has(ticket.evento));
 if(!tickets.length){content.append(node('p','Nenhum chamado registrado para esta loja.','empty'));return;}
 for(const ticket of tickets){const event=events.find(event=>event.id===ticket.evento),item=node('article',undefined,'ticket-entry');
  item.append(node('strong','Chamado '+ticket.numero+' · '+ticket.analista),node('p',simple(event.problema)),node('p','Registrado em '+fullDates.format(ticket.abertura)),node('p','Início do problema: '+(event.inicio?fullDates.format(event.inicio):'indisponível')),node('p','Previsão: '+ticket.previsao.split('-').reverse().join('/')),node('strong',ticketState(ticket,event),!event.fim&&ticket.prazo<Date.now()?'late-text':'subtext'));
  if(event.fim)item.append(node('p','Saída da lista observada em '+fullDates.format(event.fim)));if(ticket.observacoes)item.append(node('p',ticket.observacoes));content.append(item);
 }
}
function showStoreLog(row){const content=modal('Log Loja · '+storeName(row));content.append(node('p',row.host));const events=tracking?.eventos.filter(event=>(event.host||event.loja)===(row.host||row.loja))??[];logEntries(content,events);}
function trackingActions(row){const actions=node('div',undefined,'tracking-actions'),forecast=node('button','Previsão para solução','quiet'),log=node('button','Log Loja','quiet');forecast.disabled=!tracking||!row.id;forecast.onclick=()=>showForecast(row);log.onclick=()=>showStoreLog(row);actions.append(forecast,log);return actions;}
function smallPie(title,slices,unit='ocorrência',plural='ocorrências'){
 const box=node('div',undefined,'tracking-pie');box.append(node('h3',title));
 if(slices.length){const wrap=node('div',undefined,'brand-pie-wrap'),canvas=node('canvas');canvas.setAttribute('role','img');canvas.setAttribute('aria-label',title+': '+slices.map(s=>s.label+' '+s.count).join(', '));wrap.append(canvas);box.append(wrap);queueMicrotask(()=>drawBrandPie(canvas,slices,unit,plural));const legend=node('ul',undefined,'compact-legend');for(const slice of slices){const li=node('li'),dot=node('span',undefined,'legend-dot');dot.style.backgroundColor=slice.color;li.append(dot,node('span',slice.label+' · '+slice.count));legend.append(li);}box.append(legend);}else box.append(node('p','Nenhum caso.','empty'));return box;
}
function lateCases(){return tracking?.eventos.filter(event=>!event.fim&&overdue(event).length)??[];}
function logCard(){
 const box=surface('tracking-card');box.append(heading('Acompanhamento de chamados'));const rows=lateCases();box.append(node('p',tracking?rows.length+' problemas com previsão vencida':'Carregando histórico compartilhado…','subtext'));
 const pies=node('div',undefined,'tracking-pies');const buckets=[{label:'Mais de um mês',color:'#ef4444',count:0},{label:'Mais de duas semanas até um mês',color:'#f97316',count:0},{label:'Mais de uma semana até duas',color:'#facc15',count:0},{label:'Mais de um dia até uma semana',color:'#3b82f6',count:0},{label:'Até um dia',color:'#94a3b8',count:0}];
 for(const row of rows){const days=(Date.now()-Math.min(...overdue(row).map(ticket=>ticket.prazo)))/86400000;buckets[days>30?0:days>14?1:days>7?2:days>1?3:4].count++;}
 pies.append(smallPie('Casos por marca',brandSlices(rows)),smallPie('Tempo desde a primeira previsão vencida',buckets.filter(b=>b.count)));box.append(pies);const link=node('a','Abrir log de chamados →','quiet card-link');link.href='./?tela=logs&v=23';box.append(link);return box;
}
function reportCard(){const box=surface('incident-report-card'),link=node('a',undefined,'card-link');link.href='./?tela=relatorio&v=23';link.append(heading('Relatório geral de incidentes'),node('p','Quedas de Link 1 e Link 2 com mais de 24 horas · frequência e dias offline · últimos três meses','subtext'));box.append(link);return box;}
function renderLogs(content){
 document.querySelector('h1').textContent='Log de chamados';document.querySelector('#subtitulo').textContent='Histórico de previsões, analistas e chamados Hughes. Registros anteriores permanecem disponíveis.';
 const box=surface('log-page'),controls=node('div',undefined,'log-filters'),search=node('input'),select=node('select');search.type='search';search.placeholder='Buscar loja, código, chamado ou analista';search.setAttribute('aria-label','Buscar no log');
 for(const [value,label]of [['all','Todos os registros'],['late','Previsões vencidas'],['open','Problemas abertos'],['closed','Problemas encerrados']]){const option=node('option',label);option.value=value;select.append(option);}select.setAttribute('aria-label','Situação do chamado');select.value=logFilter;search.value=logQuery;
 const list=node('div');function update(){list.replaceChildren();const term=search.value.toLowerCase();const events=(tracking?.eventos??[]).filter(event=>ticketsFor(event).length&&(select.value==='all'||select.value==='late'&&overdue(event).length||select.value==='open'&&!event.fim||select.value==='closed'&&event.fim)&&[event.loja,event.host,...ticketsFor(event).flatMap(ticket=>[ticket.numero,ticket.analista])].some(value=>value?.toLowerCase().includes(term)));
  for(const event of events){const part=node('section',undefined,'log-case'),name=heading(storeName(event));name.append(warning(event));part.append(name,node('p',event.host+' · '+brand(event)));logEntries(part,[event]);list.append(part);}if(!events.length)list.append(node('p','Nenhum registro para este filtro.','empty'));
 }search.oninput=()=>{logQuery=search.value;update();};select.onchange=()=>{logFilter=select.value;update();};controls.append(search,select);box.append(controls,list);content.append(box);update();
}
// Os intervalos de queda são unidos por loja/link para não contar o mesmo tempo duas vezes.
function reportRows(days,now=Date.now()){
 const cutoff=new Date(now);cutoff.setUTCMonth(cutoff.getUTCMonth()-3);const start=Math.max(now-days*86400000,cutoff.getTime()),groups=new Map();
 for(const event of tracking?.eventos??[]){const end=event.fim??now;if(!event.link||!event.inicio||end-event.inicio<=86400000||end<=start||event.inicio>=now)continue;
  const key=(event.host||event.loja)+'|'+event.link;if(!groups.has(key))groups.set(key,{...event,count:0,intervals:[],open:false});const group=groups.get(key);group.count++;group.open||=!event.fim;group.intervals.push([Math.max(start,event.inicio),Math.min(end,now)]);
 }
 return [...groups.values()].map(group=>{const intervals=group.intervals.sort((a,b)=>a[0]-b[0]);let sum=0,last=null;for(const span of intervals){if(last&&span[0]<=last[1])last[1]=Math.max(last[1],span[1]);else{if(last)sum+=last[1]-last[0];last=[...span];}}if(last)sum+=last[1]-last[0];return {...group,days:sum/86400000};}).sort((a,b)=>b.days-a.days||b.count-a.count);
}
function offlineDuration(days){const hours=Math.floor(days*24);return Math.floor(hours/24)+' dias e '+hours%24+' horas';}
function reportMessage(title,text){
 const content=modal(title),area=node('textarea',undefined,'hughes-message');area.id='mensagem-hughes';area.value=text;area.rows=18;area.setAttribute('aria-label','Mensagem do relatório, editável');const footer=node('div',undefined,'message-footer'),copy=node('button','Copiar mensagem','quiet'),feedback=node('span',undefined,'subtext');feedback.setAttribute('role','status');copy.onclick=async()=>{try{await navigator.clipboard.writeText(area.value);feedback.textContent='Mensagem copiada.';}catch{area.focus();area.select();feedback.textContent='Selecione e copie o texto.';}};footer.append(copy,feedback);content.append(area,footer);
}
function storeIncidentMessage(row,days,replacement=false){
 const now=Date.now(),rows=reportRows(days,now).filter(item=>(item.host||item.loja)===(row.host||row.loja)),target=rows.find(item=>item.link===row.link);
 const coverage=tracking?.inicioColeta?fullDates.format(tracking.inicioColeta):'indisponível';
 const common=['Loja: '+storeName(row),'Código: '+row.host,'Período: últimos '+(days===92?'três meses':days+' dias'), 'Levantamento: '+fullDates.format(now)+' (horário de Brasília).'];
 const note='Contagem de quedas superiores a 24 horas que afetaram o período. Tempo offline somado dentro do período. Histórico disponível desde '+coverage+'; quedas encerradas antes da coleta não estão incluídas. Encerramentos são observados nas consultas ao monitoramento.';
 if(replacement&&target){reportMessage('Solicitar troca de Link '+row.link,['Olá, equipe Hughes.','','Solicitamos a substituição do Link '+row.link+' da loja abaixo, devido às quedas e ao tempo acumulado de indisponibilidade.',...common,'','Link: '+row.link,'Quedas registradas com mais de 24 horas: '+target.count,'Tempo total indisponível: '+offlineDuration(target.days), 'Situação: '+(target.open?'há uma queda em aberto.':'quedas encerradas no monitoramento.'),'','Pedimos a análise do histórico e o retorno com a alternativa de substituição, número do chamado e previsão de atendimento.','',note,'','Suporte T.I. — Lojas'].join('\n'));return;}
 const cutoff=new Date(now);cutoff.setUTCMonth(cutoff.getUTCMonth()-3);const start=Math.max(now-days*86400000,cutoff.getTime());
 const details=[];for(const link of rows){details.push('LINK '+link.link+' — '+link.count+' quedas superiores a 24 horas','Tempo total offline no período: '+offlineDuration(link.days));const events=tracking.eventos.filter(event=>(event.host||event.loja)===(row.host||row.loja)&&event.link===link.link&&event.inicio&&(event.fim??now)-event.inicio>86400000&&(event.fim??now)>start&&event.inicio<now).sort((a,b)=>a.inicio-b.inicio);
  events.forEach((event,index)=>{details.push((index+1)+'. '+simple(event.problema),'Início: '+fullDates.format(event.inicio),'Fim: '+(event.fim?fullDates.format(event.fim):'ainda em aberto'),'Indisponibilidade no período: '+offlineDuration((Math.min(event.fim??now,now)-Math.max(event.inicio,start))/86400000));const tickets=ticketsFor(event);for(const ticket of tickets)details.push('Chamado '+ticket.numero+' · analista '+ticket.analista+' · registrado '+fullDates.format(ticket.abertura)+' · previsão '+ticket.previsao.split('-').reverse().join('/')+(ticket.observacoes?' · '+ticket.observacoes:''));details.push('');});}
 reportMessage('Relatório total · '+storeName(row),['Olá, equipe Hughes.','','Segue o relatório de indisponibilidade dos links desta loja.',...common,'',...details,note,'','Solicitamos a avaliação dos casos e as medidas para estabilizar a conexão.','','Suporte T.I. — Lojas'].join('\n'));
}

function renderIncidentReport(content){
 document.querySelector('h1').textContent='Relatório geral de incidentes';document.querySelector('#subtitulo').textContent='Links com quedas superiores a 24 horas. Cada queda é contada uma vez por período; o tempo offline continua aumentando enquanto estiver aberta.';
 const box=surface('report-page'),filters=node('div',undefined,'log-filters'),select=node('select'),search=node('input');for(const [value,label]of [[30,'Último mês (30 dias)'],[7,'Última semana'],[1,'Último dia'],[92,'Últimos três meses']]){const option=node('option',label);option.value=value;select.append(option);}select.setAttribute('aria-label','Período do relatório');search.type='search';search.placeholder='Buscar loja ou código';search.setAttribute('aria-label','Buscar loja no relatório');select.value=reportPeriod;search.value=reportQuery;
 const notice=node('p',undefined,'history-notice');notice.textContent=tracking?.inicioColeta?'Histórico coletado desde '+fullDates.format(tracking.inicioColeta)+'. Inclui os alarmes já abertos nessa data; quedas encerradas antes da coleta não estão disponíveis. Atualização automática a cada 5 minutos. O encerramento é o horário em que a saída da lista foi observada.':'O histórico ainda está sendo iniciado.';
 const summary=node('p',undefined,'subtext'),scroll=node('div',undefined,'table-scroll'),table=node('table'),head=table.createTHead().insertRow();for(const title of ['Loja / código','Link','Quedas > 24 h','Total de dias offline','Situação','Relatórios'])head.append(node('th',title));const body=table.createTBody();scroll.append(table);
 function update(){const term=search.value.toLowerCase(),rows=reportRows(Number(select.value)).filter(row=>(row.loja+' '+row.host).toLowerCase().includes(term));body.replaceChildren();for(const row of rows){const tr=body.insertRow(),name=tr.insertCell();name.append(node('strong',storeName(row)),node('small',row.host+' · '+brand(row)));for(const value of ['Link '+row.link,row.count,format.format(row.days)+' dias',row.open?'Em aberto':'Encerrado'])tr.insertCell().textContent=value;const actions=tr.insertCell(),buttons=node('div',undefined,'tracking-actions'),total=node('button','Gerar relatório total','quiet'),replace=node('button','Solicitar troca de link','quiet');total.onclick=()=>storeIncidentMessage(row,Number(select.value));replace.onclick=()=>storeIncidentMessage(row,Number(select.value),true);buttons.append(total,replace);actions.append(buttons);}summary.textContent=rows.length+' links · contagem das quedas que afetaram o período selecionado. Dias offline somados somente dentro desse período.';if(!rows.length){const cell=body.insertRow().insertCell();cell.colSpan=6;cell.textContent='Nenhuma queda superior a 24 horas registrada neste período.';}}
 select.onchange=()=>{reportPeriod=select.value;update();};search.oninput=()=>{reportQuery=search.value;update();};filters.append(select,search);box.append(filters,notice,summary,scroll);content.append(box);update();
}

let nightQuery='';
function nightDuration(ms){const minutes=Math.floor(ms/60000);return Math.floor(minutes/60)+' h e '+minutes%60+' min';}
function nightGroups(){const groups=new Map();for(const night of tracking?.noites??[]){const key=night.host||night.loja;if(!groups.has(key))groups.set(key,{...night,nights:[]});groups.get(key).nights.push(night);}return [...groups.values()].sort((a,b)=>b.nights.length-a.nights.length||a.loja.localeCompare(b.loja));}
function nightCard(){const box=surface('incident-report-card'),link=node('a',undefined,'card-link');link.href='./?tela=desligamentos&v=23';link.append(heading('Relatórios desligamentos indevidos'),node('p','FortiGate sem comunicação por mais de 3 horas entre 22h e 10h · ocorrências por loja e marca','subtext'));box.append(link);return box;}
function nightDate(value){return value.split('-').reverse().join('/');}
function nightReport(store){
 const rows=[...store.nights].sort((a,b)=>b.data.localeCompare(a.data));
 const lines=['Olá, gerente da loja '+storeName(store)+'.','','Identificamos períodos prolongados em que o FortiGate da loja ficou sem comunicação durante a madrugada. Pedimos que confira o motivo e oriente a equipe a manter os equipamentos de internet e os computadores ligados após o expediente.','','Loja: '+storeName(store),'Código: '+store.host,'Ocorrências desde 21/11/2026: '+rows.length,''];
 for(const night of rows)lines.push('• Manhã de '+nightDate(night.data)+': '+fullDates.format(night.inicio)+' até '+fullDates.format(night.fim)+' — '+nightDuration(night.duracao)+'.');
 lines.push('','A regra considera mais de três horas contínuas sem comunicação entre 22h e 10h (Brasília), uma ocorrência por loja em cada noite. O monitoramento indica indisponibilidade; ele não confirma que o equipamento foi desligado.','','O desligamento interrompe processos de atualização dos sistemas e das informações da loja realizados de madrugada. Desligamentos abruptos, especialmente durante atualizações, podem comprometer o funcionamento dos equipamentos e a integridade dos dados.','','Caso haja manutenção no shopping ou seja necessário desligar algum equipamento, avise previamente o time de T.I. Lojas para orientarmos o procedimento.','','Agradecemos a colaboração.','Time de T.I. Lojas');
 reportMessage('Relatório para a gerente · '+storeName(store),lines.join('\n'));
}
function showBrandNightReport(){
 const content=modal('Gerar relatório por marca'),form=node('form',undefined,'forecast-form'),label=node('label','Marca'),select=node('select');select.setAttribute('aria-label','Marca do relatório');const groups=nightGroups(),brands=[...new Set(groups.map(brand))].sort();
 for(const name of brands){const option=node('option',brandPalette.get(name)?.label??name);option.value=name;select.append(option);}label.append(select);const button=node('button','Gerar relatório','quiet');button.type='submit';button.disabled=!brands.length;form.append(label,button);content.append(form);if(!brands.length)content.append(node('p','Nenhuma ocorrência noturna registrada.','empty'));
 form.onsubmit=event=>{event.preventDefault();const name=select.value,stores=groups.filter(store=>brand(store)===name),lines=['Olá, supervisoras da marca '+(brandPalette.get(name)?.label??name)+'.','','Compartilhamos os registros de lojas cujo FortiGate ficou sem comunicação por mais de três horas contínuas entre 22h e 10h, no horário de Brasília. Solicitamos a verificação dos motivos e a orientação das equipes para manter os equipamentos ligados após o expediente.','','Período de contagem: desde 21/11/2026.','Lojas identificadas: '+stores.length,'Ocorrências (loja/noite): '+stores.reduce((sum,store)=>sum+store.nights.length,0),''];
  stores.forEach((store,index)=>lines.push((index+1)+'. '+storeName(store)+' — '+store.host,'Número de vezes: '+store.nights.length,'Manhãs registradas: '+[...store.nights].sort((a,b)=>a.data.localeCompare(b.data)).map(n=>nightDate(n.data)).join(', '),''));
  lines.push('A indisponibilidade noturna interfere diretamente na preparação das operações de venda: interrompe atualizações de sistemas, informações e relatórios de vendas de cada loja. Desligamentos abruptos durante esses processos também podem comprometer os equipamentos de T.I. e a integridade dos dados.','','Se houver manutenção do shopping ou necessidade de desligamento, o time de T.I. Lojas deve ser avisado previamente para organizar o procedimento e reduzir os impactos.','','Os registros indicam perda de comunicação e não comprovam desligamento de energia. Pedimos confirmar cada caso antes de atribuir a causa à equipe da loja.','','Time de T.I. Lojas');reportMessage('Relatório por marca · '+(brandPalette.get(name)?.label??name),lines.join('\n'));
 };
}
function showNightLog(store){
 const content=modal('Log da loja · '+storeName(store));content.append(node('p','Código: '+store.host),node('p',store.nights.length+' noites identificadas desde 21/11/2026.','subtext'));
 for(const night of [...store.nights].sort((a,b)=>b.data.localeCompare(a.data))){const item=node('article',undefined,'ticket-entry');item.append(node('strong','Noite identificada pela manhã de '+nightDate(night.data)),node('p','Início no período noturno: '+fullDates.format(night.inicio)),node('p','Último horário registrado nessa noite: '+fullDates.format(night.fim)),node('p','Tempo sem comunicação: '+nightDuration(night.duracao)));content.append(item);}
 content.append(node('p','Cada registro representa uma noite com mais de três horas contínuas de indisponibilidade. Os horários se limitam à janela das 22h às 10h, no horário de Brasília.','subtext'));
}
function renderNightReport(content){
 document.querySelector('h1').textContent='Relatórios desligamentos indevidos';
 const pageHeading=document.querySelector('.page-heading');pageHeading.classList.add('night-page-heading');pageHeading.querySelector('.night-brand-pie')?.remove();
 const uniqueStores=nightGroups(),pie=smallPie('Lojas por marca · '+uniqueStores.length,brandSlices(uniqueStores),'loja','lojas');pie.classList.add('night-brand-pie');pageHeading.append(pie);document.querySelector('#subtitulo').textContent='Suspeitas de desligamento: FortiGate sem comunicação por mais de 3 horas contínuas entre 22h e 10h (Brasília).';
 const box=surface('report-page'),toolbar=node('div',undefined,'log-filters'),search=node('input'),button=node('button','Gerar relatório por marca','quiet');search.type='search';search.placeholder='Buscar loja, código ou marca';search.setAttribute('aria-label','Buscar loja no relatório noturno');search.value=nightQuery;button.onclick=showBrandNightReport;toolbar.append(search,button);
 const note=node('p','Contagem desde 21/11/2026, sem ocorrências anteriores. Cada loja soma no máximo uma ocorrência por noite, identificada pela data da manhã. Na primeira data, considera-se apenas o período a partir de 00h. Falha de comunicação não comprova desligamento: é necessário conferir energia, equipamento e conectividade.','history-notice');
 const summary=node('p',undefined,'subtext'),scroll=node('div',undefined,'table-scroll'),table=node('table'),head=table.createTHead().insertRow();for(const title of ['Nome da loja','Código da loja','Marca','Noites identificadas','Última ocorrência','Ações'])head.append(node('th',title));const body=table.createTBody();scroll.append(table);
 function update(){const term=search.value.trim().toLowerCase(),all=nightGroups(),rows=all.filter(store=>(store.loja+' '+store.host+' '+brand(store)).toLowerCase().includes(term));body.replaceChildren();for(const store of rows){const latest=[...store.nights].sort((a,b)=>b.data.localeCompare(a.data))[0],tr=body.insertRow(),name=tr.insertCell();name.append(node('strong',storeName(store)));for(const value of [store.host,brandPalette.get(brand(store))?.label??brand(store),store.nights.length,nightDate(latest.data)])tr.insertCell().textContent=value;const action=node('button','Gerar relatório','quiet');action.onclick=()=>nightReport(store);const log=node('button','Log da loja','quiet'),actions=node('div',undefined,'tracking-actions');log.onclick=()=>showNightLog(store);actions.append(action,log);tr.insertCell().append(actions);}summary.textContent=rows.length+' lojas · '+rows.reduce((sum,store)=>sum+store.nights.length,0)+' ocorrências desde o início da contagem.';if(!rows.length){const cell=body.insertRow().insertCell();cell.colSpan=6;cell.textContent='Nenhuma ocorrência registrada para este filtro.';}}
 search.oninput=()=>{nightQuery=search.value;update();};box.append(toolbar,note,summary,scroll);content.append(box);update();
}

function render(){
 const focused=document.activeElement?.id,selection=document.activeElement?.selectionStart;
 for(const chart of charts)chart.destroy();charts=[];
 const content=document.querySelector('#conteudo');content.replaceChildren();
 const subtitle=document.querySelector('#subtitulo'),title=document.querySelector('h1');
 const stores=new Set(incidents.map(row=>row.host||row.loja)).size;
 if(['logs','relatorio','desligamentos'].includes(trackingPage)){
  const back=node('a','‹ Visão geral','back');back.href='./?v=23';content.append(back);
  if(trackingPage==='logs')renderLogs(content);else if(trackingPage==='desligamentos')renderNightReport(content);else renderIncidentReport(content);
 }else if(brandPage||problemPage){
  const valid=problemPage
   ? isOtherProblem||(requestedProblem.length>0&&requestedProblem.length<=500)
   : brandLogos.has(requestedBrand)||requestedBrand==='OUTRAS';
  title.textContent=problemPage ? (valid?(isOtherProblem?'Outros problemas':requestedProblem):'Problema não encontrado') : (valid?'Casos da marca '+requestedBrand:'Marca não encontrada');
  if(!valid){subtitle.textContent='Selecione um item pela visão geral.';return;}
  const rows=rowsFor().filter(row=>problemPage?matchesProblem(row):brand(row)===requestedBrand);
  subtitle.textContent=new Set(rows.map(row=>row.host||row.loja)).size+' lojas afetadas · '+rows.length+' ocorrências abertas';
  let back=document.querySelector('.back');
  if(!back){back=node('a','‹ Visão geral','back');back.href=problemPage?'./?v=23#tipos-problemas':'./?v=23#lojas';document.querySelector('.page-heading').before(back);}
  const summary=node('div',undefined,'brand-summary');
  for(const [label,value]of [['Ocorrências abertas',rows.length],['Lojas afetadas',new Set(rows.map(row=>row.host||row.loja)).size],['Caso mais antigo',rows.length?age(rows[0]):'—']]){
    const card=surface('detail-kpi');card.append(node('p',label),node('strong',value));summary.append(card);
  }
  content.append(summary,tablePanel(problemPage?undefined:requestedBrand,problemPage?matchesProblem:undefined));
 }else if(detail){
  if(!category){title.textContent='Prioridade indisponível';return;}
  title.textContent=category.title;subtitle.textContent='Ocorrências abertas nas lojas desta prioridade';
  let back=document.querySelector('.back');if(!back){back=node('a','‹ Visão geral','back');back.href='./?from='+period+'&v=23';document.querySelector('.page-heading').before(back);}
  const titleBox=title.parentElement;if(!titleBox.parentElement.classList.contains('detail-title')){const wrapper=colored(node('div',undefined,'detail-title'),category);titleBox.before(wrapper);wrapper.append(node('span','⚠','detail-icon'),titleBox);}
  const rows=rowsFor(category),top=node('div',undefined,'detail-top'),kpis=node('div',undefined,'detail-kpis');
  const counts=[['Ocorrências agora',panelValue(category)??rows.length],['Lojas afetadas',new Set(rows.map(row=>row.host||row.loja)).size],['Mais antiga',rows.length?age(rows[0]):'—'],['Mais recente',rows.length?age(rows.at(-1)):'—']];
  counts.forEach(([label,value],index)=>{const kpi=surface('detail-kpi');const metric=node('strong',value);if(index===2)metric.style.color=category.color;kpi.append(node('p',label),metric);if(index>=2&&rows.length)kpi.append(node('small',storeName(index===2?rows[0]:rows.at(-1))));kpis.append(kpi);});
  top.append(kpis,chartPanel(category));content.append(top,detailStores());
 }else{
  title.textContent='Saúde da rede das lojas';subtitle.textContent=stores+' lojas com ocorrência · '+incidents.length+' ocorrências abertas · Firewalls monitorados via Grafana';
  const chartsRow=node('div',undefined,'chart-layout');chartsRow.append(chartPanel(),distribution());
  const support=node('div',undefined,'support-layout');const right=node('div',undefined,'support-right');right.append(oldestPanel(),logCard());support.append(brandPanel(),right);const reports=node('div',undefined,'end-report-grid');reports.append(reportCard(),nightCard());content.append(statCards(),chartsRow,support,tablePanel(),reports);
  const links=node('div');links.id='links';content.append(links);
 }
 if(focused==='search-stores'){const input=document.querySelector('#search-stores');input?.focus();input?.setSelectionRange(selection,selection);}
}
async function refresh(){
 clearTimeout(timer);activeRequest?.abort();const controller=new AbortController();activeRequest=controller;
 try{
  const options={headers:{Authorization:'Bearer '+sessionStorage.getItem(sessionKey)},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(45000)])};
  const [summary,problems]=await Promise.all([api('/api/resumo?from='+period+'&to=now',options),api('/api/problemas',options)]);
  if(controller.signal.aborted)return;panels=summary.paineis;incidents=problems.ocorrencias;tracking=problems.acompanhamento??tracking;updated=Date.parse(summary.atualizadoEm);status.textContent=tracking?.aviso??(tracking?.ultimaColeta&&Date.now()-tracking.ultimaColeta>900000?'O histórico está sem atualização há mais de 15 minutos. Confira a última coleta antes de usar o relatório.':'');render();
 }catch(error){if(!controller.signal.aborted)status.textContent=error.message==='Failed to fetch'?'Não foi possível atualizar. Exibindo os últimos dados.':error.message;}
 finally{if(!controller.signal.aborted)timer=setTimeout(refresh,REFRESH_SECONDS*1000);}
}
if(!login){
 if(!sessionStorage.getItem(sessionKey))out();
 else{
  if(brandPage||problemPage||trackingPage)document.querySelector('#periods').hidden=true;else periodControls();document.querySelector('#sair').onclick=out;
  document.querySelector('#conta').onclick=event=>{const button=document.querySelector('#sair');button.hidden=!button.hidden;event.currentTarget.setAttribute('aria-expanded',String(!button.hidden));};
  const theme=document.querySelector('#tema');theme.setAttribute('aria-label','Tema escuro do centro de operações');theme.title='Tema escuro';theme.disabled=true;
  document.querySelector('#tv').onclick=async()=>{const panel=document.querySelector('#painel');try{if(document.fullscreenElement)await document.exitFullscreen();else await panel.requestFullscreen();}catch{status.textContent='Tela cheia indisponível neste navegador.';}};
  document.addEventListener('fullscreenchange',()=>document.querySelector('#painel').classList.toggle('tv',!!document.fullscreenElement));
  document.querySelector('.nav a[href$="#links"]').onclick=event=>{
    event.preventDefault();
    const content=document.querySelector('#loja-conteudo');content.replaceChildren(heading('Links do monitoramento'));
    for(const [label,url]of [['Visão geral','./?v=23'],['Lojas e ocorrências','./?v=23#ocorrencias'],['Histórico dos problemas','./?v=23#historico']]){
      const link=node('a',label,'dialog-case');link.href=url;link.style.display='block';content.append(link);
    }
    document.querySelector('#loja-dialog').showModal();
  };
  document.querySelector('#fechar-dialog').onclick=()=>document.querySelector('#loja-dialog').close();
  setInterval(()=>{document.querySelector('#live').textContent=updated?'Ao vivo · há '+Math.max(0,Math.floor((Date.now()-updated)/1000))+' s':'Conectando…';},1000);
  refresh();
 }
}









