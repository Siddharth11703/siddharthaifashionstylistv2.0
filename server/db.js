import 'dotenv/config';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY).');
}

const normalizeBaseUrl = (url) => url.replace(/\/$/, '');

const request = async (path, options = {}) => {
  const response = await fetch(`${normalizeBaseUrl(supabaseUrl)}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...options.headers,
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = data?.message || data?.error || response.statusText;
    throw new Error(`Supabase request failed: ${message}`);
  }

  return data;
};

const eq = (value) => `eq.${encodeURIComponent(value)}`;

const supabaseDb = {
  async findUserByEmail(email) {
    const users = await request(`users?email=${eq(email)}&limit=1`);
    return users[0] || null;
  },

  async findUserById(id) {
    const users = await request(`users?id=${eq(id)}&limit=1`);
    return users[0] || null;
  },

  async createUser({ name, email, phone }) {
    const users = await request('users', {
      method: 'POST',
      body: JSON.stringify({ name, email, phone }),
    });
    return users[0];
  },

  async updateUserByEmail(email, { name, phone }) {
    const users = await request(`users?email=${eq(email)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name, phone }),
    });
    return users[0];
  },

  async createSavedOutfit(outfit) {
    const outfits = await request('saved_outfits', {
      method: 'POST',
      body: JSON.stringify(outfit),
    });
    return outfits[0];
  },

  async getSavedOutfitsByUser(userId) {
    return request(`saved_outfits?user_id=${eq(userId)}&order=created_at.desc`);
  },

  async getAllSavedOutfits() {
    return request('saved_outfits?order=created_at.desc');
  },

  async deleteSavedOutfit(outfitId, userId) {
    const outfits = await request(`saved_outfits?id=${eq(outfitId)}&user_id=${eq(userId)}`, {
      method: 'DELETE',
    });
    return outfits.length;
  },
};

export default supabaseDb;
