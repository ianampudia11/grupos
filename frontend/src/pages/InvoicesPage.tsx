import { useEffect, useState } from "react";
import { api } from "../api";
import { useToast } from "../toast/ToastContext";
import { useAuth } from "../auth/AuthContext";
import { PageContainer } from "../components/PageContainer";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import ContentCopy from "@mui/icons-material/ContentCopy";
import TextField from "@mui/material/TextField";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import TrendingUp from "@mui/icons-material/TrendingUp";

type Invoice = {
  id: string;
  amount: number;
  status: string;
  dueDate: string;
  paidAt?: string | null;
  subscription?: { plan: { name: string } } | null;
};

type Plan = { id: string; name: string; slug: string; price: number };

type PayModalData = {
  invoice: Invoice;
  qrCode: string;
  qrCodeBase64: string;
  expirationMinutes: number;
  amount: number;
};

export default function InvoicesPage() {
  const toast = useToast();
  const { me, refreshMe } = useAuth();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [payModal, setPayModal] = useState<PayModalData | null>(null);
  const [upgradeModal, setUpgradeModal] = useState(false);
  const [upgradePlans, setUpgradePlans] = useState<Plan[]>([]);
  const [upgradePlanId, setUpgradePlanId] = useState("");
  const [upgrading, setUpgrading] = useState(false);
  const isRestricted = me?.subscription?.isTrialExpired && !me?.subscription?.hasActivePaidAccess;

  async function load() {
    setLoading(true);
    try {
      const res = await api.get<Invoice[]>("/invoices");
      setInvoices(res.data);
      await refreshMe({ silent: true }); // actualiza suscripción sin parpadear el diseño
    } catch (e: any) {
      toast.push({ type: "danger", title: "Facturas", message: e?.response?.data?.message ?? "Error al cargar." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handlePay(invoice: Invoice) {
    if (invoice.status !== "pending") return;
    try {
      const res = await api.post<Record<string, unknown>>(`/invoices/${invoice.id}/pay`);
      const data = (res.data ?? {}) as Record<string, unknown>;
      const qrCode = String(data.qrCode ?? data.qr_code ?? "").trim();
      const qrCodeBase64 = String(data.qrCodeBase64 ?? data.qr_code_base64 ?? "").trim();

      if (qrCode && qrCodeBase64) {
        setPayModal({
          invoice,
          qrCode,
          qrCodeBase64: qrCodeBase64.startsWith("data:") ? qrCodeBase64 : `data:image/png;base64,${qrCodeBase64}`,
          expirationMinutes: Number(data.expirationMinutes ?? data.expiration_minutes ?? 30),
          amount: Number(data.amount ?? invoice.amount),
        });
      } else {
        toast.push({
          type: "danger",
          title: "Pago PIX",
          message: String(data.message ?? "QR PIX no retornado. Ejecute Actualizar en el instalador y verifique las llaves PIX en Mercado Pago."),
        });
      }
    } catch (e: any) {
      toast.push({ type: "danger", title: "Pago", message: e?.response?.data?.message ?? "Error al generar PIX." });
    }
  }

  function handleCopyPix() {
    if (!payModal) return;
    navigator.clipboard.writeText(payModal.qrCode);
    toast.push({ type: "success", title: "PIX copiado", message: "Pegue en la app de su banco para pagar." });
  }

  async function openUpgradeModal() {
    setUpgradeModal(true);
    try {
      const res = await api.get<Plan[]>("/invoices/plans/upgrade");
      setUpgradePlans(res.data);
      if (res.data.length > 0) setUpgradePlanId(res.data[0].id);
    } catch {
      setUpgradePlans([]);
    }
  }

  async function handleUpgrade() {
    if (!upgradePlanId) return;
    setUpgrading(true);
    try {
      await api.post("/invoices/upgrade", { planId: upgradePlanId });
      toast.push({ type: "success", title: "Actualización", message: "Factura creada. Pague hasta el final del día para activar el nuevo plan." });
      setUpgradeModal(false);
      void load();
    } catch (e: any) {
      toast.push({ type: "danger", title: "Actualización", message: e?.response?.data?.message ?? "Error al solicitar la actualización." });
    } finally {
      setUpgrading(false);
    }
  }

  const statusColor: Record<string, "default" | "success" | "warning" | "error"> = {
    pending: "warning",
    paid: "success",
    overdue: "error",
    cancelled: "default",
  };

  return (
    <PageContainer
      title="Facturas"
      subtitle="Sus facturas mensuales. Pague vía PIX."
      actions={
        <>
          <Button variant="outlined" startIcon={<TrendingUp />} onClick={openUpgradeModal}>
            Actualizar plan
          </Button>
        </>
      }
    >
      {isRestricted && (
        <Paper sx={{ p: 2, mb: 2, bgcolor: "warning.light", border: "1px solid", borderColor: "warning.main" }}>
          <Typography>
            Su período de prueba ha expirado. Pague su factura para continuar utilizando el panel.
          </Typography>
        </Paper>
      )}
      <Paper sx={{ overflow: "hidden" }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Factura</TableCell>
                <TableCell>Plan</TableCell>
                <TableCell>Valor</TableCell>
                <TableCell>Vencimiento</TableCell>
                <TableCell>Estado</TableCell>
                <TableCell align="right">Acción</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell>#{inv.id.slice(-8).toUpperCase()}</TableCell>
                  <TableCell>{inv.subscription?.plan?.name ?? "—"}</TableCell>
                  <TableCell>S/. {inv.amount.toFixed(2)}</TableCell>
                  <TableCell>{new Date(inv.dueDate).toLocaleDateString("es-ES")}</TableCell>
                  <TableCell>
                    <Chip label={inv.status} size="small" color={statusColor[inv.status] ?? "default"} />
                  </TableCell>
                  <TableCell align="right">
                    {inv.status === "pending" && (
                      <Button size="small" variant="contained" color="primary" onClick={() => handlePay(inv)}>
                        Pagar
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!invoices.length && !loading && (
                <TableRow>
                  <TableCell colSpan={6} sx={{ py: 4, textAlign: "center", color: "text.secondary" }}>
                    Ninguna factura. Las facturas se generan automáticamente cada mes.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog
        open={!!payModal}
        onClose={() => {
          setPayModal(null);
          void load();
        }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Pago vía PIX</DialogTitle>
        <DialogContent sx={{ textAlign: "center", pt: 1 }}>
          {payModal && (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Escanee el código QR o use el código de copiar y pegar en la aplicación de su banco. Al completar el pago, la factura se registrará automáticamente.
              </Typography>
              <Typography variant="h6" color="primary" sx={{ mb: 1 }}>
                S/. {payModal.amount.toFixed(2)}
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
                Expira en {payModal.expirationMinutes} min
              </Typography>
              <Box sx={{ display: "flex", justifyContent: "center", py: 2, bgcolor: "grey.50", borderRadius: 1, mb: 2 }}>
                <img src={payModal.qrCodeBase64} alt="QR PIX" style={{ width: 200, height: 200 }} />
              </Box>
              <TextField
                fullWidth
                label="Código PIX (copia y pega)"
                value={payModal.qrCode}
                multiline
                maxRows={4}
                InputProps={{ readOnly: true }}
                onClick={(e) => (e.target as HTMLInputElement).select()}
                sx={{ mb: 1 }}
              />
              <Button variant="outlined" startIcon={<ContentCopy />} onClick={handleCopyPix} fullWidth>
                Copiar código PIX
              </Button>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setPayModal(null);
              void load();
            }}
          >
            Cerrar
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={upgradeModal} onClose={() => !upgrading && setUpgradeModal(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Actualizar plan</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Elija el nuevo plan. La factura se generará con vencimiento para hoy. Pague vía PIX el mismo día para activar.
          </Typography>
          {upgradePlans.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Ningún plan disponible para actualización en este momento.
            </Typography>
          ) : (
            <FormControl fullWidth sx={{ mt: 1 }}>
              <InputLabel>Plan</InputLabel>
              <Select
                value={upgradePlanId}
                label="Plan"
                onChange={(e) => setUpgradePlanId(e.target.value)}
              >
                {upgradePlans.map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    {p.name} — S/. {p.price.toFixed(2)}/mes
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUpgradeModal(false)} disabled={upgrading}>Cancelar</Button>
          <Button variant="contained" onClick={handleUpgrade} disabled={upgrading || !upgradePlanId || upgradePlans.length === 0}>
            {upgrading ? "Generando..." : "Solicitar actualización"}
          </Button>
        </DialogActions>
      </Dialog>
    </PageContainer>
  );
}
