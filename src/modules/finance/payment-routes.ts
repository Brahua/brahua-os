// URL parameters of recurring payments (F2). Client-safe.

/**
 * After deleting a payment from its page, /finance opens with `?deleted=<id>`: "Pagos" shows
 * "Pago recurrente eliminado · Deshacer" while it is still deleted (like habits and tasks).
 */
export const DELETED_PAYMENT_PARAM = "deleted";
