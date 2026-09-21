require('dotenv').config();
const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const farmerRoutes = require('./routes/farmers');
const inventoryRoutes = require('./routes/inventory');
const schemeRoutes = require('./routes/schemes');
const announcementRoutes = require('./routes/announcements');
const warehouseRoutes = require('./routes/warehouse');
const chatbotRoutes = require('./routes/chatbot');
const dashboardRoutes = require('./routes/dashboard');
const staffRoutes = require('./routes/staff');
const serviceRequestRoutes = require('./routes/serviceRequests');
const distributionRoutes = require('./routes/distributions');
const soilRoutes = require('./routes/soil');
const iotRoutes = require('./routes/iot');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/farmers', farmerRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/schemes', schemeRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/warehouse', warehouseRoutes);
app.use('/api/chatbot', chatbotRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/serviceRequests', serviceRequestRoutes);
app.use('/api/distributions', distributionRoutes);
app.use('/api/soil', soilRoutes);
app.use('/api/iot', iotRoutes);


// Root route
app.get('/', (req, res) => {
  res.json({
    name: 'Smart Cooperative Society Management System API',
    status: 'online',
    version: '1.0.0',
    message: 'Backend server is running successfully.',
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      farmers: '/api/farmers',
      inventory: '/api/inventory',
      schemes: '/api/schemes',
      announcements: '/api/announcements',
      warehouse: '/api/warehouse',
      chatbot: '/api/chatbot',
      dashboard: '/api/dashboard',
      staff: '/api/staff',
      serviceRequests: '/api/serviceRequests',
      distributions: '/api/distributions',
      soil: '/api/soil',
      iot: '/api/iot'
    }
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Cooperative Management API is running' });
});

// 404 handler for undefined routes
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.originalUrl}. Please check the API documentation for valid endpoints.`
  });
});

const PORT = process.env.PORT || 5000;

async function verifyDatabaseConnection() {
  const prisma = require('./config/database');
  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
    console.log('Database connection verified');
  } catch (error) {
    console.error('Database connection failed. Check DATABASE_URL in backend/.env');
    console.error(error.message);
  }
}

verifyDatabaseConnection();

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
