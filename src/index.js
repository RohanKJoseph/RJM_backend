const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const { GridFSBucket, ObjectId } = require("mongodb");

require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());


// ======================================================
// MongoDB Connection
// ======================================================

console.log("Connecting to MongoDB...");

const dbConnectionPromise = mongoose
  .connect(process.env.DB_CONNECTION_STRING, {
    serverSelectionTimeoutMS: 5000,
  })
  .then(() => {
    console.log("✅ SUCCESS: Connected to MongoDB");
  })
  .catch((err) => {
    console.error("❌ DATABASE ERROR:", err.message);
    throw err;
  });


async function getDatabase() {
  if (mongoose.connection.readyState === 1 && mongoose.connection.db) {
    return mongoose.connection.db;
  }

  try {
    await dbConnectionPromise;
  } catch {
    // Fall through to the explicit readiness check below.
  }

  if (!mongoose.connection.db) {
    throw new Error("Database not ready");
  }

  return mongoose.connection.db;
}


// ======================================================
// Activity Log Schema
// ======================================================

const logSchema = new mongoose.Schema(
  {
    window_title: {
      type: String,
      default: "Unknown Window",
    },

    timestamp: {
      type: Date,
      required: true,
    },

    is_incognito: {
      type: Boolean,
      default: false,
    },

    // GridFS screenshot ObjectId
    screenshot_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    screenshot_error: {
      type: String,
      default: null,
    },

    // Information saved by the Python monitor
    window: {
      left: Number,
      top: Number,
      width: Number,
      height: Number,
    },
  },
  {
    // IMPORTANT:
    // Python uses db.activity_logs
    collection: "activity_logs",
  }
);


const Log = mongoose.model("ActivityLog", logSchema);


// ======================================================
// GET Activity Logs
// ======================================================

app.get("/api/logs", async (req, res) => {

  try {

    const db = await getDatabase();

    const data = await db
      .collection("activity_logs")
      .find({})
      .sort({ timestamp: -1 })
      .limit(50)
      .toArray();

    res.json(data);

  } catch (err) {

    console.error("Error fetching logs:", err);

    const statusCode = err.message === "Database not ready" ? 503 : 500;

    res.status(statusCode).json({
      error: "Failed to fetch activity logs",
    });

  }

});


// ======================================================
// GET Screenshot from MongoDB GridFS
//
// Frontend:
// /api/screenshots/<screenshot_id>
// ======================================================

app.get("/api/screenshots/:id", async (req, res) => {

  try {

    const screenshotId = req.params.id;


    // --------------------------------------------------
    // Validate MongoDB ObjectId
    // --------------------------------------------------

    if (!ObjectId.isValid(screenshotId)) {

      return res.status(400).json({
        error: "Invalid screenshot ID",
      });

    }


    // --------------------------------------------------
    // Get native MongoDB database connection
    // --------------------------------------------------

    const db = mongoose.connection.db;


    if (!db) {

      return res.status(503).json({
        error: "Database not ready",
      });

    }


    // --------------------------------------------------
    // GridFS bucket
    //
    // Python:
    // fs = gridfs.GridFS(db)
    //
    // creates:
    //
    // fs.files
    // fs.chunks
    //
    // Therefore bucketName MUST be "fs"
    // --------------------------------------------------

    const bucket = new GridFSBucket(db, {
      bucketName: "fs",
    });


    const objectId = new ObjectId(screenshotId);


    // --------------------------------------------------
    // Check screenshot exists
    // --------------------------------------------------

    const files = await db
      .collection("fs.files")
      .find({
        _id: objectId,
      })
      .limit(1)
      .toArray();


    if (files.length === 0) {

      return res.status(404).json({
        error: "Screenshot not found",
      });

    }


    const file = files[0];


    // --------------------------------------------------
    // Response headers
    // --------------------------------------------------

    res.set({
      "Content-Type":
        file.contentType ||
        file.metadata?.contentType ||
        "image/png",

      "Content-Length": file.length,

      "Cache-Control": "private, max-age=3600",
    });


    // --------------------------------------------------
    // Stream screenshot directly from MongoDB
    // --------------------------------------------------

    const downloadStream =
      bucket.openDownloadStream(objectId);


    downloadStream.on("error", (err) => {

      console.error(
        "GridFS download error:",
        err
      );


      if (!res.headersSent) {

        res.status(500).json({
          error: "Failed to load screenshot",
        });

      } else {

        res.end();

      }

    });


    // Send screenshot to React
    downloadStream.pipe(res);


  } catch (err) {

    console.error(
      "Screenshot endpoint error:",
      err
    );


    if (!res.headersSent) {

      res.status(500).json({
        error: "Failed to retrieve screenshot",
      });

    }

  }

});


// ======================================================
// Health Check
// ======================================================

app.get("/api/health", (req, res) => {

  res.json({
    status: "ok",
    database:
      mongoose.connection.readyState === 1
        ? "connected"
        : "disconnected",
  });

});


// ======================================================
// Start Server
// ======================================================

const PORT = process.env.PORT || 5000;


app.listen(PORT, () => {

  console.log(
    `🚀 Server running on port ${PORT}`
  );

});
 
