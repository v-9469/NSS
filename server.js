const fs = require('fs');
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'nss_bit_secure_jwt_secret_2026';
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Multer storage for multi-photo uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, unique);
  }
});

const fileFilter = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPEG, PNG, WebP, and GIF images are allowed'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15 MB per image
    files: 30 // up to 30 images per submission
  }
});

// Middleware
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(cookieParser());

// Lightweight Health Check Endpoint (for UptimeRobot / ping monitors)
app.get(['/health', '/ping'], (req, res) => {
  res.status(200).json({ status: 'ok', uptime: Math.floor(process.uptime()), timestamp: new Date().toISOString() });
});

// Serve Admin portal directly for /admin and /admin/
app.get(['/admin', '/admin/'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

// Static directories
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// Auth Verification Middleware
function requireAuth(req, res, next) {
  let token = req.cookies && req.cookies.nss_admin_token;
  if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.slice(7);
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session token' });
  }
}

// ==================== AUTH ROUTES ====================

// Admin Login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = db.getAdminByEmail(email);
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const isValid = bcrypt.compareSync(password, user.password_hash);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

  // Set HTTP-Only Cookie
  res.cookie('nss_admin_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });

  return res.json({ success: true, email: user.email, token });
});

// Admin Logout
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('nss_admin_token');
  return res.json({ success: true });
});

// Current Session Info
app.get('/api/auth/me', requireAuth, (req, res) => {
  return res.json({ authenticated: true, email: req.user.email });
});

// Change Admin Password
app.post('/api/auth/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  const user = db.getAdminByEmail(req.user.email);
  if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }

  const newHash = bcrypt.hashSync(newPassword, 10);
  db.updateAdminPassword(req.user.email, newHash);
  return res.json({ success: true, message: 'Password updated successfully' });
});

// ==================== PUBLIC GALLERY ROUTES ====================

// Fetch All Albums & Available Years
app.get('/api/gallery', (req, res) => {
  try {
    const year = req.query.year || 'All';
    const albums = db.getAllAlbums(year);
    const years = db.getAvailableYears();
    return res.json({ albums, years });
  } catch (err) {
    console.error('Error fetching gallery:', err);
    return res.status(500).json({ error: 'Failed to retrieve photo gallery' });
  }
});

// Fetch Single Album by ID
app.get('/api/gallery/:id', (req, res) => {
  try {
    const album = db.getAlbumById(req.params.id);
    if (!album) {
      return res.status(404).json({ error: 'Album not found' });
    }
    return res.json({ album });
  } catch (err) {
    console.error('Error fetching album:', err);
    return res.status(500).json({ error: 'Failed to retrieve album' });
  }
});

// ==================== ADMIN MANAGEMENT ROUTES ====================

// Create New Album with Multiple Photos
app.post('/api/admin/albums', requireAuth, upload.array('photos', 30), (req, res) => {
  try {
    const { title, description, eventDate } = req.body;
    if (!title || !description || !eventDate) {
      return res.status(400).json({ error: 'Title, description, and event date are required' });
    }

    const files = (req.files || []).map((file) => ({
      filePath: `/uploads/${file.filename}`,
      originalName: file.originalname,
      fileSize: file.size
    }));

    if (files.length === 0) {
      return res.status(400).json({ error: 'Please select at least one photograph' });
    }

    const newAlbum = db.createAlbum(title, description, eventDate, files);
    return res.status(201).json({ success: true, album: newAlbum });
  } catch (err) {
    console.error('Error creating album:', err);
    return res.status(500).json({ error: 'Failed to create album: ' + err.message });
  }
});

// Update Album Metadata (Title, Description, Event Date)
app.put('/api/admin/albums/:id', requireAuth, (req, res) => {
  try {
    const { title, description, eventDate } = req.body;
    if (!title || !description || !eventDate) {
      return res.status(400).json({ error: 'Title, description, and event date are required' });
    }

    const updated = db.updateAlbum(req.params.id, title, description, eventDate);
    if (!updated) {
      return res.status(404).json({ error: 'Album not found' });
    }
    return res.json({ success: true, album: updated });
  } catch (err) {
    console.error('Error updating album:', err);
    return res.status(500).json({ error: 'Failed to update album' });
  }
});

// Add Photos to an Existing Album
app.post('/api/admin/albums/:id/photos', requireAuth, upload.array('photos', 30), (req, res) => {
  try {
    const album = db.getAlbumById(req.params.id);
    if (!album) {
      return res.status(404).json({ error: 'Album not found' });
    }

    const files = (req.files || []).map((file) => ({
      filePath: `/uploads/${file.filename}`,
      originalName: file.originalname,
      fileSize: file.size
    }));

    if (files.length === 0) {
      return res.status(400).json({ error: 'No photo files uploaded' });
    }

    const updated = db.addPhotosToAlbum(req.params.id, files);
    return res.json({ success: true, album: updated });
  } catch (err) {
    console.error('Error adding photos to album:', err);
    return res.status(500).json({ error: 'Failed to add photos' });
  }
});

// Delete an Album and all its photos
app.delete('/api/admin/albums/:id', requireAuth, (req, res) => {
  try {
    const photoPaths = db.deleteAlbum(req.params.id);
    // Cleanup files on disk
    photoPaths.forEach((relPath) => {
      const filename = path.basename(relPath);
      const diskPath = path.join(UPLOAD_DIR, filename);
      if (fs.existsSync(diskPath)) {
        try {
          fs.unlinkSync(diskPath);
        } catch (e) {
          console.warn(`Could not delete file ${diskPath}:`, e.message);
        }
      }
    });
    return res.json({ success: true, message: 'Album deleted' });
  } catch (err) {
    console.error('Error deleting album:', err);
    return res.status(500).json({ error: 'Failed to delete album' });
  }
});

// Delete a Single Photo
app.delete('/api/admin/photos/:id', requireAuth, (req, res) => {
  try {
    const photo = db.deletePhoto(req.params.id);
    if (!photo) {
      return res.status(404).json({ error: 'Photo not found' });
    }
    const filename = path.basename(photo.file_path);
    const diskPath = path.join(UPLOAD_DIR, filename);
    if (fs.existsSync(diskPath)) {
      try {
        fs.unlinkSync(diskPath);
      } catch (e) {
        console.warn(`Could not delete file ${diskPath}:`, e.message);
      }
    }
    return res.json({ success: true, message: 'Photo deleted' });
  } catch (err) {
    console.error('Error deleting photo:', err);
    return res.status(500).json({ error: 'Failed to delete photo' });
  }
});

// Fallback Route for /admin and /admin/*
app.get(['/admin', '/admin/*'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

// Fallback Route for /
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  if (err) {
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
  next();
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[NSS BIT Server] Listening on http://localhost:${PORT}`);
  console.log(`[NSS BIT Server] Public site: http://localhost:${PORT}`);
  console.log(`[NSS BIT Server] Admin portal: http://localhost:${PORT}/admin`);
  console.log(`[NSS BIT Server] Health check: http://localhost:${PORT}/health`);

  // Optional automated keep-alive (useful for Render free tier sleep prevention)
  const pingUrl = process.env.RENDER_EXTERNAL_URL || process.env.PING_URL;
  if (pingUrl) {
    const PING_INTERVAL_MS = 14 * 60 * 1000; // 14 mins (Render sleeps at 15 mins)
    setInterval(() => {
      if (typeof fetch === 'function') {
        fetch(`${pingUrl}/health`)
          .then((r) => console.log(`[Keep-Alive] Pinged ${pingUrl}/health - Status: ${r.status}`))
          .catch((err) => console.warn(`[Keep-Alive] Ping failed:`, err.message));
      }
    }, PING_INTERVAL_MS);
    console.log(`[Keep-Alive] Scheduled self-ping for ${pingUrl}/health every 14 minutes`);
  }
});
