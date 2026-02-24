import { FormEvent, useEffect, useState } from "react";
import { api, getMediaUrl } from "../api";
import { useToast } from "../toast/ToastContext";
import { PageContainer } from "../components/PageContainer";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardMedia from "@mui/material/CardMedia";
import CardActions from "@mui/material/CardActions";
import Chip from "@mui/material/Chip";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import IconButton from "@mui/material/IconButton";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import RefreshIcon from "@mui/icons-material/Refresh";
import ImageIcon from "@mui/icons-material/Image";

type ProductImage = { id: string; filePath: string; type: string };
type Product = {
  id: string;
  title: string;
  price: string;
  oldPrice?: string | null;
  discountPercent?: number | null;
  coupon?: string | null;
  link?: string | null;
  store?: string | null;
  category?: string | null;
  tags?: string | null;
  status: string;
  validUntil?: string | null;
  images: ProductImage[];
};

const defaultForm = () => ({
  title: "",
  price: "",
  oldPrice: "",
  discountPercent: "",
  coupon: "",
  link: "",
  store: "",
  category: "",
  tags: "",
  validUntil: "",
  status: "active" as "active" | "expired",
  imageFiles: [] as File[],
});

function getImageUrl(img: ProductImage): string {
  return getMediaUrl(img.filePath);
}

export default function ProductsPage() {
  const toast = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Product | null>(null);
  const [form, setForm] = useState(defaultForm());

  async function load() {
    setLoading(true);
    try {
      const res = await api.get<Product[]>("/products");
      setProducts(res.data);
    } catch (e: any) {
      toast.push({ type: "danger", title: "Productos", message: e?.response?.data?.message ?? "Error al cargar." });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function openCreate() {
    setEditProduct(null);
    setForm(defaultForm());
    setFormOpen(true);
  }

  function openEdit(p: Product) {
    setEditProduct(p);
    setForm({
      title: p.title,
      price: p.price,
      oldPrice: p.oldPrice ?? "",
      discountPercent: p.discountPercent?.toString() ?? "",
      coupon: p.coupon ?? "",
      link: p.link ?? "",
      store: p.store ?? "",
      category: p.category ?? "",
      tags: p.tags ?? "",
      validUntil: p.validUntil ? new Date(p.validUntil).toISOString().slice(0, 16) : "",
      status: (p.status as "active" | "expired") || "active",
      imageFiles: [],
    });
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditProduct(null);
    setForm(defaultForm());
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.price.trim()) {
      toast.push({ type: "warning", title: "Productos", message: "Complete título y precio." });
      return;
    }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("title", form.title);
      fd.append("price", form.price);
      if (form.oldPrice) fd.append("oldPrice", form.oldPrice);
      if (form.discountPercent) fd.append("discountPercent", form.discountPercent);
      if (form.coupon) fd.append("coupon", form.coupon);
      if (form.link) fd.append("link", form.link);
      if (form.store) fd.append("store", form.store);
      if (form.category) fd.append("category", form.category);
      if (form.tags) fd.append("tags", form.tags);
      if (form.validUntil) fd.append("validUntil", form.validUntil);
      fd.append("status", form.status);
      form.imageFiles.forEach((f) => fd.append("images", f));

      if (editProduct) {
        const res = await api.put<Product>(`/products/${editProduct.id}`, fd);
        setProducts((prev) => prev.map((x) => (x.id === res.data.id ? res.data : x)));
        toast.push({ type: "success", title: "Productos", message: "Producto actualizado." });
      } else {
        const res = await api.post<Product>("/products", fd);
        setProducts((prev) => [res.data, ...prev]);
        toast.push({ type: "success", title: "Productos", message: "Producto registrado." });
      }
      closeForm();
    } catch (e: any) {
      toast.push({ type: "danger", title: "Productos", message: e?.response?.data?.message ?? "Error al guardar." });
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!deleteConfirm) return;
    try {
      await api.delete(`/products/${deleteConfirm.id}`);
      setProducts((prev) => prev.filter((x) => x.id !== deleteConfirm.id));
      toast.push({ type: "success", title: "Productos", message: "Producto eliminado." });
      setDeleteConfirm(null);
    } catch (e: any) {
      toast.push({ type: "danger", title: "Productos", message: e?.response?.data?.message ?? "Error al eliminar." });
    }
  }

  const firstImage = (p: Product) => p.images?.find((i) => i.type === "image");

  return (
    <PageContainer
      title="Productos y Creativos"
      subtitle="Registre productos con ofertas para usar en las campañas."
      actions={
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button variant="outlined" size="small" startIcon={<RefreshIcon />} onClick={load} disabled={loading}>
            Actualizar
          </Button>
          <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={openCreate}>
            Nuevo producto
          </Button>
        </Box>
      }
    >
      {products.length === 0 && !loading ? (
        <Paper
          variant="outlined"
          sx={{
            py: 6,
            px: 3,
            textAlign: "center",
            bgcolor: "action.hover",
          }}
        >
          <ImageIcon sx={{ fontSize: 48, color: "text.secondary", mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            Ningún producto registrado
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Registre productos con ofertas, imágenes y enlaces para usar en sus campañas.
          </Typography>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
            Registrar primer producto
          </Button>
        </Paper>
      ) : (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", lg: "repeat(3, 1fr)" },
            gap: 2,
          }}
        >
          {products.map((p) => (
            <Card key={p.id} variant="outlined" sx={{ overflow: "hidden", display: "flex", flexDirection: "column" }}>
              {firstImage(p) ? (
                <CardMedia
                  component="img"
                  height={160}
                  image={getImageUrl(firstImage(p)!)}
                  alt={p.title}
                  sx={{ objectFit: "cover", bgcolor: "action.hover" }}
                />
              ) : (
                <Box
                  sx={{
                    height: 160,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    bgcolor: "action.hover",
                  }}
                >
                  <ImageIcon sx={{ fontSize: 48, color: "text.disabled" }} />
                </Box>
              )}
              <CardContent sx={{ flex: 1, py: 1.5 }}>
                <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 0.5 }} noWrap title={p.title}>
                  {p.title}
                </Typography>
                <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, flexWrap: "wrap", mb: 0.5 }}>
                  <Typography variant="body1" fontWeight={600} color="primary">
                    {p.price}
                  </Typography>
                  {p.oldPrice && (
                    <Typography component="span" variant="body2" sx={{ textDecoration: "line-through", color: "text.secondary" }}>
                      {p.oldPrice}
                    </Typography>
                  )}
                </Box>
                <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                  {p.store && (
                    <Chip label={p.store} size="small" variant="outlined" sx={{ height: 22, fontSize: "0.75rem" }} />
                  )}
                  <Chip
                    label={p.status === "active" ? "Activo" : "Expirado"}
                    size="small"
                    color={p.status === "active" ? "success" : "default"}
                    variant="outlined"
                    sx={{ height: 22, fontSize: "0.75rem" }}
                  />
                </Box>
              </CardContent>
              <CardActions sx={{ justifyContent: "flex-end", px: 1.5, py: 1 }}>
                <IconButton size="small" onClick={() => openEdit(p)} title="Editar">
                  <EditIcon fontSize="small" />
                </IconButton>
                <IconButton size="small" color="error" onClick={() => setDeleteConfirm(p)} title="Eliminar">
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </CardActions>
            </Card>
          ))}
        </Box>
      )}

      {/* Modal Novo/Editar */}
      <Dialog open={formOpen} onClose={closeForm} maxWidth="sm" fullWidth>
        <DialogTitle>{editProduct ? "Editar producto" : "Nuevo producto"}</DialogTitle>
        <form onSubmit={handleSubmit}>
          <DialogContent dividers>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <TextField
                fullWidth
                label="Título"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                required
              />
              <Box sx={{ display: "flex", gap: 2 }}>
                <TextField
                  label="Precio"
                  value={form.price}
                  onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                  required
                  sx={{ flex: 1 }}
                />
                <TextField
                  label="Precio antiguo"
                  value={form.oldPrice}
                  onChange={(e) => setForm((f) => ({ ...f, oldPrice: e.target.value }))}
                  sx={{ flex: 1 }}
                />
                <TextField
                  label="% Desc"
                  type="number"
                  value={form.discountPercent}
                  onChange={(e) => setForm((f) => ({ ...f, discountPercent: e.target.value }))}
                  sx={{ width: 80 }}
                />
              </Box>
              <Box sx={{ display: "flex", gap: 2 }}>
                <TextField
                  label="Cupón"
                  value={form.coupon}
                  onChange={(e) => setForm((f) => ({ ...f, coupon: e.target.value }))}
                  sx={{ flex: 1 }}
                />
                <TextField
                  label="Enlace"
                  value={form.link}
                  onChange={(e) => setForm((f) => ({ ...f, link: e.target.value }))}
                  placeholder="https://..."
                  sx={{ flex: 1 }}
                />
              </Box>
              <Box sx={{ display: "flex", gap: 2 }}>
                <TextField
                  label="Tienda"
                  value={form.store}
                  onChange={(e) => setForm((f) => ({ ...f, store: e.target.value }))}
                  placeholder="Shopee, Amazon..."
                  sx={{ flex: 1 }}
                />
                <TextField
                  label="Categoría"
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  sx={{ flex: 1 }}
                />
              </Box>
              <TextField
                fullWidth
                label="Tags"
                value={form.tags}
                onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                placeholder="oferta, promocao, black friday"
              />
              <Box sx={{ display: "flex", gap: 2 }}>
                <TextField
                  label="Validez"
                  type="datetime-local"
                  value={form.validUntil}
                  onChange={(e) => setForm((f) => ({ ...f, validUntil: e.target.value }))}
                  InputLabelProps={{ shrink: true }}
                  sx={{ flex: 1 }}
                />
                <FormControl sx={{ minWidth: 120 }}>
                  <InputLabel>Status</InputLabel>
                  <Select
                    value={form.status}
                    label="Status"
                    onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as "active" | "expired" }))}
                  >
                    <MenuItem value="active">Activo</MenuItem>
                    <MenuItem value="expired">Expirado</MenuItem>
                  </Select>
                </FormControl>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                  Imágenes o video {editProduct ? "(se añadirán las nuevas)" : ""}
                </Typography>
                <input
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  onChange={(e) => setForm((f) => ({ ...f, imageFiles: Array.from(e.target.files || []) }))}
                  style={{ fontSize: 14 }}
                />
                {form.imageFiles.length > 0 && (
                  <Typography variant="caption" sx={{ display: "block", mt: 0.5 }}>
                    {form.imageFiles.length} archivo(s) seleccionado(s)
                  </Typography>
                )}
              </Box>
            </Box>
          </DialogContent>
          <DialogActions sx={{ px: 3, py: 2 }}>
            <Button onClick={closeForm}>Cancelar</Button>
            <Button type="submit" variant="contained" disabled={loading}>
              {loading ? "Guardando..." : editProduct ? "Guardar" : "Registrar"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Confirmación de eliminación */}
      <Dialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)}>
        <DialogTitle>Eliminar producto</DialogTitle>
        <DialogContent>
          <Typography>
            ¿Desea eliminar &quot;{deleteConfirm?.title}&quot;? Esta acción no se puede deshacer.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)}>Cancelar</Button>
          <Button color="error" variant="contained" onClick={handleDelete}>
            Eliminar
          </Button>
        </DialogActions>
      </Dialog>
    </PageContainer>
  );
}
