const email = process.env.MFA_TEST_EMAIL;
const password = process.env.MFA_TEST_PASSWORD;
if (!email || !password) {
  throw new Error('MFA_TEST_EMAIL et MFA_TEST_PASSWORD sont obligatoires.');
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const cookie = response.headers.get('set-cookie');
  const data = await response.json().catch(() => ({}));
  return { response, cookie, data };
}

(async () => {
  const login = await request('http://localhost:3001/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const status = login.response.status;
  const mfaRequired = login.data.mfaRequired === true;
  const hasChallenge = typeof login.data.challenge === 'string' && login.data.challenge.length > 0;
  const hasCookie = Boolean(login.cookie);
  console.log(`login status: ${status}`);
  console.log(`mfaRequired: ${mfaRequired}`);
  console.log(`challenge present: ${hasChallenge ? 'yes' : 'no'}`);
  console.log(`Set-Cookie present: ${hasCookie ? 'yes' : 'no'}`);
  if (status === 202) {
    if (!hasChallenge || hasCookie) throw new Error('Réponse MFA invalide.');
    return;
  }
  if (status === 200) {
    const mfa = await request('http://localhost:3001/api/auth/mfa/status', { headers: { cookie: login.cookie || '' } });
    console.log(`mfa enabled: ${mfa.data.enabled === true}`);
    console.log(`confirmedAt present: ${mfa.data.confirmedAt ? 'yes' : 'no'}`);
    return;
  }
  throw new Error(`Login HTTP ${status}`);
})().catch((error) => { console.error(`MFA flow test failed: ${error.message}`); process.exitCode = 1; });
