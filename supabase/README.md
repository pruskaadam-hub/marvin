# Supabase gateway

Projekt: `kmntccvrsuhndupswrig`

Edge Function `marvin-api` je jediná veřejná brána mezi prohlížečem a n8n. Vyžaduje platný Supabase JWT, povolený e-mail a povolený origin.

## Secrets

V Supabase Dashboard → Edge Functions → Secrets nastav:

- `n8n_marvin_key` — stejný tajný klíč jako v n8n; nikdy jej nedávej do GitHubu ani do chatu,
- `n8n_stav_url=https://cometx.app.n8n.cloud/webhook/marvin/stav`,
- `n8n_prikaz_url=https://cometx.app.n8n.cloud/webhook/marvin/prikaz`,
- `marvin_allowed_origins=https://pruskaadam-hub.github.io`,
- `marvin_allowed_emails=pruskaadam@me.com`.

Před finálním nasazením ověř, že `marvin_allowed_emails` odpovídá skutečnému přihlašovacímu účtu.

## Chat

`POST /functions/v1/marvin-api/chat` přijímá `{ text, sessionId }` a po stejné
kontrole uživatele předá zprávu na `https://cometx.app.n8n.cloud/webhook/marvin/chat`.
Používá existující `n8n_marvin_key` v hlavičce `X-Marvin-Key`; žádný další klíč
ani proměnná nejsou potřeba. Čekání na n8n je omezené na 90 sekund, ostatní
endpointy mají původních 15 sekund. n8n musí vrátit JSON `{ ok: true, odpoved }`.

Prohlížeč ukládá ID konverzace a posledních 100 zpráv do localStorage zvlášť pro
přihlášeného uživatele. „Nová konverzace“ mění ID a maže místní historii;
neodstraňuje předchozí konverzaci z paměti n8n. Při vypnutém localStorage chat
funguje do obnovení stránky. Markdown se vykresluje pouze přes textové DOM uzly.

## Deploy

```bash
supabase functions deploy marvin-api --project-ref kmntccvrsuhndupswrig
```


