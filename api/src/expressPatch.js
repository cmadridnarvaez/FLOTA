// C1: Patch Express 4 para capturar async errors en handlers.
import express from 'express';

const _wrap = (fn) => async (req, res, next) => {
  try { await fn(req, res, next); }
  catch (e) { next(e); }
};
const _isAsync = (fn) => typeof fn === 'function' && fn.constructor && fn.constructor.name === 'AsyncFunction';
const _methods = ['get', 'post', 'put', 'delete', 'patch'];
for (const method of _methods) {
  const orig = express.Router.prototype[method];
  express.Router.prototype[method] = function (...args) {
    const wrapped = args.map((a) => _isAsync(a) ? _wrap(a) : a);
    return orig.apply(this, wrapped);
  };
}

export default express;

