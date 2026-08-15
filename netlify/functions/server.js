'use strict';

const serverless = require('serverless-http');
const app = require('../../server');
const db  = require('../../database');

const serverlessHandler = serverless(app);

module.exports.handler = async (event, context) => {
  try {
    await db.init();
  } catch (err) {
    console.error('Serverless DB init error:', err.message);
  }
  return serverlessHandler(event, context);
};
