/*!
 * MTSync — 账号登录 + 跨设备进度同步（仅网页版）
 * 依赖 CDN 全局 WorkBuddyCloud；小工具离线包构建时会整段剔除。
 * 设计：progress 单行快照 + rev 乐观锁；客户端按字段合并，冲突时拉取→合并→重试。
 */
(function () {
  'use strict';

  var CFG = {
    endpoint: 'https://zhiche-cards.app.workbuddy.host',
    oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
    publishableKey: 'wbpk_MTkL7QbxcpKAMYbMN8i3BJ_n88pe9L5t32z393l3WwTOhQ0oliWH0jg'
  };

  var K_DEV = 'zhiche_dev_id_v1';
  var K_DIRTY = 'zhiche_sync_dirty_v1';
  var K_OWN = 'zhiche_bound_owner_v1';     // 本机当前绑定的账号
  var K_STASH = 'zhiche_acct_stash_';       // 各账号在本机的备份槽（切换账号时隔离）

  var S = {
    cloud: null, ready: false, sdkMissing: false,
    session: null, user: null,
    rev: 0, syncing: false, lastSync: 0, lastError: '',
    pendingOtp: null, resetCtx: null,
    inited: false, flushTimer: 0
  };

  var hooks = { get: function () { return {}; }, set: function () {} };

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  function deviceId() {
    var v = lsGet(K_DEV);
    if (!v) { v = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); lsSet(K_DEV, v); }
    return v;
  }

  function deviceLabel() {
    var ua = navigator.userAgent || '';
    var os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad'
      : /Android/.test(ua) ? 'Android' : /Macintosh/.test(ua) ? 'Mac'
      : /Windows/.test(ua) ? 'Windows' : '设备';
    var br = /MicroMessenger/i.test(ua) ? '微信' : /Edg\//.test(ua) ? 'Edge'
      : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '浏览器';
    return os + ' · ' + br;
  }

  function errText(e) {
    if (!e) return '未知错误';
    if (typeof e === 'string') return e;
    return e.message || e.errMsg || e.error_description || '操作失败';
  }

  /* ================= 初始化 / 会话 ================= */

  function waitSDK(cb, n) {
    n = n || 0;
    var g = window.WorkBuddyCloud;
    if (g && typeof g.createWorkBuddyCloud === 'function') { cb(true); return; }
    if (n > 24) { cb(false); return; }
    setTimeout(function () { waitSDK(cb, n + 1); }, 250);
  }

  function init(cb) {
    if (S.inited) { if (cb) cb(); return; }
    S.inited = true;
    waitSDK(function (ok) {
      if (ok) {
        try { S.cloud = window.WorkBuddyCloud.createWorkBuddyCloud(CFG); S.ready = true; }
        catch (e) { S.lastError = '云同步初始化失败：' + errText(e); }
      } else {
        S.sdkMissing = true;
        S.lastError = '云同步组件未加载（离线打开或网络受限），本地刷题不受影响';
      }
      if (!S.ready) { if (cb) cb(); return; }
      S.cloud.auth.onAuthStateChange(function (evt, sess) {
        if (evt === 'SIGNED_OUT') { S.session = null; S.user = null; renderPanel(); }
      });
      S.cloud.auth.getSession().then(function (res) {
        var sess = (res && res.data) || null;
        S.session = sess && sess.user ? sess : (sess && sess.access_token ? sess : null);
        S.user = S.session ? (S.session.user || null) : null;
        if (S.session) { adoptAccount(ownerId()); syncNow(); }
        if (cb) cb();
      }).catch(function (e) {
        S.lastError = errText(e);
        if (cb) cb();
      });
    });
  }

  function signInPassword(identifier, password) {
    var id = String(identifier || '').trim();
    if (!id || !password) return Promise.reject(new Error('请填写邮箱和密码'));
    if (!EMAIL_RE.test(id)) return Promise.reject(new Error('请输入正确的邮箱地址'));
    return S.cloud.auth.signInWithPassword({ email: id, password: password }).then(function (res) {
      if (res.error) throw res.error;
      return afterSignIn(res.data);
    });
  }

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function sendCode(email) {
    var addr = String(email || '').trim();
    if (!EMAIL_RE.test(addr)) return Promise.reject(new Error('请输入正确的邮箱地址'));
    return S.cloud.auth.sendOtp({ email: addr }).then(function (res) {
      if (res.error) throw res.error;
      S.pendingOtp = {
        kind: 'email',
        value: addr,
        verificationId: res.data.verificationId,
        isExistingUser: !!res.data.isExistingUser,
        at: Date.now()
      };
      return S.pendingOtp;
    });
  }

  function verifyCode(code, newPassword) {
    var p = S.pendingOtp;
    if (!p) return Promise.reject(new Error('请先获取验证码'));
    var arg = { email: p.value, verificationId: p.verificationId, isExistingUser: p.isExistingUser, token: String(code || '').trim() };
    if (!p.isExistingUser && newPassword) arg.password = newPassword;
    return S.cloud.auth.verifyOtp(arg).then(function (res) {
      if (res.error) throw res.error;
      S.pendingOtp = null;
      return afterSignIn(res.data);
    });
  }

  function startReset(email) {
    var addr = String(email || '').trim();
    if (!EMAIL_RE.test(addr)) return Promise.reject(new Error('请输入正确的邮箱地址'));
    return S.cloud.auth.resetPasswordForEmail(addr).then(function (res) {
      if (res.error) throw res.error;
      S.resetCtx = res.data;
      return true;
    });
  }

  function finishReset(code, newPassword) {
    if (!S.resetCtx) return Promise.reject(new Error('请先获取重置验证码'));
    return S.resetCtx.updateUser({ nonce: String(code || '').trim(), password: newPassword }).then(function (res) {
      if (res.error) throw res.error;
      S.resetCtx = null;
      return afterSignIn(res.data);
    });
  }

  function changePassword(oldPwd, newPwd) {
    return S.cloud.auth.resetPasswordForOld({ oldPassword: oldPwd, newPassword: newPwd }).then(function (res) {
      if (res.error) throw res.error;
      return true;
    });
  }

  function signOut() {
    if (!S.ready) return Promise.resolve(false);
    return S.cloud.auth.signOut().then(function () {
      S.session = null; S.user = null; S.rev = 0; S.lastSync = 0;
      renderPanel();
      return true;
    }).catch(function (e) { S.lastError = errText(e); renderPanel(); return false; });
  }

  function afterSignIn(session) {
    if (session && session.user) { S.session = session; S.user = session.user; }
    else if (session && session.access_token) { S.session = session; S.user = session.user || null; }
    var how = adoptAccount(ownerId());
    renderPanel();
    return syncNow().then(function (ok) {
      if (how === 'switch') {
        try { App.toast('已切换账号，并加载该账号的进度'); } catch (e) {}
      } else if (ok) {
        try { App.toast('已恢复上次进度'); } catch (e) {}
      }
      return true;
    });
  }

  function isSignedIn() { return !!(S.session && S.user); }

  function ownerId() {
    var u = S.user || {};
    return String(u.id || u.sub || u.user_id || u.email || '');
  }

  /* 账号与本机数据的绑定：
     - 首次在本机登录 → 采纳本机已有进度（不丢数据），随后与云端合并
     - 同一账号再次登录 → 直接合并
     - 换另一个账号 → 把上一账号的进度存进它自己的备份槽，然后装载新账号的本机缓存；
       新账号没有缓存则回到初始状态（绝不继承别人账号的进度）
  */
  function adoptAccount(owner) {
    if (!owner) return 'none';
    var bound = lsGet(K_OWN);
    if (!bound) { lsSet(K_OWN, owner); return 'adopt'; }
    if (bound === owner) return 'same';

    if (hooks.readRaw) {
      var cur = hooks.readRaw();
      if (cur) lsSet(K_STASH + bound, cur);
    }
    var mine = lsGet(K_STASH + owner);
    if (mine && hooks.writeRaw) hooks.writeRaw(mine);
    else if (hooks.resetToInitial) hooks.resetToInitial();

    lsSet(K_OWN, owner);
    return 'switch';
  }

  function userLabel() {
    var u = S.user || {};
    if (!u.email) return '已登录';
    var parts = u.email.split('@');
    var head = parts[0] || '';
    var mask = head.length <= 2 ? head : head.slice(0, 2) + '***';
    return mask + '@' + (parts[1] || '');
  }

  /* ================= 合并策略 ================= */

  function num(v) { v = Number(v); return isFinite(v) ? v : 0; }
  function laterDue(a, b) { a = a || ''; b = b || ''; return a > b ? a : b; }
  function earlier(a, b) { if (!a) return b; if (!b) return a; return a < b ? a : b; }

  function mergeCard(a, b) {
    var out = {};
    for (var k in a) if (Object.prototype.hasOwnProperty.call(a, k)) out[k] = a[k];
    for (var j in b) if (Object.prototype.hasOwnProperty.call(b, j)) out[j] = b[j];
    out.lv = Math.max(num(a.lv), num(b.lv));
    out.streak = Math.max(num(a.streak), num(b.streak));
    out.seen = Math.max(num(a.seen), num(b.seen));
    out.right = Math.max(num(a.right), num(b.right));
    out.wrong = Math.max(num(a.wrong), num(b.wrong));
    out.fuzzy = Math.max(num(a.fuzzy), num(b.fuzzy));
    out.due = laterDue(a.due, b.due);
    out.born = earlier(a.born, b.born);
    out.master = !!(a.master || b.master);
    return out;
  }

  function mergeMapMax(a, b) {
    var out = {};
    var k;
    a = a || {}; b = b || {};
    for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) out[k] = a[k];
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) {
      out[k] = (k in out) ? Math.max(num(out[k]), num(b[k])) : b[k];
    }
    return out;
  }

  function mergeAns(a, b) {
    var out = {};
    a = a || {}; b = b || {};
    var keys = {}, k;
    for (k in a) keys[k] = 1;
    for (k in b) keys[k] = 1;
    for (k in keys) {
      var x = a[k] || {}, y = b[k] || {};
      var n = Math.max(num(x.n), num(y.n));
      var ok = Math.max(num(x.ok), num(y.ok));
      out[k] = { n: n, ok: Math.min(ok, n), sec: Math.max(num(x.sec), num(y.sec)) };
    }
    return out;
  }

  function mergeFixes(a, b) {
    var out = [], seen = {}, i, f, key;
    var arr = (a || []).concat(b || []);
    for (i = 0; i < arr.length; i++) {
      f = arr[i];
      if (!f || typeof f !== 'object') continue;
      key = [f.front || '', f.at || '', f.note || ''].join('\u0001');
      if (seen[key]) continue;
      seen[key] = 1;
      out.push(f);
    }
    return out;
  }

  function merge(local, remote) {
    local = local || {}; remote = remote || {};
    var out = {};
    var k;
    for (k in remote) if (Object.prototype.hasOwnProperty.call(remote, k)) out[k] = remote[k];
    for (k in local) if (Object.prototype.hasOwnProperty.call(local, k)) out[k] = local[k];

    out.schema = Math.max(num(local.schema), num(remote.schema));
    out.created = earlier(local.created, remote.created) || local.created || remote.created;

    var lc = local.cards || {}, rc = remote.cards || {};
    var cards = {}, id;
    for (id in lc) if (Object.prototype.hasOwnProperty.call(lc, id)) cards[id] = lc[id];
    for (id in rc) if (Object.prototype.hasOwnProperty.call(rc, id)) {
      cards[id] = cards[id] ? mergeCard(cards[id], rc[id]) : rc[id];
    }
    out.cards = cards;

    out.log = mergeMapMax(local.log, remote.log);
    out.time = mergeMapMax(local.time, remote.time);
    out.ans = mergeAns(local.ans, remote.ans);

    var stars = {}, s1 = local.stars || {}, s2 = remote.stars || {};
    for (k in s1) if (s1[k]) stars[k] = true;
    for (k in s2) if (s2[k]) stars[k] = true;
    out.stars = stars;

    out.fixes = mergeFixes(local.fixes, remote.fixes);

    var ls = local.settings || {}, rs = remote.settings || {};
    out.settings = (num(rs._ts) > num(ls._ts)) ? rs : ls;
    if (!out.settings || !out.settings.theme) {
      out.settings = ls.theme ? ls : (rs.theme ? rs : ls || rs || {});
    }
    return out;
  }

  /* ================= 读写云端 ================= */

  function pull() {
    return S.cloud.database.from('user_progress').select('payload, rev, updated_at').limit(1).then(function (res) {
      if (res.error) throw res.error;
      var row = (res.data && res.data[0]) || null;
      return row;
    });
  }

  function push(state, depth) {
    depth = depth || 0;
    var ownerName = (S.user && (S.user.name || S.user.email)) || null;
    if (S.rev <= 0) {
      return S.cloud.database.from('user_progress').insert({ payload: state, rev: 1, owner_name: ownerName }).select('rev').then(function (res) {
        if (res.error) {
          if (String(res.error.code) === '23505' && depth < 2) {
            return pull().then(function (row) {
              if (!row) throw res.error;
              S.rev = num(row.rev) || 1;
              var merged = merge(hooks.get(), row.payload || {});
              hooks.set(merged);
              return push(merged, depth + 1);
            });
          }
          throw res.error;
        }
        S.rev = 1;
        return true;
      });
    }
    var expect = S.rev;
    return S.cloud.database.from('user_progress')
      .update({ payload: state, rev: expect + 1, owner_name: ownerName, updated_at: new Date().toISOString() })
      .eq('rev', expect).select('rev').then(function (res) {
        if (res.error) throw res.error;
        if (!res.data || !res.data.length) {
          if (depth >= 2) throw new Error('云端进度已被其他设备更新，请稍后重试');
          return pull().then(function (row) {
            if (!row) throw new Error('云端进度记录不存在');
            S.rev = num(row.rev) || 1;
            var merged = merge(hooks.get(), row.payload || {});
            hooks.set(merged);
            return push(merged, depth + 1);
          });
        }
        S.rev = expect + 1;
        return true;
      });
  }

  function syncNow() {
    if (!S.ready || !isSignedIn() || S.syncing) return Promise.resolve(false);
    S.syncing = true;
    S.lastError = '';
    return pull().then(function (row) {
      if (row) {
        S.rev = num(row.rev) || 0;
        var merged = merge(hooks.get(), row.payload || {});
        hooks.set(merged, 'sync');
      } else {
        S.rev = 0;
      }
      return push(hooks.get(), 0);
    }).then(function () {
      S.lastSync = Date.now();
      lsDel(K_DIRTY);
      touchSession();
      renderPanel();
      return true;
    }).catch(function (e) {
      S.lastError = errText(e);
      lsSet(K_DIRTY, '1');
      renderPanel();
      return false;
    }).then(function (v) {
      S.syncing = false;
      return v;
    });
  }

  function markDirty() {
    lsSet(K_DIRTY, '1');
    if (!isSignedIn()) return;
    clearTimeout(S.flushTimer);
    S.flushTimer = setTimeout(function () { flush(); }, 8000);
  }

  function flush() {
    if (lsGet(K_DIRTY) === '1' && isSignedIn() && !S.syncing) return syncNow();
    return Promise.resolve(false);
  }

  /* ================= 多端会话 ================= */

  function touchSession() {
    if (!S.ready || !isSignedIn()) return;
    S.cloud.database.from('sync_sessions')
      .upsert({
        device_id: deviceId(),
        label: deviceLabel(),
        platform: navigator.platform || '',
        last_seen: new Date().toISOString()
      }, { onConflict: 'owner_id,device_id' })
      .then(function () {}).catch(function () {});
  }

  function listSessions() {
    if (!S.ready || !isSignedIn()) return Promise.resolve([]);
    return S.cloud.database.from('sync_sessions')
      .select('device_id, label, platform, last_seen, created_at')
      .order('last_seen', { ascending: false })
      .then(function (res) {
        if (res.error) throw res.error;
        return res.data || [];
      });
  }

  function dropSession(id) {
    if (!S.ready) return Promise.resolve(false);
    return S.cloud.database.from('sync_sessions').delete().eq('device_id', id).select('device_id')
      .then(function (res) { if (res.error) throw res.error; return true; });
  }

  /* ================= 协议文本 ================= */

  var DOCS = {
    privacy: {
      title: '隐私政策',
      updated: '2026-10-26',
      body: [
        ['我们收集什么', '① 你主动提供的邮箱地址（仅用于登录与找回密码）；② 学习进度：答题记录、对错、模糊次数、复习档位、收藏、纠错备注、每日学习时长；③ 一台设备一个随机生成的设备标识（仅用于「设备管理」里区分设备），以及浏览器与系统的大致类型（如「iPhone · Safari」）。'],
        ['我们不收集什么', '不收集位置、通讯录、相册、剪贴板、身份证件、银行卡与支付信息；不接入第三方广告或行为统计 SDK；不做用户画像与跨站追踪。'],
        ['用来做什么', '账号识别与登录、把学习进度同步到你的各台设备、在「设备管理」里展示已登录设备。除此之外不用于任何其他用途，也不会出售或共享给第三方。'],
        ['存在哪里', '登录状态下，邮箱与学习进度保存在 WorkBuddy 云服务托管的数据库中，按账号做行级隔离（你的账号只能读写你自己那一行）。未登录时，进度只存在你浏览器的 localStorage 里，不会上传。'],
        ['保存多久', '账号存续期间保存。你随时可以在「账号与云同步」里点「删除云端数据」，云端记录会被立即删除；退出登录不会删除云端数据，也不会删除本机数据。'],
        ['你的权利', '查看与导出：数据页可随时「导出进度」为 JSON；删除：支持清空本机进度、删除云端数据；更正：卡片内容可通过「✎ 纠错」提交。如需注销邮箱账号，删除云端数据后不再登录即可，或联系开发者协助处理。'],
        ['未成年人', '本工具面向具备完全民事行为能力的备考者，不面向 14 周岁以下儿童。'],
        ['变更与联系', '政策如有重大调整会在应用内提示。问题或请求可通过项目仓库 https://github.com/zhiguwww-crypto/shang-an-cards 提 issue。']
      ]
    },
    terms: {
      title: '用户协议',
      updated: '2026-10-26',
      body: [
        ['服务性质', '本工具是个人学习辅助工具，提供常识与成语知识卡的记忆、复习与自测。内容按公开出版的个人备考资料整理，仅供学习参考，不构成考试承诺，也不保证任何考试结果。'],
        ['账号与安全', '邮箱验证码或邮箱密码登录。请妥善保管验证码与密码；通过你账号进行的操作视为你本人行为。发现异常请立即修改密码或退出登录。'],
        ['使用规范', '允许：个人学习使用，包括在你的多台设备上同步进度。禁止：批量抓取或爬取卡片内容、把内容或应用用于商业培训与售卖、二次分发或公开传播卡片原文、绕过账号与权限机制、对服务进行压力测试或攻击。'],
        ['知识产权', '应用代码开源（见项目仓库），卡片文字整理自公开出版资料，版权归原作者与出版方。若权利人认为内容侵权，可通过仓库 issue 联系，我们会及时下架相关内容。'],
        ['服务变更与中断', '我们可能因维护、升级或平台调整而变更、暂停部分功能；涉及账号或数据的重要变更会在应用内提示。云同步依赖第三方平台服务，可能因平台故障短时不可用。'],
        ['数据丢失风险', '虽然有云端同步，但仍建议定期用「导出进度」做本地备份。因设备损坏、清理浏览器数据、平台故障等造成的数据丢失，我们不承担赔偿责任。'],
        ['免责', '本工具按「现状」提供。因使用或无法使用本工具产生的间接损失，我们在法律允许范围内不承担责任。'],
        ['适用法律', '本协议适用中华人民共和国法律。发生争议优先协商解决。']
      ]
    }
  };

  function renderDoc(kind) {
    var d = DOCS[kind];
    if (!d) return '';
    var h = '<h3>' + d.title + '</h3><p class="docUpd">更新日期：' + d.updated + '</p>';
    d.body.forEach(function (sec) {
      h += '<h4>' + sec[0] + '</h4><p>' + sec[1] + '</p>';
    });
    return h;
  }

  function openDoc(kind) {
    var ov = document.getElementById('docModal');
    if (!ov) return;
    var body = document.getElementById('docBody');
    if (body) body.innerHTML = renderDoc(kind);
    if (body) body.scrollTop = 0;
    ov.classList.add('on');
  }

  function closeDoc() {
    var ov = document.getElementById('docModal');
    if (ov) ov.classList.remove('on');
  }

  function bindDoc() {
    var ov = document.getElementById('docModal');
    if (!ov) return;
    var closeBtn = document.getElementById('docClose');
    if (closeBtn) closeBtn.addEventListener('click', closeDoc);
    ov.addEventListener('click', function (e) { if (e.target === ov) closeDoc(); });
  }

  /* 删除云端数据：只删自己的行（RLS 保证范围） */
  function wipeCloud() {
    if (!S.ready || !isSignedIn()) return Promise.reject(new Error('未登录'));
    return S.cloud.database.from('user_progress').delete().select('owner_id').then(function (res) {
      if (res.error) throw res.error;
      return S.cloud.database.from('sync_sessions').delete().eq('device_id', deviceId()).select('device_id');
    }).then(function (res) {
      if (res.error) throw res.error;
      S.rev = 0;
      lsDel(K_DIRTY);
      S.lastSync = 0;
      renderPanel();
      return true;
    });
  }

  /* ================= 面板渲染 ================= */

  function fmtTime(ts) {
    if (!ts) return '尚未同步';
    var d = new Date(ts);
    var p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function renderPanel() {
    var box = document.getElementById('acctBody');
    if (!box) return;
    var html = '';

    if (!S.ready) {
      html += '<p class="acctNote">' + (S.lastError || '云同步正在初始化…') + '</p>';
      html += '<div class="acctRow"><button class="acctBtn" data-acct="retry">重试</button></div>';
      box.innerHTML = html;
      return;
    }

    if (!isSignedIn()) {
      html += '<p class="acctNote">登录后，这台设备的进度会同步到云端；在另一台设备登录同一账号即可接着刷。</p>';
      html += '<div class="acctRow">';
      html += '<button class="acctBtn primary" data-acct="login">登录 / 注册</button>';
      box.innerHTML = html;
      return;
    }

    html += '<div class="acctWho"><b>' + userLabel() + '</b>';
    html += '<small>' + (S.syncing ? '同步中…' : ('上次同步 ' + fmtTime(S.lastSync))) + '</small></div>';
    if (S.lastError) html += '<p class="acctErr">' + S.lastError + '</p>';
    if (lsGet(K_DIRTY) === '1') html += '<p class="acctNote">有本地改动待上传，联网后会自动同步。</p>';
    html += '<div class="acctRow">';
    html += '<button class="acctBtn primary" data-acct="sync">立即同步</button>';
    html += '<button class="acctBtn" data-acct="devices">设备管理</button>';
    html += '<button class="acctBtn" data-acct="pwd">改密码</button>';
    html += '<button class="acctBtn ghost" data-acct="wipe">删除云端数据</button>';
    html += '<button class="acctBtn ghost" data-acct="logout">退出登录</button>';
    html += '</div>';
    html += '<div id="acctDevices" class="acctDevices"></div>';
    box.innerHTML = html;
  }

  function showDevices() {
    var box = document.getElementById('acctDevices');
    if (!box) return;
    box.innerHTML = '<p class="acctNote">读取中…</p>';
    listSessions().then(function (rows) {
      if (!rows.length) { box.innerHTML = '<p class="acctNote">暂无设备记录</p>'; return; }
      var me = deviceId();
      var h = '<p class="acctSub">已登录设备（' + rows.length + '）</p>';
      rows.forEach(function (r) {
        var cur = r.device_id === me;
        h += '<div class="acctDev' + (cur ? ' cur' : '') + '">' +
          '<div><b>' + (r.label || '未知设备') + (cur ? '（当前）' : '') + '</b>' +
          '<small>' + fmtTime(new Date(r.last_seen).getTime()) + ' 活跃</small></div>';
        if (!cur) h += '<button class="acctMini" data-acct="drop" data-id="' + r.device_id + '">移除记录</button>';
        h += '</div>';
      });
      h += '<p class="acctNote">移除记录只删掉列表里的这台设备；要强制其下线，请在该设备上「退出登录」。</p>';
      box.innerHTML = h;
    }).catch(function (e) {
      box.innerHTML = '<p class="acctErr">' + errText(e) + '</p>';
    });
  }

  /* ================= 事件委托 ================= */

  function bindPanel() {
    document.addEventListener('click', function (e) {
      var el = e.target;
      while (el && el !== document && !(el.getAttribute && (el.getAttribute('data-acct') || el.getAttribute('data-doc')))) el = el.parentNode;
      if (!el || el === document) return;
      var doc = el.getAttribute && el.getAttribute('data-doc');
      if (doc) { openDoc(doc); return; }
      var act = el.getAttribute('data-acct');
      if (act === 'retry') { S.inited = false; S.ready = false; S.sdkMissing = false; init(renderPanel); }
      else if (act === 'login') openAuth();
      else if (act === 'sync') { syncNow().then(function (ok) { App.toast(ok ? '同步完成' : ('同步失败：' + (S.lastError || '网络问题'))); }); }
      else if (act === 'devices') showDevices();
      else if (act === 'pwd') openAuth('chg');
      else if (act === 'logout') {
        if (!confirm('退出登录？本机进度会保留，可继续离线使用。')) return;
        signOut().then(function () { App.toast('已退出登录'); });
      } else if (act === 'wipe') {
        if (!confirm('删除云端数据？\n\n影响范围：云端保存的学习进度与设备记录会被删除，且无法恢复；本机进度保留。')) return;
        wipeCloud().then(function () { App.toast('云端数据已删除（本机进度保留）'); })
          .catch(function (err) { App.toast('删除失败：' + errText(err)); });
      } else if (act === 'drop') {
        dropSession(el.getAttribute('data-id')).then(function () { showDevices(); App.toast('已移除该设备记录'); })
          .catch(function (err) { App.toast('移除失败：' + errText(err)); });
      }
    });
  }

  /* ================= 登录弹层 ================= */

  var AUTH = null;

  function openAuth(mode) {
    var ov = document.getElementById('authModal');
    if (!ov) return;
    ov.classList.add('on');
    setAuthTab(mode === 'pwd' ? 'pwd' : (mode === 'reset' ? 'reset' : (mode === 'chg' ? 'chg' : 'otp')));
    var st = document.getElementById('authMsg');
    if (st) { st.textContent = ''; st.className = 'authMsg'; }
  }

  function closeAuth() {
    var ov = document.getElementById('authModal');
    if (ov) ov.classList.remove('on');
  }

  function setAuthTab(tab) {
    AUTH = AUTH || {};
    AUTH.tab = tab;
    var tabs = document.querySelectorAll('#authTabs button');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('on', tabs[i].getAttribute('data-tab') === tab);
    }
    var panes = { pwd: 'authPwd', otp: 'authOtp', reset: 'authReset', chg: 'authChg' };
    for (var k in panes) {
      var el = document.getElementById(panes[k]);
      if (el) el.style.display = (k === tab) ? '' : 'none';
    }
  }

  function authMsg(text, ok) {
    var el = document.getElementById('authMsg');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'authMsg' + (text ? (ok ? ' ok' : ' bad') : '');
  }

  function busy(btn, on, label) {
    if (!btn) return;
    btn.disabled = !!on;
    if (on) { btn.dataset.t = btn.textContent; btn.textContent = label || '处理中…'; }
    else if (btn.dataset.t) { btn.textContent = btn.dataset.t; }
  }

  function codeCountdown(btn, sec) {
    if (!btn) return;
    btn.disabled = true;
    var left = sec || 60;
    var raw = '获取验证码';
    btn.textContent = left + 's';
    var t = setInterval(function () {
      left--;
      if (left <= 0) { clearInterval(t); btn.disabled = false; btn.textContent = raw; return; }
      btn.textContent = left + 's';
    }, 1000);
  }

  function bindAuth() {
    var ov = document.getElementById('authModal');
    if (!ov) return;

    var tabs = document.querySelectorAll('#authTabs button');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function (e) { setAuthTab(e.currentTarget.getAttribute('data-tab')); });
    }

    var closeBtn = document.getElementById('authClose');
    if (closeBtn) closeBtn.addEventListener('click', closeAuth);
    ov.addEventListener('click', function (e) { if (e.target === ov) closeAuth(); });

    var pwdBtn = document.getElementById('authPwdGo');
    if (pwdBtn) pwdBtn.addEventListener('click', function () {
      var id = (document.getElementById('authPwdId') || {}).value || '';
      var pw = (document.getElementById('authPwdPw') || {}).value || '';
      busy(pwdBtn, true, '登录中…');
      signInPassword(id, pw).then(function () {
        closeAuth(); App.toast('登录成功，正在同步进度');
      }).catch(function (e) {
        authMsg(/password|credential|invalid/i.test(errText(e)) ? '账号或密码不正确' : errText(e));
      }).then(function () { busy(pwdBtn, false); });
    });

    var sendBtn = document.getElementById('authOtpSend');
    if (sendBtn) sendBtn.addEventListener('click', function () {
      var id = (document.getElementById('authOtpId') || {}).value || '';
      busy(sendBtn, true, '发送中…');
      sendCode(id).then(function () {
        busy(sendBtn, false);
        authMsg('验证码已发送，请到邮箱查收（未注册的邮箱验证后会自动建号）', true);
        codeCountdown(sendBtn, 60);
      }).catch(function (e) {
        busy(sendBtn, false);
        authMsg(errText(e));
      });
    });

    var otpBtn = document.getElementById('authOtpGo');
    if (otpBtn) otpBtn.addEventListener('click', function () {
      var code = (document.getElementById('authOtpCode') || {}).value || '';
      var pw = (document.getElementById('authOtpPw') || {}).value || '';
      busy(otpBtn, true, '验证中…');
      verifyCode(code, pw).then(function () {
        closeAuth(); App.toast('登录成功，正在同步进度');
      }).catch(function (e) {
        authMsg(/expired|invalid|token/i.test(errText(e)) ? '验证码不正确或已过期' : errText(e));
      }).then(function () { busy(otpBtn, false); });
    });

    var resetSend = document.getElementById('authResetSend');
    if (resetSend) resetSend.addEventListener('click', function () {
      var addr = (document.getElementById('authResetEmail') || {}).value || '';
      busy(resetSend, true, '发送中…');
      startReset(addr).then(function () {
        busy(resetSend, false);
        authMsg('重置验证码已发送，请到邮箱查收', true);
        codeCountdown(resetSend, 60);
      }).catch(function (e) { busy(resetSend, false); authMsg(errText(e)); });
    });

    var resetGo = document.getElementById('authResetGo');
    if (resetGo) resetGo.addEventListener('click', function () {
      var code = (document.getElementById('authResetCode') || {}).value || '';
      var pw = (document.getElementById('authResetPw') || {}).value || '';
      if (!pw || pw.length < 6) { authMsg('新密码至少 6 位'); return; }
      busy(resetGo, true, '提交中…');
      finishReset(code, pw).then(function () {
        closeAuth(); App.toast('密码已重置，已自动登录');
      }).catch(function (e) {
        authMsg(/expired|invalid|nonce|token/i.test(errText(e)) ? '验证码不正确或已过期' : errText(e));
      }).then(function () { busy(resetGo, false); });
    });

    var chgGo = document.getElementById('authChgGo');
    if (chgGo) chgGo.addEventListener('click', function () {
      var o = (document.getElementById('authChgOld') || {}).value || '';
      var n = (document.getElementById('authChgNew') || {}).value || '';
      if (!n || n.length < 6) { authMsg('新密码至少 6 位'); return; }
      busy(chgGo, true, '提交中…');
      changePassword(o, n).then(function () {
        closeAuth(); App.toast('密码已修改');
      }).catch(function (e) { authMsg(errText(e)); }).then(function () { busy(chgGo, false); });
    });
  }

  /* ================= 对外 API ================= */

  function boot() {
    bindPanel();
    bindAuth();
    bindDoc();
    init(renderPanel);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flush();
    });
    setInterval(function () { flush(); }, 5 * 60 * 1000);
  }

  window.MTSync = {
    boot: boot,
    init: init,
    bind: function (h) { if (h && typeof h.get === 'function' && typeof h.set === 'function') hooks = h; },
    merge: merge,
    syncNow: syncNow,
    markDirty: markDirty,
    flush: flush,
    signOut: signOut,
    isSignedIn: isSignedIn,
    openAuth: openAuth,
    closeAuth: closeAuth,
    openDoc: openDoc,
    closeDoc: closeDoc,
    wipeCloud: wipeCloud,
    _sendCode: sendCode,
    _adoptAccount: adoptAccount,
    _ownerId: ownerId,
    _docs: DOCS,
    setAuthTab: setAuthTab,
    listSessions: listSessions,
    _state: S,
    _deviceId: deviceId
  };
})();
