# Architektura M.A.R.V.I.N.

## Tok čtení

```text
Web → Supabase Auth → GET /functions/v1/marvin-api/stav
    → Edge Function přidá X-Marvin-Key → n8n /webhook/marvin/stav
    → n8n sestaví malý dnešní snapshot ze Supabase
```

`stav` má vracet pouze data potřebná pro úvodní obrazovku. Detail úkolu se později načte samostatným endpointem až po otevření položky.

## Tok zápisu

```text
Web → POST /functions/v1/marvin-api/prikaz + Supabase JWT
    → kontrola originu, účtu, velikosti a tvaru
    → Edge Function přidá tajný X-Marvin-Key
    → n8n ověří typ a idempotency_key
    → příkaz + audit_log v Supabase
    → dávkové zpracování
```

První verze odesílá pouze:

```json
{
  "idempotency_key": "web-UUID",
  "typ": "poznamka",
  "data": {
    "text": "…",
    "oblast": "CometX | Lab On Card | Konzultace | Osobní | null",
    "zdroj": "web-marvin"
  }
}
```

Nový typ příkazu se do webu přidá teprve po validaci stejného typu a jeho schématu v n8n.

## Co z původního panelu záměrně chybí

- GitHub PAT a přímé čtení či zápis souborů,
- faktury jako samostatná sekce,
- vykreslování celého archivu zápisů,
- dlouhé reporty a historie synchronizací,
- detailní formuláře načtené hned na úvodu,
- zápis do Gmailu nebo kalendářů z prohlížeče,
- univerzální webhook přijímající libovolný příkaz.

Původní `asistent` zůstává nedotčená záloha.
