'use strict';

// API routes are session-cookie authenticated by authRequired. Do not accept
// headers carrying reusable bearer secrets from a browser or URL-adjacent flow.
function auth(req, res, next) {
  if (!req.session) return res.status(401).json({ error: 'Unauthorized — sign in with a valid session.' });
  next();
}

module.exports = auth;
