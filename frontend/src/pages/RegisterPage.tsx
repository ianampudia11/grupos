import { FormEvent, useEffect, useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import Link from "@mui/material/Link";
import { api } from "../api";
import { useToast } from "../toast/ToastContext";
import { useBranding } from "../branding/BrandingContext";
import { useTheme } from "../theme/ThemeContext";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import LightModeOutlined from "@mui/icons-material/LightModeOutlined";
import DarkModeOutlined from "@mui/icons-material/DarkModeOutlined";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import { useRecaptchaConfig, getRecaptchaTokenV3, getRecaptchaTokenV2, useRecaptchaV2Widget } from "../recaptcha/useRecaptcha";

type Plan = { id: string; name: string; slug: string; price: number; limits: Record<string, number> };

export default function RegisterPage() {
  const branding = useBranding();
  const { mode, toggleMode } = useTheme();
  const effectiveLogo = mode === "dark" && branding.logoDarkUrl ? branding.logoDarkUrl : branding.logoUrl;
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planId, setPlanId] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const toast = useToast();
  const { config: recaptchaConfig } = useRecaptchaConfig();
  const recaptchaEnabled = !!recaptchaConfig?.enabled && !!recaptchaConfig?.siteKey && (recaptchaConfig?.version === "v2" || recaptchaConfig?.version === "v3");
  useRecaptchaV2Widget("recaptcha-register-container", recaptchaConfig?.siteKey ?? "", recaptchaEnabled && recaptchaConfig?.version === "v2");

  useEffect(() => {
    api.get<Plan[]>("/plans/public").then((r) => {
      setPlans(r.data);
      if (r.data.length > 0 && !planId) setPlanId(r.data[0].id);
    }).catch(() => setPlans([]));
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!companyName.trim()) {
      setError("El nombre de la empresa es obligatorio");
      return;
    }
    if (!planId || plans.length === 0) {
      setError(plans.length === 0 ? "Ningún plan disponible. Contacte al administrador." : "Seleccione un plan");
      return;
    }
    let recaptchaToken: string | null = null;
    if (recaptchaEnabled && recaptchaConfig?.siteKey) {
      if (recaptchaConfig.version === "v3") {
        recaptchaToken = await getRecaptchaTokenV3(recaptchaConfig.siteKey, "register");
      } else {
        recaptchaToken = getRecaptchaTokenV2();
      }
      if (!recaptchaToken) {
        setError(recaptchaConfig.version === "v2" ? "Marque la verificación \"No soy un robot\"." : "La verificación de seguridad falló. Intente nuevamente.");
        return;
      }
    }
    setLoading(true);
    setError(null);
    try {
      const payload: {
        email: string;
        password: string;
        name?: string;
        companyName: string;
        planId: string;
        recaptchaToken?: string;
      } = {
        email,
        password,
        name: name || undefined,
        companyName: companyName.trim(),
        planId,
      };
      if (recaptchaToken) payload.recaptchaToken = recaptchaToken;
      await api.post("/auth/register", payload);
      toast.push({ type: "success", title: "Registro", message: "¡Cuenta creada! Inicie sesión." });
      navigate("/login", { replace: true });
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Error al registrarse");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default", display: "flex", alignItems: "center", justifyContent: "center", p: 2, position: "relative" }}>
      <Tooltip title={mode === "dark" ? "Modo claro" : "Modo oscuro"}>
        <IconButton onClick={toggleMode} sx={{ position: "absolute", top: 16, right: 16 }}>
          {mode === "dark" ? <LightModeOutlined /> : <DarkModeOutlined />}
        </IconButton>
      </Tooltip>
      <Box
        component="form"
        onSubmit={handleSubmit}
        sx={{
          bgcolor: "background.paper",
          p: 3.5,
          borderRadius: 2,
          width: "100%",
          maxWidth: 400,
          boxShadow: 2,
          border: "1px solid",
          borderColor: "divider",
        }}
      >
        {effectiveLogo ? (
          <Box sx={{ display: "flex", justifyContent: "center", mb: 2 }}>
            <img src={effectiveLogo} alt="Logo" style={{ maxHeight: 128, maxWidth: 320, objectFit: "contain" }} />
          </Box>
        ) : (
          <Typography variant="h6" sx={{ fontWeight: 600, color: "#333", mb: 0.5 }}>
            {branding.systemTitle}
          </Typography>
        )}
        <Typography variant="body2" sx={{ color: "#666", mb: 2 }}>
          Crear cuenta y empresa
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} variant="filled">
            {error}
          </Alert>
        )}

        <FormControl fullWidth sx={{ mb: 2 }} required>
          <InputLabel>Plan</InputLabel>
          <Select
            value={planId}
            label="Plan"
            onChange={(e) => setPlanId(e.target.value)}
          >
            {plans.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name} — S/. {p.price.toFixed(2)}/mes
              </MenuItem>
            ))}
            {plans.length === 0 && (
              <MenuItem value="" disabled>Ningún plan disponible</MenuItem>
            )}
          </Select>
          {plans.length === 0 && (
            <Typography variant="caption" sx={{ mt: 0.5, color: "text.secondary" }}>
              Contacte al administrador para crear planes.
            </Typography>
          )}
        </FormControl>

        <TextField
          fullWidth
          label="Nombre de la empresa"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          required
          placeholder="Ej: Mi Tienda"
          sx={{ mb: 2 }}
        />
        <TextField
          fullWidth
          label="Su nombre"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Opcional"
          sx={{ mb: 2 }}
        />
        <TextField
          fullWidth
          label="E-mail"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          sx={{ mb: 2 }}
          autoComplete="email"
        />
        <TextField
          fullWidth
          label="Contraseña"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          helperText="Mínimo 6 caracteres"
          sx={{ mb: 2 }}
          autoComplete="new-password"
        />
        {recaptchaEnabled && recaptchaConfig?.version === "v2" && (
          <Box id="recaptcha-register-container" sx={{ mb: 2, minHeight: 78 }} />
        )}
        <Button fullWidth type="submit" variant="contained" color="primary" disabled={loading || plans.length === 0} sx={{ mt: 1 }}>
          {loading ? "Registrando..." : plans.length === 0 ? "Espere a los planes..." : "Registrar"}
        </Button>

        <Typography variant="body2" sx={{ textAlign: "center", mt: 2, color: "#666" }}>
          ¿Ya tiene cuenta?{" "}
          <Link component={RouterLink} to="/login" color="primary" underline="hover">
            Entrar
          </Link>
        </Typography>
      </Box>
    </Box>
  );
}
