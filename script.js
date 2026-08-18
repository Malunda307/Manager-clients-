// ===== MODE DETECTION =====
var up = new URLSearchParams(window.location.search);
var icm = up.get('mode') === 'client';

// ===== SUPABASE CONFIG =====
// IMPORTANT : remplace ces 2 valeurs par celles de TON projet Supabase.
// Project Settings → API → Project URL + anon public key
var supabaseConfig = {
  url: "https://zsiytjsyxlqjhwzufnxo.supabase.co",
  anonKey: "sb_publishable_5k2aKe9lymjRt3QuLktIqg_bGRis23A"
};
var sbClient = null;
var sbReady = false;
var currentUser = null;   // session.user
var currentProfile = null; // { id, role, name, phone }
var isAdmin = false;

// cloudConfigured : le projet Supabase EST renseigne dans ce fichier.
// On distingue ce cas de "la librairie n'a pas pu se charger", sinon il suffirait
// de bloquer le CDN pour retomber en mode local et obtenir les droits gerant.
var cloudConfigured = /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(supabaseConfig.url || '');
var localOnly = !cloudConfigured; // vraie app locale, sans comptes : acces gere par l'appareil
var cloudUnavailable = false;     // configure mais librairie absente : aucun droit gerant

try {
  if (cloudConfigured && typeof supabase !== 'undefined') {
    sbClient = supabase.createClient(supabaseConfig.url, supabaseConfig.anonKey);
    sbReady = true;
  } else if (cloudConfigured) {
    cloudUnavailable = true;
  }
} catch (e) { cloudUnavailable = cloudConfigured; console.warn('Supabase non configure', e); }

// ===== CACHE LOCAL + CLOUD (offline-first) =====
// localStorage = source de vérité locale (marche hors ligne)
// Supabase = synchro quand le réseau est dispo
var DBK = 'dbm_v3';
var ADMIN_CACHE_KEY = 'dbm_admin_v2';
var LEGACY_ADMIN_CACHE_KEY = 'dbm_admin_cache'; // ancien marqueur, non fiable : on le supprime
var OFFLINE_ADMIN_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 jours sans re-verification en ligne
// offlineAdmin n'est JAMAIS accorde par la simple presence d'une cle localStorage :
// il faut une session Supabase locale (JWT signe) dont l'utilisateur correspond au cache.
var offlineAdmin = false;
// Tables reservees au gerant : jamais mises en cache sans droits gerant valides.
var SENSITIVE_TABLES = ['clients', 'orders', 'expenses', 'goals', 'stocks', 'ambassadors'];
var db = {
  config: { currency: "FC", defaultCom: 500, reinvestRate: 30, goalOrders: 500, goalRevenue: 1500000, whatsapp: '' },
  products: [],
  ambassadors: [],
  clients: [],
  orders: [],
  stocks: [],
  expenses: [],
  goals: []
};

function sdb() {
  try {
    var snapshot = { config: db.config, products: db.products };
    // Les donnees financieres ne sont persistees que si les droits gerant sont
    // etablis : sinon un simple coup d'oeil dans localStorage suffirait a lire
    // le chiffre d'affaires, les marges et le fichier clients.
    if (adminGranted()) {
      SENSITIVE_TABLES.forEach(function (k) { snapshot[k] = db[k]; });
    }
    localStorage.setItem(DBK, JSON.stringify(snapshot));
  } catch (e) { console.warn('localStorage plein', e); }
}
function purgeSensitiveCache() {
  SENSITIVE_TABLES.forEach(function (k) { db[k] = []; });
  try {
    var r = localStorage.getItem(DBK);
    if (r) {
      var parsed = JSON.parse(r);
      SENSITIVE_TABLES.forEach(function (k) { delete parsed[k]; });
      localStorage.setItem(DBK, JSON.stringify(parsed));
    }
  } catch (e) {}
}
function ldb() {
  try {
    var r = localStorage.getItem(DBK);
    if (!r) return false;
    var parsed = JSON.parse(r);
    if (parsed.config) db.config = parsed.config;
    if (parsed.products) db.products = parsed.products;
    if (parsed.ambassadors) db.ambassadors = parsed.ambassadors;
    if (parsed.clients) db.clients = parsed.clients;
    if (parsed.orders) db.orders = parsed.orders;
    if (parsed.stocks) db.stocks = parsed.stocks;
    if (parsed.expenses) db.expenses = parsed.expenses;
    if (parsed.goals) db.goals = parsed.goals;
    return true;
  } catch (e) { console.warn('ldb fail', e); return false; }
}
function seedIfEmpty() {
  if (db.products && db.products.length) return;
  db.products = [
    { id: uid(), name: 'Classic Burger', price: 3000, cost: 1500, category: 'burger', available: true, emoji: '🍔', photo: null },
    { id: uid(), name: 'Cheese Burger', price: 3500, cost: 1800, category: 'burger', available: true, emoji: '🧀', photo: null },
    { id: uid(), name: 'Double Burger', price: 4500, cost: 2200, category: 'burger', available: true, emoji: '🥩', photo: null },
    { id: uid(), name: 'Coca 33cl', price: 800, cost: 400, category: 'drink', available: true, emoji: '🥤', photo: null },
    { id: uid(), name: 'Frites Moyennes', price: 1000, cost: 300, category: 'fries', available: true, emoji: '🍟', photo: null },
    { id: uid(), name: 'Frites Grandes', price: 1500, cost: 450, category: 'fries', available: true, emoji: '🍟', photo: null },
    { id: uid(), name: 'Eau minerale', price: 500, cost: 200, category: 'drink', available: true, emoji: '💧', photo: null }
  ];
  if (!db.stocks.length) {
    db.stocks = [
      { id: uid(), name: 'Pains', qty: 50, min: 10, unit: 'piece', cost: 100 },
      { id: uid(), name: 'Steaks', qty: 40, min: 10, unit: 'piece', cost: 500 },
      { id: uid(), name: 'Fromage', qty: 30, min: 5, unit: 'tranche', cost: 150 },
      { id: uid(), name: 'Tomates', qty: 5, min: 2, unit: 'kg', cost: 2000 },
      { id: uid(), name: 'Coca', qty: 24, min: 6, unit: 'bouteille', cost: 350 },
      { id: uid(), name: 'Pommes de terre', qty: 20, min: 5, unit: 'kg', cost: 800 },
      { id: uid(), name: 'Emballages', qty: 100, min: 20, unit: 'piece', cost: 50 }
    ];
  }
  sdb();
}
function isOnline() { return typeof navigator !== 'undefined' ? navigator.onLine !== false : true; }
function canUseCloud() { return sbReady && isOnline(); }
function adminGranted() {
  // localOnly : pas de Supabase configure du tout, donc pas de comptes.
  // L'acces est alors gere au niveau de l'appareil, comme une caisse locale.
  return isAdmin || offlineAdmin || localOnly;
}
function rememberAdmin(user) {
  if (!user || !user.id) return;
  offlineAdmin = true;
  try {
    localStorage.setItem(ADMIN_CACHE_KEY, JSON.stringify({
      userId: user.id, email: user.email || '', at: Date.now()
    }));
  } catch (e) {}
}
function forgetAdmin() {
  offlineAdmin = false;
  try {
    localStorage.removeItem(ADMIN_CACHE_KEY);
    localStorage.removeItem(LEGACY_ADMIN_CACHE_KEY);
  } catch (e) {}
}
function readAdminCache() {
  try { return JSON.parse(localStorage.getItem(ADMIN_CACHE_KEY) || 'null'); } catch (e) { return null; }
}
// Accorde les droits gerant hors ligne SEULEMENT si :
//   - un cache admin existe et a moins de 7 jours,
//   - une session Supabase est presente localement (JWT signe par le serveur),
//   - et cette session appartient bien a l'utilisateur mis en cache.
// Forger cet acces demanderait un JWT valide, donc la cle secrete du projet.
function verifyOfflineAdmin() {
  offlineAdmin = false;
  try { localStorage.removeItem(LEGACY_ADMIN_CACHE_KEY); } catch (e) {}
  var cached = readAdminCache();
  if (!cached || !cached.userId || !cached.at) return Promise.resolve(false);
  if (Date.now() - Number(cached.at) > OFFLINE_ADMIN_MAX_AGE) {
    forgetAdmin();
    return Promise.resolve(false);
  }
  if (!sbReady) return Promise.resolve(false);
  return sbClient.auth.getSession().then(function (res) {
    var s = res && res.data && res.data.session;
    if (!s || !s.user || s.user.id !== cached.userId) { forgetAdmin(); return false; }
    offlineAdmin = true;
    return true;
  }).catch(function () { return false; });
}

// ===== UTILS =====
function fmt(n) { return Number(n || 0).toLocaleString('fr-FR') + ' ' + (db.config.currency || 'FC'); }
function fmtN(n) { return Number(n || 0).toLocaleString('fr-FR'); }
function ts() { return new Date().toISOString().split('T')[0]; }
function it(d) { return d && String(d).split('T')[0] === ts(); }
function iw2(d) {
  if (!d) return false;
  var dt = new Date(d), n = new Date();
  var diff = (n - dt) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff < 7;
}
function im(d) {
  if (!d) return false;
  var dt = new Date(d), n = new Date();
  return dt.getMonth() === n.getMonth() && dt.getFullYear() === n.getFullYear();
}
function uid() { return crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).substr(2, 9)); }
function escHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function t(msg) {
  var el = document.getElementById('tst');
  if (!el) return;
  el.innerText = msg; el.classList.add('s');
  setTimeout(function () { el.classList.remove('s'); }, 2500);
}
function ge(c) { var m = { burger: '🍔', drink: '🥤', fries: '🍟', other: '🍽️' }; return m[c] || '🍽️'; }
function requireSb() {
  // Cloud optionnel : ne bloque plus l'app
  return sbReady && isOnline();
}
function requireAdmin() {
  // Online  : session admin Supabase verifiee (profiles.role = 'admin')
  // Offline : session admin locale valide (JWT) de moins de 7 jours
  if (adminGranted()) return true;
  t('Connexion admin requise (ou réseau pour se connecter)');
  return false;
}

// ===== AUTH =====
function loadProfile(userId) {
  return sbClient.from('profiles').select('*').eq('id', userId).maybeSingle()
    .then(function (res) {
      if (res.error) { console.error(res.error); return null; }
      return res.data;
    });
}

function applySession(session) {
  currentUser = session ? session.user : null;
  if (!currentUser) {
    currentProfile = null;
    isAdmin = false;
    // Plus de session = plus de droits gerant, et le cache sensible est vide.
    forgetAdmin();
    purgeSensitiveCache();
    updateAuthUI();
    return Promise.resolve();
  }
  return loadProfile(currentUser.id).then(function (p) {
    currentProfile = p;
    isAdmin = !!(p && p.role === 'admin');
    if (isAdmin) {
      rememberAdmin(currentUser);
    } else {
      forgetAdmin();
      purgeSensitiveCache();
    }
    updateAuthUI();
  }).catch(function () {
    // Profil injoignable (hors ligne) : on retombe sur la verification locale,
    // qui exige une session valide correspondant au cache admin.
    return verifyOfflineAdmin().then(function (ok) {
      if (!ok) purgeSensitiveCache();
      updateAuthUI();
    });
  });
}

function updateAuthUI() {
  // --- Manager ---
  var login = document.getElementById('incoming-login');
  var bar = document.getElementById('admin-session-bar');
  if (!icm) {
    if (adminGranted() && !localOnly) {
      if (login) login.style.display = 'none';
      if (bar) {
        bar.style.display = 'flex';
        var em = document.getElementById('admin-email');
        var cached = readAdminCache();
        var label = (currentUser && currentUser.email) || (cached && cached.email) || 'Admin';
        if (em) em.innerText = label + (isAdmin ? '' : ' · hors ligne');
      }
      if (isAdmin) startIncomingOrdersFeed();
    } else {
      if (bar) bar.style.display = 'none';
      if (login) login.style.display = 'block';
      incomingOrders = [];
      renderIncomingOrders();
    }
  }

  // --- Client ---
  var cLogin = document.getElementById('client-auth-box');
  var cBar = document.getElementById('client-session-bar');
  var cName = document.getElementById('client-name-display');
  if (icm) {
    if (currentUser) {
      if (cLogin) cLogin.style.display = 'none';
      if (cBar) cBar.style.display = 'flex';
      if (cName) cName.innerText = (currentProfile && currentProfile.name) || currentUser.email;
      // Prefill cart form
      var n = document.getElementById('co-n');
      var p = document.getElementById('co-p');
      if (n && currentProfile && currentProfile.name) n.value = currentProfile.name;
      if (p && currentProfile && currentProfile.phone) p.value = currentProfile.phone;
      loadClientOrders();
    } else {
      if (cLogin) cLogin.style.display = 'block';
      if (cBar) cBar.style.display = 'none';
    }
  }
}

function adminLogin(e) {
  e.preventDefault();
  if (!requireSb()) return;
  var email = document.getElementById('admin-email-input').value.trim();
  var pass = document.getElementById('admin-pass-input').value;
  sbClient.auth.signInWithPassword({ email: email, password: pass }).then(function (res) {
    if (res.error) { t('Connexion echouee : ' + res.error.message); return; }
    t('Connecte !');
    // applySession via onAuthStateChange
  });
}

function adminLogout() {
  // On coupe les droits localement AVANT l'appel reseau : si signOut echoue
  // (hors ligne), l'appareil ne doit pas rester gerant.
  isAdmin = false;
  forgetAdmin();
  purgeSensitiveCache();
  if (sbReady) sbClient.auth.signOut();
  updateAuthUI();
}

function clientLogin(e) {
  e.preventDefault();
  if (!requireSb()) return;
  var email = document.getElementById('client-email-input').value.trim();
  var pass = document.getElementById('client-pass-input').value;
  sbClient.auth.signInWithPassword({ email: email, password: pass }).then(function (res) {
    if (res.error) { t('Connexion echouee : ' + res.error.message); return; }
    t('Bienvenue !');
  });
}

function clientSignup(e) {
  e.preventDefault();
  if (!requireSb()) return;
  var name = document.getElementById('client-signup-name').value.trim();
  var phone = document.getElementById('client-signup-phone').value.trim();
  var email = document.getElementById('client-signup-email').value.trim();
  var pass = document.getElementById('client-signup-pass').value;
  if (!name || !email || !pass) { t('Nom, email et mot de passe requis'); return; }
  if (pass.length < 6) { t('Mot de passe : 6 caracteres min.'); return; }
  // Aucun 'role' n'est envoye ici : le serveur force 'client' de toute facon
  // (voir handle_new_user dans supabase-security-fix.sql).
  sbClient.auth.signUp({
    email: email,
    password: pass,
    options: { data: { name: name } }
  }).then(function (res) {
    if (res.error) { t('Inscription echouee : ' + res.error.message); return; }
    // Mettre à jour le profil avec le téléphone
    if (res.data && res.data.user) {
      sbClient.from('profiles').update({ phone: phone, name: name }).eq('id', res.data.user.id).then(function () {});
      // Lier / créer fiche client
      ensureClientRow(res.data.user.id, name, phone);
    }
    t('Compte cree ! Verifie ton email si demande.');
  });
}

function clientLogout() {
  isAdmin = false;
  forgetAdmin();
  purgeSensitiveCache();
  if (sbReady) sbClient.auth.signOut();
}

function showClientAuthTab(tab) {
  document.getElementById('client-login-form').style.display = tab === 'login' ? 'flex' : 'none';
  document.getElementById('client-signup-form').style.display = tab === 'signup' ? 'flex' : 'none';
  document.querySelectorAll('#client-auth-tabs button').forEach(function (b) {
    b.classList.toggle('a', b.dataset.tab === tab);
  });
}

function ensureClientRow(userId, name, phone) {
  if (!sbReady) return Promise.resolve(null);
  return sbClient.from('clients').select('*').eq('user_id', userId).maybeSingle().then(function (res) {
    if (res.data) return res.data;
    return sbClient.from('clients').insert([{
      user_id: userId,
      name: name || 'Client',
      phone: phone || '',
      orders_count: 0,
      total: 0
    }]).select().single().then(function (r) { return r.data; });
  });
}

// ===== DATA LOAD =====
function mapProduct(r) {
  return {
    id: r.id, name: r.name, price: Number(r.price), cost: Number(r.cost),
    category: r.category, available: !!r.available, emoji: r.emoji || ge(r.category), photo: r.photo || null
  };
}
function mapClient(r) {
  return {
    id: r.id, userId: r.user_id, name: r.name, phone: r.phone || '',
    orders: r.orders_count || 0, total: Number(r.total || 0),
    firstOrder: r.first_order || '', lastOrder: r.last_order || '', ambassador: r.ambassador || ''
  };
}
function mapOrder(r) {
  return {
    id: r.id, clientId: r.client_id, clientName: r.client_name,
    userId: r.user_id, items: r.items || [], total: Number(r.total),
    cost: Number(r.cost), profit: Number(r.profit), payment: r.payment,
    ambassador: r.ambassador || '', orderType: r.order_type, address: r.address,
    notes: r.notes, status: r.status, isNewClient: !!r.is_new_client,
    date: r.created_at
  };
}
function mapAmb(r) {
  return {
    id: r.id, name: r.name, code: r.code, phone: r.phone || '',
    newClients: r.new_clients || 0, revenue: Number(r.revenue || 0),
    commission: Number(r.commission || 0), paid: Number(r.paid || 0)
  };
}
function mapStock(r) {
  return {
    id: r.id, name: r.name, qty: Number(r.qty), min: Number(r.min_qty),
    unit: r.unit || 'piece', cost: Number(r.cost || 0)
  };
}
function mapExpense(r) {
  return { id: r.id, date: r.date, category: r.category, amount: Number(r.amount), desc: r.description || '' };
}
function mapGoal(r) {
  return { id: r.id, title: r.title, type: r.type, target: Number(r.target), deadline: r.deadline || '', current: Number(r.current_val || 0) };
}

function loadPublicData() {
  if (!canUseCloud()) return Promise.resolve();
  return Promise.all([
    sbClient.from('config').select('*').eq('id', 1).maybeSingle(),
    sbClient.from('products').select('*').order('name'),
    sbClient.from('ambassadors').select('*').order('code')
  ]).then(function (results) {
    if (results[0].error || results[1].error) return;
    var cfg = results[0].data;
    if (cfg) {
      db.config = {
        currency: cfg.currency || 'FC',
        defaultCom: Number(cfg.default_com || 500),
        reinvestRate: Number(cfg.reinvest_rate || 30),
        goalOrders: Number(cfg.goal_orders || 500),
        goalRevenue: Number(cfg.goal_revenue || 1500000),
        whatsapp: cfg.whatsapp || ''
      };
    }
    if (results[1].data) db.products = results[1].data.map(mapProduct);
    if (results[2].data) db.ambassadors = results[2].data.map(mapAmb);
    sdb();
  }).catch(function (e) { console.warn('loadPublicData offline/fail', e); });
}

function loadAdminData() {
  if (!canUseCloud() || !isAdmin) return Promise.resolve();
  return Promise.all([
    sbClient.from('clients').select('*').order('name'),
    sbClient.from('orders').select('*').order('created_at', { ascending: false }).limit(500),
    sbClient.from('stocks').select('*').order('name'),
    sbClient.from('expenses').select('*').order('date', { ascending: false }).limit(300),
    sbClient.from('goals').select('*').order('created_at', { ascending: false })
  ]).then(function (results) {
    if (results[0].data) db.clients = results[0].data.map(mapClient);
    if (results[1].data) db.orders = results[1].data.map(mapOrder);
    if (results[2].data) db.stocks = results[2].data.map(mapStock);
    if (results[3].data) db.expenses = results[3].data.map(mapExpense);
    if (results[4].data) db.goals = results[4].data.map(mapGoal);
    sdb();
  }).catch(function (e) { console.warn('loadAdminData offline/fail', e); });
}

function loadClientOrders() {
  if (!sbReady || !currentUser || !icm) return;
  sbClient.from('orders').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false }).limit(50)
    .then(function (res) {
      var list = document.getElementById('client-orders-list');
      var empty = document.getElementById('client-orders-empty');
      if (!list) return;
      var orders = (res.data || []).map(mapOrder);
      if (orders.length === 0) {
        list.innerHTML = '';
        if (empty) empty.style.display = 'block';
        return;
      }
      if (empty) empty.style.display = 'none';
      list.innerHTML = orders.map(function (o) {
        var items = (o.items || []).map(function (i) { return escHtml(i.name) + ' x' + i.qty; }).join(', ');
        var when = o.date ? new Date(o.date).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
        return '<div class="ci"><div class="cin"><div class="nn">' + fmt(o.total) + ' — ' + escHtml(o.status || 'validee') + '</div><div class="pp">' + when + '<br>' + items + '</div></div></div>';
      }).join('');
    });
}

function refreshAll() {
  return loadPublicData().then(function () {
    if (isAdmin) return loadAdminData();
  }).then(function () {
    sdb();
    if (icm) {
      rcm();
      if (currentUser) loadClientOrders();
    } else if (adminGranted()) {
      var active = document.querySelector('.sc.a');
      var id = active ? active.id.replace('s-', '') : 'dash';
      sp(id);
    }
  }).catch(function () {
    if (icm) rcm();
    else if (adminGranted()) sp('dash');
  });
}

// ===== ORDERS INCOMING (live) =====
var incomingOrders = [];

function initIncomingOrders() {
  if (!sbReady || icm) return;
  // auth handled globally
}

function startIncomingOrdersFeed() {
  if (!sbReady || !isAdmin) return;
  sbClient.from('orders_incoming').select('*').eq('status', 'nouvelle').order('created_at', { ascending: true })
    .then(function (res) {
      if (res && res.data) { incomingOrders = res.data; renderIncomingOrders(); }
    });
  sbClient.channel('orders-live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders_incoming' }, function (payload) {
      incomingOrders.push(payload.new);
      renderIncomingOrders();
      t('Nouvelle commande recue !');
    })
    .subscribe();
}

function showAdminLoginForm() {
  var wrap = document.getElementById('incoming-wrap');
  var login = document.getElementById('incoming-login');
  if (wrap) wrap.style.display = 'none';
  if (login) login.style.display = 'block';
}
function showLoggedInBar(email) {
  var login = document.getElementById('incoming-login');
  var bar = document.getElementById('admin-session-bar');
  if (login) login.style.display = 'none';
  if (bar) { bar.style.display = 'flex'; var el = document.getElementById('admin-email'); if (el) el.innerText = email; }
}
function hideLoggedInBar() {
  var bar = document.getElementById('admin-session-bar');
  if (bar) bar.style.display = 'none';
}

function renderIncomingOrders() {
  var wrap = document.getElementById('incoming-wrap');
  var list = document.getElementById('incoming-orders');
  var badge = document.getElementById('cmd-badge');
  if (!wrap || !list) return;
  if (incomingOrders.length === 0) {
    wrap.style.display = 'none';
    if (badge) badge.style.display = 'none';
    return;
  }
  wrap.style.display = 'block';
  if (badge) { badge.style.display = 'block'; badge.innerText = incomingOrders.length; }
  list.innerHTML = incomingOrders.map(function (o, i) {
    var d = o.payload || {};
    var when = o.created_at ? new Date(o.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '';
    return '<div class="ci"><div class="cin"><div class="nn">' + escHtml(d.name || 'Client') + ' — ' + fmt(d.total || 0) + '</div><div class="pp">' + when + '</div></div>' +
      '<button class="bok bs2" onclick="importIncomingOrder(' + i + ')">Importer</button> ' +
      '<button class="be bs2" onclick="dismissIncomingOrder(' + i + ')">✕</button></div>';
  }).join('');
}

function importIncomingOrder(i) {
  var o = incomingOrders[i];
  if (!o) return;
  fillOrderFromScan(o.payload || {});
  markIncomingOrder(o.id, 'traitee');
  incomingOrders.splice(i, 1);
  renderIncomingOrders();
  t('Commande importee');
}
function dismissIncomingOrder(i) {
  var o = incomingOrders[i];
  if (!o) return;
  markIncomingOrder(o.id, 'ignoree');
  incomingOrders.splice(i, 1);
  renderIncomingOrders();
}
function markIncomingOrder(id, status) {
  if (!sbReady || !id) return;
  sbClient.from('orders_incoming').update({ status: status }).eq('id', id).then(function (res) {
    if (res && res.error) console.error('Mise a jour Supabase echouee', res.error);
  });
}

function pushOrderToCloud(data) {
  if (!sbReady) return;
  var row = { payload: data, status: 'nouvelle' };
  if (currentUser) row.user_id = currentUser.id;
  sbClient.from('orders_incoming').insert([row]).then(function (res) {
    if (res && res.error) console.error('Envoi Supabase echoue', res.error);
  });
}

// ===== SERVICE WORKER / INSTALL =====
try {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').then(function () {
      var el = document.getElementById('sws');
      if (el) el.innerText = 'SW: Actif';
    }).catch(function () {
      var el = document.getElementById('sws');
      if (el) el.innerText = 'SW: Non disp.';
    });
  }
} catch (e) {}

var dp;
window.addEventListener('beforeinstallprompt', function (e) {
  e.preventDefault();
  dp = e;
  var b = document.getElementById('ib');
  if (b) b.style.display = 'flex';
});
function ip() {
  if (dp) { dp.prompt(); dp.userChoice.then(function () { var b = document.getElementById('ib'); if (b) b.style.display = 'none'; dp = null; }); }
}

// ===== CLIENT MODE =====
var ccart = [];
var cot = 'emporter';
var ccf = 'all';

function scp(id) {
  document.querySelectorAll('.cs').forEach(function (s) { s.classList.remove('a'); });
  document.querySelectorAll('.cn button').forEach(function (b) { b.classList.remove('a'); });
  var sec = document.getElementById('cs-' + id);
  if (sec) sec.classList.add('a');
  var btn = document.getElementById('cn-' + id);
  if (btn) btn.classList.add('a');
  window.scrollTo(0, 0);
  if (id === 'menu') rcm();
  if (id === 'cart') rcc();
  if (id === 'track') loadClientOrders();
}

function fcm(cat, btn) {
  ccf = cat;
  document.querySelectorAll('#ccf button').forEach(function (b) { b.classList.remove('a'); });
  if (btn) btn.classList.add('a');
  rcm();
}

function rcm() {
  var g = document.getElementById('cp');
  if (!g) return;
  var prods = db.products.filter(function (p) { return p.available; });
  if (ccf !== 'all') prods = prods.filter(function (p) { return p.category === ccf; });
  if (prods.length === 0) {
    g.innerHTML = '<div class="es" style="grid-column:1/-1"><div class="i">🍽️</div><p>Aucun produit</p><p style="font-size:.8rem">Le menu se charge depuis le cloud…</p></div>';
    return;
  }
  g.innerHTML = prods.map(function (p) {
    var inc = ccart.find(function (c) { return c.id === p.id; });
    var q = inc ? inc.qty : 0;
    var pic = p.photo ? '<img src="' + p.photo + '" alt="" style="width:100%;height:100%;object-fit:cover">' : (p.emoji || '🍽️');
    return '<div class="pc"><div class="pi">' + pic + '</div><div class="pn"><div class="n">' + escHtml(p.name) + '</div><div class="d">' + escHtml(p.category) + '</div><div class="pr">' + fmt(p.price) + '</div><div class="pa"><button class="qb" onclick="ucc(\'' + p.id + '\',-1)">−</button><span class="qv">' + q + '</span><button class="qb" onclick="ucc(\'' + p.id + '\',1)">+</button></div></div></div>';
  }).join('');
}

var pendingAddPid = null;
function ucc(pid, delta) {
  var prod = db.products.find(function (p) { return p.id === pid; });
  if (!prod) return;
  var idx = ccart.findIndex(function (c) { return c.id === pid; });
  var wasEmpty = (idx < 0);
  if (idx >= 0) {
    ccart[idx].qty += delta;
    if (ccart[idx].qty <= 0) ccart.splice(idx, 1);
  } else if (delta > 0) {
    ccart.push({ id: prod.id, name: prod.name, price: prod.price, cost: prod.cost, qty: 1 });
  }
  ucb();
  rcm();
  if (document.getElementById('cs-cart') && document.getElementById('cs-cart').classList.contains('a')) rcc();
  if (wasEmpty && delta > 0) {
    pendingAddPid = pid;
    var m = document.getElementById('moadd');
    if (m) m.classList.add('a');
  }
}
function continueShoppingChoice() { cm('moadd'); pendingAddPid = null; }
function checkoutNowChoice() { cm('moadd'); pendingAddPid = null; scp('cart'); }

function ucb() {
  var b = document.getElementById('cb');
  if (!b) return;
  var tq = ccart.reduce(function (s, c) { return s + c.qty; }, 0);
  if (tq > 0) { b.style.display = 'block'; b.innerText = tq; }
  else { b.style.display = 'none'; }
}

function rcc() {
  var c = document.getElementById('cci');
  var totEl = document.getElementById('cct');
  var e = document.getElementById('cce');
  var f = document.getElementById('cof');
  var q = document.getElementById('cqr');
  if (!c) return;
  if (ccart.length === 0) {
    c.innerHTML = '';
    if (totEl) totEl.style.display = 'none';
    if (e) e.style.display = 'block';
    if (f) f.style.display = 'none';
    if (q) q.style.display = 'none';
    return;
  }
  if (e) e.style.display = 'none';
  if (totEl) totEl.style.display = 'block';
  if (f) f.style.display = 'flex';
  if (q) q.style.display = 'none';
  c.innerHTML = ccart.map(function (it) {
    var em = db.products.find(function (p) { return p.id === it.id; });
    var pic = em && em.photo ? '<img src="' + em.photo + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:10px">' : (em ? em.emoji : '🍽️');
    return '<div class="ci"><div class="cii">' + pic + '</div><div class="cin"><div class="nn">' + escHtml(it.name) + '</div><div class="pp">' + fmt(it.price) + ' x ' + it.qty + ' = ' + fmt(it.price * it.qty) + '</div></div><div class="pa"><button class="qb" onclick="ucc(\'' + it.id + '\',-1)">−</button><span class="qv">' + it.qty + '</span><button class="qb" onclick="ucc(\'' + it.id + '\',1)">+</button></div></div>';
  }).join('');
  var tot = ccart.reduce(function (s, c) { return s + c.price * c.qty; }, 0);
  var cta = document.getElementById('cta');
  if (cta) cta.innerText = fmt(tot);
}

function sot(btn, type) {
  cot = type;
  document.querySelectorAll('#cof .rb').forEach(function (b) { b.classList.remove('a'); });
  btn.classList.add('a');
  var a = document.getElementById('co-a');
  if (!a) return;
  if (type === 'surplace') a.placeholder = 'Numero de table';
  else if (type === 'emporter') a.placeholder = 'Telephone (confirmation)';
  else a.placeholder = 'Adresse de livraison';
}

function bco() {
  var tot = ccart.reduce(function (s, c) { return s + c.price * c.qty; }, 0);
  return {
    items: ccart.map(function (c) { return { name: c.name, price: c.price, qty: c.qty, id: c.id, cost: c.cost }; }),
    total: tot,
    orderType: cot,
    name: document.getElementById('co-n').value.trim(),
    phone: document.getElementById('co-p').value.trim(),
    address: document.getElementById('co-a').value.trim(),
    notes: document.getElementById('co-nt').value.trim(),
    ambassadorCode: document.getElementById('co-am').value.trim().toUpperCase(),
    timestamp: new Date().toISOString(),
    userId: currentUser ? currentUser.id : null
  };
}

function swa() {
  var name = document.getElementById('co-n').value.trim();
  var phone = document.getElementById('co-p').value.trim();
  if (!name || !phone) { t('Remplissez nom et telephone'); return; }
  if (ccart.length === 0) { t('Panier vide'); return; }
  var data = bco();
  var waNum = (db.config.whatsapp || '').replace(/[^0-9]/g, '');
  if (!waNum) { t('WhatsApp non configure (cote gerant)'); return; }
  var msg = "🍔 COMMANDE DINNER BURGER\n\n";
  data.items.forEach(function (i) { msg += "• " + i.name + " x" + i.qty + " = " + fmtN(i.price * i.qty) + " " + db.config.currency + "\n"; });
  msg += "\n💰 Total: " + fmtN(data.total) + " " + db.config.currency + "\n";
  msg += "\n👤 " + data.name + "\n📞 " + data.phone + "\n";
  msg += "📦 " + (data.orderType === 'livraison' ? 'Livraison' : data.orderType === 'surplace' ? 'Sur place' : 'A emporter') + "\n";
  if (data.address) msg += "📍 " + data.address + "\n";
  if (data.notes) msg += "📝 " + data.notes + "\n";
  if (data.ambassadorCode) msg += "🏷️ Code: " + data.ambassadorCode + "\n";
  msg += "\nMerci !";
  window.open("https://wa.me/" + waNum + "?text=" + encodeURIComponent(msg), '_blank');
  pushOrderToCloud(data);
  // Si client connecté, enregistrer aussi dans orders (historique)
  if (currentUser) saveClientOrderHistory(data);
  t('WhatsApp ouvert !');
}

function goqr() {
  var name = document.getElementById('co-n').value.trim();
  if (!name) { t('Entrez votre nom'); return; }
  if (ccart.length === 0) { t('Panier vide'); return; }
  var data = bco();
  pushOrderToCloud(data);
  if (currentUser) saveClientOrderHistory(data);
  var json = JSON.stringify(data);
  var b64 = btoa(unescape(encodeURIComponent(json)));
  var qrd = document.getElementById('cqr');
  var qri = document.getElementById('cqri');
  qri.innerHTML = '';
  qrd.style.display = 'block';
  try {
    new QRCode(qri, { text: b64, width: 200, height: 200, colorDark: "#000000", colorLight: "#ffffff" });
    var qimg = qri.querySelector('img'); if (qimg) qimg.alt = 'QR code de la commande';
    t('QR genere !');
  } catch (e) {
    qri.innerHTML = '<div style="padding:20px;background:#fff;color:#000;border-radius:12px;font-family:monospace;font-size:12px;word-break:break-all;max-width:280px">' + b64 + '</div>';
    t('QR indisponible, code affiche en texte');
  }
}

function saveClientOrderHistory(data) {
  if (!sbReady || !currentUser) return;
  // On n'envoie plus total / cost / profit / status : le serveur les recalcule
  // depuis la table products (trigger enforce_order_integrity). Les compteurs
  // de la fiche client sont eux aussi mis a jour cote serveur.
  ensureClientRow(currentUser.id, data.name, data.phone).then(function (client) {
    sbClient.from('orders').insert([{
      client_id: client ? client.id : null,
      client_name: data.name,
      user_id: currentUser.id,
      items: (data.items || []).map(function (i) { return { id: i.id, name: i.name, qty: i.qty }; }),
      ambassador: data.ambassadorCode || '',
      order_type: data.orderType,
      address: data.address,
      notes: data.notes
    }]).then(function (res) {
      if (res && res.error) { console.error('Enregistrement commande echoue', res.error); return; }
      loadClientOrders();
    });
  });
}

// ===== MANAGER NAV / UI =====
function cm(id) { var el = document.getElementById(id); if (el) el.classList.remove('a'); }

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    if (document.getElementById('mos') && document.getElementById('mos').classList.contains('a')) stopQrScanner();
    document.querySelectorAll('.mo.a').forEach(function (m) { m.classList.remove('a'); });
  }
});

function sp(id) {
  document.querySelectorAll('.sc').forEach(function (s) { s.classList.remove('a'); });
  document.querySelectorAll('.mn button').forEach(function (b) { b.classList.remove('a'); });
  var sec = document.getElementById('s-' + id);
  if (sec) sec.classList.add('a');
  var btn = document.getElementById('n-' + id);
  if (btn) btn.classList.add('a');
  window.scrollTo(0, 0);
  if (id === 'dash') rd();
  if (id === 'cmd') { roc(); roc2(); rcl(); }
  if (id === 'menu') rml();
  if (id === 'amb') { ral(); rpa(); }
  if (id === 'clients') rctl();
  if (id === 'stock') { rsl(); rms(); }
  if (id === 'finance') { rf(); re(); }
  if (id === 'analyse') ra();
  if (id === 'goals') rgl();
  if (id === 'sim') rs();
  if (id === 'settings') rse();
}

function scp2(p, btn) {
  document.querySelectorAll('#s-dash .fb button').forEach(function (b) { b.classList.remove('a'); });
  if (btn) btn.classList.add('a');
  rd(p);
}

// ===== ORDERS (manager) =====
function ho(e) {
  e.preventDefault();
  if (!requireAdmin()) return;
  var cid = document.getElementById('oc').value;
  var cname = document.getElementById('ocn').value.trim();
  var cphone = document.getElementById('ocp').value.trim();
  var pm = document.getElementById('opm').value;
  var amb = document.getElementById('oa').value;

  if (!cid && !cname) { t('Nom client requis'); return; }

  var items = [];
  var rows = document.querySelectorAll('#ois .oi');
  var tot = 0, cst = 0;
  for (var i = 0; i < rows.length; i++) {
    var sel = rows[i].querySelector('.op');
    var qin = rows[i].querySelector('.oq');
    if (!sel || !sel.value) continue;
    var prod = db.products.find(function (p) { return p.id === sel.value; });
    if (!prod) continue;
    var q = parseInt(qin.value) || 1;
    items.push({ id: prod.id, name: prod.name, price: prod.price, cost: prod.cost, qty: q });
    tot += prod.price * q;
    cst += prod.cost * q;
  }
  if (items.length === 0) { t('Ajoutez au moins un produit'); return; }

  var client = null;
  if (cid) {
    client = db.clients.find(function (c) { return c.id === cid; });
  } else {
    client = {
      id: uid(), name: cname, phone: cphone, orders: 0, total: 0,
      firstOrder: new Date().toISOString(), lastOrder: '', ambassador: ''
    };
    db.clients.push(client);
  }

  var isNew = client ? !client.lastOrder : true;
  var ambCode = '';
  if (amb) {
    var a = db.ambassadors.find(function (x) { return x.id === amb; });
    if (a) ambCode = a.code;
  }

  var order = {
    id: uid(),
    clientId: client ? client.id : null,
    clientName: client ? client.name : cname,
    items: items,
    total: tot,
    cost: cst,
    profit: tot - cst,
    payment: pm,
    ambassador: ambCode,
    status: 'validee',
    isNewClient: isNew,
    date: new Date().toISOString()
  };
  db.orders.unshift(order);

  if (client) {
    client.orders = (client.orders || 0) + 1;
    client.total = (client.total || 0) + tot;
    client.lastOrder = order.date;
    if (!client.firstOrder) client.firstOrder = order.date;
  }

  if (amb) {
    var a2 = db.ambassadors.find(function (x) { return x.id === amb; });
    if (a2) {
      if (isNew) a2.newClients += 1;
      a2.revenue += tot;
      a2.commission += (isNew ? db.config.defaultCom : 0);
    }
  }

  sdb();
  t(canUseCloud() && isAdmin ? 'Commande enregistree !' : 'Commande sauvee en local');
  document.getElementById('of').reset();
  document.getElementById('ncf').style.display = 'block';
  roc(); roc2(); rcl(); rd();

  // Best-effort cloud
  if (!(canUseCloud() && isAdmin)) return;
  var clientCloudId = client ? client.id : null;
  var ensureClient = Promise.resolve(client);
  if (client && !String(client.id).match(/^[0-9a-f-]{36}$/i)) {
    // id local non-uuid : créer côté cloud
    ensureClient = sbClient.from('clients').insert([{
      name: client.name, phone: client.phone || '', orders_count: client.orders,
      total: client.total, first_order: client.firstOrder, last_order: client.lastOrder
    }]).select().single().then(function (r) {
      if (r.data) {
        var mapped = mapClient(r.data);
        var ix = db.clients.findIndex(function (c) { return c.id === client.id; });
        if (ix >= 0) db.clients[ix] = mapped;
        clientCloudId = mapped.id;
        sdb();
        return mapped;
      }
      return client;
    }).catch(function () { return client; });
  }
  ensureClient.then(function (cl) {
    return sbClient.from('orders').insert([{
      client_id: cl ? cl.id : clientCloudId,
      client_name: order.clientName,
      items: items,
      total: tot,
      cost: cst,
      profit: tot - cst,
      payment: pm,
      ambassador: ambCode,
      status: 'validee',
      is_new_client: isNew
    }]).select().single();
  }).then(function (res) {
    if (!res || res.error) { console.warn(res && res.error); return; }
    var mapped = mapOrder(res.data);
    var oi = db.orders.findIndex(function (o) { return o.id === order.id; });
    if (oi >= 0) db.orders[oi] = mapped;
    sdb();
  }).catch(function () {});
}

function tnc(v) {
  var ncf = document.getElementById('ncf');
  if (v === '') {
    ncf.style.display = 'block';
    document.getElementById('ocn').value = '';
    document.getElementById('ocp').value = '';
  } else {
    ncf.style.display = 'none';
    var c = db.clients.find(function (x) { return x.id === v; });
    if (c) {
      document.getElementById('ocn').value = c.name;
      document.getElementById('ocp').value = c.phone || '';
    }
  }
}

function uot() {
  var rows = document.querySelectorAll('#ois .oi');
  var tot = 0, cst = 0;
  for (var i = 0; i < rows.length; i++) {
    var sel = rows[i].querySelector('.op');
    var qin = rows[i].querySelector('.oq');
    if (sel && sel.value) {
      var p = db.products.find(function (x) { return x.id === sel.value; });
      if (p) { var q = parseInt(qin.value) || 1; tot += p.price * q; cst += p.cost * q; }
    }
  }
  document.getElementById('otp').innerText = fmt(tot);
  document.getElementById('ocp2').innerText = fmt(cst);
  document.getElementById('opr').innerText = fmt(tot - cst);
}

function roi(btn) { var row = btn.closest('.oi'); if (row) { row.remove(); uot(); } }

function aoi() {
  var c = document.getElementById('ois');
  var d = document.createElement('div'); d.className = 'oi';
  var opts = '<option value="">Choisir</option>' + db.products.filter(function (p) { return p.available; }).map(function (p) {
    return '<option value="' + p.id + '">' + escHtml(p.name) + ' (' + fmt(p.price) + ')</option>';
  }).join('');
  d.innerHTML = '<select class="op" onchange="uot()" required>' + opts + '</select><input type="number" class="oq" value="1" min="1" onchange="uot()"><button type="button" class="be bs2" onclick="roi(this)">✕</button>';
  c.appendChild(d);
}

// QR Scanner
function os() {
  document.getElementById('mos').classList.add('a');
  startQrScanner();
}
function closeScannerModal() { stopQrScanner(); cm('mos'); }
var html5QrScanner = null;
function startQrScanner() {
  var container = document.getElementById('sc2-container');
  if (typeof Html5Qrcode === 'undefined') {
    container.innerHTML = '<p style="color:var(--t2);padding:20px;text-align:center">Scanner indisponible (bibliotheque non chargee).</p>';
    return;
  }
  container.innerHTML = '<div id="qr-reader" style="width:100%"></div>';
  html5QrScanner = new Html5Qrcode("qr-reader");
  html5QrScanner.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: 220 },
    onQrScanSuccess,
    function () {}
  ).catch(function (err) {
    container.innerHTML = '<p style="color:var(--t2);padding:20px;text-align:center">Camera indisponible. Autorisez l\'acces camera.</p>';
    console.error('Camera error', err);
  });
}
function stopQrScanner() {
  if (html5QrScanner) {
    html5QrScanner.stop().then(function () {
      html5QrScanner.clear();
      html5QrScanner = null;
    }).catch(function () { html5QrScanner = null; });
  }
}
function onQrScanSuccess(decodedText) {
  stopQrScanner();
  try {
    var json = decodeURIComponent(escape(atob(decodedText)));
    var data = JSON.parse(json);
    fillOrderFromScan(data);
    cm('mos');
    t('Commande importee du QR !');
  } catch (e) {
    t('QR invalide ou illisible');
    console.error('QR decode error', e);
  }
}
function fillOrderFromScan(data) {
  sp('cmd');
  document.getElementById('oc').value = '';
  tnc('');
  document.getElementById('ocn').value = data.name || '';
  document.getElementById('ocp').value = data.phone || '';

  var container = document.getElementById('ois');
  container.innerHTML = '';
  (data.items || []).forEach(function (it) {
    var prod = db.products.find(function (p) {
      return p.id === it.id || p.name.toLowerCase() === (it.name || '').toLowerCase();
    });
    var row = document.createElement('div'); row.className = 'oi';
    var opts = '<option value="">Choisir</option>' + db.products.filter(function (p) { return p.available; }).map(function (p) {
      return '<option value="' + p.id + '"' + (prod && prod.id === p.id ? ' selected' : '') + '>' + escHtml(p.name) + ' (' + fmt(p.price) + ')</option>';
    }).join('');
    row.innerHTML = '<select class="op" onchange="uot()" required>' + opts + '</select><input type="number" class="oq" value="' + (it.qty || 1) + '" min="1" onchange="uot()"><button type="button" class="be bs2" onclick="roi(this)">✕</button>';
    container.appendChild(row);
  });
  if (container.children.length === 0) aoi();

  var oaw = document.getElementById('oaw');
  if (data.ambassadorCode) {
    var amb = db.ambassadors.find(function (a) { return a.code === data.ambassadorCode; });
    if (amb) { document.getElementById('oa').value = amb.id; oaw.style.display = 'none'; }
    else { oaw.style.display = 'block'; oaw.innerText = 'Code ambassadeur inconnu : ' + data.ambassadorCode; }
  } else {
    oaw.style.display = 'none';
  }
  uot();
}
function iw() { t('Copiez le message WhatsApp puis utilisez le QR ou la saisie manuelle'); }

function fo(f, btn) {
  document.querySelectorAll('#s-cmd .fb button').forEach(function (b) { b.classList.remove('a'); });
  if (btn) btn.classList.add('a');
  rcl(f);
}

// ===== PRODUCTS =====
var pendingPhotoData;
var pendingPhotoBlob = null; // File/Blob original pour upload Storage

function dataUrlToBlob(dataUrl) {
  try {
    var parts = dataUrl.split(',');
    var mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
    var bin = atob(parts[1]);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  } catch (e) { return null; }
}

/** Upload vers Supabase Storage si possible, sinon garde le dataURL local */
function uploadProductPhoto(localId) {
  return new Promise(function (resolve) {
    if (pendingPhotoData === null) { resolve(null); return; } // retrait explicite
    if (pendingPhotoData === undefined) { resolve(undefined); return; } // pas de changement
    // Hors ligne ou pas admin cloud → base64 local
    if (!(canUseCloud() && isAdmin)) {
      resolve(pendingPhotoData);
      return;
    }
    var blob = pendingPhotoBlob || dataUrlToBlob(pendingPhotoData);
    if (!blob) { resolve(pendingPhotoData); return; }
    var ext = (blob.type || '').indexOf('png') >= 0 ? 'png' : 'jpg';
    var pathName = 'products/' + (localId || uid()) + '-' + Date.now() + '.' + ext;
    sbClient.storage.from('product-photos').upload(pathName, blob, {
      contentType: blob.type || 'image/jpeg',
      upsert: true
    }).then(function (up) {
      if (up.error) {
        console.warn('Storage upload fail, fallback base64', up.error);
        resolve(pendingPhotoData);
        return;
      }
      var pub = sbClient.storage.from('product-photos').getPublicUrl(pathName);
      var url = pub && pub.data && pub.data.publicUrl;
      resolve(url || pendingPhotoData);
    }).catch(function () { resolve(pendingPhotoData); });
  });
}


function resizeImage(file, maxDim, quality, callback) {
  var reader = new FileReader();
  reader.onload = function (e) {
    var img = new Image();
    img.onload = function () {
      var w = img.width, h = img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) { h = Math.round(h * maxDim / w); w = maxDim; }
        else { w = Math.round(w * maxDim / h); h = maxDim; }
      }
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      callback(canvas.toDataURL('image/jpeg', quality));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
function onPhotoSelected(input) {
  var file = input.files && input.files[0];
  if (!file) return;
  pendingPhotoBlob = file;
  resizeImage(file, 800, 0.75, function (dataUrl) {
    pendingPhotoData = dataUrl;
    // blob compressé pour upload (plus léger que le fichier original)
    pendingPhotoBlob = dataUrlToBlob(dataUrl) || file;
    var prev = document.getElementById('pphoto-preview');
    prev.src = dataUrl; prev.style.display = 'block';
    document.getElementById('pphoto-remove').style.display = 'inline-block';
  });
}
function removePhoto() {
  pendingPhotoData = null;
  pendingPhotoBlob = null;
  document.getElementById('pphoto').value = '';
  document.getElementById('pphoto-preview').style.display = 'none';
  document.getElementById('pphoto-remove').style.display = 'none';
}

function hp(e) {
  e.preventDefault();
  if (!requireAdmin()) return;
  var id = document.getElementById('pid').value;
  var name = document.getElementById('pn').value.trim();
  var cat = document.getElementById('pc').value;
  var price = parseFloat(document.getElementById('pp').value) || 0;
  var cost = parseFloat(document.getElementById('pco').value) || 0;
  var av = document.getElementById('pav').checked;
  if (!name) { t('Nom requis'); return; }

  var localId = id || uid();
  var existing = id ? db.products.find(function (x) { return x.id === id; }) : null;

  uploadProductPhoto(localId).then(function (photoVal) {
    var photo;
    if (photoVal === undefined) {
      photo = existing ? existing.photo || null : null;
    } else {
      photo = photoVal; // null = retiré, string = url ou base64
    }

    var local = {
      id: localId,
      name: name, category: cat, price: price, cost: cost, available: av,
      emoji: ge(cat), photo: photo
    };
    if (id) {
      var idx = db.products.findIndex(function (x) { return x.id === id; });
      if (idx >= 0) db.products[idx] = local; else db.products.push(local);
    } else {
      db.products.push(local);
    }
    sdb();
    rml();
    t(canUseCloud() && isAdmin ? 'Produit sauvegarde' : 'Produit sauve en local');
    rpf();

    if (!(canUseCloud() && isAdmin)) return;
    var payload = {
      name: name, category: cat, price: price, cost: cost,
      available: av, emoji: ge(cat), photo: photo
    };
    var q = id
      ? sbClient.from('products').update(payload).eq('id', id).select().single()
      : sbClient.from('products').insert([payload]).select().single();
    q.then(function (res) {
      if (res.error) { console.warn(res.error); return; }
      var mapped = mapProduct(res.data);
      var i2 = db.products.findIndex(function (x) { return x.id === localId || x.id === mapped.id; });
      if (i2 >= 0) db.products[i2] = mapped;
      else db.products.push(mapped);
      sdb(); rml();
    }).catch(function () {});
  });
}

function rpf() {
  document.getElementById('pf').reset();
  document.getElementById('pid').value = '';
  document.getElementById('pca').style.display = 'none';
  pendingPhotoData = undefined;
  pendingPhotoBlob = null;
  document.getElementById('pphoto-preview').style.display = 'none';
  document.getElementById('pphoto-remove').style.display = 'none';
}
function fp(c, btn) {
  document.querySelectorAll('#s-menu .fb button').forEach(function (b) { b.classList.remove('a'); });
  if (btn) btn.classList.add('a');
  rml(c);
}

// ===== AMBASSADORS =====
function ha(e) {
  e.preventDefault();
  if (!requireAdmin()) return;
  var n = document.getElementById('an').value.trim();
  var c = document.getElementById('ac').value.trim().toUpperCase();
  var ph = document.getElementById('aph').value.trim();
  if (!n || !c) { t('Nom et code requis'); return; }
  if (db.ambassadors.find(function (a) { return a.code === c; })) { t('Code deja utilise'); return; }
  var local = { id: uid(), name: n, code: c, phone: ph, newClients: 0, revenue: 0, commission: 0, paid: 0 };
  db.ambassadors.push(local);
  sdb(); ral(); rpa(); t('Ambassadeur cree');
  document.getElementById('af').reset();
  if (!(canUseCloud() && isAdmin)) return;
  sbClient.from('ambassadors').insert([{ name: n, code: c, phone: ph }]).select().single().then(function (res) {
    if (res.error) { console.warn(res.error); return; }
    var mapped = mapAmb(res.data);
    var i = db.ambassadors.findIndex(function (x) { return x.id === local.id; });
    if (i >= 0) db.ambassadors[i] = mapped;
    sdb(); ral(); rpa();
  }).catch(function () {});
}
function hcp(e) {
  e.preventDefault();
  if (!requireAdmin()) return;
  var id = document.getElementById('pa').value;
  var m = parseFloat(document.getElementById('pam').value) || 0;
  var a = db.ambassadors.find(function (x) { return x.id === id; });
  if (!a) { t('Selectionnez un ambassadeur'); return; }
  var newPaid = a.paid + m;
  sbClient.from('ambassadors').update({ paid: newPaid }).eq('id', id).then(function (res) {
    if (res.error) { t('Erreur: ' + res.error.message); return; }
    a.paid = newPaid;
    ral(); t('Paiement enregistre');
  });
}
function da(id) {
  if (!requireAdmin()) return;
  if (!confirm('Supprimer ?')) return;
  db.ambassadors = db.ambassadors.filter(function (x) { return x.id !== id; });
  sdb(); ral(); rpa();
  if (canUseCloud() && isAdmin) {
    sbClient.from('ambassadors').delete().eq('id', id).catch(function () {});
  }
}

// ===== STOCK =====
function hs(e) {
  e.preventDefault();
  if (!requireAdmin()) return;
  var id = document.getElementById('sid').value;
  var n = document.getElementById('sn').value.trim();
  var u = document.getElementById('su').value.trim() || 'piece';
  var q = parseFloat(document.getElementById('sq').value) || 0;
  var m = parseFloat(document.getElementById('sm').value) || 0;
  var c = parseFloat(document.getElementById('sc2').value) || 0;
  if (!n) { t('Nom requis'); return; }
  var local = { id: id || uid(), name: n, unit: u, qty: q, min: m, cost: c };
  if (id) {
    var idx = db.stocks.findIndex(function (x) { return x.id === id; });
    if (idx >= 0) db.stocks[idx] = local; else db.stocks.push(local);
  } else db.stocks.push(local);
  sdb(); rsl(); rms(); t('Stock mis a jour');
  document.getElementById('sf').reset();
  document.getElementById('sid').value = '';
  if (!(canUseCloud() && isAdmin)) return;
  var payload = { name: n, unit: u, qty: q, min_qty: m, cost: c };
  var p = id
    ? sbClient.from('stocks').update(payload).eq('id', id).select().single()
    : sbClient.from('stocks').insert([payload]).select().single();
  p.then(function (res) {
    if (res.error) { console.warn(res.error); return; }
    var mapped = mapStock(res.data);
    var i2 = db.stocks.findIndex(function (x) { return x.id === local.id; });
    if (i2 >= 0) db.stocks[i2] = mapped;
    sdb(); rsl(); rms();
  }).catch(function () {});
}
function hsm(e) {
  e.preventDefault();
  if (!requireAdmin()) return;
  var id = document.getElementById('ms').value;
  var type = document.getElementById('mt').value;
  var q = parseFloat(document.getElementById('mq').value) || 0;
  var s = db.stocks.find(function (x) { return x.id === id; });
  if (!s) { t('Selectionnez un article'); return; }
  s.qty = type === 'in' ? s.qty + q : s.qty - q;
  sdb(); rsl(); t('Mouvement enregistre');
  if (canUseCloud() && isAdmin) {
    sbClient.from('stocks').update({ qty: s.qty }).eq('id', id).then(function (res) {
      if (res.error) console.warn(res.error);
    }).catch(function () {});
  }
}
function ds(id) {
  if (!requireAdmin()) return;
  if (!confirm('Supprimer ?')) return;
  db.stocks = db.stocks.filter(function (x) { return x.id !== id; });
  sdb(); rsl(); rms();
  if (canUseCloud() && isAdmin) {
    sbClient.from('stocks').delete().eq('id', id).catch(function () {});
  }
}

// ===== EXPENSES / GOALS / CONFIG =====
function he(e) {
  e.preventDefault();
  if (!requireAdmin()) return;
  var d = document.getElementById('ed').value;
  var c = document.getElementById('ec').value;
  var a = parseFloat(document.getElementById('ea').value) || 0;
  var de = document.getElementById('ed2').value.trim();
  if (!d || !c) { t('Date et categorie requises'); return; }
  var local = { id: uid(), date: d, category: c, amount: a, desc: de };
  db.expenses.unshift(local);
  sdb(); re(); rf(); t('Depense enregistree');
  document.getElementById('ef').reset();
  if (!(canUseCloud() && isAdmin)) return;
  sbClient.from('expenses').insert([{ date: d, category: c, amount: a, description: de }]).select().single().then(function (res) {
    if (res.error) { console.warn(res.error); return; }
    var mapped = mapExpense(res.data);
    var i = db.expenses.findIndex(function (x) { return x.id === local.id; });
    if (i >= 0) db.expenses[i] = mapped;
    sdb(); re(); rf();
  }).catch(function () {});
}
function de2(id) {
  if (!requireAdmin()) return;
  if (!confirm('Supprimer ?')) return;
  db.expenses = db.expenses.filter(function (x) { return x.id !== id; });
  sdb(); re(); rf();
  if (canUseCloud() && isAdmin) {
    sbClient.from('expenses').delete().eq('id', id).catch(function () {});
  }
}
function hg(e) {
  e.preventDefault();
  if (!requireAdmin()) return;
  var t2 = document.getElementById('gt').value.trim();
  var ty = document.getElementById('gty').value;
  var ta = parseFloat(document.getElementById('gta').value) || 0;
  var dl = document.getElementById('gdl').value || null;
  if (!t2 || !ty) { t('Titre et type requis'); return; }
  sbClient.from('goals').insert([{ title: t2, type: ty, target: ta, deadline: dl }]).select().single().then(function (res) {
    if (res.error) { t('Erreur: ' + res.error.message); return; }
    db.goals.push(mapGoal(res.data));
    rgl(); t('Objectif cree');
    document.getElementById('gf').reset();
  });
}
function hse(e) {
  e.preventDefault();
  if (!requireAdmin()) return;
  var payload = {
    currency: document.getElementById('cfg-c').value.trim() || 'FC',
    default_com: parseFloat(document.getElementById('cfg-co').value) || 500,
    reinvest_rate: parseFloat(document.getElementById('cfg-r').value) || 30,
    goal_orders: parseFloat(document.getElementById('cfg-go').value) || 500,
    goal_revenue: parseFloat(document.getElementById('cfg-gr').value) || 1500000,
    whatsapp: document.getElementById('cfg-wa').value.trim()
  };
  db.config.currency = payload.currency;
  db.config.defaultCom = payload.default_com;
  db.config.reinvestRate = payload.reinvest_rate;
  db.config.goalOrders = payload.goal_orders;
  db.config.goalRevenue = payload.goal_revenue;
  db.config.whatsapp = payload.whatsapp;
  sdb();
  t('Configuration sauvegardee');
  rse();
  if (!(canUseCloud() && isAdmin)) return;
  sbClient.from('config').update(payload).eq('id', 1).then(function (res) {
    if (res.error) console.warn(res.error);
  }).catch(function () {});
}

function rs() {
  var a = parseInt(document.getElementById('s1').value) || 0;
  var cj = parseInt(document.getElementById('s2').value) || 0;
  var pa = parseInt(document.getElementById('s3').value) || 0;
  var co = parseInt(document.getElementById('s4').value) || 0;
  var com = parseInt(document.getElementById('s5').value) || 0;
  var j = parseInt(document.getElementById('s6').value) || 26;
  var ri = parseInt(document.getElementById('s7').value) || 30;
  document.getElementById('sv1').innerText = a;
  document.getElementById('sv2').innerText = cj;
  document.getElementById('sv3').innerText = pa;
  document.getElementById('sv4').innerText = co;
  document.getElementById('sv5').innerText = com;
  document.getElementById('sv6').innerText = j;
  document.getElementById('sv7').innerText = ri;
  [{ id: 'p', mul: 0.8 }, { id: 'r', mul: 1 }, { id: 'a', mul: 1.2 }].forEach(function (sc) {
    var cmd = Math.round(a * cj * j * sc.mul);
    var rev = cmd * pa;
    var costs = cmd * co;
    var comm = cmd * com;
    var b1 = rev - costs - comm;
    var b2 = Math.round(b1 * (100 - ri) / 100);
    document.getElementById('s' + sc.id + '-c').innerText = fmtN(cmd);
    document.getElementById('s' + sc.id + '-r').innerText = fmt(rev);
    document.getElementById('s' + sc.id + '-co').innerText = fmt(costs);
    document.getElementById('s' + sc.id + '-cm').innerText = fmt(comm);
    document.getElementById('s' + sc.id + '-b1').innerText = fmt(b1);
    document.getElementById('s' + sc.id + '-b2').innerText = fmt(b2);
  });
}
function rc() {
  var q = document.getElementById('cs2').value.trim().toLowerCase();
  rctl(q);
}
function ldd() {
  t('Les donnees demo sont chargees via le SQL initial. Utilise le schema SQL fourni.');
}
function cad() {
  t('Effacement cloud non disponible ici — utilise le dashboard Supabase si besoin.');
}
function ccl() {
  var el = document.getElementById('cl2');
  if (el) { el.select(); document.execCommand('copy'); t('Lien copie !'); }
}

// ===== RENDER =====
function rd(period) {
  period = period || 'day';
  var today = db.orders.filter(function (o) { return it(o.date); });
  var week = db.orders.filter(function (o) { return iw2(o.date); });
  var month = db.orders.filter(function (o) { return im(o.date); });
  var scope = (period === 'week' ? week : (period === 'month' ? month : today));

  var ca = scope.reduce(function (s, o) { return s + o.total; }, 0);
  var ben = scope.reduce(function (s, o) { return s + o.profit; }, 0);
  var com = scope.reduce(function (s, o) { return s + (o.isNewClient ? db.config.defaultCom : 0); }, 0);

  document.getElementById('d-ca').innerText = fmt(ca);
  document.getElementById('d-ben').innerText = fmt(ben);
  document.getElementById('d-cmd').innerText = scope.length;
  document.getElementById('d-cs').innerText = (period === 'day' ? 'Auj.' : period === 'week' ? 'Semaine' : 'Mois');
  document.getElementById('d-com').innerText = fmt(com);

  var newC = scope.filter(function (o) { return o.isNewClient; }).length;
  document.getElementById('d-new').innerText = newC;
  document.getElementById('d-old').innerText = scope.length - newC;

  var al = document.getElementById('alerts');
  al.innerHTML = '';
  db.stocks.filter(function (s) { return s.qty <= s.min; }).forEach(function (s) {
    al.innerHTML += '<div class="al">Stock bas: ' + escHtml(s.name) + ' (' + s.qty + ' ' + escHtml(s.unit) + ')</div>';
  });

  var ctx = document.getElementById('c1');
  if (!ctx) return;
  var labels = [], data = [];
  if (period === 'day') {
    for (var h = 8; h <= 22; h++) { labels.push(h + 'h'); data.push(0); }
    scope.forEach(function (o) { var d = new Date(o.date); var hr = d.getHours(); if (hr >= 8 && hr <= 22) data[hr - 8] += o.total; });
  } else if (period === 'week') {
    var days = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
    for (var i = 0; i < 7; i++) { labels.push(days[i]); data.push(0); }
    scope.forEach(function (o) { data[new Date(o.date).getDay()] += o.total; });
  } else {
    for (var i = 1; i <= 31; i++) { labels.push(i); data.push(0); }
    scope.forEach(function (o) { data[new Date(o.date).getDate() - 1] += o.total; });
  }
  if (window.evChart) window.evChart.destroy();
  window.evChart = new Chart(ctx, {
    type: 'bar',
    data: { labels: labels, datasets: [{ label: 'CA', data: data, borderColor: '#c70102', backgroundColor: 'rgba(199,1,2,0.3)', borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { grid: { color: '#2a2a2a' } }, x: { grid: { display: false } } } }
  });
}

function roc() {
  var sel = document.getElementById('oc');
  sel.innerHTML = '<option value="">-- Nouveau --</option>';
  db.clients.forEach(function (c) {
    sel.innerHTML += '<option value="' + c.id + '">' + escHtml(c.name) + ' (' + escHtml(c.phone || '') + ')</option>';
  });
}
function roc2() {
  var sel = document.getElementById('oa');
  sel.innerHTML = '<option value="">Aucun</option>';
  db.ambassadors.forEach(function (a) {
    sel.innerHTML += '<option value="' + a.id + '">' + escHtml(a.code) + ' - ' + escHtml(a.name) + '</option>';
  });
}
function rcl(filter) {
  filter = filter || 'all';
  var tbody = document.getElementById('cl');
  tbody.innerHTML = '';
  var list = db.orders.slice();
  if (filter === 'today') list = list.filter(function (o) { return it(o.date); });
  if (filter === 'week') list = list.filter(function (o) { return iw2(o.date); });
  list.forEach(function (o, i) {
    var prods = (o.items || []).map(function (it) { return it.name + ' x' + it.qty; }).join(', ');
    tbody.innerHTML += '<tr><td>' + (i + 1) + '</td><td>' + String(o.date || '').split('T')[0] + '</td><td>' + escHtml(prods) + '</td><td>' + fmt(o.total) + '</td><td>' + fmt(o.profit) + '</td><td><button class="bs bs2" onclick="do2(\'' + o.id + '\')">👁</button></td></tr>';
  });
}
function do2(id) {
  var o = db.orders.find(function (x) { return x.id === id; });
  if (!o) return;
  var h = '<div class="sr"><span>Client:</span><strong>' + escHtml(o.clientName) + '</strong></div>';
  h += '<div class="sr"><span>Date:</span><span>' + String(o.date).replace('T', ' ').substr(0, 16) + '</span></div>';
  h += '<div class="sr"><span>Total:</span><strong>' + fmt(o.total) + '</strong></div>';
  h += '<div class="sr"><span>Benefice:</span><span>' + fmt(o.profit) + '</span></div>';
  h += '<div class="sr"><span>Paiement:</span><span>' + o.payment + '</span></div>';
  h += '<div class="sr"><span>Produits:</span></div><ul style="margin:0 0 10px 20px;font-size:.85rem">';
  (o.items || []).forEach(function (it) { h += '<li>' + escHtml(it.name) + ' x' + it.qty + ' = ' + fmt(it.price * it.qty) + '</li>'; });
  h += '</ul>';
  document.getElementById('mc').innerHTML = h;
  document.getElementById('mo').classList.add('a');
}

function rml(filter) {
  filter = filter || 'all';
  var tbody = document.getElementById('ml');
  tbody.innerHTML = '';
  var list = db.products;
  if (filter !== 'all') list = list.filter(function (p) { return p.category === filter; });
  list.forEach(function (p) {
    var st = p.available ? '<span class="bd bds">Dispo</span>' : '<span class="bd bde">Indispo</span>';
    var thumb = p.photo
      ? '<img src="' + p.photo + '" alt="" style="width:34px;height:34px;object-fit:cover;border-radius:6px;vertical-align:middle;margin-right:6px">'
      : '<span style="margin-right:6px">' + (p.emoji || '🍽️') + '</span>';
    tbody.innerHTML += '<tr><td>' + thumb + escHtml(p.name) + '</td><td>' + p.category + '</td><td>' + fmt(p.price) + '</td><td>' + fmt(p.cost) + '</td><td>' + fmt(p.price - p.cost) + '</td><td>' + st + '</td><td><button class="bs bs2" onclick="ep(\'' + p.id + '\')">✎</button> <button class="be bs2" onclick="dp(\'' + p.id + '\')">✕</button></td></tr>';
  });
}
function ep(id) {
  var p = db.products.find(function (x) { return x.id === id; });
  if (!p) return;
  document.getElementById('pid').value = p.id;
  document.getElementById('pn').value = p.name;
  document.getElementById('pc').value = p.category;
  document.getElementById('pp').value = p.price;
  document.getElementById('pco').value = p.cost;
  document.getElementById('pav').checked = p.available;
  document.getElementById('pca').style.display = 'inline-block';
  document.getElementById('pmp').innerText = fmt(p.price - p.cost);
  pendingPhotoData = undefined;
  document.getElementById('pphoto').value = '';
  var prev = document.getElementById('pphoto-preview');
  if (p.photo) {
    prev.src = p.photo; prev.style.display = 'block';
    document.getElementById('pphoto-remove').style.display = 'inline-block';
  } else {
    prev.style.display = 'none';
    document.getElementById('pphoto-remove').style.display = 'none';
  }
}
function dp(id) {
  if (!requireAdmin()) return;
  if (!confirm('Supprimer ?')) return;
  db.products = db.products.filter(function (x) { return x.id !== id; });
  sdb(); rml(); t('Produit supprime');
  if (canUseCloud() && isAdmin) {
    sbClient.from('products').delete().eq('id', id).then(function (res) {
      if (res.error) console.warn(res.error);
    }).catch(function () {});
  }
}

function ral() {
  var tbody = document.getElementById('al2');
  tbody.innerHTML = '';
  db.ambassadors.forEach(function (a) {
    var rest = a.commission - a.paid;
    tbody.innerHTML += '<tr><td>' + escHtml(a.code) + '</td><td>' + escHtml(a.name) + '</td><td>' + a.newClients + '</td><td>' + fmt(a.revenue) + '</td><td>' + fmt(a.commission) + '</td><td>' + fmt(a.paid) + '</td><td class="' + (rest > 0 ? 'kn' : 'kp') + '">' + fmt(rest) + '</td><td><button class="be bs2" onclick="da(\'' + a.id + '\')">✕</button></td></tr>';
  });
}
function rpa() {
  var sel = document.getElementById('pa');
  sel.innerHTML = '<option value="">Choisir</option>';
  db.ambassadors.forEach(function (a) {
    sel.innerHTML += '<option value="' + a.id + '">' + escHtml(a.code) + ' - ' + escHtml(a.name) + ' (Reste: ' + fmt(a.commission - a.paid) + ')</option>';
  });
}

function rctl(q) {
  var tbody = document.getElementById('ctl');
  tbody.innerHTML = '';
  var list = db.clients;
  if (q) list = list.filter(function (c) { return (c.name + ' ' + (c.phone || '')).toLowerCase().indexOf(q) >= 0; });
  list.forEach(function (c) {
    var type = c.orders === 1 ? 'Nouveau' : c.orders > 3 ? 'VIP' : 'Recurrent';
    tbody.innerHTML += '<tr><td>' + String(c.id).substr(-4) + '</td><td>' + escHtml(c.name) + '</td><td>' + escHtml(c.phone || '') + '</td><td>' + c.orders + '</td><td>' + fmt(c.total) + '</td><td>' + (c.lastOrder ? String(c.lastOrder).split('T')[0] : '-') + '</td><td>' + type + '</td><td>' + escHtml(c.ambassador || '') + '</td></tr>';
  });
}

function rsl() {
  var tbody = document.getElementById('sl');
  tbody.innerHTML = '';
  db.stocks.forEach(function (s) {
    var alert = s.qty <= s.min ? 'kn' : 'kp';
    tbody.innerHTML += '<tr><td>' + escHtml(s.name) + '</td><td class="' + alert + '">' + s.qty + '</td><td>' + escHtml(s.unit) + '</td><td>' + s.min + '</td><td>' + fmt(s.cost) + '</td><td><button class="bs bs2" onclick="es2(\'' + s.id + '\')">✎</button> <button class="be bs2" onclick="ds(\'' + s.id + '\')">✕</button></td></tr>';
  });
}
function rms() {
  var sel = document.getElementById('ms');
  sel.innerHTML = '';
  db.stocks.forEach(function (s) {
    sel.innerHTML += '<option value="' + s.id + '">' + escHtml(s.name) + ' (' + s.qty + ' ' + escHtml(s.unit) + ')</option>';
  });
}
function es2(id) {
  var s = db.stocks.find(function (x) { return x.id === id; });
  if (!s) return;
  document.getElementById('sid').value = s.id;
  document.getElementById('sn').value = s.name;
  document.getElementById('su').value = s.unit;
  document.getElementById('sq').value = s.qty;
  document.getElementById('sm').value = s.min;
  document.getElementById('sc2').value = s.cost;
}

function re() {
  var tbody = document.getElementById('el');
  tbody.innerHTML = '';
  db.expenses.forEach(function (e) {
    tbody.innerHTML += '<tr><td>' + e.date + '</td><td>' + e.category + '</td><td>' + fmt(e.amount) + '</td><td>' + escHtml(e.desc || '') + '</td><td><button class="be bs2" onclick="de2(\'' + e.id + '\')">✕</button></td></tr>';
  });
}
function rf() {
  var ca = db.orders.reduce(function (s, o) { return s + o.total; }, 0);
  var ex = db.expenses.reduce(function (s, e) { return s + e.amount; }, 0);
  var ben = db.orders.reduce(function (s, o) { return s + o.profit; }, 0) - ex;
  var rein = Math.round(ben * (db.config.reinvestRate / 100));
  var disp = ben - rein;
  var sav = Math.max(0, disp * 0.2);
  document.getElementById('f-ca').innerText = fmt(ca);
  document.getElementById('f-sa').innerText = fmt(sav);
  document.getElementById('f-re').innerText = fmt(rein);
  document.getElementById('f-av').innerText = fmt(Math.max(0, disp - sav));

  var ctx = document.getElementById('c2');
  if (!ctx) return;
  var cats = {};
  db.expenses.forEach(function (e) { cats[e.category] = (cats[e.category] || 0) + e.amount; });
  if (window.expChart) window.expChart.destroy();
  window.expChart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: Object.keys(cats), datasets: [{ data: Object.values(cats), backgroundColor: ['#c70102', '#ffc700', '#4caf50', '#2196f3', '#9c27b0', '#ff5722', '#607d8b', '#795548'] }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#fff' } } } }
  });
}

function ra() {
  var pStar = '-', pMax = 0, pCounts = {};
  db.orders.forEach(function (o) { (o.items || []).forEach(function (i) { pCounts[i.name] = (pCounts[i.name] || 0) + i.qty; }); });
  for (var k in pCounts) { if (pCounts[k] > pMax) { pMax = pCounts[k]; pStar = k; } }
  document.getElementById('a-pp').innerText = escHtml(pStar);

  var tAmb = '-', aMax = 0;
  db.ambassadors.forEach(function (a) { if (a.revenue > aMax) { aMax = a.revenue; tAmb = a.name; } });
  document.getElementById('a-ta').innerText = escHtml(tAmb);

  var cac = db.clients.length > 0 ? fmt(db.orders.reduce(function (s, o) { return s + o.total; }, 0) / db.clients.length) : '-';
  document.getElementById('a-cac').innerText = cac;
  var ap = db.orders.length > 0 ? fmt(db.orders.reduce(function (s, o) { return s + o.profit; }, 0) / db.orders.length) : '-';
  document.getElementById('a-ap').innerText = ap;

  var q1 = '-', q1m = 0;
  db.products.forEach(function (p) {
    var rev = db.orders.reduce(function (s, o) {
      return s + (o.items || []).filter(function (i) { return i.id === p.id; }).reduce(function (ss, ii) { return ss + ii.qty; }, 0) * p.price;
    }, 0);
    if (rev > q1m) { q1m = rev; q1 = p.name; }
  });
  document.getElementById('q1').innerText = escHtml(q1);
  document.getElementById('q2').innerText = escHtml(tAmb);
  document.getElementById('q3').innerText = cac;
  document.getElementById('q4').innerText = ap;
  var moCmd = db.orders.filter(function (o) { return im(o.date); }).length;
  document.getElementById('q5').innerText = Math.max(0, db.config.goalOrders - moCmd);
  var ben = db.orders.reduce(function (s, o) { return s + o.profit; }, 0) - db.expenses.reduce(function (s, e) { return s + e.amount; }, 0);
  document.getElementById('q6').innerText = fmt(Math.round(ben * (db.config.reinvestRate / 100)));
  var com = db.ambassadors.reduce(function (s, a) { return s + a.commission; }, 0);
  document.getElementById('q7').innerText = ben > 0 ? Math.round((com / ben) * 100) + '%' : '0%';

  var dayCounts = [0, 0, 0, 0, 0, 0, 0];
  db.orders.forEach(function (o) { dayCounts[new Date(o.date).getDay()]++; });
  var maxD = 0, bestD = '-', dNames = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  for (var i = 0; i < 7; i++) { if (dayCounts[i] > maxD) { maxD = dayCounts[i]; bestD = dNames[i]; } }
  document.getElementById('q8').innerText = bestD;

  var ctx = document.getElementById('c3');
  if (!ctx) return;
  var labels = [], data = [];
  db.products.forEach(function (p) {
    var q = db.orders.reduce(function (s, o) {
      return s + (o.items || []).filter(function (i) { return i.id === p.id; }).reduce(function (ss, ii) { return ss + ii.qty; }, 0);
    }, 0);
    if (q > 0) { labels.push(p.name); data.push(q); }
  });
  if (window.perfChart) window.perfChart.destroy();
  window.perfChart = new Chart(ctx, {
    type: 'bar',
    data: { labels: labels, datasets: [{ label: 'Qte vendue', data: data, backgroundColor: 'rgba(255,199,0,0.6)', borderColor: '#ffc700', borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { grid: { color: '#2a2a2a' } }, x: { grid: { display: false }, ticks: { color: '#fff' } } } }
  });
}

function rgl() {
  var c = document.getElementById('gl');
  c.innerHTML = '';
  db.goals.forEach(function (g) {
    var cur = 0;
    if (g.type === 'orders') cur = db.orders.length;
    else if (g.type === 'revenue') cur = db.orders.reduce(function (s, o) { return s + o.total; }, 0);
    else if (g.type === 'savings') cur = db.orders.reduce(function (s, o) { return s + o.profit; }, 0) * 0.2;
    else if (g.type === 'ambassadors') cur = db.ambassadors.length;
    else if (g.type === 'clients') cur = db.clients.length;
    else cur = g.current || 0;
    var pct = Math.min(100, Math.round((cur / g.target) * 100)) || 0;
    var dl = g.deadline ? ' (avant ' + g.deadline + ')' : '';
    c.innerHTML += '<div class="cd"><h3>' + escHtml(g.title) + dl + '</h3><div style="display:flex;justify-content:space-between;font-size:.9rem;margin-bottom:6px"><span>' + fmtN(cur) + ' / ' + fmtN(g.target) + '</span><span>' + pct + '%</span></div><div class="pb"><div class="pf" style="width:' + pct + '%"></div></div></div>';
  });
}

function rse() {
  document.getElementById('cfg-c').value = db.config.currency;
  document.getElementById('cfg-co').value = db.config.defaultCom;
  document.getElementById('cfg-r').value = db.config.reinvestRate;
  document.getElementById('cfg-go').value = db.config.goalOrders;
  document.getElementById('cfg-gr').value = db.config.goalRevenue;
  document.getElementById('cfg-wa').value = db.config.whatsapp || '';
  var url = window.location.href.split('?')[0] + '?mode=client';
  document.getElementById('cl2').value = url;
  var qri = document.getElementById('mqri');
  qri.innerHTML = '';
  try {
    new QRCode(qri, { text: url, width: 180, height: 180, colorDark: "#000000", colorLight: "#ffffff" });
    var qimg2 = qri.querySelector('img'); if (qimg2) qimg2.alt = 'QR code du lien client';
  } catch (e) {
    qri.innerHTML = '<p style="font-size:.75rem;color:var(--t2);word-break:break-all">' + url + '</p>';
  }
}

// ===== INIT (offline-first) =====
document.addEventListener('DOMContentLoaded', function () {
  // 1) Charger le cache local immédiatement (marche sans réseau)
  var hadLocal = ldb();
  if (!hadLocal) seedIfEmpty();

  if (icm) {
    document.getElementById('cm').style.display = 'block';
    scp('menu');
  } else {
    document.getElementById('mm').style.display = 'block';
    // Les droits gerant ne sont PAS accordes ici : on attend la verification
    // de la session locale (verifyOfflineAdmin) avant d'afficher quoi que ce soit.
    updateAuthUI();
    sp('dash');
  }

  // 2) Puis tenter le cloud si dispo
  if (!sbReady) {
    var msg = cloudUnavailable
      ? 'Connexion au serveur impossible (librairie non chargee). Reessaie avec une connexion internet : les donnees du gerant restent verrouillees.'
      : 'Mode local uniquement (Supabase non configure). Les donnees restent sur cet appareil.';
    document.body.insertAdjacentHTML('afterbegin',
      '<div style="background:#ff9800;color:#000;padding:10px 14px;text-align:center;font-size:.85rem;position:sticky;top:0;z-index:300">' +
      escHtml(msg) + '</div>'
    );
    if (!localOnly) {
      // Configure mais injoignable : aucun droit gerant, et rien de sensible
      // ne reste en cache sur l'appareil.
      purgeSensitiveCache();
      if (!icm) { updateAuthUI(); sp('dash'); }
    }
    return;
  }

  // 3) Verifier les droits gerant hors ligne (session locale + cache < 7 jours)
  verifyOfflineAdmin().then(function (ok) {
    if (!ok && !localOnly) purgeSensitiveCache();
    if (!icm) { updateAuthUI(); sp('dash'); }
  });

  function tryCloudSync() {
    if (!isOnline()) return;
    sbClient.auth.getSession().then(function (res) {
      var session = res && res.data && res.data.session;
      return applySession(session).then(function () { return refreshAll(); });
    }).catch(function () { /* reste en local */ });
  }

  tryCloudSync();

  sbClient.auth.onAuthStateChange(function (event, session) {
    applySession(session).then(function () { return refreshAll(); });
  });

  window.addEventListener('online', function () {
    t('Connexion retablie — synchro…');
    tryCloudSync();
  });
  window.addEventListener('offline', function () {
    t('Hors ligne — mode local actif');
  });
});
