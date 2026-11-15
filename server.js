/* ==========================================================================
   VOLTCORE PRO • BACK-END SERVER V9.9 (COMPLETO E INTEGRAL)
   Desenvolvido para WPS Info • Cliente: Wanderson Pedro da Silva
   ========================================================================== */

require('dotenv').config();
const { WebSocketServer } = require('ws');
const http = require('http');
const { createClient } = require('@supabase/supabase-js');
const { MercadoPagoConfig, Payment } = require('mercadopago');

const supabaseUrl = process.env.SUPABASE_URL || 'https://eoqfuawvljotvyfrcbj.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || 'sb_publishable_l0JQ_niTmthXhm09X60uAg_pi4ds';
const supabase = createClient(supabaseUrl, supabaseKey);

const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET, POST, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-ID');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'Online', service: 'VoltCore OCPP, OCPI 2.2 Roaming & Pagamentos Seguros • Produção V9.9' }));
    return;
  }

  if (req.url === '/api/pagamento/pix' && req.method === 'POST') {
    let bodyData = '';
    req.on('data', chunk => { bodyData += chunk; });
    req.on('end', async () => {
      try {
        const parsedData = bodyData ? JSON.parse(bodyData) : {};
        const transaction_amount = parsedData.transaction_amount || 10.00;
        const description = parsedData.description || 'Recarga de Saldo • VoltCore Pay';
        const email = parsedData.email || 'contato@wpsinfo.com.br';
        const first_name = parsedData.first_name || 'Wanderson';

        const payment = new Payment(client);
        const response = await payment.create({
          body: {
            transaction_amount: parseFloat(transaction_amount),
            description: description,
            payment_method_id: 'pix',
            payer: { email: email, first_name: first_name }
          }
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          id: response.id,
          status: response.status,
          qr_code: response.point_of_interaction.transaction_data.qr_code,
          qr_code_base64: response.point_of_interaction.transaction_data.qr_code_base64
        }));
      } catch (error) {
        console.error('Erro ao gerar Pix no Mercado Pago:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message || 'Erro ao gerar Pix' }));
      }
    });
    return;
  }

  if (req.url.startsWith('/api/pagamento/status/') && req.method === 'GET') {
    try {
      const paymentId = req.url.split('/').pop();
      const payment = new Payment(client);
      const response = await payment.get({ id: paymentId });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        id: response.id,
        status: response.status,
        status_detail: response.status_detail
      }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: error.message || 'Erro ao consultar status' }));
    }
    return;
  }

  if (req.url === '/api/pagamento/cartao' && req.method === 'POST') {
    let bodyData = '';
    req.on('data', chunk => { bodyData += chunk; });
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(bodyData);
        const { transaction_amount, token, payment_method_id, installments, payer, email, card_number, cardholder_name } = parsed;
        const userEmail = (payer && payer.email) || email || 'contato@wpsinfo.com.br';

        const payment = new Payment(client);
        const response = await payment.create({
          body: {
            transaction_amount: parseFloat(transaction_amount),
            token: token || undefined,
            installments: parseInt(installments || 1),
            payment_method_id: payment_method_id || 'master',
            payer: {
              email: userEmail,
              identification: (payer && payer.identification) || { type: 'CPF', number: '12345678909' }
            }
          }
        });

        if (response.status === 'approved') {
          const lastFour = card_number ? card_number.slice(-4) : '4242';
          const cardId = 'card_' + Date.now();

          await supabase.from('voltcore_saved_cards').insert([{
            user_email: userEmail,
            card_id: cardId,
            last_four: lastFour,
            brand: 'Mastercard',
            cardholder_name: cardholder_name || 'Titular'
          }]);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            id: response.id,
            status: response.status,
            status_detail: response.status_detail,
            card_id: cardId,
            card_last_four: lastFour
          }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            status: response.status,
            status_detail: response.status_detail,
            error: `Pagamento não aprovado (${response.status_detail || response.status})`
          }));
        }
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, status: 'rejected', error: error.message || 'Transação recusada.' }));
      }
    });
    return;
  }

  if (req.url.startsWith('/api/cartoes/listar') && req.method === 'GET') {
    try {
      const urlParams = new URL(req.url, 'http://localhost').searchParams;
      const email = urlParams.get('email') || 'contato@wpsinfo.com.br';
      const { data, error } = await supabase.from('voltcore_saved_cards').select('*').eq('user_email', email).order('created_at', { ascending: false });
      if (error) throw error;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, cards: data || [] }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Erro ao buscar cartões.' }));
    }
    return;
  }

  if (req.url === '/api/cartoes/excluir' && req.method === 'POST') {
    let bodyData = '';
    req.on('data', chunk => { bodyData += chunk; });
    req.on('end', async () => {
      try {
        const { card_id, email } = JSON.parse(bodyData);
        await supabase.from('voltcore_saved_cards').delete().eq('card_id', card_id).eq('user_email', email || 'contato@wpsinfo.com.br');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Cartão removido.' }));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Erro ao excluir cartão.' }));
      }
    });
    return;
  }

  // OCPI 2.2 Roaming
  if (req.url === '/ocpi/versions' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      data: [{ version: "2.2", url: "https://voltcore-ocpp-backend.onrender.com/ocpi/2.2" }],
      status_code: 1000, status_message: "Success", timestamp: new Date().toISOString()
    }));
    return;
  }

  if (req.url === '/ocpi/2.2' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      data: {
        version: "2.2",
        endpoints: [
          { identifier: "locations", url: "https://voltcore-ocpp-backend.onrender.com/ocpi/2.2/locations" },
          { identifier: "tokens", url: "https://voltcore-ocpp-backend.onrender.com/ocpi/2.2/tokens" },
          { identifier: "commands", url: "https://voltcore-ocpp-backend.onrender.com/ocpi/2.2/commands" },
          { identifier: "tariffs", url: "https://voltcore-ocpp-backend.onrender.com/ocpi/2.2/tariffs" }
        ]
      },
      status_code: 1000, status_message: "Success", timestamp: new Date().toISOString()
    }));
    return;
  }

  if (req.url.startsWith('/ocpi/2.2/locations') && req.method === 'GET') {
    try {
      const { data: pontosDB } = await supabase.from('pontos_recarga').select('*');
      const stationsList = (pontosDB && pontosDB.length > 0) ? pontosDB : [
        { id_ponto: '1', nome_vaga: 'VAGA 01 / TORRE SUL', condominio: 'Condomínio Gioviale • Torre Sul', status: 'Disponível', ocpp_id: 'CP-GIOV-SUL-01', potencia_kw: 22 }
      ];

      const ocpiLocations = stationsList.map(st => ({
        id: `BR-WPS-${st.id_ponto}`, type: "DOMESTIC", name: st.nome_vaga,
        address: st.condominio || 'Condomínio Residencial Jundiaí', city: "Jundiaí", country: "BRA",
        coordinates: { latitude: "-23.1857", longitude: "-46.9755" },
        evses: [{
          uid: `EVSE-${st.id_ponto}`, evse_id: `BR*WPS*E${st.id_ponto}`,
          status: st.status === 'Disponível' ? 'AVAILABLE' : 'IN_USE',
          capabilities: ["REMOTE_START_STOP_CAPABLE"],
          connectors: [{ id: "1", standard: "IEC_62196_T2", format: "SOCKET", power_type: "AC_3_PHASE", max_voltage: 400, max_amperage: 32, max_electric_power: (st.potencia_kw || 22) * 1000 }],
          last_updated: new Date().toISOString()
        }],
        operator: { name: "WPS Info / VoltCore" }, last_updated: new Date().toISOString()
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: ocpiLocations, status_code: 1000, status_message: "Success", timestamp: new Date().toISOString() }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status_code: 3000, status_message: err.message }));
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

const wss = new WebSocketServer({ server });

wss.on('connection', async (ws, req) => {
  const pathParts = req.url.split('/');
  const chargerId = pathParts[pathParts.length - 1] || 'ESTACAO-TESTE';
  
  await supabase.from('voltcore_chargers').upsert({ charger_id: chargerId, status: 'Available', last_heartbeat: new Date() }, { onConflict: 'charger_id' });

  ws.on('message', async (message) => {
    try {
      const payload = JSON.parse(message.toString());
      const uniqueId = payload[1];
      const action = payload[2];
      const data = payload[3];

      if (action === 'BootNotification') {
        ws.send(JSON.stringify([3, uniqueId, { status: "Accepted", currentTime: new Date().toISOString(), interval: 300 }]));
      } else if (action === 'StartTransaction') {
        const txId = Math.floor(Math.random() * 100000);
        await supabase.from('voltcore_transactions').insert({
          transaction_id: txId, charger_id: chargerId, connector_id: data.connectorId || 1,
          id_tag: data.idTag || 'TAG-DESCONHECIDA', start_timestamp: new Date(data.timestamp || Date.now()),
          start_meter: data.meterStart || 0, status: 'Charging'
        });
        await supabase.from('voltcore_chargers').update({ status: 'Charging', last_heartbeat: new Date() }).eq('charger_id', chargerId);
        ws.send(JSON.stringify([3, uniqueId, { transactionId: txId, idTagInfo: { status: "Accepted" } }]));
      } else if (action === 'StopTransaction') {
        await supabase.from('voltcore_transactions').update({
          stop_timestamp: new Date(data.timestamp || Date.now()), stop_meter: data.meterStop || 0, status: 'Completed'
        }).eq('transaction_id', data.transactionId);
        await supabase.from('voltcore_chargers').update({ status: 'Available', last_heartbeat: new Date() }).eq('charger_id', chargerId);
        ws.send(JSON.stringify([3, uniqueId, { idTagInfo: { status: "Accepted" } }]));
      }
    } catch (err) {}
  });

  ws.on('close', async () => {
    await supabase.from('voltcore_chargers').update({ status: 'Offline' }).eq('charger_id', chargerId);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor OCPP Central System, OCPI 2.2 & Pagamentos Seguros rodando na porta ${PORT}`);
});