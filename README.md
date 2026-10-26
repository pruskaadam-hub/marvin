# M.A.R.V.I.N. web

Nový malý frontend pro `https://pruskaadam-hub.github.io/marvin/`. Původní projekt `asistent` zůstává jako záloha.

## Architektura

```text
GitHub Pages (veřejný kód, žádná tajemství)
  → Supabase Auth (povolený Adamův účet)
  → Edge Function marvin-api (JWT, CORS, validace)
  → n8n webhooky (tajný X-Marvin-Key pouze v Supabase Secrets)
  → Supabase databáze / pracovní fronta
```

Web nikdy nevolá n8n přímo a neobsahuje GitHub ani n8n token. Vlastní Supabase Secrets používají názvy malými písmeny.

## První nasazení

1. Nasaď Edge Function ze složky `supabase/` podle `supabase/README.md`.
2. V Supabase Auth povol přihlášení e-mailem a redirect URL `https://pruskaadam-hub.github.io/marvin/`.
3. Do `config.js` vlož veřejný Supabase publishable key. Tento klíč smí být v klientském kódu; přístup chrání RLS, Auth a Edge Function.
4. Vytvoř veřejný repozitář `pruskaadam-hub/marvin`, nahraj tuto složku a v Pages nastav deploy z větve `main`, kořen `/`.

## Rozsah první verze

- dnešní briefing a úplnost dat,
- otevřené úkoly po oblastech,
- dnešní časová osa,
- tři priority, zítřek a chyby vyžadující zásah,
- bezpečný příkaz `poznamka` do n8n fronty.

Další mutace se přidají až po zavedení explicitních typů a JSON schémat na webhooku `marvin/prikaz`.

## Kontrola

```bash
npm test
```

