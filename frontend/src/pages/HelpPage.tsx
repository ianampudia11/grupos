import { PageContainer } from "../components/PageContainer";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";

export default function HelpPage() {
  return (
    <PageContainer title="Ayuda" subtitle="Paso a paso y errores comunes.">
      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>Paso a paso</Typography>
        <ol style={{ color: "#6b7280" }}>
          <li>
            Inicie sesión en el panel en <code>/login</code>.
          </li>
          <li>
            Vaya a <b>Conexión WhatsApp</b> → genere el QR y léalo con su WhatsApp.
          </li>
          <li>
            Vaya a <b>Envío a grupos</b> → sincronice los grupos.
          </li>
          <li>
            Vaya a <b>Campañas</b> → cree (foto/texto/enlace) y envíe.
          </li>
        </ol>

        <Box sx={{ my: 2, borderTop: 1, borderColor: "divider" }} />

        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>Errores comunes</Typography>
        <ul style={{ color: "#6b7280" }}>
          <li>
            <b>401</b>: el token ha expirado o no ha iniciado sesión. Inicie sesión nuevamente.
          </li>
          <li>
            <b>No aparece el QR</b>: espere unos segundos después de hacer clic en "Generar QR" para que el
            backend genere el código QR (conexión vía Baileys).
          </li>
          <li>
            <b>El QR ha expirado</b>: haga clic en <b>Reiniciar</b> y luego en <b>Generar QR</b> nuevamente.
          </li>
          <li>
            <b>Los grupos no aparecen</b>: asegúrese de que el WhatsApp esté conectado
            antes de sincronizar los grupos.
          </li>
        </ul>
      </Paper>
    </PageContainer>
  );
}
