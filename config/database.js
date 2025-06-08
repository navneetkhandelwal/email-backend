const mongoose = require('mongoose');

const MONGODB_URI = 'mongodb+srv://emailAdmin:emailPassword@cluster0.9ar1b.mongodb.net/email_script_db?retryWrites=true&w=majority&appName=Cluster0';

const connectDB = async () => {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("Connected to DB:", mongoose.connection.name);
  } catch (err) {
    console.error("DB Connection Error:", err);
    process.exit(1);
  }
};

module.exports = connectDB; 