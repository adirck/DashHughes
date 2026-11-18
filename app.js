import { API_URL, REFRESH_SECONDS } from './config.js';

const storageKey = 'dashhughes-session';
const status = document.querySelector('#status');
const form = document.querySelector('#login');
const panel = document.querySelector('#painel');
const number = new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2});
const clock = new Intl.DateTimeFormat('pt-BR',{timeStyle:'short'});
const charts = new Map();
const ranges = new Set(['now-15m','now-1h','now-6h','now-24h']);
const chartOptions = {responsive:true,maintainAspectRatio:false,animation:false};
const states = {erro:'Consulta temporariamente indisponível.',sem_dados:'Sem dados no período.',consulta_indisponivel:'Consulta indisponível para o portal.'};
const levels = {verde:'Normal',amarelo:'Atenção',vermelho:'Crítico',limite:'Limite atingido'};

function signOut() {
  sessionStorage.removeItem(storageKey);
  window.location.replace('./login.html');
}

async function api(path,options = {}) {
  if (!API_URL) throw new Error('Conexão com o serviço de monitoramento pendente.');
  const response = await fetch(API_URL+path,{...options,cache:'no-store',signal:options.signal ?? AbortSignal.timeout(35_000)});
  if (response.status === 401 && !form) {
    signOut();
    throw new Error('Sessão encerrada.');
  }
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? 'Serviço indisponível.');
  return body;
}

function message(error) {
  return error instanceof TypeError || error.name === 'TimeoutError'
    ? 'Não foi possível conectar ao serviço de monitoramento.'
    : error.message;
}

if (form) {
  if (sessionStorage.getItem(storageKey)) window.location.replace('./');
  form.addEventListener('submit',async event => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    status.textContent = 'Validando acesso…';
    try {
      const body = await api('/api/login',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({user:form.elements.user.value,password:form.elements.password.value}),
      });
      sessionStorage.setItem(storageKey,body.token);
      window.location.replace('./');
    } catch (error) {
      status.textContent = message(error);
    } finally {
      form.elements.password.value = '';
      button.disabled = false;
    }
  });
}

function element(tag,text,classes) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (classes) node.className = classes;
  return node;
}

function disposeCharts() {
  for (const chart of charts.values()) chart.destroy();
  charts.clear();
}
const graphDate = new Intl.DateTimeFormat('pt-BR',{
  timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',
});
const hiddenPriorities = new Set();

function draw(canvas,series,detail,overview=false) {
  if (!window.Chart || !series.some(row => row.historico?.length)) return;
  const colors = ['#51b99b','#729ee9','#d79048','#b781d2','#70b9c1'];
  const theme = getComputedStyle(canvas);
  const foreground = theme.getPropertyValue('--text').trim();
  const grid = theme.getPropertyValue('--border').trim();
  const points = series.filter(row=>row.historico?.length);
  const data = {datasets:points.map((row,i)=>{
    const color = row.cor ? theme.getPropertyValue('--chart-'+row.cor).trim() || colors[i%colors.length] : colors[i%colors.length];
    return {
      label:row.nome,borderColor:color,backgroundColor:color,
      data:row.historico.map(([x,y])=>({x,y})),pointRadius:detail && row.historico.length === 1?4:0,
      pointHoverRadius:5,borderWidth:2,stepped:true,
      hidden:overview && hiddenPriorities.has(row.nome),
    };
  })};
  const chart = new window.Chart(canvas,{
    type:'line',data,
    options:{...chartOptions,parsing:false,interaction:{mode:'nearest',axis:'x',intersect:false},
      scales:{
        x:{type:'linear',display:detail,grid:{color:grid},
          title:{display:detail,text:'Data e hora (Brasília)',color:foreground},
          ticks:{maxTicksLimit:6,color:foreground,callback:value=>graphDate.format(value)}},
        y:{display:detail,beginAtZero:true,grid:{color:grid},
          title:{display:detail,text:'Número de problemas',color:foreground},
          ticks:{color:foreground,precision:0}},
      },
      plugins:{legend:{display:detail,labels:{color:foreground,usePointStyle:true,boxWidth:10},
        ...(overview ? {onClick:(_event,item,legend)=>{
          const chart = legend.chart;
          const index = item.datasetIndex;
          const visible = chart.isDatasetVisible(index);
          if (visible) hiddenPriorities.add(item.text);
          else hiddenPriorities.delete(item.text);
          chart.setDatasetVisibility(index,!visible);
          chart.update();
        }} : {})},
        tooltip:{enabled:detail,callbacks:{
          title:items=>inicioFormatter.format(items[0].parsed.x),
          label:item=>item.dataset.label+': '+number.format(item.parsed.y),
        }},
      },
    },
  });
  charts.set(canvas,chart);
}

function drawOverview(panels,visible) {
  const section = document.querySelector('#evolucao');
  if (!section) return;
  section.hidden = !visible;
  if (!visible) return;
  const message = section.querySelector('#evolucao-status');
  const wrap = section.querySelector('.overview-chart');
  const series = panels.flatMap(panel=>{
    if (panel.estado !== 'ok') return [];
    const category = severities.get(panel.id);
    return panel.series.filter(row=>row.historico?.length).map(row=>({
      ...row,cor:category?.cor,nome:panel.series.length===1 ? headingFor(panel) : headingFor(panel)+' · '+row.nome,
    }));
  });
  wrap.hidden = !series.length || !window.Chart;
  if (wrap.hidden) {
    message.textContent = series.length ? 'Gráfico indisponível neste navegador.' : 'Sem dados históricos no período selecionado.';
    return;
  }
  message.textContent = '';
  draw(wrap.querySelector('canvas'),series,true,true);
}


function valueLabel(value,unit) {
  return number.format(value)+(unit && unit !== 'none' ? ' '+unit : '');
}
function valueRow(row,unit) {
  const line = element('div',undefined,'metric');
  line.append(element('dt',row.nome),element('dd',valueLabel(row.valor,unit)));
  if (levels[row.nivel]) line.append(element('span',levels[row.nivel],'badge '+row.nivel));
  return line;
}
function canvasFor(title,large = false) {
  const wrap = element('div',undefined,large?'chart detail-chart':'chart');
  const canvas = element('canvas');
  canvas.setAttribute('role','img');
  canvas.setAttribute('aria-label','Histórico de '+title);
  wrap.append(canvas);
  return {wrap,canvas};
}
function card(data,period,occurrences) {
  const category = severities.get(data.id);
  const node = element('article',undefined,'card priority-card');
  if (category) node.classList.add('priority-'+category.cor);
  const head = element('div',undefined,'priority-head');
  const info = element('div');
  const link = element('a',headingFor(data));
  link.href = './detalhe.html?id='+data.id+'&from='+encodeURIComponent(period)+'&v=6';
  const heading = element('h2');
  heading.append(link);
  info.append(heading);
  head.append(info);
  node.append(head);
  let canvas;
  if (data.estado === 'ok') {
    const list = element('dl');
    for (const row of data.series.slice(0,3)) list.append(valueRow(row,data.unidade));
    info.append(list);
    if (data.series.some(row => row.historico?.length)) {
      const plot = canvasFor(headingFor(data));
      canvas = plot.canvas;
      head.append(plot.wrap);
    }
  } else info.append(element('p',states[data.estado] ?? 'Dados indisponíveis.'));
  if (category) {
    const cases = element('div',undefined,'priority-cases');
    cases.dataset.painel = data.id;
    node.append(cases);
    if (occurrences) renderOldest(cases,occurrences,category);
    else cases.append(element('p',occurrences === null ? 'Lista de casos indisponível.' : 'Carregando os casos abertos…'));
  }
  return {node,canvas,series:data.series?.slice(0,3)};
}

function detailContent(data,container) {
  const title = document.querySelector('h1');
  title.textContent = headingFor(data);
  const category = severities.get(data.id);
  if (category) title.classList.add('priority-title','priority-'+category.cor);
  if (data.estado !== 'ok') {
    container.replaceChildren(element('p',states[data.estado] ?? 'Dados indisponíveis.'));
    return;
  }
  const {wrap,canvas} = canvasFor(data.titulo,true);
  const table = element('table');
  const head = table.createTHead().insertRow();
  for (const label of ['Série','Último valor','Horário','Status']) {
    const th = element('th',label);
    th.scope = 'col';
    head.append(th);
  }
  const body = table.createTBody();
  for (const row of data.series) {
    const tr = body.insertRow();
    for (const text of [row.nome,valueLabel(row.valor,data.unidade),row.timestamp === null?'—':clock.format(row.timestamp),levels[row.nivel] ?? '—']) {
      tr.insertCell().textContent = text;
    }
  }
  const scroll = element('div',undefined,'table-scroll');
  scroll.append(table);
  const hasHistory = data.series.some(row => row.historico?.length);
  container.replaceChildren(...(hasHistory && window.Chart?[wrap,scroll]:[scroll]));
  if (hasHistory) draw(canvas,data.series.map(row=>({...row,cor:category?.cor,nome:data.series.length===1?headingFor(data):row.nome})),true);
}

const severities = new Map([
  [51,{titulo:'Problemas críticos',cor:'critical',matches:['5','disaster','critical']}],
  [53,{titulo:'Prioridade Alta',cor:'high',matches:['4','high']}],
  [55,{titulo:'Prioridade Média',cor:'medium',matches:['3','average','medium']}],
  [14,{titulo:'Aviso',cor:'warning',matches:['2','warning','warn']}],
  [52,{titulo:'Informações',cor:'info',matches:['1','information','info']}],
]);
const severityLabels = {'0':'Sem classificação','1':'Informativa','2':'Aviso','3':'Média','4':'Alta','5':'Crítica',disaster:'Crítica',critical:'Crítica',high:'Alta',average:'Média',medium:'Média',
  warning:'Aviso',warn:'Aviso',information:'Informativa',info:'Informativa', 'not classified':'Sem classificação'};
const headingFor = data => severities.get(data.id)?.titulo ?? data.titulo;

const inicioFormatter = new Intl.DateTimeFormat('pt-BR',{
  timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'medium',
});
function formatarInicio(value) {
  const text = String(value ?? '').trim();
  if (!text) return '—';
  if (/^\d{10}$/.test(text)) return inicioFormatter.format(Number(text)*1000);
  if (/^\d{13}$/.test(text)) return inicioFormatter.format(Number(text));
  return text;
}

function inicioTimestamp(value) {
  const text = String(value ?? '').trim();
  if (/^\d{10}$/.test(text)) return Number(text)*1000;
  if (/^\d{13}$/.test(text)) return Number(text);
  if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(text)) {
    const time = Date.parse(text.replaceAll('/','-').replace(' ','T'));
    if (Number.isFinite(time)) return time;
  }
  return Infinity;
}
function descricaoSimples(value) {
  const texto = value.trim();
  const link = texto.match(/\bwan\s*([12])\b/i)?.[1];
  const conexao = link ? 'A conexão de internet '+link+' da loja' : 'Uma conexão da loja';
  if (/license not registered/i.test(texto)) return 'A licença do equipamento de rede da loja não foi cadastrada.';
  if (/\brestarted\b|\brebooted\b/i.test(texto)) return 'O equipamento de rede da loja reiniciou.';
  if (/\bunreachable\b|\(NoData\)/i.test(texto)) return 'O equipamento de rede da loja não responde ao monitoramento.';
  if (/highpktloss|packet loss|pkt\s*loss/i.test(texto)) return conexao+' está perdendo dados.';
  if (/\blatency\b/i.test(texto)) return conexao+' está lenta.';
  if (/\bdown\b/i.test(texto)) return conexao+' está indisponível.';
  return texto;
}

function problemText(node,value) {
  const simple = descricaoSimples(value);
  node.textContent = simple;
  if (simple !== value) node.title = value;
  return node;
}


function renderOldest(container,rows,category) {
  if (!category) return;
  const dated = rows.filter(row=>category.matches.includes(row.severidade.toLowerCase()))
    .map(row=>({row,time:inicioTimestamp(row.horario)}));
  const oldest = dated.filter(entry=>Number.isFinite(entry.time))
    .sort((a,b)=>a.time-b.time).slice(0,5);
  if (!oldest.length) {
    container.replaceChildren(element('p',dated.length
      ? 'Nenhum caso aberto com data de início disponível.'
      : 'Nenhum caso aberto nesta prioridade.'));
    return;
  }
  const list = element('ol',undefined,'oldest-list');
  for (const {row} of oldest) {
    const caseItem = element('li');
    const description = element('div');
    description.append(element('strong',row.loja),problemText(element('span',undefined,'case-problem'),row.problema));
    caseItem.append(description,element('span',formatarInicio(row.horario),'case-start'));
    list.append(caseItem);
  }
  container.replaceChildren(element('h3','Casos abertos mais antigos'),list);
}


function storeList(token,panelId,onUpdate) {
  const section = document.querySelector('#ocorrencias');
  if (!section) return;
  section.hidden = false;
  const feedback = section.querySelector('#status-ocorrencias');
  const search = section.querySelector('input');
  const tbody = section.querySelector('tbody');
  const table = section.querySelector('.table-scroll');
  const selected = severities.get(panelId);
  let rows;
  let fetchError = false;
  let limited = false;

  function renderStores() {
    if (!rows) return;
    const term = search.value.trim().toLocaleLowerCase('pt-BR');
    const filtered = rows.filter(row => (!selected || selected.matches.includes(row.severidade.toLowerCase())) &&
      (!term || [row.loja,row.host,row.problema,descricaoSimples(row.problema)].some(value => value.toLocaleLowerCase('pt-BR').includes(term))));
    tbody.replaceChildren(...filtered.map(row=>{
      const tr = document.createElement('tr');
      const place = element('th',row.loja);
      place.scope = 'row';
      if (row.host) place.append(element('small',row.host,'codigo-loja'));
      tr.append(place);
      tr.insertCell().textContent = severityLabels[row.severidade.toLowerCase()] ?? (row.severidade || '—');
      problemText(tr.insertCell(),row.problema);
      tr.insertCell().textContent = formatarInicio(row.horario);
      return tr;
    }));
    table.hidden = filtered.length === 0;
    const count = new Set(filtered.map(row => row.host || row.loja)).size;
    const summary = filtered.length
      ? new Intl.NumberFormat('pt-BR').format(count) + (count === 1 ? ' loja · ' : ' lojas · ') + filtered.length +
        (filtered.length === 1 ? ' ocorrência aberta.' : ' ocorrências abertas.')
      : term ? 'Nenhuma loja corresponde à busca.' : 'Nenhuma ocorrência aberta para esta seleção.';
    feedback.textContent = (fetchError ? 'Falha na atualização. Exibindo a última lista. ' : '') +
      summary + (limited ? ' Exibindo até 500 ocorrências.' : '');
  }
  search.addEventListener('input',renderStores);
  async function refreshStores() {
    try {
      const data = await api('/api/problemas',{headers:{Authorization:'Bearer '+token}});
      if (!Array.isArray(data.ocorrencias)) throw new Error('Lista de ocorrências indisponível.');
      rows = data.ocorrencias;
      onUpdate?.(rows);
      limited = data.limitado;
      fetchError = false;
      renderStores();
    } catch (error) {
      fetchError = true;
      if (rows) renderStores();
      else {
        feedback.textContent = message(error);
        onUpdate?.(null);
      }
    } finally {
      setTimeout(refreshStores,REFRESH_SECONDS*1000);
    }
  }
  refreshStores();
}

function setTheme() {
  const mode = localStorage.getItem('dashhughes-theme') ?? (matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');
  document.documentElement.dataset.theme = mode;
  return mode;
}

if (panel) {
  const token = sessionStorage.getItem(storageKey);
  if (!token) signOut();
  else {
    const isDetail = panel.dataset.page === 'detalhe';
    const requested = new URLSearchParams(location.search);
    const id = requested.get('id') ?? '';
    const content = document.querySelector('#cards');
    const period = document.querySelector('#periodo');
    const exit = document.querySelector('#sair');
    const theme = document.querySelector('#tema');
    const tv = document.querySelector('#tv');
    let occurrences;
    let lastData;
    let lastUpdated;
    let lastFailure = '';
    let active;
    let timer;
    let rotation;
    let view = 0;
    const originPeriod = requested.get('from');
    if (ranges.has(originPeriod)) period.value = originPeriod;
    setTheme();
    exit.hidden = false;
    exit.addEventListener('click',signOut);
    theme.hidden = false;
    theme.addEventListener('click',() => {
      localStorage.setItem('dashhughes-theme',setTheme()==='dark'?'light':'dark');
      setTheme();
      render();
    });

    function refreshStatus() {
      if (!lastUpdated) {
        document.querySelector('#atualizacao').textContent = '';
        const text = lastFailure || 'Buscando dados…';
        if (status.textContent !== text) status.textContent = text;
        return;
      }
      const elapsed = Math.max(0,Math.floor((Date.now()-lastUpdated)/1000));
      const updated = document.querySelector('#atualizacao');
      updated.textContent = 'Atualizado há '+elapsed+' s.';
      if (status.textContent !== lastFailure) status.textContent = lastFailure;
    }
    function render() {
      if (!lastData) return;
      disposeCharts();
      if (isDetail) {
        detailContent(lastData,content);
        return;
      }
      const panels = lastData.paineis;
      const tvActive = document.fullscreenElement === panel;
      drawOverview(panels,!tvActive);
      if (!panels.length) {
        content.replaceChildren(element('p','Nenhum painel disponível.'));
        return;
      }
      const shown = tvActive ? [panels[view % panels.length]] : panels;
      const tiles = shown.map(data=>card(data,period.value,occurrences));
      content.replaceChildren(...tiles.map(tile=>tile.node));
      for (const tile of tiles) if (tile.canvas) draw(tile.canvas,tile.series,false);
    }
    if (tv && document.fullscreenEnabled) {
      tv.hidden = false;
      tv.addEventListener('click',async () => {
        try {
          if (document.fullscreenElement) await document.exitFullscreen();
          else await panel.requestFullscreen();
        } catch { status.textContent = 'Tela cheia indisponível no navegador.'; }
      });
      document.addEventListener('fullscreenchange',() => {
        clearInterval(rotation);
        view = 0;
        if (document.fullscreenElement === panel) {
          tv.textContent = 'Sair do modo TV';
          rotation = setInterval(()=>{view++;render();},15_000);
        } else tv.textContent = 'Modo TV';
        render();
      });
    }
    async function refresh() {
      clearTimeout(timer);
      active?.abort();
      const current = new AbortController();
      active = current;
      try {
        const route = isDetail?'/api/paineis/'+encodeURIComponent(id):'/api/resumo';
        const data = await api(route+'?from='+encodeURIComponent(period.value)+'&to=now',{
          headers:{Authorization:'Bearer '+token},
          signal:AbortSignal.any([current.signal,AbortSignal.timeout(35_000)]),
        });
        if (current.signal.aborted) return;
        const items = isDetail?[data]:data.paineis;
        const failures = items.filter(item=>item.estado==='erro');
        if (failures.length && failures.length === items.length && lastData) {
          lastFailure = 'Consultas indisponíveis. Exibindo os últimos dados.';
        } else {
          // Em falhas parciais, preserva o último valor de cada painel afetado.
          if (!isDetail && lastData) {
            data.paineis = items.map(item => item.estado==='erro'
              ? lastData.paineis.find(old=>old.id===item.id && old.estado==='ok') ?? item
              : item);
          }
          lastData = data;
          if (!failures.length || !lastUpdated) lastUpdated = data.atualizadoEm ? Date.parse(data.atualizadoEm) : Date.now();
          lastFailure = failures.length ? 'Algumas consultas estão indisponíveis.' : '';
          panel.hidden = false;
          render();
        }
      } catch (error) {
        if (!current.signal.aborted) lastFailure = message(error);
      } finally {
        if (!current.signal.aborted) {
          panel.hidden = false;
          refreshStatus();
          timer = setTimeout(refresh,REFRESH_SECONDS * 1000);
        }
      }
    }
    period.addEventListener('change',() => {
      lastData = undefined;
      lastUpdated = undefined;
      lastFailure = '';
      disposeCharts();
      content.replaceChildren();
      if (!isDetail) drawOverview([],false);
      refreshStatus();
      refresh();
    });
    if (isDetail && !/^\d+$/.test(id)) {
      panel.hidden = false;
      status.textContent = 'Selecione um painel na página de monitoramento.';
    } else {
      storeList(token,isDetail ? Number(id) : null,isDetail ? undefined : rows=>{
        occurrences = rows;
        for (const cases of content.querySelectorAll('.priority-cases')) {
          if (rows) renderOldest(cases,rows,severities.get(Number(cases.dataset.painel)));
          else cases.replaceChildren(element('p','Lista de casos indisponível.'));
        }
      });
      refresh();
      setInterval(refreshStatus,1000);
    }
  }
}








