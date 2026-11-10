/* National Cadet Portal Ghana. Leave the keys empty to run on mock data. */
const CONFIG = { SUPABASE_URL: '', SUPABASE_ANON_KEY: '' };
const sb = CONFIG.SUPABASE_URL && window.supabase ? window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY) : null;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = s => document.querySelector(s);

/* ================= API LAYER (all data calls live here) ================= */
const SCHOOL_COLS = 'id,name,region'; // never select * from schools
const BR = [['army', 'Army'], ['navy', 'Navy'], ['airforce', 'Air Force'], ['police', 'Police'], ['immigration', 'Immigration']].map(([id, name]) => ({ id, name }));
const mock = (() => {
  const schools = [['Accra Academy', 'Greater Accra'], ['Kumasi Senior High School', 'Ashanti'], ['Tamale Senior High School', 'Northern'], ['Cape Coast Senior High School', 'Central'], ['Takoradi Senior High School', 'Western'], ['Ho Senior High School', 'Volta']].map(([name, region], i) => ({ id: 's' + (i + 1), name, region }));
  const names = ['Samuel Mensah', 'Ibrahim Mohammed', 'Emmanuel Osei', 'Ama Boateng', 'Kofi Annan', 'Esi Quansah', 'Yaw Darko', 'Fatima Alhassan', 'Kwame Asante', 'Akosua Owusu'];
  const cadets = [], ranks = [];
  schools.forEach(s => BR.forEach(b => ['Cadet', 'Corporal', 'Sergeant', 'Under Officer'].forEach((n, o) => ranks.push({ id: uid(), school_id: s.id, branch_id: b.id, name: n, order: o }))));
  schools.forEach(s => names.forEach((n, i) => { const b = BR[i % 5].id, r = ranks.find(r => r.school_id === s.id && r.branch_id === b); cadets.push({ id: uid(), school_id: s.id, name: n, gender: i % 3 ? 'Male' : 'Female', year: 'Form ' + (1 + i % 3), branch_id: b, rank_id: r.id }); }));
  const profiles = [{ id: 'm1', email: 'master@cadet.gh', password: 'password', role: 'super_admin', school_id: null, name: 'Master Admin' }];
  schools.forEach(s => { profiles.push({ id: uid(), email: `oc@${s.id}.gh`, password: 'password', role: 'oc', school_id: s.id, name: 'Officer Commanding' }, { id: uid(), email: `ic1@${s.id}.gh`, password: 'password', role: 'ic', school_id: s.id, name: 'Instructor One' }); });
  const ms = { id: 'ms1', school_id: 's1', title: 'Morning Parade', date: '2026-10-20' };
  const codes = {}; schools.forEach(s => codes[s.id] = { admin: '1234', cadet: '5678', fails: 0, until: 0 });
  return {
    schools, cadets, ranks, branches: BR, profiles, codes, muster_sessions: [ms],
    muster_records: cadets.filter(c => c.school_id === 's1').map((c, i) => ({ id: uid(), session_id: 'ms1', cadet_id: c.id, status: i % 5 ? 'present' : 'absent', note: '' })),
    announcements: [{ id: uid(), school_id: 's1', title: 'Inter-House Drill Competition', body: 'Next Friday at 7:00 AM on the parade ground.', pinned: true, expires_at: '', created_at: '2026-10-15' }]
  };
})();

const api = {
  async list(t, f = {}) {
    if (sb) { let q = sb.from(t).select(t === 'schools' ? SCHOOL_COLS : '*'); Object.entries(f).forEach(([k, v]) => q = q.eq(k, v)); const { data, error } = await q; if (error) throw error; return data; }
    await sleep(300); return mock[t].filter(r => Object.entries(f).every(([k, v]) => r[k] === v)).map(r => ({ ...r }));
  },
  async save(t, row) {
    if (sb) { const { data, error } = await sb.from(t).upsert(row).select(t === 'schools' ? SCHOOL_COLS : '*').single(); if (error) throw error; return data; }
    await sleep(150); const i = row.id ? mock[t].findIndex(r => r.id === row.id) : -1;
    if (i >= 0) Object.assign(mock[t][i], row); else { row = { ...row, id: row.id || uid() }; mock[t].push(row); if (t === 'schools') mock.codes[row.id] = { admin: '', cadet: '', fails: 0, until: 0 }; } return row;
  },
  async del(t, id) { if (sb) { const { error } = await sb.from(t).delete().eq('id', id); if (error) throw error; return; } await sleep(100); mock[t] = mock[t].filter(r => r.id !== id); },
  async delWhere(t, k, v) { if (sb) { const { error } = await sb.from(t).delete().eq(k, v); if (error) throw error; return; } mock[t] = mock[t].filter(r => r[k] !== v); },
  async saveMany(t, rows) { if (sb) { const { error } = await sb.from(t).upsert(rows); if (error) throw error; return; } rows.forEach(r => mock[t].push({ ...r, id: r.id || uid() })); },
  async verify(school, code, kind) { // verify_school_code(p_school, p_code, 'admin' | 'cadet')
    if (sb) { const { data, error } = await sb.rpc('verify_school_code', { p_school: school, p_code: code, p_role: kind }); if (error) throw error; return data === true; }
    await sleep(300); const c = mock.codes[school];
    if (Date.now() < c.until) throw new Error('blocked: too many attempts');
    if (c[kind] && c[kind] === code) { c.fails = 0; return true; }
    if (++c.fails >= 5) { c.until = Date.now() + 15 * 60000; c.fails = 0; throw new Error('blocked: too many attempts'); } return false;
  },
  async cadetAnn(school, code) {
    if (sb) { const { data, error } = await sb.rpc('cadet_view_announcements', { p_school: school, p_code: code }); if (error) throw error; return data; }
    return mock.announcements.filter(a => a.school_id === school && (!a.expires_at || a.expires_at >= new Date().toISOString().slice(0, 10)));
  },
  async setCodes(school, admin, cadet) {
    if (sb) { const { error } = await sb.rpc('set_school_codes', { p_school: school, p_admin_code: admin || null, p_cadet_code: cadet || null }); if (error) throw error; return; }
    if (admin) mock.codes[school].admin = admin; if (cadet) mock.codes[school].cadet = cadet;
  },
  async signIn(email, password) {
    if (sb) { const { data, error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw error; const p = await api.list('profiles', { id: data.user.id }); return p[0]; }
    await sleep(300); const p = mock.profiles.find(p => p.email === email && p.password === password); if (!p) throw new Error('Invalid email or password'); return { ...p };
  },
  async signOut() { if (sb) await sb.auth.signOut(); },
  async changePassword(pw) { if (sb) { const { error } = await sb.auth.updateUser({ password: pw }); if (error) throw error; } }
};

/* ================= STATE + HELPERS ================= */
const S = { user: null, schools: null, mode: 'admin', school: null, cadetAnn: null, muster: null, f: { q: '', b: '' } };
const toast = (m, t = 'ok') => { const d = document.createElement('div'); d.className = 'toast ' + t; d.textContent = m; $('#toasts').append(d); setTimeout(() => d.remove(), 3500); };
const modal = h => { $('#modal').innerHTML = h ? `<div class="ov" data-act="ovclose"><div class="box">${h}</div></div>` : ''; };
const confirmBox = msg => new Promise(res => { modal(`<h3>Please confirm</h3><p>${esc(msg)}</p><div class="bar"><button class="btn ghost" id="cn">Cancel</button><button class="btn red" id="cy">Confirm</button></div>`); $('#cn').onclick = () => { modal(); res(false); }; $('#cy').onclick = () => { modal(); res(true); }; });
const skel = n => '<div class="skel"></div>'.repeat(n);
const crest = s => `<span class="crest"><img src="logos/${esc(s.id)}.png" alt="" onerror="this.remove()"><b>${esc(s.name.split(' ').filter(w => /^[A-Z]/.test(w)).slice(0, 2).map(w => w[0]).join('')) }</b></span>`;
const go = h => { location.hash = h; };
const brName = id => (BR.find(b => b.id === id) || {}).name || id;
const csvDownload = (name, rows) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' })); a.download = name; a.click(); };
const rand = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const pct = (recs, n) => n ? Math.round(recs.filter(r => r.status === 'present' || r.status === 'late').length / n * 100) : 0;
const set = h => { $('#app').innerHTML = h; };
const setMain = h => { const m = $('#main'); if (m) m.innerHTML = h; };
const catchUi = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message || 'Something went wrong', 'err'); } };

/* ================= ROUTER ================= */
let idleTimer;
function armIdle() { clearTimeout(idleTimer); if (!S.user || S.user.role === 'super_admin') return; idleTimer = setTimeout(async () => { const id = S.user.school_id; await api.signOut(); S.user = null; toast('Signed out after 30 minutes of inactivity', 'err'); go(`#/school/${id}/login`); }, 30 * 60000); }
['click', 'keydown', 'mousemove', 'touchstart'].forEach(e => addEventListener(e, armIdle, { passive: true }));

async function route() {
  modal(); const p = location.hash.replace(/^#\/?/, '').split('/');
  try {
    if (!p[0]) return front();
    if (p[0] === 'cadet') return cadetPage();
    if (p[0] === 'schools') return schoolsPage();
    if (p[0] === 'access') return accessPage(p[1]);
    if (p[0] === 'master') { if (p[1] === 'login') return loginPage(null); if (!S.user || S.user.role !== 'super_admin') return go('#/master/login'); return masterShell(p[1] || 'dash'); }
    if (p[0] === 'school') {
      const id = p[1]; if (p[2] === 'login') return loginPage(id);
      if (!S.user || S.user.school_id !== id || !['oc', 'ic'].includes(S.user.role)) { if (!(S.user && S.user.role === 'super_admin')) return go(`#/school/${id}/login`); }
      return schoolShell(id, p[2] || 'overview', p[3]);
    }
    go('#/');
  } catch (e) { toast(e.message, 'err'); }
}
addEventListener('hashchange', route);

/* ================= PUBLIC FRONT PAGE ================= */
function hdr(back, on) { return `<div class="hdr"><div class="brand"><span class="crest" style="width:48px;height:54px"><b>★</b></span><div><b>Cadet Management System</b><small>Discipline • Leadership • Service</small></div></div><nav>${back ? '<a class="btn" href="#/schools">← Back</a>' : `<a class="${on === 'h' ? 'on' : ''}" href="#/">Home</a><a data-act="scroll" data-t="about">About</a><a data-act="scroll" data-t="contact">Contact</a><a class="btn" href="#/schools">Access School</a>`}</nav></div>`; }
function front() {
  set(`<div class="frame">${hdr(false, 'h')}
  <section class="hero2"><div><h1>GHANA CADET<br>MANAGEMENT SYSTEM</h1><p>A unified platform for all Ghanaian schools to manage, store and track cadet information securely.</p><a class="btn" href="#/schools">Access School →</a></div><div class="motto"><i>One Nation</i><i>One Discipline</i><i>One Future</i></div></section>
  <div class="sect"><h4>Cadets by Service</h4><div class="tiles"><div class="tile t1"><span>⚔</span>ARMY</div><div class="tile t2"><span>✈</span>AIR FORCE</div><div class="tile t3"><span>🛡</span>POLICE</div><div class="tile t4"><span>⚓</span>NAVY</div><div class="tile t5"><span>🛂</span>IMMIGRATION</div></div></div>
  <div class="trust" id="about"><div>🛡 <span><b>Secure</b><small>Your data is protected</small></span></div><div>✔ <span><b>Reliable</b><small>Built for all schools</small></span></div><div>🌍 <span><b>Nationwide</b><small>For a stronger Ghana</small></span></div><div>🇬🇭 <span><b>Ghana Cadet Management System</b><small>Ministry of Education | Ghana</small></span></div></div>
  <footer id="contact">Contact: your Ministry / school administrator · <a href="#/master/login">Master Admin</a></footer></div>`);
}
async function schoolsPage() {
  set(`<div class="frame">${hdr(true)}<div class="accbox"><div style="font-size:2.2rem">🏛</div><h2>Access Your School</h2><p style="color:var(--mut)">Search for your school and enter your access key to continue</p><input id="q" placeholder="🔍 Search for your school..."><div id="sg">${skel(4)}</div></div><footer>© 2026 Ghana Cadet Management System. All rights reserved.</footer></div>`);
  const draw = () => { const q = $('#q').value.toLowerCase(); const l = S.schools.filter(s => (s.name + s.region).toLowerCase().includes(q)); $('#sg').innerHTML = l.length ? l.map(s => `<div class="srow" data-act="pick" data-id="${esc(s.id)}">${crest(s)}<div><b>${esc(s.name)}</b><small>${esc(s.region)}</small></div><span>›</span></div>`).join('') : '<div class="empty">No schools match your search.</div>'; };
  S.schools = await api.list('schools'); draw(); $('#q').oninput = draw;
}
async function accessPage(id) { if (!S.schools) S.schools = await api.list('schools'); S.school = S.schools.find(s => s.id === id); if (!S.school) return go('#/schools'); S.mode = 'admin'; codeModal(); }
function codeModal() {
  const c = S.mode === 'cadet';
  set(`<div class="frame">${hdr(true)}<div class="accbox keybox">${crest(S.school)}<h2>${esc(S.school.name)}</h2><span class="badge">${esc(S.school.region)}</span>
  <p>${c ? 'Enter the cadet code to view announcements' : 'Enter access code for ' + esc(S.school.name)}</p>
  <form data-form="code"><div class="kin"><i>🔒</i><input type="password" name="code" placeholder="${c ? 'Cadet Code' : 'Access Code'}" autocomplete="off" required></div><button class="btn">Continue</button></form>
  <p><a data-act="togmode">${c ? 'I am school staff' : "I'm a cadet: view announcements"}</a></p><small style="color:var(--mut)">Only authorized personnel can access this portal.</small></div><footer>© 2026 Ghana Cadet Management System. All rights reserved.</footer></div>`);
}
const submitCode = catchUi(async f => {
  const code = f.code.value, id = S.school.id, cadet = S.mode === 'cadet';
  try {
    const ok = await api.verify(id, code, cadet ? 'cadet' : 'admin');
    if (!ok) { f.code.value = ''; return toast('Invalid code', 'err'); }
    if (cadet) { S.cadetAnn = { school: S.school, items: await api.cadetAnn(id, code) }; f.code.value = ''; return go('#/cadet/' + id); }
    f.code.value = ''; go(`#/school/${id}/login`);
  } catch (e) { f.code.value = ''; if (/block|attempt|locked/i.test(e.message)) toast('Too many wrong attempts. Try again in 15 minutes.', 'err'); else throw e; }
});
function cadetPage() {
  const a = S.cadetAnn; if (!a) return go('#/');
  const items = [...a.items].sort((x, y) => (y.pinned ? 1 : 0) - (x.pinned ? 1 : 0));
  set(`<div class="wrap"><div class="top"><h2>${esc(a.school.name)}: Announcements</h2><button class="btn ghost sm" data-act="leave">Exit</button></div>
  ${items.length ? items.map(annCard).join('') : '<div class="empty">No announcements right now.</div>'}</div>`);
}
const annCard = a => `<div class="card" style="margin:.7rem 0"><h3>${a.pinned ? '<span class="pin">📌</span> ' : ''}${esc(a.title)}</h3><p>${esc(a.body)}</p><small style="color:var(--mut)">${esc(a.created_at || '')}${a.expires_at ? ' · expires ' + esc(a.expires_at) : ''}</small></div>`;

/* ================= LOGIN (staff + master) ================= */
async function loginPage(schoolId) {
  let name = 'Master Admin'; if (schoolId) { if (!S.schools) S.schools = await api.list('schools'); const s = S.schools.find(s => s.id === schoolId); if (!s) return go('#/'); name = s.name; }
  set(`<div class="center card"><h2>${esc(name)}</h2><p style="color:var(--mut)">${schoolId ? 'Staff sign in' : 'Super Admin sign in'}</p>
  <form data-form="login" data-school="${esc(schoolId || '')}"><label>Email</label><input name="email" type="email" required><label>Password</label><input name="password" type="password" required><br><br><button class="btn" style="width:100%">Sign in</button></form>
  <p><a href="#/">← Back</a></p>${sb ? '' : '<small style="color:var(--mut)">Demo: oc@s1.gh / password · master@cadet.gh / password</small>'}</div>`);
}
const doLogin = catchUi(async f => {
  const sid = f.dataset.school; const p = await api.signIn(f.email.value.trim(), f.password.value);
  const okRole = sid ? (p.school_id === sid && ['oc', 'ic'].includes(p.role)) : p.role === 'super_admin';
  if (!okRole) { await api.signOut(); S.user = null; return toast('No access', 'err'); }
  S.user = p; armIdle(); go(sid ? `#/school/${sid}/overview` : '#/master/dash');
});

/* ================= SCHOOL PANEL ================= */
const NAV = [['overview', 'Overview'], ['cadets', 'Cadet Data'], ['musters', 'Musters'], ['announcements', 'Announcements'], ['team', 'Admin Team'], ['ranks', 'Ranks'], ['settings', 'Settings']];
async function schoolShell(id, tab, sub) {
  if (!S.schools) S.schools = await api.list('schools'); const sc = S.schools.find(s => s.id === id); if (!sc) return go('#/');
  S.school = sc; const isOC = S.user.role === 'oc' || S.user.role === 'super_admin';
  const IC = { overview: '🏠', cadets: '👥', musters: '📋', announcements: '📢', team: '🛡', ranks: '⭐', settings: '⚙' };
  set(`<div class="shell"><nav class="side"><div class="sbrand">${crest(sc)}<div><b>${esc(sc.name)}</b><small>Cadet Management System</small></div></div>
  <div class="me"><i>${esc((S.user.name || 'A')[0])}</i><div><b>${esc(S.user.name || 'Admin')}</b><small>${S.user.role === 'oc' ? 'Officer Commanding' : S.user.role === 'ic' ? 'Instructor' : 'Super Admin'}</small><em>● Online</em></div></div>
  ${NAV.map(([k, l]) => `<a href="#/school/${id}/${k}" class="${k === tab ? 'on' : ''}">${IC[k]}&nbsp; ${l}</a>`).join('')}<a class="lo" data-act="logout">⇦&nbsp; Logout</a></nav>
  <div class="col"><div class="tb"><span>☰ <b>${(NAV.find(n => n[0] === tab) || [0, 'Dashboard'])[1]}</b></span><span>${esc(sc.name)} <i class="badge">${esc(sc.region)}</i> 🔔 ${crest(sc)}</span></div><main class="main" id="main">${skel(4)}</main></div></div>`);
  const v = { overview, cadets, musters, announcements, team: () => team(isOC), ranks, settings: () => settings(isOC) }[tab];
  if (!v) return go(`#/school/${id}/overview`); await catchUi(() => v(id, sub))();
}
async function overview(id) {
  const [cd, ms, an] = await Promise.all([api.list('cadets', { school_id: id }), api.list('muster_sessions', { school_id: id }), api.list('announcements', { school_id: id })]);
  const last = ms.sort((a, b) => b.date.localeCompare(a.date))[0]; let ap = '–';
  if (last) { const r = await api.list('muster_records', { session_id: last.id }); ap = pct(r, cd.length) + '%'; }
  const la = an.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0];
  const m = cd.filter(c => c.gender === 'Male').length, lastAnn = an.slice(0, 3);
  const st = (i, c, l, n) => `<div class="card stat2"><i class="ic ${c}">${i}</i><div><small>${l}</small><b>${n}</b></div></div>`;
  setMain(`<div class="banner"><h2>Welcome, ${esc(S.user.name || 'Admin')}!</h2><p>${esc(S.school.name)} Cadet Portal<br>Discipline • Leadership • Service</p></div>
  <div class="stats">${st('👥', '', 'Total Cadets', cd.length)}${st('🛡', '', 'Last Muster', ap)}${st('🙋', 'b', 'Male', m)}${st('🙋', 'p', 'Female', cd.length - m)}</div>
  <div class="stats">${BR.map(b => `<div class="card stat"><small>${b.name}</small><b>${cd.filter(c => c.branch_id === b.id).length}</b></div>`).join('')}</div>
  <h3>Quick Actions</h3><div class="qa"><a class="q1" href="#/school/${id}/cadets">＋ Add Cadet</a><a class="q2" href="#/school/${id}/cadets">View Cadets</a><a class="q3" href="#/school/${id}/announcements">Announcements</a><a class="q4" href="#/school/${id}/musters">Musters</a></div>
  <div class="two"><div class="card"><h3>Recent Musters</h3>${ms.length ? ms.slice(0, 4).map(x => `<div class="row"><span>${esc(x.title)}</span><small>${esc(x.date)}</small></div>`).join('') : '<div class="empty">No musters yet.</div>'}</div>
  <div class="card"><h3>Latest Announcements</h3>${lastAnn.length ? lastAnn.map(x => `<div class="row"><span>${x.pinned ? '📌 ' : ''}${esc(x.title)}</span><small>${esc(x.created_at || '')}</small></div>`).join('') : '<div class="empty">No announcements yet.</div>'}</div></div>`);
}
async function cadets(id, sub) {
  if (sub) return cadetProfile(id, sub);
  const [cd, rk] = await Promise.all([api.list('cadets', { school_id: id }), api.list('ranks', { school_id: id })]); S.cd = cd; S.rk = rk;
  const q = S.f.q.toLowerCase(), l = cd.filter(c => c.name.toLowerCase().includes(q) && (!S.f.b || c.branch_id === S.f.b));
  const rn = rid => (rk.find(r => r.id === rid) || {}).name || '–';
  setMain(`<div class="top"><h2>Cadet Data</h2><div><button class="btn ghost sm" data-act="csv">Export CSV</button> <button class="btn sm" data-act="cadetform">+ Add cadet</button></div></div>
  <div class="bar"><input id="cq" placeholder="Search name..." value="${esc(S.f.q)}"><select id="cb"><option value="">All branches</option>${BR.map(b => `<option value="${b.id}" ${S.f.b === b.id ? 'selected' : ''}>${b.name}</option>`).join('')}</select></div>
  ${l.length ? `<div class="card" style="overflow:auto"><table><tr><th>Name</th><th>Branch</th><th>Rank</th><th>Gender</th><th>Year</th><th></th></tr>${l.map(c => `<tr><td><a href="#/school/${id}/cadets/${c.id}">${esc(c.name)}</a></td><td>${brName(c.branch_id)}</td><td>${esc(rn(c.rank_id))}</td><td>${c.gender}</td><td>${esc(c.year)}</td><td><button class="btn ghost sm" data-act="cadetform" data-id="${c.id}">Edit</button> <button class="btn red sm" data-act="cadetdel" data-id="${c.id}">Remove</button></td></tr>`).join('')}</table></div>` : '<div class="empty">No cadets found.</div>'}`);
  $('#cq').oninput = e => { S.f.q = e.target.value; cadets(id); setTimeout(() => { const i = $('#cq'); i.focus(); i.setSelectionRange(99, 99); }); }; $('#cb').onchange = e => { S.f.b = e.target.value; cadets(id); };
}
function cadetForm(c = {}) {
  const rk = S.rk, branch = c.branch_id || 'army';
  modal(`<h3>${c.id ? 'Edit' : 'Add'} cadet</h3><form data-form="cadet"><input type="hidden" name="id" value="${c.id || ''}"><label>Full name</label><input name="name" required value="${esc(c.name)}">
  <label>Branch</label><select name="branch_id" id="bsel">${BR.map(b => `<option value="${b.id}" ${b.id === branch ? 'selected' : ''}>${b.name}</option>`).join('')}</select>
  <label>Rank</label><select name="rank_id" id="rsel"></select><label>Gender</label><select name="gender"><option>Male</option><option ${c.gender === 'Female' ? 'selected' : ''}>Female</option></select>
  <label>Year / Form</label><input name="year" value="${esc(c.year || 'Form 1')}"><br><br><div class="bar"><button type="button" class="btn ghost" data-act="close">Cancel</button><button class="btn">Save</button></div></form>`);
  const fill = () => { $('#rsel').innerHTML = rk.filter(r => r.branch_id === $('#bsel').value).sort((a, b) => a.order - b.order).map(r => `<option value="${r.id}" ${r.id === c.rank_id ? 'selected' : ''}>${esc(r.name)}</option>`).join(''); }; $('#bsel').onchange = fill; fill();
}
async function cadetProfile(id, cid) {
  const [c] = await api.list('cadets', { id: cid }); const [ms, rec] = await Promise.all([api.list('muster_sessions', { school_id: id }), api.list('muster_records', { cadet_id: cid })]);
  setMain(`<a href="#/school/${id}/cadets">← Back</a><h2>${esc(c.name)}</h2><p style="color:var(--mut)">${brName(c.branch_id)} · ${esc(c.year)} · ${c.gender}</p><h3>Attendance history (${pct(rec, rec.length)}%)</h3>
  ${rec.length ? `<div class="card"><table><tr><th>Muster</th><th>Date</th><th>Status</th><th>Note</th></tr>${rec.map(r => { const m = ms.find(m => m.id === r.session_id) || {}; return `<tr><td>${esc(m.title)}</td><td>${esc(m.date)}</td><td>${r.status}</td><td>${esc(r.note)}</td></tr>`; }).join('')}</table></div>` : '<div class="empty">No attendance records yet.</div>'}`);
}

/* ----- Musters ----- */
async function musters(id) {
  if (S.muster) return musterEditor(id);
  const [ms, cd] = await Promise.all([api.list('muster_sessions', { school_id: id }), api.list('cadets', { school_id: id })]); const recs = await api.list('muster_records');
  setMain(`<div class="top"><h2>Musters</h2><button class="btn sm" data-act="newmuster">+ New Muster</button></div>${ms.length ? `<div class="card"><table><tr><th>Title</th><th>Date</th><th>Attendance</th></tr>${ms.sort((a, b) => b.date.localeCompare(a.date)).map(m => `<tr><td>${esc(m.title)}</td><td>${esc(m.date)}</td><td>${pct(recs.filter(r => r.session_id === m.id), cd.length)}%</td></tr>`).join('')}</table></div>` : '<div class="empty">No musters yet. Create the first one.</div>'}`);
}
async function musterEditor(id) {
  const cd = S.muster.cadets || (S.muster.cadets = await api.list('cadets', { school_id: id })), m = S.muster;
  const row = c => { const r = m.recs[c.id] || (m.recs[c.id] = { status: 'present', note: '' }); return `<tr><td>${esc(c.name)}</td><td><div class="seg">${[['P', 'present'], ['A', 'absent'], ['L', 'late'], ['E', 'excused']].map(([k, s]) => `<button class="${k} ${r.status === s ? 'on' : ''}" data-act="mark" data-c="${c.id}" data-s="${s}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}</div></td><td><input data-note="${c.id}" value="${esc(r.note)}" placeholder="Optional note"></td></tr>`; };
  setMain(`<div class="top"><h2>${esc(m.title)} · ${esc(m.date)}</h2><div><button class="btn ghost sm" data-act="allp">Mark all present</button> <button class="btn ghost sm" data-act="mcancel">Cancel</button> <button class="btn sm" data-act="msave">Save</button></div></div><div class="card" style="overflow:auto"><table>${cd.map(row).join('')}</table></div>`);
}

/* ----- Announcements ----- */
async function announcements(id) {
  const an = (await api.list('announcements', { school_id: id })).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)); S.an = an;
  setMain(`<div class="top"><h2>Announcements</h2><button class="btn sm" data-act="annform">+ New</button></div>${an.length ? an.map(a => `<div>${annCard(a)}<button class="btn ghost sm" data-act="annpin" data-id="${a.id}">${a.pinned ? 'Unpin' : 'Pin'}</button> <button class="btn ghost sm" data-act="annform" data-id="${a.id}">Edit</button> <button class="btn red sm" data-act="anndel" data-id="${a.id}">Delete</button></div>`).join('') : '<div class="empty">No announcements yet.</div>'}`);
}
function annForm(a = {}) {
  modal(`<h3>${a.id ? 'Edit' : 'New'} announcement</h3><form data-form="ann"><input type="hidden" name="id" value="${a.id || ''}"><label>Title</label><input name="title" required value="${esc(a.title)}"><label>Body</label><textarea name="body" rows="4" required>${esc(a.body)}</textarea>
  <label>Expiry date (optional)</label><input type="date" name="expires_at" value="${esc(a.expires_at)}"><label><input type="checkbox" name="pinned" style="width:auto" ${a.pinned ? 'checked' : ''}> Pin to top</label>
  <h4>Cadet preview</h4><div id="pv"></div><div class="bar"><button type="button" class="btn ghost" data-act="close">Cancel</button><button class="btn">Save</button></div></form>`);
  const f = $('[data-form=ann]'), pv = () => { $('#pv').innerHTML = annCard({ title: f.title.value || 'Title', body: f.body.value || 'Message...', pinned: f.pinned.checked, expires_at: f.expires_at.value }); }; f.oninput = pv; pv();
}

/* ----- Team / Ranks / Settings ----- */
async function team(isOC) {
  const id = S.school.id, ps = (await api.list('profiles', { school_id: id })).filter(p => ['oc', 'ic'].includes(p.role)); S.team = ps; const ics = ps.filter(p => p.role === 'ic');
  setMain(`<h2>Admin Team</h2>${ps.length ? ps.map(p => `<div class="card top" style="margin:.5rem 0"><div><b>${esc(p.name || p.email)}</b><br><small style="color:var(--mut)">${esc(p.email)} · ${p.role.toUpperCase()}</small></div>${isOC && p.role === 'ic' ? `<button class="btn red sm" data-act="icdel" data-id="${p.id}">Remove</button>` : ''}</div>`).join('') : '<div class="empty">No staff assigned.</div>'}
  ${isOC ? (ics.length < 2 ? '<button class="btn sm" data-act="icform">+ Add / replace IC</button>' : '<p style="color:var(--mut)">Two ICs assigned. Remove one to add another.</p>') : '<p style="color:var(--mut)">Only the OC can change the team.</p>'}`);
}
async function ranks(id) {
  const rk = await api.list('ranks', { school_id: id }); S.rk = rk;
  setMain(`<h2>Ranks</h2>${BR.map(b => { const l = rk.filter(r => r.branch_id === b.id).sort((a, c) => a.order - c.order); return `<div class="card" style="margin:.7rem 0"><h3>${b.name}</h3>${l.length ? l.map((r, i) => `<div class="top" style="padding:.25rem 0"><span>${esc(r.name)}</span><span><button class="btn ghost sm" data-act="rkmove" data-id="${r.id}" data-d="-1" ${i ? '' : 'disabled'}>↑</button> <button class="btn ghost sm" data-act="rkmove" data-id="${r.id}" data-d="1" ${i < l.length - 1 ? '' : 'disabled'}>↓</button> <button class="btn ghost sm" data-act="rkren" data-id="${r.id}">Rename</button> <button class="btn red sm" data-act="rkdel" data-id="${r.id}">Delete</button></span></div>`).join('') : '<div class="empty">No ranks.</div>'}<button class="btn sm" data-act="rkadd" data-b="${b.id}">+ Add rank</button></div>`; }).join('')}`);
}
async function settings(isOC) {
  setMain(`<h2>Settings</h2><div class="card"><h3>Profile</h3><p>${esc(S.user.name || '')} · ${esc(S.user.email)} · ${S.user.role.toUpperCase()}</p></div>
  <div class="card" style="margin:1rem 0"><h3>Change password</h3><form data-form="pw"><input type="password" name="pw" minlength="8" placeholder="New password (8+ chars)" required><br><br><button class="btn sm">Update</button></form></div>
  ${isOC ? `<div class="card"><h3>Access codes</h3><p style="color:var(--mut)">Codes are never shown. Leave a field blank to keep it unchanged.</p><form data-form="codes"><label>New Access Code (staff)</label><input type="password" name="admin" autocomplete="off"><label>New Cadet Code</label><input type="password" name="cadet" autocomplete="off"><br><br><button class="btn sm">Change codes</button></form></div>` : '<p style="color:var(--mut)">Only the OC can change codes.</p>'}`);
}

/* ================= MASTER PANEL ================= */
async function masterShell(tab) {
  set(`<div class="shell"><nav class="side"><h3 style="color:var(--gold2)">Master Admin</h3>${[['dash', 'National Dashboard'], ['schools', 'Schools'], ['cadets', 'Browse Cadets']].map(([k, l]) => `<a href="#/master/${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}<a data-act="logout">Sign out</a></nav><main class="main" id="main">${skel(4)}</main></div>`);
  await catchUi(async () => {
    S.schools = await api.list('schools');
    if (tab === 'dash') {
      const cd = await api.list('cadets'); const per = S.schools.map(s => [s, cd.filter(c => c.school_id === s.id).length]).sort((a, b) => b[1] - a[1]);
      setMain(`<h2>National Dashboard</h2><div class="stats"><div class="card stat"><b>${cd.length}</b>Total cadets</div><div class="card stat"><b>${S.schools.length}</b>Schools</div>${BR.map(b => `<div class="card stat"><b>${cd.filter(c => c.branch_id === b.id).length}</b>${b.name}</div>`).join('')}</div>
      <div class="grid"><div class="card"><h3>Cadets per school</h3>${per.map(([s, n]) => `<div class="top"><span>${esc(s.name)}</span><b>${n}</b></div>`).join('') || '<div class="empty">No data.</div>'}</div><div class="card"><h3>Newest schools</h3>${S.schools.slice(-5).reverse().map(s => `<div>${esc(s.name)} <small style="color:var(--mut)">${esc(s.region)}</small></div>`).join('')}</div></div>`);
    } else if (tab === 'schools') {
      setMain(`<div class="top"><h2>Schools</h2><div><label class="btn ghost sm" style="display:inline-block;margin:0">Import CSV<input type="file" accept=".csv" id="imp" hidden></label> <button class="btn sm" data-act="schform">+ Add school</button></div></div><p style="color:var(--mut)">CSV columns: name,region. Logos go in the /logos folder as {school_id}.png.</p>
      ${S.schools.length ? `<div class="card" style="overflow:auto"><table><tr><th>School</th><th>Region</th><th>ID</th><th></th></tr>${S.schools.map(s => `<tr><td>${esc(s.name)}</td><td>${esc(s.region)}</td><td><small>${esc(s.id)}</small></td><td><button class="btn ghost sm" data-act="schform" data-id="${s.id}">Edit</button> <button class="btn ghost sm" data-act="mcodes" data-id="${s.id}">Codes</button> <button class="btn ghost sm" data-act="mstaff" data-id="${s.id}">Staff</button> <button class="btn red sm" data-act="schdel" data-id="${s.id}">Delete</button></td></tr>`).join('')}</table></div>` : '<div class="empty">No schools yet.</div>'}`);
      $('#imp').onchange = catchUi(async e => { const rows = (await e.target.files[0].text()).split(/\r?\n/).map(l => l.split(',').map(x => x.replace(/^"|"$/g, '').trim())).filter(r => r[0] && r[0].toLowerCase() !== 'name'); const keys = [['school_id', 'name', 'access_code', 'cadet_code']]; for (const [name, region] of rows) { const s = await api.save('schools', { name, region: region || '' }); const a = rand(), c = rand(); await api.setCodes(s.id, a, c); keys.push([s.id, name, a, c]); } csvDownload('school-codes-KEEP-SAFE.csv', keys); toast(`${rows.length} schools imported. Codes file downloaded.`); masterShell('schools'); });
    } else {
      if (!S.msel) S.msel = S.schools[0]?.id; const cd = S.msel ? await api.list('cadets', { school_id: S.msel }) : []; S.rk = S.msel ? await api.list('ranks', { school_id: S.msel }) : [];
      setMain(`<h2>Browse Cadets</h2><div class="bar"><select id="msel">${S.schools.map(s => `<option value="${s.id}" ${s.id === S.msel ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select><button class="btn sm" data-act="cadetform">+ Add</button></div>
      ${cd.length ? `<div class="card" style="overflow:auto"><table><tr><th>Name</th><th>Branch</th><th>Gender</th><th>Year</th><th></th></tr>${cd.map(c => `<tr><td>${esc(c.name)}</td><td>${brName(c.branch_id)}</td><td>${c.gender}</td><td>${esc(c.year)}</td><td><button class="btn ghost sm" data-act="cadetform" data-id="${c.id}">Edit</button></td></tr>`).join('')}</table></div>` : '<div class="empty">No cadets.</div>'}`);
      S.cd = cd; $('#msel').onchange = e => { S.msel = e.target.value; masterShell('cadets'); };
    }
  })();
}

/* ================= EVENT DELEGATION ================= */
const refresh = () => route();
const A = {
  scroll(el) { const t = document.getElementById(el.dataset.t); if (t) t.scrollIntoView({ behavior: 'smooth' }); },
  pick(el) { go('#/access/' + el.dataset.id); },
  togmode() { S.mode = S.mode === 'cadet' ? 'admin' : 'cadet'; codeModal(); },
  close() { modal(); }, ovclose(el, e) { if (e.target === el) modal(); },
  leave() { S.cadetAnn = null; go('#/'); },
  async logout() { const sid = S.user.school_id; await api.signOut(); S.user = null; go(sid ? `#/school/${sid}/login` : '#/master/login'); },
  csv() { csvDownload('cadets.csv', [['Name', 'Branch', 'Gender', 'Year'], ...S.cd.map(c => [c.name, brName(c.branch_id), c.gender, c.year])]); },
  cadetform(el) { cadetForm(S.cd.find(c => c.id === el.dataset.id)); },
  async cadetdel(el) { if (await confirmBox('Remove this cadet? This cannot be undone.')) { await api.del('cadets', el.dataset.id); toast('Cadet removed'); refresh(); } },
  newmuster() { modal(`<h3>New Muster</h3><form data-form="muster"><label>Title</label><input name="title" required><label>Date</label><input type="date" name="date" required value="${new Date().toISOString().slice(0, 10)}"><br><br><button class="btn">Start</button></form>`); },
  mark(el) { S.muster.recs[el.dataset.c].status = el.dataset.s; syncNotes(); musterEditor(S.school.id); },
  allp() { Object.values(S.muster.recs).forEach(r => r.status = 'present'); (S.muster.cadets || []).forEach(c => S.muster.recs[c.id] = { status: 'present', note: (S.muster.recs[c.id] || {}).note || '' }); syncNotes(); musterEditor(S.school.id); },
  mcancel() { S.muster = null; refresh(); },
  msave: catchUi(async () => { syncNotes(); const m = S.muster, s = await api.save('muster_sessions', { school_id: S.school.id, title: m.title, date: m.date }); await api.saveMany('muster_records', Object.entries(m.recs).map(([cid, r]) => ({ session_id: s.id, cadet_id: cid, status: r.status, note: r.note }))); S.muster = null; toast('Muster saved'); refresh(); }),
  annform(el) { annForm((S.an || []).find(a => a.id === el.dataset.id)); },
  annpin: catchUi(async el => { const a = S.an.find(a => a.id === el.dataset.id); await api.save('announcements', { id: a.id, pinned: !a.pinned }); refresh(); }),
  async anndel(el) { if (await confirmBox('Delete this announcement?')) { await api.del('announcements', el.dataset.id); toast('Deleted'); refresh(); } },
  icform() { modal(`<h3>Add / replace IC</h3><form data-form="ic"><label>IC email (must have a Supabase Auth account)</label><input type="email" name="email" required><label>Name</label><input name="name"><br><br><button class="btn">Assign</button></form>`); },
  async icdel(el) { if (await confirmBox('Remove this IC from the school?')) { await api.save('profiles', { id: el.dataset.id, school_id: null, role: 'none' }); toast('IC removed'); refresh(); } },
  rkadd(el) { modal(`<h3>Add rank</h3><form data-form="rk" data-b="${el.dataset.b}"><input name="name" required placeholder="Rank name"><br><br><button class="btn">Add</button></form>`); },
  rkren(el) { const r = S.rk.find(r => r.id === el.dataset.id); modal(`<h3>Rename rank</h3><form data-form="rkren" data-id="${r.id}"><input name="name" required value="${esc(r.name)}"><br><br><button class="btn">Save</button></form>`); },
  async rkdel(el) { if (await confirmBox('Delete this rank?')) { await api.del('ranks', el.dataset.id); toast('Rank deleted'); refresh(); } },
  rkmove: catchUi(async el => { const r = S.rk.find(r => r.id === el.dataset.id), l = S.rk.filter(x => x.branch_id === r.branch_id).sort((a, b) => a.order - b.order), i = l.indexOf(r), o = l[i + +el.dataset.d]; if (!o) return; await api.save('ranks', { id: r.id, order: o.order === r.order ? o.order + +el.dataset.d : o.order }); await api.save('ranks', { id: o.id, order: r.order }); refresh(); }),
  schform(el) { const s = S.schools.find(s => s.id === el.dataset.id) || {}; modal(`<h3>${s.id ? 'Edit' : 'Add'} school</h3><form data-form="sch"><input type="hidden" name="id" value="${s.id || ''}"><label>Name</label><input name="name" required value="${esc(s.name)}"><label>Region</label><input name="region" required value="${esc(s.region)}"><br><br><button class="btn">Save</button></form>`); },
  async schdel(el) { if (await confirmBox('Delete this school and all its data?')) { await api.del('schools', el.dataset.id); toast('School deleted'); refresh(); } },
  mcodes(el) { modal(`<h3>Set / reset codes</h3><form data-form="mcodes" data-id="${el.dataset.id}"><label>Access Code</label><input name="admin" value="${rand()}"><label>Cadet Code</label><input name="cadet" value="${rand()}"><p style="color:var(--mut)">Copy these now. They cannot be viewed again.</p><button class="btn">Save codes</button></form>`); },
  mstaff(el) { modal(`<h3>Assign OC / IC</h3><form data-form="mstaff" data-id="${el.dataset.id}"><label>Email (existing Auth user)</label><input type="email" name="email" required><label>Role</label><select name="role"><option value="oc">OC (replaces current)</option><option value="ic">IC</option></select><br><br><button class="btn">Assign</button></form>`); }
};
function syncNotes() { document.querySelectorAll('[data-note]').forEach(i => { if (S.muster.recs[i.dataset.note]) S.muster.recs[i.dataset.note].note = i.value; }); }
document.addEventListener('click', e => { const a = e.target.closest('[data-act]'); if (a && A[a.dataset.act]) A[a.dataset.act](a, e); });

const F = {
  code: submitCode, login: doLogin,
  cadet: async f => { await api.save('cadets', { ...(f.id.value && { id: f.id.value }), school_id: S.school?.id || S.msel, name: f.name.value, branch_id: f.branch_id.value, rank_id: f.rank_id.value, gender: f.gender.value, year: f.year.value }); modal(); toast('Cadet saved'); refresh(); },
  muster: async f => { S.muster = { title: f.title.value, date: f.date.value, recs: {} }; modal(); refresh(); },
  ann: async f => { await api.save('announcements', { ...(f.id.value && { id: f.id.value }), school_id: S.school.id, title: f.title.value, body: f.body.value, pinned: f.pinned.checked, expires_at: f.expires_at.value || null, created_at: new Date().toISOString().slice(0, 10) }); modal(); toast('Announcement saved'); refresh(); },
  ic: async f => { const old = S.team.filter(p => p.role === 'ic'); if (old.length >= 2) return toast('Remove an IC first', 'err'); await api.save('profiles', { ...(sb ? {} : { id: uid(), password: 'password' }), email: f.email.value, name: f.name.value, role: 'ic', school_id: S.school.id }); modal(); toast('IC assigned'); refresh(); },
  rk: async f => { const n = S.rk.filter(r => r.branch_id === f.dataset.b).length; await api.save('ranks', { school_id: S.school.id, branch_id: f.dataset.b, name: f.name.value, order: n }); modal(); toast('Rank added'); refresh(); },
  rkren: async f => { await api.save('ranks', { id: f.dataset.id, name: f.name.value }); modal(); toast('Renamed'); refresh(); },
  pw: async f => { await api.changePassword(f.pw.value); f.reset(); toast('Password updated'); },
  codes: async f => { if (!f.admin.value && !f.cadet.value) return toast('Enter at least one new code', 'err'); if (!(await confirmBox('Change the school codes? Old codes stop working immediately.'))) return; await api.setCodes(S.school.id, f.admin.value, f.cadet.value); f.reset(); toast('Codes updated'); },
  sch: async f => { await api.save('schools', { ...(f.id.value && { id: f.id.value }), name: f.name.value, region: f.region.value }); modal(); toast('School saved'); refresh(); },
  mcodes: async f => { await api.setCodes(f.dataset.id, f.admin.value, f.cadet.value); modal(); toast('Codes saved'); },
  mstaff: async f => { const sid = f.dataset.id; if (f.role.value === 'oc') for (const p of await api.list('profiles', { school_id: sid, role: 'oc' })) await api.save('profiles', { id: p.id, school_id: null, role: 'none' }); await api.save('profiles', { ...(sb ? {} : { id: uid(), password: 'password' }), email: f.email.value, role: f.role.value, school_id: sid }); modal(); toast('Staff assigned'); }
};
document.addEventListener('submit', e => { const f = e.target.closest('[data-form]'); if (!f) return; e.preventDefault(); const fn = F[f.dataset.form]; if (fn) catchUi(fn)(f); });

route(); // start the app only after everything above is defined
