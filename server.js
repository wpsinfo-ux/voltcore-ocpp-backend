require('dotenv').config();
const { WebSocketServer } = require('ws');
const http = require('http');
const { createClient } = require('@supabase/supabase-js');
const { MercadoPagoConfig, Payment } = require('mercadopago');

// Configuração do Supabase
const supabaseUrl = process.env.SUPABASE_URL || 'SUA_URL_DO_SUPABASE';
const supabaseKey = process.env.SUPABASE_KEY || 'SUA_CHAVE_SUPABASE';
const supabase = createClient(supabaseUrl, supabaseKey);

// Inicializa o SDK oficial do Mercado Pago com a chave de produção injetada no Render
const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });

const server = http.createServer(async (req, res) => {
  // Configuração de CORS para permitir requisições da Vercel
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET, POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Rota raiz de status
  if (req.url === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'Online', service: 'VoltCore OCPP & Pagamentos Backend • Produção' }));
    return;
  }

  // 1. Rota para Gerar Pagamento PIX Real (Mercado Pago)
  if (req.url === '/api/pagamento/pix' && req.method === 'POST') {
    let bodyData = '';
    req.on('data', chunk => { bodyData += chunk; });
    req.on('end', async () => {
      try {
        const parsedData = bodyData ? JSON.parse(bodyData) : {};
        const transaction_amount = parsedData.transaction_amount || 10.00;
        const description = parsedData.description || 'Recarga de Saldo • VoltCore Pay';
        const email = parsedData.email || 'contato@wpsinfo.com.br';

        const payment = new Payment(client);
        const mpBody = {
          transaction_amount: parseFloat(transaction_amount),
          description: description,
          payment_method_id: 'pix',
          payer: { email: email }
        };

        const response = await payment.create({ body: mpBody });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          id: response.id,
          status: response.status,
          qr_code: response.point_of_interaction.transaction_data.qr_code,
          qr_code_base64: response.point_of_interaction.transaction_data.qr_code_base64
        }));
      } catch (error) {
        console.error('ERRO DETALHADO MERCADO PAGO (PIX):', error.cause || error.message || error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message || 'Erro ao gerar Pix no servidor', details: error.cause || null }));
      }
    });
    return;
  }

  // 2. Rota para Processar Pagamento com Cartão (Checkout Transparente • Mercado Pago)
  if (req.url === '/api/pagamento/cartao' && req.method === 'POST') {
    let bodyData = '';
    req.on('data', chunk => { bodyData += chunk; });
    req.on('end', async () => {
      try {
        const { 
          transaction_amount, 
          description, 
          payment_method_id, 
          installments, 
          payer, 
          card_number, 
          card_expiration_month, 
          card_expiration_year, 
          card_cvv, 
          cardholder_name 
        } = JSON.parse(bodyData);

        const payment = new Payment(client);
        
        // Se o cliente enviar os dados diretos do cartão para criação do pagamento transparente
        const mpBody = {
          transaction_amount: parseFloat(transaction_amount),
          description: description || 'Recarga Carteira VoltCore Pay',
          payment_method_id: payment_method_id || 'master',
          installments: parseInt(installments || 1),
          payer: payer,
          // Caso venham os dados crus do cartão, passamos para o SDK processar
          ...(card_number && {
            card: {
              number: card_number,
              expiration_month: card_expiration_month,
              expiration_year: card_expiration_year,
              security_code: card_cvv,
              cardholder: { name: cardholder_name }
            }
          })
        };

        const response = await payment.create({ body: mpBody });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          id: response.id,
          status: response.status,
          status_detail: response.status_detail
        }));
      } catch (error) {
        console.error('ERRO DETALHADO MERCADO PAGO (CARTÃO):', error.cause || error.message || error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: error.message, details: error.cause }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

const wss = new WebSocketServer({ server });

wss.on('connection', async (ws, req) => {
  const pathParts = req.url.split('/');
  const chargerId = pathParts[pathParts.length - 1] || 'ESTACAO-TESTE';
  
  console.log(`[CONEXÃO] Carregador/ESP conectado: ${chargerId}`);

  await supabase
    .from('voltcore_chargers')
    .upsert({ charger_id: chargerId, status: 'Available', last_heartbeat: new Date() }, { onConflict: 'charger_id' });

  ws.on('message', async (message) => {
    try {
      const payload = JSON.parse(message.toString());
      const uniqueId = payload[1];
      const action = payload[2];
      const data = payload[3];

      if (action === 'BootNotification') {
        ws.send(JSON.stringify([3, uniqueId, { status: "Accepted", currentTime: new Date().toISOString(), interval: 300 }]));
      } 
      else if (action === 'StartTransaction') {
        const txId = Math.floor(Math.random() * 100000);
        await supabase.from('voltcore_transactions').insert({
          transaction_id: txId,
          charger_id: chargerId,
          connector_id: data.connectorId || 1,
          id_tag: data.idTag || 'TAG-DESCONHECIDA',
          start_timestamp: new Date(data.timestamp || Date.now()),
          start_meter: data.meterStart || 0,
          status: 'Charging'
        });
        await supabase.from('voltcore_chargers').update({ status: 'Charging', last_heartbeat: new Date() }).eq('charger_id', chargerId);
        ws.send(JSON.stringify([3, uniqueId, { transactionId: txId, idTagInfo: { status: "Accepted" } }]));
      }
      else if (action === 'StopTransaction') {
        await supabase.from('voltcore_transactions').update({
          stop_timestamp: new Date(data.timestamp || Date.now()),
          stop_meter: data.meterStop || 0,
          status: 'Completed'
        }).eq('transaction_id', data.transactionId);

        await supabase.from('voltcore_chargers').update({ status: 'Available', last_heartbeat: new Date() }).eq('charger_id', chargerId);
        ws.send(JSON.stringify([3, uniqueId, { idTagInfo: { status: "Accepted" } }]));
      }
    } catch (err) {
      console.error('[ERRO] Falha ao processar mensagem OCPP:', err);
    }
  });

  ws.on('close', async () => {
    console.log(`[DESCONEXÃO] Carregador desconectado: ${chargerId}`);
    await supabase.from('voltcore_chargers').update({ status: 'Offline' }).eq('charger_id', chargerId);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor OCPP Central System e Pagamentos rodando na porta ${PORT}`);
});