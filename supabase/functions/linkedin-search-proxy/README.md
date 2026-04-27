# linkedin-search-proxy

Supabase Edge Function that proxies Lead Extractor search payloads to n8n.

## Endpoint

`POST /functions/v1/linkedin-search-proxy`

## Behavior

- Accepts `POST` only
- Validates request body is an object
- Appends:
  - `meta.source = "heynova-lead-extractor"`
  - `meta.requestedAt`
  - `meta.requestId`
- Forwards payload to:
  - `https://n8n.automatenow.live/webhook/linkedin-search`

## Response

Success:

```json
{
  "success": true,
  "message": "Search request sent successfully."
}
```

Failure:

```json
{
  "success": false,
  "message": "Search request failed."
}
```

or

```json
{
  "success": false,
  "message": "Unable to send search request right now."
}
```
