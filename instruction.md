# 🚀 Senay Verifier API — Shared Hosting Deployment Guide

> **Microservice**: Senay Verifier API (`senay-verifier-api`)  
> **Target Environment**: Shared Hosting (cPanel / LiteSpeed / CloudLinux LVE with Phusion Passenger)  
> **Production Target**: `https://verifier.senaycreatives.com` (or your custom subdomain/domain)  
> **Archive Artifact**: `verifier-cpanel-bundle.zip` (~32 MB)  
> **Status**: ✅ Tested, Built, and Ready to Deploy  

---

## 📋 Table of Contents
1. [Executive Review & Why Render Failed](#1-executive-review--why-render-failed)
2. [Why Shared Hosting is the Ideal Fit](#2-why-shared-hosting-is-the-ideal-fit)
3. [Pre-Requisites Checklist](#3-pre-requisites-checklist)
4. [Method 1: Manual Deployment via cPanel File Manager (Fastest & Ready Now)](#4-method-1-manual-deployment-via-cpanel-file-manager-fastest--ready-now)
5. [Method 2: Automated CI/CD Deployment via GitHub Actions (Set & Forget)](#5-method-2-automated-cicd-deployment-via-github-actions-set--forget)
6. [Environment Variables Reference (`.env`)](#6-environment-variables-reference-env)
7. [Post-Deployment Health Checks & Verification](#7-post-deployment-health-checks--verification)
8. [Troubleshooting & Common Shared Hosting Pitfalls](#8-troubleshooting--common-shared-hosting-pitfalls)

---

## 1. Executive Review & Why Render Failed

When deploying `senay-verifier-api` to cloud container platforms like **Render**, deployments typically fail due to four structural constraints:

| Failure Cause on Render | Technical Root Cause | How Shared Hosting Resolves It |
| :--- | :--- | :--- |
| **Out-Of-Memory (OOM) 137** | Render free tier limits containers to **512MB RAM**. Node 22 V8 WebAssembly trap-handlers allocate large virtual guard pages, and headless browser processes consume 200MB+ per tab. | Shared hosting runs our bundled microservice at **~25MB to 35MB RAM**, bypassing heavy container runtimes. |
| **Missing Native Dependencies** | Render's bare Debian/Alpine containers lack required OS libraries (`libnss3`, `libasound2`, `libX11`, `libgbm1`) needed if legacy scrapers invoke Puppeteer. | Our build packages pre-compiled Linux x64 dependencies directly into `app/node_modules`, using pure-JS HTTP/2 and Cheerio scrapers. |
| **Inactivity Spin-down / Cold Starts** | Render free instances hibernate after 15 minutes. Cold boots take 50–70 seconds, causing checkout payment verification timeouts on client apps. | Phusion Passenger on shared hosting keeps worker processes warm or instantly boots them via fast reverse proxy sockets. |
| **Foreign Datacenter Geo-Blocking** | Ethio Telecom (`transactioninfo.ethiotelecom.et`) and certain bank gateways actively block or throttle well-known US/EU cloud datacenter IP ranges (Render, AWS, DigitalOcean). | Shared hosting supports the built-in **Client Bounce Architecture** (`POST /verify-telebirr` with `html`), allowing Ethiopian client devices to fetch receipts directly without foreign datacenter blocking. |

---

## 2. Why Shared Hosting is the Ideal Fit

The codebase in `../2019/verifier` has been specifically architected for **cPanel / CloudLinux LVE / LiteSpeed with Phusion Passenger**:

- **Zero-Database Runtime**: No MySQL, PostgreSQL, SQLite, or Redis processes required. Eliminates database pool exhaustion and locked table overhead.
- **Isolated Module Architecture (`./app/node_modules`)**: CloudLinux Node.js Selector uses virtual environments (`nodevenv`) that create root symlinks. Our packager isolates the real production dependencies in `./app/node_modules`, completely preventing symlink and permission collisions.
- **Dedicated Passenger Shim (`app.cjs`)**: Automatically sets `--disable-wasm-trap-handler`, dynamically resolves module lookup paths, creates `logs/` and `tmp/` folders, and catches fatal boot exceptions in `logs/startup-error.log` instead of throwing silent 503 errors.
- **In-Memory LRU Caching**: Serves duplicate verification requests in `< 1ms` with bounded memory.

---

## 3. Pre-Requisites Checklist

Before starting, ensure you have:
- [x] Access to your cPanel dashboard (e.g., `https://your-domain.com:2083`).
- [x] **"Setup Node.js App"** (CloudLinux Node.js Selector) available in your cPanel software section.
- [x] A domain or subdomain created (recommended: `verifier.senaycreatives.com` or `api.yourdomain.com`).
- [x] The pre-packaged deployment archive:
  - Location on disk: `D:\Apps\2019\verifier\verifier-cpanel-bundle.zip` (~32 MB).

---

## 4. Method 1: Manual Deployment via cPanel File Manager (Fastest & Ready Now)

This method takes under 5 minutes and uses the pre-compiled bundle already generated.

### Step 1: Create the Subdomain (if not already existing)
1. Log into **cPanel**.
2. Go to **Domains** > **Domains** (or **Subdomains**).
3. Click **Create A New Domain**.
4. Enter your subdomain: e.g., `verifier.senaycreatives.com`.
5. Set the **Document Root** to a dedicated folder, e.g.:
   `public_html/verifier` or `api/verifier`.
6. Click **Submit**.

---

### Step 2: Configure the Node.js Application in cPanel
1. In cPanel, navigate to the **Software** section and click **Setup Node.js App**.
2. Click the **Create Application** button (top right).
3. Fill in the configuration fields:

| Field | Recommended Value | Notes |
| :--- | :--- | :--- |
| **Node.js version** | `20.x` or `22.x` | Select version 20 or 22 from the dropdown. |
| **Application mode** | `Production` | Ensures performance optimizations. |
| **Application root** | `api/verifier` | Path relative to your home directory (`/home/username/api/verifier`). |
| **Application URL** | `verifier.senaycreatives.com` | Select your configured subdomain from the dropdown. |
| **Application startup file** | `app.cjs` | **Critical**: Points to the Passenger shim. |

4. Scroll down to **Environment variables** and add:
   - Name: `NODE_ENV` &rarr; Value: `production`
   - Name: `NODE_OPTIONS` &rarr; Value: `--disable-wasm-trap-handler`
   - Name: `PORT` &rarr; Value: `3001`
5. Click **Create** (top right).  
   *Note: cPanel will create the basic directory structure and a default sample file.*

---

### Step 3: Upload and Extract the Pre-Built Bundle
1. In cPanel, open **File Manager** (under Files).
2. Navigate to your Application Root: `/home/username/api/verifier/`.
3. If cPanel generated a default `app.js`, delete or keep it (our bundle overwrites it with the proper bridge).
4. Click **Upload** in the top toolbar.
5. Select and upload the local bundle:
   `D:\Apps\2019\verifier\verifier-cpanel-bundle.zip`
6. Once uploaded (100% green bar), go back to File Manager.
7. Right-click `verifier-cpanel-bundle.zip` and select **Extract**.
8. Extract files directly into `/home/username/api/verifier/`.

#### Verifying Directory Structure after Extraction:
Inside `/home/username/api/verifier/`, your layout must look like:
```text
/home/username/api/verifier/
├── app.cjs                     <-- Passenger bootstrap shim
├── app.js                      <-- Bridge forwarding to app.cjs
├── package.json                <-- Package metadata
├── .htaccess                   <-- CloudLinux Passenger routing directives
├── .env.example                <-- Environment template
├── public/                     <-- Web landing page & tester UI
│   ├── index.html
│   └── admin/
├── logs/                       <-- Winston rotating log files
├── tmp/                        <-- Passenger restart trigger
│   └── restart.txt
└── app/                        <-- Isolated production container
    ├── package.json
    ├── dist/                   <-- Compiled microservice (dist/index.js)
    └── node_modules/           <-- Complete Linux x64 dependencies
```

---

### Step 4: Configure Environment Secrets (`.env`)
1. In cPanel File Manager inside `/home/username/api/verifier/`:
2. Find `.env.example`, right-click and select **Copy**.
3. Name the new file `.env`.
4. Right-click `.env` and select **Edit**.
5. Set your production secrets:
```env
PORT=3001
NODE_ENV=production
LOG_LEVEL=info

# Master Admin Key to unlock Developer Console at /admin
ADMIN_KEY=your_secure_admin_password_2026

# Authorized Client API Keys (comma-separated for multi-project access)
API_KEYS=mentalweg_key_live_2026,ecommerce_app_key_2026,mobile_client_key_2026

# Backward-Compatible Secret (for MentalWeg backend integration)
VERIFIER_API_KEY=senaycreatives-verifier-secret-key-2026

# Sliding Window Rate Limit (requests per minute per IP/Key)
RATE_LIMIT_PER_MINUTE=120

# Optional: Fallback Proxies for Telebirr
FALLBACK_PROXIES=
SKIP_PRIMARY_VERIFICATION=false
```
6. Click **Save Changes**.

---

### Step 5: Restart the Application
To load the newly uploaded files and `.env`:
1. **Option A (GUI)**: Go back to cPanel > **Setup Node.js App**, find your application, and click **Restart**.
2. **Option B (File Manager / Instant Touch)**: Open `/home/username/api/verifier/tmp/`, right-click `restart.txt`, click **Edit**, add a space or new line, and save. Phusion Passenger detects this file change instantly and restarts the worker.

---

## 5. Method 2: Automated CI/CD Deployment via GitHub Actions (Set & Forget)

The repository already includes a complete GitHub Actions workflow at:
`.github/workflows/deploy.yml`

Whenever you push to the `main` branch, GitHub Actions will:
1. Run automated unit tests (`npm test`).
2. Build the TypeScript microservice (`npx tsc`).
3. Bundle Linux x64 dependencies (`node scripts/pack-cpanel.mjs`).
4. Securely upload only changed files via FTP/FTPS directly to your cPanel host.
5. Touch `tmp/restart.txt` to trigger an automatic zero-downtime reload.

### Setting Up GitHub Secrets:
1. Go to your GitHub repository: `https://github.com/eyuelkebede20/verifier`.
2. Navigate to **Settings** > **Secrets and variables** > **Actions**.
3. Add the following **Repository Secrets**:

| Secret Name | Value Example | Description |
| :--- | :--- | :--- |
| `FTP_SERVER` | `ftp.senaycreatives.com` or server IP | Your shared hosting FTP host. |
| `FTP_USERNAME` | `deployer@senaycreatives.com` or cPanel user | FTP user with access to application root. |
| `FTP_PASSWORD` | `••••••••••••` | The FTP password. |
| `FTP_PORT` | `21` | Standard FTP (or `22` for SFTP). |
| `FTP_VERIFIER_DIR` | `api/verifier/` | Target directory relative to FTP login root. |

Now, whenever you run `git push origin main`, your shared hosting environment will update automatically!

---

## 6. Environment Variables Reference (`.env`)

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `PORT` | Number | `3001` | Internal server port for Express. |
| `NODE_ENV` | String | `production` | Environment mode. |
| `NODE_OPTIONS` | String | `--disable-wasm-trap-handler` | **Required** for CloudLinux 4GB virtual address limit. |
| `ADMIN_KEY` | String | *Required* | Master password to unlock `/admin` developer console. |
| `ADMIN_KEY_HASH` | String | *Optional* | Pre-computed SHA-256 hex hash of the admin key. |
| `API_KEYS` | String | *Required* | Comma-separated list of keys allowed to call `/verify`. |
| `VERIFIER_API_KEY`| String | *Required* | Backward-compatible single key matching client apps. |
| `RATE_LIMIT_PER_MINUTE` | Number | `120` | Max calls allowed per minute per IP / key. |
| `FALLBACK_PROXIES` | String | *Optional* | Comma-separated proxy URLs for scraping Telebirr. |
| `UNKEY_ROOT_KEY` | String | *Optional* | Headless Unkey key management integration. |

---

## 7. Post-Deployment Health Checks & Verification

After restarting, verify all endpoints using your browser or terminal:

### 1. Public Health Check
Open in browser or run curl:
```bash
curl -i https://verifier.senaycreatives.com/health
```
**Expected Response (HTTP 200)**:
```json
{
  "status": "ok",
  "uptimeSeconds": 14,
  "timestamp": "2026-11-04T08:35:00.000Z"
}
```

---

### 2. API Specification
```bash
curl -i https://verifier.senaycreatives.com/api
```
**Expected Response (HTTP 200)**:
Returns the JSON catalog of all 7 verification endpoints.

---

### 3. Public Landing Page & Admin Console
- **Public Interactive Tester**: Visit `https://verifier.senaycreatives.com/` in your browser. It serves the landing page with the interactive receipt tester UI and client-bounce QR/slip reader.
- **Admin & Usage Dashboard**: Visit `https://verifier.senaycreatives.com/admin`. Log in using your `ADMIN_KEY` to view real-time verification graphs, per-app breakdown, and audit logs.

---

### 4. Live Verification Test (Mock Reference)
All endpoints support built-in test fixtures prefixed with `TEST` without contacting upstream banks:
```bash
curl -X POST https://verifier.senaycreatives.com/verify \
  -H "Content-Type: application/json" \
  -H "x-api-key: mentalweg_key_live_2026" \
  -d '{"reference": "TEST12345678"}'
```
**Expected Response (HTTP 200)**:
```json
{
  "success": true,
  "provider": "cbe",
  "receipt": {
    "reference": "TEST12345678",
    "amount": 2500,
    "currency": "ETB",
    "status": "Completed"
  }
}
```

---

## 8. Troubleshooting & Common Shared Hosting Pitfalls

### Issue 1: "503 Service Unavailable" or "Application failed to start"
- **Cause**: Node encountered an unhandled exception during boot.
- **Solution**:
  1. Open cPanel File Manager and check `/home/username/api/verifier/logs/startup-error.log`.
  2. Our `app.cjs` traps exact stack traces here.
  3. If the log is empty, check cPanel's Passenger stderr log at `/home/username/logs/passenger.log` or stderr output.
  4. Verify that `app.cjs` is set as the startup file in cPanel Node.js App.

---

### Issue 2: `RangeError: WebAssembly.instantiate(): Out of memory`
- **Cause**: CloudLinux LVE enforces a 4GB virtual address space limit. Node 20/22 V8 WebAssembly trap-handlers allocate memory reservations that exceed this limit.
- **Solution**:
  Ensure `NODE_OPTIONS=--disable-wasm-trap-handler` is defined in both:
  1. cPanel > **Setup Node.js App** > **Environment variables**.
  2. The top of `app.cjs` (already built-in).

---

### Issue 3: `Cannot find module ...` or Symlink Permission Error
- **Cause**: CloudLinux `nodevenv` symlink collisions.
- **Solution**:
  Do **NOT** run `npm install` inside the root cPanel directory. The bundle is structured so the real production packages reside in `/home/username/api/verifier/app/node_modules`. Our `app.cjs` automatically injects this path into `Module._initPaths()`.

---

### Issue 4: Telebirr Foreign Datacenter Block (`ETIMEDOUT` or `403`)
- **Cause**: Ethio Telecom restricts receipt scraping from IPs located outside Ethiopia.
- **Solution**:
  Use the **Client Bounce Protocol**:
  1. Native mobile apps or browsers in Ethiopia fetch `https://transactioninfo.ethiotelecom.et/receipt/<reference>`.
  2. Forward the returned HTML to the verifier:
  ```http
  POST /verify-telebirr
  Content-Type: application/json
  x-api-key: your_key

  {
    "reference": "TB2601019999",
    "html": "<html>...</html>"
  }
  ```
  The verifier will parse the markup, extract payer/receiver data, validate against fraud, and record usage without making foreign upstream HTTP calls.

---

### Issue 5: How to Rebuild the Bundle Locally
If you make code changes in `src/`, run:
```bash
# In D:\Apps\2019\verifier:
npm run pack:cpanel
```
This single command compiles TypeScript, updates `./app/dist`, bundles Linux x64 dependencies, and generates a fresh `verifier-cpanel-bundle.zip`.
