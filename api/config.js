// Public settings only. The anon key is safe to expose; the service-role key is NOT here.
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ url: process.env.SUPABASE_URL || '', anon: process.env.SUPABASE_ANON_KEY || '' });
};
