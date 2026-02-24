import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../toast/ToastContext";
import { PageContainer } from "../components/PageContainer";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Paper from "@mui/material/Paper";
import Chip from "@mui/material/Chip";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Typography from "@mui/material/Typography";
import FormGroup from "@mui/material/FormGroup";
import FormControlLabel from "@mui/material/FormControlLabel";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";

type Role = "ADMIN" | "SUPERVISOR" | "USER";
type User = {
  id: string;
  email: string;
  name?: string | null;
  role: Role;
  companyId?: string | null;
  menuPermissions?: string[] | null;
  createdAt: string;
};

type MenuKeyItem = { key: string; label: string };

type Company = { id: string; name: string; slug: string; _count?: { users: number } };

export default function AdminUsersPage() {
  const { me } = useAuth();
  const toast = useToast();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [menuKeys, setMenuKeys] = useState<MenuKeyItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [editDialog, setEditDialog] = useState<User | null>(null);
  const [editForm, setEditForm] = useState<{ role: Role; menuPermissions: string[] } | null>(null);

  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "USER" as Role,
    menuPermissions: [] as string[],
  });

  const isSuperAdmin = me?.role === "SUPERADMIN";
  const canRender = useMemo(() => me?.role === "ADMIN" || me?.role === "SUPERADMIN", [me?.role]);

  const availableRoles: Role[] = isSuperAdmin ? ["ADMIN", "SUPERVISOR", "USER"] : ["SUPERVISOR", "USER"];

  const effectiveCompanyId = isSuperAdmin ? selectedCompanyId : me?.companyId ?? null;

  async function loadCompanies() {
    if (!isSuperAdmin) return;
    try {
      const res = await api.get<Company[]>("/companies");
      setCompanies(res.data);
    } catch {
      setCompanies([]);
    }
  }

  async function load() {
    setLoading(true);
    try {
      const keysRes = await api.get<{ menuKeys: MenuKeyItem[] }>("/admin/menu-keys");
      setMenuKeys(keysRes.data.menuKeys || []);
      const usersUrl =
        isSuperAdmin && effectiveCompanyId
          ? `/admin/users?companyId=${effectiveCompanyId}`
          : "/admin/users";
      const usersRes = await api.get<User[]>(usersUrl);
      setUsers(usersRes.data);
    } catch (e: any) {
      toast.push({
        type: "danger",
        title: "Usuarios",
        message: e?.response?.data?.message ?? "Error al cargar los usuarios.",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCompanies();
  }, [isSuperAdmin]);

  useEffect(() => {
    if (canRender) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveCompanyId, canRender]);

  function toggleMenuKey(key: string, checked: boolean) {
    setForm((f) => ({
      ...f,
      menuPermissions: checked ? [...f.menuPermissions, key] : f.menuPermissions.filter((k) => k !== key),
    }));
  }

  function toggleEditMenuKey(key: string, checked: boolean) {
    if (!editForm) return;
    setEditForm({
      ...editForm,
      menuPermissions: checked
        ? [...editForm.menuPermissions, key]
        : editForm.menuPermissions.filter((k) => k !== key),
    });
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    try {
      const res = await api.post<User>("/admin/users", {
        ...form,
        companyId: isSuperAdmin && effectiveCompanyId ? effectiveCompanyId : undefined,
        menuPermissions: form.menuPermissions.length ? form.menuPermissions : undefined,
      });
      setUsers((prev) => [res.data, ...prev]);
      setForm({ name: "", email: "", password: "", role: "USER", menuPermissions: [] });
      toast.push({ type: "success", title: "Usuarios", message: "Usuario creado." });
    } catch (e: any) {
      toast.push({
        type: "danger",
        title: "Usuarios",
        message: e?.response?.data?.message ?? "Error al crear el usuario.",
      });
    }
  }

  function openEdit(u: User) {
    setEditDialog(u);
    setEditForm({
      role: u.role,
      menuPermissions: (u.menuPermissions as string[]) || [],
    });
  }

  function closeEdit() {
    setEditDialog(null);
    setEditForm(null);
  }

  async function handleEditSave() {
    if (!editDialog || !editForm) return;
    try {
      const res = await api.put<User>(`/admin/users/${editDialog.id}`, {
        role: editForm.role,
        menuPermissions: editForm.menuPermissions.length ? editForm.menuPermissions : null,
      });
      setUsers((prev) => prev.map((x) => (x.id === editDialog.id ? res.data : x)));
      toast.push({ type: "success", title: "Usuarios", message: "Usuario actualizado." });
      closeEdit();
    } catch (e: any) {
      toast.push({
        type: "danger",
        title: "Usuarios",
        message: e?.response?.data?.message ?? "Error al actualizar el usuario.",
      });
    }
  }

  async function removeUser(u: User) {
    if (!confirm(`¿Eliminar usuario ${u.email}?`)) return;
    try {
      await api.delete(`/admin/users/${u.id}`);
      setUsers((prev) => prev.filter((x) => x.id !== u.id));
      toast.push({ type: "success", title: "Usuarios", message: "Usuario eliminado." });
    } catch (e: any) {
      toast.push({
        type: "danger",
        title: "Usuarios",
        message: e?.response?.data?.message ?? "Error al eliminar el usuario.",
      });
    }
  }

  if (!canRender) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="warning">Esta página está restringida para administradores.</Alert>
      </Box>
    );
  }

  return (
    <PageContainer
      title="Usuarios"
      subtitle={
        isSuperAdmin
          ? "Gestione usuarios de todas las empresas. Seleccione una empresa en las pestañas."
          : "Cree y gestione usuarios de la empresa. Defina el cargo y los menús a los que cada uno podrá acceder."
      }
      actions={<Button variant="outlined" onClick={load} disabled={loading}>Actualizar</Button>}
    >
      {isSuperAdmin && companies.length > 0 && (
        <Tabs
          value={selectedCompanyId ?? "all"}
          onChange={(_, v) => setSelectedCompanyId(v === "all" ? null : v)}
          sx={{ borderBottom: 1, borderColor: "divider", mb: 2 }}
        >
          <Tab label="Todas" value="all" />
          {companies.map((c) => (
            <Tab key={c.id} label={`${c.name}${c._count?.users != null ? ` (${c._count.users})` : ""}`} value={c.id} />
          ))}
        </Tabs>
      )}

      {isSuperAdmin && !effectiveCompanyId && companies.length > 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Mostrando usuarios de todas las empresas
        </Typography>
      )}

      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
        <Paper sx={{ p: 2, flex: "1 1 360px", maxWidth: 440 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>Nuevo usuario</Typography>
          {isSuperAdmin && !effectiveCompanyId && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Seleccione una empresa en la pestaña de arriba para crear un nuevo usuario.
            </Alert>
          )}
          <form onSubmit={handleCreate}>
            <TextField
              fullWidth
              label="Nombre"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="E-mail"
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth
              label="Contraseña"
              type="password"
              required
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              sx={{ mb: 2 }}
            />
            <FormControl fullWidth sx={{ mb: 2 }}>
              <InputLabel>Cargo</InputLabel>
              <Select
                value={form.role}
                label="Cargo"
                onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
              >
                {availableRoles.map((r) => (
                  <MenuItem key={r} value={r}>
                    {r === "ADMIN" ? "Administrador" : r === "SUPERVISOR" ? "Supervisor" : "Usuario"}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
              Menús a los que tendrá acceso (deje en blanco para el predeterminado del cargo):
            </Typography>
            <FormGroup sx={{ mb: 2, flexDirection: "row", flexWrap: "wrap" }}>
              {menuKeys.map((m) => (
                <FormControlLabel
                  key={m.key}
                  control={
                    <Checkbox
                      size="small"
                      checked={form.menuPermissions.includes(m.key)}
                      onChange={(e) => toggleMenuKey(m.key, e.target.checked)}
                    />
                  }
                  label={m.label}
                  sx={{ mr: 2, mb: 0.5 }}
                />
              ))}
            </FormGroup>
            <Button
              fullWidth
              variant="contained"
              type="submit"
              color="primary"
              disabled={isSuperAdmin && !effectiveCompanyId}
            >
              Crear usuario
            </Button>
          </form>
        </Paper>

        <Paper sx={{ p: 2, flex: "1 1 400px", overflow: "hidden" }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>Lista</Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>E-mail</TableCell>
                  <TableCell>Nombre</TableCell>
                  <TableCell>Cargo</TableCell>
                  <TableCell align="right" sx={{ width: 200 }}></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>{u.name || "—"}</TableCell>
                    <TableCell>
                      <Chip label={u.role} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell align="right">
                      <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end", flexWrap: "wrap" }}>
                        <Button size="small" variant="outlined" onClick={() => openEdit(u)}>
                          Permisos
                        </Button>
                        <Button size="small" variant="outlined" color="error" onClick={() => removeUser(u)}>
                          Eliminar
                        </Button>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
                {!users.length && (
                  <TableRow>
                    <TableCell colSpan={4} sx={{ color: "#6b7280" }}>
                      Ningún usuario encontrado.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      </Box>

      <Dialog open={!!editDialog} onClose={closeEdit} maxWidth="sm" fullWidth>
        <DialogTitle>Permisos — {editDialog?.email}</DialogTitle>
        <DialogContent dividers>
          {editForm && (
            <Box sx={{ pt: 1 }}>
              <FormControl fullWidth sx={{ mb: 2 }}>
                <InputLabel>Cargo</InputLabel>
                <Select
                  value={editForm.role}
                  label="Cargo"
                  onChange={(e) => setEditForm((f) => (f ? { ...f, role: e.target.value as Role } : f))}
                  disabled={editDialog?.role === "ADMIN" && !isSuperAdmin}
                >
                  {availableRoles.map((r) => (
                    <MenuItem key={r} value={r}>
                      {r === "ADMIN" ? "Administrador" : r === "SUPERVISOR" ? "Supervisor" : "Usuario"}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
                Menús permitidos (en blanco = predeterminado del cargo):
              </Typography>
              <FormGroup sx={{ flexDirection: "row", flexWrap: "wrap" }}>
                {menuKeys.map((m) => (
                  <FormControlLabel
                    key={m.key}
                    control={
                      <Checkbox
                        size="small"
                        checked={editForm.menuPermissions.includes(m.key)}
                        onChange={(e) => toggleEditMenuKey(m.key, e.target.checked)}
                      />
                    }
                    label={m.label}
                    sx={{ mr: 2, mb: 0.5 }}
                  />
                ))}
              </FormGroup>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeEdit}>Cancelar</Button>
          <Button variant="contained" onClick={handleEditSave}>
            Guardar
          </Button>
        </DialogActions>
      </Dialog>
    </PageContainer>
  );
}
