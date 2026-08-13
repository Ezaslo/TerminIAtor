const test = require('node:test');
const assert = require('node:assert/strict');

const validation = require('../src/middleware/validation.middleware');

function createResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function createNext() {
  const next = () => { next.called = true; };
  next.called = false;
  return next;
}

test('validateLogin normalizes a valid email', () => {
  const req = { body: { email: '  TEST@Example.COM  ', password: 'valid-password' } };
  const res = createResponse();
  const next = createNext();

  validation.validateLogin(req, res, next);

  assert.equal(next.called, true);
  assert.equal(res.statusCode, null);
  assert.equal(req.body.email, 'test@example.com');
});
