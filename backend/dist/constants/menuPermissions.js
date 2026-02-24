"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MENU_KEYS_LIST = exports.MENU_KEYS = void 0;
/** Chaves dos menus - usadas para controle de permissões por usuário */
exports.MENU_KEYS = [
    { key: "dashboard", label: "Dashboard" },
    { key: "whatsapp_connection", label: "Conexões WhatsApp" },
    { key: "whatsapp_groups", label: "Disparo em grupos" },
    { key: "groups", label: "Grupos" },
    { key: "products", label: "Produtos e Criativos" },
    { key: "templates", label: "Templates" },
    { key: "types", label: "Tipos" },
    { key: "campaigns", label: "Campanhas" },
    { key: "settings", label: "Configurações" },
    { key: "invoices", label: "Faturas" },
    { key: "admin_users", label: "Usuários (Admin)" },
];
exports.MENU_KEYS_LIST = exports.MENU_KEYS.map((m) => m.key);
