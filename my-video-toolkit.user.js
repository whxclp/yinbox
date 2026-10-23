// ==UserScript==
// @name         我的视频工具箱
// @namespace    whxclp
// @version      1.0.1
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
