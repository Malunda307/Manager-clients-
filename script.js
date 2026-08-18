
// ===== MODE DETECTION =====
var up = new URLSearchParams(window.location.search);
var icm = up.get('mode') === 'client';

// ===== SUPABASE (commandes en direct, client -> gerant) =====
// IMPORTANT : remplace ces 2 valeurs par celles de TON projet Supabase.
// Va sur https://supabase.com -> New project -> Project Settings -> API
// Copie "Project URL" et la cle "anon public". Voir README.md pour le detail des etapes.
var supabaseConfig = {
  url: "REMPLACE_MOI",
  anonKey: "REMPLACE_MOI"
};
var sbClient = null;
var sbReady = false;
try{
  if(supabaseConfig.url !== "REMPLACE_MOI" && typeof supabase !== 'undefined'){
    sbClient = supabase.createClient(supabaseConfig.url, supabaseConfig.anonKey);
    sbReady = true;
  }
} catch(e){ console.warn('Supabase non configure', e); }

// ===== NTFY (notification push sur le telephone du gerant) =====
// Sujet ntfy : garde-le secret (pas de nom trop simple/devinable).
// Installe l'appli ntfy.sh et abonne-toi a ce meme sujet pour recevoir les alertes.
var ntfyTopic = "dinnerburgerjeanp_2008";

function sendOrderNotification(data){
  if(!ntfyTopic) return;
  var itemsSummary = (data.items || []).map(function(i){ return i.qty + 'x ' + i.name; }).join(', ');
  var body = (data.name || 'Client') + ' — ' + fmt(data.total || 0) + (itemsSummary ? ('\n' + itemsSummary) : '');
  try{
    fetch('https://ntfy.sh/' + ntfyTopic, {
      method: 'POST',
      body: body,
      headers: {
        'Title': 'Nouvelle commande Dinner Burger',
        'Priority': 'high',
        'Tags': 'hamburger'
      }
    }).catch(function(err){ console.warn('Notification ntfy echouee', err); });
  } catch(e){ console.warn('Notification ntfy echouee', e); }
}

function pushOrderToCloud(data){
  if(!sbReady) return Promise.resolve({ ok:false, reason:'not-configured' });
  return sbClient.from('orders_incoming').insert([{ payload: data, status: 'nouvelle' }]).then(function(res){
    if(res && res.error){ console.error('Envoi Supabase echoue', res.error); return { ok:false, reason:'error', error:res.error }; }
    return { ok:true };
  }).catch(function(err){
    console.error('Envoi Supabase echoue', err);
    return { ok:false, reason:'network', error:err };
  });
}

// ===== Commandes recues en direct (cote gerant) =====
var incomingOrders = [];
var incomingChannel = null;

function initIncomingOrders(){
  if(!sbReady || icm) return;
  sbClient.auth.getSession().then(function(res){
    var session = res && res.data && res.data.session;
    if(session){
      showLoggedInBar(session.user.email);
      startIncomingOrdersFeed();
    } else {
      showAdminLoginForm();
    }
  });
  sbClient.auth.onAuthStateChange(function(event, session){
    if(session){
      showLoggedInBar(session.user.email);
      startIncomingOrdersFeed();
    } else {
      hideLoggedInBar();
      stopIncomingOrdersFeed();
      incomingOrders = [];
      renderIncomingOrders();
      showAdminLoginForm();
    }
  });
}

function stopIncomingOrdersFeed(){
  if(incomingChannel){
    sbClient.removeChannel(incomingChannel);
    incomingChannel = null;
  }
}

function startIncomingOrdersFeed(){
  stopIncomingOrdersFeed(); // evite les abonnements en double (ex: si l'etat d'auth change plusieurs fois)
  sbClient.from('orders_incoming').select('*').eq('status', 'nouvelle').order('created_at', { ascending: true })
    .then(function(res){
      if(res && res.data){
        incomingOrders = res.data;
        renderIncomingOrders();
      }
    });
  incomingChannel = sbClient.channel('orders-live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders_incoming' }, function(payload){
      var alreadyThere = incomingOrders.some(function(o){ return o.id === payload.new.id; });
      if(!alreadyThere){
        incomingOrders.push(payload.new);
        renderIncomingOrders();
        t('Nouvelle commande recue !');
      }
    })
    .subscribe();
}


function showAdminLoginForm(){
  var wrap = document.getElementById('incoming-wrap');
  var login = document.getElementById('incoming-login');
  if(wrap) wrap.style.display = 'none';
  if(login) login.style.display = 'block';
}
function showLoggedInBar(email){
  var login = document.getElementById('incoming-login');
  var bar = document.getElementById('admin-session-bar');
  if(login) login.style.display = 'none';
  if(bar){ bar.style.display = 'flex'; document.getElementById('admin-email').innerText = email; }
}
function hideLoggedInBar(){
  var bar = document.getElementById('admin-session-bar');
  if(bar) bar.style.display = 'none';
}
function adminLogin(e){
  e.preventDefault();
  var email = document.getElementById('admin-email-input').value.trim();
  var pass = document.getElementById('admin-pass-input').value;
  if(!sbReady){ t('Supabase non configure'); return; }
  sbClient.auth.signInWithPassword({ email: email, password: pass }).then(function(res){
    if(res.error){ t('Connexion echouee : verifiez vos identifiants'); return; }
    t('Connecte !');
  });
}
function adminLogout(){
  if(sbReady) sbClient.auth.signOut();
}

function renderIncomingOrders(){
  var wrap = document.getElementById('incoming-wrap');
  var list = document.getElementById('incoming-orders');
  var badge = document.getElementById('cmd-badge');
  if(!wrap || !list) return;
  if(incomingOrders.length === 0){
    wrap.style.display = 'none';
    if(badge) badge.style.display = 'none';
    return;
  }
  wrap.style.display = 'block';
  if(badge){ badge.style.display = 'block'; badge.innerText = incomingOrders.length; }
  list.innerHTML = incomingOrders.map(function(o, i){
    var d = o.payload || {};
    var when = o.created_at ? new Date(o.created_at).toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'}) : '';
    return '<div class="ci"><div class="cin"><div class="nn">' + escHtml(d.name||'Client') + ' — ' + fmt(d.total||0) + '</div><div class="pp">' + when + '</div></div>' +
      '<button class="bok bs2" onclick="importIncomingOrder(' + i + ')">Importer</button> ' +
      '<button class="be bs2" onclick="dismissIncomingOrder(' + i + ')">✕</button></div>';
  }).join('');
}

function importIncomingOrder(i){
  var o = incomingOrders[i];
  if(!o) return;
  fillOrderFromScan(o.payload || {});
  markIncomingOrder(o.id, 'traitee');
  incomingOrders.splice(i, 1);
  renderIncomingOrders();
  t('Commande importee');
}
function dismissIncomingOrder(i){
  var o = incomingOrders[i];
  if(!o) return;
  markIncomingOrder(o.id, 'ignoree');
  incomingOrders.splice(i, 1);
  renderIncomingOrders();
}
function markIncomingOrder(id, status){
  if(!sbReady || !id) return;
  sbClient.from('orders_incoming').update({ status: status }).eq('id', id).then(function(res){
    if(res && res.error) console.error('Mise a jour Supabase echouee', res.error);
  });
}


// ===== SERVICE WORKER =====
try{
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('./sw.js').then(function(){
      var el = document.getElementById('sws');
      if(el) el.innerText = 'SW: Actif';
    }).catch(function(){
      var el = document.getElementById('sws');
      if(el) el.innerText = 'SW: Non disp.';
    });
  }
} catch(e) {}

// ===== INSTALL =====
var dp;
window.addEventListener('beforeinstallprompt', function(e){
  e.preventDefault();
  dp = e;
  var b = document.getElementById('ib');
  if(b) b.style.display = 'flex';
});
function ip(){
  if(dp){dp.prompt();dp.userChoice.then(function(){var b=document.getElementById('ib');if(b)b.style.display='none';dp=null;});}
}

// ===== DATABASE =====
var DBK = 'dbm_v2';
var db;
function ldb(){
  var r = localStorage.getItem(DBK);
  if(r){db = JSON.parse(r); mdb();} else {idb();}
}
function idb(){
  db = {
    config: {currency: "FC", defaultCom: 500, reinvestRate: 30, goalOrders: 500, goalRevenue: 1500000, whatsapp: ''},
    products: [
      {id: uid(), name: "Classic Burger", price: 3000, cost: 1500, category: "burger", available: true, emoji: "🍔"},
      {id: uid(), name: "Cheese Burger", price: 3500, cost: 1800, category: "burger", available: true, emoji: "🧀"},
      {id: uid(), name: "Double Burger", price: 4500, cost: 2200, category: "burger", available: true, emoji: "🥩"},
      {id: uid(), name: "Coca 33cl", price: 800, cost: 400, category: "drink", available: true, emoji: "🥤"},
      {id: uid(), name: "Frites Moyennes", price: 1000, cost: 300, category: "fries", available: true, emoji: "🍟"},
      {id: uid(), name: "Frites Grandes", price: 1500, cost: 450, category: "fries", available: true, emoji: "🍟"},
      {id: uid(), name: "Eau minerale", price: 500, cost: 200, category: "drink", available: true, emoji: "💧"}
    ],
    ambassadors: [], clients: [], orders: [],
    stocks: [
      {id: uid(), name: "Pains", qty: 50, min: 10, unit: "piece", cost: 100},
      {id: uid(), name: "Steaks", qty: 40, min: 10, unit: "piece", cost: 500},
      {id: uid(), name: "Fromage", qty: 30, min: 5, unit: "tranche", cost: 150},
      {id: uid(), name: "Tomates", qty: 5, min: 2, unit: "kg", cost: 2000},
      {id: uid(), name: "Coca", qty: 24, min: 6, unit: "bouteille", cost: 350},
      {id: uid(), name: "Pommes de terre", qty: 20, min: 5, unit: "kg", cost: 800},
      {id: uid(), name: "Emballages", qty: 100, min: 20, unit: "piece", cost: 50}
    ],
    expenses: [], goals: []
  };
  sdb();
}
function mdb(){
  if(!db.config) db.config = {currency: "FC", defaultCom: 500, reinvestRate: 30, goalOrders: 500, goalRevenue: 1500000, whatsapp: ''};
  if(!db.clients) db.clients = [];
  if(!db.expenses) db.expenses = [];
  if(!db.goals) db.goals = [];
  if(!db.config.whatsapp) db.config.whatsapp = '';
  if(!db.config.goalOrders) db.config.goalOrders = 500;
  if(!db.config.goalRevenue) db.config.goalRevenue = 1500000;
  db.products.forEach(function(p){ if(!p.emoji) p.emoji = ge(p.category); });
  sdb();
}
function sdb(){ localStorage.setItem(DBK, JSON.stringify(db)); }
function cad(){ if(confirm('Tout effacer ?')){ localStorage.removeItem(DBK); localStorage.removeItem('db_demo'); location.reload(); } }
function ge(c){ var m = {burger:'🍔', drink:'🥤', fries:'🍟', other:'🍽️'}; return m[c] || '🍽️'; }

// ===== UTILS =====
function fmt(n){ return Number(n || 0).toLocaleString('fr-FR') + ' ' + db.config.currency; }
function fmtN(n){ return Number(n || 0).toLocaleString('fr-FR'); }
function ts(){ return new Date().toISOString().split('T')[0]; }
function it(d){ return d && d.split('T')[0] === ts(); }
function iw2(d){ if(!d) return false; var dt = new Date(d); var n = new Date(); var diff = (n - dt) / (1000*60*60*24); return diff >= 0 && diff < 7; }
function im(d){ if(!d) return false; var dt = new Date(d); var n = new Date(); return dt.getMonth() === n.getMonth() && dt.getFullYear() === n.getFullYear(); }
function uid(){ return Date.now().toString(36) + Math.random().toString(36).substr(2, 5); }
function escHtml(str){ return String(str==null?'':str).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function t(msg){
  var el = document.getElementById('tst');
  if(!el) return;
  el.innerText = msg; el.classList.add('s');
  setTimeout(function(){ el.classList.remove('s'); }, 2500);
}

// ===== CLIENT MODE =====
var ccart = [];
var cot = 'emporter';
var ccf = 'all';

function scp(id){
  document.querySelectorAll('.cs').forEach(function(s){ s.classList.remove('a'); });
  document.querySelectorAll('.cn button').forEach(function(b){ b.classList.remove('a'); });
  document.getElementById('cs-' + id).classList.add('a');
  var btn = document.getElementById('cn-' + id);
  if(btn) btn.classList.add('a');
  window.scrollTo(0, 0);
  if(id === 'menu') rcm();
  if(id === 'cart') rcc();
}

function fcm(cat, btn){
  ccf = cat;
  document.querySelectorAll('#ccf button').forEach(function(b){ b.classList.remove('a'); });
  if(btn) btn.classList.add('a');
  rcm();
}

function rcm(){
  var g = document.getElementById('cp');
  var prods = db.products.filter(function(p){ return p.available; });
  if(ccf !== 'all') prods = prods.filter(function(p){ return p.category === ccf; });
  if(prods.length === 0){ g.innerHTML = '<div class="es" style="grid-column:1/-1"><div class="i">🍽️</div><p>Aucun produit</p></div>'; return; }
  g.innerHTML = prods.map(function(p){
    var inc = ccart.find(function(c){ return c.id === p.id; });
    var q = inc ? inc.qty : 0;
    var pic = p.photo ? '<img src="'+p.photo+'" alt="" style="width:100%;height:100%;object-fit:cover">' : (p.emoji || '🍽️');
    return '<div class="pc"><div class="pi">' + pic + '</div><div class="pn"><div class="n">' + escHtml(p.name) + '</div><div class="d">' + escHtml(p.category) + '</div><div class="pr">' + fmt(p.price) + '</div><div class="pa"><button class="qb" onclick="ucc(\'' + p.id + '\',-1)">−</button><span class="qv">' + q + '</span><button class="qb" onclick="ucc(\'' + p.id + '\',1)">+</button></div></div></div>';
  }).join('');
}

var pendingAddPid = null;
function ucc(pid, delta){
  var prod = db.products.find(function(p){ return p.id === pid; });
  if(!prod) return;
  var idx = ccart.findIndex(function(c){ return c.id === pid; });
  var wasEmpty = (idx < 0);
  if(idx >= 0){
    ccart[idx].qty += delta;
    if(ccart[idx].qty <= 0) ccart.splice(idx, 1);
  } else if(delta > 0){
    ccart.push({id: prod.id, name: prod.name, price: prod.price, cost: prod.cost, qty: 1});
  }
  ucb();
  rcm();
  if(document.getElementById('cs-cart').classList.contains('a')) rcc();
  if(wasEmpty && delta > 0){
    pendingAddPid = pid;
    document.getElementById('moadd').classList.add('a');
  }
}
function continueShoppingChoice(){
  cm('moadd');
  pendingAddPid = null;
}
function checkoutNowChoice(){
  cm('moadd');
  pendingAddPid = null;
  scp('cart');
}

function ucb(){
  var b = document.getElementById('cb');
  var t = ccart.reduce(function(s, c){ return s + c.qty; }, 0);
  if(t > 0){ b.style.display = 'block'; b.innerText = t; }
  else { b.style.display = 'none'; }
}

function rcc(){
  var c = document.getElementById('cci');
  var t = document.getElementById('cct');
  var e = document.getElementById('cce');
  var f = document.getElementById('cof');
  var q = document.getElementById('cqr');
  if(ccart.length === 0){
    c.innerHTML = ''; t.style.display = 'none'; e.style.display = 'block'; f.style.display = 'none'; q.style.display = 'none'; return;
  }
  e.style.display = 'none'; t.style.display = 'block'; f.style.display = 'flex'; q.style.display = 'none';
  c.innerHTML = ccart.map(function(it){
    var em = db.products.find(function(p){ return p.id === it.id; });
    var pic = em && em.photo ? '<img src="'+em.photo+'" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:10px">' : (em ? em.emoji : '🍽️');
    return '<div class="ci"><div class="cii">' + pic + '</div><div class="cin"><div class="nn">' + escHtml(it.name) + '</div><div class="pp">' + fmt(it.price) + ' x ' + it.qty + ' = ' + fmt(it.price * it.qty) + '</div></div><div class="pa"><button class="qb" onclick="ucc(\'' + it.id + '\',-1)">−</button><span class="qv">' + it.qty + '</span><button class="qb" onclick="ucc(\'' + it.id + '\',1)">+</button></div></div>';
  }).join('');
  var tot = ccart.reduce(function(s, c){ return s + c.price * c.qty; }, 0);
  document.getElementById('cta').innerText = fmt(tot);
}

function sot(btn, type){
  cot = type;
  document.querySelectorAll('#cof .rb').forEach(function(b){ b.classList.remove('a'); });
  btn.classList.add('a');
  var a = document.getElementById('co-a');
  if(type === 'surplace') a.placeholder = 'Numero de table';
  else if(type === 'emporter') a.placeholder = 'Telephone (confirmation)';
  else a.placeholder = 'Adresse de livraison';
}

function bco(){
  var tot = ccart.reduce(function(s, c){ return s + c.price * c.qty; }, 0);
  return {
    items: ccart.map(function(c){ return {name: c.name, price: c.price, qty: c.qty}; }),
    total: tot, orderType: cot,
    name: document.getElementById('co-n').value.trim(),
    phone: document.getElementById('co-p').value.trim(),
    address: document.getElementById('co-a').value.trim(),
    notes: document.getElementById('co-nt').value.trim(),
    ambassadorCode: document.getElementById('co-am').value.trim().toUpperCase(),
    timestamp: new Date().toISOString()
  };
}

function submitOrder(){
  var name = document.getElementById('co-n').value.trim();
  var phone = document.getElementById('co-p').value.trim();
  if(!name || !phone){ t('Remplissez nom et telephone'); return; }
  if(ccart.length === 0){ t('Panier vide'); return; }
  if(!document.getElementById('co-consent').checked){ t("Merci d'accepter les conditions d'utilisation"); return; }
  var data = bco();

  var json = JSON.stringify(data);
  var b64 = btoa(unescape(encodeURIComponent(json)));
  var qrd = document.getElementById('cqr');
  var qri = document.getElementById('cqri');
  qri.innerHTML = '';
  qrd.style.display = 'block';
  // Generation locale du QR (aucun service externe, fonctionne hors-ligne)
  // Sert de preuve visuelle pour le gerant a la recuperation de la commande
  try{
    new QRCode(qri, { text: b64, width: 200, height: 200, colorDark: "#000000", colorLight: "#ffffff" });
    var qimg = qri.querySelector('img'); if(qimg) qimg.alt = 'QR code de la commande';
  } catch(e){
    qri.innerHTML = '<div style="padding:20px;background:#fff;color:#000;border-radius:12px;font-family:monospace;font-size:12px;word-break:break-all;max-width:280px">' + b64 + '</div>';
  }
  t('Commande enregistree ! Montrez le QR au gerant.');

  // La synchronisation en direct est un bonus : le QR ci-dessus reste valable meme si elle echoue
  pushOrderToCloud(data).then(function(res){
    if(!res || !res.ok){
      t('⚠️ Synchro en direct indisponible, mais votre QR reste valable');
    }
  });

  sendOrderNotification(data);
}

function contactWhatsApp(){
  var waNum = (db.config.whatsapp || '').replace(/[^0-9]/g, '');
  if(!waNum){ t('WhatsApp non configure'); return; }
  var msg = "Bonjour Dinner Burger, j'ai une question !";
  window.open("https://wa.me/" + waNum + "?text=" + encodeURIComponent(msg), '_blank');
}

function openTerms(){
  document.getElementById('moterms').classList.add('a');
}


// ===== STUBS & MISSING FUNCTIONS (mode gerant) =====
// Ces fonctions evitent les ReferenceError.
// Tu dois les reimplémenter avec ta logique metier.

function cm(id){ document.getElementById(id).classList.remove('a'); }

document.addEventListener('keydown', function(e){
  if(e.key === 'Escape'){
    if(document.getElementById('mos').classList.contains('a')) stopQrScanner();
    document.querySelectorAll('.mo.a').forEach(function(m){ m.classList.remove('a'); });
  }
});

function sp(id){
  document.querySelectorAll('.sc').forEach(function(s){ s.classList.remove('a'); });
  document.querySelectorAll('.mn button').forEach(function(b){ b.classList.remove('a'); });
  var sec = document.getElementById('s-'+id);
  if(sec) sec.classList.add('a');
  var btn = document.getElementById('n-'+id);
  if(btn) btn.classList.add('a');
  window.scrollTo(0,0);
  // Re-render specifique selon la page
  if(id==='dash') rd();
  if(id==='cmd'){ roc(); roc2(); rcl(); }
  if(id==='menu') rml();
  if(id==='amb'){ ral(); rpa(); }
  if(id==='clients') rctl();
  if(id==='stock'){ rsl(); rms(); }
  if(id==='finance'){ rf(); re(); }
  if(id==='analyse') ra();
  if(id==='goals') rgl();
  if(id==='sim') rs();
  if(id==='settings') rse();
}

function scp2(p,btn){
  document.querySelectorAll('#s-dash .fb button').forEach(function(b){ b.classList.remove('a'); });
  if(btn) btn.classList.add('a');
  rd(p);
}

function ho(e){
  e.preventDefault();
  var cid = document.getElementById('oc').value;
  var cname = document.getElementById('ocn').value.trim();
  var cphone = document.getElementById('ocp').value.trim();
  var pm = document.getElementById('opm').value;
  var amb = document.getElementById('oa').value;

  if(!cid && !cname){ t('Nom client requis'); return; }

  var items = [];
  var rows = document.querySelectorAll('#ois .oi');
  var tot = 0, cst = 0;
  for(var i=0;i<rows.length;i++){
    var sel = rows[i].querySelector('.op');
    var qin = rows[i].querySelector('.oq');
    if(!sel || !sel.value) continue;
    var prod = db.products.find(function(p){ return p.id === sel.value; });
    if(!prod) continue;
    var q = parseInt(qin.value)||1;
    items.push({id:prod.id, name:prod.name, price:prod.price, cost:prod.cost, qty:q});
    tot += prod.price * q;
    cst += prod.cost * q;
  }
  if(items.length===0){ t('Ajoutez au moins un produit'); return; }

  var client = null;
  if(cid){
    client = db.clients.find(function(c){ return c.id === cid; });
  } else {
    client = {id:uid(), name:cname, phone:cphone, orders:0, total:0, firstOrder: new Date().toISOString(), lastOrder:'', ambassador:''};
    db.clients.push(client);
  }

  var isNew = !client.lastOrder;
  var order = {
    id: uid(), clientId: client.id, clientName: client.name,
    items: items, total: tot, cost: cst, profit: tot-cst,
    payment: pm, ambassador: amb, date: new Date().toISOString(),
    isNewClient: isNew
  };
  db.orders.push(order);

  client.orders++; client.total += tot; client.lastOrder = order.date;
  if(amb){
    var a = db.ambassadors.find(function(x){ return x.id === amb; });
    if(a){ if(isNew){ a.newClients++; } a.revenue += tot; a.commission += (isNew ? db.config.defaultCom : 0); }
  }

  sdb();
  t('Commande enregistree !');
  document.getElementById('of').reset();
  document.getElementById('ncf').style.display = 'block';
  roc(); roc2(); rcl(); rd();
}

function tnc(v){
  var ncf = document.getElementById('ncf');
  if(v===''){ ncf.style.display='block'; document.getElementById('ocn').value=''; document.getElementById('ocp').value=''; }
  else { ncf.style.display='none'; var c=db.clients.find(function(x){return x.id===v}); if(c){ document.getElementById('ocn').value=c.name; document.getElementById('ocp').value=c.phone||''; } }
}

function uot(){
  var rows = document.querySelectorAll('#ois .oi');
  var tot=0, cst=0;
  for(var i=0;i<rows.length;i++){
    var sel=rows[i].querySelector('.op');
    var qin=rows[i].querySelector('.oq');
    if(sel && sel.value){
      var p=db.products.find(function(x){return x.id===sel.value});
      if(p){ var q=parseInt(qin.value)||1; tot+=p.price*q; cst+=p.cost*q; }
    }
  }
  document.getElementById('otp').innerText=fmt(tot);
  document.getElementById('ocp2').innerText=fmt(cst);
  document.getElementById('opr').innerText=fmt(tot-cst);
}

function roi(btn){ var row=btn.closest('.oi'); if(row){ row.remove(); uot(); } }

function aoi(){
  var c=document.getElementById('ois');
  var d=document.createElement('div'); d.className='oi';
  var opts='<option value="">Choisir</option>'+db.products.filter(function(p){return p.available}).map(function(p){return '<option value="'+p.id+'">'+escHtml(p.name)+' ('+fmt(p.price)+')</option>'}).join('');
  d.innerHTML='<select class="op" onchange="uot()" required>'+opts+'</select><input type="number" class="oq" value="1" min="1" onchange="uot()"><button type="button" class="be bs2" onclick="roi(this)">✕</button>';
  c.appendChild(d);
}

function os(){
  document.getElementById('mos').classList.add('a');
  startQrScanner();
}
function closeScannerModal(){
  stopQrScanner();
  cm('mos');
}
var html5QrScanner = null;
function startQrScanner(){
  var container = document.getElementById('sc2-container');
  if(typeof Html5Qrcode === 'undefined'){
    container.innerHTML = '<p style="color:var(--t2);padding:20px;text-align:center">Scanner indisponible (bibliotheque non chargee). Verifiez votre connexion et reessayez.</p>';
    return;
  }
  container.innerHTML = '<div id="qr-reader" style="width:100%"></div>';
  html5QrScanner = new Html5Qrcode("qr-reader");
  html5QrScanner.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: 220 },
    onQrScanSuccess,
    function(){ /* erreurs de lecture par frame, on ignore et on continue */ }
  ).catch(function(err){
    container.innerHTML = '<p style="color:var(--t2);padding:20px;text-align:center">Camera indisponible. Verifiez que vous avez autorise l\'acces a la camera dans votre navigateur.</p>';
    console.error('Camera error', err);
  });
}
function stopQrScanner(){
  if(html5QrScanner){
    html5QrScanner.stop().then(function(){
      html5QrScanner.clear();
      html5QrScanner = null;
    }).catch(function(){ html5QrScanner = null; });
  }
}
function onQrScanSuccess(decodedText){
  stopQrScanner();
  try{
    var json = decodeURIComponent(escape(atob(decodedText)));
    var data = JSON.parse(json);
    fillOrderFromScan(data);
    cm('mos');
    t('Commande importee du QR !');
  } catch(e){
    t('QR invalide ou illisible');
    console.error('QR decode error', e);
  }
}
function fillOrderFromScan(data){
  sp('cmd');
  document.getElementById('oc').value = '';
  tnc('');
  document.getElementById('ocn').value = data.name || '';
  document.getElementById('ocp').value = data.phone || '';

  var container = document.getElementById('ois');
  container.innerHTML = '';
  (data.items || []).forEach(function(it){
    var prod = db.products.find(function(p){ return p.name.toLowerCase() === (it.name||'').toLowerCase(); });
    var row = document.createElement('div'); row.className = 'oi';
    var opts = '<option value="">Choisir</option>' + db.products.filter(function(p){return p.available}).map(function(p){
      return '<option value="'+p.id+'"'+(prod && prod.id===p.id ? ' selected':'')+'>'+escHtml(p.name)+' ('+fmt(p.price)+')</option>';
    }).join('');
    row.innerHTML = '<select class="op" onchange="uot()" required>'+opts+'</select><input type="number" class="oq" value="'+(it.qty||1)+'" min="1" onchange="uot()"><button type="button" class="be bs2" onclick="roi(this)">✕</button>';
    container.appendChild(row);
  });
  if(container.children.length === 0){ aoi(); }

  var oaw = document.getElementById('oaw');
  if(data.ambassadorCode){
    var amb = db.ambassadors.find(function(a){ return a.code === data.ambassadorCode; });
    if(amb){ document.getElementById('oa').value = amb.id; oaw.style.display='none'; }
    else { oaw.style.display='block'; oaw.innerText = 'Code ambassadeur inconnu : ' + data.ambassadorCode; }
  } else {
    oaw.style.display = 'none';
  }
  uot();
}
function iw(){ t('Import WhatsApp non configure'); }

function fo(f,btn){
  document.querySelectorAll('#s-cmd .fb button').forEach(function(b){b.classList.remove('a');});
  if(btn) btn.classList.add('a');
  rcl(f);
}

var pendingPhotoData; // undefined = pas de changement demande, null = retirer, string = nouvelle photo

function resizeImage(file, maxDim, quality, callback){
  var reader = new FileReader();
  reader.onload = function(e){
    var img = new Image();
    img.onload = function(){
      var w = img.width, h = img.height;
      if(w > h){ if(w > maxDim){ h = Math.round(h * maxDim / w); w = maxDim; } }
      else { if(h > maxDim){ w = Math.round(w * maxDim / h); h = maxDim; } }
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      callback(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = function(){ t('Image illisible'); };
    img.src = e.target.result;
  };
  reader.onerror = function(){ t('Lecture du fichier echouee'); };
  reader.readAsDataURL(file);
}

function onPhotoSelected(input){
  var file = input.files && input.files[0];
  if(!file) return;
  if(!file.type.startsWith('image/')){ t('Merci de choisir une image'); return; }
  resizeImage(file, 600, 0.75, function(dataUrl){
    pendingPhotoData = dataUrl;
    var prev = document.getElementById('pphoto-preview');
    prev.src = dataUrl;
    prev.style.display = 'block';
    document.getElementById('pphoto-remove').style.display = 'inline-block';
  });
}
function removePhoto(){
  pendingPhotoData = null;
  document.getElementById('pphoto').value = '';
  document.getElementById('pphoto-preview').style.display = 'none';
  document.getElementById('pphoto-remove').style.display = 'none';
}

function hp(e){
  e.preventDefault();
  var id=document.getElementById('pid').value;
  var name=document.getElementById('pn').value.trim();
  var cat=document.getElementById('pc').value;
  var price=parseFloat(document.getElementById('pp').value)||0;
  var cost=parseFloat(document.getElementById('pco').value)||0;
  var av=document.getElementById('pav').checked;
  if(!name){t('Nom requis');return;}
  if(id){
    var p=db.products.find(function(x){return x.id===id});
    if(p){
      p.name=name;p.category=cat;p.price=price;p.cost=cost;p.available=av;
      if(pendingPhotoData !== undefined) p.photo = pendingPhotoData;
    }
  } else {
    db.products.push({id:uid(),name:name,category:cat,price:price,cost:cost,available:av,emoji:ge(cat),photo: pendingPhotoData !== undefined ? pendingPhotoData : null});
  }
  try{
    sdb();
  } catch(err){
    t('Stockage plein : essaie une photo plus legere ou retire une ancienne photo');
    console.error(err);
    return;
  }
  rml(); t('Produit sauvegarde'); rpf();
}

function rpf(){
  document.getElementById('pf').reset();
  document.getElementById('pid').value='';
  document.getElementById('pca').style.display='none';
  pendingPhotoData = undefined;
  document.getElementById('pphoto-preview').style.display='none';
  document.getElementById('pphoto-remove').style.display='none';
}

function fp(c,btn){
  document.querySelectorAll('#s-menu .fb button').forEach(function(b){b.classList.remove('a');});
  if(btn) btn.classList.add('a');
  rml(c);
}

function ha(e){
  e.preventDefault();
  var n=document.getElementById('an').value.trim();
  var c=document.getElementById('ac').value.trim().toUpperCase();
  var ph=document.getElementById('aph').value.trim();
  if(!n||!c){t('Nom et code requis');return;}
  if(db.ambassadors.find(function(a){return a.code===c})){t('Code deja utilise');return;}
  db.ambassadors.push({id:uid(),name:n,code:c,phone:ph,newClients:0,revenue:0,commission:0,paid:0});
  sdb(); ral(); rpa(); t('Ambassadeur cree');
  document.getElementById('af').reset();
}

function hcp(e){
  e.preventDefault();
  var id=document.getElementById('pa').value;
  var m=parseFloat(document.getElementById('pam').value)||0;
  var a=db.ambassadors.find(function(x){return x.id===id});
  if(!a){t('Selectionnez un ambassadeur');return;}
  a.paid+=m; sdb(); ral(); t('Paiement enregistre');
}

function hs(e){
  e.preventDefault();
  var id=document.getElementById('sid').value;
  var n=document.getElementById('sn').value.trim();
  var u=document.getElementById('su').value.trim()||'piece';
  var q=parseFloat(document.getElementById('sq').value)||0;
  var m=parseFloat(document.getElementById('sm').value)||0;
  var c=parseFloat(document.getElementById('sc2').value)||0;
  if(!n){t('Nom requis');return;}
  if(id){var s=db.stocks.find(function(x){return x.id===id}); if(s){s.name=n;s.unit=u;s.qty=q;s.min=m;s.cost=c;}}
  else {db.stocks.push({id:uid(),name:n,unit:u,qty:q,min:m,cost:c});}
  sdb(); rsl(); rms(); t('Stock mis a jour'); document.getElementById('sf').reset(); document.getElementById('sid').value='';
}

function hsm(e){
  e.preventDefault();
  var id=document.getElementById('ms').value;
  var type=document.getElementById('mt').value;
  var q=parseFloat(document.getElementById('mq').value)||0;
  var s=db.stocks.find(function(x){return x.id===id});
  if(!s){t('Selectionnez un article');return;}
  if(type==='in') s.qty+=q;
  else {
    if(q > s.qty){
      t('⚠️ Quantite superieure au stock disponible (' + s.qty + ' ' + s.unit + ') — stock mis a 0');
      s.qty = 0;
    } else {
      s.qty -= q;
    }
  }
  sdb(); rsl(); t('Mouvement enregistre');
}

function he(e){
  e.preventDefault();
  var d=document.getElementById('ed').value;
  var c=document.getElementById('ec').value;
  var a=parseFloat(document.getElementById('ea').value)||0;
  var de=document.getElementById('ed2').value.trim();
  if(!d||!c){t('Date et categorie requises');return;}
  db.expenses.push({id:uid(),date:d,category:c,amount:a,desc:de});
  sdb(); re(); rf(); t('Depense enregistree'); document.getElementById('ef').reset();
}

function hg(e){
  e.preventDefault();
  var t2=document.getElementById('gt').value.trim();
  var ty=document.getElementById('gty').value;
  var ta=parseFloat(document.getElementById('gta').value)||0;
  var dl=document.getElementById('gdl').value;
  if(!t2||!ty){t('Titre et type requis');return;}
  db.goals.push({id:uid(),title:t2,type:ty,target:ta,deadline:dl,current:0});
  sdb(); rgl(); t('Objectif cree'); document.getElementById('gf').reset();
}

function numOr(value, fallback){
  var n = parseFloat(value);
  return isNaN(n) ? fallback : n;
}
function hse(e){
  e.preventDefault();
  db.config.currency=document.getElementById('cfg-c').value.trim()||'FC';
  db.config.defaultCom=numOr(document.getElementById('cfg-co').value, 500);
  db.config.reinvestRate=numOr(document.getElementById('cfg-r').value, 30);
  db.config.goalOrders=numOr(document.getElementById('cfg-go').value, 500);
  db.config.goalRevenue=numOr(document.getElementById('cfg-gr').value, 1500000);
  db.config.whatsapp=document.getElementById('cfg-wa').value.trim();
  sdb(); t('Configuration sauvegardee'); rse();
}

function rs(){
  var a=parseInt(document.getElementById('s1').value)||0;
  var cj=parseInt(document.getElementById('s2').value)||0;
  var pa=parseInt(document.getElementById('s3').value)||0;
  var co=parseInt(document.getElementById('s4').value)||0;
  var com=parseInt(document.getElementById('s5').value)||0;
  var j=parseInt(document.getElementById('s6').value)||26;
  var ri=parseInt(document.getElementById('s7').value)||30;
  document.getElementById('sv1').innerText=a;
  document.getElementById('sv2').innerText=cj;
  document.getElementById('sv3').innerText=pa;
  document.getElementById('sv4').innerText=co;
  document.getElementById('sv5').innerText=com;
  document.getElementById('sv6').innerText=j;
  document.getElementById('sv7').innerText=ri;
  var scenarios=[{id:'p',mul:0.8},{id:'r',mul:1},{id:'a',mul:1.2}];
  scenarios.forEach(function(sc){
    var cmd=Math.round(a*cj*j*sc.mul);
    var rev=cmd*pa;
    var costs=cmd*co;
    var comm=cmd*com;
    var b1=rev-costs-comm;
    var b2=Math.round(b1*(100-ri)/100);
    document.getElementById('s'+sc.id+'-c').innerText=fmtN(cmd);
    document.getElementById('s'+sc.id+'-r').innerText=fmt(rev);
    document.getElementById('s'+sc.id+'-co').innerText=fmt(costs);
    document.getElementById('s'+sc.id+'-cm').innerText=fmt(comm);
    document.getElementById('s'+sc.id+'-b1').innerText=fmt(b1);
    document.getElementById('s'+sc.id+'-b2').innerText=fmt(b2);
  });
}

function rc(){
  var q=document.getElementById('cs2').value.trim().toLowerCase();
  rctl(q);
}

function ldd(){
  if(!confirm('Charger les donnees de demonstration ?')) return;
  localStorage.setItem('db_demo','1');
  document.getElementById('dmb').style.display='block';
  // Generer donnees demo
  var names=['Jean','Marie','Paul','Sophie','Pierre','Claire','Marc','Aline'];
  var prods=db.products;
  for(var i=0;i<50;i++){
    var cid=uid();
    var c={id:cid,name:names[Math.floor(Math.random()*names.length)]+' '+(i+1),phone:'08'+Math.floor(Math.random()*10000000),orders:0,total:0,firstOrder:new Date(Date.now()-Math.random()*30*86400000).toISOString(),lastOrder:'',ambassador:''};
    db.clients.push(c);
    var items=[]; var tot=0; var cst=0;
    var ni=1+Math.floor(Math.random()*3);
    for(var j=0;j<ni;j++){
      var p=prods[Math.floor(Math.random()*prods.length)];
      var q=1+Math.floor(Math.random()*2);
      items.push({id:p.id,name:p.name,price:p.price,cost:p.cost,qty:q});
      tot+=p.price*q; cst+=p.cost*q;
    }
    var o={id:uid(),clientId:cid,clientName:c.name,items:items,total:tot,cost:cst,profit:tot-cst,payment:['cash','mobile','card'][Math.floor(Math.random()*3)],ambassador:'',date:new Date(Date.now()-Math.random()*30*86400000).toISOString(),isNewClient:true};
    db.orders.push(o);
    c.orders=1; c.total=tot; c.lastOrder=o.date;
  }
  sdb(); rd(); rcl(); rctl(); ral(); rsl(); re(); rf(); ra(); rgl(); t('Demo chargee');
}

function ccl(){
  var el=document.getElementById('cl2');
  if(el){ el.select(); document.execCommand('copy'); t('Lien copie !'); }
}

// ===== RENDER FUNCTIONS (stubs completes) =====
function rd(period){
  period=period||'day';
  var today=db.orders.filter(function(o){return it(o.date)});
  var week=db.orders.filter(function(o){return iw2(o.date)});
  var month=db.orders.filter(function(o){return im(o.date)});
  var scope=(period==='week'?week:(period==='month'?month:today));

  var ca=scope.reduce(function(s,o){return s+o.total},0);
  var ben=scope.reduce(function(s,o){return s+o.profit},0);
  var com=scope.reduce(function(s,o){return s+(o.isNewClient?db.config.defaultCom:0)},0);

  document.getElementById('d-ca').innerText=fmt(ca);
  document.getElementById('d-ben').innerText=fmt(ben);
  document.getElementById('d-cmd').innerText=scope.length;
  document.getElementById('d-cs').innerText=(period==='day'?'Auj.':period==='week'?'Semaine':'Mois');
  document.getElementById('d-com').innerText=fmt(com);

  var newC=scope.filter(function(o){return o.isNewClient}).length;
  var oldC=scope.length-newC;
  document.getElementById('d-new').innerText=newC;
  document.getElementById('d-old').innerText=oldC;

  // Alerts
  var al=document.getElementById('alerts'); al.innerHTML='';
  db.stocks.filter(function(s){return s.qty<=s.min}).forEach(function(s){
    al.innerHTML+='<div class="al">Stock bas: '+escHtml(s.name)+' ('+s.qty+' '+escHtml(s.unit)+')</div>';
  });

  // Chart
  var ctx=document.getElementById('c1'); if(!ctx)return;
  var labels=[],data=[];
  if(period==='day'){
    for(var h=8;h<=22;h++){ labels.push(h+'h'); data.push(0); }
    scope.forEach(function(o){var d=new Date(o.date); var hr=d.getHours(); if(hr>=8&&hr<=22)data[hr-8]+=o.total;});
  } else if(period==='week'){
    var days=['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
    for(var i=0;i<7;i++){ labels.push(days[i]); data.push(0); }
    scope.forEach(function(o){var d=new Date(o.date); data[d.getDay()]+=o.total;});
  } else {
    for(var i=1;i<=31;i++){ labels.push(i); data.push(0); }
    scope.forEach(function(o){var d=new Date(o.date); data[d.getDate()-1]+=o.total;});
  }
  if(window.evChart) window.evChart.destroy();
  window.evChart=new Chart(ctx,{type:'bar',data:{labels:labels,datasets:[{label:'CA',data:data,borderColor:'#c70102',backgroundColor:'rgba(199,1,2,0.3)',borderWidth:2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{grid:{color:'#2a2a2a'}},x:{grid:{display:false}}}}});
}

function roc(){
  var sel=document.getElementById('oc'); sel.innerHTML='<option value="">-- Nouveau --</option>';
  db.clients.forEach(function(c){ sel.innerHTML+='<option value="'+c.id+'">'+escHtml(c.name)+' ('+escHtml(c.phone||'')+')</option>'; });
}
function roc2(){
  var sel=document.getElementById('oa'); sel.innerHTML='<option value="">Aucun</option>';
  db.ambassadors.forEach(function(a){ sel.innerHTML+='<option value="'+a.id+'">'+escHtml(a.code)+' - '+escHtml(a.name)+'</option>'; });
}
function rcl(filter){
  filter=filter||'all';
  var tbody=document.getElementById('cl'); tbody.innerHTML='';
  var list=db.orders.slice().reverse();
  if(filter==='today') list=list.filter(function(o){return it(o.date)});
  if(filter==='week') list=list.filter(function(o){return iw2(o.date)});
  list.forEach(function(o,i){
    var prods=o.items.map(function(it){return it.name+' x'+it.qty}).join(', ');
    tbody.innerHTML+='<tr><td>'+(i+1)+'</td><td>'+(o.date.split('T')[0])+'</td><td>'+escHtml(prods)+'</td><td>'+fmt(o.total)+'</td><td>'+fmt(o.profit)+'</td><td><button class="bs bs2" onclick="do2(\''+o.id+'\')">👁</button></td></tr>';
  });
}
function do2(id){
  var o=db.orders.find(function(x){return x.id===id}); if(!o)return;
  var h='<div class="sr"><span>Client:</span><strong>'+escHtml(o.clientName)+'</strong></div>';
  h+='<div class="sr"><span>Date:</span><span>'+o.date.split('T')[0]+' '+o.date.split('T')[1].substr(0,5)+'</span></div>';
  h+='<div class="sr"><span>Total:</span><strong>'+fmt(o.total)+'</strong></div>';
  h+='<div class="sr"><span>Benefice:</span><span>'+fmt(o.profit)+'</span></div>';
  h+='<div class="sr"><span>Paiement:</span><span>'+o.payment+'</span></div>';
  h+='<div class="sr"><span>Produits:</span></div><ul style="margin:0 0 10px 20px;font-size:.85rem">';
  o.items.forEach(function(it){h+='<li>'+escHtml(it.name)+' x'+it.qty+' = '+fmt(it.price*it.qty)+'</li>';});
  h+='</ul>';
  document.getElementById('mc').innerHTML=h;
  document.getElementById('mo').classList.add('a');
}

function rml(filter){
  filter=filter||'all';
  var tbody=document.getElementById('ml'); tbody.innerHTML='';
  var list=db.products;
  if(filter!=='all') list=list.filter(function(p){return p.category===filter});
  list.forEach(function(p){
    var st=p.available?'<span class="bd bds">Dispo</span>':'<span class="bd bde">Indispo</span>';
    var thumb = p.photo ? '<img src="'+p.photo+'" alt="" style="width:34px;height:34px;object-fit:cover;border-radius:6px;vertical-align:middle;margin-right:6px">' : '<span style="margin-right:6px">'+(p.emoji||'🍽️')+'</span>';
    tbody.innerHTML+='<tr><td>'+thumb+escHtml(p.name)+'</td><td>'+p.category+'</td><td>'+fmt(p.price)+'</td><td>'+fmt(p.cost)+'</td><td>'+fmt(p.price-p.cost)+'</td><td>'+st+'</td><td><button class="bs bs2" onclick="ep(\''+p.id+'\')">✎</button> <button class="be bs2" onclick="dp(\''+p.id+'\')">✕</button></td></tr>';
  });
}
function ep(id){
  var p=db.products.find(function(x){return x.id===id}); if(!p)return;
  document.getElementById('pid').value=p.id;
  document.getElementById('pn').value=p.name;
  document.getElementById('pc').value=p.category;
  document.getElementById('pp').value=p.price;
  document.getElementById('pco').value=p.cost;
  document.getElementById('pav').checked=p.available;
  document.getElementById('pca').style.display='inline-block';
  document.getElementById('pmp').innerText=fmt(p.price-p.cost);
  pendingPhotoData = undefined;
  document.getElementById('pphoto').value = '';
  var prev = document.getElementById('pphoto-preview');
  if(p.photo){
    prev.src = p.photo; prev.style.display='block';
    document.getElementById('pphoto-remove').style.display='inline-block';
  } else {
    prev.style.display='none';
    document.getElementById('pphoto-remove').style.display='none';
  }
}
function dp(id){
  if(!confirm('Supprimer ?'))return;
  db.products=db.products.filter(function(x){return x.id!==id});
  sdb(); rml(); t('Produit supprime');
}

function ral(){
  var tbody=document.getElementById('al2'); tbody.innerHTML='';
  db.ambassadors.forEach(function(a){
    var rest=a.commission-a.paid;
    tbody.innerHTML+='<tr><td>'+escHtml(a.code)+'</td><td>'+escHtml(a.name)+'</td><td>'+a.newClients+'</td><td>'+fmt(a.revenue)+'</td><td>'+fmt(a.commission)+'</td><td>'+fmt(a.paid)+'</td><td class="'+(rest>0?'kn':'kp')+'">'+fmt(rest)+'</td><td><button class="be bs2" onclick="da(\''+a.id+'\')">✕</button></td></tr>';
  });
}
function rpa(){
  var sel=document.getElementById('pa'); sel.innerHTML='<option value="">Choisir</option>';
  db.ambassadors.forEach(function(a){ sel.innerHTML+='<option value="'+a.id+'">'+escHtml(a.code)+' - '+escHtml(a.name)+' (Reste: '+fmt(a.commission-a.paid)+')</option>'; });
}
function da(id){ if(!confirm('Supprimer ?'))return; db.ambassadors=db.ambassadors.filter(function(x){return x.id!==id}); sdb(); ral(); rpa(); }

function rctl(q){
  var tbody=document.getElementById('ctl'); tbody.innerHTML='';
  var list=db.clients;
  if(q) list=list.filter(function(c){return (c.name+' '+(c.phone||'')).toLowerCase().indexOf(q)>=0});
  list.forEach(function(c){
    var type=c.orders===1?'Nouveau':c.orders>3?'VIP':'Recurrent';
    tbody.innerHTML+='<tr><td>'+c.id.substr(-4)+'</td><td>'+escHtml(c.name)+'</td><td>'+escHtml(c.phone||'')+'</td><td>'+c.orders+'</td><td>'+fmt(c.total)+'</td><td>'+(c.lastOrder?c.lastOrder.split('T')[0]:'-')+'</td><td>'+type+'</td><td>'+escHtml(c.ambassador||'')+'</td></tr>';
  });
}

function rsl(){
  var tbody=document.getElementById('sl'); tbody.innerHTML='';
  db.stocks.forEach(function(s){
    var alert=s.qty<=s.min?'kn':'kp';
    tbody.innerHTML+='<tr><td>'+escHtml(s.name)+'</td><td class="'+alert+'">'+s.qty+'</td><td>'+escHtml(s.unit)+'</td><td>'+s.min+'</td><td>'+fmt(s.cost)+'</td><td><button class="bs bs2" onclick="es2(\''+s.id+'\')">✎</button> <button class="be bs2" onclick="ds(\''+s.id+'\')">✕</button></td></tr>';
  });
}
function rms(){
  var sel=document.getElementById('ms'); sel.innerHTML='';
  db.stocks.forEach(function(s){ sel.innerHTML+='<option value="'+s.id+'">'+escHtml(s.name)+' ('+s.qty+' '+escHtml(s.unit)+')</option>'; });
}
function es2(id){
  var s=db.stocks.find(function(x){return x.id===id}); if(!s)return;
  document.getElementById('sid').value=s.id;
  document.getElementById('sn').value=s.name;
  document.getElementById('su').value=s.unit;
  document.getElementById('sq').value=s.qty;
  document.getElementById('sm').value=s.min;
  document.getElementById('sc2').value=s.cost;
}
function ds(id){ if(!confirm('Supprimer ?'))return; db.stocks=db.stocks.filter(function(x){return x.id!==id}); sdb(); rsl(); rms(); }

function re(){
  var tbody=document.getElementById('el'); tbody.innerHTML='';
  db.expenses.slice().reverse().forEach(function(e){
    tbody.innerHTML+='<tr><td>'+e.date+'</td><td>'+e.category+'</td><td>'+fmt(e.amount)+'</td><td>'+escHtml(e.desc||'')+'</td><td><button class="be bs2" onclick="de2(\''+e.id+'\')">✕</button></td></tr>';
  });
}
function de2(id){ if(!confirm('Supprimer ?'))return; db.expenses=db.expenses.filter(function(x){return x.id!==id}); sdb(); re(); rf(); }
function rf(){
  var ca=db.orders.reduce(function(s,o){return s+o.total},0);
  var ex=db.expenses.reduce(function(s,e){return s+e.amount},0);
  var ben=db.orders.reduce(function(s,o){return s+o.profit},0)-ex;
  var rein=Math.round(ben*(db.config.reinvestRate/100));
  var disp=ben-rein;
  var sav=Math.max(0,disp*0.2);
  document.getElementById('f-ca').innerText=fmt(ca);
  document.getElementById('f-sa').innerText=fmt(sav);
  document.getElementById('f-re').innerText=fmt(rein);
  document.getElementById('f-av').innerText=fmt(Math.max(0,disp-sav));

  // Pie chart
  var ctx=document.getElementById('c2'); if(!ctx)return;
  var cats={}; db.expenses.forEach(function(e){cats[e.category]=(cats[e.category]||0)+e.amount});
  if(window.expChart) window.expChart.destroy();
  window.expChart=new Chart(ctx,{type:'doughnut',data:{labels:Object.keys(cats),datasets:[{data:Object.values(cats),backgroundColor:['#c70102','#ffc700','#4caf50','#2196f3','#9c27b0','#ff5722','#607d8b','#795548']}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#fff'}}}}});
}

function ra(){
  // KPIs
  var pStar='-'; var pMax=0;
  var pCounts={};
  db.orders.forEach(function(o){o.items.forEach(function(i){pCounts[i.name]=(pCounts[i.name]||0)+i.qty});});
  for(var k in pCounts){ if(pCounts[k]>pMax){pMax=pCounts[k];pStar=k;} }
  document.getElementById('a-pp').innerText=escHtml(pStar);

  var tAmb='-'; var aMax=0;
  db.ambassadors.forEach(function(a){if(a.revenue>aMax){aMax=a.revenue;tAmb=a.name;}});
  document.getElementById('a-ta').innerText=escHtml(tAmb);

  // "CAC" renomme en "CA moyen/client" — ce n'est pas un vrai cout d'acquisition
  // (il faudrait diviser les depenses marketing par le nb de nouveaux clients pour ca)
  var cac=db.clients.length>0 ? fmt(db.orders.reduce(function(s,o){return s+o.total},0)/db.clients.length) : '-';
  document.getElementById('a-cac').innerText=cac;

  var ap=db.orders.length>0 ? fmt(db.orders.reduce(function(s,o){return s+o.profit},0)/db.orders.length) : '-';
  document.getElementById('a-ap').innerText=ap;

  // Questions rapides
  var q1='-'; var q1m=0;
  db.products.forEach(function(p){var rev=db.orders.reduce(function(s,o){return s+o.items.filter(function(i){return i.id===p.id}).reduce(function(ss,ii){return ss+ii.qty},0)*p.price},0); if(rev>q1m){q1m=rev;q1=p.name;}});
  document.getElementById('q1').innerText=escHtml(q1);
  document.getElementById('q2').innerText=escHtml(tAmb);
  document.getElementById('q3').innerText=cac;
  document.getElementById('q4').innerText=ap;
  var moCmd=db.orders.filter(function(o){return im(o.date)}).length;
  document.getElementById('q5').innerText=Math.max(0,db.config.goalOrders-moCmd);
  var ben=db.orders.reduce(function(s,o){return s+o.profit},0)-db.expenses.reduce(function(s,e){return s+e.amount},0);
  document.getElementById('q6').innerText=fmt(Math.round(ben*(db.config.reinvestRate/100)));
  var com=db.ambassadors.reduce(function(s,a){return s+a.commission},0);
  document.getElementById('q7').innerText=ben>0 ? Math.round((com/ben)*100)+'%' : '0%';

  var dayCounts=[0,0,0,0,0,0,0];
  db.orders.forEach(function(o){dayCounts[new Date(o.date).getDay()]++;});
  var maxD=0, bestD='-'; var dNames=['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
  for(var i=0;i<7;i++){if(dayCounts[i]>maxD){maxD=dayCounts[i];bestD=dNames[i];}}
  document.getElementById('q8').innerText=bestD;

  // Chart perf produits
  var ctx=document.getElementById('c3'); if(!ctx)return;
  var labels=[],data=[];
  db.products.forEach(function(p){var q=db.orders.reduce(function(s,o){return s+o.items.filter(function(i){return i.id===p.id}).reduce(function(ss,ii){return ss+ii.qty},0)},0); if(q>0){labels.push(p.name);data.push(q);}});
  if(window.perfChart) window.perfChart.destroy();
  window.perfChart=new Chart(ctx,{type:'bar',data:{labels:labels,datasets:[{label:'Qte vendue',data:data,backgroundColor:'rgba(255,199,0,0.6)',borderColor:'#ffc700',borderWidth:2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{grid:{color:'#2a2a2a'}},x:{grid:{display:false},ticks:{color:'#fff'}}}}});
}

function rgl(){
  var c=document.getElementById('gl'); c.innerHTML='';
  db.goals.forEach(function(g){
    var cur=0;
    if(g.type==='orders') cur=db.orders.length;
    else if(g.type==='revenue') cur=db.orders.reduce(function(s,o){return s+o.total},0);
    else if(g.type==='savings') cur=db.orders.reduce(function(s,o){return s+o.profit},0)*0.2;
    else if(g.type==='ambassadors') cur=db.ambassadors.length;
    else if(g.type==='clients') cur=db.clients.length;
    else cur=g.current||0;
    var pct=Math.min(100,Math.round((cur/g.target)*100))||0;
    var dl=g.deadline?' (avant '+g.deadline+')':'';
    c.innerHTML+='<div class="cd"><h3>'+escHtml(g.title)+dl+'</h3><div style="display:flex;justify-content:space-between;font-size:.9rem;margin-bottom:6px"><span>'+fmtN(cur)+' / '+fmtN(g.target)+'</span><span>'+pct+'%</span></div><div class="pb"><div class="pf" style="width:'+pct+'%"></div></div></div>';
  });
}

function rse(){
  document.getElementById('cfg-c').value=db.config.currency;
  document.getElementById('cfg-co').value=db.config.defaultCom;
  document.getElementById('cfg-r').value=db.config.reinvestRate;
  document.getElementById('cfg-go').value=db.config.goalOrders;
  document.getElementById('cfg-gr').value=db.config.goalRevenue;
  document.getElementById('cfg-wa').value=db.config.whatsapp||'';
  var url=window.location.href.split('?')[0]+'?mode=client';
  document.getElementById('cl2').value=url;
  // QR lien client (genere localement, sans service externe)
  var qri=document.getElementById('mqri'); qri.innerHTML='';
  try{
    new QRCode(qri, { text: url, width: 180, height: 180, colorDark: "#000000", colorLight: "#ffffff" });
    var qimg2 = qri.querySelector('img'); if(qimg2) qimg2.alt = 'QR code du lien client';
  } catch(e){
    qri.innerHTML = '<p style="font-size:.75rem;color:var(--t2);word-break:break-all">'+url+'</p>';
  }
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', function(){
  ldb();
  if(icm){
    document.getElementById('cm').style.display='block';
    scp('menu');
  } else {
    document.getElementById('mm').style.display='block';
    sp('dash');
    initIncomingOrders();
  }
});
