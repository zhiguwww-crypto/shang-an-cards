
/* 首屏前预设主题，避免刷新时闪一下 */
(function(){
  try{
    var raw=localStorage.getItem('zhiche_srs_v2');
    var t=(raw&&JSON.parse(raw).settings&&JSON.parse(raw).settings.theme)||'auto';
    var dark=t==='ye'||t==='dark'||(t==='auto'&&window.matchMedia('(prefers-color-scheme: dark)').matches);
    var name=(t==='auto'||t==='light'||t==='dark')?(dark?'ye':'zhi'):t;
    document.documentElement.dataset.theme=name;
  }catch(e){document.documentElement.dataset.theme='zhi';}
})();
/* 微信内置浏览器（X5 / XWeb）适配：标记内核类型 + 视口高度兜底 */
(function(){
  var d=document.documentElement, ua=navigator.userAgent||'';
  if(/MicroMessenger/i.test(ua)){
    d.classList.add('wx');
    if(/wxwork/i.test(ua))d.classList.add('wxwork');
    if(/Android/i.test(ua))d.classList.add('wx-android');
    var bridge=function(){d.classList.add('wx-bridge')};
    if(window.WeixinJSBridge)bridge();
    else document.addEventListener('WeixinJSBridgeReady',bridge,false);
  }
  /* 部分微信内核不认 dvh，直接给一份 px 值兜底 */
  var setH=function(){ d.style.setProperty('--apph',(window.innerHeight||screen.height)+'px'); };
  setH();
  window.addEventListener('resize',setH);
  window.addEventListener('orientationchange',function(){setTimeout(setH,320)});
})();
