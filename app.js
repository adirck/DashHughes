import { API_URL, REFRESH_SECONDS } from './config.js';
const sessionKey='dashhughes-session';
const reportSignature='Att\nAlexandre Rocha\nAnalista de Suporte de T.I II\nEquipe T.I Lojas';
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
const dualProblem='Dois links com intermitência';
const dualPage=requestedProblem===dualProblem;
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
// Rótulos visuais; os identificadores 1/2 permanecem estáveis nas consultas e históricos.
const portName=value=>String(value)==='1'?'Porta WAN(Link Principal)':String(value)==='2'?'Porta A(Link Secundário)':String(value);
const presentLinks=value=>String(value).replace(/\bLink\s+([12])\b/gi,(_,number)=>portName(number));
const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=presentLinks(text);if(cls)el.className=cls;return el;};
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
   sessionStorage.setItem(sessionKey,data.token);location.replace('./?v=47');
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
// Intermitência só entra nas classificações após mais de duas horas contínuas.
function eligibleIncident(row,now=Date.now()){
 if(!/com perda de dados$/.test(simple(row.problema)))return true;
 const start=Number.isFinite(row.inicio)?row.inicio:timestamp(row.horario),end=row.fim??now;
 return Number.isFinite(start)&&end-start>7200000;
}
function visibleIncidents(){return allIncidents.filter(row=>!isPaused(row)&&eligibleIncident(row));}
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
// Correções locais verificadas: independem de erros de grafia na origem.
const verifiedBrands=new Map([['SOM101F1','CRIS BARROS']]);
function brand(row){
 const verified=verifiedBrands.get(String(row.host??'').trim().toUpperCase());if(verified)return verified;
 // Uniformiza acentos, separadores e qualificadores conhecidos sem alterar o nome exibido.
 const text=String(row.loja??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,' ').replace(/\b(?:UL|LOJA|LOJAS)\b/g,' ').replace(/\s+/g,' ').trim();
 const rules=[['CRIS BARROS',/\bCRISS?\s*BARROS\b/],['CAROL BASSI',/\bCAROL\s*BASSI\b/],['MARIA FILÓ',/\bMARIA\s*FILO\b/],['OFF PREMIUM',/\bOFF\s*PREMIUM\b/],['NV',/\b(?:BYNV|NV)\b/],['ANIMALE',/\bANIMALE\b/],['FOXTON',/\bFOXTON\b/],['FABULA',/\bFABULA\b/],['FARM',/\bFARM\b/]];
 // A marca que aparece primeiro prevalece sobre nomes de outlets ou shoppings posteriores.
 const matches=rules.map(([name,pattern])=>({name,index:text.search(pattern)})).filter(item=>item.index>=0).sort((a,b)=>a.index-b.index);
 return matches[0]?.name??'OUTRAS';
}
function storeName(row){const name=row.loja.replace(/\s*\(\s*firewall\s*\)\s*/ig,'').replaceAll('_',' ').replace(/\s+/g,' ').trim();return name.toUpperCase()==='NV CJ SHOPS'?'NV CJ SHOPS (HADDOCK LOBO)':name;}
function colored(el,cat){el.style.setProperty('--severity',cat?.color??'#a6b3c2');return el;}
function badge(cat){return colored(node('span',cat?.short??'Sem classificação','badge'),cat);}
function panelValue(cat){const p=panels.find(item=>item.id===cat.id);return p?.estado==='ok'?p.series?.[0]?.valor:null;}
function heading(text){return node('h2',text);}
function surface(cls){return node('section',undefined,'surface '+cls);}
function periodControls(){
 const wrap=document.querySelector('#periods');wrap.replaceChildren();
 let tools=wrap.parentElement;if(!tools.classList.contains('period-tools')){tools=node('div',undefined,'period-tools');wrap.before(tools);tools.append(wrap);const daily=node('button','Resumo Diário','quiet daily-report');daily.type='button';daily.disabled=!tracking;daily.onclick=()=>reportMessage('Resumo Diário',dailySummary());tools.append(daily);}
 for(const [value,label]of periods){const b=node('button',label,value===period?'selected':'');b.type='button';b.setAttribute('aria-pressed',String(value===period));
 b.onclick=()=>{period=value;const url=new URL(location.href);url.searchParams.set('from',value);history.replaceState(null,'',url);periodControls();refresh();};wrap.append(b);}
}
function usesStoreHistory(){return tracking?.controles?.some(control=>control.pausado||control.intervalos?.length);}
function storeHistorySeries(cat,now=Date.now()){
 const durations={'now-15m':900000,'now-1h':3600000,'now-6h':21600000,'now-24h':86400000,'now-30d':2592000000},duration=durations[period];
 const end=Math.min(now,tracking?.ultimaColeta??now),start=Math.max(end-duration,tracking?.inicioColeta??end);if(end<=start)return [];
 const step=period==='now-30d'?43200000:Math.max(60000,duration/24),offset=10800000,points=[];
 const spans=(tracking?.eventos??[]).filter(event=>!isPaused(event)&&eligibleIncident(event,end)&&severity(event)?.id===cat.id&&Number.isFinite(event.inicio)).flatMap(event=>monitoredSpans(/com perda de dados$/.test(simple(event.problema))?{...event,inicio:event.inicio+7200000}:event,end));
 // Média ponderada pelo tempo: uma ocorrência presente em metade do intervalo contribui com 0,5.
 for(let cursor=start;cursor<end;){const boundary=(Math.floor((cursor-offset)/step)+1)*step+offset,to=Math.min(boundary,end);if(to<=cursor)break;
  const area=spans.reduce((sum,[a,b])=>sum+Math.max(0,Math.min(b,to)-Math.max(a,cursor)),0);points.push([(cursor+to)/2,area/(to-cursor)]);cursor=to;
 }
 return [{label:cat.short,color:cat.color,points}];
}
function lineSeries(cat){
 if(usesStoreHistory())return storeHistorySeries(cat);
 const panel=panels.find(item=>item.id===cat.id);
 return (panel?.series??[]).filter(row=>row.historico?.length).map(row=>({label:cat.short,color:cat.color,points:row.historico}));
}
function plot(canvas,series,spark=false){
 if(!window.Chart)return;
 const chart=new window.Chart(canvas,{type:'line',data:{datasets:series.map(item=>({
  label:item.label,data:item.points.map(([x,y])=>({x,y})),borderColor:item.color,backgroundColor:item.color+'20',
  fill:!spark,stepped:true,borderWidth:spark?1.5:2,pointRadius:!spark&&item.points.length===1?4:0,pointHoverRadius:4,hidden:hiddenLines.has(item.label),
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
 group.append(node('span',usesStoreHistory()?'lojas pausadas excluídas · histórico por loja desde '+(tracking.inicioColeta?dates.format(tracking.inicioColeta):'o início da coleta')+(period==='now-30d'?' · 2 médias por dia':''):(period==='now-30d'?'últimos 30 dias · 2 médias por dia':'horário de Brasília'),'subtext'));head.append(group);box.append(head);
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
  card.href='./detalhe.html?id='+cat.id+'&from='+period+'&v=47';
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
  reportSignature,
 ].join('\n');
 message.value=presentLinks(message.value);
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


function dualLinkRows(){
 const stores=new Map();for(const row of incidents){const match=/^Link ([12]) com perda de dados$/.exec(simple(row.problema));if(!match||isPaused(row))continue;const key=row.host||row.loja;if(!stores.has(key))stores.set(key,{one:[],two:[]});stores.get(key)[match[1]==='1'?'one':'two'].push(row);}
 const rows=[];for(const {one,two}of stores.values()){if(!one.length||!two.length)continue;
  const a=[...one].sort((x,y)=>timestamp(x.horario)-timestamp(y.horario))[0],b=[...two].sort((x,y)=>timestamp(x.horario)-timestamp(y.horario))[0],start=Math.max(timestamp(a.horario),timestamp(b.horario));
  if(!Number.isFinite(start)||Date.now()-start<=7200000)continue;
  rows.push({...a,id:undefined,problema:dualProblem,horario:Number.isFinite(start)?String(start):'',severidade:Number(a.severidade)>=Number(b.severidade)?a.severidade:b.severidade});
 }return rows.sort((a,b)=>timestamp(a.horario)-timestamp(b.horario));
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
 const dualRows=dualLinkRows(),otherIndex=top.findIndex(([name])=>name==='Outros');top.splice(otherIndex<0?top.length:otherIndex,0,[dualProblem,dualRows.length]);
 const list=node('div',undefined,'distribution-list'),maximum=Math.max(1,...top.map(row=>row[1]));
 for(const [name,count]of top){const item=node('a',undefined,'problem-link');
 item.href='./problema.html?v=47&'+(name==='Outros'
  ? 'grupo=outros&excluir='+encodeURIComponent(JSON.stringify(all.slice(0,6).map(row=>row[0])))
  : 'problema='+encodeURIComponent(name));
 item.setAttribute('aria-label',name+' · '+count+(name===dualProblem?' lojas':' ocorrências'));
 const label=node('div',undefined,'distribution-line');label.append(node('span',name),node('strong',count));const track=node('div',undefined,'bar-track'),bar=node('div',undefined,'bar-fill');bar.style.width=count/maximum*100+'%';if(name.includes('Firewall'))bar.style.background='var(--medium)';track.append(bar);item.append(label,track);
 const line=node('div',undefined,'problem-action-row'),generate=node('button','Gerar lista','quiet generate-list');
 generate.type='button';generate.setAttribute('aria-label','Gerar lista de '+name);
 generate.onclick=()=>{
  const excluded=all.slice(0,6).map(row=>row[0]);
  const rows=name===dualProblem?dualRows:rowsFor().filter(row=>name==='Outros'?!excluded.includes(simple(row.problema)):simple(row.problema)===name);
  showProblemList(name,rows);
 };
 line.append(item,generate);list.append(line);}
 const report=node('button','Gerar relatório total','primary total-report');
 report.type='button';
 report.onclick=()=>{
  const excluded=all.slice(0,6).map(row=>row[0]);
  const groups=top.filter(([name])=>name!==dualProblem).map(([name])=>({
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
 chip.href='./marca.html?marca='+encodeURIComponent(name)+'&v=47';
 chip.setAttribute('aria-label',name+' · '+stores.size+' lojas afetadas');
 const logoBox=node('span',undefined,'brand-logo-box');
 if(brandLogos.has(name)){
  const logo=node('img');logo.src='./assets/marcas/'+brandLogos.get(name)+'?v=47';logo.alt=name;
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
function tablePanel(brandFilter,problemFilter,customRows){
 const source=(customRows??rowsFor()).filter(row=>(!brandFilter||brand(row)===brandFilter)&&(!problemFilter||problemFilter(row)));
 const box=surface('table-panel');box.id='ocorrencias';const toolbar=node('div',undefined,'table-toolbar'),title=node('div',undefined,'table-title');title.append(heading('Ocorrências abertas'));const tabs=node('div',undefined,'filter-tabs');title.append(tabs);
 const table=node('table'),thead=table.createTHead().insertRow();for(const label of ['Severidade','Loja','Problema','Aberto há','Início'])thead.append(node('th',label));
 const body=table.createTBody(),scroll=node('div',undefined,'table-scroll');scroll.append(table);const footer=node('div',undefined,'table-footer'),count=node('span'),more=node('button','Carregar mais','text-button');more.onclick=()=>{limit+=10;update();};footer.append(count,more);
 function update(){
  tabs.replaceChildren();for(const [key,label,amount]of [['all','Todas',source.length],...categories.map(cat=>[cat.key,cat.short,source.filter(row=>severity(row)?.id===cat.id).length])]){
   const tab=node('button',label+' · '+amount,selected===key?'selected':'');tab.onclick=()=>{selected=key;limit=10;update();};tabs.append(tab);
  }
  const term=query.trim().toLowerCase();const rows=source.filter(row=>(selected==='all'||severity(row)?.key===selected)&&(!term||[storeName(row),row.host,row.problema,simple(row.problema),presentLinks(simple(row.problema))].some(value=>value.toLowerCase().includes(term))));
  body.replaceChildren();for(const row of rows.slice(0,limit)){const tr=body.insertRow(),cat=severity(row),cell=colored(tr.insertCell(),cat);cell.className='severity-cell';cell.append(node('span',undefined,'dot'),node('span',cat?.short??'Outra'));
   const name=tr.insertCell();name.append(node('strong',storeName(row)),node('small',row.host+' · '+brand(row)));
   name.append(warning(row));const actions=trackingActions(row);name.append(actions);const problem=tr.insertCell();problem.textContent=presentLinks(simple(row.problema));problem.title=row.problema;
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
  const term=query.toLowerCase().trim(),all=rowsFor(category);const rows=all.filter(row=>!term||[storeName(row),row.host,row.problema,simple(row.problema),presentLinks(simple(row.problema))].some(value=>value.toLowerCase().includes(term)));
  list.replaceChildren();
  for(const row of rows){const item=colored(node('div',undefined,'store-row'),category),name=node('div',undefined,'store-name');name.append(node('strong',storeName(row)),node('small',row.host+' · '+brand(row)+' · desde '+started(row)));
   const problem=node('p',simple(row.problema),'store-problem');problem.title=row.problema;
   const elapsed=age(row).replace(/\bd$/,'dias').replace(/\bh$/,'horas').replace(/\bmin$/,'minutos');
   const actions=node('div',undefined,'store-buttons'),copy=node('button','Copiar dados','quiet'),view=node('button','Ver loja','quiet');
   copy.onclick=async()=>{try{await navigator.clipboard.writeText([storeName(row),row.host,presentLinks(simple(row.problema)),'Início: '+started(row)].join('\n'));feedback.textContent='Dados da loja copiados.';}catch{feedback.textContent='Não foi possível copiar. Abra Ver loja para consultar os dados.';}};
   view.onclick=()=>showStore(row);actions.append(copy,view,...trackingActions(row).children);name.append(warning(row));item.append(name,problem,node('span',elapsed,'store-duration'),actions);list.append(item);
  }
  if(!rows.length)list.append(node('p','Nenhuma ocorrência encontrada.','empty'));
 }
 toolbar.append(title,searchControl('Filtrar','Loja ou código',update));box.append(toolbar,list,feedback);update();return box;
}
// Chamados ficam no serviço compartilhado; nenhum dado operacional é salvo no repositório.
let allIncidents=[],tracking=null,reportPeriod='30',reportQuery='',logFilter='all',logQuery='';
const trackingPage=params.get('tela');
const authOptions=()=>({headers:{Authorization:'Bearer '+sessionStorage.getItem(sessionKey)}});
function storeControl(row){return tracking?.controles?.find(control=>control.host===(row.host||row.loja));}
function isPaused(row){return !!storeControl(row)?.pausado;}
function monitoringButtons(row){const wrap=node('div',undefined,'tracking-actions'),pause=node('button',isPaused(row)?'Monitoramento Pausado':'Pausar monitoramento','quiet');pause.disabled=isPaused(row);pause.onclick=()=>confirmStoreControl(row,'pausar');wrap.append(pause);if(isPaused(row)){const resume=node('button','Reativar','quiet');if(row.host==='SOM078F1'){resume.disabled=true;resume.title='Loja Duplicada: reativação bloqueada';}resume.onclick=()=>confirmStoreControl(row,'reativar');wrap.append(resume);}return wrap;}
function confirmStoreControl(row,acao,reason){
 const title=reason==='falso_positivo'?'Falso Positivo':acao==='zerar'?'Excluir log da loja':acao==='pausar'?'Pausar monitoramento':'Reativar monitoramento';const content=modal(title);content.append(node('p',storeName(row)+' · '+row.host),node('p',acao==='zerar'?'Excluir todo o histórico noturno desta loja e retornar o contador a zero? Esta exclusão não pode ser desfeita. Novos registros só considerarão o período após esta ação.':acao==='pausar'?'A loja será retirada dos incidentes ativos e da coleta de desligamentos do portal até ser reativada. Os históricos existentes serão preservados.':'O acompanhamento da loja voltará a partir de agora. O período de pausa não será contabilizado como nova ocorrência noturna.'));
 let mode,date,form;
 if(acao==='pausar'){
  form=node('form',undefined,'forecast-form');const label=node('label','Tipo de pausa');mode=node('select');mode.setAttribute('aria-label','Tipo de pausa');
  for(const [value,text]of [['indefinido',reason==='falso_positivo'?'Falso Positivo Indefinido':'Pausar indefinidamente'],['durante',reason==='falso_positivo'?'Correção Falso Positivo':'Pausar durante']]){const option=node('option',text);option.value=value;mode.append(option);}label.append(mode);
  const dateLabel=node('label','Manter pausada até');date=node('input');date.type='date';date.min=new Date(Date.now()-3*3600000).toISOString().slice(0,10);dateLabel.append(date);dateLabel.hidden=true;
  mode.onchange=()=>{dateLabel.hidden=mode.value!=='durante';date.required=mode.value==='durante';};form.append(label,dateLabel,node('small','Na pausa com data, a reativação é automática após o fim do dia escolhido, no horário de Brasília. Também é possível reativar antes.'));content.append(form);
 }
 const button=node('button',acao==='zerar'?'Confirmar exclusão':title,'quiet'),feedback=node('p',undefined,'status-message');button.onclick=async()=>{if(form&&!form.reportValidity())return;button.disabled=true;try{tracking=await api('/api/lojas/controle',{...authOptions(),method:'POST',headers:{...authOptions().headers,'Content-Type':'application/json'},body:JSON.stringify({host:row.host||row.loja,acao,...(acao==='pausar'?{modo:mode.value,motivo:reason??'manutencao',...(mode.value==='durante'?{ate:date.value}:{})}:{})})});incidents=visibleIncidents();document.querySelector('#loja-dialog').close();render();}catch(error){feedback.textContent=error.message;button.disabled=false;}};content.append(button,feedback);
}
async function showJKCheck(kind='jk'){
 const content=modal('Conferência de cadastro · '+(kind==='campinas'?'Animale Campinas':'BYNV Iguatemi JK')),feedback=node('p','Consultando cadastros e sinais de resposta…','subtext');content.append(feedback);
 try{const data=await api(kind==='campinas'?'/api/conferencia-campinas':'/api/conferencia-jk',authOptions());feedback.textContent='Consulta em '+fullDates.format(Date.parse(data.consultadoEm))+'. Monitoramento habilitado não significa equipamento online.';if(data.aviso)content.append(node('p',data.aviso));if(!data.cadastros.length)content.append(node('p','Nenhum cadastro correspondente foi retornado.'));for(const record of data.cadastros){const part=node('article',undefined,'ticket-entry');part.append(heading(record.nome),node('p','Código: '+record.codigo),node('p','Monitoramento: '+(record.monitoramentoHabilitado?'habilitado':'desabilitado')));for(const signal of record.sinais)part.append(node('p',signal.item+' ['+signal.chave+']: '+signal.valor+' · '+(Number(signal.horario)>0?fullDates.format(Number(signal.horario)*1000):'sem coleta recente')));if(!record.sinais.length)part.append(node('p','Sem sinal de ping ou uptime disponível nesta consulta.'));content.append(part);}}
 catch(error){feedback.textContent=error.message;}
}
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
function trackingActions(row){const actions=node('div',undefined,'tracking-actions'),forecast=node('button','Previsão para solução','quiet'),log=node('button','Log Loja','quiet');forecast.disabled=!tracking||!row.id;forecast.onclick=()=>showForecast(row);log.onclick=()=>showStoreLog(row);actions.append(forecast,log,...monitoringButtons(row).children);if(['SOM078F1','SOM341F1'].includes(row.host)){const check=node('button','Conferir cadastro','quiet');check.onclick=()=>showJKCheck(row.host==='SOM341F1'?'campinas':'jk');actions.append(check);}if(simple(row.problema)==='Firewall não responde ao monitoramento'){const falsePositive=node('button','Falso Positivo','quiet');falsePositive.onclick=()=>confirmStoreControl(row,'pausar','falso_positivo');actions.append(falsePositive);}return actions;}
function smallPie(title,slices,unit='ocorrência',plural='ocorrências'){
 const box=node('div',undefined,'tracking-pie');box.append(node('h3',title));
 if(slices.length){const wrap=node('div',undefined,'brand-pie-wrap'),canvas=node('canvas');canvas.setAttribute('role','img');canvas.setAttribute('aria-label',title+': '+slices.map(s=>s.label+' '+s.count).join(', '));wrap.append(canvas);box.append(wrap);queueMicrotask(()=>drawBrandPie(canvas,slices,unit,plural));const legend=node('ul',undefined,'compact-legend');for(const slice of slices){const li=node('li'),dot=node('span',undefined,'legend-dot');dot.style.backgroundColor=slice.color;li.append(dot,node('span',slice.label+' · '+slice.count));legend.append(li);}box.append(legend);}else box.append(node('p','Nenhum caso.','empty'));return box;
}
function lateCases(){return tracking?.eventos.filter(event=>!event.fim&&!isPaused(event)&&overdue(event).length)??[];}
function logCard(){
 const box=surface('tracking-card');box.append(heading('Acompanhamento de chamados'));const rows=lateCases();box.append(node('p',tracking?rows.length+' problemas com previsão vencida':'Carregando histórico compartilhado…','subtext'));
 const pies=node('div',undefined,'tracking-pies');const buckets=[{label:'Mais de um mês',color:'#ef4444',count:0},{label:'Mais de duas semanas até um mês',color:'#f97316',count:0},{label:'Mais de uma semana até duas',color:'#facc15',count:0},{label:'Mais de um dia até uma semana',color:'#3b82f6',count:0},{label:'Até um dia',color:'#94a3b8',count:0}];
 for(const row of rows){const days=(Date.now()-Math.min(...overdue(row).map(ticket=>ticket.prazo)))/86400000;buckets[days>30?0:days>14?1:days>7?2:days>1?3:4].count++;}
 pies.append(smallPie('Casos por marca',brandSlices(rows)),smallPie('Tempo desde a primeira previsão vencida',buckets.filter(b=>b.count)));box.append(pies);const link=node('a','Abrir log de chamados →','quiet card-link');link.href='./?tela=logs&v=47';box.append(link);return box;
}
function reportCard(){const box=surface('incident-report-card'),link=node('a',undefined,'card-link');link.href='./?tela=relatorio&v=47';link.append(heading('Relatório geral de incidentes'),node('p','Quedas de Link 1 e Link 2 com mais de 24 horas · frequência e dias offline · últimos três meses','subtext'));box.append(link);return box;}
function renderLogs(content){
 document.querySelector('h1').textContent='Log de chamados';document.querySelector('#subtitulo').textContent='Histórico de previsões, analistas e chamados Hughes. Registros anteriores permanecem disponíveis.';
 const box=surface('log-page'),controls=node('div',undefined,'log-filters'),search=node('input'),select=node('select');search.type='search';search.placeholder='Buscar loja, código, chamado ou analista';search.setAttribute('aria-label','Buscar no log');
 for(const [value,label]of [['all','Todos os registros'],['late','Previsões vencidas'],['open','Problemas abertos'],['closed','Problemas encerrados']]){const option=node('option',label);option.value=value;select.append(option);}select.setAttribute('aria-label','Situação do chamado');select.value=logFilter;search.value=logQuery;
 const list=node('div');function update(){list.replaceChildren();const term=search.value.toLowerCase();const events=(tracking?.eventos??[]).filter(event=>ticketsFor(event).length&&(select.value==='all'||select.value==='late'&&overdue(event).length||select.value==='open'&&!event.fim||select.value==='closed'&&event.fim)&&[storeName(event),event.host,...ticketsFor(event).flatMap(ticket=>[ticket.numero,ticket.analista])].some(value=>value?.toLowerCase().includes(term)));
  for(const event of events){const part=node('section',undefined,'log-case'),name=heading(storeName(event));name.append(warning(event));part.append(name,node('p',event.host+' · '+brand(event)));logEntries(part,[event]);list.append(part);}if(!events.length)list.append(node('p','Nenhum registro para este filtro.','empty'));
 }search.oninput=()=>{logQuery=search.value;update();};select.onchange=()=>{logFilter=select.value;update();};controls.append(search,select);box.append(controls,list);content.append(box);update();
}
// Os intervalos de queda são unidos por loja/link para não contar o mesmo tempo duas vezes.
function monitoredSpans(event,now=Date.now()){
 let spans=[[event.inicio,event.fim??now]];
 for(const [from,end]of storeControl(event)?.intervalos??[]){const to=end??now;spans=spans.flatMap(([a,b])=>to<=a||from>=b?[[a,b]]:[...(a<from?[[a,Math.min(from,b)]]:[]),...(b>to?[[Math.max(to,a),b]]:[])]);}
 return spans;
}
function reportRows(days,now=Date.now()){
 const cutoff=new Date(now);cutoff.setUTCMonth(cutoff.getUTCMonth()-3);const start=Math.max(now-days*86400000,cutoff.getTime()),groups=new Map();
 for(const event of tracking?.eventos??[]){if(isPaused(event))continue;const end=event.fim??now;const spans=monitoredSpans(event,now);if(!event.link||!event.inicio||spans.reduce((sum,[a,b])=>sum+b-a,0)<=86400000||end<=start||event.inicio>=now||!spans.some(([a,b])=>b>start&&a<now))continue;
  const key=(event.host||event.loja)+'|'+event.link;if(!groups.has(key))groups.set(key,{...event,count:0,intervals:[],open:false});const group=groups.get(key);group.count++;group.open||=!event.fim;group.intervals.push(...spans.map(([a,b])=>[Math.max(start,a),Math.min(b,now)]).filter(([a,b])=>b>a));
 }
 return [...groups.values()].map(group=>{const intervals=group.intervals.sort((a,b)=>a[0]-b[0]);let sum=0,last=null;for(const span of intervals){if(last&&span[0]<=last[1])last[1]=Math.max(last[1],span[1]);else{if(last)sum+=last[1]-last[0];last=[...span];}}if(last)sum+=last[1]-last[0];return {...group,days:sum/86400000};}).sort((a,b)=>b.days-a.days||b.count-a.count);
}
function offlineDuration(days){const hours=Math.floor(days*24);return Math.floor(hours/24)+' dias e '+hours%24+' horas';}
function reportMessage(title,text){
 const content=modal(title),area=node('textarea',undefined,'hughes-message');area.id='mensagem-hughes';area.value=presentLinks(text);area.rows=18;area.setAttribute('aria-label','Mensagem do relatório, editável');const footer=node('div',undefined,'message-footer'),copy=node('button','Copiar mensagem','quiet'),feedback=node('span',undefined,'subtext');feedback.setAttribute('role','status');copy.onclick=async()=>{try{await navigator.clipboard.writeText(area.value);feedback.textContent='Mensagem copiada.';}catch{area.focus();area.select();feedback.textContent='Selecione e copie o texto.';}};footer.append(copy,feedback);content.append(area,footer);
}
function storeIncidentMessage(row,days,replacement=false){
 const now=Date.now(),rows=reportRows(days,now).filter(item=>(item.host||item.loja)===(row.host||row.loja)),target=rows.find(item=>item.link===row.link);
 const coverage=tracking?.inicioColeta?fullDates.format(tracking.inicioColeta):'indisponível';
 const common=['Loja: '+storeName(row),'Código: '+row.host,'Período: últimos '+(days===92?'três meses':days+' dias'), 'Levantamento: '+fullDates.format(now)+' (horário de Brasília).'];
 const note='Contagem de quedas superiores a 24 horas que afetaram o período. Tempo offline somado dentro do período. Histórico disponível desde '+coverage+'; quedas encerradas antes da coleta não estão incluídas. Encerramentos são observados nas consultas ao monitoramento.';
 if(replacement&&target){reportMessage('Solicitar troca de Link '+row.link,['Olá, equipe Hughes.','','Solicitamos a substituição do Link '+row.link+' da loja abaixo, devido às quedas e ao tempo acumulado de indisponibilidade.',...common,'','Porta: '+portName(row.link),'Quedas registradas com mais de 24 horas: '+target.count,'Tempo total indisponível: '+offlineDuration(target.days), 'Situação: '+(target.open?'há uma queda em aberto.':'quedas encerradas no monitoramento.'),'','Pedimos a análise do histórico e o retorno com a alternativa de substituição, número do chamado e previsão de atendimento.','',note,'',reportSignature].join('\n'));return;}
 const cutoff=new Date(now);cutoff.setUTCMonth(cutoff.getUTCMonth()-3);const start=Math.max(now-days*86400000,cutoff.getTime());
 const details=[];for(const link of rows){details.push('LINK '+link.link+' — '+link.count+' quedas superiores a 24 horas','Tempo total offline no período: '+offlineDuration(link.days));const events=tracking.eventos.filter(event=>(event.host||event.loja)===(row.host||row.loja)&&event.link===link.link&&event.inicio&&(event.fim??now)-event.inicio>86400000&&(event.fim??now)>start&&event.inicio<now).sort((a,b)=>a.inicio-b.inicio);
  events.forEach((event,index)=>{details.push((index+1)+'. '+simple(event.problema),'Início: '+fullDates.format(event.inicio),'Fim: '+(event.fim?fullDates.format(event.fim):'ainda em aberto'),'Indisponibilidade no período: '+offlineDuration(monitoredSpans(event,now).reduce((sum,[a,b])=>sum+Math.max(0,Math.min(b,now)-Math.max(a,start)),0)/86400000));const tickets=ticketsFor(event);for(const ticket of tickets)details.push('Chamado '+ticket.numero+' · analista '+ticket.analista+' · registrado '+fullDates.format(ticket.abertura)+' · previsão '+ticket.previsao.split('-').reverse().join('/')+(ticket.observacoes?' · '+ticket.observacoes:''));details.push('');});}
 reportMessage('Relatório total · '+storeName(row),['Olá, equipe Hughes.','','Segue o relatório de indisponibilidade dos links desta loja.',...common,'',...details,note,'','Solicitamos a avaliação dos casos e as medidas para estabilizar a conexão.','',reportSignature].join('\n'));
}

function rankingCard(){
 const card=node('a',undefined,'surface ranking-entry');card.href='./?tela=ranking&v=47';card.append(node('span','↗','monitoring-icon'),heading('Ranking de lojas e links recorrentes'),node('p','Veja quem apresenta mais quedas e mais tempo offline para apoiar pedidos de substituição.','subtext'),node('span','Abrir ranking →','monitoring-open'));return card;
}
// Dados administrativos compartilhados, carregados somente na página de cadastro.
let cadastro={lojas:[],supervisores:[]},cadastroQuery='';
const cadastroFilters={marca:'',loja:'',supervisor:'',gateway:''};
const normalizeCadastro=value=>String(value??'').normalize('NFD').replace(/\p{M}/gu,'').trim().toLocaleLowerCase('pt-BR');
function field(form,label,value,max=160){const wrap=node('label',label),input=node('input');input.value=value??'';input.maxLength=max;wrap.append(input);form.append(wrap);return input;}
function editStoreCadastro(row){
 const content=document.querySelector('#loja-conteudo');content.replaceChildren(heading('Editar cadastro da loja'),node('p',storeName(row)+' · '+row.host,'subtext'));
 const form=node('form',undefined,'forecast-form'),inputs={};
 for(const [key,label,max]of [['gateway','Gateway (ex.: 10.51.1.1)',15],['link1Operadora','Link 1 · Operadora',120],['link1Velocidade','Link 1 · Velocidade (ex.: 100 Mbps)',80],['link2Operadora','Link 2 · Operadora',120],['link2Velocidade','Link 2 · Velocidade (ex.: 100 Mbps)',80],['gerente','Nome da gerente / do gerente',160]])inputs[key]=field(form,label,row[key],max);
 const label=node('label','Supervisora / Supervisor'),select=node('select'),empty=node('option','Não informado');empty.value='';select.append(empty);
 for(const person of [...cadastro.supervisores].sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'))){const option=node('option',person.nome);option.value=person.id;select.append(option);}select.value=row.supervisorId??'';label.append(select);form.append(label);
 const feedback=node('p',undefined,'status-message');feedback.setAttribute('role','status');const save=node('button','Salvar cadastro','primary-action');save.type='submit';form.append(save,feedback);
 form.onsubmit=async event=>{event.preventDefault();save.disabled=true;feedback.textContent='Salvando…';try{const body={host:row.host,versao:row.versao,supervisorId:select.value};for(const [key,input]of Object.entries(inputs))body[key]=input.value.trim();const saved=await api('/api/cadastro/loja',{...authOptions(),method:'POST',headers:{...authOptions().headers,'Content-Type':'application/json'},body:JSON.stringify(body)});cadastro.lojas=cadastro.lojas.map(item=>item.host===saved.host?saved:item);document.querySelector('#loja-dialog').close();render();status.textContent='Cadastro da loja salvo.';}catch(error){feedback.textContent=error.message;}finally{save.disabled=false;}};
 content.append(form);document.querySelector('#loja-dialog').showModal();
}
function supervisorDialog(person=null){
 const content=document.querySelector('#loja-conteudo');content.replaceChildren(heading('Cadastro de supervisoras e supervisores'));
 const form=node('form',undefined,'forecast-form'),name=field(form,'Nome da supervisora ou supervisor',person?.nome);name.required=true;
 const save=node('button',person?'Salvar alterações':'Cadastrar responsável','primary-action');save.type='submit';const feedback=node('p',undefined,'status-message');feedback.setAttribute('role','status');form.append(save,feedback);
 form.onsubmit=async event=>{event.preventDefault();save.disabled=true;try{const saved=await api('/api/cadastro/supervisor',{...authOptions(),method:'POST',headers:{...authOptions().headers,'Content-Type':'application/json'},body:JSON.stringify({id:person?.id??crypto.randomUUID(),nome:name.value.trim(),versao:person?.versao})});cadastro.supervisores=[...cadastro.supervisores.filter(item=>item.id!==saved.id),saved];render();supervisorDialog();document.querySelector('#loja-conteudo [role="status"]').textContent='Responsável salvo.';}catch(error){feedback.textContent=error.message;}finally{save.disabled=false;}};
 content.append(form,heading('Responsáveis cadastrados',3));
 for(const item of [...cadastro.supervisores].sort((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'))){const line=node('div',undefined,'ticket-entry'),edit=node('button','Editar','quiet');edit.type='button';edit.onclick=()=>supervisorDialog(item);line.append(node('strong',item.nome),edit);content.append(line);}
 if(!cadastro.supervisores.length)content.append(node('p','Nenhum responsável cadastrado.','empty'));
 const dialog=document.querySelector('#loja-dialog');if(!dialog.open)dialog.showModal();
}
const exportColumns=[['loja','Loja'],['host','Código'],['marca','Marca'],['gateway','Gateway'],['link1Operadora','Link 1 · Operadora'],['link1Velocidade','Link 1 · Velocidade'],['link2Operadora','Link 2 · Operadora'],['link2Velocidade','Link 2 · Velocidade'],['gerente','Gerente'],['supervisor','Supervisora / Supervisor']];
let exportSelectedColumns=new Set(exportColumns.map(([key])=>key)),exportSelectedBrands=null;
function showCadastroExport(){
 const content=modal('Exportar planilha'),form=node('form',undefined,'forecast-form export-form'),columns=node('fieldset'),brands=node('fieldset'),feedback=node('p',undefined,'status-message'),count=node('p',undefined,'subtext');feedback.setAttribute('role','status');
 columns.append(node('legend','Colunas'));brands.append(node('legend','Marca'));const names=[...new Set(cadastro.lojas.map(brand))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
 const check=(parent,label,checked)=>{const wrap=node('label',undefined,'export-check'),input=node('input');input.type='checkbox';input.checked=checked;wrap.append(input,node('span',label));parent.append(wrap);return input;};
 const allColumns=check(columns,'Todas as colunas',exportSelectedColumns.size===exportColumns.length),columnChecks=exportColumns.map(([key,label])=>[key,check(columns,label,exportSelectedColumns.has(key))]);
 const allBrands=check(brands,'Todas as marcas',exportSelectedBrands===null),brandChecks=names.map(name=>[name,check(brands,brandPalette.get(name)?.label??name,exportSelectedBrands===null||exportSelectedBrands.has(name))]);
 const save=node('button','Exportar planilha','primary-action');save.type='submit';
 const rows=()=>cadastro.lojas.filter(row=>exportSelectedBrands===null||exportSelectedBrands.has(brand(row))).sort((a,b)=>storeName(a).localeCompare(storeName(b),'pt-BR'));
 function update(){const size=rows().length;count.textContent=size+' lojas · '+exportSelectedColumns.size+' colunas selecionadas';save.disabled=!size||!exportSelectedColumns.size;allColumns.checked=exportSelectedColumns.size===exportColumns.length;allColumns.indeterminate=exportSelectedColumns.size>0&&!allColumns.checked;allBrands.checked=exportSelectedBrands===null;allBrands.indeterminate=exportSelectedBrands!==null&&exportSelectedBrands.size>0;}
 allColumns.onchange=()=>{exportSelectedColumns=new Set(allColumns.checked?exportColumns.map(([key])=>key):[]);for(const [key,input]of columnChecks)input.checked=exportSelectedColumns.has(key);update();};
 for(const [key,input]of columnChecks)input.onchange=()=>{if(input.checked)exportSelectedColumns.add(key);else exportSelectedColumns.delete(key);update();};
 allBrands.onchange=()=>{exportSelectedBrands=allBrands.checked?null:new Set();for(const [,input]of brandChecks)input.checked=allBrands.checked;update();};
 for(const [,input]of brandChecks)input.onchange=()=>{const selected=brandChecks.filter(([,box])=>box.checked).map(([key])=>key);exportSelectedBrands=selected.length===names.length?null:new Set(selected);update();};
 form.onsubmit=async event=>{event.preventDefault();const selected=exportColumns.filter(([key])=>exportSelectedColumns.has(key)),stores=rows();if(!selected.length||!stores.length){feedback.textContent='Selecione ao menos uma coluna e uma marca com lojas.';return;}save.disabled=true;feedback.textContent='Preparando planilha…';let url;
  try{const people=new Map(cadastro.supervisores.map(person=>[person.id,person.nome]));const values=stores.map(row=>selected.map(([key])=>key==='loja'?storeName(row):key==='marca'?(brandPalette.get(brand(row))?.label??brand(row)):key==='supervisor'?(people.get(row.supervisorId)??''):(row[key]??'')));
   const {createWorkbook}=await import('./excel.mjs?v=47');const bytes=createWorkbook(selected.map(([,label])=>presentLinks(label)),values);url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));const link=node('a');link.href=url;link.download='Cadastro-Lojas-'+new Date(Date.now()-3*3600000).toISOString().slice(0,10)+'.xlsx';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);url=null;feedback.textContent='Planilha gerada. Os dados cadastrados e as seleções foram mantidos.';
  }catch(error){if(url)URL.revokeObjectURL(url);feedback.textContent='Não foi possível exportar. Tente novamente.';}finally{update();}
 };
 form.append(node('p','Escolha as colunas e as marcas. A exportação considera todas as lojas dessas marcas, independentemente dos filtros da tabela.','subtext'),columns,brands,count,save,feedback);content.append(form);update();
}
function renderCadastro(content){
 document.querySelector('h1').textContent='Cadastro Lojas';document.querySelector('#subtitulo').textContent='Lojas da fonte de monitoramento, incluindo unidades sem incidentes e com monitoramento pausado.';
 const box=surface('report-page'),tools=node('div',undefined,'log-filters'),search=node('input'),supervisors=node('button','Cadastrar supervisoras e supervisores','quiet'),summary=node('p',undefined,'subtext'),list=node('div',undefined,'table-scroll');
 search.type='search';search.placeholder='Buscar loja, código, marca, gateway ou responsável';search.setAttribute('aria-label','Buscar no cadastro de lojas');search.value=cadastroQuery;supervisors.onclick=()=>supervisorDialog();const exportButton=node('button','Exportar planilha','quiet');exportButton.onclick=showCadastroExport;tools.append(search,supervisors,exportButton);
 const filters=node('div',undefined,'log-filters cadastro-filters');
 for(const [key,label] of [['marca','Marca'],['loja','Loja'],['supervisor','Supervisora / Supervisor'],['gateway','Gateway']]){
  const input=field(filters,label,cadastroFilters[key]);
  input.type='search';
  input.placeholder=key==='gateway'?'Ex.: 10.51.1.1':'Filtrar por '+label.toLocaleLowerCase('pt-BR');
  input.oninput=()=>{cadastroFilters[key]=input.value;update();};
 }
 function update(){
  const term=normalizeCadastro(cadastroQuery),people=new Map(cadastro.supervisores.map(item=>[item.id,item.nome]));
  const active=Object.entries(cadastroFilters).map(([key,value])=>[key,normalizeCadastro(value)]).filter(([,value])=>value);
  const rows=cadastro.lojas.filter(row=>{
   const values={marca:brand(row),loja:[storeName(row),row.host].join(' '),supervisor:people.get(row.supervisorId),gateway:row.gateway};
   return normalizeCadastro([...Object.values(values),row.gerente].join(' ')).includes(term)
    && active.every(([key,value])=>normalizeCadastro(values[key]).includes(value));
  }).sort((a,b)=>storeName(a).localeCompare(storeName(b),'pt-BR'));
  summary.textContent=rows.length+' de '+cadastro.lojas.length+' lojas';const table=node('table'),head=table.createTHead().insertRow();for(const label of ['Loja / Código','Marca','Gateway','Link 1','Link 2','Gerente','Supervisora / Supervisor','Ações'])head.append(node('th',label));const body=table.createTBody();
  for(const row of rows){const tr=body.insertRow(),name=tr.insertCell();name.append(node('strong',storeName(row)),node('small',row.host+(row.host==='SOM078F1'?' · Loja Duplicada':'')));tr.insertCell().textContent=brand(row);tr.insertCell().textContent=row.gateway||'Não informado';
   for(const n of [1,2]){const cell=tr.insertCell();cell.append(node('div',row['link'+n+'Operadora']||'Operadora não informada'),node('small',row['link'+n+'Velocidade']||'Velocidade não informada'));}
   tr.insertCell().textContent=row.gerente||'Não informado';const supervisor=tr.insertCell(),choose=node('button',people.get(row.supervisorId)||'Selecionar responsável','quiet');choose.onclick=()=>editStoreCadastro(row);supervisor.append(choose);const edit=node('button','Editar cadastro','quiet');edit.onclick=()=>editStoreCadastro(row);tr.insertCell().append(edit);
  }if(!rows.length){const cell=body.insertRow().insertCell();cell.colSpan=8;cell.textContent='Nenhuma loja encontrada.';}list.replaceChildren(table);
 }search.oninput=()=>{cadastroQuery=search.value;update();};box.append(tools,filters,summary,list);content.append(box);update();
}

// Lista apenas encerramentos observados, sem afirmar reparo técnico confirmado.
let repairedDays='1',repairedQuery='';
function repairedRows(days,now=Date.now()){
 return (tracking?.eventos??[]).filter(row=>!isPaused(row)&&Number.isFinite(row.fim)&&row.fim>=now-days*86400000&&row.fim<=now&&Number.isFinite(row.inicio)&&row.fim>=row.inicio&&eligibleIncident(row,now)&&/^Link [12] (indisponível|com perda de dados|lenta)$/.test(simple(row.problema))).sort((a,b)=>b.fim-a.fim);
}
function linkEvolutionReport(link){
 const content=modal('Relatório de Evolução · '+portName(link)),form=node('form',undefined,'forecast-form'),label=node('label','Período'),select=node('select');select.setAttribute('aria-label','Período da evolução');
 for(const [value,text]of [['1','1 dia'],['7','1 semana'],['30','1 mês']]){const option=node('option',text);option.value=value;select.append(option);}label.append(select);const button=node('button','Gerar relatório','primary-action');button.type='submit';form.append(label,button);content.append(form);
 form.onsubmit=event=>{event.preventDefault();const days=Number(select.value),now=Date.now(),start=now-days*86400000,rows=repairedRows(days,now).filter(row=>simple(row.problema)==='Link '+link+' indisponível'),stores=new Set(rows.map(row=>row.host||row.loja));
  const lines=['Olá, equipe.','','RELATÓRIO DE EVOLUÇÃO — '+portName(link),'Período: '+fullDates.format(start)+' a '+fullDates.format(now)+' (horário de Brasília).','Lojas com normalização registrada: '+stores.size,'Ocorrências encerradas no período: '+rows.length,''];
  if(!rows.length)lines.push('Nenhuma normalização registrada para esta porta no período selecionado.','');
  rows.forEach((row,index)=>{const open=incidents.some(item=>(item.host||item.loja)===(row.host||row.loja)&&simple(item.problema)==='Link '+link+' indisponível');lines.push((index+1)+'. Loja: '+storeName(row),'Código: '+row.host,'Marca: '+(brandPalette.get(brand(row))?.label??brand(row)),'Porta: '+portName(link),'Início do problema: '+fullDates.format(row.inicio),'Normalização observada: '+fullDates.format(row.fim),'Tempo com problema: '+nightDuration(row.fim-row.inicio),'Situação atual: '+(open?'há indisponibilidade em aberto nesta porta.':'sem alarme de indisponibilidade desta porta no levantamento atual.'),'');});
  lines.push('O encerramento é observado quando o alarme sai do monitoramento. Esse registro não comprova intervenção do prestador. Uma loja pode aparecer mais de uma vez se teve ocorrências distintas encerradas no período.','Histórico disponível desde '+(tracking?.inicioColeta?fullDates.format(tracking.inicioColeta):'o início da coleta do portal')+'. Não inclui ocorrências anteriores ao histórico disponível.');
  if(tracking?.aviso||tracking?.ultimaColeta&&now-tracking.ultimaColeta>900000)lines.push('ATENÇÃO: o histórico apresenta pendência de atualização. Confira os dados antes de compartilhar.');lines.push('',reportSignature);reportMessage('Relatório de Evolução · '+portName(link),lines.join('\n'));
 };
}
function renderRepaired(content){
 document.querySelector('h1').textContent='Evolução de links reparados';
 document.querySelector('#subtitulo').textContent='Links que deixaram de apresentar o problema no monitoramento.';
 const box=surface('report-page'),filters=node('div',undefined,'log-filters'),select=node('select'),search=node('input'),summary=node('p',undefined,'subtext'),list=node('div',undefined,'table-scroll');
 select.setAttribute('aria-label','Período dos links reparados');
 for(const [value,label]of [['1','Último dia'],['7','Última semana'],['30','Último mês']]){const option=node('option',label);option.value=value;select.append(option);}select.value=repairedDays;
 search.type='search';search.placeholder='Buscar loja, código ou marca';search.setAttribute('aria-label','Buscar links reparados');search.value=repairedQuery;
 function update(){
  const term=repairedQuery.trim().toLowerCase(),rows=repairedRows(Number(repairedDays)).filter(row=>(storeName(row)+' '+row.host+' '+brand(row)).toLowerCase().includes(term));
  summary.textContent=rows.length+' ocorrências encerradas · '+new Set(rows.map(row=>row.host||row.loja)).size+' lojas';
  const table=node('table'),head=table.createTHead().insertRow();for(const label of ['Loja','Código','Marca','Problema anterior','Início do problema','Normalização observada','Tempo com problema'])head.append(node('th',label));const body=table.createTBody();
  for(const row of rows){const tr=body.insertRow();for(const value of [storeName(row),row.host,brand(row),simple(row.problema),fullDates.format(row.inicio),fullDates.format(row.fim),offlineDuration((row.fim-row.inicio)/86400000)])tr.insertCell().textContent=presentLinks(value);}
  if(!rows.length){const cell=body.insertRow().insertCell();cell.colSpan=7;cell.textContent='Nenhum link reparado registrado no período selecionado.';}list.replaceChildren(table);
 }
 select.onchange=()=>{repairedDays=select.value;update();};search.oninput=()=>{repairedQuery=search.value;update();};filters.append(select,search);
 box.append(filters,summary,node('p','A normalização é identificada quando o alarme sai da lista; não confirma intervenção técnica. Lojas pausadas são excluídas. Histórico disponível desde '+(tracking?.inicioColeta?fullDates.format(tracking.inicioColeta):'o início da coleta')+'.','history-notice'),list);content.append(box);update();
}

let rankingDays=['1','7','30','92'].includes(params.get('dias'))?params.get('dias'):'30',rankingSort='quedas',rankingGroup='link',rankingSearch='';
function rankingRows(days,group,sort){
 let rows=reportRows(days);if(group==='loja'){
  const stores=new Map();for(const row of rows){const key=row.host||row.loja;if(!stores.has(key))stores.set(key,{...row,count:0,days:0,intervals:[],links:new Set(),open:false});const store=stores.get(key);store.count+=row.count;store.intervals.push(...row.intervals);store.links.add(row.link);store.open||=row.open;}
  rows=[...stores.values()].map(row=>{let total=0,last=null;for(const [a,b]of row.intervals.sort((a,b)=>a[0]-b[0])){if(last&&a<=last[1])last[1]=Math.max(last[1],b);else{if(last)total+=last[1]-last[0];last=[a,b];}}if(last)total+=last[1]-last[0];return {...row,days:total/86400000};});
 }
 return rows.sort((a,b)=>sort==='tempo'?b.days-a.days||b.count-a.count:b.count-a.count||b.days-a.days);
}
function renderRanking(content){
 document.querySelector('h1').textContent='Ranking de lojas e links recorrentes';document.querySelector('#subtitulo').textContent='Priorize a análise dos links com mais quedas superiores a 24 horas e maior tempo de indisponibilidade.';
 const box=surface('report-page'),filters=node('div',undefined,'log-filters'),list=node('div',undefined,'table-scroll'),summary=node('p',undefined,'subtext'),note=node('p',undefined,'history-notice');
 const makeSelect=(label,options,value)=>{const select=node('select');select.setAttribute('aria-label',label);for(const [key,text]of options){const option=node('option',text);option.value=key;select.append(option);}select.value=value;filters.append(select);return select;};
 const periodSelect=makeSelect('Período do ranking',[[30,'Últimos 30 dias'],[7,'Última semana'],[1,'Último dia'],[92,'Últimos três meses']],rankingDays),groupSelect=makeSelect('Agrupar ranking',[['link','Por link'],['loja','Por loja']],rankingGroup),sortSelect=makeSelect('Ordenar ranking',[['quedas','Mais quedas'],['tempo','Mais tempo offline']],rankingSort),search=node('input');search.type='search';search.placeholder='Buscar loja, código ou marca';search.setAttribute('aria-label','Buscar no ranking');search.value=rankingSearch;filters.append(search);
 function update(){const term=search.value.trim().toLowerCase(),rows=rankingRows(Number(rankingDays),rankingGroup,rankingSort).map((row,index)=>({...row,position:index+1})).filter(row=>(storeName(row)+' '+row.host+' '+brand(row)).toLowerCase().includes(term));const table=node('table'),head=table.createTHead().insertRow();for(const label of ['Posição','Loja / código',rankingGroup==='loja'?'Links identificados':'Link','Quedas > 24 h',rankingGroup==='loja'?'Tempo com algum link offline':'Tempo total offline','Relatório'])head.append(node('th',label));const body=table.createTBody();
  for(const row of rows){const tr=body.insertRow();tr.insertCell().textContent=row.position+'º';const name=tr.insertCell();name.append(node('strong',storeName(row)),node('small',row.host+' · '+brand(row)));for(const value of [rankingGroup==='loja'?[...row.links].sort().map(n=>'Link '+n).join(', '):'Link '+row.link,row.count,offlineDuration(row.days)])tr.insertCell().textContent=presentLinks(value);const actions=node('div',undefined,'tracking-actions'),report=node('button','Gerar relatório da loja','quiet');report.onclick=()=>storeIncidentMessage(row,Number(rankingDays));actions.append(report);if(rankingGroup==='link'){const replace=node('button','Solicitar troca de link','quiet');replace.onclick=()=>storeIncidentMessage(row,Number(rankingDays),true);actions.append(replace);}tr.insertCell().append(actions);}
  if(!rows.length){const cell=body.insertRow().insertCell();cell.colSpan=6;cell.textContent='Nenhuma queda superior a 24 horas registrada para este filtro.';}list.replaceChildren(table);summary.textContent=rows.length+' '+(rankingGroup==='loja'?'lojas':'links')+' · ordem por '+(rankingSort==='tempo'?'tempo offline':'quantidade de quedas')+'.';note.textContent='Histórico por loja disponível desde '+(tracking?.inicioColeta?fullDates.format(tracking.inicioColeta):'o início da coleta')+'. Quedas encerradas antes da coleta não estão incluídas. Considera as quedas superiores a 24 horas que afetaram o período; o tempo é limitado ao período selecionado. Lojas pausadas são excluídas.'+(rankingGroup==='loja'?' Por loja, as quedas dos links são somadas; horários simultâneos contam uma só vez no tempo offline.':'');
 }
 periodSelect.onchange=()=>{rankingDays=periodSelect.value;update();};groupSelect.onchange=()=>{rankingGroup=groupSelect.value;update();};sortSelect.onchange=()=>{rankingSort=sortSelect.value;update();};search.oninput=()=>{rankingSearch=search.value;update();};box.append(filters,summary,note,list);content.append(box);update();
}

function renderIncidentReport(content){
 const pageHeading=document.querySelector('.page-heading');pageHeading.querySelector('.ranking-entry')?.remove();pageHeading.append(rankingCard());
 document.querySelector('h1').textContent='Relatório geral de incidentes';document.querySelector('#subtitulo').textContent='Links com quedas superiores a 24 horas. Cada queda é contada uma vez por período; o tempo offline continua aumentando enquanto estiver aberta.';
 const box=surface('report-page'),filters=node('div',undefined,'log-filters'),select=node('select'),search=node('input');for(const [value,label]of [[30,'Último mês (30 dias)'],[7,'Última semana'],[1,'Último dia'],[92,'Últimos três meses']]){const option=node('option',label);option.value=value;select.append(option);}select.setAttribute('aria-label','Período do relatório');search.type='search';search.placeholder='Buscar loja ou código';search.setAttribute('aria-label','Buscar loja no relatório');select.value=reportPeriod;search.value=reportQuery;
 const notice=node('p',undefined,'history-notice');notice.textContent=tracking?.inicioColeta?'Histórico coletado desde '+fullDates.format(tracking.inicioColeta)+'. Inclui os alarmes já abertos nessa data; quedas encerradas antes da coleta não estão disponíveis. Atualização automática a cada 5 minutos. O encerramento é o horário em que a saída da lista foi observada.':'O histórico ainda está sendo iniciado.';
 const summary=node('p',undefined,'subtext'),scroll=node('div',undefined,'table-scroll'),table=node('table'),head=table.createTHead().insertRow();for(const title of ['Loja / código','Link','Quedas > 24 h','Total de dias offline','Situação','Relatórios'])head.append(node('th',title));const body=table.createTBody();scroll.append(table);
 function update(){const term=search.value.toLowerCase(),rows=reportRows(Number(select.value)).filter(row=>(storeName(row)+' '+row.host).toLowerCase().includes(term));body.replaceChildren();for(const row of rows){const tr=body.insertRow(),name=tr.insertCell();name.append(node('strong',storeName(row)),node('small',row.host+' · '+brand(row)));for(const value of ['Link '+row.link,row.count,format.format(row.days)+' dias',row.open?'Em aberto':'Encerrado'])tr.insertCell().textContent=presentLinks(value);const actions=tr.insertCell(),buttons=node('div',undefined,'tracking-actions'),total=node('button','Gerar relatório total','quiet'),replace=node('button','Solicitar troca de link','quiet');total.onclick=()=>storeIncidentMessage(row,Number(select.value));replace.onclick=()=>storeIncidentMessage(row,Number(select.value),true);buttons.append(total,replace);actions.append(buttons);}summary.textContent=rows.length+' links · contagem das quedas que afetaram o período selecionado. Dias offline somados somente dentro desse período.';if(!rows.length){const cell=body.insertRow().insertCell();cell.colSpan=6;cell.textContent='Nenhuma queda superior a 24 horas registrada neste período.';}}
 select.onchange=()=>{reportPeriod=select.value;update();};search.oninput=()=>{reportQuery=search.value;update();};filters.append(select,search);box.append(filters,notice,summary,scroll);content.append(box);update();
}

let nightQuery='';
function nightDuration(ms){const minutes=Math.floor(ms/60000);return Math.floor(minutes/60)+' h e '+minutes%60+' min';}
function nightGroups(){const groups=new Map();for(const night of tracking?.noites??[]){const key=night.host||night.loja;if(!groups.has(key))groups.set(key,{...night,nights:[]});groups.get(key).nights.push(night);}for(const control of tracking?.controles??[]){if(!groups.has(control.host))groups.set(control.host,{host:control.host,loja:control.loja,nights:[]});}return [...groups.values()].filter(store=>!isPaused(store)).sort((a,b)=>b.nights.length-a.nights.length||a.loja.localeCompare(b.loja));}
function nightCard(){const box=surface('incident-report-card'),link=node('a',undefined,'card-link');link.href='./?tela=desligamentos&v=47';link.append(heading('Relatórios desligamentos indevidos'),node('p','FortiGate sem comunicação por mais de 3 horas entre 22h e 10h · ocorrências por loja e marca','subtext'));box.append(link);return box;}
function nightDate(value){return value.split('-').reverse().join('/');}
function nightReport(store){
 const rows=[...store.nights].sort((a,b)=>b.data.localeCompare(a.data));
 const lines=['Olá, gerente da loja '+storeName(store)+'.','','Identificamos períodos prolongados em que o FortiGate da loja ficou sem comunicação durante a madrugada. Pedimos que confira o motivo e oriente a equipe a manter os equipamentos de internet e os computadores ligados após o expediente.','','Loja: '+storeName(store),'Código: '+store.host,'Ocorrências desde 21/11/2026: '+rows.length,''];
 for(const night of rows)lines.push('• Manhã de '+nightDate(night.data)+': '+fullDates.format(night.inicio)+' até '+fullDates.format(night.fim)+' — '+nightDuration(night.duracao)+'.');
 lines.push('','A regra considera mais de três horas contínuas sem comunicação entre 22h e 10h (Brasília), uma ocorrência por loja em cada noite. O monitoramento indica indisponibilidade; ele não confirma que o equipamento foi desligado.','','O desligamento interrompe processos de atualização dos sistemas e das informações da loja realizados de madrugada. Desligamentos abruptos, especialmente durante atualizações, podem comprometer o funcionamento dos equipamentos e a integridade dos dados.','','Caso haja manutenção no shopping ou seja necessário desligar algum equipamento, avise previamente o time de T.I. Lojas para orientarmos o procedimento.','','Agradecemos a colaboração.',reportSignature);
 reportMessage('Relatório para a gerente · '+storeName(store),lines.join('\n'));
}
function showTotalNightReport(){
 const content=modal('Gerar relatório total'),form=node('form',undefined,'forecast-form'),label=node('label','Período'),select=node('select');select.setAttribute('aria-label','Período do relatório total');
 for(const [value,text]of [['1','1 dia'],['7','1 semana'],['30','1 mês'],['total','Total — todos os dias']]){const option=node('option',text);option.value=value;select.append(option);}label.append(select);const button=node('button','Gerar relatório','quiet');button.type='submit';form.append(label,button);content.append(form);form.onsubmit=event=>{event.preventDefault();totalNightReport(select.value);};
}
function totalNightReport(days=1){
 // A noite pertence à data da manhã, conforme o contador existente, em Brasília.
 const today=new Date(Date.now()-3*3600000).toISOString().slice(0,10),first=days==='total'?null:new Date(Date.parse(today+'T00:00:00Z')-(Number(days)-1)*86400000).toISOString().slice(0,10);
 const stores=nightGroups().map(store=>({...store,nights:store.nights.filter(night=>(!first||night.data>=first)&&night.data<=today)})).filter(store=>store.nights.length),total=stores.reduce((sum,store)=>sum+store.nights.length,0);
 const lines=['Olá, equipe.','','RELATÓRIO TOTAL — OCORRÊNCIAS NOTURNAS','Período: '+(first?nightDate(first)+' a '+nightDate(today)+' · '+({'1':'1 dia','7':'1 semana','30':'1 mês'}[days]):'Total — todos os dias do histórico disponível')+'. Datas referentes à manhã de cada ocorrência.','Levantamento: '+fullDates.format(Date.now())+' (horário de Brasília).','Lojas identificadas: '+stores.length,'Total de ocorrências (loja/noite): '+total,''];
 if(!stores.length)lines.push('Nenhuma ocorrência noturna registrada.','');
 for(const [index,store]of stores.entries()){
  lines.push((index+1)+'. Loja: '+storeName(store),'Código: '+store.host,'Marca: '+(brandPalette.get(brand(store))?.label??brand(store)),'Noites identificadas: '+store.nights.length);
  for(const night of [...store.nights].sort((a,b)=>b.data.localeCompare(a.data)))lines.push('• Manhã de '+nightDate(night.data)+': '+fullDates.format(night.inicio)+' até '+fullDates.format(night.fim)+' — '+nightDuration(night.duracao)+' sem comunicação.');
  lines.push('');
 }
 lines.push('Os registros consideram mais de três horas contínuas sem comunicação do FortiGate entre 22h e 10h, no horário de Brasília, com no máximo uma ocorrência por loja em cada noite. A perda de comunicação não comprova desligamento; é necessário verificar a causa de cada caso.','','Solicitamos a verificação das lojas relacionadas e a orientação das equipes para manter os equipamentos de internet e computadores ligados após o expediente, permitindo as atualizações noturnas. Caso haja manutenção no shopping ou necessidade de desligamento, avise previamente o time de T.I. Lojas.','',reportSignature);
 reportMessage('Relatório total · Ocorrências noturnas',lines.join('\n'));
}
function showBrandNightReport(){
 const content=modal('Gerar relatório por marca'),form=node('form',undefined,'forecast-form'),label=node('label','Marca'),select=node('select');select.setAttribute('aria-label','Marca do relatório');const groups=nightGroups(),brands=[...new Set(groups.map(brand))].sort();
 for(const name of brands){const option=node('option',brandPalette.get(name)?.label??name);option.value=name;select.append(option);}label.append(select);const button=node('button','Gerar relatório','quiet');button.type='submit';button.disabled=!brands.length;form.append(label,button);content.append(form);if(!brands.length)content.append(node('p','Nenhuma ocorrência noturna registrada.','empty'));
 form.onsubmit=event=>{event.preventDefault();const name=select.value,stores=groups.filter(store=>brand(store)===name),lines=['Olá, supervisoras da marca '+(brandPalette.get(name)?.label??name)+'.','','Compartilhamos os registros de lojas cujo FortiGate ficou sem comunicação por mais de três horas contínuas entre 22h e 10h, no horário de Brasília. Solicitamos a verificação dos motivos e a orientação das equipes para manter os equipamentos ligados após o expediente.','','Período de contagem: desde 21/11/2026.','Lojas identificadas: '+stores.length,'Ocorrências (loja/noite): '+stores.reduce((sum,store)=>sum+store.nights.length,0),''];
  stores.forEach((store,index)=>lines.push((index+1)+'. '+storeName(store)+' — '+store.host,'Número de vezes: '+store.nights.length,'Manhãs registradas: '+[...store.nights].sort((a,b)=>a.data.localeCompare(b.data)).map(n=>nightDate(n.data)).join(', '),''));
  lines.push('A indisponibilidade noturna interfere diretamente na preparação das operações de venda: interrompe atualizações de sistemas, informações e relatórios de vendas de cada loja. Desligamentos abruptos durante esses processos também podem comprometer os equipamentos de T.I. e a integridade dos dados.','','Se houver manutenção do shopping ou necessidade de desligamento, o time de T.I. Lojas deve ser avisado previamente para organizar o procedimento e reduzir os impactos.','','Os registros indicam perda de comunicação e não comprovam desligamento de energia. Pedimos confirmar cada caso antes de atribuir a causa à equipe da loja.','',reportSignature);reportMessage('Relatório por marca · '+(brandPalette.get(name)?.label??name),lines.join('\n'));
 };
}
function showNightLog(store){
 const content=modal('Log da loja · '+storeName(store));content.append(node('p','Código: '+store.host),node('p',store.nights.length+' noites identificadas desde 21/11/2026.','subtext'));
 for(const night of [...store.nights].sort((a,b)=>b.data.localeCompare(a.data))){const item=node('article',undefined,'ticket-entry');item.append(node('strong','Noite identificada pela manhã de '+nightDate(night.data)),node('p','Início no período noturno: '+fullDates.format(night.inicio)),node('p','Último horário registrado nessa noite: '+fullDates.format(night.fim)),node('p','Tempo sem comunicação: '+nightDuration(night.duracao)));content.append(item);}
 const remove=node('button','Excluir log da loja','quiet');remove.disabled=!store.nights.length;remove.onclick=()=>confirmStoreControl(store,'zerar');content.append(remove);content.append(node('p','Cada registro representa uma noite com mais de três horas contínuas de indisponibilidade. Os horários se limitam à janela das 22h às 10h, no horário de Brasília.','subtext'));
}
function renderNightReport(content){
 document.querySelector('h1').textContent='Relatórios desligamentos indevidos';
 const pageHeading=document.querySelector('.page-heading');pageHeading.classList.add('night-page-heading');pageHeading.querySelector('.night-brand-pie')?.remove();
 const uniqueStores=nightGroups().filter(store=>store.nights.length&&!isPaused(store)),pie=smallPie('Lojas por marca · '+uniqueStores.length,brandSlices(uniqueStores),'loja','lojas');pie.classList.add('night-brand-pie');pageHeading.append(pie);document.querySelector('#subtitulo').textContent='Suspeitas de desligamento: FortiGate sem comunicação por mais de 3 horas contínuas entre 22h e 10h (Brasília).';
 const box=surface('report-page'),toolbar=node('div',undefined,'log-filters'),search=node('input'),button=node('button','Gerar relatório por marca','quiet');search.type='search';search.placeholder='Buscar loja, código ou marca';search.setAttribute('aria-label','Buscar loja no relatório noturno');search.value=nightQuery;button.onclick=showBrandNightReport;const total=node('button','Gerar relatório total','quiet');total.onclick=showTotalNightReport;toolbar.append(search,button,total);
 const summary=node('p',undefined,'subtext'),scroll=node('div',undefined,'table-scroll'),table=node('table'),head=table.createTHead().insertRow();for(const title of ['Nome da loja','Código da loja','Marca','Noites identificadas','Última ocorrência','Ações'])head.append(node('th',title));const body=table.createTBody();scroll.append(table);
 function update(){const term=search.value.trim().toLowerCase(),all=nightGroups(),rows=all.filter(store=>(storeName(store)+' '+store.host+' '+brand(store)).toLowerCase().includes(term));body.replaceChildren();for(const store of rows){const latest=[...store.nights].sort((a,b)=>b.data.localeCompare(a.data))[0],tr=body.insertRow(),name=tr.insertCell();name.append(node('strong',storeName(store)));if(isPaused(store))name.append(node('small','Monitoramento Pausado'));for(const value of [store.host+(store.host==='SOM078F1'?' (Loja Duplicada)':''),brandPalette.get(brand(store))?.label??brand(store),store.nights.length,latest?nightDate(latest.data):'—'])tr.insertCell().textContent=presentLinks(value);const action=node('button','Gerar relatório','quiet');action.onclick=()=>nightReport(store);const log=node('button','Log da loja','quiet'),actions=node('div',undefined,'tracking-actions');log.onclick=()=>showNightLog(store);action.disabled=!store.nights.length;actions.append(action,log,...monitoringButtons(store).children);tr.insertCell().append(actions);}summary.textContent=rows.length+' lojas · '+rows.reduce((sum,store)=>sum+store.nights.length,0)+' ocorrências desde o início da contagem.';if(!rows.length){const cell=body.insertRow().insertCell();cell.colSpan=6;cell.textContent='Nenhuma ocorrência registrada para este filtro.';}}
 search.oninput=()=>{nightQuery=search.value;update();};box.append(toolbar,summary,scroll);content.append(box);update();
}

let pausedQuery='';
function monitoringCards(){
 const grid=node('div',undefined,'monitoring-cards');grid.setAttribute('aria-label','Relatórios e acompanhamento');
 const paused=tracking?.controles?.filter(store=>store.pausado)??[],late=lateCases();
 for(const [title,total,caption,page,icon]of [
  ['Acompanhamento de chamados',late.length,'problemas com previsão vencida','logs','◷'],
  ['Relatório geral de incidentes',reportRows(92).length,'links com quedas superiores a 24 h','relatorio','↗'],
  ['Relatórios desligamentos indevidos',nightGroups().filter(store=>store.nights.length&&!isPaused(store)).length,'lojas com ocorrências noturnas','desligamentos','☾'],
  ['Monitoramento lojas pausadas',paused.length,'lojas com monitoramento pausado','pausadas','Ⅱ'],
 ]){const card=node('a',undefined,'surface monitoring-card');card.href='./?tela='+page+'&v=47';card.append(node('span',icon,'monitoring-icon'),heading(title),node('strong',tracking?total:'—','monitoring-total'),node('p',caption,'subtext'),node('span','Abrir →','monitoring-open'));grid.append(card);}
 return grid;
}
function renderPausedStores(content){
 document.querySelector('h1').textContent='Monitoramento lojas pausadas';document.querySelector('#subtitulo').textContent='Lojas temporariamente retiradas dos incidentes e da coleta noturna. Reative quando o acompanhamento puder voltar.';
 const box=surface('report-page'),search=node('input'),filters=node('div',undefined,'log-filters'),scroll=node('div',undefined,'table-scroll'),table=node('table'),head=table.createTHead().insertRow(),summary=node('p',undefined,'subtext');search.type='search';search.placeholder='Buscar loja, código ou marca';search.setAttribute('aria-label','Buscar loja pausada');search.value=pausedQuery;
 for(const title of ['Nome da loja','Código da loja','Marca','Pausado desde','Pausa até','Motivo','Ações'])head.append(node('th',title));const body=table.createTBody();
 function update(){const term=search.value.trim().toLowerCase(),rows=(tracking?.controles??[]).filter(store=>store.pausado&&[storeName(store),store.host,brand(store)].join(' ').toLowerCase().includes(term)).sort((a,b)=>a.loja.localeCompare(b.loja));body.replaceChildren();for(const store of rows){const row=body.insertRow();row.insertCell().append(node('strong',storeName(store)));for(const value of [store.host+(store.host==='SOM078F1'?' (Loja Duplicada)':''),brandPalette.get(brand(store))?.label??brand(store),store.pausadoEm?fullDates.format(store.pausadoEm):'—',store.pausadoAte?fullDates.format(store.pausadoAte-1):'Indefinidamente',store.motivo==='falso_positivo'?'Falso positivo':'Manutenção / pausa'])row.insertCell().textContent=value;row.insertCell().append(monitoringButtons(store));}summary.textContent=rows.length+' lojas pausadas';if(!rows.length){const cell=body.insertRow().insertCell();cell.colSpan=7;cell.textContent='Nenhuma loja pausada para este filtro.';}}
 search.oninput=()=>{pausedQuery=search.value;update();};filters.append(search);scroll.append(table);box.append(filters,summary,scroll);content.append(box);update();
}

function dailyProblem(row,peers){
 const label=simple(row.problema);if(['Uma conexão indisponível','Link 2 indisponível'].includes(label))return 'Um dos links indisponíveis';
 const match=/^Link ([12]) com perda de dados$/.exec(label);if(!match)return label;
 const start=item=>Number.isFinite(item.inicio)?item.inicio:timestamp(item.horario);
 const both=peers.some(other=>(other.host||other.loja)===(row.host||row.loja)&&simple(other.problema)==='Link '+(match[1]==='1'?'2':'1')+' com perda de dados'&&Math.min(row.fim??Date.now(),other.fim??Date.now())-Math.max(start(row),start(other))>7200000);
 return both?'Os dois links estão com intermitência':'Um dos links com intermitência';
}
function dailySummary(now=Date.now()){
 const day=new Date(now-10800000).toISOString().slice(0,10),midnight=Date.parse(day+'T00:00:00-03:00'),localDate=day.split('-').reverse().join('/');
 const active=incidents.filter(row=>!isPaused(row)),offline=new Map();for(const row of active.filter(row=>simple(row.problema)==='Firewall não responde ao monitoramento'))offline.set(row.host||row.loja,row);
 const fresh=(tracking?.eventos??[]).filter(row=>!isPaused(row)&&eligibleIncident(row,now)&&row.inicio>=midnight&&row.inicio<=now),resolved=(tracking?.eventos??[]).filter(row=>!isPaused(row)&&eligibleIncident(row,now)&&row.fim>=midnight&&row.fim<=now),late=lateCases();
 const lines=['Olá, equipe.','','RESUMO DIÁRIO — '+localDate,'Levantamento: '+fullDates.format(now)+' (horário de Brasília).','','Lojas offline agora: '+offline.size,'Problemas com previsão vencida: '+late.length,'Novos incidentes no dia: '+fresh.length,'Casos resolvidos no dia: '+resolved.length,''];
 const entry=row=>storeName(row)+' — '+row.host+' · '+dailyProblem(row,tracking?.eventos??active);
 lines.push('LOJAS OFFLINE');if(!offline.size)lines.push('Nenhuma loja com FortiGate sem comunicação neste levantamento.');for(const row of offline.values())lines.push('• '+storeName(row)+' — '+row.host+' · desde '+(Number.isFinite(timestamp(row.horario))?fullDates.format(timestamp(row.horario)):'horário indisponível'));lines.push('');
 lines.push('PREVISÕES VENCIDAS');if(!late.length)lines.push('Nenhuma previsão vencida para problemas ainda abertos.');for(const row of late){lines.push('• '+entry(row));for(const ticket of overdue(row))lines.push('  Chamado '+ticket.numero+' · analista '+ticket.analista+' · previsão '+nightDate(ticket.previsao));}lines.push('');
 lines.push('NOVOS INCIDENTES NO DIA');if(!fresh.length)lines.push('Nenhum novo incidente registrado no período disponível.');for(const row of fresh.sort((a,b)=>a.inicio-b.inicio))lines.push('• '+entry(row)+' · início '+fullDates.format(row.inicio)+(row.fim?' · O problema foi resolvido':' · em aberto'));lines.push('');
 lines.push('CASOS RESOLVIDOS');if(!resolved.length)lines.push('Nenhum problema resolvido registrado no período disponível.');for(const row of resolved.sort((a,b)=>a.fim-b.fim))lines.push('• '+entry(row)+' · saída observada em '+fullDates.format(row.fim));
 lines.push('');if(tracking?.inicioColeta)lines.push('Histórico do portal disponível desde '+fullDates.format(tracking.inicioColeta)+'. Encerramentos são identificados pela saída do alarme da lista e devem ser confirmados quando necessário.');if(tracking?.ultimaColeta)lines.push('Última coleta do histórico: '+fullDates.format(tracking.ultimaColeta)+'.');if(tracking?.aviso||tracking?.ultimaColeta&&now-tracking.ultimaColeta>900000)lines.push('ATENÇÃO: há pendência de atualização; confira os dados antes de compartilhar.');lines.push('',reportSignature);return lines.join('\n');
}

function render(){
 const daily=document.querySelector('.daily-report');if(daily)daily.disabled=!tracking;
 const focused=document.activeElement?.id,selection=document.activeElement?.selectionStart;
 for(const chart of charts)chart.destroy();charts=[];
 const content=document.querySelector('#conteudo');content.replaceChildren();
 const subtitle=document.querySelector('#subtitulo'),title=document.querySelector('h1');
 const stores=new Set(incidents.map(row=>row.host||row.loja)).size;
 if(['logs','relatorio','desligamentos','pausadas','ranking','reparados','cadastro'].includes(trackingPage)){
  const back=node('a','‹ Visão geral','back');back.href='./?v=47';content.append(back);
  if(trackingPage==='cadastro')renderCadastro(content);else if(trackingPage==='reparados')renderRepaired(content);else if(trackingPage==='ranking')renderRanking(content);else if(trackingPage==='pausadas')renderPausedStores(content);else if(trackingPage==='logs'){content.append(logCard());renderLogs(content);}else if(trackingPage==='desligamentos')renderNightReport(content);else renderIncidentReport(content);
 }else if(brandPage||problemPage){
  const valid=problemPage
   ? isOtherProblem||(requestedProblem.length>0&&requestedProblem.length<=500)
   : brandLogos.has(requestedBrand)||requestedBrand==='OUTRAS';
  title.textContent=presentLinks(problemPage ? (valid?(isOtherProblem?'Outros problemas':requestedProblem):'Problema não encontrado') : (valid?'Casos da marca '+requestedBrand:'Marca não encontrada'));
  if(!valid){subtitle.textContent='Selecione um item pela visão geral.';return;}
  const rows=dualPage?dualLinkRows():rowsFor().filter(row=>problemPage?matchesProblem(row):brand(row)===requestedBrand);
  subtitle.textContent=new Set(rows.map(row=>row.host||row.loja)).size+' lojas afetadas · '+rows.length+' ocorrências abertas';
  let back=document.querySelector('.back');
  if(!back){back=node('a','‹ Visão geral','back');back.href=problemPage?'./?v=47#tipos-problemas':'./?v=47#lojas';document.querySelector('.page-heading').before(back);}
  const summary=node('div',undefined,'brand-summary');
  for(const [label,value]of [['Ocorrências abertas',rows.length],['Lojas afetadas',new Set(rows.map(row=>row.host||row.loja)).size],['Caso mais antigo',rows.length?age(rows[0]):'—']]){
    const card=surface('detail-kpi');card.append(node('p',label),node('strong',value));summary.append(card);
  }
  const evolutionLink=problemPage?/^Link ([12]) indisponível$/.exec(requestedProblem)?.[1]:null;if(evolutionLink){const tools=node('div',undefined,'log-filters'),button=node('button','Relatório de Evolução','quiet');button.onclick=()=>linkEvolutionReport(evolutionLink);tools.append(button);content.append(tools);}
  content.append(summary,tablePanel(problemPage?undefined:requestedBrand,dualPage?undefined:problemPage?matchesProblem:undefined,dualPage?rows:undefined));
 }else if(detail){
  if(!category){title.textContent='Prioridade indisponível';return;}
  title.textContent=category.title;subtitle.textContent='Ocorrências abertas nas lojas desta prioridade';
  let back=document.querySelector('.back');if(!back){back=node('a','‹ Visão geral','back');back.href='./?from='+period+'&v=47';document.querySelector('.page-heading').before(back);}
  const titleBox=title.parentElement;if(!titleBox.parentElement.classList.contains('detail-title')){const wrapper=colored(node('div',undefined,'detail-title'),category);titleBox.before(wrapper);wrapper.append(node('span','⚠','detail-icon'),titleBox);}
  const rows=rowsFor(category),top=node('div',undefined,'detail-top'),kpis=node('div',undefined,'detail-kpis');
  const counts=[['Ocorrências agora',rows.length],['Lojas afetadas',new Set(rows.map(row=>row.host||row.loja)).size],['Mais antiga',rows.length?age(rows[0]):'—'],['Mais recente',rows.length?age(rows.at(-1)):'—']];
  counts.forEach(([label,value],index)=>{const kpi=surface('detail-kpi');const metric=node('strong',value);if(index===2)metric.style.color=category.color;kpi.append(node('p',label),metric);if(index>=2&&rows.length)kpi.append(node('small',storeName(index===2?rows[0]:rows.at(-1))));kpis.append(kpi);});
  top.append(kpis,chartPanel(category));content.append(top,detailStores());
 }else{
  title.textContent='Saúde da rede das lojas';subtitle.textContent=stores+' lojas com ocorrência · '+incidents.length+' ocorrências abertas · Firewalls monitorados via Grafana';
  const chartsRow=node('div',undefined,'chart-layout');chartsRow.append(chartPanel(),distribution());
  const support=node('div',undefined,'support-layout');const right=node('div',undefined,'support-right');right.append(oldestPanel(),monitoringCards());support.append(brandPanel(),right);content.append(statCards(),chartsRow,support,tablePanel());
  const links=node('div');links.id='links';content.append(links);
 }
 if(focused==='search-stores'){const input=document.querySelector('#search-stores');input?.focus();input?.setSelectionRange(selection,selection);}
}
async function refresh(){
 clearTimeout(timer);activeRequest?.abort();const controller=new AbortController();activeRequest=controller;
 try{
  const options={headers:{Authorization:'Bearer '+sessionStorage.getItem(sessionKey)},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(45000)])};
  if(trackingPage==='cadastro'){cadastro=await api('/api/cadastro',options);if(controller.signal.aborted)return;updated=Date.now();status.textContent='';render();return;}
  const [summary,problems]=await Promise.all([api('/api/resumo?from='+period+'&to=now',options),api('/api/problemas',options)]);
  if(controller.signal.aborted)return;panels=summary.paineis;allIncidents=problems.ocorrencias;tracking=problems.acompanhamento??tracking;incidents=visibleIncidents();updated=Date.parse(summary.atualizadoEm);status.textContent=tracking?.aviso??(tracking?.ultimaColeta&&Date.now()-tracking.ultimaColeta>900000?'O histórico está sem atualização há mais de 15 minutos. Confira a última coleta antes de usar o relatório.':'');render();
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
    for(const [label,url]of [['Visão geral','./?v=47'],['Lojas e ocorrências','./?v=47#ocorrencias'],['Histórico dos problemas','./?v=47#historico']]){
      const link=node('a',label,'dialog-case');link.href=url;link.style.display='block';content.append(link);
    }
    document.querySelector('#loja-dialog').showModal();
  };
  document.querySelector('#fechar-dialog').onclick=()=>document.querySelector('#loja-dialog').close();
  setInterval(()=>{document.querySelector('#live').textContent=updated?'Ao vivo · há '+Math.max(0,Math.floor((Date.now()-updated)/1000))+' s':'Conectando…';},1000);
  refresh();
 }
}









