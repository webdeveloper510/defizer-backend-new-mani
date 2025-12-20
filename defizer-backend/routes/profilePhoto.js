// routes/profilePhoto.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticate } = require('../middleware/authenticate');
const db = require('./db');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', 'uploads', 'profile_photos');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log("[profilePhoto] Created uploads directory:", uploadDir);
} else {
  console.log("[profilePhoto] Using uploads directory:", uploadDir);
}

// Multer setup: temp file, will rename after
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    console.log("[profilePhoto] Multer destination called.");
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const tempName = `temp_${Date.now()}${ext}`;
    console.log("[profilePhoto] Multer filename called:", tempName);
    cb(null, tempName);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    console.log("[profilePhoto] Multer fileFilter:", file.mimetype);
    if (!file.mimetype.match(/^image\/(jpeg|png|webp|gif)$/)) {
      console.error("[profilePhoto] Multer file rejected, bad mimetype:", file.mimetype);
      return cb(new Error('Only image files allowed'), false);
    }
    cb(null, true);
  }
});

// Workaround: preserve JWT user for multer/Express
function authFirst(req, res, next) {
  console.log("[profilePhoto] Entering authFirst middleware");
  authenticate(req, res, function(err) {
    if (err) {
      console.error("[profilePhoto] Authenticate error:", err);
      return; // authenticate will send the error response
    }
    console.log("[profilePhoto] User authenticated, id:", req.user && req.user.id);
    res.locals.user = req.user;
    next();
  });
}

router.post('/', authFirst, upload.single('profile_photo'), async function(req, res) {
  // Restore user after multer
  req.user = req.user || res.locals.user;
  console.log("[profilePhoto] POST / called. req.user:", req.user);

  try {
    if (!req.file) {
      console.error("[profilePhoto] No file uploaded");
      return res.status(400).json({ error: 'No file uploaded' });
    }
    console.log("[profilePhoto] File uploaded:", req.file);

    const ext = path.extname(req.file.originalname);
    const finalName = `${req.user.id}_${Date.now()}${ext}`;
    const finalPath = path.join(uploadDir, finalName);

    console.log("[profilePhoto] Renaming temp file to:", finalPath);
    fs.rename(req.file.path, finalPath, (renameErr) => {
      if (renameErr) {
        console.error("[profilePhoto] Failed to rename file:", renameErr);
        return res.status(500).json({ error: 'Failed to process photo' });
      }
      const photoUrl = `/uploads/profile_photos/${finalName}`;
      console.log("[profilePhoto] File renamed, photoUrl:", photoUrl);

      // Remove old photo file for user
      console.log("[profilePhoto] Checking for old photo for user id:", req.user.id);
      db.query('SELECT profile_photo FROM users WHERE id = ?', [req.user.id], (err, results) => {
        if (err) {
          console.error("[profilePhoto] DB error (fetch old photo):", err);
        }
        if (results && results[0] && results[0].profile_photo) {
          const oldPath = path.join(uploadDir, path.basename(results[0].profile_photo));
          if (fs.existsSync(oldPath) && oldPath !== finalPath) {
            try {
              fs.unlinkSync(oldPath);
              console.log("[profilePhoto] Deleted old photo:", oldPath);
            } catch (unlinkErr) {
              console.error("[profilePhoto] Failed to delete old photo:", unlinkErr);
            }
          } else {
            console.log("[profilePhoto] No old photo to delete or already same as new.");
          }
        } else {
          console.log("[profilePhoto] No previous photo found in DB for user.");
        }
        // Update photo in DB
        console.log("[profilePhoto] Updating photo URL in DB for user id:", req.user.id);
        db.query('UPDATE users SET profile_photo = ? WHERE id = ?', [photoUrl, req.user.id], (err) => {
          if (err) {
            console.error("[profilePhoto] DB error (update photo):", err);
            return res.status(500).json({ error: 'Database error' });
          }
          console.log("[profilePhoto] Profile photo updated in DB for user id:", req.user.id);
          res.json({ success: true, profile_photo_url: photoUrl, url: photoUrl });
        });
      });
    });
  } catch (err) {
    console.error('[profilePhoto] Caught error in catch:', err);
    res.status(500).json({ error: 'Unexpected server error' });
  }
});

module.exports = router;
