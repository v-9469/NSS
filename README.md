# National Service Scheme (NSS) Portal — Bangalore Institute of Technology

A full-stack, containerized web application for the National Service Scheme (NSS) unit at Bangalore Institute of Technology (BIT), Bengaluru.

---

## Features

1. **Public Portal (`/`)**:
   - Institutional Masthead with Rajya Vokkaliga Sangha (R) & Bangalore Institute of Technology branding.
   - Core Mandate, Objectives, and Roles & Responsibilities.
   - **Embedded Google Form (`#register`)**: Official student volunteer enrolment form (`https://forms.gle/tA8kGZB2BUL6PVY67`) embedded seamlessly with responsive fallback.
   - **Dynamic SQLite Photo Gallery (`#gallery`)**: Automatically fetches published event albums from the backend, with year filtering, pagination, and a full-screen interactive Lightbox with thumbnail navigation.

2. **Dedicated Admin Portal (`/admin`)**:
   - Standalone, secure authentication route for Programme Officer / Administrators.
   - **Multi-Photo Upload**: Select or drag-and-drop multiple high-resolution photos for a single activity title, event date, and description.
   - Live photo preview grid with file size display and pre-upload remove buttons.
   - Album management: Add more photos to an existing album, edit title/description/date, or permanently delete albums and media.
   - Secure Admin Password change modal.

3. **Backend & Persistence**:
   - Built on Node.js & Express.
   - High-performance embedded **SQLite** relational database with foreign-key cascade deletions.
   - Static media serving for uploaded photos.
   - Pre-seeded with initial BIT gallery archives.

4. **Production Ready & Containerized**:
   - `Dockerfile` using `node:22-alpine` with healthcheck.
   - `docker-compose.yml` with persistent named volumes for SQLite database (`/app/data`) and media uploads (`/app/uploads`).

---

## Quick Start (Local Run)

### Prerequisites:
- Node.js v20+ or v22+ (v24 installed)
- npm

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Server
```bash
npm start
```

Visit in your browser:
* **Public Portal:** [http://localhost:5000](http://localhost:5000)
* **Admin Dashboard:** [http://localhost:5000/admin](http://localhost:5000/admin)

### Default Admin Credentials:
* **Email:** `sushilkumarv@bit-bangalore.edu.in`
* **Password:** `NSS@2026`

*(You can change the password at any time via the admin dashboard menu)*

---

## Docker Deployment

### Run with Docker Compose (Recommended)

```bash
docker compose up -d --build
```
*(Or with older compose syntax: `docker-compose up -d --build`)*

This starts the container in detached mode on port `5000` and creates two persistent Docker volumes:
* `nss_bit_sqlite_data`: Stores `nss.db`
* `nss_bit_uploads_data`: Stores uploaded photograph files

### Run with plain Docker:

```bash
# 1. Build the image
docker build -t nss-bit-app .

# 2. Run the container with persistent volumes
docker run -d \
  --name nss_bit_portal \
  -p 5000:5000 \
  -v nss_data:/app/data \
  -v nss_uploads:/app/uploads \
  --restart unless-stopped \
  nss-bit-app
```

---

## Project Structure

```
├── Dockerfile                  # Production container definition (node:22-alpine)
├── docker-compose.yml          # Multi-volume container orchestration
├── .dockerignore               # Optimized Docker build context
├── .env.example                # Environment variables template
├── package.json                # Project dependencies and run scripts
├── server.js                   # Express server, auth middleware & REST endpoints
├── db.js                       # SQLite initialization, migrations & helpers
├── public/
│   ├── index.html              # Public landing page with embedded Google Form
│   └── admin/
│       └── index.html          # Dedicated Admin dashboard & multi-photo uploader
├── uploads/                    # Photograph storage directory (mounted to volume)
└── data/                       # SQLite database directory (mounted to volume)
```
