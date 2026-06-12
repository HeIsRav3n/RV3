'use strict';

const crypto = require('crypto');
const config = require('../config');

function requireKey() {
  if (!config.hasWalletEncryption) {
    throw new Error('WALLET_ENCRYPTION_KEY not set (need 64-char hex in .env)');
  }
  return Buffer.from(config.walletEncryptionKey, 'hex');
}

function encrypt(text) {
  const key = requireKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decrypt(payload) {
  const key = requireKey();
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function addressFromKey(privateKey) {
  const { ethers } = require('ethers');
  try {
    return new ethers.Wallet(privateKey).address;
  } catch {
    return null;
  }
}

module.exports = { encrypt, decrypt, addressFromKey };
