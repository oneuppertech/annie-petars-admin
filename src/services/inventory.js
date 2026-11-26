import ApiService from "@/services/api";
import { supabase } from "@/services/supabase";
const BASE = "/approval-inventory";
const un = (r) => r?.data ?? r;
const get = async (p) =>
  un(
    await ApiService.get(
      `${BASE}?${new URLSearchParams(Object.entries(p).filter(([, v]) => v !== "" && v != null))}`,
    ),
  );
export const inventoryApi = {
  collections: () => get({ resource: "collections" }),
  products: (p) => get({ resource: "products", ...p }),
  product: (id) => get({ resource: "product", id }),
  lowStock: (threshold) => get({ resource: "low_stock", threshold }),
  approvals: () => get({ resource: "approvals" }),
  approval: (id) => get({ resource: "approval", id }),
  act: async (action, payload = {}) =>
    un(await ApiService.post(BASE, { ...payload, action })),
  uploadImage: async (file) => {
    const fd = new FormData();
    fd.append("file", file);
    return un(await ApiService.upload(BASE, fd));
  },
  uploadMedia: async (file) => {
    if (file.type.startsWith("image/")) return inventoryApi.uploadImage(file);
    if (!file.type.startsWith("video/"))
      throw new Error("Unsupported media format");
    if (file.size > 50 * 1024 * 1024) throw new Error("Video exceeds 50MB");
    const signed = await inventoryApi.act("sign_upload", {
      content_type: file.type,
    });
    const { data, error } = await supabase.storage
      .from("product-images")
      .uploadToSignedUrl(signed.path, signed.token, file, {
        contentType: file.type,
        upsert: false,
      });
    if (error) throw error;
    return { url: signed.url, path: data.path, media_type: "video" };
  },
};
export const errMsg = (e) =>
  e?.response?.data?.error || e?.message || "Something went wrong";
export const toKobo = (n) => Math.round(Number(n || 0) * 100);
export const toNaira = (k) => (k || 0) / 100;
export const CURRENCIES = ["NGN", "USD", "GBP", "EUR"];
export const formatMoney = (minor, cur = "NGN") =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: cur || "NGN",
  }).format((minor || 0) / 100);
export const formatNaira = (k) => formatMoney(k, "NGN");
