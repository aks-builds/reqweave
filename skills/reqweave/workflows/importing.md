# Workflow: importing into each tool

After `generate`, import the file(s) for the user's tool, then fill secrets
(see secure-auth.md).

| Tool | Import | Environment |
|---|---|---|
| **Postman** | Import → Files → `postman/<svc>.postman_collection.json` | Import `…postman_environment.json`; select it; fill secrets. |
| **OpenAPI 3.1** | Most tools (Insomnia, Bruno, Hoppscotch, Stoplight, Postman) can import `openapi/<svc>.openapi.json` directly | Set the server/`baseUrl`. |
| **Insomnia** | Import → from File → `insomnia/<svc>.insomnia.json` (v4 export) | Base environment is included; fill secret vars. |
| **Bruno** | Open Collection → select the `bruno/` folder | `environments/Local.bru`; fill `bearerToken` etc. |
| **Hoppscotch** | Collections → Import → Hoppscotch → `…hoppscotch-collection.json` | Import the `…hoppscotch-environment.json`; select it. |
| **Thunder Client** | Collections → Import → `…thunder-collection.json` | Import the `…thunder-environment.json`. |
| **.http** | Open `http/<svc>.http` in VS Code REST Client or JetBrains HTTP client | `http/http-client.env.json` (select the `dev` env). |

Notes:
- OpenAPI is the most portable single file — if a tool isn't listed, try importing the OpenAPI doc.
- Every request points at `{{baseUrl}}`; set it in the environment before sending.
- Variant names describe intent (e.g. `not found`, `invalid body (400)`, `unauthorized`) so the user knows what each request checks.
