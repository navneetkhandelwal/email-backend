// server.js
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/database');
const emailRoutes = require('./routes/emailRoutes');
const templateRoutes = require('./routes/templateRoutes');
const auditRoutes = require('./routes/auditRoutes');
const userProfileRoutes = require('./routes/userProfileRoutes');

const app = express();
const port = process.env.PORT || 5001;

// Connect to MongoDB
connectDB();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api', emailRoutes);
app.use('/api', templateRoutes);
app.use('/api', auditRoutes);
app.use('/api', userProfileRoutes);

// Start server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
