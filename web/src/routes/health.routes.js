const express = require('express');
const database = require('../database/database');

const router = express.Router();

router.get('/live', (req, res) => {
  res.status(200).json({
    status: 'ok',
    application: 'up',
    timestamp: new Date().toISOString()
  });
});

router.get('/ready', async (req, res, next) => {
  try {
    await database.query('SELECT 1');

    res.status(200).json({
      status: 'ok',
      application: 'up',
      database: 'up',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    error.statusCode = 503;
    next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    await database.query('SELECT 1');

    res.status(200).json({
      status: 'ok',
      application: 'up',
      database: 'up',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    error.statusCode = 503;
    next(error);
  }
});

module.exports = router;