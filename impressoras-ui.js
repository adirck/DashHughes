const COLUNAS = ['Lojas', 'IP', 'Marca', 'Modelo Impressora', 'Número de Série', 'Fabricante', 'Nível de Tinta'];
const CAMPOS = ['loja', 'ip', 'marca', 'modelo', 'serie', 'fabricante', 'nivel'];

const FAIXAS = [
 ['', 'Todos os níveis'], ['critico', 'Abaixo de 10%'],
 ['medio', 'De 10% a 50%'], ['alto', 'Acima de 50%'],
];

export function simplificarModelo(modelo) {
 const valor = String(modelo ?? '').trim();
 const encontrado = /(?:^|\b)(WF-M5399\s+SF|WF-M5799\s+MPF|M1180|M1120)\b/i.exec(valor);
 return encontrado ? encontrado[1].toUpperCase().replace(/\s+/g, ' ') : valor;
}

export function leiturasDeTinta(nivel) {
 const texto = String(nivel ?? '');
 const leituras = [...texto.matchAll(/(?:(preto|ciano|magenta|amarelo|black|cyan|yellow)[ :–-]+)?(?:^|(?<=[^0-9.,+-]))(\d+(?:[.,]\d+)?)\s*%/gi)];
 return leituras.map(([, cor, leitura]) => ({ cor, percentual:Number(leitura.replace(',', '.')) }))
  .filter(({percentual}) => percentual >= 0 && percentual <= 100);
}

function menorNivel(linha) {
 return Math.min(...leiturasDeTinta(linha.nivel).map(leitura=>leitura.percentual));
}

function faixa(linha) {
 const nivel = menorNivel(linha);
 if (!Number.isFinite(nivel)) return '';
 return nivel < 10 ? 'critico' : nivel <= 50 ? 'medio' : 'alto';
}

export function ordenarImpressoras(linhas) {
 return linhas.map(linha=>({linha,nivel:menorNivel(linha),comIP:Boolean(String(linha.ip??'').trim())}))
  .sort((a,b)=>Number(b.comIP)-Number(a.comIP) || a.nivel-b.nivel ||
   (a.linha.loja ?? '').localeCompare(b.linha.loja ?? '', 'pt-BR'))
  .map(({linha})=>linha);
}

function textoTinta(linha) {
 const leituras = leiturasDeTinta(linha.nivel);
 return leituras.length ? leituras.map(({cor,percentual})=>[cor,formatarPercentual(percentual)].filter(Boolean).join(' ')).join(' · ') : 'Não informado';
}

function formatarPercentual(valor) {
 return valor.toLocaleString('pt-BR')+'%';
}

function desenharTinta(celula, linha) {
 const leituras = leiturasDeTinta(linha.nivel);
 if (!leituras.length) {
  celula.textContent = 'Não informado';
  return;
 }
 for (const {cor,percentual} of leituras) {
  const barra = elemento('div', undefined, 'impressora-tinta');
  if (cor) barra.append(elemento('small',cor));
  const medida = elemento('progress');
  medida.max=100;
  medida.value=percentual;
  medida.dataset.faixa=percentual < 10 ? 'critico' : percentual <= 50 ? 'medio' : 'alto';
  medida.setAttribute('aria-label',cor ? 'Nível de tinta '+cor : 'Nível de tinta');
  barra.append(medida,elemento('span',formatarPercentual(percentual)));
  celula.append(barra);
 }
}

function redeIPv4(valor) {
 const octetos=String(valor ?? '').trim().split('.');
 if(octetos.length!==4 || octetos.some(octeto=>!/^(0|[1-9]\d{0,2})$/.test(octeto)||Number(octeto)>255))return null;
 return octetos.slice(0,3).join('.');
}

export function resumoImpressoras(linhas, lojas) {
 const gateways=new Map(lojas.map(loja=>[loja.host,redeIPv4(loja.gateway)]));
 const tintas=[0,0,0], inventario=[0,0,0];
 for(const item of linhas){
  const faixaTinta=faixa(item);
  const indiceTinta=['critico','medio','alto'].indexOf(faixaTinta);
  if(indiceTinta>=0)tintas[indiceTinta]++;
  const ip=String(item.ip??'').trim(),rede=redeIPv4(ip);
  if(!ip)inventario[2]++;
  else if(rede&&rede===gateways.get(item.host))inventario[0]++;
  else inventario[1]++;
 }
 return {tintas,inventario,total:linhas.length};
}

function normalizar(valor) {
 return String(valor ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR').trim();
}

function correspondeIP(linha, filtro) {
 const situacao=String(linha.ip??'').trim()?'informado':'ausente';
 return filtro.includes(situacao);
}

const OPCOES_IP=[['informado','IP informado'],['ausente','IP não informado']];
const TODOS_IPS=OPCOES_IP.map(([valor])=>valor);

function filtroIP(valor=TODOS_IPS) {
 const campo=elemento('fieldset',undefined,'impressoras-modelos-exportacao');
 campo.append(elemento('legend','IP'));
 const caixas=OPCOES_IP.map(([chave,texto])=>{
  const caixa=elemento('input');
  caixa.type='checkbox';
  caixa.value=chave;
  caixa.checked=valor.includes(chave);
  const rotulo=elemento('label');
  rotulo.append(caixa,document.createTextNode(texto));
  campo.append(rotulo);
  return caixa;
 });
 return {campo, selecionados:()=>caixas.filter(caixa=>caixa.checked).map(caixa=>caixa.value),
  aoAlterar:fn=>caixas.forEach(caixa=>caixa.addEventListener('change',fn))};
}

export function filtrarImpressoras(linhas, filtros, pendentes, ip=TODOS_IPS) {
 return linhas.filter(linha => {
  const exigeRevisao = linha.estado === 'pendente' || linha.estado === 'revisao';
  return exigeRevisao === pendentes && correspondeIP(linha,ip) && Object.entries(filtros).every(([campo, termo]) =>
   normalizar(campo==='modelo'?simplificarModelo(linha.modelo):linha[campo]).includes(normalizar(termo)));
 });
}

function elemento(tag, texto, classe) {
 const item = document.createElement(tag);
 if (texto !== undefined) item.textContent = texto;
 if (classe) item.className = classe;
 return item;
}

export function linhasRelatorio(linhas, marca, nivel, modelos=null, ip=TODOS_IPS) {
 return ordenarImpressoras(linhas.filter(linha=>
  (!marca || linha.marca===marca) && (!nivel || faixa(linha)===nivel) &&
  (modelos===null || modelos.has(simplificarModelo(linha.modelo))) && correspondeIP(linha,ip)));;;
}

function abrirRelatorio(modal, dados, pendentes) {
 const janela=modal('Exportar relatório de impressoras');
 const form=elemento('form',undefined,'forecast-form');
 const marca=elemento('select'), nivel=elemento('select');
 const linhas=filtrarImpressoras(dados.linhas ?? [],{},pendentes);
 const marcas=[...new Set(linhas.map(linha=>linha.marca).filter(Boolean))]
  .sort((a,b)=>a.localeCompare(b,'pt-BR'));
 marca.append(new Option('Todas as marcas',''), ...marcas.map(valor=>new Option(valor,valor)));
 const modelos=[...new Set(linhas.filter(linha=>linha.id).map(linha=>simplificarModelo(linha.modelo)).filter(Boolean))]
  .sort((a,b)=>a.localeCompare(b,'pt-BR'));
 const grupoModelos=elemento('fieldset',undefined,'impressoras-modelos-exportacao');
 grupoModelos.append(elemento('legend','Modelos'));
 const todos=elemento('input');todos.type='checkbox';todos.checked=true;
 const rotuloTodos=elemento('label');rotuloTodos.append(todos,document.createTextNode('Todos os modelos'));
 grupoModelos.append(rotuloTodos);
 const caixas=modelos.map(modelo=>{
  const caixa=elemento('input');caixa.type='checkbox';caixa.value=modelo;caixa.checked=true;
  const rotulo=elemento('label');rotulo.append(caixa,document.createTextNode(modelo));grupoModelos.append(rotulo);
  return caixa;
 });
 const modelosSelecionados=()=>todos.checked?null:new Set(caixas.filter(caixa=>caixa.checked).map(caixa=>caixa.value));
 nivel.append(...FAIXAS.map(([valor,rotulo])=>new Option(rotulo,valor)));
 for (const [rotulo,seletor] of [['Marca',marca],['Nível de Tinta',nivel]]) {
  const campo=elemento('label',rotulo);
  campo.append(seletor);
  form.append(campo);
 }
 const ip=filtroIP();
 form.append(ip.campo,grupoModelos);
 const aviso=elemento('p',undefined,'status-message');
 aviso.setAttribute('role','status');
 const salvar=elemento('button','Baixar Excel','primary');
 salvar.type='submit';
 const contagem=elemento('p',undefined,'subtext');
 function atualizarContagem() {
  const total=linhasRelatorio(linhas,marca.value,nivel.value,modelosSelecionados(),ip.selecionados()).length;
  contagem.textContent=total+' registros';
  salvar.disabled=!total;
 }
 marca.onchange=nivel.onchange=atualizarContagem;
 ip.aoAlterar(atualizarContagem);
 todos.onchange=()=>{
  todos.indeterminate=false;
  for(const caixa of caixas)caixa.checked=todos.checked;
  atualizarContagem();
 };
 for(const caixa of caixas)caixa.onchange=()=>{
  todos.checked=caixas.every(item=>item.checked);
  todos.indeterminate=!todos.checked&&caixas.some(item=>item.checked);
  atualizarContagem();
 };
 form.onsubmit=async evento=>{
  evento.preventDefault();
  salvar.disabled=true;
  aviso.textContent='';
  let url;
  try {
   const {createWorkbook}=await import('./excel.mjs?v=51');
   const linhasExcel=linhasRelatorio(linhas,marca.value,nivel.value,modelosSelecionados(),ip.selecionados()).map(linha=>
    CAMPOS.map(campo=>campo==='nivel'?textoTinta(linha):campo==='modelo'?simplificarModelo(linha.modelo)||'Não informado':
     linha[campo] || (campo==='loja'?'Vínculo pendente':'Não informado')));
   const bytes=createWorkbook(COLUNAS,linhasExcel);
   url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
   const link=elemento('a');link.href=url;link.download='cadastro-impressoras.xlsx';link.click();
   const download=url;
   setTimeout(()=>URL.revokeObjectURL(download),60000);
  } catch {
   if(url) URL.revokeObjectURL(url);
   aviso.textContent='Não foi possível exportar. Tente novamente.';
  } finally { atualizarContagem(); }
 };
 form.append(contagem,salvar,aviso);
 janela.append(form);
 atualizarContagem();
}

export function renderImpressoras(conteudo, dados, atualizar, preferencias, corrigir, modal) {
 const caixa = elemento('section', undefined, 'surface report-page');
 const controles = elemento('div', undefined, 'log-filters cadastro-filters');
 const lista = elemento('div', undefined, 'table-wrap');
 lista.tabIndex = 0;
 lista.setAttribute('aria-label', 'Tabela do cadastro de impressoras');
 const status = elemento('p', undefined, 'status-message');
 status.setAttribute('role', 'status');
 const resumo = elemento('p', undefined, 'subtext');
 const pendentes = elemento('input');
 pendentes.type = 'checkbox';
 pendentes.checked = preferencias.pendentes;
 const rotuloPendentes = elemento('label', 'Vínculos pendentes ');
 rotuloPendentes.append(pendentes);
 for (const [key, label] of [['loja','Loja'],['marca','Marca'],['fabricante','Fabricante'],['modelo','Modelo'],['serie','Número de série']]) {
  const campo = elemento('label', label);
  const entrada = elemento('input');
  entrada.type = 'search';
  entrada.value = preferencias.filtros[key] ?? '';
  entrada.addEventListener('input', () => {
   preferencias.filtros[key] = entrada.value;
   preencher();
  });
  campo.append(entrada);
  controles.append(campo);
 }
 const botao = elemento('button', 'Atualizar dados', 'quiet');
 botao.type = 'button';
 botao.addEventListener('click', async () => {
  botao.disabled = true;
  try { await atualizar(); }
  catch (erro) { status.textContent = erro.message; }
  finally { botao.disabled = false; }
 });
 pendentes.addEventListener('change', () => {
  preferencias.pendentes = pendentes.checked;
  preencher();
 });
 const exportar=elemento('button','Exportar relatório','quiet');
 exportar.type='button';
 exportar.onclick=()=>abrirRelatorio(modal,dados,preferencias.pendentes);
 const ip=filtroIP(preferencias.ip);
 ip.aoAlterar(()=>{
  preferencias.ip=ip.selecionados();
  preencher();
 });
 controles.append(ip.campo, rotuloPendentes, botao, exportar);
 status.textContent = dados.aviso ?? '';
 const data = dados.ultimaColeta ? new Date(dados.ultimaColeta) : null;
 resumo.textContent = data && Number.isFinite(data.getTime())
  ? 'Última coleta bem-sucedida ' + new Intl.DateTimeFormat('pt-BR', {
   dateStyle:'short', timeStyle:'short', timeZone:'America/Sao_Paulo',
  }).format(data)
  : 'Nenhuma coleta bem-sucedida registrada.';
 function preencher() {
  const tabela = elemento('table');
  const cabecalho = tabela.createTHead().insertRow();
  for (const titulo of COLUNAS) {
   const coluna = elemento('th', titulo);
   coluna.scope = 'col';
   cabecalho.append(coluna);
  }
  const corpo = tabela.createTBody();
  const linhas = ordenarImpressoras(filtrarImpressoras(dados.linhas ?? [], preferencias.filtros, preferencias.pendentes, preferencias.ip));
  for (const linha of linhas) {
   const row = corpo.insertRow();
   for (const campo of CAMPOS) {
    const celula = row.insertCell();
    if (campo==='nivel') {
     desenharTinta(celula,linha);
     continue;
    }
    celula.textContent = (campo==='modelo'?simplificarModelo(linha.modelo):linha[campo]) || (campo === 'loja' ? 'Vínculo pendente' : 'Não informado');
    if (campo === 'loja' && linha.origem) {
     const origem = linha.origem === 'manual' ? 'Vínculo manual' : 'Vínculo automático';
     celula.append(elemento('small', linha.estado === 'revisao' ? origem + ' · Revisar vínculo' : origem));
    }
    if (campo === 'loja' && linha.id && corrigir) {
     const selecao = elemento('select');
     selecao.setAttribute('aria-label', 'Selecionar loja para esta impressora');
     selecao.append(new Option('Selecionar loja',''));
     for (const loja of dados.lojas ?? []) selecao.append(new Option(loja.nome+' · '+loja.marca,loja.host));
     if (linha.host) selecao.value = linha.host;
     const salvar = elemento('button','Salvar vínculo','quiet');
     salvar.type = 'button';
     salvar.disabled = !selecao.value;
     selecao.onchange = () => { salvar.disabled = !selecao.value; };
     salvar.onclick = async () => {
      salvar.disabled = true;
      try { await corrigir(linha.id,selecao.value); }
      catch (erro) { status.textContent = erro.message; }
      finally { salvar.disabled = !selecao.value; }
     };
     celula.append(selecao,salvar);
    }
   }
  }
  if (!linhas.length) {
   const celula = corpo.insertRow().insertCell();
   celula.colSpan = COLUNAS.length;
   celula.textContent = 'Nenhum registro encontrado.';
  }
  lista.replaceChildren(tabela);
 }
 caixa.append(controles, resumo, status, lista);
 conteudo.append(caixa);
 preencher();
}
