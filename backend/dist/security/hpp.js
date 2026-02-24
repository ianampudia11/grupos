"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hppMiddleware = hppMiddleware;
function hppMiddleware(req, _res, next) {
    if (req.query && typeof req.query === "object") {
        for (const key of Object.keys(req.query)) {
            const val = req.query[key];
            if (Array.isArray(val)) {
                req.query[key] = val[val.length - 1]; // usa último valor
            }
        }
    }
    next();
}
