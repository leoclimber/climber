/* Date arithmetic is in calendar days; monetary sums use integer cents. */
const SF={
 today(){const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Dublin',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return ['year','month','day'].map(k=>p.find(x=>x.type===k).value).join('-');},
 validDate(d){return /^\d{4}-\d{2}-\d{2}$/.test(d)&&d>='1900-01-01'&&Number.isFinite(Date.parse(d+'T12:00Z'))&&new Date(d+'T12:00Z').toISOString().slice(0,10)===d;},
 shift(d,n){return new Date(Date.parse(d+'T12:00Z')+n*86400000).toISOString().slice(0,10);},
 number(raw,places=2,zero=false){let s=String(raw??'').trim();if(s.includes(',')){if(!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/.test(s))throw Error('Use um número como 1500,00.');s=s.replace(/\./g,'').replace(',','.');}if(!/^\d+(?:\.\d+)?$/.test(s))throw Error('Informe um número positivo.');let [a,b='']=s.split('.');if(b.length>places)throw Error('Casas decimais em excesso.');let n=BigInt(a)*10n**BigInt(places)+BigInt(b.padEnd(places,'0'));if(n>100000000000n||n<0n||(!zero&&n===0n))throw Error('Valor fora do intervalo permitido.');return Number(n);},
 brl(s,r){let a=this.number(s.amount,2,true);if(s.currency==='BRL')return a;if(!(r[s.currency]>0))return null;return Number((BigInt(a)*BigInt(this.number(r[s.currency],4))+5000n)/10000n);},
 sum(a,r){let n=0;for(const s of a){let x=this.brl(s,r);if(x===null)return null;n+=x;if(!Number.isSafeInteger(n))throw Error('Total muito alto para este relatório.');}return n;},
 money(n,c='BRL'){return n===null?'Conversão pendente':new Intl.NumberFormat('pt-BR',{style:'currency',currency:c}).format(n/100);},
 range(period,from,to,now=this.today(),sales=[]){if(period==='custom'){if(!this.validDate(from)||!this.validDate(to)||from>to||to>now)throw Error('Selecione um intervalo válido, até hoje.');return {start:from,end:to};}if(period==='yesterday')return {start:this.shift(now,-1),end:this.shift(now,-1)};if(period==='all')return {start:sales.length?sales.map(s=>s.date).sort()[0]:now,end:now};let n=Number(period);if(!Number.isInteger(n)||n<1||n>36500)throw Error('Período inválido.');return {start:this.shift(now,1-n),end:now};},
 previous(r){let n=Math.round((Date.parse(r.end+'T12:00Z')-Date.parse(r.start+'T12:00Z'))/86400000)+1;return {start:this.shift(r.start,-n),end:this.shift(r.start,-1)};},
 filter(a,r){return a.filter(s=>s.date>=r.start&&s.date<=r.end);},
 growth(a,b){return a===null||b===null||b<=0?null:(a-b)*100/b;},
 sale(s){const date=s.date??s.sale_date;if(!this.validDate(date)||date>this.today())throw Error('Data inválida ou futura.');const currency=String(s.currency).toUpperCase();if(!['EUR','USD','BRL'].includes(currency))throw Error('Moeda inválida.');let amount=this.number(s.amount)/100;if(amount>1e9)throw Error('Valor muito alto.');const description=String(s.description||'').trim();if(description.length>240)throw Error('Descrição: máximo de 240 caracteres.');return {date,amount,currency,description};}
};
if(typeof module!=='undefined')module.exports=SF;
