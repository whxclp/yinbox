// ==UserScript==
// @name         我的视频工具箱
// @namespace    whxclp
// @version      1.2.1
// @description  自研轻量视频增强：倍速调速、画面旋转/镜像/缩放/位移、亮度对比度饱和度滤镜、截图、画中画、循环播放。菜单固定向左展开，绝不超出屏幕右侧。
// @author       whxclp
// @match        *://*/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  /* ================= 样式 ================= */
  var css = [
    '.mvt-bar{position:fixed;z-index:2147483000;display:none;align-items:center;gap:2px;',
    '  background:rgba(20,20,24,.92);border:1px solid rgba(255,255,255,.14);border-radius:8px;',
    '  padding:4px 6px;box-shadow:0 4px 16px rgba(0,0,0,.4);font-size:13px;user-select:none;}',
    '.mvt-bar.mvt-on{display:flex;}',
    '.mvt-btn{position:relative;color:#eee;background:transparent;border:none;border-radius:6px;',
    '  padding:5px 9px;cursor:pointer;font-size:13px;line-height:1;white-space:nowrap;font-family:inherit;}',
    '.mvt-btn:hover{background:rgba(255,255,255,.14);}',
    '.mvt-btn.mvt-has-menu::after{content:" ▾";opacity:.6;font-size:10px;}',
    '.mvt-menu{position:absolute;top:calc(100% + 6px);right:0;min-width:132px;',
    '  background:rgba(28,28,32,.97);border:1px solid rgba(255,255,255,.16);border-radius:8px;',
    '  padding:5px;display:none;flex-direction:column;gap:1px;box-shadow:0 6px 20px rgba(0,0,0,.5);}',
    '.mvt-btn.mvt-open .mvt-menu{display:flex;}',
    '.mvt-menu button{color:#eee;background:transparent;border:none;border-radius:6px;text-align:right;',
    '  padding:7px 10px;cursor:pointer;font-size:13px;white-space:nowrap;font-family:inherit;}',
    '.mvt-menu button:hover{background:rgba(255,255,255,.14);}',
    '.mvt-menu .mvt-sep{height:1px;background:rgba(255,255,255,.14);margin:4px 2px;}',
    '.mvt-menu .mvt-cur{color:#8fd3ff;font-weight:600;}',
    '.mvt-toast{position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483001;',
    '  background:rgba(20,20,24,.95);color:#fff;padding:9px 18px;border-radius:8px;font-size:14px;',
    '  display:none;box-shadow:0 4px 16px rgba(0,0,0,.5);max-width:80vw;}',
    '.mvt-logo{color:#9fb4c8;font-size:11px;padding:0 4px;cursor:default;letter-spacing:.5px;}'
  ].join('');

  var styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  /* ================= 状态 ================= */
  var cur = null;          // 当前控制的 video
  var hideTimer = null;
  var bar, toastEl, toastTimer = null;

  function newState() {
    return { rate: 1, rotate: 0, flipH: false, flipV: false, zoom: 1, dx: 0, dy: 0,
             bright: 100, contrast: 100, sat: 100 };
  }

  /* ================= 工具函数 ================= */
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.style.display = 'none'; }, 1800);
  }

  function apply(v) {
    var s = v.__mvt;
    v.style.filter = 'brightness(' + s.bright + '%) contrast(' + s.contrast + '%) saturate(' + s.sat + '%)';
    v.style.transformOrigin = 'center center';
    v.style.transform =
      'translate(' + s.dx + 'px,' + s.dy + 'px) rotate(' + s.rotate + 'deg)' +
      ' scale(' + s.zoom + ')' + (s.flipH ? ' scaleX(-1)' : '') + (s.flipV ? ' scaleY(-1)' : '');
  }

  function setRate(v, r) {
    v.__mvt.rate = r;
    v.playbackRate = r;
    toast('倍速：' + r + 'x');
    updateRateBtn();
  }

  function updateRateBtn() {
    if (!cur) return;
    var label = rateBtn.querySelector('.mvt-label');
    if (label) label.textContent = '倍速 ' + cur.playbackRate + 'x';
  }

  /* ================= UI 构建 ================= */
  function mBtn(text, hasMenu, cls) {
    var b = document.createElement('button');
    b.className = 'mvt-btn' + (hasMenu ? ' mvt-has-menu' : '') + (cls ? ' ' + cls : '');
    var sp = document.createElement('span');
    sp.className = 'mvt-label';
    sp.textContent = text;
    b.appendChild(sp);
    return b;
  }

  function mItem(text, fn) {
    var b = document.createElement('button');
    b.textContent = text;
    b.addEventListener('click', function (e) { e.stopPropagation(); closeMenus(); fn(); });
    return b;
  }

  function downloadVideo() {
    var v = cur;
    if (!v) return;
    var src = v.currentSrc || v.src;
    if (src && src.indexOf('http') === 0) {
      /* 直链视频：直接保存原文件 */
      toast('开始下载…');
      fetch(src).then(function (r) {
        if (!r.ok) throw new Error(r.status);
        var type = r.headers.get('content-type') || '';
        var name = guessName(src, type);
        return r.blob().then(function (b) { saveBlob(b, name); });
      }).catch(function () {
        toast('直链下载失败，改用合成模式');
        mergeRecord(v);
      });
    } else if (src && (src.indexOf('blob:') === 0 || src.indexOf('data:') === 0)) {
      /* MSE 加密流（B站等音视频分离站点）：边播边录自动合成 */
      mergeRecord(v);
    } else {
      toast('找不到视频地址');
    }
  }

  /* 合成下载：捕获视频元素画面+声音，加速播放录制成单个文件 */
  var mvtRecording = false;
  function mergeRecord(v) {
    if (mvtRecording) { toast('正在合成中，请稍候'); return; }
    if (!window.MediaRecorder) { toast('浏览器不支持录制合成'); return; }
    var stream;
    try {
      stream = v.captureStream ? v.captureStream() : (v.mozCaptureStream ? v.mozCaptureStream() : null);
    } catch (e) {
      toast('该视频受保护，无法捕获合成');
      return;
    }
    if (!stream || !stream.getVideoTracks().length) {
      toast('无法捕获视频流，无法合成');
      return;
    }
    var mime = '';
    ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].forEach(function (t) {
      if (!mime && window.MediaRecorder.isTypeSupported(t)) mime = t;
    });
    var rec;
    try {
      rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    } catch (e) {
      toast('录制器启动失败');
      return;
    }
    mvtRecording = true;
    var chunks = [];
    var wasRate = v.playbackRate;
    var wasMuted = v.muted;
    var wasVolume = v.volume;
    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = function () {
      mvtRecording = false;
      v.removeEventListener('ratechange', keepRate);
      v.playbackRate = wasRate;
      v.muted = wasMuted;
      v.volume = wasVolume;
      /* 关键：释放捕获流，否则元素声音可能被劫持变哑 */
      try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      var b = new Blob(chunks, { type: 'video/webm' });
      if (b.size < 1000) { toast('合成失败：没录到内容'); return; }
      saveBlob(b, '合成_' + new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19) + '.webm');
    };
    function keepRate() {
      if (v.playbackRate < 8) { try { v.playbackRate = 8; } catch (e) {} }
    }
    var dur = v.duration || 0;
    v.addEventListener('ended', onEnd, { once: true });
    function onEnd() {
      clearInterval(iv);
      if (rec.state !== 'inactive') rec.stop();
    }
    var iv = setInterval(function () {
      if (!mvtRecording) { clearInterval(iv); return; }
      if (dur > 0) {
        toast('合成中 ' + Math.min(100, Math.round(v.currentTime / dur * 100)) + '%（8倍速播放，请勿关闭页面）');
      } else {
        toast('合成中…（请勿关闭页面）');
      }
      keepRate();
    }, 1000);
    /* 安全上限：最多录 40 分钟 */
    setTimeout(function () { if (mvtRecording && rec.state !== 'inactive') { clearInterval(iv); try { rec.stop(); } catch (e) {} } }, 40 * 60 * 1000);
    try { v.currentTime = 0; } catch (e) {}
    v.muted = false;
    var pr = v.play();
    if (pr && pr.catch) pr.catch(function () {});
    keepRate();
    v.addEventListener('ratechange', keepRate);
    rec.start(1000);
    toast(dur > 0 ? '开始合成，需约 ' + Math.ceil(dur / 8 / 60) + ' 分钟（8倍速）' : '开始合成…');
  }
  window.__mvtMerge = mergeRecord; /* 供测试/控制台手动调用 */

  function guessName(src, type) {
    try {
      var u = new URL(src, location.href);
      var p = decodeURIComponent(u.pathname).split('/').pop();
      if (p && /\.[a-z0-9]{2,5}$/i.test(p)) return p;
    } catch (e) {}
    return '视频_' + Date.now() + (/mp4/i.test(type) ? '.mp4' : '.mp4');
  }

  function saveBlob(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
    toast('已保存：' + name);
  }

  function mSep() {
    var d = document.createElement('div');
    d.className = 'mvt-sep';
    return d;
  }

  function closeMenus() {
    bar.querySelectorAll('.mvt-btn.mvt-open').forEach(function (b) { b.classList.remove('mvt-open'); });
  }

  var rateBtn;

  function buildBar() {
    bar = document.createElement('div');
    bar.className = 'mvt-bar';

    var logo = document.createElement('span');
    logo.className = 'mvt-logo';
    logo.textContent = '工具箱';
    bar.appendChild(logo);

    /* --- 倍速 --- */
    rateBtn = mBtn('倍速 1x', true);
    var mRate = document.createElement('div');
    mRate.className = 'mvt-menu';
    [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3].forEach(function (r) {
      mRate.appendChild(mItem(r + 'x', function () { setRate(cur, r); }));
    });
    rateBtn.appendChild(mRate);
    bar.appendChild(rateBtn);

    /* --- 画面 --- */
    var picBtn = mBtn('画面', true);
    var mPic = document.createElement('div');
    mPic.className = 'mvt-menu';
    mPic.appendChild(mItem('左转 90°', function () { cur.__mvt.rotate -= 90; apply(cur); }));
    mPic.appendChild(mItem('右转 90°', function () { cur.__mvt.rotate += 90; apply(cur); }));
    mPic.appendChild(mItem('水平镜像', function () { cur.__mvt.flipH = !cur.__mvt.flipH; apply(cur); }));
    mPic.appendChild(mItem('垂直镜像', function () { cur.__mvt.flipV = !cur.__mvt.flipV; apply(cur); }));
    mPic.appendChild(mSep());
    mPic.appendChild(mItem('放大 10%', function () { cur.__mvt.zoom = Math.round(cur.__mvt.zoom * 110) / 100; apply(cur); }));
    mPic.appendChild(mItem('缩小 10%', function () { cur.__mvt.zoom = Math.round(cur.__mvt.zoom * 90) / 100; apply(cur); }));
    mPic.appendChild(mSep());
    mPic.appendChild(mItem('上移', function () { cur.__mvt.dy -= 20; apply(cur); }));
    mPic.appendChild(mItem('下移', function () { cur.__mvt.dy += 20; apply(cur); }));
    mPic.appendChild(mItem('左移', function () { cur.__mvt.dx -= 20; apply(cur); }));
    mPic.appendChild(mItem('右移', function () { cur.__mvt.dx += 20; apply(cur); }));
    mPic.appendChild(mSep());
    mPic.appendChild(mItem('重置画面', function () {
      var s = cur.__mvt;
      s.rotate = 0; s.flipH = false; s.flipV = false; s.zoom = 1; s.dx = 0; s.dy = 0;
      apply(cur); toast('画面已重置');
    }));
    picBtn.appendChild(mPic);
    bar.appendChild(picBtn);

    /* --- 滤镜 --- */
    var fltBtn = mBtn('滤镜', true);
    var mFlt = document.createElement('div');
    mFlt.className = 'mvt-menu';
    function step(key, delta, name) {
      return function () {
        cur.__mvt[key] = Math.min(300, Math.max(20, cur.__mvt[key] + delta));
        apply(cur); toast(name + '：' + cur.__mvt[key] + '%');
      };
    }
    mFlt.appendChild(mItem('亮度 +10%', step('bright', 10, '亮度')));
    mFlt.appendChild(mItem('亮度 −10%', step('bright', -10, '亮度')));
    mFlt.appendChild(mItem('对比度 +10%', step('contrast', 10, '对比度')));
    mFlt.appendChild(mItem('对比度 −10%', step('contrast', -10, '对比度')));
    mFlt.appendChild(mItem('饱和度 +10%', step('sat', 10, '饱和度')));
    mFlt.appendChild(mItem('饱和度 −10%', step('sat', -10, '饱和度')));
    mFlt.appendChild(mSep());
    mFlt.appendChild(mItem('重置滤镜', function () {
      cur.__mvt.bright = 100; cur.__mvt.contrast = 100; cur.__mvt.sat = 100;
      apply(cur); toast('滤镜已重置');
    }));
    fltBtn.appendChild(mFlt);
    bar.appendChild(fltBtn);

    /* --- 下载 --- */
    var dlBtn = mBtn('下载', false);
    dlBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      downloadVideo();
    });
    bar.appendChild(dlBtn);

    /* --- 工具 --- */
    var toolBtn = mBtn('工具', true);
    var mTool = document.createElement('div');
    mTool.className = 'mvt-menu';
    mTool.appendChild(mItem('屏幕截图', function () {
      try {
        var c = document.createElement('canvas');
        c.width = cur.videoWidth; c.height = cur.videoHeight;
        c.getContext('2d').drawImage(cur, 0, 0);
        c.toBlob(function (b) {
          if (!b) { toast('截图失败'); return; }
          var a = document.createElement('a');
          a.href = URL.createObjectURL(b);
          a.download = '截图_' + new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19) + '.png';
          document.body.appendChild(a); a.click(); a.remove();
          toast('截图已保存');
        }, 'image/png');
      } catch (e) {
        toast('截图失败：该视频受跨域保护');
      }
    }));
    mTool.appendChild(mItem('画中画', function () {
      if (document.pictureInPictureElement) {
        document.exitPictureInPicture().catch(function () {});
      } else if (cur.requestPictureInPicture) {
        cur.requestPictureInPicture().catch(function () { toast('当前视频不支持画中画'); });
      } else {
        toast('浏览器不支持画中画');
      }
    }));
    mTool.appendChild(mItem('循环 开/关', function () {
      cur.loop = !cur.loop;
      toast(cur.loop ? '循环播放：开' : '循环播放：关');
    }));
    mTool.appendChild(mSep());
    mTool.appendChild(mItem('全部重置', function () {
      cur.__mvt = newState();
      cur.playbackRate = 1;
      apply(cur);
      toast('已全部重置');
      updateRateBtn();
    }));
    toolBtn.appendChild(mTool);
    bar.appendChild(toolBtn);

    /* 下拉开合 */
    bar.addEventListener('click', function (e) {
      var btn = e.target.closest('.mvt-btn.mvt-has-menu');
      if (!btn) return;
      var was = btn.classList.contains('mvt-open');
      closeMenus();
      if (!was) btn.classList.add('mvt-open');
      e.stopPropagation();
    });
    document.addEventListener('click', closeMenus);

    /* 鼠标离开工具栏后隐藏 */
    bar.addEventListener('mouseenter', function () { clearTimeout(hideTimer); });
    bar.addEventListener('mouseleave', scheduleHide);

    document.body.appendChild(bar);
  }

  /* ================= 显隐与定位 ================= */
  function showFor(video) {
    cur = video;
    if (!video.__mvt) { video.__mvt = newState(); }
    clearTimeout(hideTimer);
    bar.classList.add('mvt-on');
    updateRateBtn();
    positionBar();
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      closeMenus();
      bar.classList.remove('mvt-on');
      cur = null;
    }, 500);
  }

  function positionBar() {
    if (!cur || !bar.classList.contains('mvt-on')) return;
    var r = cur.getBoundingClientRect();
    var top = Math.max(6, r.top + 8);
    bar.style.top = top + 'px';
    /* 让工具栏尽量贴视频右上角，且不出屏幕 */
    var right = Math.min(window.innerWidth - r.right, window.innerWidth - bar.offsetWidth - 8);
    var left = Math.max(8, Math.min(r.right - 8, window.innerWidth - 8) - bar.offsetWidth);
    bar.style.left = Math.max(8, Math.min(left, window.innerWidth - bar.offsetWidth - 8)) + 'px';
    void right;
  }

  setInterval(positionBar, 250);
  window.addEventListener('scroll', positionBar, true);
  window.addEventListener('resize', positionBar);

  /* ================= 绑定视频 ================= */
  var bound = new WeakSet();

  function bind(video) {
    if (bound.has(video)) return;
    if (!(video instanceof HTMLVideoElement)) return;
    var r = video.getBoundingClientRect();
    /* 过滤小视频/广告位：面积太小的不管 */
    if (r.width < 260 || r.height < 140) return;
    bound.add(video);

    video.addEventListener('mouseenter', function () { showFor(video); });
    video.addEventListener('mouseleave', scheduleHide);
  }

  function scan() {
    document.querySelectorAll('video').forEach(bind);
  }

  var mo = new MutationObserver(scan);
  function start() {
    toastEl = document.createElement('div');
    toastEl.className = 'mvt-toast';
    document.body.appendChild(toastEl);
    buildBar();
    scan();
    mo.observe(document.documentElement, { childList: true, subtree: true });
    setInterval(scan, 2000);
  }

  if (document.body) {
    start();
  } else {
    document.addEventListener('DOMContentLoaded', start);
  }
})();
