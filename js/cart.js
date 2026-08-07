/* ============================================================
   CART — single source of truth for the buyer's shopping cart.
   Stored in localStorage under "ss_cart" as an array of line items.

   Public API (kept identical to what other pages already call):
     SS_CART.add(product, qty, variant)
     SS_CART.getAll()
     SS_CART.setQty(lineId, qty)
     SS_CART.setVariant(lineId, variantId)
     SS_CART.remove(lineId)
     SS_CART.clear()
     SS_CART.count()
     SS_CART.updateBadge()

   Pricing helpers used by product-detail.js, cart.html, checkout.html:
     SS_CART.resolveUnitPrice(baseUnitPrice, pricingTiers, qty)
     SS_CART.computeDeliveryForLine(line)

   FIX: add() now accepts a variant in TWO shapes, since two different
   callers produce two different variant objects:
     1. product-detail.js's buildPayload() embeds it as
        product.selectedVariant = { id, label, sku, priceAdjustment, stock }
        and calls SS_CART.add(payload, qty) — no 3rd argument.
     2. Older/direct callers may still pass a full ProductVariant doc as
        the 3rd argument: { _id, combination: [...], priceAdjustment, stock }.
   Both are normalized into the same stored line shape below.
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

  // Builds a human-readable label from either variant shape:
  // - full ProductVariant doc: combination: [{attribute, value}, ...]
  // - lightweight selectedVariant snapshot: already has a .label string
  function variantLabelOf(v) {
    if (!v) return "";
    if (v.label) return v.label;
    if (Array.isArray(v.combination)) return v.combination.map((c) => c.value).join(" / ");
    return "";
  }

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
  // settled directly with the seller, not charged at checkout. 'simple'
  // wholesale lines also contribute 0 here — they ride the regional
  // transport fee instead, computed separately at checkout.
  function computeDeliveryForLine(line) {
    if (line.sellerRole !== "wholesaler") return 0;
    if (line.deliveryType === "simple") return 0;
    if (line.freeDelivery) return 0;
    const dc = line.deliveryCharge || {};
    if (dc.chargeType === "fixed") return Number(dc.amount) || 0;
    if (dc.chargeType === "quantity_based") return (Number(dc.perUnitAmount) || 0) * line.qty;
    return 0; // negotiated
  }

  function add(product, qty = 1, variantArg = null) {
    // Normalize: variant may arrive as an explicit 3rd argument OR embedded
    // on the product object by product-detail.js as `selectedVariant`.
    const variant = variantArg || product.selectedVariant || null;

    const pId = productId(product);
    const vId = variantId(variant);
    const key = lineKey(pId, vId);
    const lines = read();

    const basePrice = product.displayPrice ?? product.finalPrice ?? 0;
    const unitPrice = basePrice + (variant?.priceAdjustment || 0);
    // variant.stock is present on a full ProductVariant doc; the lightweight
    // selectedVariant snapshot may or may not carry it — fall back to the
    // product's own stock rather than treating it as "unlimited" (null).
    const stockAvailable = variant && variant.stock != null ? variant.stock : product.stock;
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

    const line = {
      lineId: key,
      productId: pId,
      variantId: vId,
      variantLabel: variantLabelOf(variant),
      name: product.name,
      image: Array.isArray(product.images) && product.images.length ? product.images[0] : (product.image || ""),
      category: product.category?.name || "",
      sellerRole: product.sellerRole || "retailer",
      // 'heavy' | 'simple' — only meaningful for wholesale lines, but stored
      // regardless so cart.html/checkout.html don't need to re-fetch just to
      // classify delivery type before the first live enrichment completes.
      deliveryType: product.deliveryType || "heavy",
      unitPrice,
      qty: Math.max(qty, moq),
      stockAvailable: stockAvailable ?? null,
      minOrderQuantity: moq,
      pricingTiers: isWholesale && Array.isArray(product.pricingTiers) ? product.pricingTiers : [],
      freeDelivery: isWholesale ? !!product.freeDelivery : false,
      deliveryCharge: isWholesale
        ? (product.deliveryCharge || { chargeType: "fixed", amount: 0, perUnitAmount: 0, notes: "" })
        : null,
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

  // Updates just the variantId on an existing line (cart.html/checkout.html
  // call this when the buyer changes their Size/Color selection). Only the
  // id is persisted here — label/price/stock are always re-derived from a
  // fresh product fetch by whichever page is doing the enrichment, so this
  // never goes stale even if the seller edits variants later.
  function setVariant(lineId, variantId) {
    const lines = read();
    const line = lines.find((l) => l.lineId === lineId);
    if (!line) return;
    line.variantId = variantId;
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

  return {
    add, getAll, setQty, setVariant, remove, clear, count, updateBadge,
    resolveUnitPrice, computeDeliveryForLine,
  };
})();