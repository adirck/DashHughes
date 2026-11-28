const relogio = new Intl.DateTimeFormat('pt-BR',{
 timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',
 hour:'2-digit',minute:'2-digit',hourCycle:'h23',
});

export function origemDaResposta(headers) {
 if(headers.get('X-DashSoma-Mode')!=='backup')return {modo:'online'};
 const valor=headers.get('X-DashSoma-Backup-At')||'';
 const instante=Date.parse(valor);
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(valor)||!Number.isFinite(instante))
  return {modo:'sem-data'};
 return {modo:'backup',instante};
}

export function indicadorDados(fonte, atualizado=0, agora=Date.now()) {
 if(fonte.modo==='backup')return 'Backup de '+relogio.format(fonte.instante).replace(',',' às');
 if(fonte.modo==='sem-data')return 'Backup sem data confirmada';
 if(fonte.modo==='sem-conexao')return 'Sem conexão';
 if(fonte.modo==='online')return atualizado?'Ao vivo · há '+Math.max(0,Math.floor((agora-atualizado)/1000))+' s':'Ao vivo';
 return 'Conectando…';
}
