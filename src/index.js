// server.js
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();
 

const app = express();
app.use(cors());
app.use(express.json());

 
console.log("DB STRING:", process.env.DB_CONNECTION_STRING);
console.log("Connecting to MongoDB...");

mongoose.connect(process.env.DB_CONNECTION_STRING, {
    serverSelectionTimeoutMS: 5000 // If it can't connect in 5 seconds, throw an error
})
.then(() => console.log("✅ SUCCESS: Connected to MongoDB"))
.catch(err => console.error("❌ DATABASE ERROR:", err.message));

const logSchema = new mongoose.Schema({
    window_title: String,
    timestamp: Date,
    is_incognito: Boolean
});

const Log = mongoose.model('Log', logSchema);

// Endpoint for your phone to fetch data
app.get('/api/logs', async (req, res) => {
    try {
        const data = await Log.find().sort({ timestamp: -1 }).limit(50);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(5000, () => console.log("Server running on port 5000"));