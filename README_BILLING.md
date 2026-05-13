# Billing Reminder D-3

## Modos

### Desligado

`BILLING_REMINDER_ENABLED=false`

### Teste (não envia)

`BILLING_REMINDER_ENABLED=true`  
`BILLING_REMINDER_MODE=test`

### Produção (envia real)

`BILLING_REMINDER_ENABLED=true`  
`BILLING_REMINDER_MODE=live`

---

## Execução manual

Roda o mesmo handler do cron (Mongo + BeesWeb + logs), sem esperar 09:00. Conecta ao banco automaticamente.

```bash
node src/scripts/runBillingOnce.js
```

### Outro script (envio direto)

`src/scripts/sendBillingTemplateToMe.js` — dispara só o template para um número fixo no arquivo (útil para teste de API Meta), **fora** do job D-3.

---

## Logs importantes

- `run_start`
- `leads_loaded`
- `customers_grouped`
- `template_ok`
- `[billing_reminder][test] would_send` (modo teste)
- `run_done`

---

## Rollback

`BILLING_REMINDER_ENABLED=false`  
`pm2 restart chatbot-dcinfinity`

---

## Notas

- A variável antiga `BILLING_REMINDER_TEST_MODE` foi removida; use apenas `ENABLED` + `MODE`.
- O agendamento diário (`0 9 * * *`) é registrado em `src/server.cjs`; o job em si está em `src/jobs/billingReminderScheduler.js`.
