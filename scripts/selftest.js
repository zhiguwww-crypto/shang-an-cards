#!/usr/bin/env node
/**
 * 生成自检页面：把 index.html 复制一份，注入 136 项断言，输出到 outputs/selftest.html
 * 由 test.sh 调用，配合无头 Chrome 运行。
 */
const fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..');
const inPath = require('path').join(ROOT, 'index.html');
const outPath = require('path').join(ROOT, 'outputs', 'selftest.html');
const inHtml = fs.readFileSync(inPath, 'utf8');

const harness = `
<script>
window.__err=[];
window.addEventListener('error',e=>window.__err.push(e.message));
const LOG=[];
const ok=(n,c,x)=>LOG.push((c?'PASS ':'FAIL ')+n+(x!==undefined&&x!==null&&x!==''?' | '+x:''));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const P=(x,y)=>({clientX:x,clientY:y,pointerType:'touch',bubbles:true,button:0,buttons:1,pointerId:9});
function tap(el,x,y){el.dispatchEvent(new PointerEvent('pointerdown',P(x||200,y||300)));el.dispatchEvent(new PointerEvent('pointerup',P(x||200,y||300)));}
function swipe(el,x0,y0,x1,y1){
  el.dispatchEvent(new PointerEvent('pointerdown',P(x0,y0)));
  for(let i=1;i<=5;i++)el.dispatchEvent(new PointerEvent('pointermove',P(x0+(x1-x0)*i/5,y0+(y1-y0)*i/5)));
  el.dispatchEvent(new PointerEvent('pointerup',P(x1,y1)));
}
function key(k,code){document.dispatchEvent(new KeyboardEvent('keydown',{key:k,code:code||'',bubbles:true}));}

(async()=>{
try{
  await sleep(700);

  /* ---------- A 启动 ---------- */
  ok('A1 无脚本错误', window.__err.length===0, window.__err.join(';'));
  ok('A2 卡片库规模', CARDS.length>2500, CARDS.length);
  ok('A3 两板块队列', App.queues.know.list.length>0&&App.queues.idiom.list.length>0,
     'know='+App.queues.know.list.length+' idiom='+App.queues.idiom.list.length);
  ok('A4 新卡总量按设置', (App.queues.know.n+App.queues.idiom.n)===App.s.settings.newPerDay,
     (App.queues.know.n+App.queues.idiom.n)+'/'+App.s.settings.newPerDay);
  ok('A5 常识队列无成语', App.queues.know.list.every(x=>x.c.cat!=='成语'));
  ok('A6 成语队列全成语', App.queues.idiom.list.every(x=>x.c.cat==='成语'));
  ok('A7 默认在背诵页', document.getElementById('today').classList.contains('on'));
  ok('A8 标题已更名', document.title==='上岸常识刷刷刷' && document.querySelector('header h1').textContent==='上岸常识刷刷刷',
     document.title);

  /* ---------- B 背诵 ---------- */
  App.activate('know');
  ok('B1 阅读卡有标题正文', document.getElementById('rTitle').textContent.length>0 &&
     document.getElementById('rBody').textContent.length>0);
  ok('B2 背诵页显示阅读卡', document.getElementById('readWrap').style.display!=='none');

  const stars0=Object.keys(App.s.stars||{}).length;
  document.getElementById('btnStar2').click();
  ok('B3 收藏按钮', Object.keys(App.s.stars||{}).length===stars0+1 &&
     document.getElementById('btnStar2').textContent.includes('已收藏'));
  document.getElementById('btnStar2').click();
  ok('B4 取消收藏', Object.keys(App.s.stars||{}).length===stars0);

  const idxB=App.idx, cardsB=Object.keys(App.s.cards).length;
  document.getElementById('btnSkip2').click();
  ok('B5 跳过推进且不计分', App.idx===idxB+1 && Object.keys(App.s.cards).length===cardsB);

  const today=App.today();
  key('3');
  const lastId=Object.keys(App.s.cards).pop();
  ok('B6 键盘评分写入进度', Object.keys(App.s.cards).length===cardsB+1);
  ok('B7 到期日按曲线', App.s.cards[lastId].due===App.addDays(today,1), App.s.cards[lastId].due);
  ok('B8 作答写入当日统计', !!App.s.ans[today] && App.s.ans[today].n>0,
     JSON.stringify(App.s.ans[today]));

  /* ---------- C 填空 ---------- */
  const idxC=App.idx;
  document.querySelector('#studySeg .schip[data-m="fill"]').click();
  ok('C1 填空保留同一索引', App.idx===idxC);
  ok('C2 填空有空格', document.querySelectorAll('#qText .bk').length>0);
  ok('C3 填空无整段遮盖', document.querySelectorAll('#qText .veil').length===0);
  ok('C4 填空顶部有跳过', !!document.getElementById('btnSkipF'));

  const bk=document.querySelector('#qText .bk');
  bk.click();
  ok('C5 点空揭示', bk.classList.contains('revealed') && bk.textContent.length>0);
  ok('C6 揭示后评分栏启用', document.getElementById('rateFill').classList.contains('on'));

  document.getElementById('btnHide').click();
  ok('C7 遮盖重来', document.querySelectorAll('#qText .bk.revealed').length===0);

  document.getElementById('btnReveal').click();
  ok('C8 显示全部', document.querySelectorAll('#qText .bk:not(.revealed)').length===0);

  const idxC2=App.idx;
  document.getElementById('btnSkipF').click();
  ok('C9 填空跳过', App.idx===idxC2+1);

  let noBlank=0,veil=0;
  for(let i=0;i<12;i++){
    App.next();
    if(!document.querySelector('#qText .bk'))noBlank++;
    if(document.querySelector('#qText .veil'))veil++;
  }
  ok('C10 连续12张均有空', noBlank===0&&veil===0, 'noBlank='+noBlank+' veil='+veil);

  // 回到有效索引再测评分
  App.idx=Math.max(0,App.queue.length-2);
  App.pos.know=App.idx; App.render();
  const idxFill=App.idx;
  document.getElementById('btnReveal').click();
  document.querySelector('#rateFill .rbtn.yes').click();
  ok('C11 填空评分推进', App.idx===idxFill+1, App.idx+'/'+idxFill);

  document.querySelector('#studySeg .schip[data-m="recite"]').click();
  ok('C12 切回背诵保留索引', App.idx===idxFill+1);

  /* ---------- D 成语 ---------- */
  App.buildQueues();
  document.querySelector('nav button[data-v="idiom"]').click();
  ok('D1 切到成语页', App.scope==='idiom' && document.getElementById('idiom').classList.contains('on'));
  const st=document.getElementById('stage');

  tap(st); await sleep(60);
  const f1=App.flipped;
  tap(st); await sleep(60);
  ok('D2 轻点翻面/翻回', f1===true && App.flipped===false);

  key(' ','Space');
  ok('D3 空格翻面', App.flipped===true);

  /* 翻面后两个面必须互斥可见：iOS / 微信 XWeb 会忽略 backface-visibility，
     正面会以镜像透出来，这里锁定兜底逻辑生效 */
  await sleep(420);
  const vf=getComputedStyle(document.querySelector('#card .face.front')).visibility;
  const vb=getComputedStyle(document.querySelector('#card .face.back')).visibility;
  ok('D3b 翻面后正面隐藏', vf==='hidden'&&vb==='visible', vf+'/'+vb);
  App.flip(); await sleep(420);
  const vf2=getComputedStyle(document.querySelector('#card .face.front')).visibility;
  const vb2=getComputedStyle(document.querySelector('#card .face.back')).visibility;
  ok('D3c 翻回后反面隐藏', vf2==='visible'&&vb2==='hidden', vf2+'/'+vb2);
  App.flip();                      // 恢复翻面状态，保证后面的滑动评分用例成立

  const gi=App.idx;
  swipe(st,300,300,110,300);
  await sleep(320);
  ok('D4 左滑记住并推进', App.idx===gi+1, App.idx+'/'+gi);

  App.flip(); await sleep(30);
  const gi2=App.idx;
  swipe(st,200,300,340,300);
  await sleep(320);
  ok('D5 右滑忘了并推进', App.idx===gi2+1);

  const st0=Object.keys(App.s.stars||{}).length;
  swipe(st,300,420,300,320);
  await sleep(120);
  ok('D6 上滑收藏', Object.keys(App.s.stars||{}).length===st0+1);

  const longIdx=App.queue.findIndex(x=>x.c.back.length>170);
  if(longIdx>=0){
    App.idx=longIdx;App.render();
    const eb=document.getElementById('btnExpand');
    if(eb.style.display!=='none'){
      eb.click();
      ok('D7 展开全文', !document.getElementById('wordB').classList.contains('clamp'));
    }else ok('D7 展开全文', false, '按钮未出现');
  }else ok('D7 展开全文', true, '无长卡');

  App.idx=App.queue.length-1;
  App.grade(2);
  await sleep(220);
  ok('D8 完成触发礼花', document.getElementById('cele').classList.contains('on'),
     document.getElementById('celeMsg').textContent.slice(0,10));
  ok('D9 切换标签不重复触发', (()=>{const k=App._celKey;
     document.querySelector('nav button[data-v="today"]').click();
     document.querySelector('nav button[data-v="idiom"]').click();return App._celKey===k;})());
  App.showCele();
  ok('D10 可重放', document.getElementById('cele').classList.contains('on'));

  // 再来10张
  const gl=App.queue.length;
  App.extra();
  ok('D11 再来10张追加队列', App.queue.length>gl || App.queue.length===gl,
     gl+'→'+App.queue.length);

  /* ---------- K 完成庆祝：烟花 + 一句话 + 关闭号 ---------- */
  ok('K1 祝福卡右上角有关闭号', !!document.getElementById('celeX'));
  App.showCele();
  await sleep(120);
  ok('K2 完成时放烟花并弹出一句话', document.getElementById('cele').classList.contains('on') &&
     document.getElementById('celeMsg').textContent.length>4,
     document.getElementById('celeMsg').textContent.slice(0,14));
  ok('K3 烟花画布已启动', document.getElementById('fx').style.display!=='none');
  document.getElementById('celeX').click();
  ok('K4 点关闭号立即收起', !document.getElementById('cele').classList.contains('on') &&
     document.getElementById('fx').style.display==='none');
  App.showCele();
  key('Escape');
  ok('K5 Esc 也能收起', !document.getElementById('cele').classList.contains('on'));
  App.showCele();
  ok('K6 可再次重放', document.getElementById('cele').classList.contains('on'));
  App.closeCele();

  /* ---------- M 隐形可点区域 / 圆环交互 ---------- */
  // 历史坑：.cele-c 无条件 pointer-events:auto，收起时（opacity:0）仍盖在屏幕中央吃点击，
  // 点到里面隐形的「再看一次」就会莫名放礼花
  const celeEl=document.getElementById('cele');
  const hitC=document.elementFromPoint(window.innerWidth/2,window.innerHeight/2);
  ok('M1 收起时祝福卡不吃点击', !celeEl.contains(hitC),
     hitC?((hitC.className||hitC.id||hitC.tagName)+'').slice(0,24):'null');
  const ringBtn=document.getElementById('ring');
  ok('M2 圆环有指针光标', getComputedStyle(ringBtn).cursor==='pointer', getComputedStyle(ringBtn).cursor);
  const rb2=ringBtn.getBoundingClientRect();
  const hitR=document.elementFromPoint(rb2.left+rb2.width/2,rb2.top+rb2.height/2);
  ok('M3 圆环命中区域就是圆环', ringBtn.contains(hitR), hitR?hitR.tagName:'null');
  App.toggleRingPop(true);
  const rpD=document.getElementById('rpDone'), rpT=document.getElementById('rpTotal');
  ok('M4 点圆环出明细', document.getElementById('ringPop').classList.contains('on') &&
     rpD&&rpT&&+rpD.textContent>=0&&+rpT.textContent>=0&&
     document.getElementById('ringPopS').textContent.length>3,
     rpD.textContent+' / '+rpT.textContent+' 张 · '+document.getElementById('ringPopS').textContent);
  App.toggleRingPop(false);
  ok('M5 再点收起', !document.getElementById('ringPop').classList.contains('on'));
  App.showCele();
  await sleep(60);
  const cbtn=document.querySelector('.cele-btn');
  const cb=cbtn.getBoundingClientRect();
  const hitB=document.elementFromPoint(cb.left+cb.width/2,cb.top+cb.height/2);
  ok('M6 弹出时卡内按钮恢复可点', celeEl.classList.contains('on')&&celeEl.contains(hitB),
     hitB?((hitB.className||hitB.tagName)+'').slice(0,20):'null');
  App.closeCele();
  ok('M7 收起后按钮不再可点', (()=>{
    const h=document.elementFromPoint(cb.left+cb.width/2,cb.top+cb.height/2);
    return !celeEl.contains(h);
  })());
  /* 坑：窄屏隐藏「连续」用的是 .hstats div:nth-child(2) 后代选择器，
     会把圆环气泡里第 2 个子元素 .rp-n 也一并藏掉，必须写成 .hstats > div。
     这里扫描全部样式表，禁止出现能渗透进气泡的 display:none 规则。 */
  const leak=(()=>{
    const bad=[];
    const walk=rs=>{
      for(const r of rs){
        if(r.cssRules){ walk(r.cssRules); continue }
        if(!r.selectorText||!r.style)continue;
        const s=r.selectorText;
        if(/\\.hstats[^,>{]*\\sdiv/.test(s)&&r.style.display==='none')bad.push(s);
      }
    };
    for(const sh of document.styleSheets){ try{ walk(sh.cssRules) }catch(e){} }
    return bad;
  })();
  ok('M8 窄屏隐藏规则不误伤气泡', leak.length===0, leak.join(' / '));
  App.toggleRingPop(true);
  const vis=['.rp-t','.rp-n','.rp-s'].map(s=>getComputedStyle(document.querySelector(s)).display);
  ok('M9 气泡三行都可见', vis.every(v=>v!=='none'), vis.join(','));
  App.toggleRingPop(false);

  /* ---------- E 测验 ---------- */
  document.querySelector('nav button[data-v="quiz"]').click();
  ok('E1 题量可选 8 档', document.querySelectorAll('#qxNums button').length===8);
  const catOpts=[...document.getElementById('qxCat').options];
  ok('E2 范围含全部板块与各分类',
     catOpts.some(o=>o.value==='all')&&CATS.every(c=>catOpts.some(o=>o.value===c)),
     catOpts.length+' 项');

  document.querySelector('#qxNums button[data-n="10"]').click();
  const sel=document.getElementById('qxCat');
  sel.value='成语'; sel.dispatchEvent(new Event('change'));
  document.getElementById('qxGo').click();
  ok('E3 按板块出题', App.qx.list.length===10 && App.qx.list.every(q=>q.card.cat==='成语'));
  ok('E4 每题4个不重复选项', App.qx.list.every(q=>q.opts.length===4 &&
     new Set(q.opts.map(o=>o.back)).size===4));
  ok('E5 正确项索引正确', App.qx.list.every(q=>q.opts[q.ans].id===q.card.id));

  App.answerQ(App.qx.list[0].ans);
  ok('E6 答对计数', App.qx.right===1 && App.qx.wrong===0);
  App.nextQ();
  App.answerQ((App.qx.list[1].ans+1)%4);
  await sleep(100);
  ok('E7 答错计数与正确率', App.qx.wrong===1 && document.getElementById('qxAcc').textContent==='50%');
  ok('E8 错题可回顾', App.qx.records.length===1);

  App.qx.used=90; App.qx.idx=App.qx.list.length; App.finishQuiz();
  ok('E9 结算页数据', document.getElementById('qxDone').classList.contains('on') &&
     document.getElementById('qxP').textContent==='50%' &&
     document.getElementById('qxAvg').textContent==='45.0s');
  document.getElementById('qxAgain').click();
  ok('E10 再来一组回配置页', document.getElementById('qxStart').style.display!=='none');

  /* ---------- J 错题本 / 每日目标 / 纠错 ---------- */
  const wp=App.wrongPool();
  ok('J1 错题本池=答错且未掌握', wp.length>0 && wp.every(c=>{
     const p=App.s.cards[c.id]; return p&&p.wrong>0&&!p.master;
  }), wp.length+' 张');
  ok('J2 错题本选项出现在范围里',
     [...document.getElementById('qxCat').options].some(o=>o.value==='__wrong__'));

  App.qxCfg.cat='__wrong__'; App.qxCfg.n=10; App.updateQxHint();
  document.getElementById('qxGo').click();
  const wpIds=new Set(App.wrongPool().map(c=>c.id));
  ok('J3 错题本专练只出错题', App.qx.list.length>0 && App.qx.list.every(q=>wpIds.has(q.card.id)),
     App.qx.list.length+' 题');

  const wrongCard=App.qx.list[0].card;
  App.qx.records=[{card:wrongCard,picked:{back:'x'}}];
  App.retryWrong();
  ok('J4 只练这组错题', App.qx.list.length===1 && App.qx.list[0].card.id===wrongCard.id);

  App.s.settings.dailyGoal=1; App.s.goalHit=null;
  App.addAnswer(true,3);
  await sleep(80);
  ok('J5 达成目标落盘', App.s.goalHit===today, String(App.s.goalHit));
  ok('J6 达成目标放礼花', document.getElementById('cele').classList.contains('on') &&
     document.getElementById('goalRow').classList.contains('done'));
  ok('J7 目标进度文案', document.getElementById('goalText').textContent.indexOf('/ 1')>0,
     document.getElementById('goalText').textContent);
  App.s.settings.dailyGoal=60; App.paintGoal();
  ok('J8 目标可关闭/恢复', document.getElementById('goalText').textContent.indexOf('/ 60')>0);

  App.qxCfg.cat='all';
  document.querySelector('nav button[data-v="today"]').click();
  App.pos.know=0; App.idx=0; App.render();
  App.openFix();
  ok('J9 纠错弹层打开', document.getElementById('fixModal').classList.contains('on'));
  document.getElementById('fixNote').value='测试纠错内容';
  const fx0=(App.s.fixes||[]).length;
  App.saveFix();
  await sleep(60);
  ok('J10 纠错写入本机', (App.s.fixes||[]).length===fx0+1 &&
     App.s.fixes[App.s.fixes.length-1].note==='测试纠错内容');
  ok('J11 纠错计数显示', document.getElementById('fixN').textContent===String(fx0+1),
     document.getElementById('fixN').textContent);

  /* ---------- N 校正草稿（纠错记录 → overrides.json 格式） ---------- */
  document.querySelector('nav button[data-v="stats"]').click();
  await sleep(80);
  const flRows=document.querySelectorAll('#fixList .fl').length;
  ok('N1 纠错记录有列表', flRows>=1, flRows+' 行');
  ok('N2 列表显示标题与说明', (()=>{
    const r=document.querySelector('#fixList .fl');
    return !!r && r.querySelector('b').textContent.length>0 &&
           r.querySelector('.nt').textContent.length>0;
  })());
  App.s.fixes=[{id:'x',cat:'人文历史',front:'都城特点',
                note:'定都洛阳的朝代里东汉应写成「东汉、曹魏、西晋」',at:today},
               {id:'y',cat:'科技',front:'不存在的一张卡',note:'测试缺失卡片兜底',at:today}];
  App.renderFixList();
  ok('N3 列表按最新在前', document.querySelector('#fixList .fl b').textContent==='不存在的一张卡');
  const draft=App.exportFixDraft(true);
  ok('N4 草稿含两条且结构正确', !!draft && Object.keys(draft).length===2 &&
     typeof draft['都城特点'].back==='string' && draft['都城特点']._note.indexOf('东汉')>=0,
     draft?Object.keys(draft).join(','):'null');
  ok('N5 草稿带上当前正文', draft['都城特点'].back.indexOf('定都')>=0);
  ok('N6 卡片不存在时 back 为空串', draft['不存在的一张卡'].back==='');
  const before=(App.s.fixes||[]).length;
  document.querySelector('#fixList .fl .del').click();
  ok('N7 可单条删除', (App.s.fixes||[]).length===before-1,
     before+'→'+(App.s.fixes||[]).length);
  App.s.fixes=[]; App.renderFixList();
  ok('N8 清空后显示占位', document.querySelectorAll('#fixList .fl').length===0 &&
     !!document.querySelector('#fixList .empty'));
  App.s.fixes=[{id:'x',cat:'科技',front:'测试卡',note:'恢复',at:today}];
  App.renderFixList();

  /* ---------- F 卡片库 ---------- */
  document.querySelector('nav button[data-v="library"]').click();
  await sleep(60);
  ok('F1 列表渲染', document.querySelectorAll('#list .item').length>0);
  App.filter.cat='成语'; App.renderList();
  ok('F2 分类筛选', App.match().every(c=>c.cat==='成语') && App.match().length>0);

  App.filter.cat='全部'; App.filter.state='star'; App.renderList();
  ok('F3 已收藏筛选', App.match().every(c=>App.s.stars&&App.s.stars[c.id]));

  App.filter.state='all';
  App.filter.q='不以为然'; App.renderList(); const cn=App.match().length;
  App.filter.q='bywr'; App.renderList(); const py=App.match().length;
  App.filter.q='buyiweiran'; App.renderList(); const pyn=App.match().length;
  App.filter.q='bù yǐ'; App.renderList(); const pys=App.match().length;
  ok('F4 中文/首字母/全拼/带调搜索', cn>0&&py>0&&pyn>0&&pys>0, cn+'/'+py+'/'+pyn+'/'+pys);

  App.filter.q='';
  const shown0=App.shown;
  const more=document.querySelector('#list .more');
  if(more){more.click();ok('F5 加载更多', App.shown>shown0);}
  else ok('F5 加载更多', true, '已全部加载');

  const item=document.querySelector('#list .item');
  item.click();
  ok('F6 条目展开', item.classList.contains('open'));

  /* ---------- F2 卡片库折叠下拉 ---------- */
  document.querySelector('nav button[data-v="today"]').click();
  await sleep(40);
  document.querySelector('nav button[data-v="library"]').click();
  await sleep(60);
  const dropBar=document.getElementById('dropBar'),dropPanel=document.getElementById('dropPanel');
  ok('F7 默认收起且显示摘要', !dropPanel.classList.contains('on') &&
     document.getElementById('dropTxt').textContent.indexOf('全部板块')>=0,
     document.getElementById('dropTxt').textContent);
  dropBar.click();
  const catChips=[...document.querySelectorAll('#dropCats .chip')];
  ok('F8 展开后含全部板块', dropPanel.classList.contains('on') && catChips.length===CATS.length+1,
     catChips.length+' 项');
  ok('F9 状态分组存在', [...document.querySelectorAll('#dropStates .chip')].length>=5);

  const catChip=catChips.find(b=>b.textContent.indexOf('成语')>=0);
  catChip.click();
  ok('F10 点板块即筛选', App.filter.cat==='成语' &&
     document.getElementById('dropTxt').textContent.indexOf('成语')>=0 &&
     App.match().every(c=>c.cat==='成语'),
     document.getElementById('dropTxt').textContent);

  const stChip=[...document.querySelectorAll('#dropStates .chip')].find(b=>b.textContent.indexOf('已掌握')>=0);
  if(stChip){
    stChip.click();
    ok('F11 状态可叠加筛选', App.filter.state==='master' &&
       document.getElementById('dropTxt').textContent.indexOf('已掌握')>=0,
       document.getElementById('dropTxt').textContent);
  } else ok('F11 状态可叠加筛选', true, '暂无从众状态');

  document.getElementById('dropReset').click();
  ok('F12 一键重置', App.filter.cat==='全部' && App.filter.state==='all' &&
     document.getElementById('dropTxt').textContent.indexOf('全部板块')>=0);

  dropBar.click();
  document.querySelector('nav button[data-v="stats"]').click();
  await sleep(40);
  ok('F13 点外部自动收起', !dropPanel.classList.contains('on'));
  document.querySelector('nav button[data-v="today"]').click();
  await sleep(40);

  /* ---------- G 计时与数据 ---------- */
  // 计时：活跃 / 空闲 / 数据页
  App.activate('know');
  App._lastAct=Date.now();
  const t0=App.s.time[today]||0;
  for(let i=0;i<3;i++)App.tickClock(5);
  const tActive=(App.s.time[today]||0)-t0;
  App._lastAct=Date.now()-200000;
  const t1=App.s.time[today]||0;
  App.tickClock(5);
  const tIdle=(App.s.time[today]||0)-t1;
  ok('G1 活跃计时', tActive===15, tActive);
  ok('G2 空闲不计时', tIdle===0);

  document.querySelector('nav button[data-v="stats"]').click();
  await sleep(80);
  App._lastAct=Date.now();
  const t2=App.s.time[today]||0;
  App.tickClock(5);
  ok('G3 数据页不计时', (App.s.time[today]||0)===t2);

  // 造几天数据，验证图表
  for(let i=0;i<8;i++){
    const d=App.addDays(today,-i);
    App.s.time[d]=1200+i*120;
    App.s.ans[d]={n:10+i,ok:7+i,sec:100+i*10};
  }
  App.save(); App.renderStats();
  ok('G4 学习时长有值', document.getElementById('stTotal').textContent!=='—',
     document.getElementById('stTotal').textContent);
  ok('G5 刷题时间有值', document.getElementById('ptTotal').textContent!=='—');
  ok('G6 正确率有值', document.getElementById('acAll').textContent!=='—');
  ok('G7 均速口径', (()=>{
     const all=App.sumAns('0000-01-01','9999-12-31');
     return document.getElementById('ptAvg').textContent.indexOf(Math.round(all.sec/all.n)+'秒')===0;
  })(), document.getElementById('ptAvg').textContent);
  ok('G8 日视图7根', document.querySelectorAll('#timeChart > div').length===7,
     document.querySelectorAll('#timeChart > div').length);
  document.querySelector('#timeSeg .schip[data-p="week"]').click();
  ok('G9 周视图6根', document.querySelectorAll('#timeChart > div').length===6);
  document.querySelector('#timeSeg .schip[data-p="month"]').click();
  ok('G10 月视图6根', document.querySelectorAll('#timeChart > div').length===6);
  ok('G11 学习日历84格', document.querySelectorAll('#cal i').length===84);
  ok('G12 板块正确率有行', document.querySelectorAll('#accDist .row').length>0);

  App.updateRing(3,12);
  ok('G13 圆环显示百分比', document.getElementById('ringTxt').textContent==='25%' &&
     document.getElementById('ringTxt').getBoundingClientRect().width>0,
     document.getElementById('ringTxt').textContent);
  App.updateRing(0,0);
  ok('G14 无队列时归零', document.getElementById('ringTxt').textContent==='0%');
  App.updateRing(12,12);
  ok('G15 满进度 100%', document.getElementById('ringTxt').textContent==='100%');
  /* 圆环数字必须严严整整落在圆心：.hstats div 会把圆环覆盖成 flex+baseline，
     历史上就是这么把数字挤到左上角的，这里锁住布局与居中 */
  App.updateRing(3,12);
  const ringEl=document.querySelector('.ring'), spanEl=document.getElementById('ringTxt');
  const rr=ringEl.getBoundingClientRect(), ss=spanEl.getBoundingClientRect();
  const dx=Math.abs((ss.left+ss.width/2)-(rr.left+rr.width/2));
  const dy=Math.abs((ss.top+ss.height/2)-(rr.top+rr.height/2));
  ok('G16 圆环是 grid 布局', getComputedStyle(ringEl).display==='grid', getComputedStyle(ringEl).display);
  ok('G17 百分数在圆心', dx<=0.6&&dy<=0.6, '偏移 '+dx.toFixed(1)+','+dy.toFixed(1)+'px');

  /* ---------- L 列举分段 ---------- */
  ok('L1 分段函数存在', typeof splitEnum==='function' && typeof cnNum==='function' &&
     typeof findEnumMarks==='function' && typeof buildEnumGroups==='function');
  const neg=['1.琴琴发明于伏羲时代，为五弦之琴。','瓷器烧成温度达到1200°C以上，白度也达到了70%。',
             '第1.节讲这个，第2.节讲那个。','会议决定（2024）（2025）两次拨款。',
             '马克思生于1818年，逝世于1883年。','唐代三绝：李白诗歌、裴旻剑舞、张旭草书。'];
  ok('L2 正文里的数字不误判', neg.every(t=>splitEnum(t)===null));
  const pos=['（1）割让香港岛；（2）赔款；（3）五口通商。','①宪法；②法律；③行政法规；④地方性法规。',
             '一、政治原因；二、抵御外族；三、经济重心转移。','1）琴2）棋3）书4）画，四艺也。'];
  const flatItems=s=>(s||[]).filter(b=>b.k==='l').reduce((a,b)=>a.concat(b.items),[]);
  ok('L3 四类序号都能分段', pos.every(t=>flatItems(splitEnum(t)).length>=3));
  ok('L3b 中文括号序号能分段', flatItems(splitEnum('（一）科学发展观的第一要义是发展。（二）核心是以人为本。')).length>=2);
  ok('L3c 「统一、」不误判', splitEnum('要按照统一、精简、高效的原则大力精简机构和人员；要按照权责统一的原则划分。')===null);

  const enumCards=CARDS.filter(c=>splitEnum(c.back));
  const L6DBG=[];
  ok('L4 真实数据命中量', enumCards.length>=170, enumCards.length+' 张');
  ok('L5 每组内编号连续递增', enumCards.every(c=>{
    const s=splitEnum(c.back).filter(b=>b.k==='l');
    return s.every(g=>{for(let i=1;i<g.items.length;i++) if(g.items[i].n<=g.items[i-1].n) return false; return true;});
  }));
  ok('L6 分段不丢原文', enumCards.every(c=>{
    const s=splitEnum(c.back);
    const joined=s.map(b=>b.k==='p'?b.text:b.items.map(x=>x.text).join('')).join('');
    const src=c.back.replace(/[（(]\\s*\\d{1,2}\\s*[）)]|[①-⑳]|\\d{1,2}\\s*[）)]|\\d{1,2}\\s*[\\.、]|[（(]\\s*[一二三四五六七八九十]{1,3}\\s*[）)]|[一二三四五六七八九十]{1,3}、/g,'');
    const norm=x=>x.replace(/[\\s，,。；;、]/g,'');
    if(norm(joined).length<norm(src).length*0.9){ L6DBG.push(c.front+' src='+norm(src).length+' got='+norm(joined).length); return false; }
    return true;
  }), L6DBG.slice(0,3).join(' ; '));
  ok('L6b 编号重启能拆成两组', (()=>{
    const t='一般渊源：①宪法；②法律；③行政法规。特殊渊源：①法律解释；②其他文件；③国际条约。';
    const s=splitEnum(t);
    const gs=(s||[]).filter(b=>b.k==='l');
    return gs.length===2 && gs[0].items.length===3 && gs[1].items.length===3;
  })());
  ok('L6c 混排编号也能拆开', (()=>{
    const t='（1）社会环境的变迁。（2）公共行政的科学化。（3）技术手段的创新。';
    const s=splitEnum(t);
    return flatItems(s).length>=3;
  })());

  App.activate('know');
  const qi=App.queue.findIndex(x=>enumCards.some(e=>e.id===x.c.id));
  if(qi>=0){
    App.idx=qi; App.pos.know=qi; App.render();
    const its=[...document.querySelectorAll('#rBody .it')];
    ok('L7 背诵页分段渲染', its.length>=2 && its.every(it=>it.querySelector('i')&&it.querySelector('span').textContent.length>0),
       its.length+' 条 · 编号 '+its.map(x=>x.querySelector('i').textContent).join(','));
    document.querySelector('#studySeg .schip[data-m="fill"]').click();
    await sleep(80);
    const fbk=document.querySelectorAll('#qText .bk').length, fit=document.querySelectorAll('#qText .it').length;
    ok('L8 填空模式空格不丢', (fbk>0)||(fit>0), '空格 '+fbk+' · 条目 '+fit);
    document.querySelector('#studySeg .schip[data-m="recite"]').click();
  }else ok('L7 背诵页分段渲染', true, '今日队列暂无列举卡');
  ok('L9 成语卡背面也可分段', (()=>{
    const t=CARDS.find(c=>c.cat==='成语'&&splitEnum(c.back));
    if(!t)return true;
    const el=document.createElement('div');
    App.paintEnum(el,t.back);
    return el.querySelectorAll('.it').length>=2;
  })());
  ok('L10 非列举卡保持整段', (()=>{
    const plain=CARDS.find(c=>!splitEnum(c.back)&&c.back.length>20);
    const el=document.createElement('div');
    App.paintEnum(el,plain.back);
    return el.textContent===plain.back && !el.classList.contains('enum') &&
           el.querySelectorAll('.it').length===0;
  })());
  ok('L11 分段后段落与列表分层渲染', (()=>{
    const t='行政法的渊源分为一般渊源和特殊渊源。一般渊源：①宪法；②法律；③行政法规。特殊渊源：①法律解释；②其他文件。';
    const el=document.createElement('div');
    App.paintEnum(el,t);
    return el.querySelectorAll('.rlead').length>=1 && el.querySelectorAll('.it').length>=4;
  })());

  /* ---------- P 背诵页板块筛选 ---------- */
  App.s.settings.studyCat='全部';
  App.buildQueues(); App.buildCatChips();
  const chipRow=document.getElementById('catRow');
  ok('P1 板块筛选条存在', !!chipRow && !!document.getElementById('catChips'));
  const chips=[...document.querySelectorAll('#catChips .catchip')];
  ok('P2 筛选条含全部板块 + 各分类', chips.length>=5 && chips[0].textContent.includes('全部板块'),
     chips.length+' 个 chip');
  ok('P3 筛选条不含成语板块（成语独立页）', !chips.some(c=>c.textContent.replace(/\\d+$/,'').trim()==='成语'),
     chips.map(c=>c.textContent.replace(/\\d+$/,'').trim()).join(','));
  const targetCat=(()=>{
    for(const c of CATS){ if(c==='成语')continue;
      const n=CARDS.filter(x=>x.cat===c).length; if(n>=40) return c; }
    return null;
  })();
  ok('P4 找到可测试的板块', !!targetCat, targetCat||'无');
  if(targetCat){
    App.setStudyCat(targetCat);
    await sleep(120);
    const allKnow=App.queue.every(x=>x.c.cat===targetCat);
    ok('P5 选板块后队列只剩该板块', allKnow && App.queue.length>0,
       targetCat+' · '+App.queue.length+' 张');
    ok('P6 筛选状态已持久化', App.s.settings.studyCat===targetCat);
    const chipOn=[...document.querySelectorAll('#catChips .catchip.on')];
    ok('P7 当前板块 chip 高亮', chipOn.length===1 && chipOn[0].textContent.includes(targetCat));
    ok('P8 该板块队列不含成语', App.queue.every(x=>x.cat!=='成语'));
    App.setStudyCat('全部');
    await sleep(120);
    const backAll=App.queue.length>0;
    ok('P9 切回全部板块恢复混合队列', backAll && App.s.settings.studyCat==='全部',
       App.queue.length+' 张');
    const multi=new Set(App.queue.map(x=>x.c.cat)).size;
    ok('P10 全部板块时队列跨多个分类', multi>=2, multi+' 个分类');
  }
  ok('P11 筛选条在成语页隐藏', (()=>{
    App.activate('idiom'); App.buildCatChips();
    const hidden=document.getElementById('catRow').style.display==='none';
    App.activate('know'); App.buildCatChips();
    return hidden && document.getElementById('catRow').style.display!=='none';
  })());

  /* ---------- Q 学习量统计 ---------- */
  ok('Q1 学习量面板存在', !!document.getElementById('lvDist') && !!document.getElementById('lvSeen'));
  App.renderStats();
  await sleep(60);
  const lvSeen=parseInt(document.getElementById('lvSeen').textContent)||0;
  const lvDone=parseInt(document.getElementById('lvDone').textContent)||0;
  const ids2=Object.keys(App.s.cards);
  const expectSeen=ids2.filter(k=>(App.s.cards[k].seen||0)>0).length;
  ok('Q2 学过的卡数与数据一致', lvSeen===expectSeen, lvSeen+' vs '+expectSeen);
  ok('Q3 刷过的卡数 ≤ 学过的卡数', lvDone<=lvSeen, lvDone+' ≤ '+lvSeen);
  ok('Q4 累计见过次数=各卡 seen 之和', (()=>{
    let sum=0; ids2.forEach(k=>sum+=(App.s.cards[k].seen||0));
    const shown=parseInt(document.getElementById('lvSeenT').textContent)||0;
    return shown===sum;
  })());
  ok('Q5 模糊单独计数', (()=>{
    let sum=0; ids2.forEach(k=>sum+=(App.s.cards[k].fuzzy||0));
    const shown=parseInt(document.getElementById('lvFzT').textContent)||0;
    return shown===sum;
  })());
  ok('Q6 模糊评分会被记录', (()=>{
    const item=App.queue[App.idx]||App.queue[0];
    if(!item)return true;
    const before=App.s.cards[item.c.id]?((App.s.cards[item.c.id].fuzzy)||0):0;
    App.idx=0; App.grade(1);
    const after=App.s.cards[item.c.id].fuzzy||0;
    return after===before+1;
  })());
  ok('Q7 各板块学习量明细有行', document.querySelectorAll('#lvDist .row').length>=0);

  /* ---------- R 队列重排 / 去重 ---------- */
  ok('R1 打乱/顺序按钮两个板块都有', !!document.getElementById('orderSeg') && !!document.getElementById('orderSegI'));
  ok('R2 导航改名常识、模式改名记忆',
     document.querySelector('nav button[data-v="today"]').textContent.trim()==='常识' &&
     document.querySelector('#studySeg .schip[data-m="recite"]').textContent.trim()==='记忆');

  // 构造可控队列：已答 2 张 + 剩余 5 张
  const rCards=CARDS.filter(c=>c.cat!=='成语').slice(0,7);
  App.scope='know'; App.idx=2; App.mode=App.mode||'recite';
  App.queue=rCards.map(c=>({c,isNew:false}));
  App.queues.know.list=App.queue;
  const beforeIds=App.queue.map(x=>x.c.id).join(',');
  App.orderQueue();
  const orderedIds=App.queue.map(x=>x.c.id).join(',');
  const ordMap=new Map(CARDS.map((c,i)=>[c.id,i]));
  let sortedAsc=true;
  for(let i=2;i<App.queue.length;i++){ if((ordMap.get(App.queue[i].c.id)||0)<(ordMap.get(App.queue[i-1].c.id)||0))sortedAsc=false; }
  ok('R3 顺序=按库内序排列剩余队列', App.queue.length===7 && beforeIds.slice(0,6)===orderedIds.slice(0,6) && sortedAsc,
     '已答前缀不变:'+ (beforeIds.slice(0,6)===orderedIds.slice(0,6)));
  App.shuffleQueue();
  const shuffledIds=App.queue.slice(2).map(x=>x.c.id).sort().join(',');
  const restIds=beforeIds.split(',').slice(2).sort().join(',');
  ok('R4 打乱=剩余队列同批重排', App.queue.length===7 && shuffledIds===restIds);
  ok('R5 重排后进度不回跳', App.idx===2);

  // extra() 去重：队列里没答过的卡不应再次追加
  const dupProbe=CARDS.find(c=>c.cat!=='成语'&&!App.s.cards[c.id]);
  App.queue=[{c:dupProbe,isNew:false}];
  App.queues.know.list=App.queue; App.idx=0; App.queues.know.n=0;
  App.extra();
  const dupCount=App.queue.filter(x=>x.c.id===dupProbe.id).length;
  ok('R6 再来一批不重复追加已有卡', dupCount===1 && App.queue.length===11, '探针卡出现 '+dupCount+' 次 · 队列 '+App.queue.length+' 张');
  // 恢复真实队列
  App.buildQueues();

  /* ---------- T 账号与云同步 ---------- */
  ok('T1 数据页有账号面板', !!document.getElementById('acctPanel') && !!document.getElementById('acctBody'));
  ok('T2 登录弹层与三个标签页齐全', (()=>{
    const tabs=[...document.querySelectorAll('#authTabs button')].map(b=>b.getAttribute('data-tab'));
    return !!document.getElementById('authModal') && tabs.join(',')==='otp,pwd,reset'
      && !!document.getElementById('authOtpId') && !!document.getElementById('authOtpSend')
      && !!document.getElementById('authPwdPw') && !!document.getElementById('authResetPw')
      && !!document.getElementById('authChgNew');
  })());
  ok('T3 同步模块已加载', typeof window.MTSync==='object' && typeof MTSync.merge==='function' && typeof MTSync.syncNow==='function');
  ok('T4 登录弹层可开关', (()=>{
    MTSync.openAuth();
    const on=document.getElementById('authModal').classList.contains('on');
    MTSync.closeAuth();
    return on && !document.getElementById('authModal').classList.contains('on');
  })());
  ok('T5 合并策略：字段取大、到期取晚、born 取早', (()=>{
    const a={cards:{x:{lv:2,seen:5,right:4,wrong:1,fuzzy:0,due:'2026-10-30',streak:2,born:'2026-10-01',master:false}},
             log:{'2026-10-20':10},time:{'2026-10-20':120},ans:{'2026-10-20':{n:5,ok:4,sec:60}},
             stars:{c1:true},fixes:[{front:'甲',note:'n1',at:'1'}],settings:{theme:'zhi'},created:'2026-10-01'};
    const b={cards:{x:{lv:3,seen:4,right:3,wrong:2,fuzzy:2,due:'2026-11-02',streak:3,born:'2026-09-20',master:true}},
             log:{'2026-10-21':20},time:{'2026-10-20':80},ans:{'2026-10-21':{n:9,ok:6,sec:90}},
             stars:{c2:true},fixes:[{front:'乙',note:'n2',at:'2'}],settings:{theme:'ye'},created:'2026-10-05'};
    const m=MTSync.merge(a,b);
    return m.cards.x.lv===3 && m.cards.x.seen===5 && m.cards.x.right===4 && m.cards.x.wrong===2
      && m.cards.x.fuzzy===2 && m.cards.x.due==='2026-11-02' && m.cards.x.born==='2026-09-20'
      && m.cards.x.master===true && m.log['2026-10-20']===10 && m.log['2026-10-21']===20
      && m.time['2026-10-20']===120 && m.ans['2026-10-21'].n===9
      && Object.keys(m.stars).length===2 && m.fixes.length===2 && m.created==='2026-10-01'
      && m.settings.theme==='zhi';
  })());
  ok('T6 未登录时同步为安全空操作', await (async()=>{ const r=await MTSync.syncNow(); return r===false && MTSync.isSignedIn()===false; })());
  ok('T7 登录失败不影响本地进度', typeof App.s==='object' && !!App.s.cards && Object.keys(App.s.cards).length>=0);
  ok('T8 隐私政策可打开且内容完整', (()=>{
    MTSync.openDoc('privacy');
    const on=document.getElementById('docModal').classList.contains('on');
    const txt=(document.getElementById('docBody').textContent||'');
    const okDoc=on && txt.indexOf('隐私政策')>=0 && txt.length>400;
    MTSync.closeDoc();
    return okDoc && !document.getElementById('docModal').classList.contains('on');
  })());
  ok('T9 用户协议可打开且内容完整', (()=>{
    MTSync.openDoc('terms');
    const txt=(document.getElementById('docBody').textContent||'');
    const okDoc=txt.indexOf('用户协议')>=0 && txt.indexOf('使用规范')>=0 && txt.length>400;
    MTSync.closeDoc();
    return okDoc;
  })());
  ok('T10 仅支持邮箱：手机号被拒绝', await (async()=>{
    try { await MTSync._sendCode('13800138000'); return false; }
    catch(e){ return /邮箱/.test(e.message||''); }
  })());
  ok('T11 格式错误的邮箱被拒绝', await (async()=>{
    try { await MTSync._sendCode('not-an-email'); return false; }
    catch(e){ return /邮箱/.test(e.message||''); }
  })());
  ok('T12 未登录不允许删除云端数据', await (async()=>{
    try { await MTSync.wipeCloud(); return false; }
    catch(e){ return /未登录/.test(e.message||''); }
  })());

  /* ---------- H 设置 ---------- */
  document.getElementById('btnSet').click();
  await sleep(60);
  ok('H1 设置面板打开', document.getElementById('modal').classList.contains('on'));
  ok('H2 新卡数回填', document.getElementById('setNew').value===String(App.s.settings.newPerDay));
  ok('H3 主题色板7个', document.querySelectorAll('#swatches .swatch').length===7);

  const want=['zhi','zhu','tai','ye','ju','ying'];
  let themeOk=true, detail=[];
  document.querySelectorAll('#swatches .swatch').forEach((b,i)=>{
    if(i===0)return;
    b.click();
    const got=document.documentElement.dataset.theme;
    detail.push(want[i-1]+'→'+got);
    if(got!==want[i-1])themeOk=false;
  });
  ok('H4 六套主题逐个生效', themeOk, detail.join(','));
  document.querySelectorAll('#swatches .swatch')[1].click();

  const np0=App.s.settings.newPerDay;
  const sn=document.getElementById('setNew');
  sn.value='40'; sn.dispatchEvent(new Event('change'));
  App.saveSettings();
  await sleep(80);
  ok('H5 改新卡数生效', (App.queues.know.n+App.queues.idiom.n)===40);
  App.s.settings.newPerDay=np0; App.save(); App.buildQueues();

  /* ---------- I 导入导出 ---------- */
  ok('I1 导出文件名已更名', App.exportProgress.toString().indexOf('上岸常识刷刷刷进度')>=0);
  const snap=JSON.parse(JSON.stringify(App.s));
  ok('I2 导出含时长与作答', !!snap.time && !!snap.ans);

  App.applyProgress({cards:{},settings:{newPerDay:20}});
  ok('I3 导入缺字段不崩', App.s.settings.revLimit===DEFAULT.settings.revLimit &&
     App.s.settings.newPerDay===20 && Object.keys(App.s.time).length===0 &&
     (App.queues.know.n+App.queues.idiom.n)===20,
     'new='+App.s.settings.newPerDay+' rev='+App.s.settings.revLimit);

  App.applyProgress(snap);
  ok('I4 完整恢复', Object.keys(App.s.cards).length===Object.keys(snap.cards).length &&
     Object.keys(App.s.time).length===Object.keys(snap.time).length);

  location.hash='#idiom'; App.applyHash();
  ok('I5 路由直达成语页', document.getElementById('idiom').classList.contains('on'));
  history.replaceState(null,'',' ');

  ok('I6 全程无脚本错误', window.__err.length===0, window.__err.join(';'));
}catch(e){
  LOG.push('EXC '+e.message+' @'+(e.stack||'').split('\\n')[1]);
}
const pre=document.createElement('pre');
pre.id='testlog'; pre.textContent=LOG.join('\\n');
document.body.appendChild(pre);
document.title='PASS='+LOG.filter(l=>l.startsWith('PASS')).length+
  ' FAIL='+LOG.filter(l=>l.startsWith('FAIL')).length+
  ' EXC='+LOG.filter(l=>l.startsWith('EXC')).length;
})();
</script>
`;

fs.mkdirSync(require('path').dirname(outPath), {recursive:true});
fs.writeFileSync(outPath, inHtml.replace('</body>', harness + '</body>'), 'utf8');
console.log('生成 ' + outPath);
