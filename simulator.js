const WebSocket = require('ws');

// Conecta no nosso servidor local simulando um carregador chamado "ESTACAO-01"
const ws = new WebSocket('ws://localhost:3000/ocpp/ESTACAO-01');

ws.on('open', () => {
  console.log('[SIMULADOR] Conectado ao Servidor OCPP!');

  // 1. Envia o BootNotification
  const bootMsg = [2, "msg-boot-1", "BootNotification", { chargePointVendor: "WPS-Vendor", chargePointModel: "VoltCore-Box" }];
  console.log('[SIMULADOR] Enviando BootNotification...');
  ws.send(JSON.stringify(bootMsg));

  // 2. Após 2 segundos, simula a passagem da Tag RFID e o StartTransaction
  setTimeout(() => {
    const startMsg = [2, "msg-start-2", "StartTransaction", {
      connectorId: 1,
      idTag: "RFID-USER-YURI-01",
      meterStart: 1200,
      timestamp: new Date().toISOString()
    }];
    console.log('[SIMULADOR] Enviando StartTransaction...');
    ws.send(JSON.stringify(startMsg));
  }, 2000);

  // 3. Após 6 segundos, simula o encerramento da recarga (StopTransaction)
  setTimeout(() => {
    const stopMsg = [2, "msg-stop-3", "StopTransaction", {
      transactionId: 12345, // Substitua ou simule o ID retornado se preferir
      meterStop: 1350,
      timestamp: new Date().toISOString()
    }];
    console.log('[SIMULADOR] Enviando StopTransaction...');
    ws.send(JSON.stringify(stopMsg));
  }, 6000);
});

ws.on('message', (data) => {
  console.log('[SIMULADOR] Resposta recebida do Servidor:', JSON.parse(data.toString()));
});