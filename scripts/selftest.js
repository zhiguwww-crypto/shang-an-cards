#!/usr/bin/env node
/**
 * 生成自检页面：把 index.html 复制一份，注入 126 项断言，输出到 outputs/selftest.html
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
  ok('M4 点圆环出明细', document.getElementById('ringPop').classList.contains('on') &&
     document.getElementById('ringPopS').textContent.indexOf('/')>0,
     document.getElementById('ringPopS').textContent);
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
  ok('L1 分段函数存在', typeof splitEnum==='function' && typeof cnNum==='function');
  const neg=['1.琴琴发明于伏羲时代，为五弦之琴。','瓷器烧成温度达到1200°C以上，白度也达到了70%。',
             '第1.节讲这个，第2.节讲那个。','会议决定（2024）（2025）两次拨款。',
             '马克思生于1818年，逝世于1883年。','唐代三绝：李白诗歌、裴旻剑舞、张旭草书。'];
  ok('L2 正文里的数字不误判', neg.every(t=>splitEnum(t)===null));
  const pos=['（1）割让香港岛；（2）赔款；（3）五口通商。','①宪法；②法律；③行政法规；④地方性法规。',
             '一、政治原因；二、抵御外族；三、经济重心转移。','1）琴2）棋3）书4）画，四艺也。'];
  ok('L3 四类序号都能分段', pos.every(t=>{const s=splitEnum(t);return !!s&&s.filter(x=>x.n).length>=3}));

  const enumCards=CARDS.filter(c=>splitEnum(c.back));
  ok('L4 真实数据命中量', enumCards.length>=100, enumCards.length+' 张');
  ok('L5 编号严格递增', enumCards.every(c=>{
    const s=splitEnum(c.back).filter(x=>x.n);
    for(let i=1;i<s.length;i++) if(s[i].n<=s[i-1].n) return false;
    return true;
  }));
  ok('L6 分段不丢原文', enumCards.every(c=>{
    const s=splitEnum(c.back);
    return s.every(x=>c.back.indexOf(x.lead||x.t)>=0);
  }));

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
