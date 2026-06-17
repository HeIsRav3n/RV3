'use strict';

const config = require('../config');

function auth(req, res, next) {
  if (!config.apiSecret) return next();
  // Skip token check if user is already session-authenticated via X-Auth-Token
  if (req.session) return next();
  const token = req.headers['x-rv3-token'] || req.query.token;
  if (token !== config.apiSecret) {
    return res.status(401).json({ error: 'Unauthorized — set X-RV3-Token header to API_SECRET from .env' });
  }
  next();
}

module.exports = auth;
