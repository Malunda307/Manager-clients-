// Tests de securite (aucune dependance : node tests/admin-access.test.js)
// Couvre : le controle d'acces gerant, l'echappement HTML des donnees venant de
// la base ou d'un QR code, et le non-stockage des donnees confidentielles.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

function makeEnv(opts) {
  const store = Object.assign({}, opts.localStorage || {});
  const localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  };
  const el = () => ({ style: {}, classList: { add() {}, remove() {}, contains: () => false }, value: '', innerText: '', innerHTML: '', dataset: {}, closest: () => null, querySelector: () => null, querySelectorAll: () => [] });
  const sandbox = {
    console,
    localStorage,
    navigator: { onLine: opts.online !== false, serviceWorker: undefined },
    crypto: { randomUUID: () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
    URLSearchParams: URLSearchParams,
    Promise, JSON, Date, Number, String, Math, Object, Array, setTimeout, isNaN, parseInt, parseFloat,
    location: { search: '' },
    document: {
      getElementById: () => el(),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      body: { insertAdjacentHTML: () => {} },
      createElement: el
    },
    supabase: opts.libLoaded === false ? undefined : {
      createClient: () => ({
        auth: {
          getSession: () => Promise.resolve({ data: { session: opts.session || null } }),
          onAuthStateChange: () => {},
          signOut: () => Promise.resolve({})
        },
        from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }), order: () => Promise.resolve({ data: [] }) }) })
      })
    }
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.window.addEventListener = () => {};
  const ctx = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'script.js'), 'utf8'), ctx);
  return { ctx, store };
}

const results = [];
function check(name, actual, expected) {
  const ok = actual === expected;
  results.push((ok ? 'OK   ' : 'ECHEC') + ' | ' + name + ' -> ' + actual + ' (attendu ' + expected + ')');
  return ok;
}

// --- Scenario 1 : attaquant qui forge la cle localStorage, aucune session ---
(async () => {
  let env = makeEnv({
    localStorage: { dbm_admin_v2: JSON.stringify({ userId: 'attaquant', email: 'x@x.fr', at: Date.now() }) },
    session: null
  });
  let granted = await vm.runInContext('verifyOfflineAdmin()', env.ctx);
  check('cle forgee sans session -> pas admin', granted, false);
  check('adminGranted() apres cle forgee', vm.runInContext('adminGranted()', env.ctx), false);

  // --- Scenario 2 : ancienne cle non fiable (dbm_admin_cache) ---
  env = makeEnv({ localStorage: { dbm_admin_cache: JSON.stringify({ email: 'x@x.fr', at: Date.now() }) } });
  granted = await vm.runInContext('verifyOfflineAdmin()', env.ctx);
  check('ancienne cle heritee -> pas admin', granted, false);
  check('ancienne cle supprimee du stockage', env.store.dbm_admin_cache === undefined, true);

  // --- Scenario 3 : session valide mais utilisateur different du cache ---
  env = makeEnv({
    localStorage: { dbm_admin_v2: JSON.stringify({ userId: 'user-admin', at: Date.now() }) },
    session: { user: { id: 'user-client', email: 'c@c.fr' } }
  });
  granted = await vm.runInContext('verifyOfflineAdmin()', env.ctx);
  check('session d un autre utilisateur -> pas admin', granted, false);

  // --- Scenario 4 : session valide + cache correspondant = admin hors ligne ---
  env = makeEnv({
    localStorage: { dbm_admin_v2: JSON.stringify({ userId: 'user-admin', email: 'a@a.fr', at: Date.now() }) },
    session: { user: { id: 'user-admin', email: 'a@a.fr' } },
    online: false
  });
  granted = await vm.runInContext('verifyOfflineAdmin()', env.ctx);
  check('vraie session admin hors ligne -> admin', granted, true);

  // --- Scenario 5 : cache expire (8 jours) ---
  env = makeEnv({
    localStorage: { dbm_admin_v2: JSON.stringify({ userId: 'user-admin', at: Date.now() - 8 * 86400000 }) },
    session: { user: { id: 'user-admin' } }
  });
  granted = await vm.runInContext('verifyOfflineAdmin()', env.ctx);
  check('cache admin expire -> pas admin', granted, false);

  // --- Scenario 6 : librairie Supabase bloquee alors que le cloud est configure ---
  env = makeEnv({
    libLoaded: false,
    localStorage: { dbm_admin_v2: JSON.stringify({ userId: 'user-admin', at: Date.now() }) }
  });
  check('librairie bloquee -> localOnly false', vm.runInContext('localOnly', env.ctx), false);
  granted = await vm.runInContext('verifyOfflineAdmin()', env.ctx);
  check('librairie bloquee -> pas admin', granted, false);

  // --- Scenario 7 : le cache sensible n est pas ecrit sans droits gerant ---
  env = makeEnv({ session: null });
  vm.runInContext("db.orders=[{id:1,total:99999}]; db.clients=[{id:1,name:'Jean'}]; sdb();", env.ctx);
  const snap = JSON.parse(env.store.dbm_v3);
  check('orders absent du cache sans admin', snap.orders === undefined, true);
  check('clients absent du cache sans admin', snap.clients === undefined, true);
  check('products present dans le cache', Array.isArray(snap.products), true);

  // --- Scenario 8 : purge du cache sensible ---
  env = makeEnv({
    localStorage: { dbm_v3: JSON.stringify({ config: {}, products: [], orders: [{ total: 5 }], clients: [{ name: 'Jean' }] }) }
  });
  vm.runInContext('purgeSensitiveCache();', env.ctx);
  const snap2 = JSON.parse(env.store.dbm_v3);
  check('purge retire orders du stockage', snap2.orders === undefined, true);
  check('purge retire clients du stockage', snap2.clients === undefined, true);
  check('purge vide db.orders en memoire', vm.runInContext('db.orders.length', env.ctx), 0);

  // --- Scenario 9 : les prix d achat et les objectifs ne restent pas en cache ---
  env = makeEnv({ session: null });
  vm.runInContext("db.products=[{id:'p1',name:'Burger',price:5000,cost:2000}];" +
    "db.config={currency:'FC',whatsapp:'+243',defaultCom:777,goalRevenue:9999999};sdb();", env.ctx);
  const snap3 = JSON.parse(env.store.dbm_v3);
  check('cost non stocke sans droits gerant', snap3.products[0].cost, 0);
  check('prix de vente conserve (menu client)', snap3.products[0].price, 5000);
  check('commission par defaut non stockee', snap3.config.defaultCom !== 777, true);
  check('objectif de CA non stocke', snap3.config.goalRevenue !== 9999999, true);
  check('whatsapp conserve (commande client)', snap3.config.whatsapp, '+243');

  // --- Scenario 10 : echappement HTML ---
  env = makeEnv({ session: null });
  const esc = vm.runInContext("escHtml('<img src=x onerror=alert(1)>')", env.ctx);
  check('escHtml neutralise les balises', esc.indexOf('<') === -1, true);
  check('escHtml neutralise les apostrophes', vm.runInContext("escHtml(\"a'b\")", env.ctx), 'a&#39;b');
  check('escHtml gere null', vm.runInContext('escHtml(null)', env.ctx), '');
  check('escHtml gere les nombres', vm.runInContext('escHtml(12)', env.ctx), '12');
  // Dans onclick="f('...')" le parseur HTML redecode les entites avant le JS :
  // il faut filtrer l identifiant, pas seulement l echapper.
  check('jsId retire les caracteres dangereux', vm.runInContext("jsId(\"1'),alert(1)//\")", env.ctx), '1alert1');
  check('jsId conserve un UUID', vm.runInContext("jsId('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')", env.ctx), 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');

  // --- Scenario 11 : la collision de nom dp est resolue ---
  check('deleteProduct est une fonction', vm.runInContext('typeof deleteProduct', env.ctx), 'function');
  check('deferredPrompt ne masque plus la suppression', vm.runInContext('typeof deferredPrompt', env.ctx), 'object');
  check('plus de variable dp', vm.runInContext('typeof dp', env.ctx), 'undefined');

  console.log(results.join('\n'));
  const failed = results.filter(r => r.startsWith('ECHEC')).length;
  console.log('\n' + (results.length - failed) + '/' + results.length + ' tests passes');
  process.exit(failed ? 1 : 0);
})();
