// Creates logins that the browser must never create itself. Uses the SECRET service-role key (server only).
const { createClient } = require('@supabase/supabase-js');
const fail = (res, code, error) => res.status(code).json({ error });
const cadetEmail = (sid, no) => no.toLowerCase().replace(/[^a-z0-9]/g, '') + '.' + sid + '@cadets.gncc.app'; // must match index.html

module.exports = async (req, res) => {
  if (req.method !== 'POST') return fail(res, 405, 'Method not allowed');
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return fail(res, 500, 'Server is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const { data: u, error: ue } = await db.auth.getUser(token);
    if (ue || !u || !u.user) return fail(res, 401, 'Please sign in again.');
    const { data: me } = await db.from('profiles').select('role,school_id').eq('id', u.user.id).maybeSingle();
    const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const text = v => String(v == null ? '' : v).trim();

    if (b.kind === 'school') {                       // only the platform admin may register schools
      if (!me || me.role !== 'platform_admin') return fail(res, 403, 'Only the platform administrator can register schools.');
      const s = b.school || {}, email = text(b.adminEmail), pw = String(b.adminPassword || '');
      if (!text(s.name) || !text(s.region) || !text(s.category) || !email) return fail(res, 400, 'Please fill all required fields.');
      if (pw.length < 8) return fail(res, 400, 'Use at least 8 characters for the password.');
      const au = await db.auth.admin.createUser({ email, password: pw, email_confirm: true });
      if (au.error) return fail(res, 400, /registered|exists/i.test(au.error.message) ? 'That admin email is already in use.' : au.error.message);
      const sc = await db.from('schools').insert({ name: text(s.name), abbreviation: text(s.abbr) || null, region: text(s.region), town: text(s.town) || null, category: text(s.category), motto: text(s.motto) || null, active: true }).select('id').single();
      if (sc.error) { await db.auth.admin.deleteUser(au.data.user.id); return fail(res, 400, sc.error.message); }
      const r1 = await db.from('school_private').insert({ school_id: sc.data.id, email: text(s.email) || null, tel: text(s.tel) || null, payment_status: text(s.pay) || 'Pending' });
      const r2 = await db.from('profiles').upsert({ id: au.data.user.id, role: 'school_admin', school_id: sc.data.id, cadet_id: null }, { onConflict: 'id' });
      const ck = await db.from('profiles').select('role,school_id').eq('id', au.data.user.id).maybeSingle();
      if (r1.error || r2.error || !ck.data || ck.data.role !== 'school_admin' || ck.data.school_id !== sc.data.id) {
        await db.from('schools').delete().eq('id', sc.data.id); await db.auth.admin.deleteUser(au.data.user.id);
        return fail(res, 400, (r1.error || r2.error || {}).message || 'The admin login could not be linked to the school. Nothing was saved, please try again.');
      }
      return res.status(200).json({ ok: true, school_id: sc.data.id });
    }

    if (b.kind === 'cadet') {                        // only a school admin, and only for THEIR school
      if (!me || me.role !== 'school_admin' || !me.school_id) return fail(res, 403, 'Only a school administrator can add cadets.');
      const c = b.cadet || {}, no = text(c.id), pw = String(b.password || '');
      if (!no || !text(c.name) || !text(c.gender) || !text(c.form) || !text(c.rank)) return fail(res, 400, 'Please fill all required fields.');
      if (pw.length < 8) return fail(res, 400, 'Use at least 8 characters for the password.');
      if (String(c.photo || '').length > 400000) return fail(res, 400, 'That photo is too large.');
      const dup = await db.from('cadets').select('id').eq('school_id', me.school_id).ilike('cadet_no', no.replace(/[%_]/g, ''));
      if (dup.data && dup.data.length) return fail(res, 400, 'This cadet ID is already registered.');
      const au = await db.auth.admin.createUser({ email: cadetEmail(me.school_id, no), password: pw, email_confirm: true });
      if (au.error) return fail(res, 400, /registered|exists/i.test(au.error.message) ? 'This cadet ID is already registered.' : au.error.message);
      const cd = await db.from('cadets').insert({ school_id: me.school_id, cadet_no: no, full_name: text(c.name), gender: text(c.gender), dob: text(c.dob) || null, form: text(c.form), rank: text(c.rank), phone: text(c.phone) || null, photo_url: c.photo || null, status: 'Active' }).select('id').single();
      if (cd.error) { await db.auth.admin.deleteUser(au.data.user.id); return fail(res, 400, cd.error.message); }
      const pr = await db.from('profiles').upsert({ id: au.data.user.id, role: 'cadet', school_id: me.school_id, cadet_id: cd.data.id }, { onConflict: 'id' });
      const ck = await db.from('profiles').select('role,school_id,cadet_id').eq('id', au.data.user.id).maybeSingle();
      if (pr.error || !ck.data || ck.data.role !== 'cadet' || ck.data.cadet_id !== cd.data.id) {
        await db.from('cadets').delete().eq('id', cd.data.id); await db.auth.admin.deleteUser(au.data.user.id);
        return fail(res, 400, (pr.error || {}).message || 'The cadet login could not be linked. Nothing was saved, please try again.');
      }
      return res.status(200).json({ ok: true });
    }
    return fail(res, 400, 'Unknown request.');
  } catch (e) { return fail(res, 500, 'The request failed. Please try again.'); }
};
