const { app, BrowserWindow, Tray, Menu, shell, nativeImage, globalShortcut, dialog, nativeTheme, session, screen } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');

// 内容全部来自红果官方网页版,本程序只做桌面壳,不抓取、不修改任何数据
const HOME_URL = 'https://hongguoduanju.com/';
const HOST_RE = /(^|\.)hongguoduanju\.com$/i;
const DETAIL_RE = /hongguoduanju\.com\/detail/i;
const REPO = 'hwu121380-afk/hongguo-desktop-wrapper';
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const APP_USER_MODEL_ID = 'com.github.hwu121380-afk.hongguoduanju';

let win = null;
let tray = null;
let quitting = false;
let miniMode = false;
let miniState = null; // 进入小窗前的 { bounds, maximized, fullscreen }
let latestTag = null; // 静默更新检查发现的最新版本(只在托盘提示,不弹窗)

const statePath = () => path.join(app.getPath('userData'), 'window-state.json');
const historyPath = () => path.join(app.getPath('userData'), 'watch-history.json');
const updateCheckPath = () => path.join(app.getPath('userData'), 'update-check.json');
const speedPath = () => path.join(app.getPath('userData'), 'speed.json');

function loadJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

// 原子写:先写临时文件再改名,断电/崩溃不会留下半截 JSON
function saveJSON(p, data) {
  try {
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, p);
  } catch {}
}

// ---------- 本地观看历史(只记你在官网看过哪些详情页,存本地 JSON) ----------
function loadHistory() {
  const list = loadJSON(historyPath(), []);
  // 结构校验:必须是数组,且 URL 必须是站内地址,防文件被篡改后加载任意地址
  return Array.isArray(list) ? list.filter((it) => it && isInternal(it.url)) : [];
}

function saveHistory(list) { saveHistoryImpl(list); }
function saveHistoryImpl(list) { saveJSON(historyPath(), list.slice(0, 50)); }

function cleanTitle(t) {
  // 详情页标题形如「剧名_高清完整版全集免费观看_红果短剧」,剥掉 SEO 尾巴只留剧名
  const parts = String(t || '').split(/[|｜]/)[0]
    .split('_')
    .map((s) => s.trim())
    .filter(Boolean);
  const seo = /(红果短剧|免费|全集|高清完整版|在线观看|短剧官网|完整版)/;
  while (parts.length > 1 && seo.test(parts[parts.length - 1])) parts.pop();
  return (parts.join(' ') || '红果短剧').slice(0, 40);
}

function recordVisit(url, title) {
  if (!DETAIL_RE.test(url)) return;
  const list = loadHistory().filter((it) => it.url !== url);
  list.unshift({ url, title: cleanTitle(title), time: Date.now() });
  saveHistoryImpl(list);
  if (tray) setTrayMenu();
}

// ---------- 窗口状态记忆 ----------
function loadState() {
  const st = loadJSON(statePath(), null);
  if (!st || typeof st !== 'object') return null;
  return {
    ...st,
    width: Number.isFinite(st.width) && st.width >= 400 ? st.width : 1200,
    height: Number.isFinite(st.height) && st.height >= 640 ? st.height : 800
  };
}

// 恢复的位置必须至少有 80×40 像素落在某个显示器的可见区域内(防拔掉副屏后窗口失踪)
function isBoundsVisible(b) {
  return screen.getAllDisplays().some(({ workArea: a }) => (
    b.x < a.x + a.width - 80 &&
    b.x + b.width > a.x + 80 &&
    b.y < a.y + a.height - 80 &&
    b.y + b.height > a.y + 40
  ));
}

function saveState() {
  if (!win || win.isDestroyed()) return;
  if (miniMode) return; // 小窗模式下不覆盖记忆的常规尺寸
  try {
    const b = win.getBounds();
    saveJSON(statePath(), {
      x: b.x, y: b.y, width: b.width, height: b.height,
      maximized: win.isMaximized(),
      fullscreen: win.isFullScreen()
    });
  } catch {}
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 500);
}

function isInternal(url) {
  try { return HOST_RE.test(new URL(url).hostname); } catch { return false; }
}

// 只把 http/https 交给系统浏览器,拦截 file:/javascript: 等危险协议
function isWebUrl(url) {
  try { return /^https?:$/.test(new URL(url).protocol); } catch { return false; }
}

// 导航守卫:主框架 + 非站内 → 拦截,http(s) 交给系统浏览器
// will-navigate 管「页面主动跳转」,will-redirect 管「服务端 302」,两个都要挂
function guardNavigation(e, url, _isInPlace, isMainFrame = true) {
  if (!isMainFrame || isInternal(url)) return;
  e.preventDefault();
  if (isWebUrl(url)) shell.openExternal(url);
}

function showWin() {
  if (!win || win.isDestroyed()) { win = null; createWindow(); return; }
  // 从老板键唤回时恢复声音
  win.webContents.setAudioMuted(false);
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ---------- 老板键:直接暂停页面里所有正在播放的媒体,再隐藏窗口 ----------
// 不用模拟空格键:空格是「切换」,视频已暂停时反而会把视频重新播放(评审实测确认)
function pausePlayback() {
  if (!win || win.isDestroyed()) return;
  win.webContents.executeJavaScript(`(() => {
    const media = [...document.querySelectorAll('video,audio')]
      .filter((v) => !v.paused && !v.ended);
    media.forEach((v) => v.pause());
    return media.length;
  })()`, true).then((count) => {
    // 兜底:万一站点把播放器放进 iframe/自定义容器,至少把声音静音
    if (count === 0 && win && !win.isDestroyed()) win.webContents.setAudioMuted(true);
  }).catch(() => {
    if (win && !win.isDestroyed()) win.webContents.setAudioMuted(true);
  });
}

function bossKey() {
  if (!win || win.isDestroyed()) { win = null; showWin(); return; }
  if (win.isVisible()) {
    pausePlayback();
    win.hide();
  } else {
    showWin();
  }
}

// ---------- 小窗置顶:竖屏比例置顶小窗,适合边干活边刷剧 ----------
function toggleMini() {
  if (!win || win.isDestroyed()) return;
  const wa = screen.getDisplayMatching(win.getBounds()).workArea;
  if (!miniMode) {
    miniState = {
      bounds: win.getBounds(),
      maximized: win.isMaximized(),
      fullscreen: win.isFullScreen()
    };
    if (win.isFullScreen()) win.setFullScreen(false);
    win.unmaximize();
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setMinimumSize(280, 420);
    win.setBounds({
      x: Math.round(wa.x + (wa.width - 430) / 2),
      y: Math.round(wa.y + (wa.height - 760) / 2),
      width: 430,
      height: 760
    });
    miniMode = true;
  } else {
    win.setAlwaysOnTop(false);
    win.setMinimumSize(400, 640);
    if (miniState) {
      win.setBounds(miniState.bounds);
      if (miniState.maximized) win.maximize();
      if (miniState.fullscreen) win.setFullScreen(true);
    } else {
      win.setSize(1200, 800);
    }
    miniMode = false;
    miniState = null;
  }
  setTrayMenu(); // 托盘文案随状态同步
}

// ---------- 倍速:记住上次倍速,换集后自动恢复 ----------
// 菜单快选档位;Ctrl+↑/↓ 以 0.25 步进,在 0.5–3 之间调速
const SPEED_MENU = [
  { rate: 0.75, label: '0.75x' },
  { rate: 1.0, label: '1.0x' },
  { rate: 1.25, label: '1.25x' },
  { rate: 1.5, label: '1.5x' },
  { rate: 2.0, label: '2.0x' }
];
let currentSpeed = 1.0;

function loadSpeed() {
  const v = loadJSON(speedPath(), null);
  return (typeof v === 'number' && v >= 0.5 && v <= 3) ? v : 1.0;
}

function fmtSpeed(r) {
  return (Math.round(r * 100) / 100).toString() + 'x';
}

// 托盘 tooltip 随倍速与更新提示同步
function refreshTrayTooltip() {
  if (!tray) return;
  let tip = '红果短剧';
  if (currentSpeed !== 1) tip += ` —— 倍速 ${fmtSpeed(currentSpeed)}`;
  if (latestTag) tip += `,发现新版本 v${latestTag},托盘菜单可前往下载`;
  tray.setToolTip(tip);
}

// 与 pausePlayback 同样手段:主进程直接改页面 video 元素的播放速率
function applySpeed() {
  if (!win || win.isDestroyed()) return;
  win.webContents.executeJavaScript(`(() => {
    let n = 0;
    document.querySelectorAll('video').forEach((v) => {
      v.playbackRate = ${currentSpeed};
      v.defaultPlaybackRate = ${currentSpeed};
      n++;
    });
    return n;
  })()`, true).catch(() => {});
}

function setSpeed(rate) {
  const clamped = Math.min(3, Math.max(0.5, Math.round(rate * 4) / 4));
  currentSpeed = clamped;
  saveJSON(speedPath(), clamped);
  applySpeed();
  refreshTrayTooltip();
  setTrayMenu();
  Menu.setApplicationMenu(buildMenu());
}

function stepSpeed(delta) { setSpeed(currentSpeed + delta); }

// ---------- 清除缓存与登录状态 ----------
async function clearCacheAndLogin() {
  const { response } = await msgBox({
    type: 'warning',
    title: '清除缓存与登录状态',
    message: '将清除浏览缓存、Cookie 与本地存储,登录状态也会退出,需要重新登录。确定继续吗?',
    buttons: ['清除', '取消'],
    defaultId: 1,
    cancelId: 1
  });
  if (response !== 0) return;
  try {
    const ses = session.defaultSession;
    await ses.clearCache();
    await ses.clearStorageData({ storages: ['cookies', 'localstorage', 'cachestorage', 'indexdb', 'serviceworkers'] });
    await msgBox({ type: 'info', title: '已清除', message: '缓存与登录状态已清除,页面将重新加载,请重新登录。' });
    if (win && !win.isDestroyed()) win.reload();
  } catch {
    msgBox({ type: 'warning', title: '清除失败', message: '清除缓存时出错,请重试。' });
  }
}

// ---------- 开机自启(仅打包版有意义) ----------
function isAutoLaunch() {
  return app.isPackaged && app.getLoginItemSettings().openAtLogin;
}

function toggleAutoLaunch(item) {
  if (!app.isPackaged) return; // 开发模式写入 electron.exe 无意义,直接忽略
  app.setLoginItemSettings({ openAtLogin: item.checked });
}

// ---------- 用户反馈入口:预填版本信息,直达 GitHub 新建 Issue ----------
function feedbackUrl() {
  const body = [
    `应用版本: v${app.getVersion()}`,
    `系统: Windows ${os.release()}`,
    `Electron: ${process.versions.electron}`,
    '',
    '问题描述:'
  ].join('\n');
  return `https://github.com/${REPO}/issues/new?title=${encodeURIComponent('【反馈】')}&body=${encodeURIComponent(body)}`;
}

// ---------- 应用内检查更新 ----------
const SAFE_RELEASE_URL = new RegExp(`^https://github\\.com/${REPO}/releases/[^\\s]+$`);

// API 返回的 html_url 只在匹配本仓库 Releases 路径时采信,防止异常响应被 openExternal 拉起任意协议
function safeReleaseUrl(u) {
  return SAFE_RELEASE_URL.test(String(u || '')) ? u : RELEASES_PAGE;
}

function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

async function fetchLatestRelease() {
  const res = await fetch(RELEASES_API, {
    headers: { 'User-Agent': 'hongguo-desktop-wrapper' },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  const tag = String(j.tag_name || '').replace(/^v/, '');
  if (!tag) throw new Error('no tag_name');
  return { tag, url: safeReleaseUrl(j.html_url) };
}

function msgBox(opts) {
  const parent = win && !win.isDestroyed() ? win : undefined;
  return parent ? dialog.showMessageBox(parent, opts) : dialog.showMessageBox(opts);
}

function showUpdateDialog(tag, url) {
  msgBox({
    type: 'info',
    title: '发现新版本',
    message: `红果短剧桌面客户端 ${tag} 已发布`,
    detail: '前往 Releases 页下载新安装包,覆盖安装即可,观看记录不受影响。',
    buttons: ['前往下载', '以后再说'],
    defaultId: 0,
    cancelId: 1
  }).then(({ response }) => {
    if (response === 0) shell.openExternal(url);
  });
}

async function checkUpdate(interactive) {
  try {
    const { tag, url } = await fetchLatestRelease();
    saveJSON(updateCheckPath(), { lastCheck: Date.now() });
    if (compareVersions(tag, app.getVersion()) > 0) {
      if (interactive) {
        showUpdateDialog(tag, url);
      } else {
        // 自动检查保持静默:只更新托盘菜单和 tooltip,不抢焦点
        latestTag = tag;
        if (tray) setTrayMenu();
        refreshTrayTooltip();
      }
    } else if (interactive) {
      latestTag = null;
      if (tray) setTrayMenu();
      msgBox({ type: 'info', title: '检查更新', message: `已是最新版本(v${app.getVersion()})` });
    }
  } catch {
    if (interactive) {
      msgBox({ type: 'warning', title: '检查更新', message: '检查更新失败,请检查网络后重试' });
    }
  }
}

function maybeAutoCheckUpdate() {
  const st = loadJSON(updateCheckPath(), {});
  if (st.lastCheck && Date.now() - st.lastCheck < 24 * 3600 * 1000) return;
  checkUpdate(false);
}

function createWindow() {
  const st = loadState() || {};
  const width = st.width || 1200;
  const height = st.height || 800;
  // 恢复位置前校验:保存的位置必须仍在可见屏幕范围内(多屏拔屏场景)
  const useSavedPos = Number.isFinite(st.x) && Number.isFinite(st.y)
    && isBoundsVisible({ x: st.x, y: st.y, width, height });
  win = new BrowserWindow({
    ...(useSavedPos ? { x: st.x, y: st.y } : {}),
    width,
    height,
    minWidth: 400,
    minHeight: 640,
    title: '红果短剧',
    backgroundColor: '#101014',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  if (st.maximized) win.maximize();
  if (st.fullscreen) win.setFullScreen(true);

  win.once('ready-to-show', () => win.show());
  win.loadURL(HOME_URL);

  // 防抖保存窗口状态:崩溃/强杀也不丢
  win.on('resize', scheduleSave);
  win.on('move', scheduleSave);

  // 点关闭 = 缩到托盘;没有托盘入口时必须真退出,绝不留隐形进程
  win.on('close', (e) => {
    saveState();
    if (quitting) return;
    if (!tray) { quitting = true; return; }
    e.preventDefault();
    win.hide();
  });
  win.on('closed', () => { win = null; });

  win.webContents.on('did-fail-load', (_e, code, _desc, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) win.loadFile('error.html');
  });

  // 渲染进程崩溃 → 给出恢复路径,而不是留白屏
  win.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit' || !win || win.isDestroyed()) return;
    msgBox({
      type: 'warning',
      title: '页面异常退出',
      message: '播放页面崩溃了,是否重新加载?',
      buttons: ['重新加载', '退出'],
      defaultId: 0,
      cancelId: 1
    }).then(({ response }) => {
      if (response === 0 && win && !win.isDestroyed()) win.reload();
      else { quitting = true; app.quit(); }
    });
  });

  win.webContents.on('unresponsive', () => {
    if (win && !win.isDestroyed()) win.webContents.forcefullyCrashRenderer();
  });

  // 站内新窗口在主窗口打开,站外 http(s) 交给系统浏览器,其他协议一律丢弃
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternal(url)) win.loadURL(url);
    else if (isWebUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', guardNavigation);
  win.webContents.on('will-redirect', guardNavigation);

  // 换集会换 video 元素,页面加载完成与标题更新时都重新应用已保存的倍速
  win.webContents.on('did-finish-load', () => { applySpeed(); });

  // 记录当前页面 URL 与标题,供观看历史使用(SPA pushState 会触发标题更新)
  win.webContents.on('page-title-updated', (_e, title) => {
    recordVisit(win.webContents.getURL() || '', title);
    applySpeed();
  });
}

// ---------- 托盘 ----------
function setTrayMenu() {
  if (!tray) return;
  const hist = loadHistory().slice(0, 8);
  const histItems = hist.length
    ? hist.map((it) => ({
        label: it.title.slice(0, 26),
        click: () => { showWin(); if (win) win.loadURL(it.url); }
      }))
    : [{ label: '暂无观看记录', enabled: false }];
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示红果短剧', click: showWin },
    { label: '最近看过', submenu: histItems },
    { type: 'separator' },
    { label: miniMode ? '退出小窗置顶' : '小窗置顶 (430×760)', click: () => { showWin(); toggleMini(); } },
    { label: '老板键 Ctrl+Shift+B', click: bossKey },
    { type: 'separator' },
    ...(latestTag ? [{ label: `发现新版本 v${latestTag} —— 点击前往下载`, click: () => shell.openExternal(RELEASES_PAGE) }] : []),
    { label: '检查更新', click: () => { showWin(); checkUpdate(true); } },
    { label: '反馈问题', click: () => shell.openExternal(feedbackUrl()) },
    { type: 'separator' },
    { label: '开机自启', type: 'checkbox', checked: isAutoLaunch(), click: toggleAutoLaunch },
    { label: '清空观看记录', click: () => { saveHistoryImpl([]); setTrayMenu(); } },
    { label: '清除缓存与登录状态', click: () => { showWin(); clearCacheAndLogin(); } },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } }
  ]));
}

function createTray() {
  try {
    // 多尺度托盘图标:系统按 DPI 自动取 16/32/48px 中最清晰的一档,避免 256px 直接缩糊
    const icon = nativeImage.createEmpty();
    let any = false;
    for (const [size, scale] of [[16, 1], [32, 2], [48, 3]]) {
      const p = path.join(__dirname, 'assets', `icon-${size}.png`);
      if (fs.existsSync(p)) {
        icon.addRepresentation({ scaleFactor: scale, buffer: fs.readFileSync(p) });
        any = true;
      }
    }
    tray = any
      ? new Tray(icon)
      : new Tray(nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')));
  } catch {
    tray = null;
    return false;
  }
  refreshTrayTooltip();
  setTrayMenu();
  tray.on('click', showWin);
  return true;
}

// ---------- 应用菜单(按 Alt 显示) ----------
function buildMenu() {
  return Menu.buildFromTemplate([
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '刷新' },
        { role: 'forceReload', label: '强制刷新' },
        { type: 'separator' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { role: 'resetZoom', label: '实际大小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '沉浸全屏 (F11)' },
        { role: 'toggleDevTools', label: '开发者工具' }
      ]
    },
    {
      label: '功能',
      submenu: [
        { label: '小窗置顶', click: toggleMini },
        { label: '老板键(隐藏/唤出,全局生效)', click: bossKey },
        {
          label: '倍速',
          submenu: SPEED_MENU.map(({ rate, label }) => ({
            label, type: 'checkbox', checked: currentSpeed === rate,
            click: () => setSpeed(rate)
          }))
        },
        { label: '倍速 +0.25 (Ctrl+↑)', accelerator: 'CommandOrControl+Up', click: () => stepSpeed(0.25) },
        { label: '倍速 -0.25 (Ctrl+↓)', accelerator: 'CommandOrControl+Down', click: () => stepSpeed(-0.25) },
        { label: '检查更新', click: () => checkUpdate(true) },
        { label: '反馈问题', click: () => shell.openExternal(feedbackUrl()) },
        { type: 'separator' },
        { label: '开机自启', type: 'checkbox', checked: isAutoLaunch(), click: toggleAutoLaunch },
        { label: '清空观看记录', click: () => { saveHistoryImpl([]); setTrayMenu(); } },
        { label: '清除缓存与登录状态', click: () => clearCacheAndLogin() }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'close', label: '关闭窗口' }
      ]
    }
  ]);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', showWin);
  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => globalShortcut.unregisterAll());

  app.whenReady().then(() => {
    app.setAppUserModelId(APP_USER_MODEL_ID);
    // 深色原生标题栏,与站点暗色主题一致
    nativeTheme.themeSource = 'dark';

    // 权限守卫:Electron 默认放行所有权限请求(摄像头/麦克风/通知等),这里只放行全屏
    const ALLOWED_PERMISSIONS = new Set(['fullscreen']);
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(ALLOWED_PERMISSIONS.has(permission));
    });
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
      return ALLOWED_PERMISSIONS.has(permission);
    });

    // 壳层不提供下载功能:页面触发的下载一律拦截,避免莫名落盘
    session.defaultSession.on('will-download', (e, item) => {
      e.preventDefault();
      msgBox({ type: 'info', title: '已阻止下载', message: `已阻止下载:${item.getFilename()}` });
    });

    // 去掉 UA 里的 Electron 标识,避免站点按爬虫/特殊客户端处理
    app.userAgentFallback = app.userAgentFallback.replace(/\s*Electron\/[\d.]+/, '');
    currentSpeed = loadSpeed();
    Menu.setApplicationMenu(buildMenu());
    globalShortcut.register('Control+Shift+B', bossKey) ||
      console.warn('[hongguo] Ctrl+Shift+B 快捷键注册失败,可能被其他程序占用');
    createWindow();
    if (!createTray()) console.warn('[hongguo] 托盘创建失败,关闭窗口将直接退出');
    maybeAutoCheckUpdate();
  });
}

// 有托盘时窗口只是被隐藏,不退出;没有托盘入口则退出,不留隐形进程
app.on('window-all-closed', () => {
  if (!tray) app.quit();
});
