const crypto = require("crypto");

let client = null;

function enabled() {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

function keyId() {
  return process.env.RAZORPAY_KEY_ID || "";
}

function getClient() {
  if (!enabled()) return null;
  if (!client) {
    const Razorpay = require("razorpay");
    client = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    });
  }
  return client;
}

function amountToPaise(amount) {
  const rupees = Number(amount);
  if (!Number.isFinite(rupees) || rupees <= 0) return 0;
  return Math.round(rupees * 100);
}

function verifyPaymentSignature(orderId, paymentId, signature) {
  if (!enabled() || !orderId || !paymentId || !signature) return false;
  const body = `${orderId}|${paymentId}`;
  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest("hex");
  return expected === signature;
}

function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature || !rawBody) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return expected === signature;
}

async function createOrder({ amountPaise, receipt, notes }) {
  const rzp = getClient();
  if (!rzp) throw new Error("Razorpay is not configured");
  if (amountPaise < 100) throw new Error("Entry fee must be at least ₹1");
  return rzp.orders.create({
    amount: amountPaise,
    currency: "INR",
    receipt: String(receipt || "").slice(0, 40),
    notes: notes || {}
  });
}

module.exports = {
  enabled,
  keyId,
  amountToPaise,
  createOrder,
  verifyPaymentSignature,
  verifyWebhookSignature
};
