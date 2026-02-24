"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const dashboardService_1 = require("../services/dashboardService");
const router = (0, express_1.Router)();
router.use(auth_1.authMiddleware);
router.get("/", async (req, res) => {
    try {
        const userId = req.userId;
        const data = await (0, dashboardService_1.getDashboardData)(userId);
        res.json(data);
    }
    catch (err) {
        res.status(400).json({ message: err.message || "Erro ao carregar dashboard" });
    }
});
exports.default = router;
