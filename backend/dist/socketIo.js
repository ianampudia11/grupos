"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setSocketIo = setSocketIo;
exports.getSocketIo = getSocketIo;
exports.emitInvoicePaid = emitInvoicePaid;
let ioInstance = null;
function setSocketIo(io) {
    ioInstance = io;
}
function getSocketIo() {
    return ioInstance;
}
function emitInvoicePaid(companyId, payload) {
    if (ioInstance) {
        ioInstance.to(`company:${companyId}`).emit("invoice:paid", payload);
    }
}
