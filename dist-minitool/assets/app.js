/* —— Flex gap 行为检测（Chrome 61 不支持 flex 容器 gap，仅语法检测不可靠） —— */
(function(){
  var flex=document.createElement('div');
  flex.style.position='absolute';flex.style.visibility='hidden';
  flex.style.display='flex';flex.style.flexDirection='column';flex.style.rowGap='1px';
  flex.appendChild(document.createElement('div'));
  flex.appendChild(document.createElement('div'));
  document.body.appendChild(flex);
  var ok=flex.scrollHeight===1;
  flex.parentNode.removeChild(flex);
  if(ok)document.documentElement.classList.remove('no-flex-gap');
})();

const KEY='zhiche_srs_v2';
const SCHEMA=1;   // 进度文件格式版本
const DEFAULT={cards:{},log:{},stars:{},time:{},ans:{},fixes:[],goalHit:null,
  settings:{newPerDay:30,revLimit:200,dailyGoal:60,theme:'auto',cfgVer:3,studyCat:'全部'},created:null};

const CONFIG={
  intervals:[0,1,2,4,7,15,30,60],   // 复习间隔（天）
  masterStreak:4,                    // 连续答对几次算掌握
  maxAnswerSec:300,                  // 单题计时上限（秒）
  idleMs:180000,                     // 多久无操作停止计时（毫秒）
  clockTick:5,                       // 计时器步长（秒）
  swipe:{ dist:70, fastSpeed:0.55, fastDist:26, up:60, dead:8 }
};

const App={
  s:null,queue:[],idx:0,flipped:false,
  scope:'know',
  pos:{know:0,idiom:0},
  queues:{know:{list:[],n:0,r:0},idiom:{list:[],n:0,r:0}},
  sess:{know:{ok:0,total:0},idiom:{ok:0,total:0}},
  session:{ok:0,total:0},
  filter:{cat:'全部',q:'',state:'all'},
  shown:60,
  mode:'recite',
  fixId:null,
  qxCfg:{n:20,cat:'all',order:'shuffle'},
  qx:{list:[],idx:0,answered:false,right:0,wrong:0,startAt:0,timer:null,records:[],used:0,from:''},

  boot(){
    this.s=this.load();
    if(!this.s.created) this.s.created=this.today();
    this.fillSettings();

    this.applyTheme(this.s.settings.theme||'auto');
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{
      if((this.s.settings.theme||'auto')==='auto') this.applyTheme('auto');
    });
    this.paintSeg();
    this.bind(); this.buildSearchIndex(); this.initQuizCfg(); this.buildChips(); this.renderList();
    this.paintGoal(); this.renderStats();
    this.startClock();
    this.buildQueues(); this.buildCatChips(); this.applyHash();
  },

  load(){
    try{
      const raw=localStorage.getItem(KEY);
      if(!raw) return structuredClone(DEFAULT);
      const parsed=JSON.parse(raw);
      const rawSet=(parsed&&parsed.settings&&typeof parsed.settings==='object')?parsed.settings:{};
      const st=Object.assign(typeof structuredClone==='function'?structuredClone(DEFAULT):JSON.parse(JSON.stringify(DEFAULT)),parsed);
      st.settings=Object.assign({},DEFAULT.settings,rawSet);
      // 旧版默认 10/30 偏少：只在从未迁移过时一次性上调，之后完全以用户选择为准
      if((rawSet.cfgVer||1)<3){
        if((rawSet.newPerDay||10)<=10) st.settings.newPerDay=30;
        if((rawSet.revLimit||30)<=30) st.settings.revLimit=200;
        st.settings.cfgVer=3;
      }
      return st;
    }catch(e){ return structuredClone(DEFAULT); }
  },
  save(){
    try{ this.s.schema=SCHEMA; localStorage.setItem(KEY,JSON.stringify(this.s)); }
    catch(e){ this.toast('浏览器禁用了本地存储，进度无法保存'); }
  },

  today(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')},
  addDays(ds,n){const d=new Date(ds+'T00:00:00');d.setDate(d.getDate()+n);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')},

  CELE_MSGS:[
    '今天的这一轮，已经变成你身体里的东西了。',
    '不用很快，别停下就好。',
    '你不是在背题，是在给未来的自己铺路。',
    '错过的那些，明天还会再见，直到你们和解。',
    '慢慢来，比较快。',
    '知识不会辜负每天来见它的人。',
    '今天也稳稳地往前挪了一格。',
    '坚持不是天赋，是你每天做的这件小事。',
    '看不清终点的时候，就先把今天走完。',
    '你不需要一次全对，只需要比昨天多懂一点。',
    '复习是件很笨的事，但它最诚实。',
    '累了就歇一会儿，但别把位置让出去。',
    '今天的努力，会在某个你没想到的地方帮你。',
    '又一天，你和上岸之间近了一点。',
    '把这一天收好，明天继续。',
    '记住这件事本身，就已经很了不起。'
  ],

  CELE_GOAL:[
    '今天的份额，你如约完成了。',
    '说到做到，这一天就没有白过。',
    '目标达成，剩下的时间留给自己。',
    '又稳又准地走完了今天这一程。',
    '你正在把「坚持」变成一件不需要用力的事。',
    '今天到此为止也很好，明天见。'
  ],

  INTERVALS:CONFIG.intervals,
  MASTER_STREAK:CONFIG.masterStreak,

  buildQueues(){
    this._celKey=null;
    const cfg=this.s.settings;
    const rl=cfg.revLimit>0?cfg.revLimit:Infinity;   // 复习总量（两个板块合计）
    const np=cfg.newPerDay||0;                       // 新卡总量（两个板块合计）
    const kp=this.pools(false), ip=this.pools(true);
    const focused=(cfg.studyCat||'全部')!=='全部';   // 背诵页锁定了某一个板块

    let kRev,iRev,kNew,iNew;
    if(focused){
      // 锁定板块时常识优先：新卡额度全给该板块，成语只做复习（用剩余额度）
      kNew=Math.min(kp.fresh.length,np);
      iNew=0;
      kRev=Math.min(kp.due.length,rl);
      iRev=Math.min(ip.due.length,Math.max(0,rl-kRev));
      kRev=Math.min(kp.due.length,Math.max(0,rl-iRev));
    }else{
      // 先对半分，一方不够时把余量让给另一方
      kRev=Math.min(kp.due.length,Math.floor(rl/2));
      iRev=Math.min(ip.due.length,rl-kRev);
      kRev=Math.min(kp.due.length,rl-iRev);
      kNew=Math.min(kp.fresh.length,Math.floor(np/2));
      iNew=Math.min(ip.fresh.length,np-kNew);
      kNew=Math.min(kp.fresh.length,np-iNew);
    }

    this.queues.know=this.compose(kp,kRev,kNew);
    this.queues.idiom=this.compose(ip,iRev,iNew);
    this.sess={know:{ok:0,total:0},idiom:{ok:0,total:0}};
    this.pos={know:0,idiom:0};
    this.activate(this.scope||'know');
  },

  pools(idiom){
    const t=this.today(),st=this.s.cards,due=[],fresh=[];
    const only=(!idiom)?(this.s.settings.studyCat||'全部'):'全部';   // 背诵页板块筛选
    CARDS.forEach(c=>{
      if((c.cat==='成语')!==idiom)return;
      if(only!=='全部'&&c.cat!==only)return;
      const p=st[c.id];
      if(!p){fresh.push(c);return}
      if(p.due&&p.due<=t)due.push(c);
    });
    due.sort((a,b)=>(st[a.id].due<st[b.id].due?-1:1));
    return {due,fresh};
  },

  /* 背诵页的板块筛选条：只列常识板块（成语是独立页，无需筛） */
  buildCatChips(){
    const box=document.getElementById('catChips');
    if(!box)return;
    const cats=CATS.filter(c=>c!=='成语');
    const total={};
    CARDS.forEach(c=>{ if(c.cat==='成语')return; total[c.cat]=(total[c.cat]||0)+1; });
    const cur=this.s.settings.studyCat||'全部';
    const list=['全部'].concat(cats.filter(c=>total[c]));
    box.innerHTML='';
    list.forEach(c=>{
      const b=document.createElement('button');
      b.className='catchip'+(c===cur?' on':'');
      b.innerHTML=(c==='全部'?('全部板块<i>'+CARDS.filter(x=>x.cat!=='成语').length+'</i>'):(esc(c)+'<i>'+(total[c]||0)+'</i>'));
      b.addEventListener('click',()=>this.setStudyCat(c));
      box.appendChild(b);
    });
    // 当前板块今天还有多少张可学
    const t=this.today(),st=this.s.cards;
    let due=0,fresh=0;
    CARDS.forEach(c=>{
      if(c.cat==='成语')return;
      if(cur!=='全部'&&c.cat!==cur)return;
      const p=st[c.id];
      if(!p)fresh++; else if(p.due&&p.due<=t)due++;
    });
    this._catPending=(due+fresh);
    const lab=document.getElementById('queueLabel');
    if(lab&&this.scope==='know'&&this.mode==='recite'){
      lab.textContent=(cur==='全部'?'常识':cur)+' · 待学 '+(due+fresh)+' 张';
    }
    const row=document.getElementById('catRow');
    if(row)row.style.display=(this.scope==='idiom'||!cats.length)?'none':'';
  },

  setStudyCat(cat){
    const cfg=this.s.settings;
    if(cfg.studyCat===cat)return;
    cfg.studyCat=cat;
    this.save();
    // 保留成语队列，只重排常识队列
    const keep=this.queues.idiom;
    this.buildQueues();
    this.queues.idiom=keep;
    this.activate('know');
    this.buildCatChips();
    const n=this.queue.length;
    this.toast(cat==='全部'?'已切回全部板块':(cat+'：今天 '+n+' 张待学'));
  },

  compose(pool,revN,newN){
    const rev=pool.due.slice(0,revN);
    const news=this.mixByCat(pool.fresh,newN);
    return {
      list:rev.map(c=>({c,isNew:false})).concat(news.map(c=>({c,isNew:true}))),
      n:news.length, r:rev.length
    };
  },

  activate(scope){
    this.scope=scope;
    const q=this.queues[scope]||{list:[],n:0,r:0};
    this.queue=q.list;
    this.pos[scope]=Math.min(this.pos[scope]||0,this.queue.length);
    this.idx=this.pos[scope];
    this.flipped=false;
    this.session=this.sess[scope];
    this.render();
  },

  mixByCat(pool,n){
    // 按分类轮转取样，保证每天的新卡覆盖多个类别
    const buckets=new Map();
    for(const c of pool){
      if(!buckets.has(c.cat)) buckets.set(c.cat,[]);
      buckets.get(c.cat).push(c);
    }
    const keys=[...buckets.keys()];
    const out=[];let i=0;
    while(out.length<n && keys.length){
      const k=keys[i%keys.length];
      const b=buckets.get(k);
      if(b.length) out.push(b.shift());
      else { keys.splice(i%keys.length,1); continue; }
      i++;
    }
    return out;
  },

  extra(){
    const seen=new Set(Object.keys(this.s.cards));
    const inQ=new Set(this.queue.map(x=>x.c.id));   // 队列里还没答的卡也不能再进，否则重复出现
    const idiom=this.scope==='idiom';
    const only=(!idiom)?(this.s.settings.studyCat||'全部'):'全部';
    const pool=CARDS.filter(c=>!seen.has(c.id)&&!inQ.has(c.id)&&((c.cat==='成语')===idiom)&&(only==='全部'||c.cat===only));
    if(!pool.length){this.toast('这个板块的卡都学过了');return}
    // 洗牌后取 10 张：固定按库序截取会连点几次都出同样一批
    for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
    this.queue.push(...pool.slice(0,10).map(c=>({c,isNew:true})));
    this.queues[this.scope].list=this.queue;
    this.queues[this.scope].n+=Math.min(10,pool.length);
    document.getElementById(idiom?'doneI':'done').classList.remove('on');
    this.render();
    this.buildCatChips();
  },

  /* 重排当前板块「还没答」的剩余队列（已答的不动，进度不受影响） */
  _reorderRest(fn,label){
    const rest=this.queue.slice(this.idx);
    if(rest.length<2){this.toast('剩余不足两张，无需重排');return}
    fn(rest);
    this.queue.splice(this.idx,rest.length,...rest);
    this.queues[this.scope].list=this.queue;
    this.render();
    this.toast(label+' '+rest.length+' 张');
  },
  shuffleQueue(){
    this._reorderRest(rest=>{
      for(let i=rest.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[rest[i],rest[j]]=[rest[j],rest[i]];}
    },'已随机打乱剩余');
  },
  orderQueue(){
    const ord=new Map(CARDS.map((c,i)=>[c.id,i]));   // 库内原始顺序
    this._reorderRest(rest=>{
      rest.sort((a,b)=>(ord.get(a.c.id)||0)-(ord.get(b.c.id)||0));
    },'已按顺序排列剩余');
  },

  render(){
    if(this.scope==='idiom')return this.renderIdiom();
    return this.renderKnow();
  },

  renderKnow(){
    const wrap=document.getElementById('readWrap');
    const fw=document.getElementById('fillWrap');
    const rt=document.getElementById('rate');
    const dn=document.getElementById('done');
    const total=this.queue.length,doneN=Math.min(this.idx,total);
    document.getElementById('queueCount').textContent=doneN+' / '+total;
    document.getElementById('fill').style.width=total?(doneN/total*100)+'%':'0%';
    this.updateRing(doneN,total);

    if(this.idx>=total){
      wrap.style.display='none';fw.style.display='none';rt.style.display='none';
      dn.classList.add('on');
      const se=this.session,acc=se.total?Math.round(se.ok/se.total*100):0;
      document.getElementById('dNew').textContent=this.queues.know.n;
      document.getElementById('dRev').textContent=this.queues.know.r;
      document.getElementById('dAcc').textContent=acc+'%';
      document.getElementById('doneMsg').textContent=total?('这 '+total+' 张已过完，复习曲线已更新。'):'这一板块今天没有待学的卡片。';
      if(total>0&&this.session.total>0)this.celebrate('know');
      return;
    }
    dn.classList.remove('on');
    if(this.mode==='fill'){
      wrap.style.display='none';rt.style.display='none';
      fw.style.display='';
      this.renderFill();
      return;
    }
    fw.style.display='none';wrap.style.display='';rt.style.display='';
    rt.classList.add('on');
    this.renderRead();
  },

  /* 把正文按列举标记分段渲染；没有列举就原样铺平 */
  paintEnum(el,text){
    if(!el)return;
    const seg=splitEnum(text);
    if(!seg){ el.textContent=text; return; }
    el.innerHTML='';
    seg.forEach(b=>{
      if(b.k==='p'){
        const d=document.createElement('div');
        d.className='rlead';
        d.textContent=b.text;
        el.appendChild(d);
      }else{
        b.items.forEach(it=>{
          const d=document.createElement('div');
          d.className='it';
          const i=document.createElement('i');
          i.textContent=it.disp||it.n;
          const s=document.createElement('span');
          s.textContent=it.text;
          d.appendChild(i);d.appendChild(s);
          el.appendChild(d);
        });
      }
    });
    if(!el.classList.contains('enum'))el.classList.add('enum');
  },

  /* 填空模式：同样的分段，但每段里要能放挖空 */
  paintEnumFill(el,q){
    if(!el)return;
    const seg=splitEnum(q.t);
    if(!seg){ this.appendFillText(el,q.t,q); el.classList.remove('enum'); return; }
    el.innerHTML='';
    seg.forEach(b=>{
      if(b.k==='p'){
        const d=document.createElement('div');
        d.className='qlead';
        this.appendFillText(d,b.text,q);
        el.appendChild(d);
      }else{
        b.items.forEach(it=>{
          const d=document.createElement('div');
          d.className='it';
          const i=document.createElement('i');
          i.textContent=it.disp||it.n;
          const s=document.createElement('span');
          d.appendChild(i);d.appendChild(s);
          this.appendFillText(s,it.text,q);
          el.appendChild(d);
        });
      }
    });
    if(!el.classList.contains('enum'))el.classList.add('enum');
  },

  appendFillText(el,text,q){
    text.split(/(__\d+__)/).forEach(seg=>{
      const m=seg.match(/^__(\d+)__$/);
      if(m){
        const i=+m[1],a=q.a[i];
        const w=Math.min(7,Math.max(2.2,a.length*0.8));
        const sp=document.createElement('span');
        sp.className='bk';sp.dataset.i=i;sp.style.minWidth=w+'em';
        sp.textContent='?';
        sp.addEventListener('click',sp._mtR=function(){this.revealBlank(sp)}.bind(this));
        el.appendChild(sp);
      }else if(seg){
        el.appendChild(document.createTextNode(seg));
      }
    });
  },

  renderRead(){
    const item=this.queue[this.idx];if(!item)return;
    const c=item.c,p=this.s.cards[c.id];
    const lv=p?Math.max(p.lv||0,1):0;
    document.getElementById('queueLabel').textContent=(c.cat==='成语'?'常识':c.cat)+' · '+(item.isNew?'新卡':('复习 第'+lv+'轮'));
    document.getElementById('rTag').textContent=c.cat;
    document.getElementById('rTitle').textContent=c.front;
    this.paintEnum(document.getElementById('rBody'),c.back);
    const meta=document.getElementById('rMeta');
    if(p){meta.textContent='对 '+p.right+' · 错 '+p.wrong+' · 已学 '+(p.seen||0)+' 次';meta.classList.add('on')}
    else{meta.classList.remove('on')}
    this._qAt=Date.now();
    const sb=document.getElementById('btnStar2');
    const on=!!(this.s.stars&&this.s.stars[c.id]);
    sb.textContent=on?'★ 已收藏':'☆ 收藏';
    sb.classList.toggle('on',on);
    const rw=document.getElementById('readWrap');if(rw)rw.scrollTop=0;
  },

  renderIdiom(){
    const st=document.getElementById('stage'),rt=document.getElementById('rateI'),dn=document.getElementById('doneI');
    const total=this.queue.length,doneN=Math.min(this.idx,total);
    document.getElementById('queueCountI').textContent=doneN+' / '+total;
    document.getElementById('fillI').style.width=total?(doneN/total*100)+'%':'0%';
    this.updateRing(doneN,total);

    if(this.idx>=total){
      st.style.display='none';rt.style.display='none';rt.classList.remove('on');
      dn.classList.add('on');
      const se=this.session,acc=se.total?Math.round(se.ok/se.total*100):0;
      document.getElementById('dNewI').textContent=this.queues.idiom.n;
      document.getElementById('dRevI').textContent=this.queues.idiom.r;
      document.getElementById('dAccI').textContent=acc+'%';
      document.getElementById('doneMsgI').textContent=total?('这 '+total+' 张成语已过完，复习曲线已更新。'):'今天没有到期的成语卡。';
      if(total>0&&this.session.total>0)this.celebrate('idiom');
      return;
    }
    dn.classList.remove('on');
    st.style.display='';rt.style.display='';

    const {c,isNew}=this.queue[this.idx];
    const p=this.s.cards[c.id];
    const card=document.getElementById('card');
    card.classList.remove('flipped','leaving');
    const outer=document.getElementById('cardOuter');
    if(outer){outer.classList.remove('fly','dragging');outer.style.transform='';}
    this.flipped=false;rt.classList.remove('on');
    this.updateStarMark();

    this._qAt=Date.now();
    document.getElementById('idlLabel').textContent='成语 · '+(isNew?'新卡':('复习 第'+((p&&p.lv)||1)+'轮'));
    document.getElementById('idlMeta').textContent=isNew?'点击卡片看释义':'先回想，再点击翻面';
    document.getElementById('tagF').innerHTML='<span class="dot"></span>'+(isNew?'NEW':'REVIEW');
    const wf=document.getElementById('wordF');
    wf.innerHTML='';
    const w=document.createElement('div');w.textContent=c.front;
    wf.appendChild(w);
    if(c.py){
      const py=document.createElement('div');py.className='fpy';py.textContent=c.py;
      wf.appendChild(py);
    }
    const s2=document.createElement('small');s2.textContent=isNew?'点击查看释义':'先回想，再翻面';
    wf.appendChild(s2);

    document.getElementById('tagB').textContent=c.cat;
    const bodyEl=document.getElementById('wordB');
    const enumSeg=splitEnum(c.back);
    this.paintEnum(bodyEl,c.back);
    // 分段后本身就是竖排条目，不再做「截断 + 渐隐」的折叠
    const needClamp=c.back.length>170&&!enumSeg;
    bodyEl.classList.toggle('clamp',needClamp);
    const eb=document.getElementById('btnExpand');
    eb.style.display=needClamp?'':'none';
    eb.textContent='展开全文 ↓';
    eb.addEventListener('click',(e)=>{
      e.stopPropagation();
      const c2=bodyEl.classList.toggle('clamp');
      eb.textContent=c2?'展开全文 ↓':'收起 ↑';
    });
    const ex=c.example||'';
    document.getElementById('exBox').style.display=ex?'':'none';
    document.getElementById('exB').textContent=ex;
  },

  updateRing(done,total){
    const C=91.1;
    const pct=total?Math.max(0,Math.min(1,done/total)):0;
    const fg=document.getElementById('ringFg');
    if(fg)fg.style.strokeDashoffset=C*(1-pct);
    const txt=document.getElementById('ringTxt');
    if(txt)txt.textContent=Math.round(pct*100)+'%';
    const ring=document.querySelector('.ring');
    if(ring)ring.title=(total?Math.round(pct*100)+'%':'0%')+' · 当前板块 '+(total?done:'0')+' / '+(total||0);
    const s=document.getElementById('ringPopS');
    if(s)s.textContent=total?('还剩 '+Math.max(0,total-done)+' 张，加油'):'今天这个板块没有待学的卡';
    const d1=document.getElementById('rpDone'), t1=document.getElementById('rpTotal');
    if(d1)d1.textContent=total?done:0;
    if(t1)t1.textContent=total||0;
  },

  toggleRingPop(force){
    const pop=document.getElementById('ringPop');
    if(!pop)return;
    const on=force!==undefined?force:!pop.classList.contains('on');
    pop.classList.toggle('on',on);
  },

  next(){
    this.idx++;
    this.pos[this.scope]=this.idx;
    this.render();
  },

  skip(){
    if(this.idx>=this.queue.length)return;
    this.next();
    this.toast('已跳过，不计入复习');
  },

  flip(){
    if(this.scope!=='idiom')return;
    if(this.idx>=this.queue.length)return;
    this.flipped=!this.flipped;
    document.getElementById('card').classList.toggle('flipped',this.flipped);
    document.getElementById('rateI').classList.toggle('on',this.flipped);
  },

  grade(g,fast){
    if(this.idx>=this.queue.length)return;
    const sec=this._qAt?Math.min(CONFIG.maxAnswerSec,Math.round((Date.now()-this._qAt)/1000)):0;
    const {c}=this.queue[this.idx],t=this.today();
    let p=this.s.cards[c.id];
    if(!p)p=this.s.cards[c.id]={lv:0,due:t,right:0,wrong:0,fuzzy:0,streak:0,seen:0,born:t};
    p.seen=(p.seen||0)+1;
    if(g===2){
      p.right++;p.streak=(p.streak||0)+1;
      p.lv=Math.min((p.lv||0)+1,this.INTERVALS.length-1);
      if(p.streak>=this.MASTER_STREAK&&p.lv>=5)p.master=true;
      p.due=this.addDays(t,this.INTERVALS[p.lv]||1);
      this.session.ok++;
    }else if(g===1){
      p.fuzzy=(p.fuzzy||0)+1;                 // 模糊单独计数，不混进对错
      p.streak=0;p.lv=Math.max(1,p.lv||0);p.due=this.addDays(t,1);this.session.ok+=0.5;
    }else{
      p.wrong++;p.streak=0;p.lv=0;p.due=this.addDays(t,1);
    }
    this.session.total++;
    this.s.log[t]=(this.s.log[t]||0)+1;
    if(g!==1) this.addAnswer(g===2, sec);   // 「模糊」不计题数，只算学习时长
    this.save();

    // 只有成语翻卡需要“卡片飞出后再切下一张”的动效
    if(this.scope==='idiom'&&!fast){
      const card=document.getElementById('card');
      card.classList.add('leaving');
      setTimeout(()=>{this.next();this.touchStats()},170);
      return;
    }
    this.next();
    this.touchStats();
  },

  bind(){
    document.getElementById('btnSkip').addEventListener('click',e=>{e.stopPropagation();this.skip()});
    document.querySelectorAll('#rate .rbtn,#rateI .rbtn').forEach(b=>{
      b.addEventListener('click',e=>{e.stopPropagation();this.grade(+b.dataset.g)});
    });
    document.getElementById('btnSkip2').addEventListener('click',()=>this.skip());
    document.getElementById('btnSkipF').addEventListener('click',()=>this.skip());
    document.getElementById('btnStar2').addEventListener('click',()=>this.starCard());
    const bf=document.getElementById('btnFix');
    if(bf)bf.addEventListener('click',()=>this.openFix());
    const fm=document.getElementById('fixModal');
    if(fm)fm.addEventListener('click',e=>{if(e.target.id==='fixModal')this.closeFix()});
    const db=document.getElementById('dropBar');
    if(db)db.addEventListener('click',e=>{e.stopPropagation();this.toggleDrop()});
    const rg=document.getElementById('ring');
    if(rg)rg.addEventListener('click',e=>{e.stopPropagation();this.toggleRingPop()});
    const dr=document.getElementById('dropReset');
    if(dr)dr.addEventListener('click',e=>{
      e.stopPropagation();
      this.filter.cat='全部';this.filter.state='all';this.shown=60;
      this.buildChips();this.renderList();
    });
    document.addEventListener('click',e=>{
      const panel=document.getElementById('dropPanel');
      if(panel&&panel.classList.contains('on')&&!panel.contains(e.target))this.toggleDrop(false);
      const pop=document.getElementById('ringPop');
      if(pop&&pop.classList.contains('on')&&!pop.contains(e.target))this.toggleRingPop(false);
    });
    document.querySelectorAll('nav button').forEach(b=>{
      b.addEventListener('click',()=>{
        document.querySelectorAll('nav button').forEach(x=>x.classList.remove('on'));
        b.classList.add('on');
        document.querySelectorAll('.view').forEach(v=>v.classList.remove('on'));
        document.getElementById(b.dataset.v).classList.add('on');
        if(b.dataset.v==='today')this.activate('know');
        if(b.dataset.v==='idiom')this.activate('idiom');
        if(b.dataset.v==='today'||b.dataset.v==='idiom')this.buildCatChips();
        if(b.dataset.v==='stats')this.renderStats();
        if(b.dataset.v==='library'){this.toggleDrop(false);this.buildChips();this.renderList();}
        if(b.dataset.v==='quiz'){ this.initQuizCfg(); if(!this.qx.list.length)this.showQxScreen('start'); }
        try{history.replaceState(null,'','#'+b.dataset.v)}catch(e){}
      });
    });
    const cx=document.getElementById('celeX');
    if(cx)cx.addEventListener('click',e=>{e.stopPropagation();this.closeCele()});
    document.addEventListener('keydown',e=>{
      if(e.target.tagName==='INPUT')return;
      const active=document.querySelector('.view.on');
      if(!active||(active.id!=='today'&&active.id!=='idiom'))return;
      if(e.key==='Escape'){ this.closeCele(); return; }
      if(e.code==='Space'){e.preventDefault();this.flip();return}
      const canGrade=(this.scope==='know')||this.flipped;
      if(e.key==='1'&&canGrade)this.grade(0);
      if(e.key==='2'&&canGrade)this.grade(1);
      if(e.key==='3'&&canGrade)this.grade(2);
      if(e.key==='s'||e.key==='S')this.skip();
    });
    const qEl=document.getElementById('q');
    qEl.addEventListener('input',e=>{
      this.filter.q=e.target.value.trim();
      this.shown=60;
      clearTimeout(this._qT);
      this._qT=setTimeout(()=>this.renderList(),120);
    });
    document.getElementById('btnSet').addEventListener('click',()=>this.openModal());
    document.getElementById('modal').addEventListener('click',e=>{if(e.target.id==='modal')this.closeModal()});
    this.bindGestures();
    document.getElementById('btnReveal').addEventListener('click',()=>this.revealFill());
    document.getElementById('btnHide').addEventListener('click',()=>this.renderFill());
    document.querySelectorAll('#rateFill .rbtn').forEach(b=>{
      b.addEventListener('click',()=>this.grade(+b.dataset.g));
    });
    document.querySelectorAll('#studySeg .schip').forEach(b=>{
      b.addEventListener('click',()=>this.setMode(b.dataset.m));
    });
    document.querySelectorAll('#orderSeg .schip,#orderSegI .schip').forEach(b=>{
      b.addEventListener('click',()=>{ b.dataset.o==='shuffle'?this.shuffleQueue():this.orderQueue(); });
    });
    document.querySelectorAll('#qxNums button').forEach(b=>{
      b.addEventListener('click',()=>{
        document.querySelectorAll('#qxNums button').forEach(x=>x.classList.remove('on'));
        b.classList.add('on');
        this.qxCfg.n=+b.dataset.n;
        this.updateQxHint();
      });
    });
    document.getElementById('qxCat').addEventListener('change',e=>{
      this.qxCfg.cat=e.target.value;
      this.updateQxHint();
    });
    document.querySelectorAll('#qxOrder .schip').forEach(b=>{
      b.addEventListener('click',()=>{
        document.querySelectorAll('#qxOrder .schip').forEach(x=>x.classList.remove('on'));
        b.classList.add('on');
        this.qxCfg.order=b.dataset.o;
      });
    });
    document.getElementById('qxGo').addEventListener('click',()=>this.startQuiz());
    document.querySelectorAll('#timeSeg .schip').forEach(b=>{
      b.addEventListener('click',()=>this.renderTime(b.dataset.p));
    });
    ['setNew','setRev','setGoal'].forEach(id=>{
      const el=document.getElementById(id);
      if(el)el.addEventListener('change',()=>{
        this.s.settings.newPerDay=+document.getElementById('setNew').value;
        this.s.settings.revLimit=+document.getElementById('setRev').value;
        const g=document.getElementById('setGoal');
        if(g)this.s.settings.dailyGoal=+g.value;
        this.updateSetHint();
        this.paintGoal();
      });
    });
    document.getElementById('qxNext').addEventListener('click',()=>this.nextQ());
    const qr=document.getElementById('qxRetry');
    if(qr)qr.addEventListener('click',()=>this.retryWrong());
    document.getElementById('qxAgain').addEventListener('click',()=>{
      clearInterval(this.qx.timer);
      this.qx.list=[];this.qx.from='';document.getElementById('qxWrong').innerHTML='';
      const r0=document.getElementById('qxRetry'); if(r0)r0.hidden=true;
      this.showQxScreen('start');
      this.initQuizCfg();
    });
  },

  bindGestures(){
    const stage=document.getElementById('stage');
    const outer=document.getElementById('cardOuter');
    if(!stage||!outer)return;

    /* 兜底：极少数老内核（旧版微信 XWeb / iOS < 13）没有 PointerEvent，
       用 touch 事件合成同结构的事件，保证翻卡与滑动仍可用 */
    if(!window.PointerEvent){
      const mk=(type,x,y)=>{
        const ev=new Event(type,{bubbles:true,cancelable:true});
        ev.clientX=x;ev.clientY=y;ev.pointerType='touch';ev.pointerId=1;
        ev.button=0;ev.buttons=1;return ev;
      };
      stage.addEventListener('touchstart',e=>{
        const t=e.touches[0]; if(t)stage.dispatchEvent(mk('pointerdown',t.clientX,t.clientY));
      },{passive:true});
      stage.addEventListener('touchmove',e=>{
        const t=e.touches[0]; if(t)stage.dispatchEvent(mk('pointermove',t.clientX,t.clientY));
      },{passive:true});
      const fin=e=>{ const t=e.changedTouches&&e.changedTouches[0];
        if(t)stage.dispatchEvent(mk('pointerup',t.clientX,t.clientY)); };
      stage.addEventListener('touchend',fin);
      stage.addEventListener('touchcancel',fin);
    }

    let sx=0,sy=0,dx=0,dy=0,dragging=false,moved=false,t0=0,lock=null;
    const hints=()=>[...document.querySelectorAll('#stage .sh')];
    const clearHints=()=>hints().forEach(h=>h.classList.remove('on'));

    const reset=()=>{
      outer.classList.remove('dragging');
      outer.style.transform='';
      clearHints();
    };

    stage.addEventListener('pointerdown',e=>{
      if(this.scope!=='idiom')return;
      if(this.idx>=this.queue.length)return;
      if(e.target.closest('.skip,.expand'))return;
      if(e.pointerType==='mouse'&&e.button!==0)return;
      dragging=true;moved=false;lock=null;
      sx=e.clientX;sy=e.clientY;dx=0;dy=0;t0=Date.now();
      outer.classList.add('dragging');
      try{stage.setPointerCapture(e.pointerId)}catch(_){}
    });

    stage.addEventListener('pointermove',e=>{
      if(!dragging)return;
      dx=e.clientX-sx;dy=e.clientY-sy;
      if(!moved&&(Math.abs(dx)>CONFIG.swipe.dead||Math.abs(dy)>CONFIG.swipe.dead))moved=true;
      if(!moved)return;
      if(!lock)lock=Math.abs(dx)>Math.abs(dy)?'x':'y';

      if(lock==='x'){
        const dist=Math.max(-150,Math.min(150,dx));
        outer.style.transform='translateX('+dist+'px) rotate('+(dist*0.03)+'deg)';
        clearHints();
        if(this.flipped&&Math.abs(dx)>36){
          const el=dx<0?document.querySelector('#stage .s-right'):document.querySelector('#stage .s-left');
          if(el)el.classList.add('on');
        }
      }else{
        if(dy<0){
          const d=Math.max(dy,-170);
          const k=Math.min(-d,170)/170;
          outer.style.transform='translateY('+(d*0.52)+'px) scale('+(1-k*0.045)+')';
          if(-dy>44){const el=document.querySelector('#stage .s-down');if(el)el.classList.add('on');}
        }else{
          outer.style.transform='translateY('+(Math.min(dy,90)*0.12)+'px)';
          clearHints();
        }
      }
    });

    const end=(kind)=>{
      if(!dragging)return;
      dragging=false;
      const dt=Math.max(Date.now()-t0,1);
      const ax=Math.abs(dx),ay=Math.abs(dy);
      const speed=Math.hypot(dx,dy)/dt;
      outer.classList.remove('dragging');

      // 轻点：翻面（鼠标与触摸统一走这里，不再依赖 click）
      if(!moved){
        reset();
        if(kind==='up'&&dt<700)this.flip();
        return;
      }

      // 上滑：收藏
      if(lock==='y'&&dy<-60){
        reset();this.starCard();return;
      }
      // 左右滑：评分（需先翻面）
      if(this.flipped&&lock==='x'){
        if((ax>CONFIG.swipe.dist&&ax>ay)||(speed>CONFIG.swipe.fastSpeed&&ax>CONFIG.swipe.fastDist&&ax>ay)){
          reset();
          this.flyGrade(dx<0?2:0, dx<0?-1:1);
          return;
        }
      }
      reset();
    };
    stage.addEventListener('pointerup',()=>end('up'));
    stage.addEventListener('pointercancel',()=>end('cancel'));
    stage.addEventListener('pointerleave',()=>{if(dragging)end('leave');});
  },

  flyGrade(g,dir){
    const outer=document.getElementById('cardOuter');
    document.querySelectorAll('#stage .sh').forEach(h=>h.classList.remove('on'));
    if(!outer){this.grade(g,true);return;}
    outer.classList.add('fly');
    outer.style.transform='translateX('+(dir*115)+'%) rotate('+(dir*14)+'deg)';
    setTimeout(()=>{
      outer.classList.remove('fly');
      outer.style.transform='';
      this.grade(g,true);
    },190);
  },

  starCard(){
    const item=this.queue[this.idx];
    if(!item)return;
    const id=item.c.id;
    this.s.stars=this.s.stars||{};
    let on;
    if(this.s.stars[id]){ delete this.s.stars[id]; on=false; this.toast('已取消收藏'); }
    else { this.s.stars[id]=Date.now(); on=true; this.toast('★ 已加入收藏'); }
    this.save();
    this.updateStarMark();
    if(document.getElementById('library').classList.contains('on'))this.buildStateChips();
    if(this.scope==='know'){
      this._qAt=Date.now();
    const sb=document.getElementById('btnStar2');
      if(sb){ sb.textContent=on?'★ 已收藏':'☆ 收藏'; sb.classList.toggle('on',on); }
    }
  },

  updateStarMark(){
    const el=document.getElementById('starMark');
    if(!el)return;
    const item=this.queue[this.idx];
    const on=!!(item&&this.s.stars&&this.s.stars[item.c.id]);
    el.classList.toggle('on',on);
  },

  buildChips(){
    const box=document.getElementById('dropCats');
    if(!box)return;
    const cats=['全部'].concat(CATS);
    box.innerHTML='';
    const counts={};
    CARDS.forEach(c=>counts[c.cat]=(counts[c.cat]||0)+1);
    cats.forEach(c=>{
      const b=document.createElement('button');
      b.className='chip'+(c===this.filter.cat?' on':'');
      b.innerHTML=c==='全部'?('全部<i>'+CARDS.length+'</i>'):(esc(c)+'<i>'+(counts[c]||0)+'</i>');
      b.addEventListener('click',()=>{this.filter.cat=c;this.shown=60;this.buildChips();this.renderList()});
      box.appendChild(b);
    });
    this.buildStateChips();
  },

  buildStateChips(){
    const box=document.getElementById('dropStates');
    if(!box)return;
    const defs=[['all','全部'],['new','未学'],['learning','学习中'],['master','已掌握'],['wrong','有错题'],['star','已收藏']];
    box.innerHTML='';
    defs.forEach(([k,label])=>{
      const n=this.countState(k);
      if(k!=='all'&&n===0)return;
      const b=document.createElement('button');
      b.className='chip st'+(this.filter.state===k?' on':'');
      b.innerHTML=label+'<i>'+n+'</i>';
      b.addEventListener('click',()=>{this.filter.state=k;this.shown=60;this.buildStateChips();this.renderList()});
      box.appendChild(b);
    });
    this.paintDropBar();
  },

  paintDropBar(){
    const txt=document.getElementById('dropTxt');
    if(!txt)return;
    const cat=this.filter.cat==='全部'?'全部板块':this.filter.cat;
    const stateTxt={all:'',new:'未学',learning:'学习中',master:'已掌握',wrong:'有错题',star:'已收藏'}[this.filter.state]||'';
    const n=this.match().length;
    txt.textContent=cat+(stateTxt?' · '+stateTxt:'')+'（'+n+' 张）';
  },

  toggleDrop(force){
    const bar=document.getElementById('dropBar'),panel=document.getElementById('dropPanel');
    if(!bar||!panel)return;
    const on=force!==undefined?force:!panel.classList.contains('on');
    panel.classList.toggle('on',on);
    bar.classList.toggle('on',on);
    bar.setAttribute('aria-expanded',on?'true':'false');
  },

  countState(k){
    if(k==='all')return CARDS.length;
    const st=this.s.cards;
    return CARDS.filter(c=>{
      const p=st[c.id];
      if(k==='new')return !p;
      if(k==='master')return p&&p.master;
      if(k==='learning')return p&&!p.master;
      if(k==='wrong')return p&&(p.wrong||0)>0;
      if(k==='star')return !!(this.s.stars&&this.s.stars[c.id]);
      return false;
    }).length;
  },

  buildSearchIndex(){
    this._idx=CARDS.map(c=>({
      c,
      blob:(c.front+' '+c.back+' '+(c.py||'')+' '+(c.pyi||'')+' '+(c.pyn||''))
             .toLowerCase().replace(/\s+/g,'')
    }));
  },

  match(){
    const st=this.s.cards,k=this.filter.state;
    const qn=this.filter.q.toLowerCase().replace(/\s+/g,'');
    const out=[];
    const idx=this._idx||CARDS.map(c=>({c}));
    for(let i=0;i<idx.length;i++){
      const c=idx[i].c;
      if(this.filter.cat!=='全部'&&c.cat!==this.filter.cat)continue;
      const p=st[c.id];
      if(k==='new'&&p)continue;
      if(k==='master'&&!(p&&p.master))continue;
      if(k==='learning'&&!(p&&!p.master))continue;
      if(k==='wrong'&&!((p&&p.wrong)||0))continue;
      if(k==='star'&&!(this.s.stars&&this.s.stars[c.id]))continue;
      if(!qn) { out.push(c); continue; }
      let blob=idx[i].blob;
      if(blob===undefined){
        blob=(c.front+' '+c.back+' '+(c.py||'')+' '+(c.pyi||'')+' '+(c.pyn||'')).toLowerCase().replace(/\s+/g,'');
        idx[i].blob=blob;
      }
      if(blob.indexOf(qn)>=0)out.push(c);
    }
    return out;
  },

  renderList(){
    const box=document.getElementById('list');
    const arr=this.match();
    this.paintDropBar();
    box.innerHTML='';
    if(!arr.length){box.innerHTML='<div class="empty">没有匹配的卡片</div>';return}
    const show=arr.slice(0,this.shown);
    const frag=document.createDocumentFragment();
    show.forEach(c=>{
      const p=this.s.cards[c.id];
      const d=document.createElement('div');d.className='item';
      const state=!p?'未学':p.master?'已掌握':'第'+((p.lv||1))+'轮';
      d.innerHTML='<h3>'+esc(c.front)+'<span class="badge">'+esc(c.cat)+'</span></h3>'+
        (c.py?'<div class="ipy">'+esc(c.py)+'</div>':'')+
        '<p>'+esc(c.back)+'</p>'+
        '<div class="meta"><span class="st">'+state+'</span>'+
        ((this.s.stars&&this.s.stars[c.id])?'<span class="star">★ 收藏</span>':'')+
        (p?('<span>对 '+p.right+' · 错 '+p.wrong+'</span>'):'')+
        '</div>';
      d.addEventListener('click',()=>d.classList.toggle('open'));
      frag.appendChild(d);
    });
    box.appendChild(frag);
    if(arr.length>show.length){
      const m=document.createElement('button');
      m.className='more';
      m.textContent='加载更多（还有 '+(arr.length-show.length)+' 张）';
      m.addEventListener('click',()=>{this.shown+=120;this.renderList()});
      box.appendChild(m);
    }
  },



  /* ============ 随机测验 ============ */
  showQxScreen(which){
    document.getElementById('qxStart').style.display = which==='start'?'':'none';
    document.getElementById('qxBody').style.display = which==='body'?'':'none';
    document.getElementById('qxDone').classList.toggle('on', which==='done');
    if(which!=='body'){
      document.getElementById('qxProg').textContent='';
      document.querySelector('#quiz .qhead').style.visibility=which==='start'?'hidden':'visible';
    }else{
      document.querySelector('#quiz .qhead').style.visibility='visible';
    }
  },

  shuffleArr(a){
    for(let i=a.length-1;i>0;i--){const j=Math.random()*(i+1)|0;[a[i],a[j]]=[a[j],a[i]]}
    return a;
  },

  /* ============ 出题池：全部 / 单板块 / 错题本 / 收藏 ============ */
  wrongPool(){
    return CARDS.filter(c=>{
      const p=this.s.cards[c.id];
      return p&&(p.wrong||0)>0&&!p.master;
    });
  },
  starPool(){
    const st=this.s.stars||{};
    return CARDS.filter(c=>!!st[c.id]);
  },
  poolFor(cat){
    if(cat==='__wrong__')return this.wrongPool();
    if(cat==='__star__')return this.starPool();
    if(cat==='all'||!cat)return CARDS.slice();
    return CARDS.filter(c=>c.cat===cat);
  },
  catName(cat){
    if(cat==='all')return '全部板块';
    if(cat==='__wrong__')return '错题本';
    if(cat==='__star__')return '已收藏';
    return cat;
  },

  initQuizCfg(){
    const sel=document.getElementById('qxCat');
    if(!sel)return;
    sel.innerHTML='<option value="all">全部板块（'+CARDS.length+' 张）</option>';
    const wn=this.wrongPool().length, sn=this.starPool().length;
    if(wn>0){
      const o=document.createElement('option');
      o.value='__wrong__'; o.textContent='错题本（'+wn+' 张） · 答错过的';
      sel.appendChild(o);
    }
    if(sn>0){
      const o=document.createElement('option');
      o.value='__star__'; o.textContent='已收藏（'+sn+' 张）';
      sel.appendChild(o);
    }
    CATS.forEach(c=>{
      const cnt=CARDS.filter(x=>x.cat===c).length;
      const o=document.createElement('option');
      o.value=c;o.textContent=c+'（'+cnt+' 张）';
      sel.appendChild(o);
    });
    // 当前选中的范围可能因清空错题本而消失，回落到全部
    const has=[...sel.options].some(o=>o.value===this.qxCfg.cat);
    if(!has)this.qxCfg.cat='all';
    sel.value=this.qxCfg.cat;
    this.updateQxHint();
  },

  updateQxHint(){
    const cfg=this.qxCfg;
    const pool=this.poolFor(cfg.cat);
    const n=Math.min(cfg.n,pool.length);
    const el=document.getElementById('qxHint');
    const go=document.getElementById('qxGo');
    if(!el)return;
    if(!pool.length){
      el.textContent=cfg.cat==='__wrong__'
        ? '错题本还是空的：测一组，答错的卡会自动进来。'
        : '这个范围还没有卡片，先收藏几张。';
      if(go){ go.disabled=true; go.style.opacity='.45'; }
      return;
    }
    if(go){ go.disabled=false; go.style.opacity=''; }
    const isSpecial=(cfg.cat==='__wrong__'||cfg.cat==='__star__');
    el.textContent='本次 '+n+' 题 · 来自「'+this.catName(cfg.cat)+'」'+
      (isSpecial?'· 专练模式':'· 每题平均约 6 秒');
  },

  startQuiz(){
    const cfg=this.qxCfg;
    let pool=this.poolFor(cfg.cat);
    if(!pool.length){ this.updateQxHint(); this.toast('这个范围还没有卡片'); return; }
    if(cfg.order==='shuffle')pool=this.shuffleArr(pool);
    this.buildQuiz(pool.slice(0,Math.min(cfg.n,pool.length)),cfg.cat);
  },

  buildQuiz(cards,fromCat){
    if(!cards||!cards.length)return;
    this.qx.from=fromCat||'';
    this.qx.list=cards.map(c=>{
      const opts=[c];
      const same=this.shuffleArr(CARDS.filter(x=>x.id!==c.id&&x.back!==c.back&&x.cat===c.cat));
      for(const o of same){ if(opts.length>=4)break; if(!opts.some(x=>x.back===o.back)) opts.push(o); }
      let guard=0;
      while(opts.length<4&&guard++<300){
        const r=CARDS[Math.random()*CARDS.length|0];
        if(r.id!==c.id&&!opts.some(x=>x.back===r.back)) opts.push(r);
      }
      this.shuffleArr(opts);
      return {card:c,opts,ans:opts.findIndex(x=>x.id===c.id)};
    });
    this.qx.idx=0; this.qx.right=0; this.qx.wrong=0;
    this.qx.answered=false; this.qx.records=[]; this.qx.used=0;
    this.showQxScreen('body');
    this.updateQxBar();
    this.startTimer();
    this.renderQ();
  },

  startTimer(){
    clearInterval(this.qx.timer);
    this.qx.startAt=Date.now();
    const tick=()=>{
      const s=Math.floor((Date.now()-this.qx.startAt)/1000);
      document.getElementById('qxTime').textContent=this.fmtTime(s);
      this.qx.used=s;
    };
    tick();
    this.qx.timer=setInterval(tick,500);
  },

  fmtTime(s){
    const m=String(Math.floor(s/60)).padStart(2,'0');
    return m+':'+String(s%60).padStart(2,'0');
  },

  updateQxBar(){
    const total=this.qx.list.length;
    document.getElementById('qxProg').textContent=(Math.min(this.qx.idx+1,total))+' / '+total;
    document.getElementById('qxOk').textContent=this.qx.right;
    document.getElementById('qxBad').textContent=this.qx.wrong;
    const done=this.qx.right+this.qx.wrong;
    document.getElementById('qxAcc').textContent=done?Math.round(this.qx.right/done*100)+'%':'—';
  },

  renderQ(){
    this._qAt=Date.now();
    const q=this.qx.list[this.qx.idx];
    if(!q){this.finishQuiz();return}
    this.qx.answered=false;
    const c=q.card;
    const stem=document.getElementById('qxStem');
    stem.innerHTML='';
    const main=document.createElement('div');main.textContent=c.front;
    stem.appendChild(main);
    const meta=document.createElement('small');
    meta.textContent=c.cat+(c.py?' · '+c.py:'')+' · 选出正确的解释';
    stem.appendChild(meta);

    const box=document.getElementById('qxOpts');
    box.innerHTML='';
    q.opts.forEach((o,i)=>{
      const b=document.createElement('button');
      b.className='qxopt';
      const t=o.back.length>52?o.back.slice(0,52)+'…':o.back;
      b.innerHTML='<span class="k">'+'ABCD'[i]+'</span><span>'+esc(t)+'</span>';
      b.addEventListener('click',()=>this.answerQ(i));
      box.appendChild(b);
    });

    const nx=document.getElementById('qxNext');
    nx.style.display='none';
    nx.textContent=(this.qx.idx>=this.qx.list.length-1)?'看结果 →':'下一题 →';
    this.updateQxBar();
    document.getElementById('quiz').scrollTop=0;
  },

  answerQ(i){
    if(this.qx.answered)return;
    this.qx.answered=true;
    const q=this.qx.list[this.qx.idx];
    const ok=i===q.ans;
    const els=[...document.querySelectorAll('#qxOpts .qxopt')];
    els.forEach((el,k)=>{
      el.classList.add('done');
      if(k===q.ans)el.classList.add('right');
      else if(k===i)el.classList.add('wrong');
    });
    if(ok){ this.qx.right++; }
    else { this.qx.wrong++; this.qx.records.push({card:q.card,picked:q.opts[i]}); }
    const qsec=this._qAt?Math.min(CONFIG.maxAnswerSec,Math.round((Date.now()-this._qAt)/1000)):0;
    this.addAnswer(ok,qsec);
    this.bumpSRS(q.card, ok);
    this.updateQxBar();
    document.getElementById('qxNext').style.display='';
    this.touchStats();
  },

  nextQ(){
    if(!this.qx.answered)return;
    this.qx.idx++;
    if(this.qx.idx>=this.qx.list.length)this.finishQuiz();
    else this.renderQ();
  },

  finishQuiz(){
    clearInterval(this.qx.timer);
    const total=this.qx.list.length;
    const done=this.qx.right+this.qx.wrong;
    const pct=done?Math.round(this.qx.right/done*100):0;
    document.getElementById('qxT').textContent=this.fmtTime(this.qx.used);
    document.getElementById('qxR').textContent=this.qx.right;
    document.getElementById('qxW').textContent=this.qx.wrong;
    document.getElementById('qxP').textContent=pct+'%';
    const avg=done?(this.qx.used/done):0;
    document.getElementById('qxAvg').textContent=done?avg.toFixed(1)+'s':'—';
    document.getElementById('qxSeal').textContent=pct>=80?'优':pct>=60?'良':'练';

    const wr=document.getElementById('qxWrong');
    wr.innerHTML='';
    if(this.qx.records.length){
      const h=document.createElement('div');
      h.style.cssText='font-size:11px;color:var(--ink-3);letter-spacing:1px;margin:4px 0 2px';
      h.textContent='错题回顾（'+this.qx.records.length+'）';
      wr.appendChild(h);
      this.qx.records.slice(0,12).forEach(r=>{
        const d=document.createElement('div');d.className='w';
        d.innerHTML='<b>'+esc(r.card.front)+'</b><br><s>'+esc((r.picked.back||'').slice(0,34))+'…</s>'+
          '<em>✓ '+esc(r.card.back.slice(0,60))+(r.card.back.length>60?'…':'')+'</em>';
        wr.appendChild(d);
      });
      if(this.qx.records.length>12){
        const m=document.createElement('div');
        m.style.cssText='font-size:10.5px;color:var(--ink-3);text-align:center;padding:6px';
        m.textContent='还有 '+(this.qx.records.length-12)+' 道错题未列出';
        wr.appendChild(m);
      }
    }
    const rt=document.getElementById('qxRetry');
    if(rt){
      const n=this.qx.records.length;
      rt.hidden=!n;
      rt.textContent='只练这 '+n+' 道错题';
    }
    this.showQxScreen('done');
    document.getElementById('quiz').scrollTop=0;
    this.initQuizCfg();       // 错题本数量可能变了
  },

  /* 只练本组错题：用刚答错的卡重开一组 */
  retryWrong(){
    const cards=[];
    const seen=new Set();
    this.qx.records.forEach(r=>{
      if(r&&r.card&&!seen.has(r.card.id)){ seen.add(r.card.id); cards.push(r.card); }
    });
    if(!cards.length){ this.toast('这组没有错题'); return; }
    this.shuffleArr(cards);
    this.buildQuiz(cards,'__wrong__');
  },

  bumpSRS(c, ok){
    const t=this.today();
    let p=this.s.cards[c.id];
    if(!p)p=this.s.cards[c.id]={lv:0,due:t,right:0,wrong:0,streak:0,seen:0,born:t};
    p.seen=(p.seen||0)+1;
    if(ok){
      p.right++;p.streak=(p.streak||0)+1;
      p.lv=Math.min((p.lv||0)+1,this.INTERVALS.length-1);
      if(p.streak>=this.MASTER_STREAK&&p.lv>=5)p.master=true;
      p.due=this.addDays(t,this.INTERVALS[p.lv]||1);
    }else{
      p.wrong++;p.streak=0;p.lv=0;p.due=this.addDays(t,1);
    }
    this.s.log[t]=(this.s.log[t]||0)+1;
    this.save();
  },

  /* ============ 填空模式（共用背诵队列） ============ */
  paintSeg(){
    document.querySelectorAll('#studySeg .schip').forEach(b=>{
      b.classList.toggle('on', b.dataset.m===this.mode);
    });
  },

  setMode(m){
    if(this.mode===m)return;
    this.mode=m;
    this.paintSeg();
    this.render();
  },

  renderFill(){
    const item=this.queue[this.idx];
    if(!item)return;
    const c=item.c;
    const q=quizOf(c);

    // 没有挖空数据的卡直接跳过（不做整段遮盖）
    if(!q){
      this._noQuiz=(this._noQuiz||0)+1;
      if(this._noQuiz<20){ this.next(); return; }
      this._noQuiz=0;
    }
    this._noQuiz=0;

    this._qAt=Date.now();
    document.getElementById('qCat').textContent=c.cat;
    const titleEl=document.getElementById('qTitle');
    titleEl.textContent=c.front;
    titleEl.dataset.secret='';

    const textEl=document.getElementById('qText');
    textEl.innerHTML='';
    const tip=document.getElementById('qTip');
    document.getElementById('rateFill').classList.remove('on');

    this.paintEnumFill(textEl,q);
    tip.textContent='点空格看答案，或「显示全部」一次揭开';
    document.getElementById('fillWrap').scrollTop=0;
  },

  revealBlank(sp){
    const item=this.queue[this.idx];if(!item)return;
    const q=quizOf(item.c);if(!q)return;
    const a=q.a[+sp.dataset.i];
    sp.classList.add('revealed');
    sp.textContent=a;
    if(sp._mtR){sp.removeEventListener('click',sp._mtR);sp._mtR=null;}
    document.getElementById('rateFill').classList.add('on');
  },

  revealFill(){
    const item=this.queue[this.idx];if(!item)return;
    const q=quizOf(item.c);
    if(q)[...document.querySelectorAll('#qText .bk')].forEach(sp=>this.revealBlank(sp));
    document.getElementById('rateFill').classList.add('on');
  },

    renderCalendar(){
    const box=document.getElementById('cal');
    if(!box)return;
    box.innerHTML='';
    const t=new Date(this.today()+'T00:00:00');
    // 回退到本周一，再往前 11 周
    const dow=(t.getDay()+6)%7;           // 周一=0
    const start=new Date(t);start.setDate(start.getDate()-dow-11*7);
    const cells=[];
    for(let i=0;i<84;i++){
      const d=new Date(start);d.setDate(d.getDate()+i);
      const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
      if(d>t){cells.push('<i class="empty"></i>');continue}
      const n=this.s.log[key]||0;
      const lv=n===0?'':n<=5?'d1':n<=12?'d2':n<=25?'d3':'d4';
      cells.push('<i class="'+lv+'" title="'+key+' · '+n+' 张"></i>');
    }
    box.innerHTML=cells.join('');
  },

  /* ============ 学习时长 / 正确率 ============ */
  startClock(){
    if(this._clock)return;
    this._lastAct=Date.now();
    const mark=()=>{this._lastAct=Date.now()};
    ['pointerdown','keydown','wheel','touchstart'].forEach(ev=>
      document.addEventListener(ev,mark,{passive:true}));
    this._clock=setInterval(()=>this.tickClock(CONFIG.clockTick),CONFIG.clockTick*1000);
    document.addEventListener('visibilitychange',()=>{ if(document.hidden)this.save(); });
    window.addEventListener('beforeunload',()=>this.save());
  },

  tickClock(sec){
    if(document.hidden)return;
    const v=document.querySelector('.view.on');
    if(!v||v.id==='stats')return;                     // 数据页不计时
    if(Date.now()-this._lastAct>CONFIG.idleMs)return;         // 3 分钟无操作不计时
    this.gainTime(sec);
  },

  gainTime(sec){
    const t=this.today();
    this.s.time=this.s.time||{};
    this.s.time[t]=(this.s.time[t]||0)+sec;
    this._tp=(this._tp||0)+sec;
    if(this._tp>=30){ this._tp=0; this.save(); }       // 每 30 秒落盘一次
  },

  addAnswer(ok,sec){
    const t=this.today();
    this.s.ans=this.s.ans||{};
    const a=this.s.ans[t]||(this.s.ans[t]={n:0,ok:0,sec:0});
    a.n++; if(ok)a.ok++;
    a.sec=Math.round((a.sec||0)+Math.max(0,sec||0));
    this.paintGoal();
    this.checkGoal();
  },

  /* ============ 每日目标 ============ */
  goalN(){
    const a=(this.s.ans||{})[this.today()];
    return (a&&a.n)||0;
  },
  goalVal(){
    const g=this.s.settings&&this.s.settings.dailyGoal;
    return g>0?g:0;
  },
  paintGoal(){
    const row=document.getElementById('goalRow');
    if(!row)return;
    const g=this.goalVal();
    if(!g){ row.classList.add('hide'); return; }
    row.classList.remove('hide');
    const n=this.goalN();
    const pct=Math.min(100,g?Math.round(n/g*100):0);
    row.classList.toggle('done',n>=g);
    const txt=document.getElementById('goalText');
    if(txt)txt.innerHTML='今日目标 <b>'+n+' / '+g+'</b>';
    const fill=document.getElementById('goalFill');
    if(fill)fill.style.width=pct+'%';
    const tip=document.getElementById('goalTip');
    if(tip)tip.textContent=n>=g?'✓ 已达成':'还差 '+Math.max(0,g-n)+' 题';
  },
  checkGoal(){
    const g=this.goalVal();
    if(!g)return;
    const t=this.today();
    if(this.goalN()<g)return;
    if(this.s.goalHit===t)return;      // 每天只庆祝一次
    this.s.goalHit=t;
    this.save();
    this.showGoalCele();
  },
  showGoalCele(){
    const box=document.getElementById('cele');
    const msg=document.getElementById('celeMsg');
    const sub=document.getElementById('celeSub');
    if(!box||!msg)return;
    const list=this.CELE_GOAL||[];
    msg.textContent=list.length?list[Math.floor(Math.random()*list.length)]:'今天的目标完成了。';
    if(sub){
      const se=this.session||{ok:0,total:0};
      const acc=se.total?Math.round(se.ok/se.total*100):0;
      sub.textContent='今日 '+this.goalVal()+' 题已达成'+(se.total?' · 本轮正确率 '+acc+'%':'');
    }
    box.classList.add('on');
    box.setAttribute('aria-hidden','false');
    this.runFireworks(3400);
    clearTimeout(this._celT);
    this._celT=setTimeout(()=>this.closeCele(),3600);
  },

  isoOf(d){
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  },
  weekStart(){
    const d=new Date(this.today()+'T00:00:00');
    d.setDate(d.getDate()-((d.getDay()+6)%7));
    return this.isoOf(d);
  },
  monthStart(){ return this.today().slice(0,8)+'01'; },

  sumTime(from,to){
    let v=0;
    const t=this.s.time||{};
    for(const k in t){ if(k>=from&&k<=to)v+=t[k]||0; }
    return v;
  },
  sumAns(from,to){
    let n=0,ok=0,sec=0;
    const a=this.s.ans||{};
    for(const k in a){
      if(k<from||k>to)continue;
      n+=a[k].n||0; ok+=a[k].ok||0; sec+=a[k].sec||0;
    }
    return {n,ok,sec};
  },

  dur(sec){
    if(!sec||sec<=0)return {v:'0',u:'分'};
    if(sec<60)return {v:sec,u:'秒'};
    if(sec<3600)return {v:Math.round(sec/60),u:'分'};
    const h=sec/3600;
    return {v:(h>=10?Math.round(h):Math.round(h*10)/10),u:'小时'};
  },
  fmtMin(sec){
    if(!sec||sec<=0)return '0';
    if(sec<3600)return Math.round(sec/60)+'分';
    return (Math.round(sec/360)/10)+'时';
  },
  setKpi(id,sec,hasData){
    const el=document.getElementById(id); if(!el)return;
    if(!hasData){ el.innerHTML='—'; return; }
    const d=this.dur(sec);
    el.innerHTML=d.v+'<i>'+d.u+'</i>';
  },
  setPct(id,ok,n){
    const el=document.getElementById(id); if(!el)return;
    el.innerHTML=n>0?(Math.round(ok/n*100)+'<i>%</i>'):'—';
  },

  renderTime(mode){
    this.timeP=mode||this.timeP||'day';
    document.querySelectorAll('#timeSeg .schip').forEach(b=>{
      b.classList.toggle('on',b.dataset.p===this.timeP);
    });
    const box=document.getElementById('timeChart');
    const unit=document.getElementById('timeUnit');
    if(!box)return;
    const t=this.today(),data=[];

    if(this.timeP==='day'){
      unit.textContent='最近 7 天 · 每天';
      for(let i=6;i>=0;i--){
        const d=this.addDays(t,-i);
        data.push({lab:i===0?'今天':d.slice(5),v:(this.s.time||{})[d]||0,now:i===0});
      }
    }else if(this.timeP==='week'){
      unit.textContent='最近 6 周 · 周一起算';
      const ws=this.weekStart();
      for(let i=5;i>=0;i--){
        const from=this.addDays(ws,-7*i),to=this.addDays(from,6);
        data.push({lab:i===0?'本周':from.slice(5),v:this.sumTime(from,to),now:i===0});
      }
    }else{
      unit.textContent='最近 6 个月 · 每月';
      const d=new Date(t+'T00:00:00');
      for(let i=5;i>=0;i--){
        const m=new Date(d.getFullYear(),d.getMonth()-i,1);
        const last=new Date(m.getFullYear(),m.getMonth()+1,0);
        data.push({lab:(m.getMonth()+1)+'月',
                   v:this.sumTime(this.isoOf(m),this.isoOf(last)),now:i===0});
      }
    }

    const sum=data.reduce((a,b)=>a+b.v,0);
    box.innerHTML='';
    if(sum<=0){
      box.style.height='auto';
      box.innerHTML='<div class="chartEmpty">暂无学习时长记录<br>在记忆 / 背诵 / 成语 / 测验里待上几分钟就会出现</div>';
      return;
    }
    box.style.height='';
    const max=Math.max(1,...data.map(x=>x.v));
    data.forEach(x=>{
      const el=document.createElement('div');
      if(x.now)el.className='today';
      el.innerHTML='<i style="height:'+Math.max(3,Math.round(x.v/max*84))+'px"></i>'+
        '<span>'+x.lab+'</span><span>'+this.fmtMin(x.v)+'</span>';
      box.appendChild(el);
    });
  },

  renderMetrics(){
    const t=this.today();
    const hasTime=Object.keys(this.s.time||{}).length>0;

    // 学习时长
    this.setKpi('stTotal',this.sumTime('0000-01-01','9999-12-31'),hasTime);
    this.setKpi('stToday',this.sumTime(t,t),!!(this.s.time||{})[t]);
    this.setKpi('stWeek',this.sumTime(this.weekStart(),t),hasTime);
    this.setKpi('stMonth',this.sumTime(this.monthStart(),t),hasTime);
    this.renderTime(this.timeP||'day');

    // 刷题时间
    const all=this.sumAns('0000-01-01','9999-12-31');
    this.setKpi('ptTotal',all.sec,all.n>0);
    const avgEl=document.getElementById('ptAvg');
    if(avgEl)avgEl.innerHTML=all.n>0?(Math.round(all.sec/all.n)+'<i>秒/题</i>'):'—';
    const td=this.sumAns(t,t);
    this.setKpi('ptToday',td.sec,td.n>0);
    const qEl=document.getElementById('ptQ');
    if(qEl)qEl.innerHTML=all.n+'<i>题</i>';

    // 正确率
    const st=this.s.cards;let R=0,W=0;
    for(const k in st){R+=st[k].right||0;W+=st[k].wrong||0;}
    this.setPct('acAll',R,R+W);
    this.setPct('acToday',td.ok,td.n);
    const wk=this.sumAns(this.weekStart(),t);
    this.setPct('acWeek',wk.ok,wk.n);
    const mo=this.sumAns(this.monthStart(),t);
    this.setPct('acMonth',mo.ok,mo.n);

    // 各板块正确率
    const box=document.getElementById('accDist');
    if(!box)return;
    box.innerHTML='';
    const rows=CATS.map(cat=>{
      let r=0,w=0;
      CARDS.forEach(c=>{
        if(c.cat!==cat)return;
        const p=st[c.id];
        if(p){r+=p.right||0;w+=p.wrong||0;}
      });
      return {cat,n:r+w,ok:r};
    }).filter(x=>x.n>0).sort((a,b)=>b.n-a.n);

    if(!rows.length){
      box.innerHTML='<div class="chartEmpty" style="height:62px">还没有作答记录</div>';
      return;
    }
    rows.forEach(x=>{
      const pct=Math.round(x.ok/x.n*100);
      const row=document.createElement('div');
      row.className='row';
      row.innerHTML='<span class="nm">'+esc(x.cat)+'</span>'+
        '<span class="tr"><i style="width:'+Math.max(2,pct)+'%"></i></span>'+
        '<span class="cnt">'+x.n+' 题</span>'+
        '<b>'+(x.n>=3?pct+'%':'样本少')+'</b>';
      row.title=x.cat+'：对 '+x.ok+' / 共 '+x.n+'（'+pct+'%）';
      box.appendChild(row);
    });
  },

  /* ============ 完成庆祝 ============ */
  celebrate(scope){
    if(!this.queue||this.queue.length<=0)return;
    const key=(scope||this.scope)+':'+this.queue.length;
    if(this._celKey===key)return;      // 同一次完成只放一次
    this._celKey=key;
    this.showCele();
  },

  showCele(){
    const box=document.getElementById('cele');
    const msg=document.getElementById('celeMsg');
    const sub=document.getElementById('celeSub');
    if(!box||!msg)return;

    const list=this.CELE_MSGS||[];
    let i=0;
    if(list.length){
      i=Math.floor(Math.random()*list.length);
      if(list.length>1&&i===this._msgLast){ i=(i+1+Math.floor(Math.random()*(list.length-1)))%list.length; }
      this._msgLast=i;
    }
    msg.textContent=list[i]||'今天也辛苦了。';

    const se=this.session||{ok:0,total:0};
    const acc=se.total?Math.round(se.ok/se.total*100):0;
    sub.textContent='完成 '+(this.queue?this.queue.length:0)+' 张'+(se.total?' · 正确率 '+acc+'%':'');

    box.classList.add('on');
    box.setAttribute('aria-hidden','false');
    this.runFireworks(3400);
    clearTimeout(this._celT);
    this._celT=setTimeout(()=>this.closeCele(),3600);
  },

  /* 右上角关闭号：立刻收起祝福卡，烟花也一起停 */
  closeCele(){
    const box=document.getElementById('cele');
    if(box){ box.classList.remove('on'); box.setAttribute('aria-hidden','true'); }
    clearTimeout(this._celT);
    clearTimeout(this._fxStop);
    if(this._fxRaf){ cancelAnimationFrame(this._fxRaf); this._fxRaf=0; }
    const cv=document.getElementById('fx');
    if(cv&&cv.getContext){
      const ctx=cv.getContext('2d');
      ctx.clearRect(0,0,cv.width,cv.height);
      cv.style.display='none';
    }
  },

  runFireworks(ms){
    const cv=document.getElementById('fx');
    if(!cv||!cv.getContext)return;
    if(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;

    const ctx=cv.getContext('2d');
    const dpr=Math.min(2,window.devicePixelRatio||1);
    const W=window.innerWidth,H=window.innerHeight;
    cv.width=Math.round(W*dpr);cv.height=Math.round(H*dpr);
    cv.style.width=W+'px';cv.style.height=H+'px';
    ctx.setTransform(dpr,0,0,dpr,0,0);
    cv.style.display='block';

    const COLORS=['#d0604b','#e2a24d','#4f9a82','#5f93c9','#c4738f','#c9a35f'];
    const parts=[];
    const bursts=[];
    const N=6;
    for(let k=0;k<N;k++){
      // 左右两侧交替，避开中间的祝福卡
      const side=k%2===0?-1:1;
      const x=W/2+side*W*(0.16+Math.random()*0.30);
      const y=H*(k<2?0.13+Math.random()*0.12:0.16+Math.random()*0.26);
      bursts.push({
        t:k*260+Math.random()*120,
        x:Math.max(40,Math.min(W-40,x)),
        y:Math.max(60,Math.min(H*0.52,y)),
        c:COLORS[Math.floor(Math.random()*COLORS.length)]
      });
    }
    const start=performance.now();
    cancelAnimationFrame(this._fxRaf||0);
    // 兜底：即使 rAF 被节流也要收回画布
    clearTimeout(this._fxStop);
    this._fxStop=setTimeout(()=>{
      cancelAnimationFrame(this._fxRaf||0);
      ctx.clearRect(0,0,W,H);
      cv.style.display='none';
    },ms+2200);

    const step=(now)=>{
      const el=now-start;
      bursts.forEach(b=>{
        if(b.done||el<b.t)return;
        b.done=true;
        const n=34+Math.floor(Math.random()*14);
        for(let k=0;k<n;k++){
          const a=(Math.PI*2*k/n)+Math.random()*0.16;
          const sp=2.0+Math.random()*4.2;
          parts.push({x:b.x,y:b.y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,
                      life:1,dec:0.009+Math.random()*0.007,c:b.c,r:1.2+Math.random()*1.4});
        }
        parts.push({x:b.x,y:b.y,vx:0,vy:0,life:1,dec:0.06,c:'#ffffff',r:6,flash:true});
      });

      ctx.clearRect(0,0,W,H);
      for(let k=parts.length-1;k>=0;k--){
        const p=parts[k];
        p.x+=p.vx;p.y+=p.vy;
        p.vx*=0.982;p.vy=p.vy*0.982+0.045;
        p.life-=p.dec;
        if(p.life<=0){parts.splice(k,1);continue}
        const a=Math.max(0,p.life);
        ctx.fillStyle=p.c;
        // 外圈柔光 + 内芯，比单纯加 shadowBlur 便宜
        if(!p.flash){
          ctx.globalAlpha=a*0.12;
          ctx.beginPath();ctx.arc(p.x,p.y,p.r*2.1,0,6.2832);ctx.fill();
        }
        ctx.globalAlpha=a*(p.flash?0.8:0.92);
        ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,6.2832);ctx.fill();
      }
      ctx.globalAlpha=1;

      if(el<ms||parts.length){
        if(el>ms+2000){parts.length=0;}
        this._fxRaf=requestAnimationFrame(step);
      }else{
        ctx.clearRect(0,0,W,H);
        cv.style.display='none';
      }
    };
    this._fxRaf=requestAnimationFrame(step);
  },

  touchStats(){
    this._statsDirty=true;
    this.updateHeader();
  },

  updateHeader(){
    document.getElementById('hToday').textContent=this.s.log[this.today()]||0;
    let streak=0,d=this.today();
    if(!this.s.log[d])d=this.addDays(d,-1);
    while(this.s.log[d]){streak++;d=this.addDays(d,-1)}
    document.getElementById('hStreak').textContent=streak;
  },

  renderStats(){
    this._statsDirty=false;
    this.renderFixList();
    const st=this.s.cards,ids=Object.keys(st);
    const master=ids.filter(k=>st[k].master).length;
    let right=0,wrong=0,reviews=0;
    ids.forEach(k=>{right+=st[k].right||0;wrong+=st[k].wrong||0;reviews+=(st[k].seen||0)});
    const acc=(right+wrong)>0?Math.round(right/(right+wrong)*100):0;
    document.getElementById('sTotal').textContent=CARDS.length;
    document.getElementById('sSeen').innerHTML=ids.length+'<i>张</i>';
    document.getElementById('sMaster').innerHTML=master+'<i>张</i>';
    document.getElementById('sReviews').innerHTML=reviews+'<i>次</i>';
    document.getElementById('sAcc').textContent=(right+wrong)>0?acc+'%':'—';
    const sg=document.getElementById('sGoal');
    if(sg){
      const g=this.goalVal();
      sg.innerHTML=g?(this.goalN()+'<i>/'+g+' 题</i>'):'—';
    }
    const fn=document.getElementById('fixN');
    if(fn)fn.textContent=(this.s.fixes||[]).length;
    this.paintGoal();
    this.updateHeader();
    this.renderCalendar();
    this.renderVolume();

    const week=document.getElementById('week');week.innerHTML='';
    const t=this.today();let total7=0,max=1;const buckets=[];
    for(let i=0;i<7;i++){
      const day=this.addDays(t,i);
      const n=ids.filter(k=>st[k].due===day).length;
      buckets.push({day,n,i});total7+=n;max=Math.max(max,n);
    }
    buckets.forEach(b=>{
      const el=document.createElement('div');
      if(b.i===0)el.className='today';
      el.innerHTML='<i style="height:'+Math.max(3,b.n/max*88)+'px"></i><span>'+(b.i===0?'今天':b.day.slice(5))+'</span><span>'+b.n+'</span>';
      week.appendChild(el);
    });
    document.getElementById('sDue').innerHTML=total7+'<i>张</i>';

    const dist=document.getElementById('dist');dist.innerHTML='';
    CATS.forEach(cat=>{
      const cs=CARDS.filter(c=>c.cat===cat);
      if(!cs.length)return;
      const m=cs.filter(c=>st[c.id]&&st[c.id].master).length;
      const pct=Math.round(m/cs.length*100);
      const row=document.createElement('div');row.className='row';
      row.innerHTML='<span class="nm">'+esc(cat)+'</span><span class="tr"><i style="width:'+pct+'%"></i></span><b>'+m+'/'+cs.length+'</b>';
      dist.appendChild(row);
    });
    this.renderMetrics();
  },

  /* ============ 学习量统计：学过 / 背过 / 模糊 / 刷过 ============ */
  renderVolume(){
    const st=this.s.cards, ids=Object.keys(st);
    let seenN=0,passN=0,fuzzyN=0,doneN=0,right=0,fuzzy=0,wrong=0,seenT=0;
    ids.forEach(k=>{
      const p=st[k]||{};
      const s=p.seen||0, r=p.right||0, w=p.wrong||0, f=p.fuzzy||0;
      if(s>0)seenN++;
      if(r>0)passN++;
      if(f>0)fuzzyN++;
      if(r>0||f>0||w>0)doneN++;
      right+=r;wrong+=w;fuzzy+=f;seenT+=s;
    });
    const set=(id,v,u)=>{const el=document.getElementById(id);if(el)el.innerHTML=v+'<i>'+u+'</i>';};
    set('lvSeen',seenN,'张'); set('lvPass',passN,'张');
    set('lvFuzzy',fuzzyN,'张'); set('lvDone',doneN,'张');
    set('lvRight',right,'次'); set('lvFzT',fuzzy,'次');
    set('lvWrong',wrong,'次'); set('lvSeenT',seenT,'次');

    // 各板块学习量明细
    const box=document.getElementById('lvDist');
    if(!box)return;
    box.innerHTML='';
    const rows=CATS.map(cat=>{
      let seen=0,pass=0,fz=0,done=0;
      CARDS.forEach(c=>{
        if(c.cat!==cat)return;
        const p=st[c.id]; if(!p)return;
        const s=p.seen||0,r=p.right||0,w=p.wrong||0,f=p.fuzzy||0;
        if(s>0)seen++;
        if(r>0)pass++;
        if(f>0)fz++;
        if(r>0||f>0||w>0)done++;
      });
      return {cat:cat,seen:seen,pass:pass,fz:fz,done:done};
    }).filter(x=>x.seen>0).sort((a,b)=>b.seen-a.seen);

    if(!rows.length){
      box.innerHTML='<div class="chartEmpty" style="height:62px">还没有学习记录<br>在记忆 / 背诵 / 成语里评几张卡就会出现</div>';
      return;
    }
    rows.forEach(x=>{
      const row=document.createElement('div');
      row.className='row';
      row.innerHTML='<span class="nm">'+esc(x.cat)+'</span>'+
        '<span class="tr"><i style="width:'+Math.max(2,Math.round(x.done/Math.max(1,rows[0].done)*100))+'%"></i></span>'+
        '<span class="cnt">'+x.seen+'/'+x.pass+'/'+x.fz+'/'+x.done+'</span>'+
        '<b>'+x.done+' 张</b>';
      row.title=x.cat+'：学过 '+x.seen+' 张 · 背过 '+x.pass+' 张 · 模糊 '+x.fz+' 张 · 刷过 '+x.done+' 张';
      box.appendChild(row);
    });
  },

  /* ============ 卡片纠错（本地记录，可一键复制） ============ */
  openFix(){
    const item=this.queue&&this.queue[this.idx];
    if(!item){ this.toast('先翻到一张卡'); return; }
    this.fixId=item.c.id;
    const pre=document.getElementById('fixPre');
    if(pre)pre.textContent=item.c.front+'：'+item.c.back.slice(0,80)+(item.c.back.length>80?'…':'');
    const ta=document.getElementById('fixNote');
    if(ta)ta.value='';
    document.getElementById('fixModal').classList.add('on');
    setTimeout(()=>{ if(ta)ta.focus(); },180);
  },
  closeFix(){
    document.getElementById('fixModal').classList.remove('on');
    this.fixId=null;
  },
  saveFix(){
    const ta=document.getElementById('fixNote');
    const note=(ta&&ta.value||'').trim();
    const c=CARDS.find(x=>x.id===this.fixId);
    if(!c){ this.closeFix(); return; }
    if(!note){ this.toast('写点什么再保存'); return; }
    this.s.fixes=Array.isArray(this.s.fixes)?this.s.fixes:[];
    this.s.fixes.push({id:c.id,cat:c.cat,front:c.front,note,at:this.today()});
    this.save();
    this.closeFix();
    this.toast('已记录，可在数据页生成校正草稿');
    this.renderFixList();
  },
  /* 纠错记录列表：最新的在前，可单条删除 */
  renderFixList(){
    const box=document.getElementById('fixList');
    const fn=document.getElementById('fixN');
    if(fn)fn.textContent=(this.s.fixes||[]).length;
    if(!box)return;
    const list=(this.s.fixes||[]).slice().reverse();
    box.innerHTML='';
    if(!list.length){
      box.innerHTML='<div class="empty">暂无纠错记录</div>';
      return;
    }
    list.forEach(f=>{
      const i=(this.s.fixes||[]).indexOf(f);
      const row=document.createElement('div');
      row.className='fl';
      const left=document.createElement('div');
      left.className='fx';
      left.innerHTML='<b>'+esc(f.front||'')+'</b>'+
        '<div class="nt">'+esc(f.note||'')+'</div>'+
        '<div class="fd">'+esc(f.cat||'')+' · '+esc(f.at||'')+'</div>';
      const del=document.createElement('button');
      del.className='del';del.title='删除这条';del.textContent='×';
      del.addEventListener('click',()=>{
        this.s.fixes.splice(i,1); this.save(); this.renderFixList(); this.toast('已删除这条纠错');
      });
      row.appendChild(left);row.appendChild(del);
      box.appendChild(row);
    });
  },
  /* 把纠错记录整理成 overrides.json 的格式：front → {back, _note, _cat, _at}
     下载 + 复制双路，用户发我后由我补上修正后的 back 再合并进 data/overrides.json */
  exportFixDraft(dryRun){
    const list=this.s.fixes||[];
    if(!list.length){ this.toast('还没有纠错记录'); return null; }
    const draft={};
    list.forEach(f=>{
      if(!f||!f.front)return;
      const card=CARDS.find(c=>c.front===f.front);
      draft[f.front]={
        back:(card&&card.back)||'',
        _note:f.note||'',
        _cat:f.cat||(card&&card.cat)||'',
        _at:f.at||''
      };
    });
    if(dryRun)return draft;                 // 自检用：只产出不落地
    const n=Object.keys(draft).length;
    const data=JSON.stringify(draft,null,1);
    this.shareOut('校正草稿（'+n+' 条）','校正草稿_'+this.today()+'.json',data,'已生成 '+n+' 条校正草稿');
    return draft;
  },
  /* —— 分享/备份出口：容器内无剪贴板与文件下载，改为展示可选文本引导手动复制 —— */
  inMiniTool(){
    return !!(window.xhs&&window.xhs.miniTool);
  },
  shareOut(title,name,text,okMsg){
        this.showTextModal(title,text);
  },
  showTextModal(title,text){
    const ov=document.createElement('div');
    ov.className='mt-share';
    const box=document.createElement('div');
    box.className='mt-share-c';
    const h=document.createElement('h3');h.textContent=title;
    const p=document.createElement('p');p.textContent='长按下方文本全选，手动复制后粘贴保存';
    const ta=document.createElement('textarea');ta.readOnly=true;ta.value=text;
    const btn=document.createElement('button');btn.textContent='关 闭';
    btn.addEventListener('click',()=>ov.remove());
    ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
    box.appendChild(h);box.appendChild(p);box.appendChild(ta);box.appendChild(btn);
    ov.appendChild(box);
    document.body.appendChild(ov);
    ta.focus();ta.select();
  },
  copyFixes(){
    const list=this.s.fixes||[];
    if(!list.length){ this.toast('还没有纠错记录'); return; }
    const txt=list.map((f,i)=>(i+1)+'. ['+f.cat+'] '+f.front+' → '+f.note).join('\n');
    const done=()=>this.toast('已复制 '+list.length+' 条纠错');
    this.showTextModal('纠错记录',txt);
  },

  exportProgress(){
    const data=JSON.stringify(this.s);
    this.shareOut('进度备份','上岸常识刷刷刷进度_'+this.today()+'.json',data,'已导出进度');
  },

  importProgress(){
    if(this.inMiniTool()){ this.showImportModal(); return; }   // 容器选不了 json 文件，用粘贴导入
    const inp=document.createElement('input');inp.type='file';inp.accept='.json';
    inp.onchange=()=>{
      const f=inp.files[0];if(!f)return;
      const r=new FileReader();
      r.onload=()=>{
        try{ this.applyProgress(JSON.parse(r.result)); this.toast('进度已导入'); }
        catch(e){ this.toast('文件格式不对'); }
      };
      r.readAsText(f);
    };
    inp.click();
  },

  /* 容器内粘贴导入：把「导出进度」复制的 JSON 粘进来恢复 */
  showImportModal(){
    const ov=document.createElement('div');
    ov.className='mt-share';
    const box=document.createElement('div');
    box.className='mt-share-c';
    const h=document.createElement('h3');h.textContent='粘贴导入进度';
    const p=document.createElement('p');p.textContent='把「导出进度」得到的 JSON 文本粘贴到下面';
    const ta=document.createElement('textarea');ta.placeholder='{"cards":...';
    const row=document.createElement('div');row.className='mt-share-row';
    const ok=document.createElement('button');ok.textContent='导 入';ok.className='primary';
    const cancel=document.createElement('button');cancel.textContent='取 消';
    ok.addEventListener('click',()=>{
      try{ this.applyProgress(JSON.parse(ta.value)); ov.remove(); this.toast('进度已导入'); }
      catch(e){ this.toast('内容不是有效的进度 JSON'); }
    });
    cancel.addEventListener('click',()=>ov.remove());
    row.appendChild(ok);row.appendChild(cancel);
    box.appendChild(h);box.appendChild(p);box.appendChild(ta);box.appendChild(row);
    ov.appendChild(box);
    document.body.appendChild(ov);
    ta.focus();
  },

  applyProgress(parsed){
    parsed=parsed||{};
    if(typeof parsed!=='object'||Array.isArray(parsed)){ throw new Error('bad schema'); }
    if((parsed.schema||0)>SCHEMA) this.toast('备份来自更新的版本，已尽量导入');
    const st=Object.assign(typeof structuredClone==='function'?structuredClone(DEFAULT):JSON.parse(JSON.stringify(DEFAULT)),parsed);
    st.settings=Object.assign({},DEFAULT.settings,parsed.settings||{});
    ['cards','log','stars','time','ans'].forEach(k=>{
      if(!st[k]||typeof st[k]!=='object')st[k]={};
    });
    if(!Array.isArray(st.fixes))st.fixes=[];
    this.s=st;
    if(!this.s.created)this.s.created=this.today();
    this.save();
    this.applyTheme(this.s.settings.theme||'auto');
    this.buildQueues();
    this.renderStats();
    this.buildChips();
    this.renderList();
  },

  reset(){
    if(!confirm('清空所有学习进度？此操作不可撤销。'))return;
    this.s=structuredClone(DEFAULT);this.s.created=this.today();this.save();
    this.buildQueues();this.renderStats();this.toast('已清空');
  },

  THEMES:[
    {k:'auto',n:'跟随系统'},
    {k:'zhi', n:'宣纸',     bg:'#f4f0e6',ac:'#a93226'},
    {k:'zhu', n:'朱砂',     bg:'#f9e9e4',ac:'#c0392b'},
    {k:'tai', n:'青苔',     bg:'#e9f1e7',ac:'#2d6a4f'},
    {k:'ye',  n:'夜航',     bg:'#111720',ac:'#63a4e0'},
    {k:'ju',  n:'橘子汽水', bg:'#ffeedd',ac:'#e07b39'},
    {k:'ying',n:'樱花',     bg:'#fde8ef',ac:'#d97a96'}
  ],
  PAPER:{zhi:'#f4f0e6',zhu:'#f9e9e4',tai:'#e9f1e7',ye:'#111720',ju:'#ffeedd',ying:'#fde8ef'},

  resolveTheme(t){
    if(t==='light')return 'zhi';
    if(t==='dark')return 'ye';
    if(!t||t==='auto'){
      return window.matchMedia('(prefers-color-scheme: dark)').matches?'ye':'zhi';
    }
    return this.PAPER[t]?t:'zhi';
  },

  applyTheme(t){
    const name=this.resolveTheme(t);
    document.documentElement.dataset.theme=name;
    const meta=document.querySelector('meta[name=theme-color]');
    if(meta)meta.setAttribute('content',this.PAPER[name]||'#f7f4ed');
    this.paintSwatches();
  },

  paintSwatches(){
    const box=document.getElementById('swatches');
    if(!box)return;
    if(!box.children.length){
      this.THEMES.forEach(t=>{
        const b=document.createElement('button');
        b.className='swatch'+(t.k==='auto'?' auto':'');
        b.dataset.t=t.k;
        b.title=t.n;
        b.setAttribute('aria-label',t.n);
        if(t.k==='auto'){ b.textContent='自动'; }
        else{
          b.style.background=t.bg;
          b.style.setProperty('--sw-ac',t.ac);
        }
        b.addEventListener('click',()=>{
          this.s.settings.theme=t.k;
          this.save();
          this.applyTheme(t.k);
          this.toast('配色：「'+t.n+'」');
        });
        box.appendChild(b);
      });
    }
    const cur=this.s.settings.theme||'auto';
    [...box.children].forEach(b=>b.classList.toggle('on',b.dataset.t===cur));
  },

  fillSettings(){
    const ns=document.getElementById('setNew'),rs=document.getElementById('setRev'),gs=document.getElementById('setGoal');
    if(!ns||!rs)return;
    const np=this.s.settings.newPerDay||30, rl=this.s.settings.revLimit||200;
    if(![...ns.options].some(o=>+o.value===np)) ns.add(new Option(np+' 张',np));
    ns.value=np;
    if(![...rs.options].some(o=>+o.value===rl)) rs.add(new Option(rl+' 张',rl));
    rs.value=rl;
    if(gs){
      const dg=this.s.settings.dailyGoal===undefined?60:this.s.settings.dailyGoal;
      if(![...gs.options].some(o=>+o.value===dg)) gs.add(new Option(dg+' 题',dg));
      gs.value=dg;
    }
    this.updateSetHint();
  },

  updateSetHint(){
    const el=document.getElementById('setHint');
    if(!el)return;
    const t=this.today(),st=this.s.cards;
    let due=0,fresh=0;
    CARDS.forEach(c=>{
      const p=st[c.id];
      if(!p)fresh++;
      else if(p.due&&p.due<=t)due++;
    });
    const np=this.s.settings.newPerDay||30;
    const rl=this.s.settings.revLimit>0?this.s.settings.revLimit:due;
    const load=Math.min(due,rl)+Math.min(fresh,np);
    const days=np>0?Math.ceil(fresh/np):0;
    const dg=this.s.settings.dailyGoal||0;
    el.innerHTML='今日可用：复习 <b>'+due+'</b> 张、未学 <b>'+fresh+'</b> 张<br>'+
      '按当前设置今日负荷 <b>'+load+'</b> 张'+(days?'，剩余新卡约 '+days+' 天学完':'')+
      (dg?'<br>每日目标 <b>'+dg+'</b> 题（已练 '+this.goalN()+' 题）':'');
  },

  saveSettings(){
    this.s.settings.newPerDay=+document.getElementById('setNew').value;
    this.s.settings.revLimit=+document.getElementById('setRev').value;
    const gs=document.getElementById('setGoal');
    if(gs)this.s.settings.dailyGoal=+gs.value;
    this.applyTheme(this.s.settings.theme);
    this.save();this.closeModal();this.buildQueues();
    this.paintGoal();
    this.toast('已保存');
  },
  closeModal(){document.getElementById('modal').classList.remove('on')},
  openModal(){
    document.getElementById('modal').classList.add('on');
    this.fillSettings();
  },
  applyHash(){
    const h=(location.hash||'').replace('#','');
    if(['today','idiom','quiz','library','stats'].includes(h)){
      const b=document.querySelector('nav button[data-v="'+h+'"]');
      if(b)b.click();
    }
  },
  toast(msg){
    const t=document.getElementById('toast');
    t.textContent=msg;t.classList.add('on');
    clearTimeout(this._tt);this._tt=setTimeout(()=>t.classList.remove('on'),1800);
  }
};

function esc(s){return String(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}

/* —— 行内事件统一委托（容器 CSP 禁止 onclick 属性，改为 data-call + addEventListener） —— */
document.addEventListener('click',function(e){
  var t=e.target;
  while(t&&t!==document&&!(t.getAttribute&&t.getAttribute('data-call')))t=t.parentNode;
  if(!t||t===document)return;
  var call=t.getAttribute('data-call')||'';
  var m=call.match(/^App\.([A-Za-z_]\w*)\((.*)\)\s*$/);
  if(!m)return;
  var fn=App[m[1]];
  if(typeof fn!=='function')return;
  var raw=(m[2]||'').trim(),args=[];
  if(raw){
    var v=raw==='true'?true:raw==='false'?false:(/^['"].*['"]$/.test(raw)?raw.slice(1,-1):(isNaN(+raw)?raw:+raw));
    args.push(v);
  }
  fn.apply(App,args);
});
App.boot();
