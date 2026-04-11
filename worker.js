export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // API Routes
    if (path.startsWith('/api/data')) {
      if (request.method === 'GET') {
        return handleGetData(request, env);
      } else if (request.method === 'POST') {
        return handleSaveData(request, env);
      }
    }

    return new Response('Not Found', { status: 404 });
  },
};

async function handleGetData(request, env) {
  try {
    const data = await env.DB.prepare('SELECT * FROM app_data LIMIT 1').first();
    
    if (data) {
      return new Response(data.content, {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    } else {
      // Return default data if nothing in DB
      const defaultData = {
        firststeps: [
          { id: 1, title: 'Contact Information', details: 'Key people to call:\n- Spouse: 555-123-4567\n- Jane: 555-987-6543\n- Attorney: 555-246-8101', notes: 'Call first if something happens' },
          { id: 2, title: 'Will & Estate', details: 'Location of documents:\n- Will: Filed with attorney John Smith\n- Trust: Stored in safe deposit box #123\n- Power of Attorney: Same location', notes: 'Provide death certificate copies' },
          { id: 3, title: 'Digital Assets', details: 'What to do with online accounts:\n- Social Media: Facebook memorial, Twitter deleted\n- Email: Forward to Jane for 6 months\n- Cloud Storage: Google Drive shared with Jane', notes: 'Delete unused accounts after 1 year' },
          { id: 4, title: 'Debts & Obligations', details: 'What needs to be paid:\n- Mortgage: 6AL Property - $2,500/mo\n- Credit Cards: Close all, pay off balances\n- Car Loans: 2 vehicles - 95EB and 446BB', notes: 'Contact banks immediately' }
        ],
        insurance: [
          { id: 1, type: 'Health', name: 'Primary Plan', details: 'Plan: Blue Cross Blue Shield\nMember ID: BCBS-12345678\nGroup: BCBS-9876\nPhone: 1-800-XXX-XXXX\nPolicy: Self + Spouse', notes: 'Dental and vision included' },
          { id: 2, type: 'Auto', name: 'State Farm', details: 'Agent: John Smith\nPhone: 555-123-4567\nPolicy: AF-7890123\nCoverage: Full', notes: 'Roadside assistance included' },
          { id: 3, type: 'Rental', name: '6AL Property', details: 'Provider: Nationwide\nPolicy: RL-4567890\nDeductible: $1,000', notes: 'Rental insurance for primary rental property' },
          { id: 4, type: 'Life', name: 'Term Life Insurance', details: 'Provider: Prudential\nPolicy: LT-2345678\nBeneficiaries: Spouse 100%\nCoverage: $500,000', notes: 'Policy number: 2345678' }
        ],
        money: [
          { id: 1, account: 'Chase Checking', type: 'Bank', balance: '$12,450.82', loginUrl: 'https://chase.com', username: 'chris.jane', instructions: 'Use phone number verification' },
          { id: 2, account: 'Capital One Savings', type: 'Bank', balance: '$8,235.19', loginUrl: 'https://capitalone.com', username: 'chris.jane', instructions: 'Security token required' },
          { id: 3, account: 'Vanguard IRA', type: 'Investment', balance: '$45,678.42', loginUrl: 'https://vanguard.com', username: '99redder', instructions: 'Use LastPass for credentials' },
          { id: 4, account: 'Robinhood', type: 'Investment', balance: '$2,145.00', loginUrl: 'https://robinhood.com', username: 'chris@99redder.com', instructions: 'Biometric login enabled' }
        ],
        passwords: [
          { id: 1, service: 'Gmail / Google', username: 'chris@99redder.com', password: 'password123', instructions: '2FA via Authy' },
          { id: 2, service: 'iCloud', username: 'chris@icloud.com', password: 'password123', instructions: 'Use this if phone is lost' },
          { id: 3, service: 'GitHub', username: '99redder', password: 'password123', instructions: 'PAT for automation' },
          { id: 4, service: 'LastPass', username: 'chris@99redder.com', password: 'password123', instructions: 'Emergency access to Spouse' },
          { id: 5, service: 'Netflix', username: 'chris@99redder.com', password: 'password123', instructions: 'Shared account' },
          { id: 6, service: 'Disney+', username: 'chris@99redder.com', password: 'password123', instructions: 'Shared account' }
        ]
      };
      return new Response(JSON.stringify(defaultData), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  } catch (error) {
    console.error('Error fetching data:', error);
    return new Response(JSON.stringify({ error: 'Failed to fetch data' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}

async function handleSaveData(request, env) {
  try {
    const body = await request.json();
    const content = JSON.stringify(body);

    // Check if record exists
    const existing = await env.DB.prepare('SELECT id FROM app_data LIMIT 1').first();

    if (existing) {
      await env.DB.prepare('UPDATE app_data SET content = ? WHERE id = ?').bind(content, existing.id).run();
    } else {
      await env.DB.prepare('INSERT INTO app_data (content) VALUES (?)').bind(content).run();
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (error) {
    console.error('Error saving data:', error);
    return new Response(JSON.stringify({ error: 'Failed to save data' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}
