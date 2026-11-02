require('dotenv').config();
const { WebSocketServer } = require('ws');
const http = require('http');
const { createClient } = require('@supabase/supabase-js');

// Configuração do Supabase (substitua pelas suas chaves ou use variáveis de ambiente)
const supabaseUrl = process.env.SUPABASE_URL || 'SUA_URL_DO_SUPABASE';
const supabaseKey = process.env.SUPABASE_KEY || 'SUA_CHAVE_SUPABASE';
const supabase = createClient(supabaseUrl, supabaseKey);

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('VoltCore OCPP Central System is running!\n');
});

const wss = new WebSocketServer({ server });

wss.on('connection', async (ws, req) => {
  // Extrai o ID do carregador da URL (ex: ws://localhost:3000/ocpp/ESTACAO-01)
  const pathParts = req.url.split('/');
  const chargerId = pathParts[pathParts.length - 1] || 'ESTACAO-TESTE';
  
  console.log(`[CONEXÃO] Carregador/ESP conectado: ${chargerId}`);

  // Registra ou atualiza o carregador no Supabase como 'Available'
  await supabase
    .from('voltcore_chargers')
    .upsert({ charger_id: chargerId, status: 'Available', last_heartbeat: new Date() }, { onConflict: 'charger_id' });

  ws.on('message', async (message) => {
    try {
      const payload = JSON.parse(message.toString());
      console.log(`[MENSAGEM RECEBIDA de ${chargerId}]:`, payload);

      const messageTypeId = payload[0];
      const uniqueId = payload[1];
      const action = payload[2];
      const data = payload[3];

      if (action === 'BootNotification') {
        // Responde ao BootNotification aceitando a conexão
        const response = [
          3,
          uniqueId,
          {
            status: "Accepted",
            currentTime: new Date().toISOString(),
            interval: 300
          }
        ];
        ws.send(JSON.stringify(response));
        console.log(`[RESPOSTA] BootNotification aceito para ${chargerId}`);
      } 
      else if (action === 'StartTransaction') {
        const txId = Math.floor(Math.random() * 100000);
        
        // Salva a transação de início no Supabase
        await supabase.from('voltcore_transactions').insert({
          transaction_id: txId,
          charger_id: chargerId,
          connector_id: data.connectorId || 1,
          id_tag: data.idTag || 'TAG-DESCONHECIDA',
          start_timestamp: new Date(data.timestamp || Date.now()),
          start_meter: data.meterStart || 0,
          status: 'Charging'
        });

        // Atualiza status do carregador
        await supabase.from('voltcore_chargers').update({ status: 'Charging', last_heartbeat: new Date() }).eq('charger_id', chargerId);

        const response = [
          3,
          uniqueId,
          {
            transactionId: txId,
            idTagInfo: { status: "Accepted" }
          }
        ];
        ws.send(JSON.stringify(response));
        console.log(`[TRANSAÇÃO] Iniciada e salva no Supabase com ID: ${txId}`);
      }
      else if (action === 'StopTransaction') {
        // Atualiza a transação como concluída no Supabase
        await supabase.from('voltcore_transactions').update({
          stop_timestamp: new Date(data.timestamp || Date.now()),
          stop_meter: data.meterStop || 0,
          status: 'Completed'
        }).eq('transaction_id', data.transactionId);

        // Atualiza status do carregador para disponível
        await supabase.from('voltcore_chargers').update({ status: 'Available', last_heartbeat: new Date() }).eq('charger_id', chargerId);

        const response = [
          3,
          uniqueId,
          {
            idTagInfo: { status: "Accepted" }
          }
        ];
        ws.send(JSON.stringify(response));
        console.log(`[TRANSAÇÃO] Parada e finalizada no Supabase para ID: ${data.transactionId}`);
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
  console.log(`Servidor OCPP Central System rodando na porta ${PORT}`);
});