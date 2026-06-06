# Workflow: auth & secrets (keep them safe)

reqweave **never embeds secrets**. Requests reference placeholders; each tool
gets an environment template with the secret slots left blank.

## How auth shows up
- For `[Authorize]` endpoints, requests carry `Authorization: Bearer {{bearerToken}}` (or `{{apiKey}}` / `{{basicAuth}}` depending on the scheme).
- A matching **unauthorized** variant omits auth and expects `401`.
- Placeholders are rewritten to each tool's native syntax automatically:
  - Postman / Thunder / Bruno / `.http`: `{{var}}`
  - Insomnia: `{{ _.var }}`
  - Hoppscotch: `<<var>>`

## Variables produced
`baseUrl` (defaults to `--base-url`), and any of `bearerToken` / `apiKey` / `basicAuth` actually used. In env templates, **`baseUrl` is filled; secrets are blank**.

## What to tell the user
1. Import the collection **and** its environment file for your tool.
2. Fill the secret values **locally** in the tool's environment (or your own untracked env file). Never paste real tokens into the collection.
3. **Do not commit** filled secrets. If you commit the generated output, commit only the blank templates.
4. reqweave also runs a redaction pass over any source-derived example values, so accidental literals don't leak — but treat the output as if it could, and review before sharing.
