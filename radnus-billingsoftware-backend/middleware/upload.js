const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");

// Cloudinary storage setup
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "jobsheet-idproof", 
    allowed_formats: ["jpg", "jpeg", "png"],
  },
});

// File filter (optional safety)
const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png/;

  const ext = allowedTypes.test(
    file.originalname.toLowerCase()
  );

  const mime = allowedTypes.test(file.mimetype);

  if (ext && mime) {
    cb(null, true);
  } else {
    cb(new Error("Only JPG/PNG images allowed"));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
});

module.exports = upload;