 

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const { GridFSBucket, ObjectId } = require("mongodb");

require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());


// ======================================================
// MongoDB
// ======================================================

console.log("Connecting to MongoDB...");

mongoose
  .connect(process.env.DB_CONNECTION_STRING, {
    serverSelectionTimeoutMS: 5000,
  })
  .then(() => {
    console.log("SUCCESS: Connected to MongoDB");
  })
  .catch((err) => {
    console.error("DATABASE ERROR:", err.message);
  });


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

    screenshot_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    screenshot_error: {
      type: String,
      default: null,
    },

    window: {
      left: Number,
      top: Number,
      width: Number,
      height: Number,
    },
  },
  {
    collection: "activity_logs",
  }
);

const Log = mongoose.model(
  "ActivityLog",
  logSchema
);


// ======================================================
// GET LOGS
// ======================================================

app.get("/api/logs", async (req, res) => {
  try {
    const data = await Log.find()
      .sort({ timestamp: -1 })
      .limit(100)
      .lean();

    res.json(data);

  } catch (err) {
    console.error("Error fetching logs:", err);

    res.status(500).json({
      error: "Failed to fetch activity logs",
    });
  }
});


// ======================================================
// GET SCREENSHOT
// ======================================================

app.get("/api/screenshots/:id", async (req, res) => {
  try {
    const screenshotId = req.params.id;

    if (!ObjectId.isValid(screenshotId)) {
      return res.status(400).json({
        error: "Invalid screenshot ID",
      });
    }

    const db = mongoose.connection.db;

    if (!db) {
      return res.status(503).json({
        error: "Database not ready",
      });
    }

    const bucket = new GridFSBucket(db, {
      bucketName: "fs",
    });

    const objectId = new ObjectId(screenshotId);

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

    res.set({
      "Content-Type":
        file.contentType ||
        file.metadata?.contentType ||
        "image/png",

      "Content-Length": file.length,

      "Cache-Control":
        "private, max-age=3600",
    });

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
// DELETE ACTIVITY + SCREENSHOT
// ======================================================

app.delete("/api/logs/:id", async (req, res) => {
  try {

    const logId = req.params.id;

    // --------------------------------------------------
    // Validate activity ID
    // --------------------------------------------------

    if (!ObjectId.isValid(logId)) {
      return res.status(400).json({
        error: "Invalid activity ID",
      });
    }


    // --------------------------------------------------
    // Find activity
    // --------------------------------------------------

    const activity = await Log.findById(logId);

    if (!activity) {
      return res.status(404).json({
        error: "Activity not found",
      });
    }


    // --------------------------------------------------
    // Delete screenshot from GridFS
    // --------------------------------------------------

    if (activity.screenshot_id) {

      const db = mongoose.connection.db;

      if (!db) {
        return res.status(503).json({
          error: "Database not ready",
        });
      }

      const bucket = new GridFSBucket(db, {
        bucketName: "fs",
      });

      try {

        await bucket.delete(
          new ObjectId(
            activity.screenshot_id
          )
        );

        console.log(
          "Screenshot deleted:",
          activity.screenshot_id.toString()
        );

      } catch (screenshotError) {

        // If the screenshot was already deleted,
        // continue deleting the activity record.

        console.warn(
          "Screenshot could not be deleted:",
          screenshotError.message
        );
      }
    }


    // --------------------------------------------------
    // Delete activity document
    // --------------------------------------------------

    await Log.deleteOne({
      _id: activity._id,
    });


    console.log(
      "Activity deleted:",
      activity._id.toString()
    );


    // --------------------------------------------------
    // Response
    // --------------------------------------------------

    res.json({
      success: true,
      deleted_id: activity._id,
    });


  } catch (err) {

    console.error(
      "Delete activity error:",
      err
    );

    res.status(500).json({
      error: "Failed to delete activity",
    });
  }
});


// ======================================================
// DELETE ACTIVITY + SCREENSHOT
// ======================================================

app.delete("/api/logs/:id", async (req, res) => {
  try {
    const logId = req.params.id;

    console.log("DELETE request received:", logId);

    if (!ObjectId.isValid(logId)) {
      return res.status(400).json({
        error: "Invalid activity ID",
      });
    }

    const activity = await Log.findById(logId);

    if (!activity) {
      return res.status(404).json({
        error: "Activity not found",
      });
    }

    console.log(
      "Found activity:",
      activity.window_title
    );

    // Delete GridFS screenshot
    if (activity.screenshot_id) {
      const db = mongoose.connection.db;
      const bucket = new GridFSBucket(db, {
        bucketName: "fs",
      });

      try {
        await bucket.delete(
          new ObjectId(activity.screenshot_id)
        );

        console.log(
          "Screenshot deleted:",
          activity.screenshot_id.toString()
        );
      } catch (err) {
        console.warn(
          "Screenshot deletion failed:",
          err.message
        );
      }
    }

    // Delete activity
    await Log.deleteOne({
      _id: activity._id,
    });

    console.log(
      "Activity deleted:",
      logId
    );

    return res.status(200).json({
      success: true,
      deleted_id: logId,
    });
  } catch (err) {
    console.error(
      "DELETE /api/logs/:id error:",
      err
    );

    return res.status(500).json({
      error: err.message || "Failed to delete activity",
    });
  }
});


// ======================================================
// HEALTH CHECK
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
// START SERVER
// ======================================================

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(
    `Server running on port ${PORT}`
  );
});
 
