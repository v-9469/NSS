const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

// Support both built-in node:sqlite (Node 22+) and better-sqlite3
let db;
try {
  const { DatabaseSync } = require('node:sqlite');
  const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const dbPath = process.env.DATABASE_PATH || path.join(dataDir, 'nss.db');
  db = new DatabaseSync(dbPath);
} catch (err) {
  const Database = require('better-sqlite3');
  const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const dbPath = process.env.DATABASE_PATH || path.join(dataDir, 'nss.db');
  db = new Database(dbPath);
}

// Enable foreign keys
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA journal_mode = WAL;');

// Initialize Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS albums (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    event_date TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    original_name TEXT,
    file_size INTEGER,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Database Helper Functions
const dbHelpers = {
  db,

  // Get Admin by Email
  getAdminByEmail(email) {
    const stmt = db.prepare('SELECT * FROM admin_users WHERE email = ?');
    return stmt.get(email.toLowerCase().trim());
  },

  // Update Admin Password
  updateAdminPassword(email, newPasswordHash) {
    const stmt = db.prepare('UPDATE admin_users SET password_hash = ? WHERE email = ?');
    return stmt.run(newPasswordHash, email.toLowerCase().trim());
  },

  // Get All Albums with their photos, optionally filtered by year
  getAllAlbums(year) {
    let albumQuery = 'SELECT * FROM albums ORDER BY event_date DESC, id DESC';
    let albums;
    if (year && year !== 'All') {
      albumQuery = "SELECT * FROM albums WHERE substr(event_date, 1, 4) = ? ORDER BY event_date DESC, id DESC";
      albums = db.prepare(albumQuery).all(String(year));
    } else {
      albums = db.prepare(albumQuery).all();
    }

    const photoStmt = db.prepare('SELECT * FROM photos WHERE album_id = ? ORDER BY sort_order ASC, id ASC');
    return albums.map((album) => {
      const photos = photoStmt.all(album.id);
      return {
        ...album,
        year: album.event_date ? String(album.event_date).slice(0, 4) : '',
        photos: photos.map((p) => ({
          id: p.id,
          albumId: p.album_id,
          filePath: p.file_path,
          originalName: p.original_name,
          fileSize: p.file_size
        }))
      };
    });
  },

  // Get Available Years
  getAvailableYears() {
    const rows = db.prepare("SELECT DISTINCT substr(event_date, 1, 4) as year FROM albums WHERE event_date IS NOT NULL AND length(event_date) >= 4 ORDER BY year DESC").all();
    return rows.map((r) => String(r.year)).filter(Boolean);
  },

  // Get Single Album by ID
  getAlbumById(id) {
    const album = db.prepare('SELECT * FROM albums WHERE id = ?').get(id);
    if (!album) return null;
    const photos = db.prepare('SELECT * FROM photos WHERE album_id = ? ORDER BY sort_order ASC, id ASC').all(id);
    return {
      ...album,
      year: album.event_date ? String(album.event_date).slice(0, 4) : '',
      photos: photos.map((p) => ({
        id: p.id,
        albumId: p.album_id,
        filePath: p.file_path,
        originalName: p.original_name,
        fileSize: p.file_size
      }))
    };
  },

  // Create Album with multiple photos in a transaction
  createAlbum(title, description, eventDate, files = []) {
    const insertAlbum = db.prepare(`
      INSERT INTO albums (title, description, event_date, created_at, updated_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
    `);
    const res = insertAlbum.run(title.trim(), description.trim(), eventDate);
    const albumId = Number(res.lastInsertRowid);

    if (files && files.length > 0) {
      const insertPhoto = db.prepare(`
        INSERT INTO photos (album_id, file_path, original_name, file_size, sort_order)
        VALUES (?, ?, ?, ?, ?)
      `);
      files.forEach((file, index) => {
        insertPhoto.run(albumId, file.filePath, file.originalName || '', file.fileSize || 0, index);
      });
    }

    return this.getAlbumById(albumId);
  },

  // Update Album Details
  updateAlbum(id, title, description, eventDate) {
    const stmt = db.prepare(`
      UPDATE albums
      SET title = ?, description = ?, event_date = ?, updated_at = datetime('now')
      WHERE id = ?
    `);
    stmt.run(title.trim(), description.trim(), eventDate, id);
    return this.getAlbumById(id);
  },

  // Add Photos to an existing album
  addPhotosToAlbum(albumId, files = []) {
    if (!files || files.length === 0) return;
    const currentMax = db.prepare('SELECT MAX(sort_order) as maxOrder FROM photos WHERE album_id = ?').get(albumId);
    let startOrder = (currentMax && currentMax.maxOrder != null) ? currentMax.maxOrder + 1 : 0;

    const insertPhoto = db.prepare(`
      INSERT INTO photos (album_id, file_path, original_name, file_size, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `);
    files.forEach((file, index) => {
      insertPhoto.run(albumId, file.filePath, file.originalName || '', file.fileSize || 0, startOrder + index);
    });
    return this.getAlbumById(albumId);
  },

  // Delete an entire album and return photo file paths for disk cleanup
  deleteAlbum(id) {
    const photos = db.prepare('SELECT file_path FROM photos WHERE album_id = ?').all(id);
    db.prepare('DELETE FROM albums WHERE id = ?').run(id);
    return photos.map((p) => p.file_path);
  },

  // Delete a single photo
  deletePhoto(photoId) {
    const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(photoId);
    if (!photo) return null;
    db.prepare('DELETE FROM photos WHERE id = ?').run(photoId);
    return photo;
  }
};

// Seed Default Admin User if table is empty
function seedAdmin() {
  const check = db.prepare('SELECT COUNT(*) as count FROM admin_users').get();
  if (!check || check.count === 0) {
    const defaultEmail = process.env.INITIAL_ADMIN_EMAIL || 'sushilkumarv@bit-bangalore.edu.in';
    const defaultPassword = process.env.INITIAL_ADMIN_PASSWORD || 'NSS@2026';
    const hash = bcrypt.hashSync(defaultPassword, 10);
    const insert = db.prepare('INSERT INTO admin_users (email, password_hash) VALUES (?, ?)');
    insert.run(defaultEmail.toLowerCase(), hash);
    console.log(`[DB] Initial admin account seeded: ${defaultEmail}`);
  }
}
seedAdmin();

// Seed Default Albums if table is empty
function seedAlbums() {
  const check = db.prepare('SELECT COUNT(*) as count FROM albums').get();
  if (!check || check.count === 0) {
    const seeds = [
      {
        title: 'Campus Tree Plantation Drive',
        description: 'NSS volunteers planting native saplings across the BIT Bengaluru campus grounds as part of the annual sustainability initiative.',
        eventDate: '2026-08-15',
        photos: [{ filePath: '/uploads/seed-1.jpeg', originalName: 'tree-plantation.jpg', fileSize: 195852 }]
      },
      {
        title: 'Voluntary Blood Donation & Health Camp',
        description: 'Student coordinators and volunteers managing donor registration and health awareness desks during the college blood donation camp.',
        eventDate: '2026-09-24',
        photos: [{ filePath: '/uploads/seed-2.jpeg', originalName: 'blood-donation.jpg', fileSize: 123036 }]
      },
      {
        title: 'VV Puram Cleanliness & Conservation Drive',
        description: 'Volunteers conducting a morning street cleanliness and urban greening drive in the neighbourhood surrounding VV Puram.',
        eventDate: '2025-10-02',
        photos: [{ filePath: '/uploads/seed-3.jpeg', originalName: 'vv-puram-drive.jpg', fileSize: 217128 }]
      }
    ];

    seeds.forEach((s) => {
      dbHelpers.createAlbum(s.title, s.description, s.eventDate, s.photos);
    });
    console.log('[DB] Initial seed gallery albums added to SQLite');
  }
}
seedAlbums();

module.exports = dbHelpers;
