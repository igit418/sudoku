/* ================= Konta (Supabase) ================= */
// Klucze projektu Supabase: Settings → API (lub Connect). Oba są publiczne – mogą być w kodzie strony,
// bo dane chronią reguły bezpieczeństwa w bazie (RLS), a nie tajność klucza.
const SUPABASE_URL = '__SUPABASE_URL__';
const SUPABASE_KEY = '__SUPABASE_KEY__';
const SITE_URL = (location.origin && location.origin !== 'null' ? location.origin : '') + location.pathname;

// Parametry z linku w e-mailu (potwierdzenie konta, reset hasła, błędy) – czytamy, zanim Supabase je usunie z adresu
const LINK = (() => {
  const p = new URLSearchParams(location.hash.slice(1) || location.search.slice(1));
  return { type: p.get('type'), error: p.get('error_description') || p.get('error'), code: p.get('error_code') };
})();

const A = { status:'loading', sb:null, session:null, account:null, msg:null, list:null, listErr:null, q:'',
            view:null, pendingEmail:'', busy:false, form:{}, resendAt:0 };
let accWrite = Promise.resolve();
const configured = () => SUPABASE_URL.startsWith('https://') && SUPABASE_KEY.length > 20;
const loggedIn = () => !!(A.session && A.account);
const isAdmin  = () => loggedIn() && A.account.role === 'admin';
function godProgress(){ return loggedIn() ? ((A.account.wins||{}).extreme||0) : null; }
const accountActive = () => loggedIn();
let settingsFor = null;
function pushSettings(p){ if (loggedIn()) saveAccount({ settings:p }); }
const godUnlocked = () => isAdmin() || (godProgress() ?? 0) >= GOD_NEED;   // admin ma GOD od razu
const nowIso = () => new Date().toISOString();

function authErr(e){
  const c = (e && e.code) || '', m = ((e && e.message) || '').toLowerCase();
  if (c==='invalid_credentials' || m.includes('invalid login')) return 'Nieprawidłowy e-mail lub hasło.';
  if (c==='email_not_confirmed' || m.includes('not confirmed')) return 'Ten adres nie jest jeszcze potwierdzony. Kliknij link w e-mailu, który do Ciebie wysłaliśmy.';
  if (c==='user_already_exists' || c==='email_exists' || m.includes('already registered')) return 'Konto z tym adresem już istnieje. Zaloguj się albo zresetuj hasło.';
  if (c==='weak_password') return 'Hasło jest za słabe. Użyj co najmniej 8 znaków, w tym litery i cyfry.';
  if (c==='same_password') return 'Nowe hasło musi być inne niż obecne.';
  if (c==='over_email_send_rate_limit' || c==='over_request_rate_limit' || m.includes('rate limit')) return 'Za dużo prób w krótkim czasie. Odczekaj kilka minut i spróbuj ponownie.';
  if (c==='email_address_invalid' || m.includes('invalid format') || m.includes('is invalid')) return 'Ten adres e-mail jest nieprawidłowy.';
  if (m.includes('failed to fetch') || m.includes('network')) return 'Brak połączenia z serwerem kont. Sprawdź internet.';
  return 'Coś poszło nie tak: ' + ((e && e.message) || 'nieznany błąd');
}

async function initAccounts(){
  if (!configured()){ A.status = 'unconfigured'; renderSide(); return; }
  if (!window.supabase || !window.supabase.createClient){ A.status = 'error'; renderSide(); return; }
  A.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession:true, autoRefreshToken:true, detectSessionInUrl:true, flowType:'implicit' }
  });

  if (LINK.error){
    A.msg = { err:true, t: LINK.code==='otp_expired'
      ? 'Link z e-maila wygasł albo został już użyty. Zaloguj się lub poproś o nowy link.'
      : 'Nie udało się użyć linku z e-maila: ' + LINK.error };
    try{ history.replaceState(null, '', location.pathname + location.search); }catch(e){}
    setTimeout(() => toggleSide(true), 300);
  }

  A.sb.auth.onAuthStateChange((event, session) => {
    A.session = session;
    if (event === 'PASSWORD_RECOVERY'){ A.view = 'reset'; activeTab = 'login'; A.msg = null; setTimeout(() => toggleSide(true), 200); }
    if (event === 'SIGNED_IN' && LINK.type === 'signup'){ LINK.type = null; A.view = null;
      A.msg = { t:'Adres e-mail potwierdzony. Witaj w grze!' }; setTimeout(() => toggleSide(true), 300); }
    if (event === 'SIGNED_IN' && LINK.type === 'email_change'){ LINK.type = null; A.msg = { t:'Nowy adres e-mail został potwierdzony.' }; }
    if (event === 'SIGNED_OUT'){ A.account = null; A.list = null; }
    // Wywołania Supabase poza callbackiem (zalecenie biblioteki – inaczej może się zablokować)
    setTimeout(loadAccount, 0);
  });
  const { data } = await A.sb.auth.getSession();
  A.session = data.session;
  await loadAccount();
}

let lastSeenDone = false;
async function loadAccount(){
  if (!A.session){ A.account = null; A.status = 'ready'; renderSide(); return; }
  const { data, error } = await A.sb.from('profiles').select('*').eq('id', A.session.user.id).maybeSingle();
  if (error) A.msg = { err:true, t:'Nie udało się wczytać profilu. Odśwież stronę.' };
  A.account = data || null;
  A.status = 'ready';
  if (A.account && !lastSeenDone){ lastSeenDone = true; saveAccount({ last_seen: nowIso() }); }
  if (A.account && settingsFor !== A.account.id){
    settingsFor = A.account.id;
    if (applyAccountSettings(A.account.settings)) toast('Wczytano Twoje ustawienia');
    else pushSettings(settingsPayload());   // pierwsze logowanie: zapisz obecne ustawienia na koncie
  }
  renderSide();
}

function saveAccount(patch){
  if (!A.sb || !A.account) return;
  A.account = { ...A.account, ...patch };
  const id = A.account.id;
  accWrite = accWrite.then(async () => {
    const { error } = await A.sb.from('profiles').update(patch).eq('id', id);
    if (error){ A.msg = { err:true, t:'Nie udało się zapisać zmian na koncie.' }; renderSide(); }
  });
}
function accountEvent(type){
  if (!loggedIn()) return;
  const a = A.account;
  if (type==='start') saveAccount({ started:(a.started||0)+1, last_seen:nowIso() });
  if (type==='lose')  saveAccount({ lost:(a.lost||0)+1, last_seen:nowIso() });
  if (type==='win'){
    const best = { ...(a.best||{}) }, wins = { ...(a.wins||{}) };
    if (best[S.diff]==null || S.time < best[S.diff]) best[S.diff] = S.time;
    wins[S.diff] = (wins[S.diff]||0) + 1;
    saveAccount({ won:(a.won||0)+1, best, wins, points:(a.points||0)+S.score, last_seen:nowIso() });
    if (S.diff==='extreme' && wins.extreme===GOD_NEED) setTimeout(() => toast('🔓 Odblokowałeś tryb GOD!'), 1400);
    renderDiffbar();
  }
}

async function loadAdminList(){
  if (!isAdmin()) return;
  A.listErr = null;
  const { data, error } = await A.sb.from('profiles').select('*').order('last_seen', { ascending:false });
  if (error) A.listErr = 'Nie udało się wczytać listy kont.';
  else A.list = data;
  if (activeTab==='admin') renderSideBody();
}

/* ================= Pasek boczny ================= */
const side = $('side'), scrim = $('scrim'), dock = $('dock');
let sideOpen = false, activeTab = 'login';
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtDate = v => v ? new Date(v).toLocaleString('pl-PL',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';

function toggleSide(force){
  sideOpen = force===undefined ? !sideOpen : force;
  side.style.transform = '';
  side.classList.toggle('open', sideOpen);
  scrim.classList.toggle('show', sideOpen);
  if (sideOpen && S && !S.paused && !S.over && !S.won) { setPaused(true, true); side.dataset.paused = '1'; }
  if (!sideOpen && side.dataset.paused){ delete side.dataset.paused; setPaused(false); }
  if (sideOpen) renderSide();
}
$('sideClose').onclick = () => toggleSide(false);
scrim.onclick = () => toggleSide(false);

// Wysuwanie przeciąganiem od lewej do prawej (jak pasek w Windows) albo kliknięciem
(function dragDock(){
  let x0 = null, moved = false, w = 0;
  dock.addEventListener('pointerdown', e => {
    x0 = e.clientX; moved = false; w = side.offsetWidth;
    dock.setPointerCapture(e.pointerId); side.classList.add('dragging');
  });
  dock.addEventListener('pointermove', e => {
    if (x0===null) return;
    const dx = Math.max(0, Math.min(w, e.clientX - x0));
    if (dx > 4) moved = true;
    if (moved){ side.style.transform = `translateX(${dx - w}px)`; scrim.classList.add('show'); scrim.style.opacity = dx/w; }
  });
  const end = e => {
    if (x0===null) return;
    const dx = e.clientX - x0; x0 = null;
    side.classList.remove('dragging'); scrim.style.opacity = '';
    toggleSide(moved ? dx > w*0.3 : true);
  };
  dock.addEventListener('pointerup', end);
  dock.addEventListener('pointercancel', end);
})();

function tabs(){
  const t = [];
  if (loggedIn()) t.push(['account','Moje konto']);
  else { t.push(['login','Zaloguj się']); t.push(['register','Zarejestruj się']); }
  t.push(['options','Opcje']);
  if (isAdmin()) t.push(['admin','Panel admina']);
  return t;
}
function renderSide(){
  const t = tabs();
  if (!t.some(x => x[0]===activeTab)) activeTab = t[0][0];
  $('sideTabs').innerHTML = t.map(([k,l]) => `<button data-tab="${k}" class="${k===activeTab?'active':''} ${k==='admin'?'admin':''}">${l}</button>`).join('');
  $('sideTabs').querySelectorAll('button').forEach(b => b.onclick = () => {
    activeTab = b.dataset.tab; A.msg = null; if (A.view!=='reset') A.view = null; renderSide();
  });
  const nick = loggedIn() ? A.account.nick : '';
  $('avatar').textContent = nick ? nick[0].toUpperCase() : '?';
  $('who').textContent = nick || 'Niezalogowany';
  $('whoSub').textContent = nick ? A.account.email + (isAdmin() ? ' · admin' : '') : 'Konto Sudoku';
  side.classList.toggle('wide', activeTab==='admin');
  if (activeTab==='admin' && isAdmin() && !A.list) loadAdminList();
  renderDiffbar();
  renderSideBody();
}

/* ----- Pomocnicze formularzy ----- */
function msgHtml(){ return A.msg ? `<div class="msg ${A.msg.err?'err':'ok'}">${esc(A.msg.t)}</div>` : ''; }
const F = k => esc(A.form[k] || '');
function field(id, label, type, extra=''){
  const pw = type==='password';
  return `<label class="f" for="${id}">${label}</label>
    <div class="inwrap">${`<input type="${type}" id="${id}" value="${F(id)}" ${extra}>`}${pw ? `<button type="button" class="eye" data-eye="${id}" aria-label="Pokaż hasło">👁</button>` : ''}</div>`;
}
function btn(id, text, cls='primary'){ return `<button class="sbtn ${cls}" id="${id}" ${A.busy?'disabled':''}>${A.busy && cls==='primary' ? 'Proszę czekać…' : text}</button>`; }
function link(id, text){ return `<button class="linkbtn" id="${id}">${text}</button>`; }
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
function pwProblems(p){
  const out = [];
  if (p.length < 8) out.push('co najmniej 8 znaków');
  if (!/[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(p)) out.push('literę');
  if (!/\d/.test(p)) out.push('cyfrę');
  return out;
}
function pwMeter(id){
  return `<div class="pwmeter" id="${id}-meter"><i></i></div><div class="pwhint" id="${id}-hint">Min. 8 znaków, litera i cyfra.</div>`;
}
function updateMeter(id){
  const el = $(id); if (!el) return;
  const p = el.value, probs = pwProblems(p);
  let score = 0; if (p.length>=8) score++; if (p.length>=12) score++; if (/\d/.test(p) && /[a-z]/i.test(p)) score++; if (/[^a-z0-9]/i.test(p)) score++;
  const m = $(id+'-meter'), h = $(id+'-hint');
  m.dataset.s = p ? Math.max(1, score) : 0;
  h.textContent = !p ? 'Min. 8 znaków, litera i cyfra.' : probs.length ? 'Brakuje: ' + probs.join(', ') + '.' : ['', 'Słabe', 'W porządku', 'Dobre', 'Bardzo dobre'][Math.max(1,score)] + ' hasło.';
}
function collect(body){ body.querySelectorAll('input').forEach(i => { if (i.id) A.form[i.id] = i.type==='checkbox' ? i.checked : i.value; }); }
function fail(t){ A.msg = { err:true, t }; A.busy = false; renderSideBody(); }
async function run(fn){ A.busy = true; renderSideBody(); try{ await fn(); } catch(e){ fail(authErr(e)); return; } A.busy = false; renderSide(); }

/* ----- Widoki ----- */
function statusHtml(){
  if (A.status==='loading') return `<p>Łączenie z serwerem kont…</p>`;
  if (A.status==='unconfigured') return `<div class="msg">Logowanie i rejestracja są w przygotowaniu.</div><p>Wkrótce założysz tu konto e-mailem z weryfikacją. Gra, motywy i opcje działają już normalnie.</p>`;
  return `<div class="msg err">Nie udało się połączyć z serwerem kont.</div><p>Odśwież stronę za chwilę. Gra działa normalnie.</p>`;
}

function loginHtml(){
  if (A.view==='reset') return `<h4>Ustaw nowe hasło</h4><p>Wpisz nowe hasło do swojego konta.</p>${msgHtml()}
      ${field('npw','Nowe hasło','password','autocomplete="new-password"')}${pwMeter('npw')}
      ${field('npw2','Powtórz nowe hasło','password','autocomplete="new-password"')}
      ${btn('doReset','Zapisz nowe hasło')}`;
  if (A.view==='forgot') return `<h4>Nie pamiętasz hasła?</h4>
      <p>Podaj adres e-mail konta. Wyślemy na niego link do ustawienia nowego hasła.</p>${msgHtml()}
      ${field('femail','E-mail','email','autocomplete="email" placeholder="np. jan@gmail.com"')}
      ${btn('doForgot','Wyślij link')}${link('toLogin','← Wróć do logowania')}`;
  return `<h4>Zaloguj się</h4>${msgHtml()}
      ${field('lemail','E-mail','email','autocomplete="email" placeholder="np. jan@gmail.com"')}
      ${field('lpw','Hasło','password','autocomplete="current-password"')}
      ${btn('doLogin','Zaloguj się')}
      ${A.showResend ? btn('doResend','Wyślij ponownie link potwierdzający','') : ''}
      <div class="links">${link('toForgot','Nie pamiętasz hasła?')}${link('toReg','Nie masz konta? Zarejestruj się')}</div>`;
}

function registerHtml(){
  if (A.view==='sent') return `<div class="mailsent"><div class="ic">✉</div><h4>Sprawdź skrzynkę</h4>
      <p>Wysłaliśmy link potwierdzający na <b>${esc(A.pendingEmail)}</b>. Kliknij go, aby aktywować konto. Potem możesz się zalogować.</p>
      <p class="small">Nie widzisz wiadomości? Sprawdź folder Spam lub Oferty. Link jest ważny przez ograniczony czas.</p></div>
      ${msgHtml()}${btn('doResend','Wyślij link ponownie','')}${link('toLogin','Przejdź do logowania')}`;
  return `<h4>Załóż konto</h4>
      <p>Konto zapisuje Twoje statystyki i rekordy na każdym poziomie. Po rejestracji dostaniesz e-mail z linkiem potwierdzającym.</p>${msgHtml()}
      ${field('remail','E-mail','email','autocomplete="email" placeholder="np. jan@gmail.com"')}
      ${field('rnick','Nazwa gracza','text','maxlength="20" placeholder="2–20 znaków"')}
      ${field('rpw','Hasło','password','autocomplete="new-password"')}${pwMeter('rpw')}
      ${field('rpw2','Powtórz hasło','password','autocomplete="new-password"')}
      <label class="check"><input type="checkbox" id="rterms" ${A.form.rterms?'checked':''}>
        <span>Akceptuję ${link('showTerms','Regulamin')} i ${link('showPrivacy','Politykę prywatności')}.</span></label>
      ${btn('doReg','Załóż konto')}`;
}

function accountHtml(){
  const a = A.account, best = a.best || {};
  return `<h4>${esc(a.nick)}${isAdmin()?' <span class="rolebadge">Admin</span>':''}</h4>
    <p>${esc(a.email)}<br>Konto od ${fmtDate(a.created_at)}</p>${msgHtml()}
    <div class="statgrid"><div>Rozpoczęte<b>${a.started||0}</b></div><div>Wygrane<b>${a.won||0}</b></div><div>Przegrane<b>${a.lost||0}</b></div></div>
    <h4>Rekordy czasu</h4>
    <table class="besttab">${Object.entries(DIFFS).map(([k,v]) => `<tr><td>${v.name}</td><td>${best[k]!=null?fmt(best[k]):'—'}</td></tr>`).join('')}</table>
    <details class="sect"><summary>Nazwa gracza</summary>
      ${field('anick','Nowa nazwa','text','maxlength="20"')}${btn('doNick','Zapisz nazwę','')}</details>
    <details class="sect"><summary>Zmień hasło</summary>
      ${field('apw','Nowe hasło','password','autocomplete="new-password"')}${pwMeter('apw')}
      ${field('apw2','Powtórz nowe hasło','password','autocomplete="new-password"')}${btn('doPw','Zmień hasło','')}</details>
    <details class="sect"><summary>Zmień e-mail</summary>
      <p class="small">Wyślemy link potwierdzający na nowy adres. Zmiana zadziała po jego kliknięciu.</p>
      ${field('aemail','Nowy e-mail','email','autocomplete="email"')}${btn('doEmail','Zmień e-mail','')}</details>
    ${btn('doLogout','Wyloguj się','')}
    ${link('doDeleteMe','Usuń moje konto')}`;
}

function adminHtml(){
  if (A.listErr) return `<div class="msg err">${esc(A.listErr)}</div>${btn('doRefresh','Spróbuj ponownie','')}`;
  if (!A.list) return `<p>Wczytywanie kont…</p>`;
  const q = A.q.trim().toLowerCase();
  const rows = A.list.filter(a => !q || (a.nick||'').toLowerCase().includes(q) || (a.email||'').toLowerCase().includes(q));
  const tot = k => A.list.reduce((s,a) => s + (a[k]||0), 0);
  return `<h4>Panel admina</h4>
    <p>Wszystkie konta zarejestrowane na stronie. Konta niepotwierdzone to osoby, które nie kliknęły jeszcze linku z e-maila.</p>
    ${msgHtml()}
    <div class="asum"><div>Konta<b>${A.list.length}</b></div><div>Potwierdzone<b>${A.list.filter(a=>a.confirmed).length}</b></div><div>Gry<b>${tot('started')}</b></div><div>Wygrane<b>${tot('won')}</b></div></div>
    <div class="asearch"><input type="text" id="aq" placeholder="Szukaj po nazwie lub e-mailu…" value="${esc(A.q)}"><button class="sbtn" id="doRefresh" style="width:auto;margin:0;padding:10px 14px">Odśwież</button></div>
    ${rows.length ? `<table class="atable"><thead><tr><th>Gracz</th><th>E-mail</th><th>Gry</th><th>Ostatnio</th><th></th></tr></thead><tbody>
      ${rows.map(a => {
        const best = a.best || {}, me = a.id===A.account.id;
        const bestTxt = Object.entries(DIFFS).filter(([k]) => best[k]!=null).map(([k,v]) => `${v.name}: ${fmt(best[k])}`).join(' · ') || 'brak rekordów';
        const ext = (a.wins||{}).extreme||0;
        return `<tr>
          <td><b style="font-weight:500">${esc(a.nick||'—')}</b>${a.role==='admin'?'<span class="tag">Admin</span>':''}${me?'<span class="tag" style="background:var(--muted)">Ty</span>':''}
            <div class="det">od ${fmtDate(a.created_at)}<br>${bestTxt}</div></td>
          <td class="em">${esc(a.email||'—')}<div class="det">${a.confirmed ? '✓ potwierdzony' : '⏳ niepotwierdzony'}</div></td>
          <td>${a.won||0} / ${a.started||0}<div class="det">wygr. / rozp.<br>przegr.: ${a.lost||0}<br>Ekstr.: ${ext}/${GOD_NEED}${ext>=GOD_NEED?' · GOD ✓':''}</div></td>
          <td class="det">${fmtDate(a.last_seen)}</td>
          <td>${me ? '' : `<button class="neutral" data-role="${esc(a.id)}" data-to="${a.role==='admin'?'user':'admin'}">${a.role==='admin'?'Odbierz admina':'Nadaj admina'}</button>
               <button data-del="${esc(a.id)}">Usuń</button>`}</td></tr>`;
      }).join('')}</tbody></table>` : `<p>${A.list.length ? 'Brak wyników.' : 'Nikt jeszcze nie założył konta.'}</p>`}`;
}

function optionsHtml(){
  return optionsSectionHtml() + `<p class="small">${link('showTerms','Regulamin')} · ${link('showPrivacy','Polityka prywatności')}</p>`;
}

function renderSideBody(){
  const body = $('sideBody');
  let h;
  if (activeTab==='options') h = optionsHtml();
  else if (A.status!=='ready') h = statusHtml();
  else if (activeTab==='login') h = loginHtml();
  else if (activeTab==='register') h = registerHtml();
  else if (activeTab==='account' && loggedIn()) h = accountHtml();
  else if (activeTab==='admin' && isAdmin()) h = adminHtml();
  else h = '';
  const st = body.scrollTop;
  body.innerHTML = h;
  if (activeTab==='options'){ wireOptions(body, renderSideBody); body.scrollTop = st; }
  wireSide(body);
}

/* ----- Regulamin i polityka prywatności ----- */
const LEGAL = {
  terms: `<h2>Regulamin</h2><div class="legal">
    <p><b>1. Usługa.</b> Strona udostępnia bezpłatną grę Sudoku. Konto jest dobrowolne i służy do zapisywania statystyk oraz rekordów.</p>
    <p><b>2. Konto.</b> Do założenia konta potrzebny jest adres e-mail, nazwa gracza i hasło. Konto zaczyna działać po potwierdzeniu adresu e-mail linkiem z wiadomości.</p>
    <p><b>3. Zasady.</b> Nie wolno używać obraźliwych nazw gracza, podszywać się pod innych ani próbować obchodzić zabezpieczeń strony. Za naruszenie tych zasad konto może zostać usunięte.</p>
    <p><b>4. Usunięcie konta.</b> Możesz w każdej chwili usunąć swoje konto w zakładce „Moje konto”. Usuwa to wszystkie Twoje dane.</p>
    <p><b>5. Odpowiedzialność.</b> Strona jest projektem hobbystycznym, udostępnianym „tak jak jest”, bez gwarancji ciągłego działania.</p>
    <p><b>6. Kontakt.</b> rogi.kudlaty@gmail.com</p></div>`,
  privacy: `<h2>Polityka prywatności</h2><div class="legal">
    <p><b>Administrator danych:</b> właściciel strony, kontakt: rogi.kudlaty@gmail.com.</p>
    <p><b>Jakie dane zbieramy:</b> adres e-mail, nazwę gracza, zaszyfrowane hasło (nikt, także administrator, nie widzi Twojego hasła), daty rejestracji i ostatniej wizyty oraz statystyki gier.</p>
    <p><b>Po co:</b> wyłącznie do prowadzenia konta, logowania i pokazywania Twoich wyników (art. 6 ust. 1 lit. b RODO). Nie wysyłamy reklam i nie sprzedajemy danych.</p>
    <p><b>Gdzie są dane:</b> w usłudze Supabase (serwery w Unii Europejskiej, jeśli projekt tak skonfigurowano). E-maile z linkami wysyła Supabase.</p>
    <p><b>Jak długo:</b> do czasu usunięcia konta.</p>
    <p><b>Twoje prawa:</b> wgląd w dane, ich poprawienie, usunięcie (przycisk „Usuń moje konto”), ograniczenie przetwarzania, przeniesienie danych oraz skarga do Prezesa UODO.</p>
    <p><b>Przeglądarka:</b> strona zapisuje w pamięci przeglądarki ustawienia gry, motyw i stan bieżącej partii, a po zalogowaniu także sesję logowania. Nie używamy plików cookie do śledzenia.</p></div>`,
};
function showLegal(kind){
  openModal(`${LEGAL[kind]}<div class="btns"><button class="primary" data-cancel>Zamknij</button></div>`,
    m => m.querySelector('[data-cancel]').onclick = closeModal, 'keys');
}

/* ----- Obsługa przycisków ----- */
function wireSide(body){
  const on = (id, fn) => body.querySelectorAll('#'+id).forEach(el => el.onclick = e => { e.preventDefault(); collect(body); fn(); });
  body.querySelectorAll('[data-eye]').forEach(b => b.onclick = () => { const i = $(b.dataset.eye); i.type = i.type==='password' ? 'text' : 'password'; });
  ['rpw','npw','apw'].forEach(id => { const i = $(id); if (i){ i.addEventListener('input', () => updateMeter(id)); updateMeter(id); } });
  on('showTerms', () => showLegal('terms'));
  on('showPrivacy', () => showLegal('privacy'));
  on('toForgot', () => { A.view = 'forgot'; A.msg = null; A.form.femail = A.form.lemail || ''; renderSideBody(); });
  on('toLogin',  () => { A.view = null; A.msg = null; activeTab = 'login'; renderSide(); });
  on('toReg',    () => { A.view = null; A.msg = null; activeTab = 'register'; renderSide(); });

  on('doLogin', () => {
    const email = (A.form.lemail||'').trim().toLowerCase(), pw = A.form.lpw || '';
    if (!validEmail(email)) return fail('Wpisz poprawny adres e-mail.');
    if (!pw) return fail('Wpisz hasło.');
    A.showResend = false;
    run(async () => {
      const { error } = await A.sb.auth.signInWithPassword({ email, password: pw });
      if (error){
        if (error.code==='email_not_confirmed' || /not confirmed/i.test(error.message)){ A.showResend = true; A.pendingEmail = email; }
        throw error;
      }
      A.form = {}; A.msg = null; activeTab = 'account';
      toast('Zalogowano');
    });
  });

  on('doReg', () => {
    const email = (A.form.remail||'').trim().toLowerCase(), nick = (A.form.rnick||'').trim(), pw = A.form.rpw||'', pw2 = A.form.rpw2||'';
    if (!validEmail(email)) return fail('Wpisz poprawny adres e-mail.');
    if (nick.length < 2 || nick.length > 20) return fail('Nazwa gracza musi mieć od 2 do 20 znaków.');
    const probs = pwProblems(pw); if (probs.length) return fail('Hasło musi zawierać: ' + probs.join(', ') + '.');
    if (pw !== pw2) return fail('Hasła nie są takie same.');
    if (!A.form.rterms) return fail('Aby założyć konto, zaakceptuj Regulamin i Politykę prywatności.');
    run(async () => {
      const { data, error } = await A.sb.auth.signUp({ email, password: pw,
        options: { emailRedirectTo: SITE_URL, data: { nick, accepted_terms: true } } });
      if (error) throw error;
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0)
        throw { code:'user_already_exists' };
      A.pendingEmail = email; A.form = {}; A.msg = null; A.resendAt = Date.now();
      if (data.session){ activeTab = 'account'; toast('Konto założone'); }   // gdy potwierdzanie e-maila jest wyłączone
      else A.view = 'sent';
    });
  });

  on('doResend', () => {
    const wait = Math.ceil((A.resendAt + 60000 - Date.now())/1000);
    if (wait > 0) return fail(`Kolejny e-mail możesz wysłać za ${wait} s.`);
    run(async () => {
      const { error } = await A.sb.auth.resend({ type:'signup', email:A.pendingEmail, options:{ emailRedirectTo: SITE_URL } });
      if (error) throw error;
      A.resendAt = Date.now(); A.msg = { t:'Wysłaliśmy link ponownie na ' + A.pendingEmail + '.' };
    });
  });

  on('doForgot', () => {
    const email = (A.form.femail||'').trim().toLowerCase();
    if (!validEmail(email)) return fail('Wpisz poprawny adres e-mail.');
    run(async () => {
      const { error } = await A.sb.auth.resetPasswordForEmail(email, { redirectTo: SITE_URL });
      if (error) throw error;
      A.msg = { t:'Jeśli istnieje konto z adresem ' + email + ', wysłaliśmy na nie link do zmiany hasła.' };
    });
  });

  on('doReset', () => {
    const pw = A.form.npw||'', pw2 = A.form.npw2||'';
    const probs = pwProblems(pw); if (probs.length) return fail('Hasło musi zawierać: ' + probs.join(', ') + '.');
    if (pw !== pw2) return fail('Hasła nie są takie same.');
    run(async () => {
      const { error } = await A.sb.auth.updateUser({ password: pw });
      if (error) throw error;
      A.view = null; A.form = {}; A.msg = { t:'Hasło zostało zmienione. Jesteś zalogowany.' }; activeTab = 'account';
    });
  });

  on('doNick', () => {
    const nick = (A.form.anick||'').trim();
    if (nick.length < 2 || nick.length > 20) return fail('Nazwa gracza musi mieć od 2 do 20 znaków.');
    saveAccount({ nick }); A.form.anick = ''; A.msg = { t:'Zapisano nową nazwę.' }; renderSide();
  });

  on('doPw', () => {
    const pw = A.form.apw||'', pw2 = A.form.apw2||'';
    const probs = pwProblems(pw); if (probs.length) return fail('Hasło musi zawierać: ' + probs.join(', ') + '.');
    if (pw !== pw2) return fail('Hasła nie są takie same.');
    run(async () => {
      const { error } = await A.sb.auth.updateUser({ password: pw });
      if (error) throw error;
      A.form.apw = A.form.apw2 = ''; A.msg = { t:'Hasło zostało zmienione.' };
    });
  });

  on('doEmail', () => {
    const email = (A.form.aemail||'').trim().toLowerCase();
    if (!validEmail(email)) return fail('Wpisz poprawny adres e-mail.');
    if (email === A.account.email) return fail('To jest Twój obecny adres.');
    run(async () => {
      const { error } = await A.sb.auth.updateUser({ email }, { emailRedirectTo: SITE_URL });
      if (error) throw error;
      A.form.aemail = ''; A.msg = { t:'Wysłaliśmy link potwierdzający na ' + email + '. Kliknij go, aby zakończyć zmianę.' };
    });
  });

  on('doLogout', () => run(async () => {
    await A.sb.auth.signOut(); A.account = null; A.session = null; A.list = null; lastSeenDone = false; settingsFor = null;
    A.msg = null; activeTab = 'login'; toast('Wylogowano');
  }));

  on('doDeleteMe', () => openModal(`<h2>Usunąć konto?</h2>
      <p>Twoje konto, statystyki i rekordy zostaną usunięte na zawsze. Tego nie da się cofnąć.</p>
      <div class="btns"><button class="primary" data-yes style="background:var(--error)">Usuń moje konto</button><button data-cancel>Anuluj</button></div>`, m => {
      m.querySelector('[data-cancel]').onclick = closeModal;
      m.querySelector('[data-yes]').onclick = async () => {
        closeModal();
        const { error } = await A.sb.rpc('delete_own_account');
        if (error){ A.msg = { err:true, t:'Nie udało się usunąć konta.' }; renderSide(); return; }
        await A.sb.auth.signOut(); A.account = null; A.session = null; activeTab = 'login';
        A.msg = { t:'Konto zostało usunięte.' }; renderSide();
      };
    }));

  on('doRefresh', () => { A.list = null; renderSideBody(); loadAdminList(); });
  const aq = body.querySelector('#aq');
  if (aq){ aq.oninput = () => { A.q = aq.value; const pos = aq.selectionStart; renderSideBody(); const n = $('aq'); n.focus(); n.setSelectionRange(pos,pos); }; }
  body.querySelectorAll('[data-role]').forEach(b => b.onclick = async () => {
    const { error } = await A.sb.rpc('admin_set_role', { target:b.dataset.role, new_role:b.dataset.to });
    A.msg = error ? { err:true, t:'Nie udało się zmienić roli.' } : { t: b.dataset.to==='admin' ? 'Nadano rolę admina.' : 'Odebrano rolę admina.' };
    loadAdminList();
  });
  body.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    const a = A.list.find(x => x.id===b.dataset.del);
    openModal(`<h2>Usunąć konto?</h2><p>Konto „${esc(a && a.nick)}” (${esc(a && a.email)}) i jego statystyki zostaną usunięte na zawsze.</p>
      <div class="btns"><button class="primary" data-yes style="background:var(--error)">Usuń konto</button><button data-cancel>Anuluj</button></div>`, m => {
        m.querySelector('[data-cancel]').onclick = closeModal;
        m.querySelector('[data-yes]').onclick = async () => {
          closeModal();
          const { error } = await A.sb.rpc('admin_delete_user', { target:b.dataset.del });
          A.msg = error ? { err:true, t:'Nie udało się usunąć konta.' } : { t:'Konto zostało usunięte.' };
          loadAdminList();
        };
      });
  });

  // Enter wysyła formularz
  body.querySelectorAll('input:not(#aq):not([type=checkbox])').forEach(i => i.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const sect = i.closest('details');
    const b = (sect && sect.querySelector('.sbtn')) || body.querySelector('#doLogin,#doReg,#doForgot,#doReset');
    b && b.click();
  }));
}

