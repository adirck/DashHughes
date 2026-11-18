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
function draw(canvas,series,detail) {
  if (!window.Chart || !series.some(row => row.historico?.length)) return;
  const colors = ['#51b99b','#729ee9','#d79048','#b781d2','#70b9c1'];
  const data = {datasets:series.filter(row => row.historico?.length).map((row,i) => ({
    label:row.nome,borderColor:colors[i%colors.length],backgroundColor:colors[i%colors.length],
    data:row.historico.map(([x,y])=>({x,y})),pointRadius:detail?2:0,borderWidth:2,
  }))};
  const foreground = getComputedStyle(document.documentElement).getPropertyValue('--text').trim();
  const chart = new window.Chart(canvas,{
    type:'line',data,
    options:{...chartOptions,parsing:false,
      scales:{x:{type:'linear',display:detail,ticks:{maxTicksLimit:6,color:foreground,callback:value=>clock.format(value)}},
        y:{display:detail,ticks:{color:foreground}}},
      plugins:{legend:{display:detail,labels:{color:foreground}},tooltip:{enabled:detail,
        callbacks:{title:items=>clock.format(items[0].parsed.x)}}},
    },
  });
  charts.set(canvas,chart);
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
function card(data,period) {
  const node = element('article',undefined,'card');
  const link = element('a',data.titulo);
  link.href = './detalhe.html?id='+data.id+'&from='+encodeURIComponent(period);
  const heading = element('h2');
  heading.append(link);
  node.append(heading);
  if (data.estado !== 'ok') {
    node.append(element('p',states[data.estado] ?? 'Dados indisponíveis.'));
    return {node};
  }
  const list = element('dl');
  for (const row of data.series.slice(0,3)) list.append(valueRow(row,data.unidade));
  node.append(list);
  if (!data.series.some(row => row.historico?.length)) return {node};
  const {wrap,canvas} = canvasFor(data.titulo);
  node.append(wrap);
  return {node,canvas,series:data.series.slice(0,3)};
}
function detailContent(data,container) {
  document.querySelector('h1').textContent = data.titulo;
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
  if (hasHistory) draw(canvas,data.series,true);
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
    const views = document.querySelector('#views');
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
      if (!panels.length) {
        views.replaceChildren();
        content.replaceChildren(element('p','Nenhum painel disponível.'));
        return;
      }
      const tvActive = document.fullscreenElement === panel;
      const shown = tvActive ? [panels[view % panels.length]] : panels;
      const tiles = shown.map(data=>card(data,period.value));
      content.replaceChildren(...tiles.map(tile=>tile.node));
      for (const tile of tiles) if (tile.canvas) draw(tile.canvas,tile.series,false);
      const kpis = panels.filter(data=>data.estado==='ok' && data.series.length===1).slice(0,5);
      views.replaceChildren(...kpis.map(data=>{
        const kpi = element('div',undefined,'kpi');
        kpi.append(element('span',data.titulo),element('strong',valueLabel(data.series[0].valor,data.unidade)));
        return kpi;
      }));
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
      views?.replaceChildren();
      content.replaceChildren();
      refreshStatus();
      refresh();
    });
    if (isDetail && !/^\d+$/.test(id)) {
      panel.hidden = false;
      status.textContent = 'Selecione um painel na página de monitoramento.';
    } else {
      refresh();
      setInterval(refreshStatus,1000);
    }
  }
}


