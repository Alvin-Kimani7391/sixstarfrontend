/* ============================================================
   CART — single source of truth for the buyer's shopping cart.
   Stored in localStorage under "ss_cart" as an array of line items.

   Public API (kept identical to what other pages already call):
     SS_CART.add(product, qty, variant)
     SS_CART.getAll()
     SS_CART.setQty(lineId, qty)
     SS_CART.remove(lineId)
     SS_CART.clear()
     SS_CART.count()
     SS_CART.updateBadge()

   New pricing helpers used by product-detail.js and pay.html:
     SS_CART.resolveUnitPrice(baseUnitPrice, pricingTiers, qty)
     SS_CART.computeDeliveryForLine(line)
   ============================================================ */
const SS_CART = (() => {
  const STORAGE_KEY = "ss_cart";

  function read() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function write(lines) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
    updateBadge();
  }

  function productId(p) { return p.id || p._id; }
  function variantId(v) { return v ? (v.id || v._id) : null; }
  function lineKey(pId, vId) { return `${pId}::${vId || "base"}`; }

  // Highest pricing tier whose minQty <= qty, else the base unit price.
  function resolveUnitPrice(baseUnitPrice, pricingTiers, qty) {
    if (!Array.isArray(pricingTiers) || pricingTiers.length === 0) return baseUnitPrice;
    const sorted = pricingTiers.slice().sort((a, b) => a.minQty - b.minQty);
    let price = baseUnitPrice;
    for (const tier of sorted) {
      if (qty >= tier.minQty) price = tier.price;
    }
    return price;
  }

  // Delivery charge contributed by ONE wholesale cart line. Retail lines and
  // negotiated-delivery lines contribute 0 here — negotiated delivery is
  // settled directly with the seller, not charged at checkout.
  function computeDeliveryForLine(line) {
    if (line.sellerRole !== "wholesaler") return 0;
    if (line.freeDelivery) return 0;
    const dc = line.deliveryCharge || {};
    if (dc.chargeType === "fixed") return Number(dc.amount) || 0;
    if (dc.chargeType === "quantity_based") return (Number(dc.perUnitAmount) || 0) * line.qty;
    return 0; // negotiated
  }

  function add(product, qty = 1, variant = null) {
    const pId = productId(product);
    const vId = variantId(variant);
    const key = lineKey(pId, vId);
    const lines = read();

    const basePrice = product.displayPrice ?? product.finalPrice ?? 0;
    const unitPrice = basePrice + (variant?.priceAdjustment || 0);
    const stockAvailable = variant ? variant.stock : product.stock;
    const isWholesale = product.sellerRole === "wholesaler";
    const moq = isWholesale ? Math.max(1, Number(product.minOrderQuantity) || 1) : 1;

    const existing = lines.find((l) => l.lineId === key);
    if (existing) {
      let nextQty = existing.qty + qty;
      if (stockAvailable != null) nextQty = Math.min(nextQty, stockAvailable);
      existing.qty = Math.max(nextQty, moq);
      write(lines);
      return existing;
    }

    const variantLabel = variant && Array.isArray(variant.combination)
      ? variant.combination.map((c) => c.value).join(" / ")
      : "";

    const line = {
      lineId: key,
      productId: pId,
      variantId: vId,
      name: product.name,
      image: Array.isArray(product.images) && product.images.length ? product.images[0] : (product.image || ""),
      category: product.category?.name || "",
      sellerRole: product.sellerRole || "retailer",
      unitPrice,
      qty: Math.max(qty, moq),
      stockAvailable: stockAvailable ?? null,
      minOrderQuantity: moq,
      pricingTiers: isWholesale && Array.isArray(product.pricingTiers) ? product.pricingTiers : [],
      freeDelivery: isWholesale ? !!product.freeDelivery : false,
      deliveryCharge: isWholesale
        ? (product.deliveryCharge || { chargeType: "fixed", amount: 0, perUnitAmount: 0, notes: "" })
        : null,
      variantLabel,
    };

    lines.push(line);
    write(lines);
    return line;
  }

  function setQty(lineId, qty) {
    const lines = read();
    const line = lines.find((l) => l.lineId === lineId);
    if (!line) return;
    const min = line.sellerRole === "wholesaler" ? line.minOrderQuantity : 1;
    let next = Math.max(min, Number(qty) || min);
    if (line.stockAvailable != null) next = Math.min(next, line.stockAvailable);
    line.qty = next;
    write(lines);
  }

  function remove(lineId) {
    write(read().filter((l) => l.lineId !== lineId));
  }

  function clear() { write([]); }
  function getAll() { return read(); }
  function count() { return read().reduce((sum, l) => sum + (Number(l.qty) || 0), 0); }

  function updateBadge() {
    const n = count();
    document.querySelectorAll(".js-cart-count").forEach((el) => (el.textContent = n));
    const legacyBadge = document.getElementById("cart-badge");
    if (legacyBadge) legacyBadge.textContent = n;
  }

  return { add, getAll, setQty, remove, clear, count, updateBadge, resolveUnitPrice, computeDeliveryForLine };
})();