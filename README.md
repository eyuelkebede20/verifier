# 🇪🇹 Senay Verifier API

A lightweight, standalone microservice for verifying Ethiopian bank and mobile money receipts. Designed to be reused across multiple projects (MentalWeg, e-commerce stores, SaaS apps, billing portals).

## ✨ Supported Providers

| Provider | Endpoint | Method | Key Parameters |
| :--- | :--- | :--- | :--- |
| **Smart Universal** | `/verify` | `POST` | `reference`, `suffix?`, `phoneNumber?` *(Auto-detects bank)* |
| **Telebirr** | `/verify-telebirr` | `POST` | `reference` |
| **CBE (Commercial Bank of Ethiopia)** | `/verify-cbe` | `POST` | `reference`, `accountSuffix?` |
| **Dashen Bank** | `/verify-dashen` | `POST` | `reference` |
| **Bank of Abyssinia (BoA)** | `/verify-abyssinia` | `POST` | `reference`, `suffix` (5 digits) |
| **CBE Birr** | `/verify-cbebirr` | `POST` | `receiptNumber`, `phoneNumber` |
| **M-Pesa (Safaricom)** | `/verify-mpesa` | `POST` | `reference` |

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Set your allowed API keys in `.env`:
```env
PORT=3001
API_KEYS=project_one_key,project_two_key,mentalweg_key_2026
```

### 3. Build & Run
```bash
# Build TypeScript
npm run build

# Start production server
npm start

# Development mode with hot-reload
npm run dev
```

---

## 🔐 Multi-Project Authentication

Authenticate calls from any of your projects by including the API key in the request header:

```http
x-api-key: your-project-api-key
```
or via Bearer token:
```http
Authorization: Bearer your-project-api-key
```

### Example Usage (from another project):

#### Universal Verification (Smart Router):
```bash
curl -X POST https://verifier.senaycreatives.com/verify \
  -H "Content-Type: application/json" \
  -H "x-api-key: mentalweg_key_2026" \
  -d '{"reference": "FT240101ABCD"}'
```

#### Direct Telebirr Verification:
```bash
curl -X POST https://verifier.senaycreatives.com/verify-telebirr \
  -H "Content-Type: application/json" \
  -H "x-api-key: mentalweg_key_2026" \
  -d '{"reference": "TB2601019999"}'
```

---

## 🛠️ cPanel / Shared Hosting Deployment

1. Set up a Node.js Application in cPanel:
   - **Application root**: `api/verifier`
   - **Application startup file**: `app.cjs`
2. Upload the project files and run `npm install --omit=dev`.
3. Restart the application from cPanel.

---

## 📄 License
MIT © Senay Creatives
