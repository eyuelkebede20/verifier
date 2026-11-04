# 🇪🇹 Senay Verifier API

A lightweight, standalone microservice for verifying Ethiopian bank and mobile money receipts. Designed to be reused across multiple projects (MentalWeg, e-commerce stores, SaaS apps, billing portals).

## ✨ Supported Providers

| Provider | Endpoint | Method | Key Parameters |
| :--- | :--- | :--- | :--- |
| **Smart Universal** | `/verify` | `POST` | `reference`, `suffix?`, `phoneNumber?`, `html?` *(Auto-detects bank)* |
| **Telebirr** | `/verify-telebirr` | `POST` | `reference?`, `html?` *(Direct query or Client Bounce)* |
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

#### ⚡ Telebirr Client Bounce (Bypassing Foreign Datacenter Geo-Blocks):
Because Ethio Telecom's receipt server (`transactioninfo.ethiotelecom.et`) geo-blocks non-Ethiopian cloud datacenters (like European/UK shared hosting), mobile apps (Flutter, React Native, iOS, Android) running on user devices in Ethiopia can fetch the official receipt directly (no CORS restrictions on native apps) and **bounce the raw HTML back** to the Verifier API to parse, audit, and log:

```bash
curl -X POST https://verifier.senaycreatives.com/verify-telebirr \
  -H "Content-Type: application/json" \
  -H "x-api-key: mentalweg_key_2026" \
  -d '{
    "reference": "TB2601019999",
    "html": "<!DOCTYPE html><html>...</html>"
  }'
```

##### Flutter / Dart Implementation:
```dart
import 'package:http/http.dart' as http;
import 'dart:convert';

Future<Map<String, dynamic>> verifyTelebirrThroughClient(String reference) async {
  // 1. Fetch official receipt directly from customer device in Ethiopia (no CORS)
  final telebirrResponse = await http.get(
    Uri.parse('https://transactioninfo.ethiotelecom.et/receipt/$reference'),
  );

  // 2. Bounce HTML back to Senay Verifier API to parse, validate & log
  final verifierResponse = await http.post(
    Uri.parse('https://verifier.senaycreatives.com/verify-telebirr'),
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': 'your_app_api_key',
    },
    body: jsonEncode({
      'reference': reference,
      'html': telebirrResponse.body,
    }),
  );

  return jsonDecode(verifierResponse.body);
}
```

---

## 🤖 Google ML (On-Device ML Kit) vs. Authoritative Bank Verification

A common question among mobile & web developers:
> *"Can Google ML do everything on the client device without needing an authoritative backend server?"*

### 1. What Google ML DOES on the Client Device (100% Serverless):
- **Zero Server Image Bandwidth & GPU Cost**: Using **Google ML Kit** on mobile (`google_mlkit_text_recognition`, `google_mlkit_barcode_scanning`) or native Chromium Shape Detection (`window.BarcodeDetector`, `window.TextDetector`) on Web, image scanning runs **locally on the user's CPU/GPU** in $< 50\text{ ms}$.
- **Zero Privacy Risk**: Images never leave the customer's phone or browser.
- **Instant Pattern Extraction**: It parses the printed reference code (`FT240101ABCD`, `CJT8R50V28`, etc.) locally.

### 2. Why Authoritative Bank Verification is Strictly Required:
- **Photoshopped & Fake Receipts**: Anyone can fabricate a fake payment screenshot in 30 seconds using photo editing apps.
- **Duplicate Replay Attacks**: A buyer can reuse a real receipt from last week to claim a new order today.
- **Cancelled/Reversed Payments**: A transaction might show "Submitted" on a slip but later failed or got reversed.
- **Google ML only reads pixels**: Google ML has zero connection to CBE, Telebirr, or Dashen bank ledgers. It cannot tell whether money was actually deposited into your merchant account.

### 3. The Recommended Industry Pipeline (Google ML + Senay Verifier):
```
[User snaps photo/slip] 
       │
       ▼ (100% on-device - 0ms server, 0 KB image upload)
[Google ML Kit / On-Device ML] ──► Extracts: "FT240101ABCD"
       │
       ▼ (Lightweight JSON text only: ~40 bytes)
[Senay Verifier API: POST /verify] ──► Audits official bank ledger ──► Verified / Fraud Blocked!
```

#### Flutter / Dart Implementation (Google ML Kit + Verifier API):
```dart
import 'package:google_mlkit_text_recognition/google_mlkit_text_recognition.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';

Future<Map<String, dynamic>> scanAndVerifyReceipt(String imagePath) async {
  // Step 1: Run Google ML Kit on-device text recognition (Zero Server)
  final inputImage = InputImage.fromFilePath(imagePath);
  final textRecognizer = TextRecognizer();
  final RecognizedText recognizedText = await textRecognizer.processImage(inputImage);
  await textRecognizer.close();

  // Step 2: Extract transaction reference via regex
  final fullText = recognizedText.text;
  final cbeMatch = RegExp(r'(FT[A-Z0-9]{8,14})').firstMatch(fullText);
  final teleMatch = RegExp(r'\b([A-Z0-9]{10,12})\b').firstMatch(fullText);
  final reference = cbeMatch?.group(1) ?? teleMatch?.group(1);

  if (reference == null) {
    throw Exception('No valid bank reference detected in receipt image.');
  }

  // Step 3: Authoritative Verification with Senay Verifier API (Zero Image Upload)
  final response = await http.post(
    Uri.parse('https://verifier.senaycreatives.com/verify'),
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': 'your_api_key_here',
    },
    body: jsonEncode({'reference': reference}),
  );

  return jsonDecode(response.body);
}
```

---

## 🛠️ cPanel / Shared Hosting Deployment

1. **Automated CI/CD**:
   - Pushing to `main` triggers [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) which tests, compiles, packages Linux x64 production dependencies, and deploys directly to `api/verifier/` on cPanel.
2. **Manual Pack / Upload (Alternative)**:
   - Run `npm run pack:cpanel` to generate the pre-compiled, self-contained `verifier-cpanel-bundle.zip`.
   - Upload and extract directly to `api/verifier/` in cPanel File Manager.
3. **cPanel Node.js Selector Setup**:
   - **Application root**: `api/verifier`
   - **Application URL**: `verifier.senaycreatives.com`
   - **Application startup file**: `app.cjs`
   - **Node.js version**: 20.x or 22.x
   - **Environment variables**:
     - `NODE_ENV=production`
     - `NODE_OPTIONS=--disable-wasm-trap-handler`
     - `API_KEYS=your_secret_keys_here`
     - `PORT=3001`

---

## 📄 License
MIT © Senay Creatives
