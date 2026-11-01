# 🤖 AGENT.md — Developer & AI Agent Guidelines

> **Project**: Senay Verifier API (`senay-verifier-api`)  
> **Repository**: [eyuelkebede20/verifier](https://github.com/eyuelkebede20/verifier)  
> **Deployment**: `https://verifier.senaycreatives.com` (cPanel / LiteSpeed Shared Hosting)

---

## 1. Architectural Philosophy & Core Invariants

1. **Zero Database Runtime**:
   - This service **MUST NOT** depend on Prisma, MySQL, PostgreSQL, SQLite, Redis, or BullMQ at runtime.
   - All receipt verifications are performed via direct bank APIs or web scrapers (`axios`, `cheerio`, `pdf-parse`).
   - Do **NOT** re-introduce ORM migrations, queue workers, or persistent database connections into the main runtime.

2. **Shared Hosting & CloudLinux LVE Compatibility**:
   - The production environment runs on cPanel with CloudLinux LVE (4GB virtual address space limit).
   - Node 22 V8 WebAssembly trap-handlers can cause `RangeError: WebAssembly.instantiate(): Out of memory` if heavy guard pages are allocated.
   - The service is designed to run with `--disable-wasm-trap-handler` (already configured in `package.json` and `app.cjs`).
   - The memory footprint must stay lightweight (~25MB RAM).

3. **Multi-Project Reusability**:
   - This microservice is consumed by multiple independent client projects (MentalWeg, e-commerce stores, client billing portals, etc.).
   - Multi-tenant authentication is managed entirely via environment variables (`API_KEYS=key1,key2,key3` or `VERIFIER_API_KEY`).
   - Incoming requests authenticate by providing `x-api-key: <key>` or `Authorization: Bearer <key>`.

---

## 2. Directory Structure

```
verifier/
├── app.cjs                   # Phusion Passenger / LiteSpeed entrypoint shim
├── app.js                    # cPanel default entrypoint forwarder
├── package.json              # Minimal production dependencies (axios, cheerio, express, winston)
├── tsconfig.json             # TypeScript build configuration (outputs to dist/)
├── .env.example              # Environment template
├── README.md                 # Public documentation
├── AGENT.md                  # This instruction file for AI agents & contributors
├── src/
│   ├── index.ts              # Express application bootstrap & route definitions
│   ├── middleware/
│   │   ├── apiKeyAuth.ts     # In-memory API key validation across authorized projects
│   │   └── rateLimiter.ts    # In-memory sliding-window rate limiter (120 req/min)
│   ├── services/
│   │   ├── verifyUniversal.ts # Smart auto-detecting router
│   │   ├── verifyTelebirr.ts  # Ethio Telecom Telebirr receipt web scraper
│   │   ├── verifyCBE.ts       # CBE API & legacy PDF parser
│   │   ├── verifyDashen.ts    # Dashen Bank portal verification
│   │   ├── verifyAbyssinia.ts # Bank of Abyssinia transaction verifier
│   │   ├── verifyCBEBirr.ts   # CBE Birr mobile wallet scraper
│   │   └── verifyMpesa.ts     # Safaricom M-Pesa receipt verification
│   ├── types/
│   │   ├── statusProbe.ts     # Provider status and health types
│   │   └── pdf-parse.d.ts     # Type declarations for pdf-parse
│   └── utils/
│       ├── cbeReference.ts    # Regex utilities for detecting new vs legacy CBE references
│       ├── logger.ts          # Winston logger with timestamp and metadata
│       └── sensitiveLogContext.ts # Node async_hooks logger redaction helper
```

---

## 3. Endpoints & Provider Contract

| Endpoint | Method | Input Body | Key Validation Rules |
| :--- | :--- | :--- | :--- |
| **`/verify`** | `POST` | `{ reference, suffix?, phoneNumber?, html? }` | Auto-detects provider based on reference pattern. Accepts `html` for client bounce. |
| **`/verify-telebirr`** | `POST` | `{ reference?, html? }` | Scrapes Telebirr receipt portal or parses client-bounced raw HTML to bypass foreign geo-blocks. |
| **`/verify-cbe`** | `POST` | `{ reference, accountSuffix? }` | Supports new token format or legacy `FT...` reference + 8-digit account suffix. |
| **`/verify-dashen`** | `POST` | `{ reference }` | Queries Dashen portal. |
| **`/verify-abyssinia`**| `POST` | `{ reference, suffix }` | `suffix` must be exactly 5 digits. |
| **`/verify-cbebirr`**  | `POST` | `{ receiptNumber, phoneNumber }` | `phoneNumber` must start with `251` (12 digits total). |
| **`/verify-mpesa`**    | `POST` | `{ reference }` | Queries Safaricom M-Pesa receipt API. |
| **`/api/public-verify`** | `POST` | `{ reference, bank?, suffix?, phoneNumber?, html? }` | Public receipt verification for the landing page tester UI with in-browser OCR, QR & Telebirr bounce. |
| **`/admin`**           | `GET`  | *None* | Developer & Admin Console UI for managing app keys & viewing live usage. |
| **`/api/admin/login`** | `POST` | `{ key }` | Authenticates admin using `ADMIN_KEY`, `ADMIN_KEY_HASH`, or `UNKEY_ROOT_KEY`. |
| **`/api/admin/keys`**  | `GET`, `POST` | `{ name, description?, rateLimit? }` | Lists or generates new app API keys. |
| **`/api/admin/keys/:id/toggle`** | `PATCH` | *None* | Toggles key status between active and revoked. |
| **`/api/admin/keys/:id`** | `DELETE` | *None* | Deletes an app API key. |
| **`/api/admin/usage`** | `GET`  | *None* | Returns real-time metrics, provider breakdown, per-app volume, and live audit logs. |
| **`/health`**          | `GET`  | *None* | Returns `{ status: 'ok', uptimeSeconds, timestamp }`. Public. |
| **`/`**                | `GET`  | *None* | Returns landing page (HTML) or API metadata (JSON). Public. |

---

## 4. Development & Testing Rules for Agents

### Mock / Test References
For local development and unit tests, all verification endpoints recognize references starting with `TEST` or `MOCK` and return immediate, realistic successful response payloads without contacting bank upstreams:
```json
{
  "reference": "TEST12345678"
}
```

### Adding New Providers
When adding a new Ethiopian financial provider (e.g. Awash Bank, Zemen Bank, Hibret Bank):
1. Create `src/services/verify<Provider>.ts` with an exported `verify<Provider>(reference, ...)` function.
2. Return a standardized result object: `{ success: boolean, payer?: string, amount?: number, reference?: string, date?: Date, error?: string }`.
3. Add the provider detection pattern to [`src/services/verifyUniversal.ts`](src/services/verifyUniversal.ts) so `/verify` can automatically route to it.
4. Mount the dedicated route `POST /verify-<provider>` in [`src/index.ts`](src/index.ts).

### Environment Variables
- `PORT`: Server port (default `3001`).
- `ADMIN_KEY`: Master secret to unlock the developer console at `/admin`.
- `ADMIN_KEY_HASH`: Optional SHA-256 hex hash of the master secret for extra security.
- `UNKEY_ROOT_KEY`: Optional headless open-source Unkey root key (e.g., `unkey_...`).
- `UNKEY_API_ID`: Optional Unkey API namespace ID for automated key management and telemetry.
- `API_KEYS`: Comma-separated list of allowed client keys (e.g., `mentalweg_live_key,shop_key`).
- `VERIFIER_API_KEY`: Backward-compatible single secret key.
- `RATE_LIMIT_PER_MINUTE`: Maximum requests per minute per IP / key (default `120`).

---

## 5. Build, Test & Deployment Commands

```bash
# Install dependencies
npm install

# Run unit tests
npm test

# Build TypeScript to dist/
npm run build

# Start local server
npm start

# Run with hot reload
npm run dev

# Pack bundle for cPanel shared hosting (outputs to dist-cpanel/verifier and verifier-cpanel-bundle.zip)
npm run pack:cpanel
```

---

## 6. Automated CI/CD & cPanel Deployment

- Automated FTP deployment runs via [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) on push to `main`.
- Secrets configured under GitHub environment `SenayCreatives`:
  - `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD`, and optionally `FTP_VERIFIER_DIR` (defaults to `api/verifier/`).
- The deployment maintains isolated production `node_modules` inside `./app/node_modules` to prevent collisions with CloudLinux `nodevenv` symlinks.
- Passenger reload is automatically triggered via `tmp/restart.txt`.
