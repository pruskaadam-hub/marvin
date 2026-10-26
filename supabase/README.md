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

## Deploy

```bash
supabase functions deploy marvin-api --project-ref kmntccvrsuhndupswrig
```


