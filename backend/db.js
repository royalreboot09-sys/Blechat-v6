/**
 * MongoDB Connection Handler via Mongoose
 * Uses process.env.MONGO_URI for production on Render
 */

const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        const mongoURI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/blechat';
        const conn = await mongoose.connect(mongoURI);
        console.log(`[DATABASE] MongoDB Connected: ${conn.connection.host}`);
        return conn;
    } catch (error) {
        console.error(`[DATABASE ERROR] MongoDB Connection Failed: ${error.message}`);
        process.exit(1);
    }
};

module.exports = connectDB;
